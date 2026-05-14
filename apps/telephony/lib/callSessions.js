/**
 * lib/callSessions.js
 *
 * Firestore writer for the call_sessions collection — the structured post-call
 * object (Phase B foundation).
 *
 * Doc ID = call_control_id (Telnyx's per-leg ID, stable for the inbound leg).
 * Bridge will append transcript/turns to the same doc in B.2; both services
 * share call_control_id natively, so no join logic is needed.
 *
 * Phase B.1 (this file): lifecycle metadata only (initiated/answered/hangup).
 * Phase B.2 adds: transcript, turn counts, mode_history, errors (written by bridge).
 * Phase B.3 adds: summary, intent, outcome, costs (written by post-processor).
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { logError } = require("./log");

const COLLECTION = "call_sessions";

let db = null;
function getDb() {
  if (!db) {
    db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  }
  return db;
}

function parseMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

async function safeSet(callControlId, data, label, traceId) {
  if (!callControlId) {
    logError("call_session_write_skipped", { trace_id: traceId, reason: "no_call_control_id", label });
    return;
  }
  try {
    await getDb().collection(COLLECTION).doc(callControlId).set(data, { merge: true });
  } catch (err) {
    logError("call_session_write_error", { trace_id: traceId, label, call_control_id: callControlId, error: err.message });
  }
}

async function createOnInitiated({ payload, traceId, tenantId, sessionId }) {
  const callControlId = payload.call_control_id;
  const data = {
    call_control_id: callControlId,
    call_session_id: payload.call_session_id || null,
    call_leg_id: payload.call_leg_id || null,
    connection_id: payload.connection_id || null,
    session_id: sessionId,
    trace_id: traceId,

    tenant_id: tenantId,
    to_number: payload.to || null,
    from_number: payload.from || null,
    direction: "inbound",

    status: "active",
    initiated_at: FieldValue.serverTimestamp(),
    initiated_at_telnyx: payload.start_time || null,
  };
  await safeSet(callControlId, data, "initiated", traceId);
}

async function updateOnAnswered({ payload, traceId }) {
  await safeSet(
    payload.call_control_id,
    {
      answered_at: FieldValue.serverTimestamp(),
      answered_at_telnyx: payload.start_time || null,
    },
    "answered",
    traceId,
  );
}

async function updateOnHangup({ payload, traceId }) {
  const startMs = parseMs(payload.start_time);
  const endMs = parseMs(payload.end_time);
  const durationMs = startMs && endMs ? endMs - startMs : null;

  await safeSet(
    payload.call_control_id,
    {
      status: "completed",
      hangup_at: FieldValue.serverTimestamp(),
      hangup_at_telnyx: payload.end_time || null,
      hangup_cause: payload.hangup_cause || null,
      hangup_source: payload.hangup_source || null,
      duration_ms: durationMs,
      // Telnyx cost components (filled in B.3 with real rates × duration)
      // Leaving placeholder so post-processor can detect "summary not yet generated"
      summary_pending: true,
    },
    "hangup",
    traceId,
  );
}

/**
 * Outbound calls: telephony-service initiates the call before any provider
 * webhook fires. We seed the call_session here so /calls history shows it.
 * Doc id = callControlId when Telnyx, otherwise traceId (46elks doesn't expose one).
 */
async function createOnOutboundInitiated({ traceId, tenantId, from, to, provider, callControlId, leadId }) {
  // Outbound docs are keyed by trace_id (unified across providers). Telnyx's
  // call_control_id is stored as a field but NOT used as the doc id, because we
  // can't propagate it into the bridge's WSS URL before the dial returns it.
  // Using trace_id keeps the seed and the bridge's writeBridgeData in sync.
  const docId = traceId;
  if (!docId) {
    logError("call_session_outbound_skipped", { trace_id: traceId, reason: "no_id" });
    return;
  }
  const data = {
    call_control_id: callControlId || null,
    trace_id: traceId,
    tenant_id: tenantId,
    direction: "outbound",
    provider: provider || null,
    from_number: from || null,
    to_number: to || null,
    lead_id: leadId || null,
    status: "active",
    initiated_at: FieldValue.serverTimestamp(),
  };
  try {
    await getDb().collection(COLLECTION).doc(docId).set(data, { merge: true });
  } catch (err) {
    logError("call_session_outbound_write_error", { trace_id: traceId, doc_id: docId, error: err.message });
  }
}

module.exports = { createOnInitiated, updateOnAnswered, updateOnHangup, createOnOutboundInitiated };
