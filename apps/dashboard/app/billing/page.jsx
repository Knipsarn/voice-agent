import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, listTenants, getBillingInvoice } from "@/lib/control-plane";
import { priceForCall, marginForCall, RATES } from "@/lib/pricing";
import { TopBar } from "../components/TopBar";
import { InvoiceActionPanel } from "../components/InvoiceActionPanel";

const STATIC_MONTHLY_SEK = parseFloat(process.env.STATIC_MONTHLY_FEE_SEK || "1000");

function startOfMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
}
function startOfNextMonth(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
}
function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}
function pickTenantId(scope, searchParams) {
  if (scope.admin) return searchParams?.tenant || null;
  return scope.tenantId;
}
function currentMonthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function BillingPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={false} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">No access.</div>
      </main>
    );
  }
  const tenantId = pickTenantId(scope, searchParams);

  if (scope.admin && !tenantId) {
    const allTenants = await listTenants().catch(() => ({ tenants: [] }));
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={true} />
        <div className="max-w-3xl mx-auto px-6 py-16 space-y-4">
          <h1 className="text-2xl font-semibold text-ink">Pick a tenant</h1>
          <ul className="space-y-2">
            {(allTenants.tenants || []).map((t) => (
              <li key={t.tenant_id}>
                <a href={`/billing?tenant=${encodeURIComponent(t.tenant_id)}`} className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-accent">
                  <div className="font-medium text-ink">{t.company_name || t.tenant_id}</div>
                  <div className="text-xs text-gray-500 mono">{t.tenant_id}</div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );
  }

  const monthStart = startOfMonth();
  const nextInvoice = startOfNextMonth();
  const month = currentMonthKey();

  const [callsRes, invoiceRecord] = await Promise.all([
    listCalls({
      tenantId,
      since: monthStart.toISOString(),
      limit: 200,
      includeCosts: scope.admin,
    }),
    scope.admin ? getBillingInvoice(tenantId, month).catch(() => ({ status: "not_invoiced" })) : null,
  ]);
  const calls = callsRes.calls || [];

  const totalMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const usagePrice = calls.reduce((s, c) => s + priceForCall(c.duration_ms), 0);
  const totalPrice = usagePrice + STATIC_MONTHLY_SEK;
  const totalCost = scope.admin ? calls.reduce((s, c) => s + (c.costs?.cost_total_sek || 0), 0) : 0;
  const totalMargin = totalPrice - totalCost;

  const monthLabel = monthStart.toLocaleDateString("sv-SE", { year: "numeric", month: "long" });

  return (
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={scope.admin} />
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Billing — {monthLabel}</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tenant: {tenantId} · Pricing: {RATES.per_minute_sek} SEK/min + {STATIC_MONTHLY_SEK} SEK/month static.
          </p>
        </div>

        {/* Total */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400">Total this month (so far)</div>
              <div className="mono text-4xl font-semibold text-ink mt-1">{totalPrice.toFixed(2)} SEK</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-gray-400">Next invoice</div>
              <div className="text-sm text-ink mt-1">{nextInvoice.toLocaleDateString("sv-SE")}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <Stat label="Calls" value={calls.length} />
            <Stat label="Minutes" value={totalMinutes.toFixed(1)} />
            <Stat label="Avg call (s)" value={calls.length ? Math.round(totalMinutes * 60 / calls.length) : 0} />
          </div>

          {scope.admin && (
            <div className="mt-6 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4 text-sm">
              <Stat label="Cost (admin)" value={`${totalCost.toFixed(2)} SEK`} muted />
              <Stat label="Margin (admin)" value={`${totalMargin.toFixed(2)} SEK`} cls={totalMargin >= 0 ? "text-green-700" : "text-red-700"} />
            </div>
          )}
        </section>

        {/* Fortnox invoice (admin only) */}
        {scope.admin && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-medium text-ink mb-4">Fortnox invoice — {monthLabel}</h2>
            <InvoiceActionPanel
              tenantId={tenantId}
              month={month}
              initialInvoice={invoiceRecord}
            />
          </section>
        )}

        {/* Line items */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-base font-medium text-ink">Line items</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-500 uppercase text-xs tracking-wider">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Detail</th>
                <th className="px-4 py-3 text-right">Amount (SEK)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="px-4 py-3">Static monthly fee</td>
                <td className="px-4 py-3 text-gray-500">Recurring platform fee</td>
                <td className="px-4 py-3 text-right mono">{STATIC_MONTHLY_SEK.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3">Usage (voice minutes)</td>
                <td className="px-4 py-3 text-gray-500">{totalMinutes.toFixed(2)} min × {RATES.per_minute_sek} SEK/min</td>
                <td className="px-4 py-3 text-right mono">{usagePrice.toFixed(2)}</td>
              </tr>
              <tr className="bg-gray-50 font-medium">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right mono">{totalPrice.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Calls this month */}
        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-baseline justify-between">
            <h2 className="text-base font-medium text-ink">Calls this month</h2>
            <span className="text-xs text-gray-500">{calls.length} calls</span>
          </div>
          {calls.length === 0 ? (
            <p className="text-gray-500 text-sm p-6">No calls yet this month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-left text-gray-500 uppercase text-xs tracking-wider">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3 text-right">Price (SEK)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calls.map((c) => {
                  const min = (c.duration_ms || 0) / 60000;
                  return (
                    <tr key={c.call_control_id}>
                      <td className="px-4 py-3 mono text-gray-600">{formatTime(c.initiated_at)}</td>
                      <td className="px-4 py-3 mono">{c.from_number || "—"}</td>
                      <td className="px-4 py-3 mono">{min.toFixed(2)} min</td>
                      <td className="px-4 py-3 text-right mono">{priceForCall(c.duration_ms).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, muted, cls }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mono font-semibold mt-1 ${muted ? "text-gray-500" : "text-ink"} ${cls || ""}`}>{value}</div>
    </div>
  );
}
