import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getSettings, listTenants, getFortnoxStatus, listCalls } from "@/lib/control-plane";
import { TopBar } from "../components/TopBar";
import { SettingsForm } from "../components/SettingsForm";
import { RATES } from "@/lib/pricing";

const STATIC_MONTHLY_SEK = parseFloat(process.env.STATIC_MONTHLY_FEE_SEK || "1000");

function pickTenantId(scope, searchParams) {
  if (scope.admin) return searchParams?.tenant || null;
  return scope.tenantId;
}

function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

export default async function SettingsPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) {
    return (
      <main className="min-h-screen">
        <TopBar email={session.user.email} admin={false} />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </main>
    );
  }

  const fortnoxFlash = searchParams?.fortnox;
  const fortnoxFlashMsg = searchParams?.msg;

  const tenantId = pickTenantId(scope, searchParams);

  if (scope.admin && !tenantId) {
    const allTenants = await listTenants().catch(() => ({ tenants: [] }));
    return (
      <main className="min-h-screen">
        <TopBar email={session.user.email} admin={true} />
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-4">
          {fortnoxFlash === "connected" && <Flash tone="success">Fortnox connected. Pick a tenant to manage.</Flash>}
          {fortnoxFlash === "error" && <Flash tone="danger">Fortnox: {fortnoxFlashMsg || "unknown error"}</Flash>}
          <h1 className="text-2xl font-semibold text-ink mb-3">Pick a tenant</h1>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(allTenants.tenants || []).map((t) => (
              <li key={t.tenant_id}>
                <a href={`/settings?tenant=${encodeURIComponent(t.tenant_id)}`} className="block bg-surface rounded-2xl border border-line px-5 py-4 card-hover">
                  <div className="font-semibold text-ink">{t.company_name || t.tenant_id}</div>
                  <div className="text-xs text-muted mono mt-1">{t.tenant_id}</div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  // Fetch settings + (admin) fortnox + (tenant) current month billing summary
  const monthStart = startOfMonth();
  const [settings, fortnoxStatus, monthCalls] = await Promise.all([
    getSettings(tenantId).catch(() => ({ tenant_id: tenantId })),
    scope.admin ? getFortnoxStatus().catch(() => ({ connected: false })) : null,
    !scope.admin ? listCalls({ tenantId, since: monthStart.toISOString(), limit: 200 }).catch(() => ({ calls: [] })) : null,
  ]);

  // For tenant view, compute current month total
  let monthTotal = null;
  if (!scope.admin && monthCalls) {
    const minutes = (monthCalls.calls || []).reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
    const usage = minutes * RATES.per_minute_sek;
    monthTotal = {
      minutes,
      usage,
      total: usage + STATIC_MONTHLY_SEK,
      callCount: monthCalls.calls?.length || 0,
    };
  }

  return (
    <main className="min-h-screen">
      <TopBar email={session.user.email} admin={scope.admin} tenantId={tenantId} />
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink tracking-tight">
            {scope.admin ? "Settings" : "Inställningar"}
          </h1>
          <p className="text-sm text-muted mt-1">
            {scope.admin ? `Tenant: ${tenantId}` : "Hantera ditt konto"}
          </p>
        </div>

        {fortnoxFlash === "connected" && <Flash tone="success">Fortnox kopplat.</Flash>}
        {fortnoxFlash === "error" && <Flash tone="danger">Fortnox: {fortnoxFlashMsg || "unknown error"}</Flash>}

        {/* Tenant: current month billing summary inline */}
        {!scope.admin && monthTotal && (
          <section className="bg-gradient-hero rounded-3xl border border-accent/10 p-6">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-base font-semibold text-ink">Denna månad</h2>
              <span className="text-xs text-muted">
                {new Date().toLocaleDateString("sv-SE", { year: "numeric", month: "long" })}
              </span>
            </div>
            <div className="text-4xl font-semibold mt-3 bg-gradient-accent bg-clip-text text-transparent">
              {monthTotal.total.toFixed(0)} SEK
            </div>
            <p className="text-xs text-muted mt-1">
              {STATIC_MONTHLY_SEK.toFixed(0)} SEK månadsavgift + {monthTotal.usage.toFixed(0)} SEK samtalstid
            </p>
            <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-accent/10">
              <MiniStat label="Samtal" value={monthTotal.callCount} />
              <MiniStat label="Minuter" value={monthTotal.minutes.toFixed(0)} />
              <MiniStat label="Pris/min" value={`${RATES.per_minute_sek} kr`} />
            </div>
            <p className="text-xs text-subtle mt-4">
              Faktura skickas första vardagen i nästa månad.
            </p>
          </section>
        )}

        {/* Settings form */}
        <SettingsForm
          tenantId={tenantId}
          initialSettings={settings}
          isAdmin={scope.admin}
          fortnoxConnected={!!fortnoxStatus?.connected}
        />

        {/* Admin: Fortnox connection card */}
        {scope.admin && (
          <section className="bg-surface rounded-2xl border border-line p-6 space-y-3 shadow-card">
            <h2 className="text-base font-semibold text-ink">Fortnox integration</h2>
            {fortnoxStatus?.connected ? (
              <div className="flex items-center gap-3">
                <span className="inline-block bg-emerald-100 text-emerald-700 text-xs font-semibold px-2.5 py-1 rounded-full">
                  Connected
                </span>
                <span className="text-xs text-muted">
                  Token expires {new Date(fortnoxStatus.expires_at).toLocaleString("sv-SE")}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted">
                  Run the local connect script to authorize once:
                  <span className="block mono text-xs bg-paper rounded-md px-2 py-1.5 mt-1.5">node scripts/ops/fortnox-connect.js</span>
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Flash({ tone, children }) {
  const cls = tone === "success"
    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
    : "bg-danger/5 border-danger/20 text-danger";
  return <div className={`border rounded-2xl p-4 text-sm ${cls}`}>{children}</div>;
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-subtle font-semibold">{label}</div>
      <div className="text-lg font-semibold text-ink mt-0.5">{value}</div>
    </div>
  );
}
