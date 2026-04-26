/**
 * ops/calls-list.js — list recent calls
 * Usage:
 *   node scripts/ops/calls-list.js [--tenant=<id>] [--limit=N] [--since=<ISO>] [--status=<s>] [--admin]
 *
 * --admin includes cost fields. Default view hides them (public-safe).
 */
const { get, print, handleError } = require("./_client");

function arg(name) {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(`--${name}=`.length) : null;
}
const params = new URLSearchParams();
const tenant = arg("tenant"); if (tenant) params.set("tenant", tenant);
const limit = arg("limit"); if (limit) params.set("limit", limit);
const since = arg("since"); if (since) params.set("since", since);
const status = arg("status"); if (status) params.set("status", status);
if (process.argv.includes("--admin")) params.set("include_costs", "true");

get(`/calls${params.toString() ? "?" + params.toString() : ""}`).then(print).catch(handleError);
