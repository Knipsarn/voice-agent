import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getSettings, listTenants, getFortnoxStatus } from "@/lib/control-plane";
import { TopBar } from "../components/TopBar";
import { SettingsForm } from "../components/SettingsForm";

function pickTenantId(scope, searchParams) {
  if (scope.admin) return searchParams?.tenant || null;
  return scope.tenantId;
}

export default async function SettingsPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={false} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">No access.</div>
      </main>
    );
  }

  const fortnoxFlash = searchParams?.fortnox;
  const fortnoxFlashMsg = searchParams?.msg;

  const tenantId = pickTenantId(scope, searchParams);
  if (scope.admin && !tenantId) {
    const allTenants = await listTenants().catch(() => ({ tenants: [] }));
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={true} />
        <div className="max-w-3xl mx-auto px-6 py-16 space-y-4">
          {fortnoxFlash === "connected" && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
              Fortnox connected successfully. Pick a tenant below to manage its settings.
            </div>
          )}
          {fortnoxFlash === "error" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
              Fortnox connection failed: {fortnoxFlashMsg || "unknown error"}
            </div>
          )}
          <h1 className="text-2xl font-semibold text-ink">Pick a tenant</h1>
          <ul className="space-y-2">
            {(allTenants.tenants || []).map((t) => (
              <li key={t.tenant_id}>
                <a href={`/settings?tenant=${encodeURIComponent(t.tenant_id)}`} className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-accent">
                  <div className="font-medium text-ink">{t.company_name || t.tenant_id}</div>
                  <div className="text-xs text-gray-500 mono">{t.tenant_id}</div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  const [settings, fortnoxStatus] = await Promise.all([
    getSettings(tenantId).catch(() => ({ tenant_id: tenantId })),
    scope.admin ? getFortnoxStatus().catch(() => ({ connected: false })) : null,
  ]);

  return (
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={scope.admin} />
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Tenant: {tenantId}</p>
        </div>

        {/* Fortnox OAuth flash message */}
        {fortnoxFlash === "connected" && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm text-green-800">
            Fortnox connected successfully. You can now create invoices from the Billing page.
          </div>
        )}
        {fortnoxFlash === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
            Fortnox connection failed: {fortnoxFlashMsg || "unknown error"}
          </div>
        )}

        <SettingsForm
          tenantId={tenantId}
          initialSettings={settings}
          isAdmin={scope.admin}
          fortnoxConnected={!!fortnoxStatus?.connected}
        />

        {/* Fortnox connection card (admin only) */}
        {scope.admin && (
          <section className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
            <h2 className="text-base font-medium text-ink">Fortnox integration</h2>
            {fortnoxStatus?.connected ? (
              <div className="flex items-center gap-3">
                <span className="inline-block bg-green-100 text-green-700 text-xs font-medium px-2.5 py-1 rounded-full">
                  Connected
                </span>
                <span className="text-xs text-gray-500">
                  Token expires {new Date(fortnoxStatus.expires_at).toLocaleString("sv-SE")}
                  {fortnoxStatus.needs_refresh && " (refresh pending)"}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">
                  Connect your Fortnox account to enable automatic invoice generation on the Billing page.
                </p>
                <a
                  href={`/api/fortnox/connect?tenant=${encodeURIComponent(tenantId)}`}
                  className="inline-block bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  Connect Fortnox
                </a>
              </div>
            )}
            <p className="text-xs text-gray-400">
              Requires <span className="mono">FORTNOX_CLIENT_ID</span> and{" "}
              <span className="mono">FORTNOX_CLIENT_SECRET</span> set in Cloud Run env / Secret Manager.
            </p>
          </section>
        )}


        <section className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
          <p className="font-medium mb-1">Where do call summaries go?</p>
          <p>
            After every completed call, a structured summary is generated.
            Set the email address above to have it delivered there. (Postmark
            integration coming next sprint — emails are queued for now.)
          </p>
        </section>
      </div>
    </main>
  );
}
