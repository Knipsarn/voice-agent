/**
 * routes/elksWebhooks.js — 46elks webhook callbacks.
 *
 * POST /webhooks/elks/voice_start
 *   Called by 46elks when an outbound call is answered.
 *   Query params carry the session context set when we initiated the call.
 *   Responds with { "connect": "wss://..." } to route audio to the bridge.
 */

const express = require("express");
const { log, logError } = require("../lib/log");

const router = express.Router();

function buildElksBridgeWssUrl({ tenantId, callerE164, sessionId, leadName, leadBusiness, leadWebsite }) {
  const base = process.env.BRIDGE_BASE_URL;
  if (!base) throw new Error("BRIDGE_BASE_URL is not set");
  const u = new URL(base);
  u.protocol = "wss:";
  u.pathname = "/elks";
  u.searchParams.set("tenant", tenantId);
  u.searchParams.set("session-id", sessionId);
  u.searchParams.set("direction", "outbound");
  if (callerE164) u.searchParams.set("caller", callerE164);
  if (leadName)     u.searchParams.set("lead_name",     leadName);
  if (leadBusiness) u.searchParams.set("lead_business", leadBusiness);
  if (leadWebsite)  u.searchParams.set("lead_website",  leadWebsite);
  return u.toString();
}

// 46elks POSTs form-encoded data when a call is answered.
// Query params on this URL carry the context we set when initiating the call.
router.post("/voice_start", (req, res) => {
  const q = req.query;
  const tenantId    = q.tenant_id;
  const sessionId   = q.session_id;
  const leadName    = q.lead_name    || null;
  const leadBusiness = q.lead_business || null;
  const leadWebsite  = q.lead_website  || null;

  // 46elks sends the caller's number in the POST body
  const callerE164 = req.body?.from || null;
  const callid     = req.body?.callid || null;

  if (!tenantId || !sessionId) {
    logError("elks_voice_start_missing_params", { tenantId, sessionId, callid });
    return res.status(400).json({ error: "missing tenant_id or session_id" });
  }

  try {
    const wssUrl = buildElksBridgeWssUrl({ tenantId, callerE164, sessionId, leadName, leadBusiness, leadWebsite });
    log("elks_voice_start", { tenant_id: tenantId, session_id: sessionId, callid, caller: callerE164, wss_url: wssUrl });
    res.json({ connect: wssUrl });
  } catch (err) {
    logError("elks_voice_start_error", { tenant_id: tenantId, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
