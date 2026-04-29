"use strict";
/**
 * routes/voicemail.js
 *
 * Receives voicemail data pushed from n8n after Telnyx records a voicemail.
 * Stores in Firestore voicemails/<auto-id> and surfaces in dashboard.
 *
 * n8n CURL:
 *   POST /voicemail
 *   Authorization: Bearer <CONTROL_PLANE_API_KEY>
 *   Content-Type: application/json
 *   {
 *     "tenant_id": "enkla-juridik",
 *     "caller": "+46701234567",
 *     "duration_seconds": 45,
 *     "transcript": "Hej, jag ville fråga om...",
 *     "recording_url": "https://storage.googleapis.com/...",
 *     "timestamp": "2026-04-29T10:00:00Z"   // optional, defaults to now
 *   }
 *
 * Routes:
 *   POST /voicemail            create voicemail from n8n
 *   GET  /voicemail/:tenantId  list voicemails for a tenant (dashboard)
 *   POST /voicemail/:id/read   mark as read
 */

const express = require("express");
const router = express.Router();
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const COLLECTION = "voicemails";

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

// POST /voicemail — called by n8n
router.post("/", async (req, res) => {
  const { tenant_id, caller, duration_seconds, transcript, recording_url, timestamp } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
  if (!caller) return res.status(400).json({ error: "caller required" });

  try {
    const doc = {
      tenant_id,
      caller,
      duration_seconds: duration_seconds || null,
      transcript: transcript || null,
      recording_url: recording_url || null,
      timestamp: timestamp || new Date().toISOString(),
      created_at: FieldValue.serverTimestamp(),
      read: false,
    };
    const ref = await getDb().collection(COLLECTION).add(doc);
    console.log(`[voicemail] stored ${ref.id} for tenant ${tenant_id} from ${caller}`);
    res.status(201).json({ id: ref.id, ...doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /voicemail/:tenantId — dashboard list
router.get("/:tenantId", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const snap = await getDb()
      .collection(COLLECTION)
      .where("tenant_id", "==", req.params.tenantId)
      .limit(limit)
      .get();

    const voicemails = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({ voicemails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /voicemail/:id/read — mark as read
router.post("/:id/read", async (req, res) => {
  try {
    await getDb().collection(COLLECTION).doc(req.params.id).update({
      read: true,
      read_at: FieldValue.serverTimestamp(),
      read_by: req.body?.by || null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
