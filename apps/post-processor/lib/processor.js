/**
 * lib/processor.js
 *
 * Orchestration: read a call_sessions doc, generate the summary, calculate
 * costs, write everything back. Idempotent — safe to re-run on same doc.
 */

const { Firestore, FieldValue } = require("@google-cloud/firestore");
const crypto = require("crypto");

const { log, logError } = require("./log");
const { summarize } = require("./summarizer");
const { calculateCallCost } = require("./costs");

const COLLECTION = "call_sessions";

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

async function processOne(callControlId, { force = false } = {}) {
  const traceId = crypto.randomUUID();
  const ref = getDb().collection(COLLECTION).doc(callControlId);
  const snap = await ref.get();
  if (!snap.exists) {
    log("processor_doc_missing", { trace_id: traceId, call_control_id: callControlId });
    return { skipped: "doc_missing" };
  }
  const data = snap.data();

  if (data.status !== "completed") {
    log("processor_skip_not_completed", { trace_id: traceId, call_control_id: callControlId, status: data.status });
    return { skipped: "not_completed" };
  }

  if (data.summary && !force) {
    log("processor_skip_already_summarized", { trace_id: traceId, call_control_id: callControlId });
    return { skipped: "already_summarized" };
  }

  log("processor_start", {
    trace_id: traceId,
    call_control_id: callControlId,
    tenant_id: data.tenant_id,
    duration_ms: data.duration_ms,
    transcript_turns: (data.transcript || []).length,
  });

  const t0 = Date.now();
  const result = await summarize(data, traceId);
  const summaryElapsed = Date.now() - t0;

  const costs = calculateCallCost({
    direction: data.direction || "inbound",
    durationMs: data.duration_ms || 0,
  });

  await ref.set(
    {
      summary: result.summary,
      summary_model: result.model,
      summary_tokens: result.tokens,
      summarized_at: FieldValue.serverTimestamp(),
      summary_elapsed_ms: summaryElapsed,
      summary_pending: false,
      costs,
    },
    { merge: true },
  );

  log("processor_done", {
    trace_id: traceId,
    call_control_id: callControlId,
    summary_elapsed_ms: summaryElapsed,
    intent: result.summary.intent,
    outcome: result.summary.outcome,
    cost_total_sek: costs.cost_total_sek,
  });

  return { ok: true, summary: result.summary, costs };
}

async function processPending({ limit = 25 } = {}) {
  // Note: requires a Firestore index if Firestore complains. The query is small
  // enough that it'll auto-create on first failed query.
  const snap = await getDb()
    .collection(COLLECTION)
    .where("status", "==", "completed")
    .where("summary_pending", "==", true)
    .limit(limit)
    .get();

  log("processor_pending_batch", { count: snap.size, limit });

  const results = [];
  for (const doc of snap.docs) {
    try {
      const r = await processOne(doc.id);
      results.push({ id: doc.id, ...r });
    } catch (err) {
      logError("processor_one_failed", { call_control_id: doc.id, error: err.message });
      results.push({ id: doc.id, error: err.message });
    }
  }
  return results;
}

module.exports = { processOne, processPending };
