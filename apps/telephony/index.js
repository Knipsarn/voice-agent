/**
 * telephony-service / index.js
 *
 * Centralized telephony gateway. Owns Telnyx webhooks for the platform.
 * Replaces n8n in the inbound call path: receives call.initiated → looks up the
 * destination number's tenant in Firestore → answers the call and starts
 * bidirectional media streaming to voice-bridge.
 *
 * Phase A scope: inbound routing only. Outbound, SMS, and number lifecycle
 * are deferred to later phases (see CLAUDE.md / project memory).
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";
process.env.BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL ||
  "https://voice-bridge-service-360579353014.europe-west1.run.app/";

const express = require("express");
const { log, logError } = require("./lib/log");

const healthRouter = require("./routes/health");
const webhookRouter = require("./routes/webhooks");
const outboundRouter = require("./routes/outbound");

const app = express();
app.disable("x-powered-by");

// Capture raw body for signature verification, parse JSON for handlers.
// The webhook route reads req.rawBody for Ed25519 verification before trusting JSON.
app.use(express.json({
  limit: "256kb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

app.use("/health", healthRouter);
app.use("/webhooks/telnyx", webhookRouter);
app.use("/v1/calls/outbound", outboundRouter);

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  logError("unhandled_error", { path: req.path, error: err.message });
  res.status(500).json({ error: "internal error" });
});

// Startup validation — fail fast if secrets aren't wired.
if (!process.env.TELNYX_API_KEY) {
  logError("startup_fatal", { reason: "TELNYX_API_KEY is not set" });
  process.exit(1);
}
if (!process.env.TELNYX_PUBLIC_KEY) {
  logError("startup_fatal", { reason: "TELNYX_PUBLIC_KEY is not set" });
  process.exit(1);
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  log("startup", {
    service: "telephony",
    port: PORT,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    bridge_url: process.env.BRIDGE_BASE_URL,
  });
});
