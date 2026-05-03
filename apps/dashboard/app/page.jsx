import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { listCalls, listCases, getTenant } from "@/lib/control-plane";
import { AppShell } from "./components/AppShell";
import { Icon } from "./components/Icon";

const CRM_TENANTS = new Set(["enkla-juridik"]);

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  const diff = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}
function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000)
    : typeof ts === "string" ? new Date(ts)
    : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

export default async function HomePage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = effectiveScope(session.user.email, searchParams);

  if (!scope.admin && !scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <NoAccess email={session.user.email} />
      </AppShell>
    );
  }

  const tenantId = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  if (scope.admin && !tenantId) {
    redirect("/admin");
  }

  const weekStart = startOfWeek();
  const dayStart = startOfDay();
  const monthStart = startOfMonth();

  const useCases = CRM_TENANTS.has(tenantId);

  const [tenantDoc, weekData, monthData, casesData] = await Promise.all([
    getTenant(tenantId).catch(() => null),
    listCalls({ tenantId, since: weekStart.toISOString(), limit: 200 }).catch(() => ({ calls: [] })),
    listCalls({ tenantId, since: monthStart.toISOString(), limit: 500 }).catch(() => ({ calls: [] })),
    useCases ? listCases(tenantId, { limit: 200 }).catch(() => ({ cases: [] })) : Promise.resolve({ cases: [] }),
  ]);

  const calls = weekData.calls || [];
  const monthCalls = monthData.calls || [];
  const cases = casesData.cases || [];

  const todayCalls = calls.filter((c) => {
    const t = c.initiated_at;
    if (!t) return false;
    const d = t._seconds ? new Date(t._seconds * 1000) : new Date(t);
    return d >= dayStart;
  });

  const weekMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const todayMinutes = todayCalls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const monthMinutes = monthCalls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);

  const companyName = tenantDoc?.company_name || tenantId;

  // Case buckets (only for CRM tenants)
  const buckets = useCases ? bucketCases(cases, calls) : null;
  const conversionRate = useCases && calls.length > 0
    ? Math.round((buckets.totalCases / calls.length) * 100)
    : null;

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={companyName} impersonating={scope._impersonating}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-8">
        {/* Hero */}
        <header>
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">
            Översikt · {new Date().toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tightest mt-2">{companyName}</h1>
        </header>

        {/* Volume row */}
        <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <BigStat label="Idag"           value={todayCalls.length} sublabel={`${Math.round(todayMinutes)} min`} />
          <BigStat label="Denna vecka"    value={calls.length}      sublabel={`${Math.round(weekMinutes)} min`} />
          <BigStat label="Denna månad"    value={monthCalls.length} sublabel={`${Math.round(monthMinutes)} min`} />
        </section>

        {/* Case buckets (CRM tenants only) */}
        {useCases && buckets && (
          <>
            <section>
              <h2 className="text-xs uppercase tracking-widest text-muted font-semibold mb-3">Ärenden</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <BucketCard
                  href={`/calls?status=ready${scope.admin ? `&tenant=${tenantId}` : ""}${scope._impersonating ? "&as=customer" : ""}`}
                  label="Klara för jurist"
                  count={buckets.ready}
                  description="Kontaktuppgifter mottagna"
                  tone="success"
                  icon="check"
                />
                <BucketCard
                  href={`/calls?status=pending${scope.admin ? `&tenant=${tenantId}` : ""}${scope._impersonating ? "&as=customer" : ""}`}
                  label="Pågående ärenden"
                  count={buckets.waiting}
                  description="Väntar på kundens svar"
                  tone="warning"
                  icon="clock"
                />
                <BucketCard
                  href={`/calls${scope.admin ? `?tenant=${tenantId}` : ""}${scope._impersonating ? `${scope.admin ? "&" : "?"}as=customer` : ""}`}
                  label="Övriga samtal"
                  count={buckets.otherCallsThisWeek}
                  description="Info, fel nummer, avbrutna"
                  tone="muted"
                  icon="phone"
                />
              </div>
            </section>

            {/* Insight row */}
            {conversionRate !== null && (
              <section className="bg-surface border border-line rounded-lg p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <Insight
                    label="Konvertering till ärende"
                    value={`${conversionRate}%`}
                    sublabel={`${buckets.totalCases} av ${calls.length} samtal denna vecka`}
                  />
                  <Insight
                    label="Återkommande uppringare"
                    value={buckets.repeatCallers}
                    sublabel="Personer som ringt mer än en gång"
                  />
                  <Insight
                    label="Snitt-tid per samtal"
                    value={calls.length ? `${Math.round((weekMinutes * 60) / calls.length)}s` : "—"}
                    sublabel="Denna vecka"
                  />
                </div>
              </section>
            )}
          </>
        )}

        {/* Recent activity */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-xs uppercase tracking-widest text-muted font-semibold">
              {useCases ? "Senaste ärenden" : "Senaste samtalen"}
            </h2>
            <Link
              href={`/calls${scope.admin ? `?tenant=${tenantId}` : ""}${scope._impersonating ? `${scope.admin ? "&" : "?"}as=customer` : ""}`}
              className="text-sm text-accent hover:text-accent-hover font-medium inline-flex items-center gap-1"
            >
              Visa alla <Icon name="arrowRight" size={13} />
            </Link>
          </div>
          {useCases ? (
            cases.length === 0 ? <EmptyCases /> : <RecentCases cases={cases.slice(0, 5)} scope={scope} tenantId={tenantId} />
          ) : (
            calls.length === 0 ? <EmptyCalls /> : <RecentCalls calls={calls.slice(0, 8)} />
          )}
        </section>
      </div>
    </AppShell>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bucketCases(cases, weekCalls) {
  const active = cases.filter(c => c.status !== "CLOSED_DUPLICATE");
  const ready  = active.filter(c => c.status === "READY" || c.status === "SENT").length;
  const waiting = active.filter(c => c.status === "WAITING_SMS").length;

  // "Other calls" — calls this week from phones that DON'T have a case
  const phonesWithCases = new Set(active.map(c => c.phone));
  const otherCallsThisWeek = weekCalls.filter(c => !phonesWithCases.has(c.from_number)).length;

  // Repeat callers: phones with > 1 call this week
  const phoneCounts = {};
  for (const c of weekCalls) {
    if (c.from_number) phoneCounts[c.from_number] = (phoneCounts[c.from_number] || 0) + 1;
  }
  const repeatCallers = Object.values(phoneCounts).filter(n => n > 1).length;

  return { ready, waiting, totalCases: active.length, otherCallsThisWeek, repeatCallers };
}

// ─── Components ──────────────────────────────────────────────────────────────

function BigStat({ label, value, sublabel }) {
  return (
    <div className="bg-surface border border-line rounded-lg p-5">
      <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className="text-3xl font-semibold mt-2 tracking-tightest tabular text-ink">{value}</div>
      <div className="text-xs text-subtle mt-1 tabular">{sublabel}</div>
    </div>
  );
}

function BucketCard({ href, label, count, description, tone, icon }) {
  const toneCls = {
    success: { iconBg: "bg-success/10 text-success", value: "text-success" },
    warning: { iconBg: "bg-warning/10 text-warning", value: "text-warning" },
    muted:   { iconBg: "bg-line-soft text-muted",    value: "text-ink" },
  }[tone];

  return (
    <Link
      href={href}
      className="bg-surface border border-line rounded-lg p-5 hover:border-line-strong hover:shadow-sm transition-all flex items-start gap-4"
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${toneCls.iconBg}`}>
        <Icon name={icon} size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-widest text-muted font-semibold">{label}</div>
        <div className={`text-3xl font-semibold tracking-tightest tabular mt-1 ${toneCls.value}`}>{count}</div>
        <div className="text-xs text-subtle mt-1">{description}</div>
      </div>
    </Link>
  );
}

function Insight({ label, value, sublabel }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className="text-2xl font-semibold text-ink tracking-tightest tabular mt-1">{value}</div>
      <div className="text-xs text-subtle mt-1">{sublabel}</div>
    </div>
  );
}

function RecentCases({ cases, scope, tenantId }) {
  const sorted = [...cases].sort((a, b) => {
    const ta = a.updatedAt?._seconds || (typeof a.updatedAt === "string" ? new Date(a.updatedAt).getTime() / 1000 : 0);
    const tb = b.updatedAt?._seconds || (typeof b.updatedAt === "string" ? new Date(b.updatedAt).getTime() / 1000 : 0);
    return tb - ta;
  });
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      {sorted.map(c => {
        const status = c.status === "READY" || c.status === "SENT" ? { label: "Klar", cls: "bg-success/10 text-success" }
          : c.status === "WAITING_SMS" ? { label: "Pågående", cls: "bg-warning/10 text-warning" }
          : { label: c.status || "—", cls: "bg-line-soft text-muted" };
        return (
          <Link
            key={c.id}
            href={`/cases/${encodeURIComponent(c.id)}${scope.admin ? `?tenant=${tenantId}` : ""}${scope._impersonating ? `${scope.admin ? "&" : "?"}as=customer` : ""}`}
            className="flex items-center gap-4 px-5 py-4 border-b border-line last:border-b-0 hover:bg-line-soft/40 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2.5">
                <span className="font-semibold text-ink truncate">{c.name || c.phone || "Okänd"}</span>
                {c.category && <span className="text-[10px] uppercase tracking-widest text-muted">{c.category}</span>}
              </div>
              <div className="text-xs text-subtle mono mt-0.5 tabular">{c.phone}</div>
            </div>
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded ${status.cls}`}>{status.label}</span>
            <span className="text-xs text-subtle tabular flex-shrink-0 hidden sm:block">{formatTime(c.updatedAt || c.createdAt)}</span>
            <Icon name="arrowRight" size={14} className="text-subtle flex-shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}

function RecentCalls({ calls }) {
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      {calls.map((c) => {
        const summary = c.summary?.summary || "Sammanfattning bearbetas…";
        const min = (c.duration_ms || 0) / 60000;
        return (
          <Link
            key={c.call_control_id}
            href={`/calls/${encodeURIComponent(c.call_control_id)}`}
            className="flex items-start gap-4 px-5 py-4 border-b border-line last:border-b-0 hover:bg-line-soft/40 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <div className="flex items-baseline gap-2.5 min-w-0">
                  <span className="font-semibold text-ink mono text-sm">{c.from_number || "Okänt"}</span>
                  <span className="text-xs text-subtle tabular">{min.toFixed(1)} min</span>
                </div>
                <span className="text-xs text-subtle tabular flex-shrink-0">{formatTime(c.initiated_at)}</span>
              </div>
              <p className="text-sm text-muted line-clamp-1">{summary}</p>
            </div>
            <Icon name="arrowRight" size={14} className="text-subtle self-center" />
          </Link>
        );
      })}
    </div>
  );
}

function EmptyCases() {
  return (
    <div className="bg-surface border border-line rounded-lg p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
        <Icon name="users" size={20} />
      </div>
      <p className="text-sm text-muted">Inga ärenden ännu denna vecka.</p>
    </div>
  );
}

function EmptyCalls() {
  return (
    <div className="bg-surface border border-line rounded-lg p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
        <Icon name="phone" size={20} />
      </div>
      <p className="text-sm text-muted">Inga samtal denna vecka ännu.</p>
    </div>
  );
}

function NoAccess({ email }) {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
        <Icon name="alert" size={20} />
      </div>
      <h1 className="text-2xl font-semibold text-ink tracking-tight">Ingen åtkomst</h1>
      <p className="text-muted mt-2 text-sm">
        Din e-post (<span className="mono text-xs">{email}</span>) är inte kopplad till någon tenant.
      </p>
    </div>
  );
}
