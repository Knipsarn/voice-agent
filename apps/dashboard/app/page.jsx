import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants, getTenant } from "@/lib/control-plane";
import { priceForCall } from "@/lib/pricing";
import { AppShell } from "./components/AppShell";
import { Icon } from "./components/Icon";

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
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

export default async function HomePage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);

  if (!scope.admin && !scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <NoAccess email={session.user.email} />
      </AppShell>
    );
  }

  // Admin without picked tenant: redirect to /admin (customer list)
  const tenantId = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  if (scope.admin && !tenantId) {
    redirect("/admin");
  }

  const weekStart = startOfWeek();
  const dayStart = startOfDay();
  const monthStart = startOfMonth();

  const [tenantDoc, weekData, monthData] = await Promise.all([
    getTenant(tenantId).catch(() => null),
    listCalls({ tenantId, since: weekStart.toISOString(), limit: 200 }).catch(() => ({ calls: [] })),
    listCalls({ tenantId, since: monthStart.toISOString(), limit: 500, includeCosts: scope.admin }).catch(() => ({ calls: [] })),
  ]);

  const calls = weekData.calls || [];
  const monthCalls = monthData.calls || [];

  const todayCalls = calls.filter((c) => {
    const t = c.initiated_at;
    if (!t) return false;
    const d = t._seconds ? new Date(t._seconds * 1000) : new Date(t);
    return d >= dayStart;
  });

  const weekMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const todayMinutes = todayCalls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const monthMinutes = monthCalls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);

  const urgentCalls = calls.filter((c) => c.summary?.urgency === "urgent");
  const followupCalls = calls.filter((c) => c.summary?.requires_followup && c.feedback?.rating !== "handled");

  const companyName = tenantDoc?.company_name || tenantId;

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={companyName}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
        {/* Hero */}
        <header className="mb-10">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">
            Översikt · {new Date().toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tightest mt-2">{companyName}</h1>
        </header>

        {/* Stats */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Stat label="Idag" value={todayCalls.length} sublabel={`${todayMinutes.toFixed(0)} min`} />
          <Stat label="Denna vecka" value={calls.length} sublabel={`${weekMinutes.toFixed(0)} min`} />
          <Stat label="Denna månad" value={monthCalls.length} sublabel={`${monthMinutes.toFixed(0)} min`} />
          <Stat
            label="Behöver uppföljning"
            value={followupCalls.length}
            sublabel={urgentCalls.length > 0 ? `${urgentCalls.length} brådskande` : "Allt under kontroll"}
            warning={followupCalls.length > 0}
          />
        </section>

        {/* Urgent / Followup banner */}
        {(urgentCalls.length > 0 || followupCalls.length > 0) && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
            {urgentCalls.length > 0 && (
              <Callout
                tone="danger"
                title={`${urgentCalls.length} brådskande samtal`}
                body="Kräver omedelbar uppmärksamhet."
                items={urgentCalls.slice(0, 3)}
              />
            )}
            {followupCalls.length > 0 && (
              <Callout
                tone="warning"
                title={`${followupCalls.length} behöver uppföljning`}
                body="Återkoppla till dessa kunder."
                items={followupCalls.slice(0, 3)}
              />
            )}
          </section>
        )}

        {/* Recent calls */}
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold text-ink tracking-tight">Senaste samtalen</h2>
            <Link href={scope.admin ? `/calls?tenant=${tenantId}` : "/calls"} className="text-sm text-accent hover:text-accent-hover font-medium inline-flex items-center gap-1">
              Visa alla <Icon name="arrowRight" size={13} />
            </Link>
          </div>
          {calls.length === 0 ? (
            <EmptyCalls />
          ) : (
            <div className="bg-surface border border-line rounded-lg overflow-hidden">
              {calls.slice(0, 10).map((c) => (
                <CallRow key={c.call_control_id} call={c} admin={scope.admin} tenantId={tenantId} />
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, sublabel, warning }) {
  return (
    <div className={`bg-surface border border-line rounded-lg p-5 card-hover ${warning ? "border-warning/30" : ""}`}>
      <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className={`text-3xl font-semibold mt-2 tracking-tightest tabular ${warning ? "text-warning" : "text-ink"}`}>
        {value}
      </div>
      <div className="text-xs text-subtle mt-1 tabular">{sublabel}</div>
    </div>
  );
}

function Callout({ tone, title, body, items }) {
  const cls = tone === "danger"
    ? "border-danger/20 bg-danger/[0.03]"
    : "border-warning/20 bg-warning/[0.03]";
  const iconCls = tone === "danger" ? "text-danger" : "text-warning";
  return (
    <div className={`rounded-lg border p-5 ${cls}`}>
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 ${iconCls}`}>
          <Icon name="alert" size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-ink text-[15px]">{title}</h3>
          <p className="text-sm text-muted mt-0.5">{body}</p>
          <ul className="mt-3 space-y-1.5">
            {items.map((c) => (
              <li key={c.call_control_id}>
                <Link
                  href={`/calls/${encodeURIComponent(c.call_control_id)}`}
                  className="text-sm text-ink hover:text-accent flex items-center justify-between gap-2 py-0.5"
                >
                  <span className="mono text-xs">{c.from_number || "—"}</span>
                  <span className="text-xs text-subtle tabular">{formatTime(c.initiated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CallRow({ call, admin, tenantId }) {
  const summary = call.summary?.summary || "Sammanfattning bearbetas…";
  const urgent = call.summary?.urgency === "urgent";
  const followup = call.summary?.requires_followup;
  const handled = call.feedback?.rating === "handled";
  const min = (call.duration_ms || 0) / 60000;

  return (
    <Link
      href={`/calls/${encodeURIComponent(call.call_control_id)}`}
      className="flex items-start gap-4 px-5 py-4 border-b border-line last:border-b-0 hover:bg-line-soft/40 transition-colors"
    >
      <div className="flex-shrink-0 mt-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${
          urgent ? "bg-danger" :
          followup && !handled ? "bg-warning" :
          "bg-success"
        }`}></div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <span className="font-semibold text-ink mono text-sm">{call.from_number || "Okänt"}</span>
            <span className="text-xs text-subtle tabular">{min.toFixed(1)} min</span>
          </div>
          <span className="text-xs text-subtle tabular flex-shrink-0">{formatTime(call.initiated_at)}</span>
        </div>
        <p className="text-sm text-muted line-clamp-1">{summary}</p>
      </div>
      <div className="flex-shrink-0 self-center text-subtle">
        <Icon name="arrowRight" size={14} />
      </div>
    </Link>
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
