"use strict";
/**
 * integrations/enkla-juridik/post-call.js
 *
 * Post-call hook for enkla-juridik. Called after each call is summarized.
 *
 * Steps:
 *   1. Find existing Firestore case by caller phone, or create new one
 *   2. Update case with call outcome (category, outcome, last_call_at)
 *   3. Send follow-up SMS via control-plane /sms/send (only if no name/email yet)
 *   4. Sync to Pipefy — create card if new, update if pipefy_card_id already set
 *   5. Write Pipefy card ID back to the case for future syncs
 *
 * Pipefy + SMS failures are non-fatal: case is already updated in Firestore.
 */

const https = require("https");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { syncCase: pipefySyncCase } = require("./pipefy");
const { log, logError } = require("../../lib/log");

const TENANT_ID = "enkla-juridik";
const CASES = "cases";

const SMS_MESSAGE =
  "Hej! Tack för att du kontaktade Enkla Juridik. För att en jurist ska kunna kontakta dig, " +
  "svara på detta SMS med ditt namn, e-postadress och ort i detta format:\n" +
  "Förnamn Efternamn, din@email.se, Stockholm";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

function getControlPlaneBase() {
  return process.env.CONTROL_PLANE_BASE_URL || "https://control-plane-service-360579353014.europe-west1.run.app";
}

function getControlPlaneKey() {
  return process.env.CONTROL_PLANE_API_KEY || "";
}

// Call control-plane POST /sms/send — fire and forget from post-processor
function sendSMS(tenant_id, case_id, to) {
  return new Promise((resolve, reject) => {
    const base = getControlPlaneBase().replace(/^https?:\/\//, "");
    const [hostname, ...pathParts] = base.split("/");
    const body = JSON.stringify({ tenant_id, case_id, to, message: SMS_MESSAGE });

    const req = https.request(
      {
        hostname,
        path: "/sms/send",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getControlPlaneKey()}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          if (res.statusCode >= 400) reject(new Error(`SMS send HTTP ${res.statusCode}: ${raw}`));
          else resolve(JSON.parse(raw));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
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

  const category    = existingCase?.category || summary?.intent || null;
  const outcome     = summary?.outcome || null;
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

  // ── Send follow-up SMS (only if we don't have name+email yet) ───────────────
  const needsContactInfo = !existingCase?.email;
  if (needsContactInfo) {
    try {
      const smsRes = await sendSMS(TENANT_ID, caseId, phone);
      log("integration_sms_sent", { tenant_id: TENANT_ID, case_id: caseId, elk_id: smsRes.elk_message_id });
    } catch (err) {
      logError("integration_sms_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
    }
  } else {
    log("integration_sms_skip", { tenant_id: TENANT_ID, case_id: caseId, reason: "email already known" });
  }

  // ── Pipefy sync ──────────────────────────────────────────────────────────────
  const pipefyFields = {
    name:     existingCase?.name  || null,
    phone,
    email:    existingCase?.email || null,
    city:     existingCase?.city  || null,
    summary:  caseSummary,
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
