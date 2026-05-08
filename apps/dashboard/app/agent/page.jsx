import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { getTenant, listNumbersForTenant, getSettings } from "@/lib/control-plane";
import { AppShell } from "../components/AppShell";
import { Icon } from "../components/Icon";
import { GreetingEditor } from "../components/GreetingEditor";
import { VoicePicker } from "../components/VoicePicker";

function pickTenantId(scope, searchParams) {
  if (scope.admin) return searchParams?.tenant || null;
  return scope.tenantId;
}

export default async function AgentPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = effectiveScope(session.user.email, searchParams);

  if (!scope.admin && !scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </AppShell>
    );
  }

  const tenantId = pickTenantId(scope, searchParams);
  if (scope.admin && !tenantId) {
    redirect("/admin");
  }

  let tenant, numbersRes, settings;
  try {
    [tenant, numbersRes, settings] = await Promise.all([
      getTenant(tenantId),
      listNumbersForTenant(tenantId).catch(() => ({ numbers: [] })),
      getSettings(tenantId).catch(() => ({})),
    ]);
  } catch (err) {
    return (
      <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} impersonating={scope._impersonating}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">
          Kunde inte ladda assistenten: {err.message}
        </div>
      </AppShell>
    );
  }

  const numbers = numbersRes.numbers || [];
  const tenantName = tenant.company_name || tenantId;
  const modes = tenant.modes || tenant.workflow?.modes || {};
  const modeKeys = Object.keys(modes);
  const isWorkflow = Boolean(tenant.workflow?.enabled);

  // Greeting: prefer customer override from tenant_settings, else tenant config
  const greetingValue = settings?.first_message ?? tenant.first_message ?? "";

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName} impersonating={scope._impersonating}>
      <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-6">
        <header className="mb-2">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">
            {scope.admin ? "Agent configuration" : "Min assistent"}
          </p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">{tenantName}</h1>
          <p className="text-sm text-muted mt-1">
            {scope.admin ? "Editable runtime config + Git-published technical setup." : "Här kan du ändra hur din AI-assistent presenterar sig."}
          </p>
        </header>

        {/* Test your assistant callout */}
        {numbers.length > 0 && (
          <TestYourAI
            number={numbers[0].e164}
            voice={tenant.voice}
          />
        )}

        {/* Greeting editor — customer-editable */}
        <GreetingEditor
          tenantId={tenantId}
          initialGreeting={greetingValue}
          fallbackGreeting={tenant.first_message || ""}
          isOverride={!!settings?.first_message}
        />

        {/* Voice & language */}
        <Card title="Röst & språk">
          <VoicePicker tenantId={tenantId} initialVoice={tenant.voice} />
          <Row label="Språk" value={tenant.default_language} mono />
          {scope.admin && <Row label="Realtime model" value={tenant.realtime_model} mono />}
          {scope.admin && <Row label="Entry mode" value={tenant.entry_mode} mono />}
          {scope.admin && <Row label="Status" value={tenant.status} mono />}
        </Card>

        {/* Phone numbers */}
        <Card title="Telefonnummer">
          {numbers.length === 0 ? (
            <p className="text-sm text-muted">Inga nummer tilldelade än.</p>
          ) : (
            <ul className="divide-y divide-line">
              {numbers.map((n) => (
                <li key={n.e164} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="mono text-base text-ink">{n.e164}</div>
                    <div className="text-xs text-subtle mono mt-0.5">
                      {n.provider}{n.capabilities?.voice ? " · voice" : ""}{n.capabilities?.sms ? " · sms" : ""}
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                    n.status === "active" ? "bg-success/10 text-success" : "bg-line-soft text-muted"
                  }`}>{n.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Modes (workflow tenants) */}
        {isWorkflow && modeKeys.length > 0 && (
          <Card title={`Workflow-lägen (${modeKeys.length})`}>
            <p className="text-sm text-muted mb-4">
              Din assistent växlar mellan specialiserade lägen baserat på samtalets riktning.
            </p>
            <ul className="space-y-2">
              {modeKeys.map((k) => {
                const m = modes[k];
                return (
                  <li key={k} className="flex items-baseline justify-between py-1.5 border-b border-line last:border-0">
                    <div>
                      <span className="font-semibold text-ink text-sm">{k}</span>
                      {m.label && <span className="text-xs text-muted ml-2">{m.label}</span>}
                    </div>
                    {m.phone_transfer && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-warning bg-warning/10 px-2 py-0.5 rounded">
                        → {m.phone_transfer}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {/* Admin-only: full system prompt */}
        {scope.admin && (
          <Card title="System prompt">
            <p className="text-xs text-muted mb-3">
              Edit via Git workflow (see CLAUDE.md §9). Direct edits not exposed in dashboard.
            </p>
            <pre className="bg-line-soft border border-line rounded-md p-4 text-xs text-ink whitespace-pre-wrap font-mono max-h-96 overflow-auto leading-relaxed">
{tenant.instructions?.base || "(no system prompt set)"}
            </pre>
          </Card>
        )}

        {scope.admin && tenant._meta && (
          <Card title="Configuration metadata">
            <Row label="Last published" value={tenant._meta.published_at} mono />
            <Row label="Source" value={tenant._meta.source} mono />
            <Row label="Git SHA" value={tenant._meta.git_sha} mono />
          </Card>
        )}
      </div>
    </AppShell>
  );
}

// "Testa din AI" hero callout. For now this is a click-to-dial — works on mobile,
// shows the number prominently on desktop. Future: a server-initiated outbound
// call via Telnyx (POST /v2/calls with client_state="test:<tenant>") would let
// the dashboard call the customer back, but requires telephony-service to handle
// outbound webhooks and route by client_state instead of destination number.
function TestYourAI({ number, voice }) {
  const formatted = number?.replace(/^\+46/, "0").replace(/(\d{2,3})(?=\d{6,})/, "$1-").replace(/(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3");
  return (
    <section className="bg-gradient-to-br from-accent-soft to-surface border border-accent/20 rounded-lg p-6">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.96.72 2.87a2 2 0 0 1-.45 2.11L8.09 9.9a16 16 0 0 0 6 6l1.2-1.29a2 2 0 0 1 2.11-.45c.91.35 1.87.59 2.87.72A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-ink tracking-tight">Testa din assistent</h2>
          <p className="text-sm text-muted mt-1">
            Ring detta nummer från en valfri telefon för att höra hur din AI {voice ? `(röst: ${voice}) ` : ""}svarar i ett riktigt samtal.
          </p>
          <a
            href={`tel:${number}`}
            className="inline-flex items-center gap-2 mt-4 bg-ink text-white font-semibold px-4 py-2.5 rounded-lg text-sm hover:bg-ink/85 transition-colors mono tabular"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.96.72 2.87a2 2 0 0 1-.45 2.11L8.09 9.9a16 16 0 0 0 6 6l1.2-1.29a2 2 0 0 1 2.11-.45c.91.35 1.87.59 2.87.72A2 2 0 0 1 22 16.92z" />
            </svg>
            {formatted || number}
          </a>
        </div>
      </div>
    </section>
  );
}

function Card({ title, children }) {
  return (
    <section className="bg-surface border border-line rounded-lg p-6">
      <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex justify-between items-baseline py-2 border-b border-line last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-sm text-ink ${mono ? "mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}
