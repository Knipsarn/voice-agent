import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getSettings, listTenants } from "@/lib/control-plane";
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

  const tenantId = pickTenantId(scope, searchParams);
  if (scope.admin && !tenantId) {
    const allTenants = await listTenants().catch(() => ({ tenants: [] }));
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={true} />
        <div className="max-w-3xl mx-auto px-6 py-16 space-y-4">
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

  const settings = await getSettings(tenantId).catch(() => ({ tenant_id: tenantId }));

  return (
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={scope.admin} />
      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Tenant: {tenantId}</p>
        </div>

        <SettingsForm
          tenantId={tenantId}
          initialSettings={settings}
          isAdmin={scope.admin}
        />

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
