/**
 * routes/fortnox-auth.js
 *
 * Fortnox OAuth connection management endpoints.
 *
 * Routes:
 *   GET  /fortnox/status    is the platform connected to Fortnox?
 *   POST /fortnox/exchange  exchange authorization code for tokens (called from dashboard callback)
 */

const express = require("express");
const router = express.Router();

const { exchangeCode, getStoredTokens } = require("../lib/fortnox-tokens");

router.get("/status", async (req, res) => {
  try {
    const tokens = await getStoredTokens();
    if (!tokens) return res.json({ connected: false });
    res.json({
      connected: true,
      expires_at: new Date(tokens.expires_at).toISOString(),
      needs_refresh: tokens.expires_at < Date.now() + 120000,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/exchange", async (req, res) => {
  const { code, redirect_uri } = req.body || {};
  if (!code || !redirect_uri) {
    return res.status(400).json({ error: "code and redirect_uri required" });
  }
  try {
    const tokens = await exchangeCode(code, redirect_uri);
    res.json({ connected: true, expires_at: new Date(tokens.expires_at).toISOString() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
