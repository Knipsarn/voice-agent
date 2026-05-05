/**
 * routes/incidents.js
 *
 * Read access to incidents (errors classified by error-agent).
 *
 * Routes:
 *   GET  /incidents                  list recent incidents (filters: status, service, severity, since)
 *   POST /incidents/:id              update status / acknowledge
 */

const express = require("express");
const router = express.Router();
const { Firestore, FieldValue } = require("@google-cloud/firestore");

const COLLECTION = "incidents";
const ALLOWED_STATUSES = ["new", "acknowledged", "resolved", "ignored", "auto_deployed", "patch_proposed", "investigated", "investigating"];

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const status = req.query.status;
    const service = req.query.service;
    const since = req.query.since;

    // Avoid composite-index requirements: pull a wider window then filter client-side
    let q = getDb().collection(COLLECTION).orderBy("created_at", "desc").limit(limit * 4);
    const snap = await q.get();

    let incidents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (status) incidents = incidents.filter((i) => i.status === status);
    if (service) incidents = incidents.filter((i) => i.service === service);
    if (since) {
      const sinceMs = new Date(since).getTime();
      if (!Number.isNaN(sinceMs)) {
        incidents = incidents.filter((i) => {
          const t = i.created_at;
          if (!t) return false;
          const ms = t._seconds ? t._seconds * 1000 : (t.seconds ? t.seconds * 1000 : new Date(t).getTime());
          return ms >= sinceMs;
        });
      }
    }

    incidents = incidents.slice(0, limit);
    res.json({ count: incidents.length, incidents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id", async (req, res) => {
  try {
    const { status, note, by } = req.body || {};
    const update = {};
    if (status) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
      }
      update.status = status;
    }
    if (note !== undefined) update.note = note;
    if (by) update.acknowledged_by = by;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "no updatable fields" });
    }
    update.updated_at = FieldValue.serverTimestamp();

    const ref = getDb().collection(COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: "Not found" });

    await ref.set(update, { merge: true });
    const after = await ref.get();
    res.json({ id: ref.id, ...after.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
