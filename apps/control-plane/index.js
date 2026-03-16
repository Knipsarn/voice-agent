/**
 * control-plane/index.js
 *
 * Internal control-plane API for voice platform operations.
 * Provides a safe, programmable HTTP surface for operator and AI-assisted tasks.
 *
 * Auth: Authorization: Bearer <CONTROL_PLANE_API_KEY>
 * /health is unauthenticated.
 *
 * Usage (from repo root):
 *   cd apps/control-plane && npm install
 *   GOOGLE_CLOUD_PROJECT=ldk-clean CONTROL_PLANE_API_KEY=<key> node index.js
 *
 * Or with .env:
 *   node index.js  (reads ../../config/.env automatically)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../../config/.env") });

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const express = require("express");
const tenantsRouter = require("./routes/tenants");
const logsRouter = require("./routes/logs");

const app = express();
app.use(express.json());

// ── Auth middleware ──────────────────────────────────────────────────────────
const API_KEY = process.env.CONTROL_PLANE_API_KEY;

app.use((req, res, next) => {
  if (req.path === "/health") return next();

  if (!API_KEY) {
    console.warn("[control-plane] WARNING — CONTROL_PLANE_API_KEY is not set. Running unauthenticated.");
    return next();
  }

  const auth = req.headers["authorization"];
  if (!auth || auth !== `Bearer ${API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ── Routes ───────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "control-plane", project: process.env.GOOGLE_CLOUD_PROJECT });
});

app.use("/tenants", tenantsRouter);
app.use("/logs", logsRouter);

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[control-plane] Listening on port ${PORT}`);
  console.log(`[control-plane] GCP project: ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`[control-plane] Auth: ${API_KEY ? "enabled" : "DISABLED (no CONTROL_PLANE_API_KEY set)"}`);
});
