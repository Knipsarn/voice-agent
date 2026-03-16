/**
 * routes/logs.js
 *
 * Tenant log inspection via Cloud Logging API.
 * Queries jsonPayload fields produced by structured bridge logging.
 *
 * Routes:
 *   GET /logs/tenant/:id          — recent log entries for a tenant
 *   GET /logs/tenant/:id/errors   — error/warning entries only
 *   GET /logs/calls/:tenantId     — call-level summary (call_start + call_end events only)
 *
 * Query params:
 *   ?limit=50             — number of entries (max 200, default 50)
 *   ?trace_id=<uuid>      — filter to a single call trace
 *   ?since=<ISO8601>      — only entries after this timestamp (e.g. 2026-03-16T00:00:00Z)
 */

const express = require("express");
const router = express.Router();
const { Logging } = require("@google-cloud/logging");

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean";
const SERVICE_NAME = process.env.VOICE_BRIDGE_SERVICE_NAME || "voice-bridge-service";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const logging = new Logging({ projectId: PROJECT_ID });

// Tenant IDs must be alphanumeric + hyphens/underscores only — prevents log filter injection
function isValidTenantId(id) {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

// UUID v4 format check — prevents trace_id injection
function isValidUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function buildFilter(tenantId, { severityMin, traceId, since } = {}) {
  const parts = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `jsonPayload.tenant_id="${tenantId}"`,
  ];
  if (traceId)    parts.push(`jsonPayload.trace_id="${traceId}"`);
  if (since)      parts.push(`timestamp>="${since}"`);
  if (severityMin) parts.push(`severity>=${severityMin}`);
  return parts.join("\n");
}

function formatEntry(entry) {
  const data = entry.data && typeof entry.data === "object" ? entry.data : null;
  return {
    timestamp: entry.metadata.timestamp || null,
    severity: entry.metadata.severity || "DEFAULT",
    revision: entry.metadata.resource?.labels?.revision_name || null,
    // Structured fields from jsonPayload
    event:      data?.event      || null,
    trace_id:   data?.trace_id   || null,
    tenant_id:  data?.tenant_id  || null,
    // Include all other jsonPayload fields except the ones already extracted
    data: data ? (() => {
      const { event, trace_id, tenant_id, severity, ...rest } = data;
      return Object.keys(rest).length ? rest : undefined;
    })() : undefined,
    // Fallback for old-style text logs
    message: !data ? (typeof entry.data === "string" ? entry.data : entry.metadata.textPayload || null) : undefined,
  };
}

async function fetchLogs(tenantId, { limit, severityMin, traceId, since } = {}) {
  const [entries] = await logging.getEntries({
    filter: buildFilter(tenantId, { severityMin, traceId, since }),
    orderBy: "timestamp desc",
    pageSize: Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT),
  });
  return entries.map(formatEntry);
}

// ── GET /logs/tenant/:id ─────────────────────────────────────────────────────
router.get("/tenant/:id", async (req, res) => {
  const tenantId = req.params.id;
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ error: "Invalid tenant ID format" });
  }

  const limit    = parseInt(req.query.limit) || DEFAULT_LIMIT;
  const traceId  = req.query.trace_id || null;
  const since    = req.query.since || null;

  if (traceId && !isValidUuid(traceId)) {
    return res.status(400).json({ error: "Invalid trace_id format" });
  }

  try {
    const entries = await fetchLogs(tenantId, { limit, traceId, since });
    res.json({ tenant_id: tenantId, service: SERVICE_NAME, count: entries.length, entries });
  } catch (err) {
    console.error(JSON.stringify({ event: "logs_error", route: `/logs/tenant/${tenantId}`, error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── GET /logs/tenant/:id/errors ──────────────────────────────────────────────
router.get("/tenant/:id/errors", async (req, res) => {
  const tenantId = req.params.id;
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ error: "Invalid tenant ID format" });
  }

  const limit   = parseInt(req.query.limit) || DEFAULT_LIMIT;
  const traceId = req.query.trace_id || null;
  const since   = req.query.since || null;

  if (traceId && !isValidUuid(traceId)) {
    return res.status(400).json({ error: "Invalid trace_id format" });
  }

  try {
    const entries = await fetchLogs(tenantId, { limit, severityMin: "WARNING", traceId, since });
    res.json({ tenant_id: tenantId, service: SERVICE_NAME, count: entries.length, entries });
  } catch (err) {
    console.error(JSON.stringify({ event: "logs_error", route: `/logs/tenant/${tenantId}/errors`, error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── GET /logs/calls/:id — call-level summaries ───────────────────────────────
// Returns one entry per call: call_start + call_end events only.
// Useful for getting a list of recent calls with trace_ids to drill into.
router.get("/calls/:id", async (req, res) => {
  const tenantId = req.params.id;
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ error: "Invalid tenant ID format" });
  }

  const limit = parseInt(req.query.limit) || 20;
  const since = req.query.since || null;

  // Filter to only call_start and call_end events for a lightweight call list
  const parts = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `jsonPayload.tenant_id="${tenantId}"`,
    `(jsonPayload.event="call_start" OR jsonPayload.event="call_end")`,
  ];
  if (since) parts.push(`timestamp>="${since}"`);
  const filter = parts.join("\n");

  try {
    const [entries] = await logging.getEntries({
      filter,
      orderBy: "timestamp desc",
      pageSize: Math.min(limit, MAX_LIMIT),
    });
    const calls = entries.map(formatEntry);
    res.json({ tenant_id: tenantId, service: SERVICE_NAME, count: calls.length, calls });
  } catch (err) {
    console.error(JSON.stringify({ event: "logs_error", route: `/logs/calls/${tenantId}`, error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

// ── GET /logs/stats/:id — aggregate call statistics ──────────────────────────
// Aggregates call_end events to produce call volume, duration, turn, error stats.
// Query params:
//   ?days=7      — look back N days (default 7, max 30)
//   ?since=<ISO> — explicit lower bound (overrides ?days)
router.get("/stats/:id", async (req, res) => {
  const tenantId = req.params.id;
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ error: "Invalid tenant ID format" });
  }

  const days  = Math.min(parseInt(req.query.days) || 7, 30);
  const since = req.query.since || new Date(Date.now() - days * 86400 * 1000).toISOString();

  try {
    // Fetch call_end events (carry duration + turn counts)
    const endFilter = [
      `resource.type="cloud_run_revision"`,
      `resource.labels.service_name="${SERVICE_NAME}"`,
      `jsonPayload.tenant_id="${tenantId}"`,
      `jsonPayload.event="call_end"`,
      `timestamp>="${since}"`,
    ].join("\n");

    // Fetch error events separately
    const errFilter = [
      `resource.type="cloud_run_revision"`,
      `resource.labels.service_name="${SERVICE_NAME}"`,
      `jsonPayload.tenant_id="${tenantId}"`,
      `severity>=WARNING`,
      `timestamp>="${since}"`,
    ].join("\n");

    const [[endEntries], [errEntries]] = await Promise.all([
      logging.getEntries({ filter: endFilter, orderBy: "timestamp desc", pageSize: MAX_LIMIT }),
      logging.getEntries({ filter: errFilter, orderBy: "timestamp desc", pageSize: MAX_LIMIT }),
    ]);

    const calls = endEntries.map(e => e.data && typeof e.data === "object" ? e.data : {});

    const call_count       = calls.length;
    const durations        = calls.map(c => c.duration_ms).filter(Number.isFinite);
    const avg_duration_ms  = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const total_duration_ms= durations.reduce((a, b) => a + b, 0);
    const avg_turns_user   = calls.length ? +(calls.reduce((a, c) => a + (c.turn_count_user || 0), 0) / calls.length).toFixed(1) : null;
    const avg_turns_agent  = calls.length ? +(calls.reduce((a, c) => a + (c.turn_count_assistant || 0), 0) / calls.length).toFixed(1) : null;
    const fallback_count   = calls.filter(c => c.fallback).length;
    const error_count      = errEntries.length;

    res.json({
      tenant_id: tenantId,
      service: SERVICE_NAME,
      period: { since, days },
      call_count,
      avg_duration_ms,
      total_duration_ms,
      avg_turns_user,
      avg_turns_agent,
      fallback_count,
      error_count,
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "logs_error", route: `/logs/stats/${tenantId}`, error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
