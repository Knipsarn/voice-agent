import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls } from "@/lib/control-plane";
import { priceForCall, marginForCall } from "@/lib/pricing";
import { TopBar } from "../components/TopBar";

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
      <main className="min-h-screen">
        <TopBar email={session.user.email} admin={false} />
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold text-ink">Ingen åtkomst</h1>
        </div>
      </main>
    );
  }

  const tenantFilter = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  const data = await listCalls({
    tenantId: tenantFilter,
    limit: 50,
    includeCosts: scope.admin,
  });
  const calls = data.calls || [];

  return (
    <main className="min-h-screen">
      <TopBar email={session.user.email} admin={scope.admin} tenantId={tenantFilter} />

      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold text-ink tracking-tight">
              {scope.admin ? "Calls" : "Samtal"}
            </h1>
            <p className="text-sm text-muted mt-1">
              {scope.admin
                ? `${tenantFilter || "All tenants"} · ${calls.length} calls`
                : `${calls.length} samtal totalt`}
            </p>
          </div>
        </div>

        {calls.length === 0 ? (
          <EmptyState />
        ) : scope.admin ? (
          <AdminTable calls={calls} />
        ) : (
          <TenantList calls={calls} />
        )}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <div className="bg-surface rounded-2xl border border-line p-16 text-center">
      <div className="inline-block w-16 h-16 rounded-2xl bg-accent-soft flex items-center justify-center text-3xl mb-3">📞</div>
      <h2 className="text-lg font-semibold text-ink">Inga samtal ännu</h2>
      <p className="text-sm text-muted mt-1">När din AI-assistent får sitt första samtal dyker det upp här.</p>
    </div>
  );
}

function TenantList({ calls }) {
  return (
    <div className="space-y-3">
      {calls.map((c) => {
        const summary = c.summary?.summary || "Sammanfattning bearbetas…";
        const urgent = c.summary?.urgency === "urgent";
        const followup = c.summary?.requires_followup;
        const min = (c.duration_ms || 0) / 60000;
        const handled = c.feedback?.rating === "handled";

        return (
          <Link
            key={c.call_control_id}
            href={`/calls/${encodeURIComponent(c.call_control_id)}`}
            className="block bg-surface rounded-2xl border border-line p-5 shadow-card card-hover"
          >
            <div className="flex items-start gap-4">
              {/* Status dot */}
              <div className="flex-shrink-0 mt-1.5">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  urgent ? "bg-danger" :
                  followup && !handled ? "bg-warning" :
                  "bg-emerald-500"
                }`}></div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-ink mono text-sm truncate">{c.from_number || "Okänt"}</span>
                    <span className="text-xs text-subtle flex-shrink-0">·</span>
                    <span className="text-xs text-muted flex-shrink-0">{formatDuration(c.duration_ms)}</span>
                  </div>
                  <span className="text-xs text-subtle flex-shrink-0">{formatTime(c.initiated_at)}</span>
                </div>
                <p className="text-sm text-muted line-clamp-2 leading-relaxed">{summary}</p>
                {(urgent || (followup && !handled)) && (
                  <div className="flex gap-1.5 mt-2.5">
                    {urgent && <Badge tone="danger">Brådskande</Badge>}
                    {followup && !handled && <Badge tone="warning">Behöver uppföljning</Badge>}
                  </div>
                )}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function AdminTable({ calls }) {
  return (
    <div className="bg-surface rounded-2xl border border-line overflow-hidden shadow-card">
      <table className="w-full text-sm">
        <thead className="bg-paper border-b border-line">
          <tr className="text-left text-muted uppercase text-[10px] tracking-wider font-semibold">
            <th className="px-4 py-3">When</th>
            <th className="px-4 py-3">From</th>
            <th className="px-4 py-3">Tenant</th>
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3">Outcome</th>
            <th className="px-4 py-3 text-right">Price</th>
            <th className="px-4 py-3 text-right">Cost</th>
            <th className="px-4 py-3 text-right">Margin</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {calls.map((c) => {
            const price = priceForCall(c.duration_ms);
            const cost = c.costs?.cost_total_sek || 0;
            const margin = marginForCall(c.duration_ms, cost);
            return (
              <tr key={c.call_control_id} className="hover:bg-paper transition-colors">
                <td className="px-4 py-3 mono text-muted text-xs">{formatTime(c.initiated_at)}</td>
                <td className="px-4 py-3 mono text-xs">{c.from_number || "—"}</td>
                <td className="px-4 py-3 text-xs">{c.tenant_id}</td>
                <td className="px-4 py-3 mono text-xs">{formatDuration(c.duration_ms)}</td>
                <td className="px-4 py-3 text-xs">
                  <span>{c.summary?.outcome || "—"}</span>
                  {c.summary?.urgency === "urgent" && <span className="ml-1.5"><Badge tone="danger">Urgent</Badge></span>}
                </td>
                <td className="px-4 py-3 text-right mono text-xs">{price.toFixed(2)}</td>
                <td className="px-4 py-3 text-right mono text-xs text-muted">{cost.toFixed(2)}</td>
                <td className={`px-4 py-3 text-right mono text-xs ${margin >= 0 ? "text-emerald-700" : "text-danger"}`}>{margin.toFixed(2)}</td>
                <td className="px-4 py-3">
                  <Link href={`/calls/${encodeURIComponent(c.call_control_id)}`} className="text-accent hover:text-accent-hover text-xs font-medium">→</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ tone, children }) {
  const cls = {
    danger: "bg-danger/10 text-danger",
    warning: "bg-warning/10 text-warning",
    success: "bg-emerald-100 text-emerald-700",
  }[tone] || "bg-slate-100 text-slate-600";
  return <span className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}
