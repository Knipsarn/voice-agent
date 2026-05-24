"use strict";
/**
 * routes/pipefy-auto-sync.js
 *
 * POST /pipefy/auto-sync
 *   Triggered by Cloud Scheduler every 4 hours (job: pipefy-auto-sync).
 *   Finds Firestore cases that need a Pipefy card created or updated:
 *
 *   Batch A — no card yet, older than 12 h:
 *     pipefy_card_id missing/null AND last_call_at < now-12h
 *
 *   Batch B — card exists but summary was updated after last sync:
 *     pipefy_card_id exists AND pipefy_synced_at < updatedAt
 *
 *   Calls syncPipefyPartial(caseId) for each (no name+email gate).
 *   Caps at 50 cases per run.
 *
 *   Returns { synced, skipped, failed, results[] }
 *
 * Auth: same Bearer CONTROL_PLANE_API_KEY as all other routes (enforced in index.js).
 */

const express = require("express");
const router = express.Router();
const { Firestore, Timestamp } = require("@google-cloud/firestore");
const { syncPipefyPartial, verifyPipefyFields } = require("../lib/pipefy-sync");

const CAP = 50;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

// Health check — verifies all hardcoded field IDs exist in the Pipefy pipe.
// Call anytime to catch field mismatches before they cause silent failures.
router.get("/health", async (req, res) => {
  try {
    const result = await verifyPipefyFields();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Single-case partial sync — called by post-processor when a new case is created.
// Works with partial data (no name/email gate). Creates or updates the Pipefy card.
router.post("/sync-partial", async (req, res) => {
  const { case_id } = req.body || {};
  if (!case_id) return res.status(400).json({ error: "case_id required" });
  try {
    const result = await syncPipefyPartial(case_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-sync", async (req, res) => {
  const startedAt = Date.now();
  const results = [];
  let synced = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const firestore = getDb();
    const cutoff = Timestamp.fromMillis(Date.now() - TWELVE_HOURS_MS);

    // ── Batch A: no Pipefy card yet, last call > 12h ago ───────────────────
    // IMPORTANT: Firestore `== null` matches docs where the field is present and
    // null, but NOT docs where the field is entirely absent. So every case MUST be
    // created with `pipefy_card_id: null` (see post-call.js) for this query to find
    // it. Cases created before that contract was added were backfilled manually.
    // Backed by the composite index (pipefy_card_id, last_call_at).

    const batchASnap = await firestore
      .collection("cases")
      .where("pipefy_card_id", "==", null)
      .where("last_call_at", "<", cutoff)
      .limit(CAP)
      .get();

    for (const doc of batchASnap.docs) {
      if (results.length >= CAP) break;
      results.push({ case_id: doc.id, batch: "A" });
    }

    // ── Batch B: card exists, summary updated after last sync ───────────────
    // We want: pipefy_card_id != null AND updatedAt > pipefy_synced_at
    // Firestore can't compare two document fields, so we fetch candidates with
    // pipefy_card_id != null and filter in-memory.
    const remaining = CAP - results.length;
    if (remaining > 0) {
      const batchBSnap = await firestore
        .collection("cases")
        .where("pipefy_card_id", "!=", null)
        .limit(CAP) // over-fetch; in-memory filter below
        .get();

      for (const doc of batchBSnap.docs) {
        if (results.length >= CAP) break;
        const d = doc.data();
        // Skip if already queued from batch A (shouldn't happen, but guard)
        if (results.some((r) => r.case_id === doc.id)) continue;

        // Only include if updatedAt exists and is newer than pipefy_synced_at
        const updatedAt = d.updatedAt;
        const syncedAt = d.pipefy_synced_at;
        if (updatedAt && syncedAt && updatedAt.toMillis() > syncedAt.toMillis()) {
          results.push({ case_id: doc.id, batch: "B" });
        }
      }
    }

    // ── Process each candidate ──────────────────────────────────────────────
    const processed = [];
    for (const candidate of results) {
      try {
        const result = await syncPipefyPartial(candidate.case_id);
        if (result.ok) {
          synced++;
          processed.push({ ...candidate, ok: true, action: result.action, status: result.status, pipefy_card_id: result.pipefy_card_id });
        } else {
          skipped++;
          processed.push({ ...candidate, ok: false, skipped: result.skipped || result.error });
        }
      } catch (err) {
        failed++;
        console.error(JSON.stringify({ event: "pipefy_auto_sync_item_failed", case_id: candidate.case_id, error: err.message }));
        processed.push({ ...candidate, ok: false, failed: true, error: err.message });
      }
    }

    const durationMs = Date.now() - startedAt;
    console.log(JSON.stringify({ event: "pipefy_auto_sync_complete", synced, skipped, failed, total: processed.length, duration_ms: durationMs }));

    return res.json({ synced, skipped, failed, results: processed, duration_ms: durationMs });
  } catch (err) {
    console.error(JSON.stringify({ event: "pipefy_auto_sync_failed", error: err.message }));
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
