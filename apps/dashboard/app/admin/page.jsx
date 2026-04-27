import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants } from "@/lib/control-plane";
import { priceForCall, RATES } from "@/lib/pricing";
import { TopBar } from "../components/TopBar";
import { AdminSuggestionsInbox } from "../components/AdminSuggestionsInbox";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const [callsRes, tenantsRes] = await Promise.all([
    listCalls({ limit: 200, includeCosts: true }),
    listTenants().catch(() => ({ count: 0, tenants: [] })),
  ]);

  const calls = callsRes.calls || [];
  const tenants = tenantsRes.tenants || [];

  const byTenant = new Map();
  for (const c of calls) {
    const t = c.tenant_id || "(unknown)";
    if (!byTenant.has(t)) byTenant.set(t, { count: 0, minutes: 0, price: 0, cost: 0 });
    const agg = byTenant.get(t);
    agg.count += 1;
    const min = (c.duration_ms || 0) / 60000;
    agg.minutes += min;
    agg.price += priceForCall(c.duration_ms);
    agg.cost += c.costs?.cost_total_sek || 0;
  }

  const totalCalls = calls.length;
  const totalMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const totalPrice = calls.reduce((s, c) => s + priceForCall(c.duration_ms), 0);
  const totalCost = calls.reduce((s, c) => s + (c.costs?.cost_total_sek || 0), 0);
  const totalMargin = totalPrice - totalCost;

  return (
    <main className="min-h-screen">
      <TopBar email={session.user.email} admin={true} />

      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold text-ink tracking-tight">Admin overview</h1>
          <p className="text-sm text-muted mt-1">
            Last {totalCalls} calls across {byTenant.size} tenants · {RATES.per_minute_sek} SEK/min + 1000 kr static
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Calls" value={totalCalls} />
          <Card label="Minutes" value={totalMinutes.toFixed(1)} />
          <Card label="Revenue" value={`${totalPrice.toFixed(0)} SEK`} accent />
          <Card label="Margin" value={`${totalMargin.toFixed(0)} SEK`} positive={totalMargin >= 0} />
        </div>

        {/* By tenant */}
        <section className="bg-surface rounded-2xl border border-line overflow-hidden shadow-card">
          <div className="px-6 py-4 border-b border-line">
            <h2 className="text-base font-semibold text-ink">By tenant</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-muted uppercase text-[10px] tracking-wider font-semibold">
                <th className="px-6 py-3">Tenant</th>
                <th className="px-6 py-3 text-right">Calls</th>
                <th className="px-6 py-3 text-right">Minutes</th>
                <th className="px-6 py-3 text-right">Revenue</th>
                <th className="px-6 py-3 text-right">Cost</th>
                <th className="px-6 py-3 text-right">Margin</th>
                <th className="px-6 py-3 text-right">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...byTenant.entries()].map(([tenant, agg]) => {
                const margin = agg.price - agg.cost;
                const marginPct = agg.price > 0 ? (margin / agg.price) * 100 : 0;
                return (
                  <tr key={tenant} className="hover:bg-paper transition-colors">
                    <td className="px-6 py-3">
                      <a href={`/calls?tenant=${encodeURIComponent(tenant)}`} className="text-accent hover:text-accent-hover font-medium">{tenant}</a>
                    </td>
                    <td className="px-6 py-3 text-right mono">{agg.count}</td>
                    <td className="px-6 py-3 text-right mono">{agg.minutes.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right mono">{agg.price.toFixed(0)}</td>
                    <td className="px-6 py-3 text-right mono text-muted">{agg.cost.toFixed(0)}</td>
                    <td className={`px-6 py-3 text-right mono ${margin >= 0 ? "text-emerald-700" : "text-danger"}`}>{margin.toFixed(0)}</td>
                    <td className={`px-6 py-3 text-right mono ${marginPct >= 0 ? "text-emerald-700" : "text-danger"}`}>{marginPct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* Tenant suggestions inbox */}
        <section className="bg-surface rounded-2xl border border-line p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-ink flex items-center gap-2">
                <span>✨</span> Förbättringsförslag från tenants
              </h2>
              <p className="text-xs text-muted mt-0.5">Kunder kan föreslå agentförbättringar via dashboarden — svaren visas för dem.</p>
            </div>
          </div>
          <AdminSuggestionsInbox tenants={tenants} />
        </section>
      </div>
    </main>
  );
}

function Card({ label, value, accent, positive }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-5 shadow-card card-hover">
      <div className="text-[10px] uppercase tracking-wider text-muted font-semibold">{label}</div>
      <div className={`mono text-2xl font-semibold mt-2 ${
        accent ? "bg-gradient-accent bg-clip-text text-transparent" :
        positive === true ? "text-emerald-700" :
        positive === false ? "text-danger" :
        "text-ink"
      }`}>
        {value}
      </div>
    </div>
  );
}
