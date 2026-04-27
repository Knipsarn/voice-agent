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

function urgencyBadge(urgency) {
  if (urgency === "urgent") return <span className="inline-block bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded">Urgent</span>;
  return null;
}

function followupBadge(req) {
  if (req) return <span className="inline-block bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded">Needs follow-up</span>;
  return null;
}

export default async function CallsPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);

  if (!scope.admin && !scope.tenantId) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={false} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold text-ink">No access</h1>
          <p className="text-gray-500 mt-2">Your email ({session.user.email}) is not authorized for any tenant. Contact your operator to be added.</p>
        </div>
      </main>
    );
  }

  // Admin can pick tenant via ?tenant=<id>; defaults to all
  const tenantFilter = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  const data = await listCalls({
    tenantId: tenantFilter,
    limit: 50,
    includeCosts: scope.admin,
  });

  const calls = data.calls || [];

  return (
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={scope.admin} tenantFilter={tenantFilter} />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold text-ink">Recent calls</h1>
            <p className="text-sm text-gray-500 mt-1">
              {scope.admin ? (tenantFilter ? `Tenant: ${tenantFilter}` : "All tenants") : `Tenant: ${scope.tenantId}`}
              {" · "} {calls.length} calls
            </p>
          </div>
        </div>

        {calls.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-500">No calls yet.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-500 uppercase text-xs tracking-wider">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">From</th>
                  {scope.admin && <th className="px-4 py-3">Tenant</th>}
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3 text-right">Price (SEK)</th>
                  {scope.admin && <th className="px-4 py-3 text-right">Cost</th>}
                  {scope.admin && <th className="px-4 py-3 text-right">Margin</th>}
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calls.map((c) => {
                  const price = priceForCall(c.duration_ms);
                  const cost = c.costs?.cost_total_sek || 0;
                  const margin = marginForCall(c.duration_ms, cost);
                  const summary = c.summary?.summary || "—";
                  return (
                    <tr key={c.call_control_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 mono text-gray-600">{formatTime(c.initiated_at)}</td>
                      <td className="px-4 py-3 mono">{c.from_number || "—"}</td>
                      {scope.admin && <td className="px-4 py-3">{c.tenant_id}</td>}
                      <td className="px-4 py-3 mono">{formatDuration(c.duration_ms)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs">{c.summary?.outcome || "—"}</span>
                          {c.summary && (
                            <div className="flex gap-1">
                              {urgencyBadge(c.summary.urgency)}
                              {followupBadge(c.summary.requires_followup)}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-md text-gray-700">
                        <div className="line-clamp-2">{summary}</div>
                      </td>
                      <td className="px-4 py-3 text-right mono">{price.toFixed(2)}</td>
                      {scope.admin && <td className="px-4 py-3 text-right mono text-gray-500">{cost.toFixed(2)}</td>}
                      {scope.admin && (
                        <td className={`px-4 py-3 text-right mono ${margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                          {margin.toFixed(2)}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link href={`/calls/${encodeURIComponent(c.call_control_id)}`} className="text-accent hover:underline text-xs">
                          Details →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
