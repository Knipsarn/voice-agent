import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, getTenant } from "@/lib/control-plane";
import { priceForCall, marginForCall } from "@/lib/pricing";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";

function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}
function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default async function CallsPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);

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

  const [data, tenantDoc] = await Promise.all([
    listCalls({
      tenantId: tenantFilter,
      limit: 50,
      includeCosts: scope.admin,
    }).catch(() => ({ calls: [] })),
    tenantFilter ? getTenant(tenantFilter).catch(() => null) : null,
  ]);
  const calls = data.calls || [];
  const tenantName = tenantDoc?.company_name || tenantFilter;

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantFilter} tenantName={tenantName}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted font-semibold">{scope.admin ? "Calls" : "Samtalshistorik"}</p>
            <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">
              {scope.admin ? "All calls" : "Samtal"}
            </h1>
            <p className="text-sm text-muted mt-1">{calls.length} senaste samtalen</p>
          </div>
        </header>

        {calls.length === 0 ? (
          <EmptyState />
        ) : scope.admin ? (
          <AdminTable calls={calls} />
        ) : (
          <CustomerList calls={calls} />
        )}
      </div>
    </AppShell>
  );
}

function EmptyState() {
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

function CustomerList({ calls }) {
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      {calls.map((c) => {
        const summary = c.summary?.summary || "Sammanfattning bearbetas…";
        const urgent = c.summary?.urgency === "urgent";
        const followup = c.summary?.requires_followup;
        const handled = c.feedback?.rating === "handled";
        const min = (c.duration_ms || 0) / 60000;

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

function AdminTable({ calls }) {
  return (
    <div className="bg-surface border border-line rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-line-soft/50 border-b border-line">
          <tr className="text-left text-muted uppercase text-[10px] tracking-widest font-semibold">
            <th className="px-5 py-3">When</th>
            <th className="px-5 py-3">From</th>
            <th className="px-5 py-3">Duration</th>
            <th className="px-5 py-3">Outcome</th>
            <th className="px-5 py-3 text-right">Price</th>
            <th className="px-5 py-3 text-right">Cost</th>
            <th className="px-5 py-3 text-right">Margin</th>
            <th className="px-5 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {calls.map((c) => {
            const price = priceForCall(c.duration_ms);
            const cost = c.costs?.cost_total_sek || 0;
            const margin = marginForCall(c.duration_ms, cost);
            return (
              <tr key={c.call_control_id} className="hover:bg-line-soft/40 transition-colors">
                <td className="px-5 py-3 mono text-muted text-xs tabular">{formatTime(c.initiated_at)}</td>
                <td className="px-5 py-3 mono text-xs">{c.from_number || "—"}</td>
                <td className="px-5 py-3 mono text-xs tabular">{formatDuration(c.duration_ms)}</td>
                <td className="px-5 py-3 text-xs">
                  <span>{c.summary?.outcome || "—"}</span>
                  {c.summary?.urgency === "urgent" && <span className="ml-2 text-[10px] text-danger uppercase tracking-wider font-semibold">Urgent</span>}
                </td>
                <td className="px-5 py-3 text-right tabular text-xs">{price.toFixed(2)}</td>
                <td className="px-5 py-3 text-right tabular text-xs text-muted">{cost.toFixed(2)}</td>
                <td className={`px-5 py-3 text-right tabular text-xs ${margin >= 0 ? "text-success" : "text-danger"}`}>{margin.toFixed(2)}</td>
                <td className="px-5 py-3">
                  <Link href={`/calls/${encodeURIComponent(c.call_control_id)}`} className="text-accent hover:text-accent-hover text-xs">
                    <Icon name="arrowRight" size={13} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
