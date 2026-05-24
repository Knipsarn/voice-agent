"use strict";
/**
 * integrations/enkla-juridik/post-call.js
 *
 * Smart post-call hook. State machine for the case:
 *
 *   WAITING_SMS  → no name+email yet, waiting for the customer to reply via SMS
 *   READY        → has name+email, ready for Pipefy
 *   SENT         → already synced to Pipefy (active=false)
 *
 * Per call:
 *   1. Find the most recent active case for this phone (or create one)
 *   2. APPEND the new summary to existing summary (don't overwrite — n8n parity)
 *   3. Update outcome/category from this call
 *   4. Recompute status based on contact info present
 *   5. If status === READY → trigger Pipefy sync via control-plane /pipefy/sync
 *   6. If status === WAITING_SMS → send post-call SMS via /sms/send (unless already sent recently)
 *
 * All Pipefy and SMS work goes through control-plane HTTP endpoints — this file
 * only owns the case state transitions in Firestore.
 */

const https = require("https");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { log, logError } = require("../../lib/log");
const { alertOnError } = require("../../lib/alert");

const TENANT_ID = "enkla-juridik";
const CASES = "cases";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

function controlPlaneBase() {
  return process.env.CONTROL_PLANE_BASE_URL ||
    "https://control-plane-service-360579353014.europe-west1.run.app";
}
function controlPlaneKey() { return (process.env.CONTROL_PLANE_API_KEY || "").trim(); }

function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(controlPlaneBase());
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: url.hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${controlPlaneKey()}`,
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`${path} HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        else { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function findActiveCaseByPhone(phone) {
  // Prefer active=true case; if none, fall back to most recent regardless of status
  const activeSnap = await getDb()
    .collection(CASES)
    .where("tenant_id", "==", TENANT_ID)
    .where("phone", "==", phone)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get()
    .catch(() => null);
  if (activeSnap && !activeSnap.empty) {
    return { id: activeSnap.docs[0].id, ...activeSnap.docs[0].data() };
  }
  // No active case — return most recent (for context only; we won't reactivate SENT cases)
  const anySnap = await getDb()
    .collection(CASES)
    .where("tenant_id", "==", TENANT_ID)
    .where("phone", "==", phone)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get()
    .catch(() => null);
  if (anySnap && !anySnap.empty) {
    return { id: anySnap.docs[0].id, ...anySnap.docs[0].data() };
  }
  return null;
}

function appendSummary(existingSummary, newSummary) {
  if (!newSummary) return existingSummary || null;
  const ts = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
  const block = `---\nSamtal ${ts}\nFRÅN AI-VÄXELN:\n${newSummary}`;
  return existingSummary ? `${existingSummary}\n\n${block}` : block;
}

// E.164 validation — must be + followed by 8-15 digits, nothing else
function isValidE164(phone) {
  return typeof phone === "string" && /^\+\d{8,15}$/.test(phone);
}

module.exports = async function enklaJuridikPostCall({ call, summary }) {
  const phone = call.from_number || call.caller_number || call.phone;
  if (!phone) {
    log("integration_skip_no_phone", { tenant_id: TENANT_ID, call_control_id: call.call_control_id });
    return;
  }
  if (!isValidE164(phone)) {
    // Caller had hidden/anonymous caller ID — can't SMS, just log and bail
    log("integration_skip_invalid_phone", { tenant_id: TENANT_ID, call_control_id: call.call_control_id, phone });
    return;
  }

  log("integration_start", { tenant_id: TENANT_ID, call_control_id: call.call_control_id, phone });

  const existingCase = await findActiveCaseByPhone(phone);

  // Decide whether to use existing case or create new.
  // If existing is SENT (already synced to Pipefy and inactive) and this is a NEW call,
  // create a new case so we don't pollute the closed one.
  const reuseExisting = existingCase && existingCase.status !== "SENT" && existingCase.active !== false;

  // Compute new fields from this call
  const summaryText = summary?.summary || null;
  const callCategory = summary?.intent || null;
  const callOutcome = summary?.outcome || null;

  const now = FieldValue.serverTimestamp();
  let caseId;
  let caseAfter;

  if (reuseExisting) {
    const mergedSummary = appendSummary(existingCase.summary, summaryText);
    const patch = {
      ...(callCategory && !existingCase.category && { category: callCategory }),
      ...(callOutcome && { outcome: callOutcome }),
      ...(mergedSummary && { summary: mergedSummary }),
      last_call_at: now,
      last_call_control_id: call.call_control_id,
      updatedAt: now,
    };
    await getDb().collection(CASES).doc(existingCase.id).set(patch, { merge: true });
    caseId = existingCase.id;
    caseAfter = { ...existingCase, ...patch, summary: mergedSummary };
  } else {
    const ref = await getDb().collection(CASES).add({
      tenant_id: TENANT_ID,
      phone,
      ...(callCategory && { category: callCategory }),
      ...(callOutcome && { outcome: callOutcome }),
      ...(summaryText && { summary: appendSummary(null, summaryText) }),
      status: "WAITING_SMS",
      active: true,
      // Explicit null (not absent) so the 12h Pipefy backstop's `pipefy_card_id == null`
      // query actually matches this case — Firestore `== null` does NOT match absent fields.
      pipefy_card_id: null,
      reminder_count: 0,
      email_request_count: 0,
      last_call_at: now,
      last_call_control_id: call.call_control_id,
      createdAt: now,
      updatedAt: now,
    });
    caseId = ref.id;
    caseAfter = { id: caseId, status: "WAITING_SMS", active: true };

    // Immediately create a new Pipefy card for this new case (even without email/name yet)
    // so the new inquiry appears on top of the Pipefy board right away.
    // When the caller replies to SMS, the same card gets updated with contact details.
    try {
      await postJson("/pipefy/sync-partial", { case_id: caseId });
      log("integration_pipefy_new_card", { tenant_id: TENANT_ID, case_id: caseId });
    } catch (err) {
      logError("integration_pipefy_new_card_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
    }
  }

  // Recompute status — does the case (after this call's update) have contact info?
  const hasName = !!(caseAfter.name && String(caseAfter.name).trim());
  const hasEmail = !!(caseAfter.email && String(caseAfter.email).trim());
  const newStatus = (hasName && hasEmail) ? "READY" : "WAITING_SMS";

  // Only update status if it actually changed (don't downgrade SENT)
  if (caseAfter.status !== "SENT" && caseAfter.status !== newStatus) {
    await getDb().collection(CASES).doc(caseId).set(
      { status: newStatus, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    caseAfter.status = newStatus;
  }

  log("integration_case_upserted", {
    tenant_id: TENANT_ID, case_id: caseId, status: caseAfter.status, reused: reuseExisting,
  });

  // ── ACTION based on status ──────────────────────────────────────────────────
  if (caseAfter.status === "READY") {
    // Has all the info — sync directly to Pipefy
    try {
      const r = await postJson("/pipefy/sync", { case_id: caseId });
      log("integration_pipefy_synced", { tenant_id: TENANT_ID, case_id: caseId, ...r });
    } catch (err) {
      logError("integration_pipefy_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
      alertOnError("integration_pipefy_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
    }
    return;
  }

  // status === WAITING_SMS — atomically claim the SMS slot.
  // Race fix: read last_sms_sent_at AND write it in the same transaction,
  // so two parallel post-processor runs can't both see "null" and both send.
  const SMS_GUARD_MS = 60 * 60 * 1000; // 1 hour
  const claimedSms = await getDb().runTransaction(async (tx) => {
    const ref = getDb().collection(CASES).doc(caseId);
    const snap = await tx.get(ref);
    const d = snap.data() || {};
    const lastReminder = d.last_reminder?.toDate?.();
    const lastSmsSent  = d.last_sms_sent_at?.toDate?.();
    const lastContact  = lastSmsSent && lastReminder
      ? new Date(Math.max(lastSmsSent.getTime(), lastReminder.getTime()))
      : (lastSmsSent || lastReminder);
    if (lastContact && (Date.now() - lastContact.getTime()) < SMS_GUARD_MS) {
      return false; // another run already sent
    }
    tx.set(ref, { last_sms_sent_at: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });

  if (!claimedSms) {
    log("integration_sms_skip_recent", { tenant_id: TENANT_ID, case_id: caseId });
    return;
  }

  try {
    const r = await postJson("/sms/send", { tenant_id: TENANT_ID, case_id: caseId, to: phone });
    log("integration_sms_sent", {
      tenant_id: TENANT_ID, case_id: caseId,
      elk_id: r.elk_message_id, segments: r.segments, cost_customer_sek: r.cost_customer_sek,
    });
  } catch (err) {
    logError("integration_sms_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
    alertOnError("integration_sms_failed", { tenant_id: TENANT_ID, case_id: caseId, error: err.message });
  }
};
