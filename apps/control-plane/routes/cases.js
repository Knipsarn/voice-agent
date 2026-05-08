"use strict";
/**
 * routes/cases.js
 *
 * Replaces the n8n DataTable (Enkla_juridik) with Firestore-backed case storage.
 * Stores per-tenant case records: classification, summary, status, Pipefy sync state.
 *
 * Endpoints:
 *   GET  /cases              ?tenant_id=X [&customer_id=Y] [&phone=Z] [&active=true] [&limit=N]
 *   GET  /cases/:id          Get single case by Firestore doc ID
 *   POST /cases              Create new case
 *   PATCH /cases/:id         Update case fields (merge)
 */

const express = require("express");
const router = express.Router();
const { Firestore, FieldValue } = require("@google-cloud/firestore");

let db = null;
function getDb() {
  if (!db) db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || "ldk-clean" });
  return db;
}

const COLLECTION = "cases";

// ── GET /cases ────────────────────────────────────────────────────────────────
// Query params: tenant_id (required), customer_id, phone, active, limit
router.get("/", async (req, res) => {
  const { tenant_id, customer_id, phone, active, limit = "10" } = req.query;
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    let q = getDb().collection(COLLECTION).where("tenant_id", "==", tenant_id);

    if (customer_id) q = q.where("customer_id", "==", customer_id);
    if (phone)       q = q.where("phone", "==", phone);
    if (active === "true")  q = q.where("active", "==", true);
    if (active === "false") q = q.where("active", "==", false);

    q = q.limit(Math.min(Number(limit) || 10, 100));

    const snap = await q.get();
    const cases = snap.docs.map((d) => serializeDoc(d));
    res.json({ cases });
  } catch (err) {
    // Firestore may require a composite index on first run — surface the error clearly
    res.status(500).json({ error: err.message, hint: "May need a Firestore composite index — check GCP console link in error" });
  }
});

// ── GET /cases/:id ────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const snap = await getDb().collection(COLLECTION).doc(req.params.id).get();
    if (!snap.exists) return res.status(404).json({ error: "Case not found" });
    res.json(serializeDoc(snap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /cases ───────────────────────────────────────────────────────────────
// Create a new case row. Returns { id, ...fields }
router.post("/", async (req, res) => {
  const body = req.body || {};
  if (!body.tenant_id) return res.status(400).json({ error: "tenant_id required" });

  try {
    const now = FieldValue.serverTimestamp();
    const payload = {
      ...sanitize(body),
      createdAt: now,
      updatedAt: now,
    };
    const ref = await getDb().collection(COLLECTION).add(payload);
    const snap = await ref.get();
    res.status(201).json(serializeDoc(snap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /cases/:id ──────────────────────────────────────────────────────────
// Merge-update a case. Returns updated { id, ...fields }
router.patch("/:id", async (req, res) => {
  const body = req.body || {};
  try {
    const ref = getDb().collection(COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: "Case not found" });

    await ref.set({ ...sanitize(body), updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    const updated = await ref.get();
    res.json(serializeDoc(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const ref = getDb().collection(COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: "Case not found" });
    await ref.delete();
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function serializeDoc(snap) {
  const data = snap.data() || {};
  return {
    id: snap.id,
    ...data,
    // Convert Firestore Timestamps to ISO strings so n8n JSON handles them cleanly
    createdAt: data.createdAt?._seconds ? new Date(data.createdAt._seconds * 1000).toISOString() : (data.createdAt || null),
    updatedAt: data.updatedAt?._seconds ? new Date(data.updatedAt._seconds * 1000).toISOString() : (data.updatedAt || null),
    last_reminder: data.last_reminder?._seconds ? new Date(data.last_reminder._seconds * 1000).toISOString() : (data.last_reminder || null),
    last_inbound_sms_at: data.last_inbound_sms_at?._seconds ? new Date(data.last_inbound_sms_at._seconds * 1000).toISOString() : (data.last_inbound_sms_at || null),
    email_request_sent_at: data.email_request_sent_at?._seconds ? new Date(data.email_request_sent_at._seconds * 1000).toISOString() : (data.email_request_sent_at || null),
  };
}

// Strip undefined values; Firestore rejects them
function sanitize(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

module.exports = router;
