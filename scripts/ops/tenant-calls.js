/**
 * ops/tenant-calls.js — List recent calls for a tenant (call_start + call_end summaries)
 * Each entry includes trace_id which can be used with --trace_id to drill into a specific call.
 * Usage: node scripts/ops/tenant-calls.js <tenantId> [--limit=20] [--since=<ISO8601>]
 */
const { get, print, handleError } = require("./_client");

const args = process.argv.slice(2);
const tenantId = args.find(a => !a.startsWith("--"));
const limit    = (args.find(a => a.startsWith("--limit=")) || "").split("=")[1] || 20;
const since    = (args.find(a => a.startsWith("--since=")) || "").split("=")[1] || null;

if (!tenantId) {
  console.error("Usage: node scripts/ops/tenant-calls.js <tenantId> [--limit=20] [--since=<ISO>]");
  process.exit(1);
}

const params = new URLSearchParams({ limit });
if (since) params.set("since", since);

get(`/logs/calls/${tenantId}?${params}`).then(print).catch(handleError);
