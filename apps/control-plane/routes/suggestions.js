/**
 * routes/suggestions.js
 *
 * Tenant-submitted prompt/agent improvement suggestions. Acts as a feedback
 * channel: tenants type "Aila ska fråga om X före Y" → admin reviews →
 * admin applies changes via existing Git/publish flow.
 *
 * Routes:
 *   GET  /suggestions/:tenantId        list suggestions for a tenant
 *   POST /suggestions/:tenantId        create new suggestion
 *   POST /suggestions/:tenantId/:id    update status / admin response
 *
 * Schema:
 *   {
 *     id: <auto>,
 *     tenant_id: string,
 *     text: string,                    // the suggestion content
 *     submitted_by: email,
 *     submitted_at: serverTimestamp,
 *     call_context?: {                 // present if submitted from a call detail page
 *       call_control_id, from_number, initiated_at, summary
 *     },
 *     status: "new" | "reviewed" | "applied" | "rejected",
 *     admin_response?: string,
 *     admin_responded_by?: email,
 *     admin_responded_at?: serverTimestamp,
 *   }
 */

const express = require("express");
const router = express.Router();

const { Firestore, FieldValue } = require("@google-cloud/firestore");

const COLLECTION = "prompt_suggestions";
const ALLOWED_STATUSES = ["new", "reviewed", "applied", "rejected"];

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

router.get("/:tenantId", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    // No orderBy in the query → no composite index required.
    // Sort client-side after fetch (50 items is fine).
    const snap = await getDb()
      .collection(COLLECTION)
      .where("tenant_id", "==", req.params.tenantId)
      .limit(limit * 2)
      .get();
    const suggestions = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.submitted_at?._seconds || a.submitted_at?.seconds || 0;
        const tb = b.submitted_at?._seconds || b.submitted_at?.seconds || 0;
        return tb - ta;
      })
      .slice(0, limit);
    res.json({ count: suggestions.length, suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:tenantId", async (req, res) => {
  try {
    const { text, submitted_by, call_context } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text required" });
    }
    if (text.length > 4000) {
      return res.status(400).json({ error: "text too long (max 4000 chars)" });
    }

    const doc = {
      tenant_id: req.params.tenantId,
      text: text.trim(),
      submitted_by: submitted_by || null,
      submitted_at: FieldValue.serverTimestamp(),
      status: "new",
    };
    if (call_context && typeof call_context === "object") {
      doc.call_context = call_context;
    }

    const ref = await getDb().collection(COLLECTION).add(doc);
    const after = await ref.get();
    res.status(201).json({ id: ref.id, ...after.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:tenantId/:id", async (req, res) => {
  try {
    const { status, admin_response, admin_responded_by } = req.body || {};
    const update = {};
    if (status !== undefined) {
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}` });
      }
      update.status = status;
    }
    if (admin_response !== undefined) update.admin_response = admin_response;
    if (admin_responded_by !== undefined) update.admin_responded_by = admin_responded_by;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "no updatable fields" });
    }
    update.admin_responded_at = FieldValue.serverTimestamp();

    const ref = getDb().collection(COLLECTION).doc(req.params.id);
    const existing = await ref.get();
    if (!existing.exists) return res.status(404).json({ error: "Not found" });
    if (existing.data().tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: "tenant mismatch" });
    }

    await ref.set(update, { merge: true });
    const after = await ref.get();
    res.json({ id: ref.id, ...after.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
