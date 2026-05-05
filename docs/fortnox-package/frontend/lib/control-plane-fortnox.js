/**
 * lib/control-plane-fortnox.js
 *
 * Server-side helpers that proxy Fortnox-related requests to the control-plane
 * Express backend. All functions run server-side only — never import this in
 * client components.
 *
 * INTEGRATION NOTE: In the source project this code lives inside
 * apps/dashboard/lib/control-plane.js alongside many other helpers (calls,
 * tenants, settings, etc.). If you are adding this to an existing project that
 * already has a control-plane client, merge these functions and the cpGet /
 * cpJson helpers into that file instead of importing from here.
 *
 * Required env vars (Next.js server / Edge runtime):
 *   CONTROL_PLANE_BASE_URL  — base URL of the Express control-plane service
 *                             (default shown below is project-specific; replace it)
 *   CONTROL_PLANE_API_KEY   — Bearer token for control-plane auth middleware
 */

const BASE_URL =
  process.env.CONTROL_PLANE_BASE_URL ||
  "https://control-plane-service-360579353014.europe-west1.run.app";
const API_KEY = process.env.CONTROL_PLANE_API_KEY;

// ── Low-level helpers ─────────────────────────────────────────────────────────

async function cpGet(path) {
  const headers = {};
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const res = await fetch(`${BASE_URL}${path}`, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CP ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function cpJson(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`CP ${method} ${path} → ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// ── Fortnox connection status ─────────────────────────────────────────────────

/**
 * Returns { connected: boolean, expires_at?: string, needs_refresh?: boolean }
 */
export async function getFortnoxStatus() {
  return cpGet("/fortnox/status");
}

// ── Billing / invoice ─────────────────────────────────────────────────────────

/**
 * Fetch the stored invoice record for a tenant + month (YYYY-MM).
 * Returns { tenant_id, month, status, fortnox_invoice_number?, ... }
 * status is "not_invoiced" when no record exists yet.
 */
export async function getBillingInvoice(tenantId, month) {
  return cpGet(`/billing/${encodeURIComponent(tenantId)}/${encodeURIComponent(month)}`);
}

/**
 * Roll up call_sessions + sms_sessions for the month and create a Fortnox
 * invoice. Idempotent — returns existing invoice if already created.
 *
 * Prerequisites: tenant must have fortnox_customer_number in tenant_settings.
 */
export async function createInvoice(tenantId, month) {
  return cpJson(
    "POST",
    `/billing/${encodeURIComponent(tenantId)}/${encodeURIComponent(month)}/create`,
    {}
  );
}

/**
 * Trigger Fortnox to email the invoice to the customer's address on file.
 * Invoice must already be in "created" status.
 */
export async function sendInvoice(tenantId, month) {
  return cpJson(
    "POST",
    `/billing/${encodeURIComponent(tenantId)}/${encodeURIComponent(month)}/send`,
    {}
  );
}

// ── Fortnox customers ─────────────────────────────────────────────────────────

/**
 * Returns { count: number, customers: Array<{ customer_number, name, org_number, email, city }> }
 */
export async function listFortnoxCustomers() {
  return cpGet("/billing/customers");
}

/**
 * Create a new customer in the connected Fortnox account.
 * body: { name (required), org_number?, email?, address?, zip?, city?, country_code? }
 * Returns { customer_number, name, org_number, email }
 */
export async function createFortnoxCustomer(data) {
  return cpJson("POST", "/billing/customers", data);
}
