/**
 * routes/prompt.js
 *
 * Prompt management endpoints. Reads live prompt sections from Firestore
 * tenant docs and supports admin hotfixes + customer suggestions.
 *
 * Routes:
 *   GET  /prompt/:tenantId         — returns prompt sections
 *   PATCH /prompt/:tenantId        — admin hotfix: update one section
 *   POST /prompt/:tenantId/suggest — customer prompt-change request
 *
 * Sections surfaced:
 *   instructions.base
 *   knowledge_blocks.category_policies
 *   knowledge_blocks.guardrails
 */

const express = require("express");
const router = express.Router();

const { Firestore, FieldValue } = require("@google-cloud/firestore");

const TENANTS_COLLECTION = "tenants";
const SUGGESTIONS_COLLECTION = "prompt_suggestions";

const ALLOWED_SECTIONS = [
  "instructions.base",
  "knowledge_blocks.category_policies",
  "knowledge_blocks.guardrails",
];

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

// ── GET /prompt/:tenantId ────────────────────────────────────────────────────
// Returns the prompt sections from the Firestore tenant doc.
router.get("/:tenantId", async (req, res) => {
  try {
    const ref = getDb().collection(TENANTS_COLLECTION).doc(req.params.tenantId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const data = snap.data();

    res.json({
      tenant_id: req.params.tenantId,
      sections: {
        "instructions.base": data?.instructions?.base ?? null,
        "knowledge_blocks.category_policies": data?.knowledge_blocks?.category_policies ?? null,
        "knowledge_blocks.guardrails": data?.knowledge_blocks?.guardrails ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /prompt/:tenantId ──────────────────────────────────────────────────
// Admin-only hotfix: update a single prompt section in Firestore.
// Body: { section: "instructions.base" | "knowledge_blocks.guardrails" | ..., content: string }
// Note: the generic auth middleware already enforces the bearer key. This
// endpoint is additionally documented as admin-only — dashboard enforces that
// in the proxy layer.
router.patch("/:tenantId", async (req, res) => {
  try {
    const { section, content } = req.body || {};
    if (!section || !ALLOWED_SECTIONS.includes(section)) {
      return res.status(400).json({
        error: `section must be one of: ${ALLOWED_SECTIONS.join(", ")}`,
      });
    }
    if (content === undefined || typeof content !== "string") {
      return res.status(400).json({ error: "content (string) required" });
    }
    if (content.length > 100_000) {
      return res.status(400).json({ error: "content too long (max 100,000 chars)" });
    }

    const ref = getDb().collection(TENANTS_COLLECTION).doc(req.params.tenantId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // section is a dotted path like "instructions.base"
    await ref.set({ [section.split(".")[0]]: { [section.split(".")[1]]: content } }, { merge: true });

    res.json({
      tenant_id: req.params.tenantId,
      updated_section: section,
      updated_at: new Date().toISOString(),
      note: "Hotfix applied directly to Firestore. Back-port to Git within 24h.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /prompt/:tenantId/suggest ───────────────────────────────────────────
// Customer prompt-change request. Writes to prompt_suggestions collection.
// Body: { text: string, submitted_by: email }
router.post("/:tenantId/suggest", async (req, res) => {
  try {
    const { text, submitted_by } = req.body || {};
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

    const docRef = await getDb().collection(SUGGESTIONS_COLLECTION).add(doc);
    const after = await docRef.get();
    res.status(201).json({ id: docRef.id, ...after.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
