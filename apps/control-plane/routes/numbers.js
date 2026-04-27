/**
 * routes/numbers.js
 *
 * CRUD for the phone_numbers Firestore collection.
 * The collection maps E.164 numbers → tenants. Read by telephony-service on
 * every inbound call to route Telnyx webhooks to the correct tenant.
 *
 * Routes:
 *   GET    /numbers                  — list all assignments
 *   GET    /numbers/:e164            — get one
 *   POST   /numbers/:e164/assign     — write/upsert assignment doc
 *   DELETE /numbers/:e164            — remove assignment (used by rollback)
 *
 * Telnyx-side actions (re-attaching the number to a Call Control App) are
 * NOT done here — those live in scripts/ops/number-cutover.js so this route
 * stays Firestore-only and doesn't need TELNYX_API_KEY.
 */

const express = require("express");
const router = express.Router();

const { Firestore, FieldValue } = require("@google-cloud/firestore");

const COLLECTION = "phone_numbers";

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

const E164 = /^\+[1-9]\d{6,14}$/;

function validE164(s) {
  return typeof s === "string" && E164.test(s);
}

// ── GET /numbers[?tenant=<id>] ───────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    let q = getDb().collection(COLLECTION);
    if (req.query.tenant) q = q.where("tenant_id", "==", req.query.tenant);
    const snap = await q.get();
    const numbers = snap.docs.map((d) => ({ e164: d.id, ...d.data() }));
    res.json({ count: numbers.length, numbers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /numbers/:e164 ───────────────────────────────────────────────────────
router.get("/:e164", async (req, res) => {
  const e164 = req.params.e164;
  if (!validE164(e164)) return res.status(400).json({ error: `Invalid E.164: ${e164}` });
  try {
    const snap = await getDb().collection(COLLECTION).doc(e164).get();
    if (!snap.exists) return res.status(404).json({ error: `Number not assigned: ${e164}` });
    res.json({ e164, ...snap.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /numbers/:e164/assign ───────────────────────────────────────────────
// Body: { tenant_id, provider_number_id, previous_connection_id, capabilities? }
// Defaults: provider="telnyx", call_control_app_id=voice-platform-shared,
// capabilities={voice:true, sms:false, outbound:false}, status="active"
router.post("/:e164/assign", async (req, res) => {
  const e164 = req.params.e164;
  if (!validE164(e164)) return res.status(400).json({ error: `Invalid E.164: ${e164}` });

  const { tenant_id, provider_number_id, previous_connection_id, capabilities } = req.body || {};
  if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
  if (!provider_number_id) return res.status(400).json({ error: "provider_number_id required" });

  const SHARED_APP_ID = process.env.TELNYX_SHARED_APP_ID || "2946878804032751101";

  const docRef = getDb().collection(COLLECTION).doc(e164);
  const existing = await docRef.get();

  const data = {
    tenant_id,
    provider: "telnyx",
    provider_number_id,
    call_control_app_id: SHARED_APP_ID,
    capabilities: capabilities || { voice: true, sms: false, outbound: false },
    status: "active",
    assigned_at: existing.exists ? existing.data().assigned_at : FieldValue.serverTimestamp(),
    updated_at: FieldValue.serverTimestamp(),
  };
  if (previous_connection_id) data.previous_connection_id = previous_connection_id;

  await docRef.set(data, { merge: true });
  const written = await docRef.get();
  res.json({ e164, ...written.data() });
});

// ── DELETE /numbers/:e164 ────────────────────────────────────────────────────
router.delete("/:e164", async (req, res) => {
  const e164 = req.params.e164;
  if (!validE164(e164)) return res.status(400).json({ error: `Invalid E.164: ${e164}` });
  try {
    const ref = getDb().collection(COLLECTION).doc(e164);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: `Number not assigned: ${e164}` });
    await ref.delete();
    res.json({ deleted: e164 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
