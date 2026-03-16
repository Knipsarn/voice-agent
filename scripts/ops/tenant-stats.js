/**
 * ops/tenant-stats.js — Aggregate call statistics for a tenant
 * Usage: node scripts/ops/tenant-stats.js <tenantId> [--days=7] [--since=<ISO8601>]
 */
const { get, handleError } = require("./_client");

const args     = process.argv.slice(2);
const tenantId = args.find(a => !a.startsWith("--"));
const days     = (args.find(a => a.startsWith("--days="))  || "").split("=")[1] || null;
const since    = (args.find(a => a.startsWith("--since=")) || "").split("=")[1] || null;

if (!tenantId) {
  console.error("Usage: node scripts/ops/tenant-stats.js <tenantId> [--days=7] [--since=<ISO>]");
  process.exit(1);
}

const params = new URLSearchParams();
if (days)  params.set("days",  days);
if (since) params.set("since", since);
const qs = params.toString() ? `?${params}` : "";

get(`/logs/stats/${tenantId}${qs}`).then(res => {
  if (res.status >= 400) {
    console.error(`[ops] HTTP ${res.status}`);
    console.error(JSON.stringify(res.body, null, 2));
    process.exit(1);
  }
  const s = res.body;
  const durSec = s.avg_duration_ms != null ? `${(s.avg_duration_ms / 1000).toFixed(1)}s` : "—";
  const totalMin = s.total_duration_ms ? `${(s.total_duration_ms / 60000).toFixed(1)} min` : "—";
  console.log(`\n  Stats — ${s.tenant_id}  (last ${s.period.days} days)\n`);
  console.log(`  Calls          : ${s.call_count}`);
  console.log(`  Avg duration   : ${durSec}   (total: ${totalMin})`);
  console.log(`  Avg turns/call : ${s.avg_turns_user ?? "—"} user / ${s.avg_turns_agent ?? "—"} agent`);
  console.log(`  Errors         : ${s.error_count}`);
  console.log(`  Fallbacks      : ${s.fallback_count}`);
  console.log(`  Since          : ${s.period.since}\n`);
}).catch(handleError);
