"use strict";
/**
 * apps/error-agent/index.js
 *
 * Pub/Sub push handler. Decodes Cloud Logging error entries, stores raw
 * incidents in Firestore, and forwards to patch-agent (Claude) for analysis.
 *
 * No AI classification here — Claude has full code context and handles both
 * triage and fix proposal in one pass.
 */

const express = require("express");
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const PORT = process.env.PORT || 8080;
const PATCH_AGENT_URL = process.env.PATCH_AGENT_URL || "";
const COLLECTION = "incidents";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const db = new Firestore({ projectId: PROJECT });
const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "error-agent", patch_agent: PATCH_AGENT_URL || "not configured" });
});

// Pub/Sub push endpoint
app.post("/", async (req, res) => {
  const envelope = req.body;
  if (!envelope?.message) {
    console.warn("[error-agent] No message in envelope");
    return res.status(204).end();
  }

  let logEntry = null;
  try {
    const raw = Buffer.from(envelope.message.data || "", "base64").toString("utf-8");
    logEntry = JSON.parse(raw);
  } catch (err) {
    console.error("[error-agent] Failed to decode log entry:", err.message);
    return res.status(204).end();
  }

  const severity = (logEntry.severity || "DEFAULT").toUpperCase();
  if (!["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity)) {
    return res.status(204).end();
  }

  const incident = buildIncident(logEntry);

  let incidentId = null;
  try {
    const ref = await db.collection(COLLECTION).add(incident);
    incidentId = ref.id;
    console.log(`[error-agent] stored incident ${incidentId} (${severity}, ${incident.service})`);
  } catch (err) {
    console.error("[error-agent] Failed to store incident:", err.message);
  }

  // Always forward to patch-agent — Claude does the triage + fix in one pass
  if (incidentId && PATCH_AGENT_URL) {
    fetch(`${PATCH_AGENT_URL}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incidentId }),
    }).catch((err) => console.warn(`[error-agent] patch-agent trigger failed: ${err.message}`));
  }

  res.status(204).end();
});

function buildIncident(logEntry) {
  const service = logEntry.resource?.labels?.service_name || "unknown";
  const revision = logEntry.resource?.labels?.revision_name || null;
  const timestamp = logEntry.timestamp || new Date().toISOString();

  let message = "";
  if (typeof logEntry.textPayload === "string") {
    message = logEntry.textPayload;
  } else if (logEntry.jsonPayload) {
    message = logEntry.jsonPayload.message || JSON.stringify(logEntry.jsonPayload).slice(0, 2000);
  } else if (logEntry.protoPayload?.status?.message) {
    message = logEntry.protoPayload.status.message;
  }

  return {
    timestamp,
    severity: logEntry.severity,
    service,
    revision,
    message: message.slice(0, 5000),
    trace_id: logEntry.jsonPayload?.trace_id || logEntry.labels?.trace_id || null,
    tenant_id: logEntry.jsonPayload?.tenant_id || logEntry.labels?.tenant_id || null,
    log_trace: logEntry.trace || null,
    log_insert_id: logEntry.insertId || null,
    raw_event: stripBigFields(logEntry.jsonPayload || {}),
    created_at: FieldValue.serverTimestamp(),
    status: "new",
  };
}

function stripBigFields(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 1000) out[k] = v.slice(0, 1000) + "…[truncated]";
    else if (v && typeof v === "object") out[k] = JSON.stringify(v).slice(0, 1000);
    else out[k] = v;
  }
  return out;
}

app.listen(PORT, () => {
  console.log(`[error-agent] listening on port ${PORT}`);
  console.log(`[error-agent] patch-agent: ${PATCH_AGENT_URL || "NOT CONFIGURED — errors stored only"}`);
});
