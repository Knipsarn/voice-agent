import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { listCalls, listCases, getTenant, listVoicemails } from "@/lib/control-plane";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";
import { StatusFilterMenu } from "../components/StatusFilterMenu";

// Tenants that use the cases-based CRM view (one row per customer/case).
const CRM_TENANTS = new Set(["enkla-juridik"]);

const PERIODS = [
  { key: "today", label: "Idag" },
  { key: "week",  label: "Denna vecka" },
  { key: "month", label: "Denna månad" },
  { key: "all",   label: "Alla" },
];

// Status taxonomy used in the unified list. Each row gets exactly one of these.
const STATUSES = {
  pending: { label: "Pågående", dotCls: "bg-warning",        pillCls: "bg-warning/10 text-warning" },
  won:     { label: "Vunna",    dotCls: "bg-success",        pillCls: "bg-success/10 text-success" },
  missed:  { label: "Missade",  dotCls: "bg-danger",         pillCls: "bg-danger/10 text-danger"   },
  other:   { label: "Annat",    dotCls: "bg-subtle",         pillCls: "bg-line-soft text-muted"    },
};

function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000)
    : typeof ts === "string" ? new Date(ts)
    : new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  if (d >= today) return `idag ${d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= yesterday) return `igår ${d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}
function tsValue(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}
function startOfPeriod(period) {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now); d.setHours(0,0,0,0); return d.getTime();
  }
  if (period === "week") {
    const d = new Date(now); d.setHours(0,0,0,0);
    const diff = (d.getDay() + 6) % 7; d.setDate(d.getDate() - diff);
    return d.getTime();
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  return 0;
}

export default async function CallsPage({ searchParams }) {
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

  const tenantFilter = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  if (scope.admin && !tenantFilter) redirect("/admin");

  const useCases = CRM_TENANTS.has(tenantFilter);
  const period = PERIODS.find(p => p.key === searchParams?.period)?.key || "week";
  const statusFilter = (searchParams?.status || "").split(",").map(s => s.trim()).filter(Boolean);
  const allStatuses = Object.keys(STATUSES);
  const activeStatuses = statusFilter.length > 0 ? new Set(statusFilter) : new Set(allStatuses);

  const tenantDoc = await getTenant(tenantFilter).catch(() => null);
  const tenantName = tenantDoc?.company_name || tenantFilter;

  if (useCases) {
    const [casesRes, callsRes] = await Promise.all([
      listCases(tenantFilter, { limit: 500 }).catch(() => ({ cases: [] })),
      listCalls({ tenantId: tenantFilter, limit: 200 }).catch(() => ({ calls: [] })),
    ]);
    const rows = buildUnifiedRows(casesRes.cases || [], callsRes.calls || []);
    return (
      <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantFilter} tenantName={tenantName} impersonating={scope._impersonating}>
        <UnifiedListView
          rows={rows}
          period={period}
          activeStatuses={activeStatuses}
          tenantId={tenantFilter}
          scope={scope}
        />
      </AppShell>
    );
  }

  // Default: chronological call list (älvsjö etc.)
  const [data, vmData] = await Promise.all([
    listCalls({ tenantId: tenantFilter, limit: 50, includeCosts: scope.admin }).catch(() => ({ calls: [] })),
    listVoicemails(tenantFilter).catch(() => ({ voicemails: [] })),
  ]);
  const calls = data.calls || [];
  const voicemails = vmData.voicemails || [];

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantFilter} tenantName={tenantName} impersonating={scope._impersonating}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Samtalshistorik</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Samtal</h1>
          <p className="text-sm text-muted mt-1">{calls.length} senaste samtalen</p>
        </header>
        {calls.length === 0 ? <EmptyCalls /> : <CallList calls={calls} />}
        {voicemails.length > 0 && <Voicemails voicemails={voicemails} />}
      </div>
    </AppShell>
  );
}

// ─── Unified rows: cases + standalone calls ──────────────────────────────────

function buildUnifiedRows(cases, calls) {
  // Phones with cases — those calls are merged INTO the case row
  const phonesWithCases = new Set(cases.map(c => c.phone).filter(Boolean));

  const caseRows = cases
    .filter(c => c.status !== "CLOSED_DUPLICATE")
    .map(c => {
      let status = "other";
      if (c.status === "WAITING_SMS") status = "pending";
      else if (c.status === "READY" || c.status === "SENT") status = "won";

      const lastCall = calls.find(call => call.from_number === c.phone);
      const summary = lastCall?.summary?.summary || extractLatestBlock(c.summary) || "Ingen sammanfattning ännu.";

      return {
        kind: "case",
        id: c.id,
        href: null, // set below
        time: tsValue(c.updatedAt) || tsValue(c.last_call_at) || tsValue(c.createdAt),
        phone: c.phone,
        name: c.name || null,
        category: c.category || null,
        status,
        summary,
        meta: { hasEmail: !!c.email, reminderCount: c.reminder_count || 0 },
      };
    });

  const standaloneCallRows = calls
    .filter(call => call.from_number && !phonesWithCases.has(call.from_number))
    .map(call => {
      const outcome = call.summary?.outcome;
      const status = outcome === "abandoned" ? "missed" : "other";
      return {
        kind: "call",
        id: call.call_control_id,
        time: tsValue(call.initiated_at) || tsValue(call.answered_at),
        phone: call.from_number,
        name: null,
        category: call.summary?.intent && call.summary.intent !== "unknown" ? call.summary.intent : null,
        status,
        summary: call.summary?.summary || "Sammanfattning bearbetas…",
        meta: { duration: call.duration_ms },
      };
    });

  return [...caseRows, ...standaloneCallRows].sort((a, b) => b.time - a.time);
}

function extractLatestBlock(summary) {
  if (!summary) return null;
  const blocks = summary.split(/\n\n---\n/).filter(Boolean);
  const last = blocks[blocks.length - 1] || "";
  return last.split("\n").slice(1).join(" ").slice(0, 160);
}

// ─── Unified list view (CRM tenants) ─────────────────────────────────────────

function UnifiedListView({ rows, period, activeStatuses, tenantId, scope }) {
  const periodStart = startOfPeriod(period);
  const periodFiltered = period === "all" ? rows : rows.filter(r => r.time >= periodStart);

  const counts = PERIODS.reduce((acc, p) => {
    const start = startOfPeriod(p.key);
    acc[p.key] = p.key === "all" ? rows.length : rows.filter(r => r.time >= start).length;
    return acc;
  }, {});

  // Per-status counts for the filter menu (within current time period)
  const statusCounts = Object.keys(STATUSES).reduce((acc, key) => {
    acc[key] = periodFiltered.filter(r => r.status === key).length;
    return acc;
  }, {});

  const visible = periodFiltered.filter(r => activeStatuses.has(r.status));

  const baseHref = scope.admin ? `/calls?tenant=${tenantId}` : "/calls";
  const buildPeriodHref = (p) => {
    const params = new URLSearchParams();
    if (scope.admin) params.set("tenant", tenantId);
    if (scope._impersonating) { params.set("tenant", tenantId); params.set("as", "customer"); }
    params.set("period", p);
    // preserve current status filter if any
    if (activeStatuses.size > 0 && activeStatuses.size < Object.keys(STATUSES).length) {
      params.set("status", [...activeStatuses].join(","));
    }
    return `/calls?${params.toString()}`;
  };

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-muted font-semibold">Ärenden</p>
        <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Kunder</h1>
      </header>

      {/* Time tabs + filter */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-line-soft/50 border border-line rounded-lg p-1">
          {PERIODS.map(p => {
            const active = p.key === period;
            return (
              <Link
                key={p.key}
                href={buildPeriodHref(p.key)}
                className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors inline-flex items-baseline gap-1.5 ${
                  active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                <span>{p.label}</span>
                <span className={`text-xs tabular ${active ? "text-subtle" : "text-subtle"}`}>{counts[p.key]}</span>
              </Link>
            );
          })}
        </div>

        <StatusFilterMenu
          options={Object.entries(STATUSES).map(([key, s]) => ({
            key,
            label: s.label,
            dotCls: s.dotCls,
            count: statusCounts[key],
          }))}
          defaultSelected={Object.keys(STATUSES)}
        />
      </div>

      {/* Result count */}
      <p className="text-xs text-muted mb-3 tabular">
        {visible.length} {visible.length === 1 ? "rad" : "rader"}
      </p>

      {visible.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="bg-surface border border-line rounded-lg overflow-hidden divide-y divide-line">
          {visible.map(row => (
            <Row key={`${row.kind}-${row.id}`} row={row} scope={scope} tenantId={tenantId} />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ row, scope, tenantId }) {
  const status = STATUSES[row.status];
  const href = row.kind === "case"
    ? `/cases/${encodeURIComponent(row.id)}${scope.admin ? `?tenant=${tenantId}` : ""}${scope._impersonating ? `${scope.admin ? "&" : "?"}as=customer` : ""}`
    : `/calls/${encodeURIComponent(row.id)}`;

  const displayName = row.name || row.phone || "Okänd";

  return (
    <Link
      href={href}
      className="flex items-start gap-4 px-5 py-4 hover:bg-line-soft/40 transition-colors"
    >
      <div className="flex-shrink-0 mt-1.5">
        <span className={`block w-2 h-2 rounded-full ${status.dotCls}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2.5 flex-wrap mb-0.5">
          <span className="font-semibold text-ink truncate">{displayName}</span>
          {row.name && <span className="text-xs text-subtle mono tabular">{row.phone}</span>}
          {row.category && <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">{row.category}</span>}
        </div>
        <p className="text-sm text-muted line-clamp-1 leading-relaxed">{row.summary}</p>
      </div>

      <div className="flex-shrink-0 flex flex-col items-end gap-1.5 text-xs">
        <span className={`uppercase tracking-wider font-semibold px-2 py-0.5 rounded text-[10px] ${status.pillCls}`}>
          {status.label}
        </span>
        <span className="text-subtle tabular">{formatTime(row.time)}</span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="bg-surface border border-line rounded-lg p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
        <Icon name="users" size={20} />
      </div>
      <p className="text-sm text-muted">Inga rader matchar filtret.</p>
    </div>
  );
}

// ─── Default call list (non-CRM tenants) ─────────────────────────────────────

function EmptyCalls() {
  return (
    <div className="bg-surface border border-line rounded-lg p-16 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
        <Icon name="phone" size={20} />
      </div>
      <h2 className="text-lg font-semibold text-ink tracking-tight">Inga samtal ännu</h2>
      <p className="text-sm text-muted mt-1">När din assistent får sitt första samtal dyker det upp här.</p>
    </div>
  );
}

function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function CallList({ calls }) {
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      {calls.map((c) => {
        const summary = c.summary?.summary || "Sammanfattning bearbetas…";
        const urgent = c.summary?.urgency === "urgent";
        const followup = c.summary?.requires_followup;
        const handled = c.feedback?.rating === "handled";
        return (
          <Link
            key={c.call_control_id}
            href={`/calls/${encodeURIComponent(c.call_control_id)}`}
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
                  <span className="font-semibold text-ink mono text-sm">{c.from_number || "Okänt"}</span>
                  <span className="text-xs text-subtle tabular">{formatDuration(c.duration_ms)}</span>
                  {urgent && <span className="text-[10px] text-danger uppercase tracking-wider font-semibold">Brådskande</span>}
                  {followup && !handled && <span className="text-[10px] text-warning uppercase tracking-wider font-semibold">Uppföljning</span>}
                </div>
                <span className="text-xs text-subtle tabular flex-shrink-0">{formatTime(c.initiated_at)}</span>
              </div>
              <p className="text-sm text-muted line-clamp-1 leading-relaxed">{summary}</p>
            </div>
            <Icon name="arrowRight" size={14} className="text-subtle self-center" />
          </Link>
        );
      })}
    </div>
  );
}

function Voicemails({ voicemails }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs uppercase tracking-widest text-muted font-semibold mb-4">Röstmeddelanden</h2>
      <div className="bg-surface border border-line rounded-lg overflow-hidden">
        {voicemails.map((vm) => (
          <div key={vm.id} className={`flex items-start gap-4 px-5 py-4 border-b border-line last:border-b-0 ${!vm.read ? "bg-accent-soft/20" : ""}`}>
            <div className="flex-shrink-0 mt-1 text-accent"><Icon name="speaker" size={16} /></div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="font-semibold text-ink mono text-sm">{vm.caller}</span>
                <span className="text-xs text-subtle tabular">{vm.timestamp ? new Date(vm.timestamp).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "—"}</span>
              </div>
              {vm.duration_seconds && <span className="text-xs text-subtle">{vm.duration_seconds}s · </span>}
              <p className="text-sm text-ink leading-relaxed mt-1">{vm.transcript || "(ingen transkription)"}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
