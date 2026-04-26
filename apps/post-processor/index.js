/**
 * post-processor / index.js
 *
 * Reads completed call_sessions docs, generates a dentist-chart-style summary
 * via a cheap LLM, calculates per-call costs, writes back. Standalone Cloud
 * Run service.
 *
 * Endpoints:
 *   GET  /health                  liveness
 *   POST /process                 body: { call_control_id, force? } → process one
 *   POST /process-pending         body: { limit? }                  → process all summary_pending
 *
 * Cloud Scheduler hits /process-pending on a minute interval.
 * Telephony can also call /process directly after each call.hangup for low-latency.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const express = require("express");
const { log, logError } = require("./lib/log");
const { processOne, processPending } = require("./lib/processor");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const SHARED_SECRET = process.env.POST_PROCESSOR_SECRET?.trim();

function authed(req, res, next) {
  if (!SHARED_SECRET) return next(); // unauth in dev
  const auth = req.header("authorization");
  if (auth === `Bearer ${SHARED_SECRET}`) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "post-processor",
    project: process.env.GOOGLE_CLOUD_PROJECT,
    has_openai_key: Boolean(process.env.OPENAI_API_KEY),
    summarizer_model: process.env.SUMMARIZER_MODEL || "gpt-4o-mini",
    auth_required: Boolean(SHARED_SECRET),
  });
});

app.post("/process", authed, async (req, res) => {
  const { call_control_id, force } = req.body || {};
  if (!call_control_id) return res.status(400).json({ error: "call_control_id required" });
  try {
    const result = await processOne(call_control_id, { force: Boolean(force) });
    res.json(result);
  } catch (err) {
    logError("process_failed", { call_control_id, error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.post("/process-pending", authed, async (req, res) => {
  const limit = Math.min(parseInt(req.body?.limit, 10) || 25, 100);
  try {
    const results = await processPending({ limit });
    res.json({ count: results.length, results });
  } catch (err) {
    logError("process_pending_failed", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

if (!process.env.OPENAI_API_KEY) {
  logError("startup_fatal", { reason: "OPENAI_API_KEY not set" });
  process.exit(1);
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  log("startup", {
    service: "post-processor",
    port: PORT,
    project: process.env.GOOGLE_CLOUD_PROJECT,
    summarizer_model: process.env.SUMMARIZER_MODEL || "gpt-4o-mini",
  });
});
