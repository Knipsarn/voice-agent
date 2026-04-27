import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getCall, getTenant } from "@/lib/control-plane";
import { priceForCall, marginForCall } from "@/lib/pricing";
import { AppShell } from "../../components/AppShell";
import { FeedbackPanel } from "../../components/FeedbackPanel";
import { CallSuggestButton } from "../../components/CallSuggestButton";
import { Icon } from "../../components/Icon";

function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" });
}
function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default async function CallDetail({ params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);

  const id = decodeURIComponent(params.id);
  let call;
  try {
    call = await getCall(id);
  } catch (err) {
    return (
      <AppShell email={session.user.email} admin={scope.admin} tenantId={scope.tenantId}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-line-soft text-subtle mb-3">
            <Icon name="alert" size={20} />
          </div>
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Samtalet hittades inte</h1>
        </div>
      </AppShell>
    );
  }

  if (!scope.admin && call.tenant_id !== scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </AppShell>
    );
  }

  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const summary = call.summary;
  const price = priceForCall(call.duration_ms);
  const cost = call.costs?.cost_total_sek || 0;
  const margin = marginForCall(call.duration_ms, cost);
  const tenantId = call.tenant_id;

  const tenantDoc = await getTenant(tenantId).catch(() => null);
  const tenantName = tenantDoc?.company_name || tenantId;

  const callContext = {
    call_control_id: call.call_control_id,
    from_number: call.from_number,
    initiated_at: call.initiated_at?._seconds
      ? new Date(call.initiated_at._seconds * 1000).toISOString()
      : null,
    summary: summary?.summary?.slice(0, 200) || null,
  };

  const backHref = scope.admin ? `/calls?tenant=${encodeURIComponent(tenantId)}` : "/calls";

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName}>
      <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-8">
        {/* Back nav */}
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors">
          <Icon name="arrowLeft" size={14} />
          Alla samtal
        </Link>

        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted font-semibold">
              {formatTime(call.initiated_at)} · {formatDuration(call.duration_ms)}
            </p>
            <h1 className="text-3xl font-semibold text-ink tracking-tightest mt-2 mono">
              {call.from_number || "Okänt nummer"}
            </h1>
          </div>
          {summary?.urgency === "urgent" && (
            <span className="bg-danger/10 text-danger text-[10px] uppercase tracking-widest font-semibold px-2.5 py-1 rounded">
              Brådskande
            </span>
          )}
        </header>

        {/* Summary */}
        <section className="bg-surface border border-line rounded-lg p-6">
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Sammanfattning</h2>
          {summary ? (
            <div className="space-y-5">
              <p className="text-ink leading-relaxed">{summary.summary}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-line">
                <KV label="Avsikt" value={summary.intent} />
                <KV label="Resultat" value={summary.outcome} />
                <KV label="Brådska" value={summary.urgency} />
                <KV label="Uppföljning" value={summary.requires_followup ? "Behövs" : "Inte nödvändig"} />
              </div>
              {summary.suggested_action && (
                <div className="bg-accent-soft/50 border border-accent/10 rounded-md p-4 mt-2">
                  <div className="text-[10px] uppercase font-semibold tracking-widest text-accent mb-1">Föreslagen åtgärd</div>
                  <div className="text-sm text-ink">{summary.suggested_action}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Sammanfattning bearbetas just nu.</p>
          )}
        </section>

        {/* Feedback */}
        <FeedbackPanel
          callControlId={call.call_control_id}
          initialFeedback={call.feedback}
          currentEmail={session.user.email}
        />

        {/* Suggest improvement */}
        <div className="bg-surface border border-line rounded-lg p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-ink tracking-tight">Förbättra agentens svar</h2>
              <p className="text-sm text-muted mt-1">Skicka in vad agenten borde gjort annorlunda i det här samtalet.</p>
            </div>
            <CallSuggestButton tenantId={tenantId} callContext={callContext} />
          </div>
        </div>

        {/* Transcript */}
        <section className="bg-surface border border-line rounded-lg p-6">
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Transkript</h2>
          {transcript.length === 0 ? (
            <p className="text-sm text-muted">Inget transkript fångat.</p>
          ) : (
            <ol className="space-y-3">
              {transcript.map((t, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mono text-subtle w-10 shrink-0 text-right pt-0.5 text-[11px] tabular">
                    {t.time_in_call_secs != null ? `${t.time_in_call_secs}s` : ""}
                  </span>
                  <span className={`uppercase text-[10px] font-semibold tracking-widest w-14 shrink-0 pt-1 ${t.role === "agent" ? "text-accent" : "text-muted"}`}>
                    {t.role === "agent" ? "Agent" : "Kund"}
                  </span>
                  <span className="text-ink leading-relaxed">{t.message || t.text || ""}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Admin technical */}
        {scope.admin && (
          <section className="bg-surface border border-line rounded-lg p-6">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Admin · Cost & technical</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 text-sm mb-4">
              <KV label="Status" value={call.status} />
              <KV label="Hangup" value={`${call.hangup_cause || "?"} (${call.hangup_source || "?"})`} />
              <KV label="Voice" value={call.voice} />
              <KV label="Model" value={call.realtime_model} />
              <KV label="Workflow" value={call.workflow_enabled ? (call.visited_modes?.join(" → ") || "—") : "no workflow"} />
              <KV label="Turns (user/agent)" value={`${call.turn_count_user || 0} / ${call.turn_count_assistant || 0}`} />
              <KV label="Price (SEK)" value={price.toFixed(2)} accent />
              <KV label="Cost (SEK)" value={cost.toFixed(2)} muted />
              <KV
                label="Margin (SEK)"
                value={margin.toFixed(2)}
                cls={margin >= 0 ? "text-success font-medium" : "text-danger font-medium"}
              />
            </div>
            {call.costs && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 text-sm pt-4 border-t border-line">
                <KV label="Telnyx" value={`${call.costs.cost_telnyx_sek?.toFixed(4)} SEK`} />
                <KV label="OpenAI Realtime" value={`${call.costs.cost_openai_realtime_sek?.toFixed(4)} SEK`} />
                <KV label="Summarizer" value={`${call.costs.cost_summarizer_sek?.toFixed(4)} SEK`} />
                <KV label="Infra" value={`${call.costs.cost_infra_sek?.toFixed(4)} SEK`} />
              </div>
            )}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function KV({ label, value, accent, muted, cls }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-subtle font-semibold">{label}</div>
      <div className={`mono text-sm mt-1 tabular ${accent ? "text-accent font-semibold" : muted ? "text-muted" : "text-ink"} ${cls || ""}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}
