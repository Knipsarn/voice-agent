const express = require("express");
const crypto = require("crypto");

const { log, logError } = require("../lib/log");
const { verifyTelnyxSignature } = require("../lib/telnyxSignature");
const { lookupTenantByNumber } = require("../lib/numberRouter");
const { answerWithStream } = require("../lib/telnyxClient");

const router = express.Router();

// Build the WSS URL the bridge expects. Query keys must match what apps/voice-bridge/index.js reads:
//   tenant, caller, session-id, control-id (also accepts call_control_id)
function buildBridgeWssUrl({ tenantId, callerE164, sessionId, callControlId }) {
  const base = process.env.BRIDGE_BASE_URL;
  if (!base) throw new Error("BRIDGE_BASE_URL is not set");
  const u = new URL(base);
  u.protocol = "wss:";
  u.searchParams.set("tenant", tenantId);
  if (callerE164) u.searchParams.set("caller", callerE164);
  u.searchParams.set("session-id", sessionId);
  u.searchParams.set("control-id", callControlId);
  return u.toString();
}

async function handleCallInitiated(payload, traceId) {
  const callControlId = payload.call_control_id;
  const to = payload.to;
  const from = payload.from;

  if (!callControlId || !to) {
    logError("call_initiated_missing_fields", { trace_id: traceId, has_ccid: Boolean(callControlId), has_to: Boolean(to) });
    return;
  }

  const lookup = await lookupTenantByNumber(to);
  if (!lookup) {
    log("unknown_number", { trace_id: traceId, to, from });
    return;
  }

  const sessionId = traceId;
  const wssUrl = buildBridgeWssUrl({
    tenantId: lookup.tenantId,
    callerE164: from,
    sessionId,
    callControlId,
  });

  log("call_routed", {
    trace_id: traceId,
    tenant_id: lookup.tenantId,
    to,
    from,
    session_id: sessionId,
    call_control_id: callControlId,
  });

  await answerWithStream({ callControlId, streamUrl: wssUrl, traceId });
}

function handleCallHangup(payload, traceId) {
  // Phase A: log only. Structured post-call object is built in Phase B,
  // combining Telnyx hangup metadata with bridge-side transcript/turn data.
  log("call_end", {
    trace_id: traceId,
    call_control_id: payload.call_control_id,
    to: payload.to,
    from: payload.from,
    hangup_cause: payload.hangup_cause,
    hangup_source: payload.hangup_source,
    start_time: payload.start_time,
    end_time: payload.end_time,
  });
}

// Webhook handler. Mounted at POST / (parent mounts at /webhooks/telnyx).
// Requires the raw-body parser at the parent level so signature verification sees exact bytes.
//
// We AWAIT the handler before acking. Cloud Run throttles CPU after res.end(),
// so fire-and-forget caused multi-second delays which made answer commands fail
// with 422 "Call has already ended". Waiting for the handler keeps the request
// alive (and CPU running) until the work is done. Telnyx webhook timeout is
// generous (>10s) and our handler completes in <2s.
router.post("/", async (req, res) => {
  const traceId = crypto.randomUUID();
  const sigHeader = req.header("telnyx-signature-ed25519");
  const tsHeader = req.header("telnyx-timestamp");

  const verification = verifyTelnyxSignature(req.rawBody, sigHeader, tsHeader);
  if (!verification.valid) {
    logError("webhook_signature_invalid", { trace_id: traceId, reason: verification.reason });
    return res.status(401).json({ error: "invalid signature" });
  }

  let body;
  try {
    body = JSON.parse(req.rawBody.toString("utf8"));
  } catch (err) {
    logError("webhook_bad_json", { trace_id: traceId, error: err.message });
    return res.status(400).json({ error: "bad json" });
  }

  const event = body?.data;
  const eventType = event?.event_type;
  const payload = event?.payload || {};

  try {
    if (eventType === "call.initiated") {
      await handleCallInitiated(payload, traceId);
    } else if (eventType === "call.hangup") {
      handleCallHangup(payload, traceId);
    } else {
      log("webhook_event_ignored", { trace_id: traceId, event_type: eventType });
    }
  } catch (err) {
    // Always 200 anyway — retries on a hangup we already started would be worse than swallowing the error.
    logError("webhook_handler_error", { trace_id: traceId, event_type: eventType, error: err.message });
  }

  res.status(200).end();
});

module.exports = router;
