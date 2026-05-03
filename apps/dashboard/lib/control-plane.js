/**
 * lib/control-plane.js
 *
 * Server-side fetcher for control-plane endpoints. Always run server-side —
 * never expose CONTROL_PLANE_API_KEY to the client.
 */

const BASE_URL = process.env.CONTROL_PLANE_BASE_URL ||
  "https://control-plane-service-360579353014.europe-west1.run.app";
const API_KEY = process.env.CONTROL_PLANE_API_KEY;

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

export async function listCalls({ tenantId, since, status, limit = 50, includeCosts = false } = {}) {
  const params = new URLSearchParams();
  if (tenantId) params.set("tenant", tenantId);
  if (since) params.set("since", since);
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  if (includeCosts) params.set("include_costs", "true");
  return cpGet(`/calls?${params.toString()}`);
}

export async function getCall(callControlId) {
  return cpGet(`/calls/${encodeURIComponent(callControlId)}`);
}

export async function listTenants() {
  return cpGet("/tenants");
}

export async function getTenant(tenantId) {
  return cpGet(`/tenants/${encodeURIComponent(tenantId)}`);
}

export async function listNumbersForTenant(tenantId) {
  return cpGet(`/numbers?tenant=${encodeURIComponent(tenantId)}`);
}

export async function getSettings(tenantId) {
  return cpGet(`/settings/${encodeURIComponent(tenantId)}`);
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

export async function saveSettings(tenantId, partial) {
  return cpJson("POST", `/settings/${encodeURIComponent(tenantId)}`, partial);
}

export async function postFeedback(callControlId, { rating, note, by }) {
  return cpJson("POST", `/calls/${encodeURIComponent(callControlId)}/feedback`, { rating, note, by });
}

export async function getBillingInvoice(tenantId, month) {
  return cpGet(`/billing/${encodeURIComponent(tenantId)}/${encodeURIComponent(month)}`);
}

export async function createInvoice(tenantId, month) {
  return cpJson("POST", `/billing/${encodeURIComponent(tenantId)}/${encodeURIComponent(month)}/create`, {});
}

export async function sendInvoice(tenantId, month) {
  return cpJson("POST", `/billing/${encodeURIComponent(tenantId)}/${encodeURIComponent(month)}/send`, {});
}

export async function getFortnoxStatus() {
  return cpGet("/fortnox/status");
}

export async function listFortnoxCustomers() {
  return cpGet("/billing/customers");
}

export async function createFortnoxCustomer(data) {
  return cpJson("POST", "/billing/customers", data);
}

export async function listSuggestions(tenantId, { limit = 50 } = {}) {
  return cpGet(`/suggestions/${encodeURIComponent(tenantId)}?limit=${limit}`);
}

export async function createSuggestion(tenantId, { text, submitted_by, call_context }) {
  return cpJson("POST", `/suggestions/${encodeURIComponent(tenantId)}`, {
    text, submitted_by, call_context,
  });
}

export async function updateSuggestion(tenantId, id, partial) {
  return cpJson("POST", `/suggestions/${encodeURIComponent(tenantId)}/${encodeURIComponent(id)}`, partial);
}

export async function listIncidents({ status, service, since, limit = 50 } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (service) params.set("service", service);
  if (since) params.set("since", since);
  params.set("limit", String(limit));
  return cpGet(`/incidents?${params.toString()}`);
}

export async function updateIncident(id, partial) {
  return cpJson("POST", `/incidents/${encodeURIComponent(id)}`, partial);
}


export async function listCases(tenantId, { active, limit = 100 } = {}) {
  const params = new URLSearchParams();
  params.set("tenant_id", tenantId);
  if (active === true)  params.set("active", "true");
  if (active === false) params.set("active", "false");
  params.set("limit", String(limit));
  return cpGet(`/cases?${params.toString()}`);
}

export async function getCase(caseId) {
  return cpGet(`/cases/${encodeURIComponent(caseId)}`);
}

export async function listSms(tenantId, { caseId, status, limit = 50 } = {}) {
  const params = new URLSearchParams();
  params.set("tenant_id", tenantId);
  if (caseId) params.set("case_id", caseId);
  if (status) params.set("status", status);
  params.set("limit", String(limit));
  return cpGet(`/sms?${params.toString()}`);
}

export async function listVoicemails(tenantId, { limit = 50 } = {}) {
  return cpGet(`/voicemail/${encodeURIComponent(tenantId)}?limit=${limit}`);
}

export async function markVoicemailRead(id, by) {
  return cpJson("POST", `/voicemail/${encodeURIComponent(id)}/read`, { by });
}
