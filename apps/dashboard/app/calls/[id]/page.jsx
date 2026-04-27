import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getCall } from "@/lib/control-plane";
import { priceForCall, marginForCall } from "@/lib/pricing";
import { TopBar } from "../../components/TopBar";
import { FeedbackPanel } from "../../components/FeedbackPanel";

function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" });
}

function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}m ${sec % 60}s (${sec}s)`;
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
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={scope.admin} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">
          Call not found or access denied.
        </div>
      </main>
    );
  }

  // Tenant scoping: customers can only see their own tenant's calls
  if (!scope.admin && call.tenant_id !== scope.tenantId) {
    return (
      <main className="min-h-screen bg-paper">
        <TopBar email={session.user.email} admin={false} />
        <div className="max-w-3xl mx-auto px-6 py-16 text-center text-gray-500">
          Access denied.
        </div>
      </main>
    );
  }

  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const summary = call.summary;
  const price = priceForCall(call.duration_ms);
  const cost = call.costs?.cost_total_sek || 0;
  const margin = marginForCall(call.duration_ms, cost);

  return (
    <main className="min-h-screen bg-paper">
      <TopBar email={session.user.email} admin={scope.admin} />

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <Link href="/calls" className="text-sm text-gray-500 hover:text-ink">← All calls</Link>
          <h1 className="text-2xl font-semibold text-ink mt-2">Call detail</h1>
          <p className="text-sm text-gray-500 mt-1">
            {call.tenant_id} · from {call.from_number || "?"} → {call.to_number || "?"} · {formatTime(call.initiated_at)}
          </p>
        </div>

        {/* Summary card */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-medium text-ink">Summary</h2>
            {summary?.urgency === "urgent" && (
              <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded">Urgent</span>
            )}
          </div>
          {summary ? (
            <div className="space-y-3">
              <p className="text-gray-800 leading-relaxed">{summary.summary}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t border-gray-100">
                <KV label="Intent" value={summary.intent} />
                <KV label="Outcome" value={summary.outcome} />
                <KV label="Urgency" value={summary.urgency} />
                <KV label="Follow-up" value={summary.requires_followup ? "Required" : "Not needed"} />
              </div>
              {summary.suggested_action && (
                <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
                  <div className="text-xs uppercase font-medium text-amber-700 tracking-wider mb-1">Suggested action</div>
                  <div className="text-amber-900">{summary.suggested_action}</div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Summary still pending — runs every minute via the post-processor.</p>
          )}
        </section>

        {/* Lifecycle + pricing card */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-ink mb-4">Call details</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-y-3 text-sm">
            <KV label="Duration" value={formatDuration(call.duration_ms)} />
            <KV label="Status" value={call.status} />
            <KV label="Hangup" value={`${call.hangup_cause || "?"} (${call.hangup_source || "?"})`} />
            <KV label="Voice" value={call.voice} />
            <KV label="Model" value={call.realtime_model} />
            <KV label="Workflow" value={call.workflow_enabled ? (call.visited_modes?.join(" → ") || "—") : "no workflow"} />
            <KV label="Turns (user / agent)" value={`${call.turn_count_user || 0} / ${call.turn_count_assistant || 0}`} />
            <KV label="Price (SEK)" value={price.toFixed(2)} accent />
            {scope.admin && <KV label="Cost (SEK)" value={cost.toFixed(2)} muted />}
            {scope.admin && (
              <KV
                label="Margin (SEK)"
                value={margin.toFixed(2)}
                cls={margin >= 0 ? "text-green-700 font-medium" : "text-red-700 font-medium"}
              />
            )}
          </div>
        </section>

        {/* Feedback */}
        <FeedbackPanel
          callControlId={call.call_control_id}
          initialFeedback={call.feedback}
          currentEmail={session.user.email}
        />

        {/* Transcript */}
        <section className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-medium text-ink mb-4">Transcript</h2>
          {transcript.length === 0 ? (
            <p className="text-gray-500 text-sm">No transcript captured.</p>
          ) : (
            <ol className="space-y-3">
              {transcript.map((t, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="mono text-gray-400 w-12 shrink-0 text-right pt-0.5">
                    {t.time_in_call_secs != null ? `${t.time_in_call_secs}s` : ""}
                  </span>
                  <span className={`uppercase text-xs font-medium w-16 shrink-0 pt-0.5 ${t.role === "agent" ? "text-accent" : "text-gray-700"}`}>
                    {t.role || "?"}
                  </span>
                  <span className="text-gray-800">{t.message || t.text || ""}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {scope.admin && call.costs && (
          <section className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-medium text-ink mb-4">Cost breakdown (admin)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 text-sm">
              <KV label="Telnyx" value={`${call.costs.cost_telnyx_sek?.toFixed(4)} SEK`} />
              <KV label="OpenAI Realtime" value={`${call.costs.cost_openai_realtime_sek?.toFixed(4)} SEK`} />
              <KV label="Summarizer" value={`${call.costs.cost_summarizer_sek?.toFixed(4)} SEK`} />
              <KV label="Infra" value={`${call.costs.cost_infra_sek?.toFixed(4)} SEK`} />
              <KV label="Total cost" value={`${call.costs.cost_total_sek?.toFixed(4)} SEK`} muted />
              <KV label="Billed minutes" value={call.costs.cost_minutes} />
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Cost rates are env-configurable placeholders until real provider invoices are loaded.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function KV({ label, value, accent, muted, cls }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-gray-400">{label}</div>
      <div className={`mono ${accent ? "text-accent font-medium" : muted ? "text-gray-500" : "text-ink"} ${cls || ""}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}
