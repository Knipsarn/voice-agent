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
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");
  const block = `---\nSamtal ${ts}\n${newSummary}`;
  return existingSummary ? `${existingSummary}\n\n${block}` : block;
}

module.exports = async function enklaJuridikPostCall({ call, summary }) {
  const phone = call.from_number || call.caller_number || call.phone;
  if (!phone) {
    log("integration_skip_no_phone", { tenant_id: TENANT_ID, call_control_id: call.call_control_id });
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
      reminder_count: 0,
      email_request_count: 0,
      last_call_at: now,
      last_call_control_id: call.call_control_id,
      createdAt: now,
      updatedAt: now,
    });
    caseId = ref.id;
    caseAfter = { id: caseId, status: "WAITING_SMS", active: true };

    // The old case is SENT — but its Pipefy card should still receive the new summary.
    // Append the new summary to the old case and re-sync, so Pipefy stays up to date.
    if (existingCase?.pipefy_card_id && summaryText) {
      try {
        const mergedOld = appendSummary(existingCase.summary, summaryText);
        await getDb().collection(CASES).doc(existingCase.id).set(
          { summary: mergedOld, updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        await postJson("/pipefy/sync", { case_id: existingCase.id });
        log("integration_pipefy_summary_updated", { tenant_id: TENANT_ID, case_id: existingCase.id });
      } catch (err) {
        logError("integration_pipefy_summary_update_failed", { tenant_id: TENANT_ID, case_id: existingCase.id, error: err.message });
      }
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

  // status === WAITING_SMS — send SMS unless we sent one in the last hour
  // (avoid spamming on rapid back-to-back calls)
  const lastReminder = caseAfter.last_reminder?.toDate?.();
  const recentlyContacted = lastReminder && ((Date.now() - lastReminder.getTime()) < 60 * 60 * 1000);
  if (recentlyContacted) {
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
