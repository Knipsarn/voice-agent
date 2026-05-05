/**
 * lib/tenant-map.js
 *
 * Email → tenant mapping. MVP: hardcoded. Future: Firestore-backed
 * (tenants/<id>.authorized_emails[]).
 *
 * - Admins see all tenants and the cost/margin admin views.
 * - Non-admin emails are scoped to their single tenant.
 * - Unknown emails get no access (login fails to load any data).
 */

// Comma-separated lists from env override the defaults; defaults below match
// the founder + the two onboarded tenants.
function parseList(envVar) {
  return (envVar || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const ADMIN_EMAILS = new Set(
  parseList(process.env.DASHBOARD_ADMIN_EMAILS) ?? [],
);
if (ADMIN_EMAILS.size === 0) {
  ADMIN_EMAILS.add("nils.wahlin@snmintegrations.se");
}

// email -> tenant_id
// Format env: DASHBOARD_TENANT_EMAILS="email1=tenant1,email2=tenant2"
const TENANT_EMAILS = new Map([
  ["niels.groenewegen@enklajuridik.se", "enkla-juridik"],
]);
const raw = process.env.DASHBOARD_TENANT_EMAILS || "";
for (const entry of raw.split(",")) {
  const trimmed = entry.trim();
  if (!trimmed) continue;
  const [email, tenant] = trimmed.split("=").map((s) => s && s.trim().toLowerCase());
  if (email && tenant) TENANT_EMAILS.set(email, tenant);
}

export function isAdmin(email) {
  if (!email) return false;
  return ADMIN_EMAILS.has(email.toLowerCase());
}

export function tenantForEmail(email) {
  if (!email) return null;
  return TENANT_EMAILS.get(email.toLowerCase()) || null;
}

export function userScope(email) {
  if (isAdmin(email)) return { admin: true, tenantId: null };
  const tenantId = tenantForEmail(email);
  if (tenantId) return { admin: false, tenantId };
  return { admin: false, tenantId: null }; // no access
}

/**
 * Like userScope, but lets admins temporarily view the dashboard as a customer
 * by adding ?as=customer&tenant=<id> to the URL. Returns _impersonating: true
 * so the AppShell can show a banner with "back to admin" link.
 */
export function effectiveScope(email, searchParams) {
  const real = userScope(email);
  const wantsCustomerView = searchParams?.as === "customer";
  const targetTenant = searchParams?.tenant;
  if (real.admin && wantsCustomerView && targetTenant) {
    return { admin: false, tenantId: targetTenant, _impersonating: true };
  }
  return real;
}
