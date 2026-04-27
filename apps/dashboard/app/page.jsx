import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants, getTenant } from "@/lib/control-plane";
import { TopBar } from "./components/TopBar";

function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d = new Date()) {
  const x = startOfDay(d);
  const diff = (x.getDay() + 6) % 7; // Monday-start
  x.setDate(x.getDate() - diff);
  return x;
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
      <main className="min-h-screen">
        <TopBar email={session.user.email} admin={false} />
        <NoAccess email={session.user.email} />
      </main>
    );
  }

  // Admin without picked tenant: show tenant grid
  const tenantId = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  if (scope.admin && !tenantId) {
    const allTenants = await listTenants().catch(() => ({ tenants: [] }));
    return (
      <main className="min-h-screen">
        <TopBar email={session.user.email} admin={true} />
        <AdminTenantPicker tenants={allTenants.tenants || []} />
      </main>
    );
  }

  const weekStart = startOfWeek();
  const dayStart = startOfDay();

  const [tenantDoc, weekData] = await Promise.all([
    getTenant(tenantId).catch(() => null),
    listCalls({ tenantId, since: weekStart.toISOString(), limit: 200 }),
  ]);
  const calls = weekData.calls || [];

  const todayCalls = calls.filter((c) => {
    const t = c.initiated_at;
    if (!t) return false;
    const d = t._seconds ? new Date(t._seconds * 1000) : new Date(t);
    return d >= dayStart;
  });

  const weekMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const todayMinutes = todayCalls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);

  const urgentCalls = calls.filter((c) => c.summary?.urgency === "urgent");
  const followupCalls = calls.filter((c) => c.summary?.requires_followup && c.feedback?.rating !== "handled");

  const companyName = tenantDoc?.company_name || tenantId;

  return (
    <main className="min-h-screen">
      <TopBar email={session.user.email} admin={scope.admin} tenantId={tenantId} />

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Hero */}
        <section className="bg-gradient-hero rounded-3xl p-8 mb-8 border border-accent/10">
          <p className="text-sm text-accent font-medium mb-1">Hej {session.user.name?.split(" ")[0] || ""} 👋</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tight">{companyName}</h1>
          <p className="text-muted mt-2 text-sm">Här är en överblick av din AI-assistent denna vecka.</p>
        </section>

        {/* Big stats */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <BigStat
            label="Samtal idag"
            value={todayCalls.length}
            sublabel={`${todayMinutes.toFixed(0)} minuter`}
            accent
          />
          <BigStat
            label="Denna vecka"
            value={calls.length}
            sublabel={`${weekMinutes.toFixed(0)} minuter`}
          />
          <BigStat
            label="Behöver uppföljning"
            value={followupCalls.length}
            sublabel={urgentCalls.length > 0 ? `${urgentCalls.length} brådskande` : "Allt under kontroll"}
            warning={followupCalls.length > 0}
          />
        </section>

        {/* Urgent + Followup callouts */}
        {(urgentCalls.length > 0 || followupCalls.length > 0) && (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {urgentCalls.length > 0 && (
              <CalloutCard
                tone="danger"
                icon="🚨"
                title={`${urgentCalls.length} brådskande samtal`}
                body="Dessa kräver omedelbar uppmärksamhet."
                items={urgentCalls.slice(0, 3)}
              />
            )}
            {followupCalls.length > 0 && (
              <CalloutCard
                tone="warning"
                icon="⏰"
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
            <h2 className="text-lg font-semibold text-ink">Senaste samtalen</h2>
            <Link href="/calls" className="text-sm text-accent hover:text-accent-hover font-medium">
              Visa alla →
            </Link>
          </div>
          {calls.length === 0 ? (
            <div className="bg-surface rounded-2xl border border-line p-12 text-center">
              <p className="text-muted text-sm">Inga samtal denna vecka ännu.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {calls.slice(0, 6).map((c) => (
                <CallCard key={c.call_control_id} call={c} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function BigStat({ label, value, sublabel, accent, warning }) {
  return (
    <div className={`bg-surface rounded-2xl border ${warning ? "border-warning/30" : "border-line"} p-6 shadow-card card-hover`}>
      <div className="text-xs uppercase tracking-wider text-muted font-medium">{label}</div>
      <div className={`text-4xl font-semibold mt-2 tracking-tight ${accent ? "bg-gradient-accent bg-clip-text text-transparent" : warning ? "text-warning" : "text-ink"}`}>
        {value}
      </div>
      <div className="text-xs text-subtle mt-1">{sublabel}</div>
    </div>
  );
}

function CalloutCard({ tone, icon, title, body, items }) {
  const toneCls = tone === "danger"
    ? "border-danger/20 bg-danger/5"
    : "border-warning/20 bg-warning/5";
  return (
    <div className={`rounded-2xl border ${toneCls} p-5`}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <h3 className="font-semibold text-ink">{title}</h3>
          <p className="text-sm text-muted mt-0.5">{body}</p>
          <ul className="mt-3 space-y-1.5">
            {items.map((c) => (
              <li key={c.call_control_id}>
                <Link
                  href={`/calls/${encodeURIComponent(c.call_control_id)}`}
                  className="text-sm text-ink hover:text-accent flex items-center justify-between gap-2"
                >
                  <span className="mono text-xs">{c.from_number || "—"}</span>
                  <span className="text-xs text-subtle">{formatTime(c.initiated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CallCard({ call }) {
  const summary = call.summary?.summary || "Sammanfattning kommer strax…";
  const urgent = call.summary?.urgency === "urgent";
  const followup = call.summary?.requires_followup;
  const min = (call.duration_ms || 0) / 60000;

  return (
    <Link
      href={`/calls/${encodeURIComponent(call.call_control_id)}`}
      className="block bg-surface rounded-2xl border border-line p-5 shadow-card card-hover"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {urgent && <span className="bg-danger/10 text-danger text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full">Brådskande</span>}
          {followup && <span className="bg-warning/10 text-warning text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full">Uppföljning</span>}
          {!urgent && !followup && <span className="bg-emerald-100 text-emerald-700 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full">Hanterat</span>}
        </div>
        <span className="text-xs text-subtle">{formatTime(call.initiated_at)}</span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm mono text-ink font-medium">{call.from_number || "Okänt nummer"}</span>
        <span className="text-xs text-subtle">·</span>
        <span className="text-xs text-muted">{min.toFixed(1)} min</span>
      </div>
      <p className="text-sm text-muted line-clamp-2 leading-relaxed">{summary}</p>
    </Link>
  );
}

function NoAccess({ email }) {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="inline-block w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center text-3xl mb-4">🔒</div>
      <h1 className="text-2xl font-semibold text-ink">Ingen åtkomst</h1>
      <p className="text-muted mt-2 text-sm">
        Din e-post (<span className="mono">{email}</span>) är inte kopplad till någon tenant. Kontakta din administratör.
      </p>
    </div>
  );
}

function AdminTenantPicker({ tenants }) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-semibold text-ink mb-2">Tenants</h1>
      <p className="text-muted text-sm mb-8">Välj en tenant för att se översikten.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tenants.map((t) => (
          <Link
            key={t.tenant_id}
            href={`/?tenant=${encodeURIComponent(t.tenant_id)}`}
            className="bg-surface rounded-2xl border border-line p-5 card-hover"
          >
            <div className="font-semibold text-ink">{t.company_name || t.tenant_id}</div>
            <div className="text-xs text-muted mono mt-1">{t.tenant_id}</div>
            {t.status && (
              <span className={`inline-block mt-3 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                t.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
              }`}>
                {t.status}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
