import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { getCase, listSms, listCalls, getTenant, getCall } from "@/lib/control-plane";
import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";

const STATUS_META = {
  READY:        { label: "Klar för jurist", tone: "success", note: "Kontaktuppgifter mottagna. Skickas till jurist nu." },
  SENT:         { label: "Skickad till jurist", tone: "muted",   note: "Ärendet är överlämnat. Juristen hör av sig inom en arbetsdag." },
  WAITING_SMS:  { label: "Väntar på svar",  tone: "warning", note: "Vi har skickat SMS för att samla in kontaktuppgifter." },
  CLOSED_DUPLICATE: { label: "Stängd",      tone: "subtle",  note: "Detta ärende har slagits ihop med ett annat." },
};

function formatTime(ts, full = false) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000)
    : typeof ts === "string" ? new Date(ts)
    : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: full ? "long" : "short", timeStyle: "short" });
}
function tsValue(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}
function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export default async function CaseDetail({ params, searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = effectiveScope(session.user.email, searchParams);

  const id = decodeURIComponent(params.id);

  let caseDoc;
  try {
    caseDoc = await getCase(id);
  } catch {
    return (
      <AppShell email={session.user.email} admin={scope.admin} tenantId={scope.tenantId} impersonating={scope._impersonating}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center">
          <h1 className="text-2xl font-semibold text-ink tracking-tight">Ärendet hittades inte</h1>
        </div>
      </AppShell>
    );
  }

  // Access guard
  if (!scope.admin && caseDoc.tenant_id !== scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </AppShell>
    );
  }

  const tenantId = caseDoc.tenant_id;
  const tenantDoc = await getTenant(tenantId).catch(() => null);
  const tenantName = tenantDoc?.company_name || tenantId;

  // Fetch all calls + all SMS for this customer's phone, then filter to ones tied to this case.
  // (Calls aren't currently linked by case_id, but they share the phone number.)
  const [smsRes, callsRes] = await Promise.all([
    listSms(tenantId, { caseId: caseDoc.id, limit: 50 }).catch(() => ({ sessions: [] })),
    listCalls({ tenantId, limit: 100 }).catch(() => ({ calls: [] })),
  ]);

  const callsForPhone = (callsRes.calls || []).filter(c => c.from_number === caseDoc.phone);
  // Hydrate transcripts for the most recent 3 calls (the listing endpoint may already return them)
  const callsWithTranscripts = await Promise.all(
    callsForPhone.slice(0, 5).map(async (c) => {
      if (Array.isArray(c.transcript) && c.transcript.length > 0) return c;
      try {
        const full = await getCall(c.call_control_id);
        return full;
      } catch {
        return c;
      }
    })
  );

  // Merge calls + SMS into one chronological feed
  const events = [
    ...callsWithTranscripts.map(c => ({
      type: "call",
      time: tsValue(c.initiated_at) || tsValue(c.answered_at),
      data: c,
    })),
    ...(smsRes.sessions || []).map(s => ({
      type: "sms",
      time: tsValue(s.sent_at) || tsValue(s.createdAt),
      data: s,
    })),
  ].filter(e => e.time > 0).sort((a, b) => b.time - a.time);

  const meta = STATUS_META[caseDoc.status] || { label: caseDoc.status, tone: "muted", note: "" };
  const toneCls = {
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    muted:   "bg-line-soft text-muted border-line",
    subtle:  "bg-line-soft text-subtle border-line",
  }[meta.tone];

  const backHref = scope.admin ? `/calls?tenant=${tenantId}${scope._impersonating ? "&as=customer" : ""}` : "/calls";

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName} impersonating={scope._impersonating}>
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-6">
        {/* Back nav */}
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors">
          <Icon name="arrowLeft" size={14} />
          Alla ärenden
        </Link>

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted font-semibold">
              Ärende {caseDoc.category ? `· ${caseDoc.category}` : ""}
            </p>
            <h1 className="text-3xl md:text-4xl font-semibold text-ink tracking-tightest mt-2">
              {caseDoc.name || caseDoc.phone || "Okänd kund"}
            </h1>
            <div className="text-sm text-muted mt-1 tabular">
              {formatTime(caseDoc.createdAt, true)}
            </div>
          </div>
          <span className={`text-xs uppercase tracking-wider font-semibold px-3 py-1.5 rounded-full border ${toneCls}`}>
            {meta.label}
          </span>
        </header>

        {/* Status note */}
        {meta.note && (
          <div className={`rounded-md border p-3 text-sm ${toneCls}`}>
            {meta.note}
          </div>
        )}

        {/* Customer info card */}
        <section className="bg-surface border border-line rounded-lg p-6">
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Kontaktuppgifter</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Namn"     value={caseDoc.name}  emptyHint="Saknas" />
            <Field label="Telefon"  value={caseDoc.phone} mono />
            <Field label="E-post"   value={caseDoc.email} emptyHint="Saknas" mono />
            <Field label="Ort"      value={caseDoc.city}  emptyHint="Saknas" />
          </div>
        </section>

        {/* Most recent call summary if exists */}
        {callsForPhone[0]?.summary?.summary && (
          <section className="bg-surface border border-line rounded-lg p-6">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Sammanfattning av senaste samtal</h2>
            <p className="text-ink leading-relaxed">{callsForPhone[0].summary.summary}</p>
            {callsForPhone[0].summary.suggested_action && (
              <div className="bg-accent-soft/50 border border-accent/10 rounded-md p-4 mt-4">
                <div className="text-[10px] uppercase font-semibold tracking-widest text-accent mb-1">Föreslagen åtgärd</div>
                <div className="text-sm text-ink">{callsForPhone[0].summary.suggested_action}</div>
              </div>
            )}
          </section>
        )}

        {/* Activity feed */}
        <section>
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Aktivitet</h2>
          {events.length === 0 ? (
            <div className="bg-surface border border-line rounded-lg p-8 text-center text-sm text-muted">
              Ingen aktivitet ännu.
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((e, i) => e.type === "call"
                ? <CallEvent key={`c-${i}`} call={e.data} />
                : <SmsEvent key={`s-${i}`} sms={e.data} caseDocPhone={caseDoc.phone} />
              )}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Field({ label, value, mono, emptyHint }) {
  const isEmpty = !value;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className={`text-sm mt-1 ${mono ? "mono" : ""} ${isEmpty ? "text-subtle italic" : "text-ink"}`}>
        {value || emptyHint || "—"}
      </div>
    </div>
  );
}

function CallEvent({ call }) {
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  return (
    <article className="bg-surface border border-line rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-line flex items-center justify-between bg-line-soft/40">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-accent-soft flex items-center justify-center text-accent">
            <Icon name="phone" size={13} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Samtal</div>
            <div className="text-xs text-subtle tabular">
              {formatTime(call.initiated_at)} · {formatDuration(call.duration_ms)}
            </div>
          </div>
        </div>
      </header>
      <div className="p-5 space-y-4">
        {call.summary?.summary && (
          <p className="text-sm text-ink leading-relaxed">{call.summary.summary}</p>
        )}
        {transcript.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-2">
              Transkript ({transcript.length} repliker)
            </div>
            <ol className="space-y-2 border-t border-line pt-3">
              {transcript.map((t, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className={`uppercase text-[10px] font-semibold tracking-widest w-12 shrink-0 pt-1 ${t.role === "agent" ? "text-accent" : "text-muted"}`}>
                    {t.role === "agent" ? "Aila" : "Kund"}
                  </span>
                  <span className="text-ink leading-relaxed">{t.message || t.text || ""}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {transcript.length === 0 && (
          <div className="text-xs text-subtle italic">Transkript saknas för detta samtal.</div>
        )}
        <Link
          href={`/calls/${encodeURIComponent(call.call_control_id)}`}
          className="text-xs text-accent hover:text-accent-hover font-medium inline-flex items-center gap-1"
        >
          Öppna fullständig samtalsvy <Icon name="arrowRight" size={11} />
        </Link>
      </div>
    </article>
  );
}

function SmsEvent({ sms, caseDocPhone }) {
  const isOutbound = sms.from !== caseDocPhone;
  const message = isOutbound ? sms.message_sent : sms.message_reply;
  const statusBadge = sms.status === "replied" ? "Besvarad" : sms.is_reminder ? "Påminnelse" : "Skickad";
  const direction = isOutbound ? "Skickat" : "Mottaget";

  return (
    <article className={`bg-surface border border-line rounded-lg overflow-hidden ${isOutbound ? "" : ""}`}>
      <header className="px-5 py-3 border-b border-line flex items-center justify-between bg-line-soft/40">
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-md flex items-center justify-center ${isOutbound ? "bg-accent-soft text-accent" : "bg-success/10 text-success"}`}>
            <Icon name={isOutbound ? "send" : "inbox"} size={13} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">SMS · {direction}</div>
            <div className="text-xs text-subtle tabular">
              {formatTime(sms.sent_at)}{sms.segments ? ` · ${sms.segments} segment` : ""}
              {sms.cost_customer_sek != null ? ` · ${sms.cost_customer_sek.toFixed(2)} kr` : ""}
            </div>
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted bg-line-soft px-2 py-0.5 rounded">{statusBadge}</span>
      </header>
      <div className="p-5">
        <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{message || "(tomt meddelande)"}</p>
        {sms.message_reply && isOutbound && (
          <div className="mt-3 pt-3 border-t border-line">
            <div className="text-[10px] uppercase tracking-widest text-success font-semibold mb-1">Kundens svar</div>
            <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{sms.message_reply}</p>
          </div>
        )}
      </div>
    </article>
  );
}
