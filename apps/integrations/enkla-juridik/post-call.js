"use strict";
/**
 * integrations/enkla-juridik/post-call.js
 *
 * Post-call hook for enkla-juridik.
 * Called by apps/integrations/index.js after each call is summarized.
 *
 * Responsibilities:
 *   1. Find or create a Firestore case for the caller's phone number
 *   2. Update the case with call outcome from the summary
 *   3. Sync to Pipefy (create card if new, update if existing)
 *   4. Store the Pipefy card ID back on the case for future syncs
 *
 * @param {object} data
 * @param {object} data.call     - call_sessions doc data + call_control_id
 * @param {object} data.summary  - post-processor summary { intent, outcome, sentiment, ... }
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { syncCase: pipefySyncCase } = require("./pipefy");
const { log, logError } = require("../../post-processor/lib/log");

const TENANT_ID = "enkla-juridik";
const CASES_COLLECTION = "cases";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

async function findCaseByPhone(phone) {
  const snap = await getDb()
    .collection(CASES_COLLECTION)
    .where("tenant_id", "==", TENANT_ID)
    .where("phone", "==", phone)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

module.exports = async function enklaJuridikPostCall({ call, summary }) {
  const phone = call.caller_number || call.phone;
  if (!phone) {
    log("integration_skip_no_phone", { tenant_id: TENANT_ID, call_control_id: call.call_control_id });
    return;
  }

  log("integration_start", { tenant_id: TENANT_ID, call_control_id: call.call_control_id, phone });

  // ── 1. Look up existing case ─────────────────────────────────────────────────
  let existingCase = await findCaseByPhone(phone);

  // Fields extracted from the call + summary
  const name    = existingCase?.name    || null;
  const email   = existingCase?.email   || null;
  const city    = existingCase?.city    || null;
  const category = summary?.category || existingCase?.category || null;
  const outcome  = summary?.outcome  || null;
  const intent   = summary?.intent   || null;
  // Use the AI-generated summary text as the case summary if no existing summary
  const caseSummary = summary?.summary_text || summary?.intent || existingCase?.summary || null;

  // ── 2. Upsert Firestore case ─────────────────────────────────────────────────
  const now = FieldValue.serverTimestamp();
  const caseUpdate = {
    tenant_id: TENANT_ID,
    phone,
    ...(name     && { name }),
    ...(email    && { email }),
    ...(city     && { city }),
    ...(category && { category }),
    ...(outcome  && { outcome }),
    ...(intent   && { last_intent: intent }),
    ...(caseSummary && !existingCase?.summary && { summary: caseSummary }),
    last_call_at: now,
    last_call_control_id: call.call_control_id,
    updatedAt: now,
  };

  let caseId;
  if (existingCase) {
    await getDb().collection(CASES_COLLECTION).doc(existingCase.id).set(caseUpdate, { merge: true });
    caseId = existingCase.id;
  } else {
    const ref = await getDb().collection(CASES_COLLECTION).add({
      ...caseUpdate,
      status: "SENT",
      active: true,
      reminder_count: 0,
      email_request_count: 0,
      createdAt: now,
    });
    caseId = ref.id;
    // Re-fetch so we have the full doc for Pipefy sync
    existingCase = { id: caseId, ...(await ref.get()).data() };
  }

  log("integration_case_upserted", { tenant_id: TENANT_ID, case_id: caseId, is_new: !existingCase?.pipefy_card_id });

  // ── 3. Sync to Pipefy ────────────────────────────────────────────────────────
  try {
    const cardId = await pipefySyncCase(existingCase?.pipefy_card_id || null, {
      name,
      phone,
      email,
      city,
      summary: caseSummary,
      category,
    });

    // Store card ID back on the case so future calls update the same card
    if (!existingCase?.pipefy_card_id && cardId) {
      await getDb().collection(CASES_COLLECTION).doc(caseId).set(
        { pipefy_card_id: cardId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    log("integration_pipefy_synced", { tenant_id: TENANT_ID, case_id: caseId, pipefy_card_id: cardId });
  } catch (err) {
    logError("integration_pipefy_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
    // Pipefy failure is non-fatal — case is already updated in Firestore
  }
};
