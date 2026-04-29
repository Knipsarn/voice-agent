"use strict";
/**
 * integrations/enkla-juridik/post-call.js
 *
 * Post-call hook for enkla-juridik. Called after each call is summarized.
 *
 * Steps:
 *   1. Find existing Firestore case by caller phone, or create new one
 *   2. Update case with call outcome (category, outcome, last_call_at)
 *   3. Sync to Pipefy — create card if new, update if pipefy_card_id already set
 *   4. Write Pipefy card ID back to the case for future syncs
 *
 * Pipefy failures are non-fatal: case is already updated in Firestore.
 *
 * @param {object} data
 * @param {object} data.call     - call_sessions doc fields + call_control_id
 * @param {object} data.summary  - post-processor summary { intent, outcome, category, ... }
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { syncCase: pipefySyncCase } = require("./pipefy");
const { log, logError } = require("../../lib/log");

const TENANT_ID = "enkla-juridik";
const CASES = "cases";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

async function findCaseByPhone(phone) {
  const snap = await getDb()
    .collection(CASES)
    .where("tenant_id", "==", TENANT_ID)
    .where("phone", "==", phone)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

module.exports = async function enklaJuridikPostCall({ call, summary }) {
  const phone = call.caller_number || call.phone;
  if (!phone) {
    log("integration_skip_no_phone", { tenant_id: TENANT_ID, call_control_id: call.call_control_id });
    return;
  }

  log("integration_start", { tenant_id: TENANT_ID, call_control_id: call.call_control_id, phone });

  const existingCase = await findCaseByPhone(phone);

  // Extract fields — prefer AI summary output over existing case values
  // summary.intent is the closest analog to "Ärendetyp" (case category) we have
  const category    = existingCase?.category || summary?.intent || null;
  const outcome     = summary?.outcome  || null;
  // summary.summary is the factual text string from the summarizer
  const caseSummary = summary?.summary || existingCase?.summary || null;

  // ── Upsert case ──────────────────────────────────────────────────────────────
  const now = FieldValue.serverTimestamp();
  const patch = {
    tenant_id: TENANT_ID,
    phone,
    ...(category    && { category }),
    ...(outcome     && { outcome }),
    ...(caseSummary && !existingCase?.summary && { summary: caseSummary }),
    last_call_at: now,
    last_call_control_id: call.call_control_id,
    updatedAt: now,
  };

  let caseId;
  if (existingCase) {
    await getDb().collection(CASES).doc(existingCase.id).set(patch, { merge: true });
    caseId = existingCase.id;
  } else {
    const ref = await getDb().collection(CASES).add({
      ...patch,
      status: "SENT",
      active: true,
      reminder_count: 0,
      email_request_count: 0,
      createdAt: now,
    });
    caseId = ref.id;
  }

  log("integration_case_upserted", { tenant_id: TENANT_ID, case_id: caseId, new_case: !existingCase });

  // ── Pipefy sync ──────────────────────────────────────────────────────────────
  const pipefyFields = {
    name:     existingCase?.name  || null,
    phone,
    email:    existingCase?.email || null,
    city:     existingCase?.city  || null,
    summary: caseSummary,
    category,
  };

  try {
    const cardId = await pipefySyncCase(existingCase?.pipefy_card_id || null, pipefyFields);

    if (!existingCase?.pipefy_card_id && cardId) {
      await getDb().collection(CASES).doc(caseId).set(
        { pipefy_card_id: cardId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    log("integration_pipefy_synced", { tenant_id: TENANT_ID, case_id: caseId, pipefy_card_id: cardId });
  } catch (err) {
    logError("integration_pipefy_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
  }
};
