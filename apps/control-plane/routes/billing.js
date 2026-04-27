/**
 * routes/billing.js
 *
 * Monthly billing rollup and Fortnox invoice creation.
 *
 * Routes:
 *   GET  /billing/customers                 list Fortnox customers
 *   POST /billing/customers                 create Fortnox customer
 *   GET  /billing/:tenantId/:month          get invoice record (YYYY-MM)
 *   POST /billing/:tenantId/:month/create   roll up calls → create Fortnox invoice
 *   POST /billing/:tenantId/:month/send     send invoice via Fortnox email
 *
 * Firestore collection: billing_invoices
 *   doc id: <tenantId>_<YYYY-MM>
 *
 * Env vars:
 *   PRICE_PER_MINUTE_SEK   default 3
 *   STATIC_MONTHLY_FEE_SEK default 1000
 *   FORTNOX_CLIENT_ID / FORTNOX_CLIENT_SECRET (consumed by fortnox-tokens.js)
 */

const express = require("express");
const router = express.Router();

const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { getValidAccessToken } = require("../lib/fortnox-tokens");

const PER_MINUTE_SEK = parseFloat(process.env.PRICE_PER_MINUTE_SEK || "3");
const STATIC_MONTHLY_SEK = parseFloat(process.env.STATIC_MONTHLY_FEE_SEK || "1000");
const FORTNOX_API = "https://api.fortnox.se/3";

let db = null;
function getDb() {
  if (!db) db = new Firestore();
  return db;
}

function parseMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, mon, 1, 0, 0, 0));
  return { start, end, year, mon };
}

async function fortnoxRequest(method, path, body) {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`${FORTNOX_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Fortnox ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── GET /billing/:tenantId/:month ─────────────────────────────────────────────
router.get("/:tenantId/:month", async (req, res) => {
  const { tenantId, month } = req.params;
  if (!parseMonth(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  try {
    const snap = await getDb().collection("billing_invoices").doc(`${tenantId}_${month}`).get();
    if (!snap.exists) return res.json({ tenant_id: tenantId, month, status: "not_invoiced" });
    res.json({ tenant_id: tenantId, month, ...snap.data() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /billing/:tenantId/:month/create ─────────────────────────────────────
router.post("/:tenantId/:month/create", async (req, res) => {
  const { tenantId, month } = req.params;
  const parsed = parseMonth(month);
  if (!parsed) return res.status(400).json({ error: "month must be YYYY-MM" });

  const docId = `${tenantId}_${month}`;

  try {
    // Idempotent: if already successfully invoiced, return it
    const existing = await getDb().collection("billing_invoices").doc(docId).get();
    if (existing.exists && existing.data().status === "created") {
      return res.json({ tenant_id: tenantId, month, ...existing.data(), idempotent: true });
    }

    // Need fortnox_customer_number from tenant_settings
    const settingsSnap = await getDb().collection("tenant_settings").doc(tenantId).get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    const fortnoxCustomerNumber = settings.fortnox_customer_number;
    if (!fortnoxCustomerNumber) {
      return res.status(422).json({
        error: `No fortnox_customer_number set for tenant ${tenantId}. Add it in Settings.`,
      });
    }

    // Aggregate calls for the month
    const { start, end, year, mon } = parsed;
    const callsSnap = await getDb()
      .collection("call_sessions")
      .where("tenant_id", "==", tenantId)
      .where("initiated_at", ">=", start)
      .where("initiated_at", "<", end)
      .get();

    const calls = callsSnap.docs.map((d) => d.data());
    const totalMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
    const usageSek = parseFloat((totalMinutes * PER_MINUTE_SEK).toFixed(2));
    const totalSek = parseFloat((usageSek + STATIC_MONTHLY_SEK).toFixed(2));

    const invoiceDate = `${year}-${String(mon).padStart(2, "0")}-01`;
    // Due date = 1st of the following month
    const dueObj = new Date(Date.UTC(year, mon, 1));
    const dueDate = dueObj.toISOString().slice(0, 10);

    const invoiceBody = {
      Invoice: {
        CustomerNumber: String(fortnoxCustomerNumber),
        InvoiceDate: invoiceDate,
        DueDate: dueDate,
        YourOrderNumber: `Voice-${tenantId}-${month}`,
        Remarks: `AI Röstassistent - ${month}`,
        InvoiceRows: [
          {
            Description: "Månadsavgift AI Röstassistent",
            Price: STATIC_MONTHLY_SEK,
            DeliveredQuantity: "1",
            Unit: "st",
            VAT: 25,
          },
          {
            Description: `Samtalstid (${totalMinutes.toFixed(2)} min)`,
            Price: PER_MINUTE_SEK,
            DeliveredQuantity: totalMinutes.toFixed(2),
            Unit: "min",
            VAT: 25,
          },
        ],
      },
    };

    const fortnoxResp = await fortnoxRequest("POST", "/invoices", invoiceBody);
    const invoiceNumber = fortnoxResp.Invoice?.DocumentNumber;

    const record = {
      tenant_id: tenantId,
      month,
      status: "created",
      fortnox_invoice_number: invoiceNumber,
      fortnox_customer_number: String(fortnoxCustomerNumber),
      call_count: calls.length,
      total_minutes: parseFloat(totalMinutes.toFixed(4)),
      usage_sek: usageSek,
      static_sek: STATIC_MONTHLY_SEK,
      total_sek: totalSek,
      created_at: FieldValue.serverTimestamp(),
    };

    await getDb().collection("billing_invoices").doc(docId).set(record);
    res.json({ tenant_id: tenantId, month, ...record });
  } catch (err) {
    await getDb().collection("billing_invoices").doc(docId).set(
      { tenant_id: tenantId, month, status: "failed", error: err.message, failed_at: FieldValue.serverTimestamp() },
      { merge: true }
    ).catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /billing/:tenantId/:month/send ──────────────────────────────────────
// Triggers Fortnox to email the invoice to the customer's email on file.
router.post("/:tenantId/:month/send", async (req, res) => {
  const { tenantId, month } = req.params;
  if (!parseMonth(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
  const docId = `${tenantId}_${month}`;
  try {
    const snap = await getDb().collection("billing_invoices").doc(docId).get();
    if (!snap.exists || !snap.data().fortnox_invoice_number) {
      return res.status(404).json({ error: "Invoice not found — create it first" });
    }
    const { fortnox_invoice_number } = snap.data();
    await fortnoxRequest("GET", `/invoices/${fortnox_invoice_number}/email`);
    await getDb().collection("billing_invoices").doc(docId).set(
      { status: "sent", sent_at: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ tenant_id: tenantId, month, status: "sent", fortnox_invoice_number });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /billing/customers ────────────────────────────────────────────────────
// List all customers in the connected Fortnox account.
router.get("/customers", async (req, res) => {
  try {
    const data = await fortnoxRequest("GET", "/customers?limit=100");
    const customers = (data.Customers || []).map((c) => ({
      customer_number: c.CustomerNumber,
      name: c.Name,
      org_number: c.OrganisationNumber,
      email: c.Email,
      city: c.City,
    }));
    res.json({ count: customers.length, customers });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /billing/customers ───────────────────────────────────────────────────
// Create a new customer in Fortnox.
// body: { name, org_number?, email?, address?, zip?, city?, country_code? }
router.post("/customers", async (req, res) => {
  const { name, org_number, email, address, zip, city, country_code } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  try {
    const body = {
      Customer: {
        Name: name,
        ...(org_number && { OrganisationNumber: org_number }),
        ...(email && { Email: email }),
        ...(address && { Address1: address }),
        ...(zip && { ZipCode: zip }),
        ...(city && { City: city }),
        CountryCode: country_code || "SE",
        Currency: "SEK",
      },
    };
    const data = await fortnoxRequest("POST", "/customers", body);
    const c = data.Customer;
    res.status(201).json({
      customer_number: c.CustomerNumber,
      name: c.Name,
      org_number: c.OrganisationNumber,
      email: c.Email,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
