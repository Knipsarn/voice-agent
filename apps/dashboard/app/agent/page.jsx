import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getTenant, listNumbersForTenant, listTenants } from "@/lib/control-plane";
import { TopBar } from "../components/TopBar";

function pickTenantId(scope, searchParams) {
  if (scope.admin) return searchParams?.tenant || null;
  return scope.tenantId;
}

export default async function AgentPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);

  if (!scope.admin && !scope.tenantId) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={false} tenantId={null} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">
          No access. Contact support.
        </div>
      </main>
    );
  }

  const tenantId = pickTenantId(scope, searchParams);

  // Admin without ?tenant: show selector
  if (scope.admin && !tenantId) {
    const allTenants = await listTenants().catch(() => ({ tenants: [] }));
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={true} tenantId={tenantId} />
        <div className="max-w-3xl mx-auto px-6 py-16 space-y-4">
          <h1 className="text-2xl font-semibold text-ink">Pick a tenant</h1>
          <ul className="space-y-2">
            {(allTenants.tenants || []).map((t) => (
              <li key={t.tenant_id}>
                <a href={`/agent?tenant=${encodeURIComponent(t.tenant_id)}`} className="block bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-accent">
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

  let tenant, numbersRes;
  try {
    [tenant, numbersRes] = await Promise.all([
      getTenant(tenantId),
      listNumbersForTenant(tenantId),
    ]);
  } catch (err) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={scope.admin} tenantId={tenantId} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">
          Could not load agent: {err.message}
        </div>
      </main>
    );
  }

  const numbers = numbersRes.numbers || [];
  const modes = tenant.modes || tenant.workflow?.modes || {};
  const modeKeys = Object.keys(modes);
  const baseInstructions = tenant.instructions?.base || "";
  const isWorkflow = Boolean(tenant.workflow?.enabled);

  return (
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={scope.admin} tenantId={tenantId} />

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold text-ink">{tenant.company_name || tenantId}</h1>
          <p className="text-sm text-gray-500 mt-1">Your AI receptionist's setup. Visible to your operator and to you.</p>
        </div>

        <Card title="Phone numbers">
          {numbers.length === 0 ? (
            <p className="text-gray-500 text-sm">No phone numbers assigned yet. Contact your operator.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {numbers.map((n) => (
                <li key={n.e164} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="mono text-lg text-ink">{n.e164}</div>
                    <div className="text-xs text-gray-500 mono">
                      {n.provider} · {n.capabilities?.voice ? "voice" : ""}
                      {n.capabilities?.sms ? " · sms" : ""}
                      {n.capabilities?.outbound ? " · outbound" : ""}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${n.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{n.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Voice & language">
            <KV label="Voice" value={tenant.voice} />
            <KV label="Language" value={tenant.default_language} />
            <KV label="Realtime model" value={tenant.realtime_model} />
            <KV label="Entry mode" value={tenant.entry_mode} />
            <KV label="Status" value={tenant.status} />
          </Card>
          <Card title="Greeting">
            <p className="text-sm text-gray-700 italic mb-2">"{tenant.first_message || "(default greeting)"}"</p>
            <p className="text-xs text-gray-500">First message played when a caller connects.</p>
          </Card>
        </div>

        {isWorkflow ? (
          <Card title={`Workflow modes (${modeKeys.length})`}>
            <p className="text-sm text-gray-500 mb-4">
              Your agent uses a workflow — it transitions between specialized modes based on the caller's intent.
            </p>
            <ul className="space-y-3">
              {modeKeys.map((k) => {
                const m = modes[k];
                const transferKeys = m.transfers ? Object.keys(m.transfers) : [];
                return (
                  <li key={k} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-baseline justify-between mb-2">
                      <div>
                        <span className="font-medium text-ink">{k}</span>
                        <span className="text-xs text-gray-500 ml-2">{m.label}</span>
                      </div>
                      <div className="flex gap-2">
                        {m.router && <Tag>router</Tag>}
                        {m.phone_transfer && <Tag color="amber">→ phone {m.phone_transfer}</Tag>}
                      </div>
                    </div>
                    {transferKeys.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Can transfer to:</div>
                        {transferKeys.map((t) => (
                          <div key={t} className="text-sm">
                            <span className="mono text-accent">{t.replace(/^transfer_to_/, "")}</span>
                            <span className="text-gray-600 ml-2 text-xs">{m.transfers[t]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <Card title={`Modes (${modeKeys.length})`}>
            <ul className="space-y-2">
              {modeKeys.map((k) => (
                <li key={k} className="text-sm">
                  <span className="font-medium text-ink">{k}</span>
                  {modes[k].label && <span className="text-gray-500 ml-2">{modes[k].label}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="System prompt">
          <p className="text-xs text-gray-500 mb-3">
            The base instructions your agent follows on every call.
            {scope.admin && <span className="text-amber-600"> Admin: edit via Git workflow (see CLAUDE.md §9).</span>}
          </p>
          <pre className="bg-gray-50 border border-gray-200 rounded p-4 text-xs text-gray-800 whitespace-pre-wrap font-mono max-h-96 overflow-auto">
{baseInstructions || "(no system prompt set)"}
          </pre>
        </Card>

        {tenant._meta && (
          <Card title="Configuration metadata" muted>
            <KV label="Last published" value={tenant._meta.published_at} />
            <KV label="Source" value={tenant._meta.source} />
            <KV label="Git SHA" value={tenant._meta.git_sha} mono />
          </Card>
        )}
      </div>
    </main>
  );
}

function Card({ title, children, muted }) {
  return (
    <section className={`bg-white rounded-xl border border-gray-200 p-6 ${muted ? "opacity-90" : ""}`}>
      <h2 className="text-base font-medium text-ink mb-3">{title}</h2>
      {children}
    </section>
  );
}

function KV({ label, value, mono }) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs uppercase tracking-wider text-gray-400">{label}</span>
      <span className={`text-sm text-ink ${mono ? "mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

function Tag({ children, color = "gray" }) {
  const palette = {
    gray: "bg-gray-100 text-gray-600",
    amber: "bg-amber-100 text-amber-700",
  };
  return <span className={`text-xs ${palette[color]} px-2 py-0.5 rounded`}>{children}</span>;
}
