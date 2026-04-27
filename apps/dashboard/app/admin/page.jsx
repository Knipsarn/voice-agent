import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants } from "@/lib/control-plane";
import { priceForCall, marginForCall, RATES } from "@/lib/pricing";
import { TopBar } from "../components/TopBar";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/calls");

  const [callsRes, tenantsRes] = await Promise.all([
    listCalls({ limit: 200, includeCosts: true }),
    listTenants().catch(() => ({ count: 0, tenants: [] })),
  ]);

  const calls = callsRes.calls || [];
  const tenants = tenantsRes.tenants || [];

  // Roll up by tenant for last 200 calls
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
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={true} />

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Admin overview</h1>
          <p className="text-sm text-gray-500 mt-1">
            Last {totalCalls} calls across {byTenant.size} tenants. Pricing: {RATES.per_minute_sek} SEK/min + 1000 kr static monthly per tenant.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Calls" value={totalCalls} />
          <Card label="Minutes" value={totalMinutes.toFixed(1)} />
          <Card label="Revenue" value={`${totalPrice.toFixed(2)} SEK`} />
          <Card label="Margin" value={`${totalMargin.toFixed(2)} SEK`} cls={totalMargin >= 0 ? "text-green-700" : "text-red-700"} />
        </div>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-medium text-ink">By tenant</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-500 uppercase text-xs tracking-wider">
                <th className="px-6 py-3">Tenant</th>
                <th className="px-6 py-3 text-right">Calls</th>
                <th className="px-6 py-3 text-right">Minutes</th>
                <th className="px-6 py-3 text-right">Revenue (SEK)</th>
                <th className="px-6 py-3 text-right">Cost (SEK)</th>
                <th className="px-6 py-3 text-right">Margin (SEK)</th>
                <th className="px-6 py-3 text-right">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[...byTenant.entries()].map(([tenant, agg]) => {
                const margin = agg.price - agg.cost;
                const marginPct = agg.price > 0 ? (margin / agg.price) * 100 : 0;
                return (
                  <tr key={tenant} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <a href={`/calls?tenant=${encodeURIComponent(tenant)}`} className="text-accent hover:underline">{tenant}</a>
                    </td>
                    <td className="px-6 py-3 text-right mono">{agg.count}</td>
                    <td className="px-6 py-3 text-right mono">{agg.minutes.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right mono">{agg.price.toFixed(2)}</td>
                    <td className="px-6 py-3 text-right mono text-gray-500">{agg.cost.toFixed(2)}</td>
                    <td className={`px-6 py-3 text-right mono ${margin >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {margin.toFixed(2)}
                    </td>
                    <td className={`px-6 py-3 text-right mono ${marginPct >= 0 ? "text-green-700" : "text-red-700"}`}>
                      {marginPct.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {tenants.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-ink mb-3">All tenants</h2>
            <div className="text-sm text-gray-600">
              {tenants.map((t) => (
                <span key={t.tenant_id} className="inline-block mr-3 mb-2">
                  <a href={`/calls?tenant=${encodeURIComponent(t.tenant_id)}`} className="bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded text-xs">
                    {t.tenant_id}
                  </a>
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Card({ label, value, cls }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-xs uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mono text-2xl font-semibold mt-1 text-ink ${cls || ""}`}>{value}</div>
    </div>
  );
}
