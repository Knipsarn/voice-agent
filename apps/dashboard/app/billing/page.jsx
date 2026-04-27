import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listCalls, getBillingInvoice, getTenant } from "@/lib/control-plane";
import { priceForCall, RATES } from "@/lib/pricing";
import { AppShell } from "../components/AppShell";
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
      <AppShell email={session.user.email} admin={false}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </AppShell>
    );
  }
  const tenantId = pickTenantId(scope, searchParams);
  if (scope.admin && !tenantId) redirect("/admin");

  const monthStart = startOfMonth();
  const nextInvoice = startOfNextMonth();
  const month = currentMonthKey();

  const [callsRes, invoiceRecord, tenantDoc] = await Promise.all([
    listCalls({ tenantId, since: monthStart.toISOString(), limit: 500, includeCosts: scope.admin }).catch(() => ({ calls: [] })),
    scope.admin ? getBillingInvoice(tenantId, month).catch(() => ({ status: "not_invoiced" })) : null,
    getTenant(tenantId).catch(() => null),
  ]);

  const calls = callsRes.calls || [];
  const tenantName = tenantDoc?.company_name || tenantId;

  const totalMinutes = calls.reduce((s, c) => s + (c.duration_ms || 0) / 60000, 0);
  const usagePrice = calls.reduce((s, c) => s + priceForCall(c.duration_ms), 0);
  const totalPrice = usagePrice + STATIC_MONTHLY_SEK;
  const totalCost = scope.admin ? calls.reduce((s, c) => s + (c.costs?.cost_total_sek || 0), 0) : 0;
  const totalMargin = totalPrice - totalCost;

  const monthLabel = monthStart.toLocaleDateString("sv-SE", { year: "numeric", month: "long" });

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName}>
      <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Billing · {monthLabel}</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">{tenantName}</h1>
          <p className="text-sm text-muted mt-1 tabular">
            {RATES.per_minute_sek} kr/min + {STATIC_MONTHLY_SEK} kr/month static
          </p>
        </header>

        {/* Total */}
        <section className="bg-surface border border-line rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">Total this month</div>
              <div className="tabular text-4xl font-semibold text-ink mt-2 tracking-tightest">
                {totalPrice.toFixed(2)} <span className="text-base text-subtle font-normal">kr</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-widest text-muted font-semibold">Next invoice</div>
              <div className="text-sm text-ink mt-2 tabular">{nextInvoice.toLocaleDateString("sv-SE")}</div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4 pt-5 border-t border-line">
            <Mini label="Calls" value={calls.length} />
            <Mini label="Minutes" value={totalMinutes.toFixed(1)} />
            <Mini label="Avg call" value={`${calls.length ? Math.round(totalMinutes * 60 / calls.length) : 0}s`} />
          </div>

          {scope.admin && (
            <div className="mt-6 pt-5 border-t border-line grid grid-cols-2 gap-4 text-sm">
              <Mini label="Cost (admin)" value={`${totalCost.toFixed(2)} kr`} muted />
              <Mini
                label="Margin (admin)"
                value={`${totalMargin.toFixed(2)} kr`}
                tone={totalMargin >= 0 ? "success" : "danger"}
              />
            </div>
          )}
        </section>

        {/* Fortnox invoice (admin only) */}
        {scope.admin && (
          <section className="bg-surface border border-line rounded-lg p-6">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Fortnox invoice — {monthLabel}</h2>
            <InvoiceActionPanel tenantId={tenantId} month={month} initialInvoice={invoiceRecord} />
          </section>
        )}

        {/* Line items */}
        <section className="bg-surface border border-line rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-line">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">Line items</h2>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              <tr>
                <td className="px-5 py-3">Static monthly fee</td>
                <td className="px-5 py-3 text-muted">Recurring platform fee</td>
                <td className="px-5 py-3 text-right tabular">{STATIC_MONTHLY_SEK.toFixed(2)} kr</td>
              </tr>
              <tr>
                <td className="px-5 py-3">Usage (voice minutes)</td>
                <td className="px-5 py-3 text-muted tabular">{totalMinutes.toFixed(2)} min × {RATES.per_minute_sek} kr/min</td>
                <td className="px-5 py-3 text-right tabular">{usagePrice.toFixed(2)} kr</td>
              </tr>
              <tr className="bg-line-soft/40 font-semibold">
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3"></td>
                <td className="px-5 py-3 text-right tabular">{totalPrice.toFixed(2)} kr</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Calls this month */}
        <section className="bg-surface border border-line rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-line flex items-baseline justify-between">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">Calls this month</h2>
            <span className="text-xs text-subtle tabular">{calls.length} calls</span>
          </div>
          {calls.length === 0 ? (
            <p className="text-muted text-sm p-6">No calls yet this month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-line-soft/40 border-b border-line">
                <tr className="text-left text-muted uppercase text-[10px] tracking-widest font-semibold">
                  <th className="px-5 py-2.5">When</th>
                  <th className="px-5 py-2.5">From</th>
                  <th className="px-5 py-2.5">Duration</th>
                  <th className="px-5 py-2.5 text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {calls.map((c) => {
                  const min = (c.duration_ms || 0) / 60000;
                  return (
                    <tr key={c.call_control_id}>
                      <td className="px-5 py-2.5 mono text-muted tabular text-xs">{formatTime(c.initiated_at)}</td>
                      <td className="px-5 py-2.5 mono text-xs">{c.from_number || "—"}</td>
                      <td className="px-5 py-2.5 mono tabular text-xs">{min.toFixed(2)} min</td>
                      <td className="px-5 py-2.5 text-right tabular text-xs">{priceForCall(c.duration_ms).toFixed(2)} kr</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Mini({ label, value, muted, tone }) {
  const cls = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : muted ? "text-muted" : "text-ink";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className={`text-lg font-semibold mt-1 tabular ${cls}`}>{value}</div>
    </div>
  );
}
