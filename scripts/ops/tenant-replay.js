/**
 * ops/tenant-replay.js — Replay a call as a readable dialogue transcript
 *
 * Usage:
 *   node scripts/ops/tenant-replay.js <tenantId> [--trace_id=<uuid>]
 *
 * If --trace_id is omitted, replays the most recent call.
 */
const { get, handleError } = require("./_client");

const args     = process.argv.slice(2);
const tenantId = args.find(a => !a.startsWith("--"));
const traceId  = (args.find(a => a.startsWith("--trace_id=")) || "").split("=")[1] || null;

if (!tenantId) {
  console.error("Usage: node scripts/ops/tenant-replay.js <tenantId> [--trace_id=<uuid>]");
  process.exit(1);
}

async function run() {
  // If no trace_id given, fetch the most recent call to get one
  let resolvedTraceId = traceId;
  if (!resolvedTraceId) {
    const callsRes = await get(`/logs/calls/${tenantId}?limit=1`);
    if (callsRes.status >= 400) {
      console.error(`[ops] HTTP ${callsRes.status}`, JSON.stringify(callsRes.body));
      process.exit(1);
    }
    const calls = callsRes.body.calls || [];
    if (!calls.length) {
      console.error(`[replay] No calls found for tenant: ${tenantId}`);
      process.exit(0);
    }
    resolvedTraceId = calls[0].trace_id;
  }

  // Fetch full log for this trace
  const logsRes = await get(`/logs/tenant/${tenantId}?trace_id=${resolvedTraceId}&limit=200`);
  if (logsRes.status >= 400) {
    console.error(`[ops] HTTP ${logsRes.status}`, JSON.stringify(logsRes.body));
    process.exit(1);
  }

  const entries = (logsRes.body.entries || []).slice().reverse(); // ascending order

  // Find call_start for t=0 reference
  const callStart = entries.find(e => e.event === "call_start");
  const callEnd   = entries.find(e => e.event === "call_end");
  const t0        = callStart ? new Date(callStart.timestamp).getTime() : null;

  function ts(entry) {
    if (!t0) return "??:??";
    const sec = Math.floor((new Date(entry.timestamp).getTime() - t0) / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  // ── Header ────────────────────────────────────────────────────────────────
  const meta = callStart?.data || {};
  const dur  = callEnd?.data?.duration_ms ? `${(callEnd.data.duration_ms / 1000).toFixed(1)}s` : "?";
  const date = callStart ? new Date(callStart.timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "?";

  console.log("");
  console.log(`  Call replay — ${tenantId}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  trace_id  : ${resolvedTraceId}`);
  console.log(`  time      : ${date}`);
  console.log(`  duration  : ${dur}`);
  console.log(`  voice     : ${meta.voice || "?"}   model: ${meta.model || "?"}`);
  console.log(`  entry     : ${meta.entry_mode || "?"}   fallback: ${meta.fallback ?? "?"}`);
  console.log(`  config sha: ${(meta.config_git_sha || "?").slice(0, 7)}`);
  console.log(`  turns     : ${callEnd?.data?.turn_count_user ?? "?"} user / ${callEnd?.data?.turn_count_assistant ?? "?"} agent`);
  console.log(`  ${"─".repeat(50)}`);
  console.log("");

  // ── Dialogue ──────────────────────────────────────────────────────────────
  const dialogue = entries.filter(e =>
    e.event === "user_transcript" || e.event === "assistant_transcript"
  );

  if (!dialogue.length) {
    console.log("  (no transcript events — call may have ended before any speech was logged)");
    console.log("");
    return;
  }

  for (const entry of dialogue) {
    const speaker = entry.event === "user_transcript" ? "KUND " : "AGENT";
    const text    = entry.data?.text || "(empty)";
    const time    = ts(entry);

    // Word-wrap at 70 chars
    const prefix  = `  [${time}] ${speaker}  `;
    const indent  = " ".repeat(prefix.length);
    const words   = text.split(" ");
    let line = prefix;
    let first = true;
    for (const word of words) {
      if (!first && line.length + word.length + 1 > 78) {
        console.log(line);
        line = indent + word;
      } else {
        line += (first ? "" : " ") + word;
        first = false;
      }
    }
    console.log(line);
    console.log("");
  }
}

run().catch(handleError);
