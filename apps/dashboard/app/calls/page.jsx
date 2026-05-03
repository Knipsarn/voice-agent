import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { listCalls, listCases, getTenant, listVoicemails } from "@/lib/control-plane";
import { priceForCall, marginForCall } from "@/lib/pricing";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";

// Tenants that use the cases-based CRM view (one card per customer/case).
// Other tenants get the chronological call list.
const CRM_TENANTS = new Set(["enkla-juridik"]);

function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000)
    : typeof ts === "string" ? new Date(ts)
    : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}
function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

const STATUS_META = {
  READY:        { label: "Klar för jurist", tone: "success" },
  SENT:         { label: "Skickad",         tone: "muted"   },
  WAITING_SMS:  { label: "Väntar på svar",  tone: "warning" },
  CLOSED_DUPLICATE: { label: "Stängd",      tone: "subtle"  },
};

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
  if (scope.admin && !tenantFilter) {
    redirect("/admin");
  }

  const useCases = CRM_TENANTS.has(tenantFilter);
  const statusFilter = searchParams?.status || "all";

  const tenantDoc = await getTenant(tenantFilter).catch(() => null);
  const tenantName = tenantDoc?.company_name || tenantFilter;

  if (useCases) {
    const { cases } = await listCases(tenantFilter, { limit: 200 }).catch(() => ({ cases: [] }));
    return (
      <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantFilter} tenantName={tenantName} impersonating={scope._impersonating}>
        <CasesView cases={cases} statusFilter={statusFilter} tenantId={tenantFilter} scope={scope} />
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
          <p className="text-sm text-muted mt-1">
            {calls.length} senaste samtalen{voicemails.length > 0 && ` · ${voicemails.filter(v => !v.read).length} olästa röstmeddelanden`}
          </p>
        </header>

        {calls.length === 0 ? <EmptyCalls /> : <CallList calls={calls} />}

        {voicemails.length > 0 && (
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
                    {vm.recording_url && (
                      <a href={vm.recording_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline mt-1 inline-block">
                        Lyssna på inspelning →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

// ─── Cases (CRM) view ────────────────────────────────────────────────────────

function CasesView({ cases, statusFilter, tenantId, scope }) {
  // Sort newest-updated first
  const sorted = [...cases].sort((a, b) => {
    const ta = tsValue(a.updatedAt) || tsValue(a.createdAt) || 0;
    const tb = tsValue(b.updatedAt) || tsValue(b.createdAt) || 0;
    return tb - ta;
  });

  const counts = {
    all:    sorted.length,
    READY:  sorted.filter(c => c.status === "READY" || c.status === "SENT").length,
    WAITING_SMS: sorted.filter(c => c.status === "WAITING_SMS").length,
  };

  const filtered = sorted.filter(c => {
    if (statusFilter === "all") return c.status !== "CLOSED_DUPLICATE";
    if (statusFilter === "ready") return c.status === "READY" || c.status === "SENT";
    if (statusFilter === "pending") return c.status === "WAITING_SMS";
    return true;
  });

  const baseHref = scope.admin ? `/calls?tenant=${tenantId}` : "/calls";
  const buildHref = (s) => `${baseHref}${baseHref.includes("?") ? "&" : "?"}status=${s}`;

  return (
    <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-muted font-semibold">Ärenden</p>
        <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Kunder</h1>
        <p className="text-sm text-muted mt-1">
          Ett kort per uppringare. Klicka för fullständig historik.
        </p>
      </header>

      {/* Filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <FilterPill href={buildHref("all")}     active={statusFilter === "all"}     label="Alla"            count={counts.all} />
        <FilterPill href={buildHref("pending")} active={statusFilter === "pending"} label="Pågående"        count={counts.WAITING_SMS} tone="warning" />
        <FilterPill href={buildHref("ready")}   active={statusFilter === "ready"}   label="Klara för jurist" count={counts.READY}        tone="success" />
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <EmptyCases />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((c) => (
            <CaseCard key={c.id} caseDoc={c} scope={scope} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPill({ href, active, label, count, tone }) {
  const cls = active
    ? "bg-ink text-white border-ink"
    : "bg-surface text-muted border-line hover:text-ink hover:border-line-strong";
  const dotCls = tone === "warning" ? "bg-warning" : tone === "success" ? "bg-success" : "bg-line";
  return (
    <Link href={href} className={`inline-flex items-center gap-2 text-sm font-medium border rounded-full px-4 py-1.5 transition-colors ${cls}`}>
      {tone && <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />}
      <span>{label}</span>
      <span className="text-xs opacity-70 tabular">{count}</span>
    </Link>
  );
}

function CaseCard({ caseDoc, scope }) {
  const meta = STATUS_META[caseDoc.status] || { label: caseDoc.status || "Okänd", tone: "muted" };
  const toneCls = {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    muted:   "bg-line-soft text-muted",
    subtle:  "bg-line-soft text-subtle",
  }[meta.tone];

  const displayName = caseDoc.name || caseDoc.phone || "Okänd";
  const summaryLine = (caseDoc.summary || "").split(/\n\n---\n/).pop()?.split("\n").slice(1).join(" ").slice(0, 140) || "Ingen sammanfattning än.";
  const detailHref = scope.admin
    ? `/cases/${encodeURIComponent(caseDoc.id)}?tenant=${caseDoc.tenant_id}${scope._impersonating ? "&as=customer" : ""}`
    : `/cases/${encodeURIComponent(caseDoc.id)}`;

  return (
    <Link
      href={detailHref}
      className="bg-surface border border-line rounded-lg p-5 hover:border-line-strong hover:shadow-sm transition-all flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-semibold text-ink tracking-tight truncate">{displayName}</h3>
            {caseDoc.category && (
              <span className="text-[10px] uppercase tracking-widest text-muted font-semibold">
                {caseDoc.category}
              </span>
            )}
          </div>
          <div className="text-xs text-subtle mono tabular mt-0.5">{caseDoc.phone}</div>
        </div>
        <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-1 rounded whitespace-nowrap ${toneCls}`}>
          {meta.label}
        </span>
      </div>

      <p className="text-sm text-muted line-clamp-2 leading-relaxed">{summaryLine}</p>

      <div className="flex items-center justify-between text-xs text-subtle pt-2 border-t border-line">
        <div className="flex items-center gap-3 tabular">
          {caseDoc.email && (
            <span className="inline-flex items-center gap-1 text-success">
              <Icon name="check" size={11} /> e-post
            </span>
          )}
          {caseDoc.reminder_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="phone" size={11} />
              {caseDoc.reminder_count} påminnelse{caseDoc.reminder_count !== 1 ? "r" : ""}
            </span>
          )}
        </div>
        <span className="tabular">{formatTime(caseDoc.updatedAt || caseDoc.createdAt)}</span>
      </div>
    </Link>
  );
}

function EmptyCases() {
  return (
    <div className="bg-surface border border-line rounded-lg p-16 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
        <Icon name="users" size={20} />
      </div>
      <h2 className="text-lg font-semibold text-ink tracking-tight">Inga ärenden ännu</h2>
      <p className="text-sm text-muted mt-1">När en kund ringer dyker ett kort upp här.</p>
    </div>
  );
}

function tsValue(ts) {
  if (!ts) return null;
  if (ts._seconds) return ts._seconds * 1000;
  if (typeof ts === "string") return new Date(ts).getTime();
  return null;
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
            <div className="flex-shrink-0 self-center text-subtle">
              <Icon name="arrowRight" size={14} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
