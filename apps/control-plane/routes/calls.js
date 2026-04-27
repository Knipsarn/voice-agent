/**
 * routes/calls.js
 *
 * Read access to call_sessions (Phase B). The control-plane is the operator
 * surface — these endpoints power the ops scripts and (later) the customer
 * + admin dashboards.
 *
 * Routes:
 *   GET  /calls                      list summaries (filters: tenant, since, status, limit)
 *   GET  /calls/:call_control_id     full doc
 *   POST /calls/:call_control_id/reprocess   trigger post-processor with force=true
 *
 * Costs are returned only on the admin-detail endpoint, never in the list
 * view (which is shared with the future customer dashboard).
 */

const express = require("express");
const router = express.Router();

const { Firestore, FieldValue } = require("@google-cloud/firestore");

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

const POST_PROCESSOR_URL = process.env.POST_PROCESSOR_URL ||
  "https://post-processor-service-360579353014.europe-west1.run.app";
const POST_PROCESSOR_SECRET = process.env.POST_PROCESSOR_SECRET || "";

// Strip cost fields out of the list view by default. Admin scripts can pass
// ?include_costs=true to see them.
function publicView(doc) {
  const { costs, summary_tokens, summary_elapsed_ms, summary_model, ...rest } = doc;
  return rest;
}

// ── GET /calls ───────────────────────────────────────────────────────────────
// Strategy: query with as few index requirements as possible. Filter "since"
// client-side after fetching. This avoids needing many composite indexes.
router.get("/", async (req, res) => {
  try {
    const tenant = req.query.tenant;
    const status = req.query.status;
    const since = req.query.since;
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);
    const includeCosts = req.query.include_costs === "true";

    let q = getDb().collection("call_sessions");
    if (tenant) q = q.where("tenant_id", "==", tenant);
    if (status) q = q.where("status", "==", status);
    // Single orderBy works without composite index when only one field is filtered
    // by equality. Fetch a wider window so since-filter still returns enough rows.
    const fetchLimit = since ? Math.min(limit * 4, 500) : limit;
    q = q.orderBy("initiated_at", "desc").limit(fetchLimit);

    const snap = await q.get();
    let calls = snap.docs.map((d) => {
      const data = { call_control_id: d.id, ...d.data() };
      return includeCosts ? data : publicView(data);
    });

    if (since) {
      const sinceMs = new Date(since).getTime();
      if (!Number.isNaN(sinceMs)) {
        calls = calls.filter((c) => {
          const t = c.initiated_at;
          if (!t) return false;
          const ms = t._seconds ? t._seconds * 1000 : (t.seconds ? t.seconds * 1000 : new Date(t).getTime());
          return ms >= sinceMs;
        });
      }
    }

    calls = calls.slice(0, limit);
    res.json({ count: calls.length, calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /calls/:call_control_id ──────────────────────────────────────────────
router.get("/:cci", async (req, res) => {
  try {
    const snap = await getDb().collection("call_sessions").doc(req.params.cci).get();
    if (!snap.exists) return res.status(404).json({ error: `Not found: ${req.params.cci}` });
    res.json({ call_control_id: snap.id, ...snap.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /calls/:cci/reprocess ───────────────────────────────────────────────
// Calls the post-processor with force=true so a tweaked summarizer prompt
// can be re-run on past calls.
router.post("/:cci/reprocess", async (req, res) => {
  try {
    const headers = { "Content-Type": "application/json" };
    if (POST_PROCESSOR_SECRET) headers.Authorization = `Bearer ${POST_PROCESSOR_SECRET}`;
    const r = await fetch(`${POST_PROCESSOR_URL}/process`, {
      method: "POST",
      headers,
      body: JSON.stringify({ call_control_id: req.params.cci, force: true }),
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    res.status(r.status).json(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /calls/:cci/feedback ────────────────────────────────────────────────
// Records customer or operator feedback on a call. Stored under
// call_sessions/<cci>.feedback. Per the brief §16, feedback is captured but
// does NOT directly mutate prompts — that flows through the operator review
// process.
router.post("/:cci/feedback", async (req, res) => {
  try {
    const { rating, note, by } = req.body || {};
    const ALLOWED_RATINGS = ["good", "bad", "needs_followup", "handled", "not_relevant", null];
    if (!ALLOWED_RATINGS.includes(rating)) {
      return res.status(400).json({ error: `rating must be one of: ${ALLOWED_RATINGS.filter(Boolean).join(", ")}` });
    }
    const update = {
      feedback: {
        rating,
        note: note || null,
        by: by || null,
        at: FieldValue.serverTimestamp(),
      },
    };
    await getDb().collection("call_sessions").doc(req.params.cci).set(update, { merge: true });
    const snap = await getDb().collection("call_sessions").doc(req.params.cci).get();
    res.json({ call_control_id: req.params.cci, feedback: snap.data().feedback });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
