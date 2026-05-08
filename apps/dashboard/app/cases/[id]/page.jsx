import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { getCase, listSms, listCalls, getTenant, getCall } from "@/lib/control-plane";
import { AppShell } from "../../components/AppShell";
import { Icon } from "../../components/Icon";
import { CallSuggestButton } from "../../components/CallSuggestButton";
import { CollapsibleCallEvent } from "../../components/CollapsibleCallEvent";
import { DeleteCaseButton } from "../../components/DeleteCaseButton";

const STATUS_META = {
  READY:        { label: "Klar för jurist", tone: "success" },
  SENT:         { label: "Skickad till jurist", tone: "muted" },
  WAITING_SMS:  { label: "Väntar på svar",  tone: "warning" },
  CLOSED_DUPLICATE: { label: "Stängd",      tone: "subtle" },
};

const TONE_CLS = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  muted:   "bg-line-soft text-muted border-line",
  subtle:  "bg-line-soft text-subtle border-line",
};

// Reminder schedule constants (mirror routes/sms.js)
const REMINDER_INTERVAL_HOURS = 24;
const MAX_REMINDERS = 2;

function tsValue(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}
function formatTime(ts, full = false) {
  const v = tsValue(ts);
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleString("sv-SE", { dateStyle: full ? "long" : "short", timeStyle: "short", timeZone: "Europe/Stockholm" });
}
function formatRelative(ts) {
  const v = tsValue(ts);
  if (!v) return "—";
  const d = new Date(v);
  const today = new Date(); today.setHours(0,0,0,0);
  const tz = { timeZone: "Europe/Stockholm" };
  if (d >= today) return `idag ${d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", ...tz })}`;
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= yesterday) return `igår ${d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", ...tz })}`;
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", ...tz });
}
function formatDuration(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// Compute when the next reminder will fire, given the case state.
// Mirrors the cron logic in routes/sms.js (every 24h, max 2 reminders, business hours).
function computeNextReminder(caseDoc) {
  if (caseDoc.status === "READY" || caseDoc.status === "SENT") {
    return { kind: "done", text: "Inga fler SMS skickas — vi har kontaktuppgifter." };
  }
  if (caseDoc.status === "CLOSED_DUPLICATE" || caseDoc.active === false) {
    return { kind: "closed", text: "Ärendet är stängt." };
  }

  const remindersSent = caseDoc.reminder_count || 0;
  if (remindersSent >= MAX_REMINDERS) {
    return { kind: "exhausted", text: "Inga fler påminnelser. Vi har försökt två gånger utan svar." };
  }

  const lastContactTs =
    tsValue(caseDoc.last_reminder) ||
    tsValue(caseDoc.email_request_sent_at) ||
    tsValue(caseDoc.last_call_at) ||
    tsValue(caseDoc.createdAt);
  if (!lastContactTs) {
    return { kind: "unknown", text: "Ingen kontakt registrerad — påminnelse kan inte schemaläggas." };
  }

  let nextEarliest = new Date(lastContactTs + REMINDER_INTERVAL_HOURS * 3600_000);
  // Push into business hours (Mon–Fri 07:30–19:30 Stockholm)
  // Quick approximation in local time — close enough for display.
  while (true) {
    const day = nextEarliest.getDay(); // 0 Sun, 6 Sat
    const hour = nextEarliest.getHours() + nextEarliest.getMinutes() / 60;
    if (day === 0 || day === 6) {
      // Weekend → bump to Monday 07:30
      const daysToMonday = day === 0 ? 1 : 2;
      nextEarliest.setDate(nextEarliest.getDate() + daysToMonday);
      nextEarliest.setHours(7, 30, 0, 0);
      continue;
    }
    if (hour < 7.5) {
      nextEarliest.setHours(7, 30, 0, 0); break;
    }
    if (hour >= 19.5) {
      nextEarliest.setDate(nextEarliest.getDate() + 1);
      nextEarliest.setHours(7, 30, 0, 0); continue;
    }
    break;
  }

  const which = remindersSent === 0 ? "Påminnelse 1" : "Påminnelse 2";
  return { kind: "scheduled", time: nextEarliest.getTime(), text: `${which} skickas tidigast ${formatTime(nextEarliest)}` };
}

// Reconstruct the SMS history for legacy cases (n8n imports) where we don't have
// the sms_sessions collection. The case doc itself has the timestamps + reply text.
function legacySmsEvents(caseDoc) {
  const events = [];
  const sentCount = caseDoc.email_request_count || 0;
  if (sentCount > 0 || caseDoc.email_request_sent_at) {
    events.push({
      type: "sms",
      direction: "out",
      time: tsValue(caseDoc.email_request_sent_at) || tsValue(caseDoc.createdAt),
      message: "(Första SMS skickat — för att be om kontaktuppgifter)",
      label: "SMS skickat",
      reconstructed: true,
    });
  }
  if (caseDoc.last_inbound_sms_body) {
    events.push({
      type: "sms",
      direction: "in",
      time: tsValue(caseDoc.last_inbound_sms_at),
      message: caseDoc.last_inbound_sms_body,
      label: "Kundens svar",
    });
  }
  if (caseDoc.last_reminder) {
    events.push({
      type: "sms",
      direction: "out",
      time: tsValue(caseDoc.last_reminder),
      message: `(Påminnelse skickad — ${caseDoc.reminder_count || 1} av ${MAX_REMINDERS})`,
      label: "Påminnelse",
      reconstructed: true,
    });
  }
  return events;
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

  // Fetch SMS sessions tied to this case + recent calls from this phone
  const [smsRes, callsRes] = await Promise.all([
    listSms(tenantId, { caseId: caseDoc.id, limit: 50 }).catch(() => ({ sessions: [] })),
    listCalls({ tenantId, limit: 200 }).catch(() => ({ calls: [] })),
  ]);

  const smsSessions = smsRes.sessions || [];
  const callsForPhone = (callsRes.calls || []).filter(c => c.from_number === caseDoc.phone);

  // Hydrate transcripts for all calls from this phone number.
  // The list response already includes transcripts for most calls — getCall is
  // only needed for very old docs that predate transcript storage.
  const callsWithTranscripts = await Promise.all(
    callsForPhone.map(async (c) => {
      if (Array.isArray(c.transcript) && c.transcript.length > 0) return c;
      try { return await getCall(c.call_control_id); } catch { return c; }
    })
  );

  // Build event feed: real SMS sessions + legacy SMS reconstructed from case fields + calls
  const smsEvents = smsSessions.length > 0
    ? smsSessions.map(s => ({
        type: "sms",
        direction: s.from === caseDoc.phone ? "in" : "out",
        time: tsValue(s.sent_at) || tsValue(s.createdAt),
        message: s.from === caseDoc.phone ? s.message_reply : s.message_sent,
        label: s.is_reminder ? "Påminnelse" : (s.from === caseDoc.phone ? "Kundens svar" : "SMS skickat"),
        segments: s.segments,
        cost: s.cost_customer_sek,
        reply: s.message_reply,
      }))
    : legacySmsEvents(caseDoc);

  const callEvents = callsWithTranscripts.map(c => ({
    type: "call",
    time: tsValue(c.initiated_at) || tsValue(c.answered_at),
    data: c,
  }));

  const events = [...smsEvents, ...callEvents]
    .filter(e => e.time > 0)
    .sort((a, b) => b.time - a.time);

  const meta = STATUS_META[caseDoc.status] || { label: caseDoc.status || "Okänd", tone: "muted" };
  const nextReminder = computeNextReminder(caseDoc);

  const backHref = scope.admin
    ? `/calls?tenant=${tenantId}${scope._impersonating ? "&as=customer" : ""}`
    : "/calls";

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName} impersonating={scope._impersonating}>
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-6">
        <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors">
          <Icon name="arrowLeft" size={14} />
          Alla ärenden
        </Link>

        {/* Header */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-widest text-muted font-semibold">
              Ärende{caseDoc.category ? ` · ${caseDoc.category}` : ""}
            </p>
            <h1 className="text-3xl md:text-4xl font-semibold text-ink tracking-tightest mt-2 truncate">
              {caseDoc.name || caseDoc.phone || "Okänd kund"}
            </h1>
            <div className="text-sm text-muted mt-1 tabular">
              Skapad {formatTime(caseDoc.createdAt, true)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs uppercase tracking-wider font-semibold px-3 py-1.5 rounded-full border ${TONE_CLS[meta.tone]}`}>
              {meta.label}
            </span>
            <DeleteCaseButton caseId={caseDoc.id} backHref={backHref} />
          </div>
        </header>

        {/* What happens next — schedule panel */}
        <NextStepPanel next={nextReminder} caseDoc={caseDoc} />

        {/* Customer info */}
        <section className="bg-surface border border-line rounded-lg p-6">
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-4">Kontaktuppgifter</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="Namn"    value={caseDoc.name}  emptyHint="Saknas" />
            <Field label="Telefon" value={caseDoc.phone} mono />
            <Field label="E-post"  value={caseDoc.email} emptyHint="Saknas" mono />
            <Field label="Ort"     value={caseDoc.city}  emptyHint="Saknas" />
          </div>
        </section>

        {/* Case summary text (from the original call's summary or legacy import) */}
        {caseDoc.summary && (
          <section className="bg-surface border border-line rounded-lg p-6">
            <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Sammanfattning</h2>
            <p className="text-ink leading-relaxed whitespace-pre-line">{caseDoc.summary}</p>
          </section>
        )}

        {/* Activity feed */}
        <section>
          <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Aktivitet</h2>
          {events.length === 0 ? (
            <div className="bg-surface border border-line rounded-lg p-8 text-center text-sm text-muted">
              Ingen aktivitet registrerad ännu.
            </div>
          ) : (
            <div className="space-y-3">
              {events.map((e, i) => e.type === "call"
                ? <CollapsibleCallEvent key={`c-${i}`} call={e.data} tenantId={tenantId} />
                : <SmsEvent key={`s-${i}`} event={e} />
              )}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function NextStepPanel({ next, caseDoc }) {
  const iconCls = next.kind === "scheduled" ? "bg-warning/10 text-warning"
    : next.kind === "done" ? "bg-success/10 text-success"
    : "bg-line-soft text-muted";

  return (
    <section className="bg-surface border border-line rounded-lg p-5 flex items-start gap-4">
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 ${iconCls}`}>
        <Icon name="clock" size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-widest text-muted font-semibold">Nästa steg</div>
        <div className="text-sm text-ink mt-1 leading-relaxed">{next.text}</div>
        <div className="flex items-center gap-4 mt-2 text-xs text-subtle tabular flex-wrap">
          <span>SMS skickade: <span className="text-ink font-medium">{(caseDoc.last_sms_sent_at ? 1 : 0) + (caseDoc.reminder_count || 0)}</span></span>
          <span>Påminnelser: <span className="text-ink font-medium">{caseDoc.reminder_count || 0} av {MAX_REMINDERS}</span></span>
          {caseDoc.last_inbound_sms_at && (
            <span>Senaste svar: <span className="text-ink font-medium">{formatRelative(caseDoc.last_inbound_sms_at)}</span></span>
          )}
        </div>
      </div>
    </section>
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

function CallEvent({ call, tenantId }) {
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const callContext = {
    call_control_id: call.call_control_id,
    from_number: call.from_number,
    initiated_at: call.initiated_at?._seconds
      ? new Date(call.initiated_at._seconds * 1000).toISOString()
      : null,
    summary: call.summary?.summary?.slice(0, 200) || null,
  };

  return (
    <article className="bg-surface border border-line rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-line flex items-center justify-between bg-line-soft/40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-accent-soft flex items-center justify-center text-accent">
            <Icon name="phone" size={14} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Samtal</div>
            <div className="text-xs text-subtle tabular">
              {formatRelative(call.initiated_at)} · {formatDuration(call.duration_ms)}
            </div>
          </div>
        </div>
        <CallSuggestButton tenantId={tenantId} callContext={callContext} label="Förbättra agenten" />
      </header>
      <div className="p-5 space-y-4">
        {call.summary?.summary && (
          <p className="text-sm text-ink leading-relaxed">{call.summary.summary}</p>
        )}
        {transcript.length > 0 ? (
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
        ) : (
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

function SmsEvent({ event }) {
  const isOut = event.direction === "out";
  return (
    <article className="bg-surface border border-line rounded-lg overflow-hidden">
      <header className="px-5 py-3 border-b border-line flex items-center justify-between bg-line-soft/40">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-md flex items-center justify-center ${isOut ? "bg-accent-soft text-accent" : "bg-success/10 text-success"}`}>
            <Icon name={isOut ? "send" : "inbox"} size={14} />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">SMS · {event.label}</div>
            <div className="text-xs text-subtle tabular">
              {formatRelative(event.time)}
              {event.segments ? ` · ${event.segments} segment` : ""}
              {event.cost != null ? ` · ${event.cost.toFixed(2)} kr` : ""}
            </div>
          </div>
        </div>
        {event.reconstructed && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-subtle bg-line-soft px-2 py-0.5 rounded">Rekonstruerat</span>
        )}
      </header>
      <div className="p-5">
        <p className={`text-sm leading-relaxed whitespace-pre-line ${event.reconstructed ? "text-muted italic" : "text-ink"}`}>
          {event.message || "(tomt meddelande)"}
        </p>
        {event.reply && isOut && (
          <div className="mt-3 pt-3 border-t border-line">
            <div className="text-[10px] uppercase tracking-widest text-success font-semibold mb-1">Kundens svar</div>
            <p className="text-sm text-ink leading-relaxed whitespace-pre-line">{event.reply}</p>
          </div>
        )}
      </div>
    </article>
  );
}
