import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants } from "@/lib/control-plane";
import { priceForCall } from "@/lib/pricing";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";

function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const monthStart = startOfMonth();
  const [tenantsRes, callsRes] = await Promise.all([
    listTenants().catch(() => ({ tenants: [] })),
    listCalls({ since: monthStart.toISOString(), limit: 500, includeCosts: true }).catch(() => ({ calls: [] })),
  ]);

  const tenants = tenantsRes.tenants || [];
  const calls = callsRes.calls || [];

  // Roll up per tenant
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

  // Combine tenant config + monthly stats
  const customers = tenants.map((t) => {
    const stats = byTenant.get(t.tenant_id) || { count: 0, minutes: 0, price: 0, cost: 0 };
    const margin = stats.price - stats.cost;
    return { ...t, stats, margin };
  });

  return (
    <AppShell email={session.user.email} admin={true}>
      <div className="max-w-6xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">
            {new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Customers</h1>
          <p className="text-sm text-muted mt-1">{customers.length} active · {calls.length} calls this month</p>
        </header>

        {customers.length === 0 ? (
          <div className="bg-surface border border-line rounded-lg p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
              <Icon name="users" size={20} />
            </div>
            <p className="text-sm text-muted">No customers yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {customers.map((c) => (
              <CustomerCard key={c.tenant_id} customer={c} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function CustomerCard({ customer }) {
  const { tenant_id, company_name, status, stats, margin } = customer;
  const initial = (company_name || tenant_id)[0]?.toUpperCase();

  return (
    <Link
      href={`/?tenant=${encodeURIComponent(tenant_id)}`}
      className="block bg-surface border border-line rounded-lg p-5 card-hover"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center text-base font-semibold text-accent">
            {initial}
          </div>
          <div>
            <div className="font-semibold text-ink text-[15px] tracking-tight">{company_name || tenant_id}</div>
            <div className="text-[11px] text-subtle mono">{tenant_id}</div>
          </div>
        </div>
        {status && (
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
            status === "active"
              ? "bg-success/10 text-success"
              : "bg-line-soft text-muted"
          }`}>
            {status}
          </span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3 pt-4 border-t border-line">
        <Mini label="Calls" value={stats.count} />
        <Mini label="Min" value={stats.minutes.toFixed(0)} />
        <Mini label="Revenue" value={`${stats.price.toFixed(0)}`} suffix="kr" />
        <Mini label="Margin" value={`${margin.toFixed(0)}`} suffix="kr" tone={margin >= 0 ? "success" : "danger"} />
      </div>
    </Link>
  );
}

function Mini({ label, value, suffix, tone }) {
  const valueCls = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-subtle font-semibold">{label}</div>
      <div className={`text-sm font-semibold mt-1 tabular ${valueCls}`}>
        {value}
        {suffix && <span className="text-subtle font-normal text-[11px] ml-0.5">{suffix}</span>}
      </div>
    </div>
  );
}
