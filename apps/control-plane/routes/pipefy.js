"use strict";
/**
 * routes/pipefy.js
 *
 * POST /pipefy/sync  — body: { case_id }
 *   Triggers Pipefy create/update for the given Firestore case.
 *   Returns { ok, pipefy_card_id, action } or { ok: false, skipped }.
 *
 * Used by:
 *   - post-processor enkla-juridik integration after each call
 *   - SMS inbound handler when a reply completes the contact info
 */

const express = require("express");
const router = express.Router();
const { syncPipefyForCase } = require("../lib/pipefy-sync");

router.post("/sync", async (req, res) => {
  const { case_id } = req.body || {};
  if (!case_id) return res.status(400).json({ error: "case_id required" });

  try {
    const result = await syncPipefyForCase(case_id);
    res.json(result);
  } catch (err) {
    console.error(JSON.stringify({ event: "pipefy_sync_failed", case_id, error: err.message }));
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
