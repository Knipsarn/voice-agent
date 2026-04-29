/**
 * apps/error-agent/index.js
 *
 * Cloud Run service that receives Pub/Sub push messages containing error
 * log entries from voice-platform services. For each error:
 *   1. Decodes the log entry
 *   2. Sends to GPT-4o-mini for classification + suggested fix
 *   3. Stores in Firestore incidents/<auto-id>
 *
 * Designed to be cheap (~$0.0001 per error) and resilient (best-effort
 * AI classification — if it fails, the raw incident is still stored).
 *
 * Triggered by Pub/Sub push subscription on topic `voice-platform-errors`.
 * Cloud Run pull-style: POST / with Pub/Sub envelope as body.
 */

const express = require("express");
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || "gpt-5.2";
const PATCH_AGENT_URL = process.env.PATCH_AGENT_URL || "";
const COLLECTION = "incidents";
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";

const db = new Firestore({ projectId: PROJECT });
const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "error-agent" });
});

// Pub/Sub push endpoint
app.post("/", async (req, res) => {
  // Pub/Sub push envelope: { message: { data: base64, attributes, ... }, subscription }
  const envelope = req.body;
  if (!envelope?.message) {
    console.warn("[error-agent] No message in envelope");
    return res.status(204).end(); // ack to avoid retries
  }

  let logEntry = null;
  try {
    const raw = Buffer.from(envelope.message.data || "", "base64").toString("utf-8");
    logEntry = JSON.parse(raw);
  } catch (err) {
    console.error("[error-agent] Failed to decode log entry:", err.message);
    return res.status(204).end();
  }

  // Filter: only treat ERROR severity or higher as incidents
  const severity = (logEntry.severity || "DEFAULT").toUpperCase();
  if (!["ERROR", "CRITICAL", "ALERT", "EMERGENCY"].includes(severity)) {
    return res.status(204).end();
  }

  const incident = await buildIncident(logEntry);

  let incidentId = null;
  try {
    const ref = await db.collection(COLLECTION).add(incident);
    incidentId = ref.id;
    console.log(`[error-agent] stored incident ${incidentId} (severity=${severity}, service=${incident.service})`);
  } catch (err) {
    console.error("[error-agent] Failed to store incident:", err.message);
  }

  // Fire patch-agent asynchronously for actionable incidents (don't await)
  if (incidentId && incident.ai?.is_actionable && PATCH_AGENT_URL) {
    fetch(`${PATCH_AGENT_URL}/patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incident_id: incidentId }),
    }).catch((err) => console.warn(`[error-agent] patch-agent trigger failed: ${err.message}`));
  }

  res.status(204).end();
});

async function buildIncident(logEntry) {
  const service = logEntry.resource?.labels?.service_name || "unknown";
  const revision = logEntry.resource?.labels?.revision_name || null;
  const trace = logEntry.trace || null;
  const insertId = logEntry.insertId || null;
  const timestamp = logEntry.timestamp || new Date().toISOString();

  // Extract the error message — Cloud Run logs come in different shapes
  let message = "";
  if (typeof logEntry.textPayload === "string") {
    message = logEntry.textPayload;
  } else if (logEntry.jsonPayload) {
    message = logEntry.jsonPayload.message
      || JSON.stringify(logEntry.jsonPayload).slice(0, 2000);
  } else if (logEntry.protoPayload?.status?.message) {
    message = logEntry.protoPayload.status.message;
  }

  const traceId = logEntry.jsonPayload?.trace_id
    || logEntry.labels?.trace_id
    || null;
  const tenantId = logEntry.jsonPayload?.tenant_id
    || logEntry.labels?.tenant_id
    || null;

  const incident = {
    timestamp,
    severity: logEntry.severity,
    service,
    revision,
    message: message.slice(0, 5000),
    trace_id: traceId,
    tenant_id: tenantId,
    log_trace: trace,
    log_insert_id: insertId,
    raw_event: stripBigFields(logEntry.jsonPayload || {}),
    created_at: FieldValue.serverTimestamp(),
    status: "new",
  };

  // Best-effort AI classification
  if (OPENAI_API_KEY) {
    try {
      const ai = await classifyWithAI(message, service, logEntry);
      if (ai) Object.assign(incident, { ai });
    } catch (err) {
      console.warn(`[error-agent] AI classification failed: ${err.message}`);
    }
  }

  return incident;
}

function stripBigFields(obj) {
  const out = {};
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 1000) {
      out[k] = v.slice(0, 1000) + "…[truncated]";
    } else if (v && typeof v === "object") {
      out[k] = JSON.stringify(v).slice(0, 1000);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function classifyWithAI(message, service, logEntry) {
  const prompt = [
    `You are an error triage assistant for a multitenant AI voice platform.`,
    `Service: ${service}`,
    `Severity: ${logEntry.severity}`,
    `Error: ${message.slice(0, 2000)}`,
    ``,
    `Return STRICT JSON with fields:`,
    `  category: one of [auth, network, openai_api, telnyx_api, firestore, config, application, infra, unknown]`,
    `  summary: one sentence describing what's wrong`,
    `  likely_cause: short hypothesis`,
    `  suggested_fix: concrete next step`,
    `  is_actionable: true if a developer needs to act, false if transient/expected`,
  ].join("\n");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CLASSIFY_MODEL,
      messages: [
        { role: "system", content: "Reply with valid JSON only. No prose." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 300,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return {
      category: parsed.category || "unknown",
      summary: parsed.summary || null,
      likely_cause: parsed.likely_cause || null,
      suggested_fix: parsed.suggested_fix || null,
      is_actionable: parsed.is_actionable === true,
      classified_by: CLASSIFY_MODEL,
      classified_at: new Date().toISOString(),
    };
  } catch (err) {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`[error-agent] listening on port ${PORT}`);
  console.log(`[error-agent] AI classification: ${OPENAI_API_KEY ? "ENABLED" : "DISABLED (no OPENAI_API_KEY)"}`);
});
