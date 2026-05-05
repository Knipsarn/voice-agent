import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { getSettings, getFortnoxStatus, getTenant, listCalls } from "@/lib/control-plane";
import { AppShell } from "../components/AppShell";
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
  const scope = effectiveScope(session.user.email, searchParams);
  if (!scope.admin && !scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </AppShell>
    );
  }

  const fortnoxFlash = searchParams?.fortnox;
  const fortnoxFlashMsg = searchParams?.msg;

  const tenantId = pickTenantId(scope, searchParams);
  if (scope.admin && !tenantId) {
    redirect("/admin");
  }

  const monthStart = startOfMonth();
  const [settings, fortnoxStatus, tenantDoc, monthCalls] = await Promise.all([
    getSettings(tenantId).catch(() => ({ tenant_id: tenantId })),
    scope.admin ? getFortnoxStatus().catch(() => ({ connected: false })) : null,
    getTenant(tenantId).catch(() => null),
    !scope.admin ? listCalls({ tenantId, since: monthStart.toISOString(), limit: 500 }).catch(() => ({ calls: [] })) : null,
  ]);

  const tenantName = tenantDoc?.company_name || tenantId;

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
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName} impersonating={scope._impersonating}>
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-6">
        <header className="mb-2">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">{scope.admin ? "Settings" : "Inställningar"}</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">{tenantName}</h1>
        </header>

        {fortnoxFlash === "connected" && <Flash tone="success">Fortnox kopplat.</Flash>}
        {fortnoxFlash === "error" && <Flash tone="danger">Fortnox: {fortnoxFlashMsg || "unknown error"}</Flash>}

        {/* Tenant: monthly billing summary inline */}
        {!scope.admin && monthTotal && (
          <section className="bg-surface border border-line rounded-lg p-6">
            <div className="flex items-baseline justify-between mb-1">
              <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">Denna månad</h2>
              <span className="text-xs text-subtle tabular">
                {new Date().toLocaleDateString("sv-SE", { year: "numeric", month: "long" })}
              </span>
            </div>
            <div className="text-4xl font-semibold mt-3 text-ink tracking-tightest tabular">
              {monthTotal.total.toFixed(0)} <span className="text-base text-subtle font-normal">kr</span>
            </div>
            <p className="text-xs text-muted mt-1 tabular">
              {STATIC_MONTHLY_SEK.toFixed(0)} kr månadsavgift + {monthTotal.usage.toFixed(0)} kr samtalstid
            </p>
            <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-line">
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

        {/* Admin: Fortnox connection */}
        {scope.admin && (
          <section className="bg-surface border border-line rounded-lg p-6 space-y-3">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">Fortnox integration</h2>
            {fortnoxStatus?.connected ? (
              <div className="flex items-center gap-3">
                <span className="inline-block bg-success/10 text-success text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded">
                  Connected
                </span>
                <span className="text-xs text-muted tabular">
                  Token expires {new Date(fortnoxStatus.expires_at).toLocaleString("sv-SE")}
                </span>
              </div>
            ) : (
              <a
                href={`/api/fortnox/connect?tenant=${encodeURIComponent(tenantId)}`}
                className="inline-flex items-center gap-2 bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ink/85 transition-colors"
              >
                Connect Fortnox
              </a>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Flash({ tone, children }) {
  const cls = tone === "success"
    ? "bg-success/[0.06] border-success/20 text-success"
    : "bg-danger/[0.06] border-danger/20 text-danger";
  return <div className={`border rounded-md p-3 text-sm ${cls}`}>{children}</div>;
}

function MiniStat({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className="text-lg font-semibold text-ink mt-1 tabular">{value}</div>
    </div>
  );
}
