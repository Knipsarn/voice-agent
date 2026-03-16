/**
 * routes/logs.js
 *
 * Tenant log inspection via Cloud Logging API.
 *
 * Routes:
 *   GET /logs/tenant/:id          — recent log entries for a tenant
 *   GET /logs/tenant/:id/errors   — error/warning entries only
 *
 * Query params:
 *   ?limit=50     — number of entries (max 200, default 50)
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

function buildFilter(tenantId, severityMin = null) {
  const parts = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${SERVICE_NAME}"`,
    `textPayload=~"${tenantId}"`,
  ];
  if (severityMin) {
    parts.push(`severity>=${severityMin}`);
  }
  return parts.join("\n");
}

function formatEntry(entry) {
  return {
    timestamp: entry.metadata.timestamp || null,
    severity: entry.metadata.severity || "DEFAULT",
    revision: entry.metadata.resource?.labels?.revision_name || null,
    message: typeof entry.data === "string" ? entry.data : (entry.metadata.textPayload || JSON.stringify(entry.data)),
  };
}

async function fetchLogs(tenantId, { limit, severityMin } = {}) {
  const [entries] = await logging.getEntries({
    filter: buildFilter(tenantId, severityMin),
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

  const limit = parseInt(req.query.limit) || DEFAULT_LIMIT;

  try {
    const entries = await fetchLogs(tenantId, { limit });
    res.json({ tenant_id: tenantId, service: SERVICE_NAME, count: entries.length, entries });
  } catch (err) {
    console.error(`[GET /logs/tenant/${tenantId}] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /logs/tenant/:id/errors ──────────────────────────────────────────────
router.get("/tenant/:id/errors", async (req, res) => {
  const tenantId = req.params.id;
  if (!isValidTenantId(tenantId)) {
    return res.status(400).json({ error: "Invalid tenant ID format" });
  }

  const limit = parseInt(req.query.limit) || DEFAULT_LIMIT;

  try {
    const entries = await fetchLogs(tenantId, { limit, severityMin: "WARNING" });
    res.json({ tenant_id: tenantId, service: SERVICE_NAME, count: entries.length, entries });
  } catch (err) {
    console.error(`[GET /logs/tenant/${tenantId}/errors] Error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
