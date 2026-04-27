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
