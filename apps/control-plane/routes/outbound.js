/**
 * routes/outbound.js — proxies outbound dial requests to telephony-service.
 *
 * POST /outbound/dial  { tenant_id, to, lead_id? } → telephony-service POST /v1/calls/outbound
 */

const express = require("express");
const router = express.Router();

const TELEPHONY_URL = process.env.TELEPHONY_URL ||
  "https://telephony-service-360579353014.europe-west1.run.app";
const API_KEY = process.env.CONTROL_PLANE_API_KEY || "";

router.post("/dial", async (req, res) => {
  const { tenant_id, to, lead_id, lead_name, lead_business, lead_website, provider } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
  if (!to) return res.status(400).json({ error: "to required" });

  try {
    const r = await fetch(`${TELEPHONY_URL}/v1/calls/outbound`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        tenant_id, to,
        lead_id: lead_id || null,
        ...(provider      && { provider }),
        ...(lead_name     && { lead_name }),
        ...(lead_business && { lead_business }),
        ...(lead_website  && { lead_website }),
      }),
    });
    const body = await r.json().catch(() => ({}));
    res.status(r.status).json(body);
  } catch (err) {
    res.status(502).json({ error: "telephony unreachable", detail: err.message });
  }
});

module.exports = router;
