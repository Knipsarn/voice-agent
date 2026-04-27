/**
 * routes/settings.js
 *
 * Tenant-level RUNTIME settings managed via the dashboard. Distinct from
 * tenants/<id> which is the Git-managed agent configuration. This collection
 * holds operationally-mutable config: where to send summaries, which emails
 * have access, etc.
 *
 * Routes:
 *   GET  /settings/:tenantId       fetch settings (returns empty object if none)
 *   POST /settings/:tenantId       partial merge (body is sparse update)
 *
 * Schema:
 *   {
 *     summary_email: "operator@clinic.se",
 *     summary_email_mode: "per_call" | "daily_digest",  (default: "per_call")
 *     authorized_customer_emails: ["a@x.se", "b@x.se"],
 *     updated_at: <serverTimestamp>,
 *     updated_by: "<editor email>"
 *   }
 */

const express = require("express");
const router = express.Router();

const { Firestore, FieldValue } = require("@google-cloud/firestore");

const COLLECTION = "tenant_settings";

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

router.get("/:tenantId", async (req, res) => {
  try {
    const snap = await getDb().collection(COLLECTION).doc(req.params.tenantId).get();
    res.json(snap.exists ? { tenant_id: req.params.tenantId, ...snap.data() } : { tenant_id: req.params.tenantId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:tenantId", async (req, res) => {
  try {
    const body = req.body || {};
    // Whitelist fields to prevent arbitrary writes
    const ALLOWED = ["summary_email", "summary_email_mode", "authorized_customer_emails", "fortnox_customer_number", "first_message"];
    const update = {};
    for (const k of ALLOWED) {
      if (k in body) update[k] = body[k];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "no updatable fields in body" });
    }
    if (body.updated_by) update.updated_by = body.updated_by;
    update.updated_at = FieldValue.serverTimestamp();

    await getDb().collection(COLLECTION).doc(req.params.tenantId).set(update, { merge: true });
    const after = await getDb().collection(COLLECTION).doc(req.params.tenantId).get();
    res.json({ tenant_id: req.params.tenantId, ...after.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
