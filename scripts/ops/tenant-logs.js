/**
 * ops/tenant-logs.js — Fetch recent call logs for a tenant
 * Usage: node scripts/ops/tenant-logs.js <tenantId> [--limit=50] [--trace_id=<uuid>] [--since=<ISO8601>]
 */
const { get, print, handleError } = require("./_client");

const args = process.argv.slice(2);
const tenantId = args.find(a => !a.startsWith("--"));
const limit    = (args.find(a => a.startsWith("--limit="))    || "").split("=")[1] || 20;
const traceId  = (args.find(a => a.startsWith("--trace_id=")) || "").split("=")[1] || null;
const since    = (args.find(a => a.startsWith("--since="))    || "").split("=")[1] || null;

if (!tenantId) {
  console.error("Usage: node scripts/ops/tenant-logs.js <tenantId> [--limit=50] [--trace_id=<uuid>] [--since=<ISO>]");
  process.exit(1);
}

const params = new URLSearchParams({ limit });
if (traceId) params.set("trace_id", traceId);
if (since)   params.set("since", since);

get(`/logs/tenant/${tenantId}?${params}`).then(print).catch(handleError);
