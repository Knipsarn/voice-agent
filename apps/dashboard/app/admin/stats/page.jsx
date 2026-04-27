import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants } from "@/lib/control-plane";
import { priceForCall, RATES } from "@/lib/pricing";
import { AppShell } from "../../components/AppShell";

const STATIC_MONTHLY_SEK = parseFloat(process.env.STATIC_MONTHLY_FEE_SEK || "1000");

function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

export default async function StatsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const monthStart = startOfMonth();
  const [callsRes, tenantsRes] = await Promise.all([
    listCalls({ since: monthStart.toISOString(), limit: 500, includeCosts: true }).catch(() => ({ calls: [] })),
    listTenants().catch(() => ({ tenants: [] })),
  ]);

  const calls = callsRes.calls || [];
  const tenants = tenantsRes.tenants || [];

  const byTenant = new Map();
  for (const c of calls) {
    const t = c.tenant_id || "(unknown)";
    if (!byTenant.has(t)) byTenant.set(t, { count: 0, minutes: 0, price: 0, cost: 0 });
    const agg = byTenant.get(t);
    agg.count += 1;
    agg.minutes += (c.duration_ms || 0) / 60000;
    agg.price += priceForCall(c.duration_ms);
    agg.cost += c.costs?.cost_total_sek || 0;
  }

  const totalCalls = calls.length;
  const totalMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const usageRevenue = calls.reduce((s, c) => s + priceForCall(c.duration_ms), 0);
  const staticRevenue = byTenant.size * STATIC_MONTHLY_SEK;
  const totalRevenue = usageRevenue + staticRevenue;
  const totalCost = calls.reduce((s, c) => s + (c.costs?.cost_total_sek || 0), 0);
  const totalMargin = totalRevenue - totalCost;

  return (
    <AppShell email={session.user.email} admin={true}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">
            {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Statistics</h1>
          <p className="text-sm text-muted mt-1">{RATES.per_minute_sek} kr/min usage · {STATIC_MONTHLY_SEK} kr/month static per tenant</p>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Stat label="Total revenue" value={`${totalRevenue.toFixed(0)} kr`} accent />
          <Stat label="Total cost" value={`${totalCost.toFixed(0)} kr`} muted />
          <Stat label="Margin" value={`${totalMargin.toFixed(0)} kr`} positive={totalMargin >= 0} />
          <Stat label="Margin %" value={`${totalRevenue ? ((totalMargin / totalRevenue) * 100).toFixed(0) : 0}%`} positive={totalMargin >= 0} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          <Stat label="Calls" value={totalCalls} />
          <Stat label="Minutes" value={totalMinutes.toFixed(0)} />
          <Stat label="Tenants" value={byTenant.size} />
          <Stat label="Avg call (s)" value={totalCalls ? Math.round(totalMinutes * 60 / totalCalls) : 0} />
        </div>

        <section className="bg-surface border border-line rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <h2 className="text-base font-semibold text-ink tracking-tight">By customer</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-line-soft/50 border-b border-line">
              <tr className="text-left text-muted uppercase text-[10px] tracking-widest font-semibold">
                <th className="px-5 py-2.5">Customer</th>
                <th className="px-5 py-2.5 text-right">Calls</th>
                <th className="px-5 py-2.5 text-right">Min</th>
                <th className="px-5 py-2.5 text-right">Revenue</th>
                <th className="px-5 py-2.5 text-right">Cost</th>
                <th className="px-5 py-2.5 text-right">Margin</th>
                <th className="px-5 py-2.5 text-right">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...byTenant.entries()].map(([tenant, agg]) => {
                const customerRevenue = agg.price + STATIC_MONTHLY_SEK;
                const margin = customerRevenue - agg.cost;
                const marginPct = customerRevenue > 0 ? (margin / customerRevenue) * 100 : 0;
                return (
                  <tr key={tenant} className="hover:bg-line-soft/40 transition-colors">
                    <td className="px-5 py-3">
                      <Link href={`/?tenant=${encodeURIComponent(tenant)}`} className="text-ink hover:text-accent font-medium">
                        {tenant}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right tabular">{agg.count}</td>
                    <td className="px-5 py-3 text-right tabular">{agg.minutes.toFixed(1)}</td>
                    <td className="px-5 py-3 text-right tabular">{customerRevenue.toFixed(0)}</td>
                    <td className="px-5 py-3 text-right tabular text-muted">{agg.cost.toFixed(0)}</td>
                    <td className={`px-5 py-3 text-right tabular ${margin >= 0 ? "text-success" : "text-danger"}`}>{margin.toFixed(0)}</td>
                    <td className={`px-5 py-3 text-right tabular ${marginPct >= 0 ? "text-success" : "text-danger"}`}>{marginPct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, accent, muted, positive }) {
  const valueCls = accent ? "text-ink" :
    muted ? "text-muted" :
    positive === true ? "text-success" :
    positive === false ? "text-danger" :
    "text-ink";
  return (
    <div className="bg-surface border border-line rounded-lg p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className={`text-2xl font-semibold mt-2 tracking-tightest tabular ${valueCls}`}>
        {value}
      </div>
    </div>
  );
}
