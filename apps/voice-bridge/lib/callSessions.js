/**
 * voice-bridge/lib/callSessions.js
 *
 * Phase B.2: at end of call, append the bridge-side data (transcript, turn
 * counts, visited modes, errors) to the call_sessions doc that telephony-service
 * already created on call.initiated.
 *
 * Doc keyed by call_control_id — both services share this id natively.
 *
 * This is additive. The existing tenant post_call_url webhook (e.g. n8n CRM
 * insertion for enkla-juridik) continues to fire untouched.
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");

let db = null;
function getDb() {
  if (!db) {
    db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  }
  return db;
}

function log(event, fields) {
  console.log(JSON.stringify({ event, ...fields }));
}

function logError(event, fields) {
  console.error(JSON.stringify({ event, severity: "ERROR", ...fields }));
}

async function writeBridgeData({
  callControlId,
  traceId,
  tenantId,
  direction,
  transcript,
  turnCountUser,
  turnCountAssistant,
  durationMs,
  voice,
  realtimeModel,
  visitedModes,
  currentMode,
  workflowEnabled,
  transferFired,
  realtimeUsage,
}) {
  // Doc id = call_control_id when Telnyx provides one; otherwise trace_id (46elks).
  const docId = callControlId || traceId;
  if (!docId) {
    log("call_session_bridge_skip", { trace_id: traceId, reason: "no_doc_id" });
    return;
  }

  const data = {
    bridge_completed_at: FieldValue.serverTimestamp(),
    bridge_trace_id: traceId,
    transcript: Array.isArray(transcript) ? transcript : [],
    turn_count_user: turnCountUser || 0,
    turn_count_assistant: turnCountAssistant || 0,
    duration_ms_bridge: durationMs || null,
    voice: voice || null,
    realtime_model: realtimeModel || null,
    workflow_enabled: Boolean(workflowEnabled),
    visited_modes: visitedModes ? Array.from(visitedModes) : [],
    final_mode: currentMode || null,
    transfer_fired: Boolean(transferFired),
    realtime_usage: realtimeUsage || null,
    // Seed tenant_id + direction here too in case the telephony-side seed didn't
    // run (older calls / edge cases). Never re-set initiated_at — that's owned
    // by the side that seeded the doc and overwriting it loses the real start time.
    ...(tenantId  ? { tenant_id: tenantId } : {}),
    ...(direction ? { direction } : {}),
  };

  try {
    await getDb().collection("call_sessions").doc(docId).set(data, { merge: true });
    log("call_session_bridge_written", {
      trace_id: traceId,
      doc_id: docId,
      transcript_turns: data.transcript.length,
    });
  } catch (err) {
    logError("call_session_bridge_error", {
      trace_id: traceId,
      doc_id: docId,
      error: err.message,
    });
  }
}

module.exports = { writeBridgeData };
