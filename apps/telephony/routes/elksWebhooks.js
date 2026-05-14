/**
 * routes/elksWebhooks.js — 46elks webhook callbacks.
 *
 * POST /webhooks/elks/voice_start
 *   Called by 46elks when an outbound call is answered.
 *   Context (tenant_id, lead params) arrives as query params we set when creating the call.
 *   Callid arrives in the POST body.
 *
 *   We respond { "connect": ELK_FROM_NUMBER } to route audio to the virtual 46elks number,
 *   which is configured in the 46elks dashboard with voice_start = wss://bridge/elks?tenant=...
 *   That causes 46elks to open a WebSocket to the bridge with a { t:"hello" } message.
 *
 *   Per-call context (lead info, session_id) is stored keyed by callid so the bridge
 *   can retrieve it via GET /context/:callid after receiving the hello message.
 */

const express = require("express");
const { log, logError } = require("../lib/log");

const router = express.Router();

// Short-lived per-call context store: callid → { tenant_id, session_id, lead_name, ... }
// Entries are deleted when retrieved or after 10 minutes.
const callContext = new Map();

function storeContext(callid, ctx) {
  callContext.set(callid, ctx);
  setTimeout(() => callContext.delete(callid), 10 * 60 * 1000);
}

// Bridge calls this to retrieve lead context after getting callid from the hello message.
router.get("/context/:callid", (req, res) => {
  const ctx = callContext.get(req.params.callid);
  if (!ctx) return res.status(404).json({ error: "context not found" });
  callContext.delete(req.params.callid);
  res.json(ctx);
});

// 46elks POSTs form-encoded data when the outbound call is answered.
// Query params carry the context we embedded when creating the call.
router.post("/voice_start", (req, res) => {
  const q = req.query;
  const tenantId     = q.tenant_id    || null;
  const sessionId    = q.session_id   || null;
  const leadName     = q.lead_name    || null;
  const leadBusiness = q.lead_business || null;
  const leadWebsite  = q.lead_website  || null;

  // 46elks POSTs form body with callid, from (caller), to (recipient), direction, etc.
  const callid     = req.body?.callid || null;
  const callerE164 = req.body?.from   || null;

  if (!tenantId || !callid) {
    logError("elks_voice_start_missing_params", { tenantId, sessionId, callid });
    return res.status(400).json({ error: "missing tenant_id or callid" });
  }

  // Store context so bridge can fetch it by callid after WebSocket hello.
  storeContext(callid, { tenant_id: tenantId, session_id: sessionId, caller: callerE164, lead_name: leadName, lead_business: leadBusiness, lead_website: leadWebsite });

  // Route to our 46elks "websocket-number" (a special resource provisioned by 46elks support).
  // That number has voice_start = wss://bridge/elks?tenant=... configured in the dashboard,
  // so 46elks opens a WebSocket to the bridge when the call is routed to it.
  const wsNumber = process.env.ELK_WEBSOCKET_NUMBER;
  if (!wsNumber) {
    logError("elks_voice_start_no_ws_number", { callid });
    return res.status(500).json({ error: "ELK_WEBSOCKET_NUMBER not configured" });
  }

  log("elks_voice_start", { tenant_id: tenantId, session_id: sessionId, callid, caller: callerE164, connect_to: wsNumber });
  res.json({ connect: wsNumber });
});

module.exports = router;
module.exports.callContext = callContext;
