/**
 * routes/outbound.js — initiate outbound calls.
 *
 * POST /v1/calls/outbound
 *   body: { tenant_id, to }
 *   auth: Bearer ${CONTROL_PLANE_API_KEY}
 *
 * Looks up the tenant's primary outbound number, builds a bridge WSS URL,
 * dials via Telnyx with stream_url set so audio streams from the moment
 * the recipient answers.
 */

const express = require("express");
const crypto = require("crypto");
const { Firestore } = require("@google-cloud/firestore");

const { log, logError } = require("../lib/log");
const { dialOutbound } = require("../lib/telnyxClient");
const { dialElksOutbound } = require("../lib/elksClient");
const { createOnOutboundInitiated } = require("../lib/callSessions");

const router = express.Router();
const TENANTS = "tenants";

let firestore = null;
function getDb() {
  if (!firestore) firestore = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return firestore;
}

function authed(req, res, next) {
  const expected = process.env.CONTROL_PLANE_API_KEY?.trim();
  if (!expected) return next();
  const auth = req.header("authorization");
  if (auth === `Bearer ${expected}`) return next();
  return res.status(401).json({ error: "unauthorized" });
}

const E164_RE = /^\+\d{8,15}$/;

router.post("/", authed, async (req, res) => {
  const traceId = crypto.randomUUID();
  const { tenant_id, to, lead_id, lead_name, lead_business, lead_website, provider } = req.body || {};
  const useElks = provider === "elks";

  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
  if (!to || !E164_RE.test(to)) return res.status(400).json({ error: "to must be E.164 (e.g. +46701234567)" });

  try {
    const doc = await getDb().collection(TENANTS).doc(tenant_id).get();
    if (!doc.exists) return res.status(404).json({ error: `Tenant not found: ${tenant_id}` });
    const tenant = doc.data();

    // Pick the outbound number: elks_e164 for 46elks, primary_e164 for Telnyx.
    const from = useElks
      ? (tenant.phone_numbers?.elks_e164 || process.env.ELK_FROM_NUMBER)
      : tenant.phone_numbers?.primary_e164;
    if (!from || !E164_RE.test(from)) {
      return res.status(400).json({ error: `Tenant ${tenant_id} has no valid outbound number for provider ${useElks ? "elks" : "telnyx"}` });
    }

    log("outbound_dial_attempt", { trace_id: traceId, tenant_id, provider: useElks ? "elks" : "telnyx", from, to, lead_id: lead_id || null });

    let result;

    if (useElks) {
      // 46elks voice_start only accepts HTTP URLs. We use a two-step approach:
      // 1. voice_start = our HTTP webhook (context in query params, callid in POST body)
      // 2. Webhook responds { connect: elks_e164 } to route to the virtual number
      // 3. The virtual number has voice_start = wss://bridge/elks?... in the 46elks dashboard
      const telephonyBase = process.env.TELEPHONY_BASE_URL;
      if (!telephonyBase) return res.status(500).json({ error: "TELEPHONY_BASE_URL not configured" });
      const voiceStartUrl = new URL(`${telephonyBase}/webhooks/elks/voice_start`);
      voiceStartUrl.searchParams.set("tenant_id",   tenant_id);
      voiceStartUrl.searchParams.set("session_id",  traceId);
      if (lead_name)     voiceStartUrl.searchParams.set("lead_name",     lead_name);
      if (lead_business) voiceStartUrl.searchParams.set("lead_business", lead_business);
      if (lead_website)  voiceStartUrl.searchParams.set("lead_website",  lead_website);

      result = await dialElksOutbound({ from, to, voiceStartUrl: voiceStartUrl.toString(), traceId });

      if (!result.ok) {
        logError("outbound_dial_failed", { trace_id: traceId, tenant_id, provider: "elks", to, error: result.error });
        return res.status(502).json({ error: "elks_dial_failed", detail: result.error });
      }

      // Seed call_sessions so /calls history shows this call. Doc id = traceId
      // since 46elks has no call_control_id concept; bridge appends transcript.
      await createOnOutboundInitiated({
        traceId, tenantId: tenant_id, from, to,
        provider: "elks",
        leadId: lead_id || null,
      });

      return res.status(202).json({ ok: true, provider: "elks", tenant_id, from, to, callid: result.callid, trace_id: traceId });
    }

    // Telnyx path
    const base = process.env.BRIDGE_BASE_URL;
    if (!base) return res.status(500).json({ error: "BRIDGE_BASE_URL not configured" });
    const wssUrl = new URL(base);
    wssUrl.protocol = "wss:";
    wssUrl.searchParams.set("tenant", tenant_id);
    wssUrl.searchParams.set("session-id", traceId);
    wssUrl.searchParams.set("caller", to);
    wssUrl.searchParams.set("direction", "outbound");
    if (lead_name)     wssUrl.searchParams.set("lead_name",     lead_name);
    if (lead_business) wssUrl.searchParams.set("lead_business", lead_business);
    if (lead_website)  wssUrl.searchParams.set("lead_website",  lead_website);

    const connectionId = process.env.TELNYX_OUTBOUND_CONNECTION_ID || "2946878804032751101";
    result = await dialOutbound({
      from, to,
      streamUrl: wssUrl.toString(),
      connectionId,
      clientState: JSON.stringify({ tenant_id, lead_id: lead_id || null, trace_id: traceId, direction: "outbound" }),
      traceId,
    });

    if (!result.ok) {
      logError("outbound_dial_failed", { trace_id: traceId, tenant_id, provider: "telnyx", to, error: result.error, status: result.status });
      return res.status(502).json({ error: "telnyx_dial_failed", detail: result.error });
    }

    // Seed call_sessions so /calls history shows this call. Doc id = call_control_id
    // (Telnyx native); bridge will append transcript via Phase B.2 writer.
    await createOnOutboundInitiated({
      traceId, tenantId: tenant_id, from, to,
      provider: "telnyx",
      callControlId: result.call_control_id,
      leadId: lead_id || null,
    });

    res.status(202).json({ ok: true, provider: "telnyx", tenant_id, from, to, call_control_id: result.call_control_id, trace_id: traceId });
  } catch (err) {
    logError("outbound_dial_error", { trace_id: traceId, tenant_id, to, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
