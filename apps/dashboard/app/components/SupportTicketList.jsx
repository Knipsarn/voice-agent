"use client";
import { useState } from "react";

const CATEGORY_LABELS = {
  prompt:    "Agentens svar",
  call:      "Samtalsinställning",
  dashboard: "Dashboard",
  ai_info:   "AI-information",
  other:     "Övrigt",
};

const STATUS = {
  new:      { label: "Behandlas av AI",           dot: "bg-warning",  pill: "bg-warning/10 text-warning" },
  reviewed: { label: "Väntar på mänsklig granskning", dot: "bg-accent",  pill: "bg-accent/10 text-accent"  },
  applied:  { label: "Löst",                      dot: "bg-success",  pill: "bg-success/10 text-success"  },
  rejected: { label: "Avvisat",                   dot: "bg-subtle",   pill: "bg-line-soft text-muted"     },
};

const RISK_CLS = { low: "text-success", medium: "text-warning", high: "text-danger" };

function formatTs(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" });
}

export function SupportTicketList({ tickets, tenantId }) {
  const pending  = tickets.filter(t => t.status === "new" || t.status === "reviewed");
  const resolved = tickets.filter(t => t.status === "applied" || t.status === "rejected");

  if (tickets.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-xl p-16 text-center">
        <div className="w-12 h-12 rounded-full bg-line-soft flex items-center justify-center mx-auto mb-4 text-2xl">📬</div>
        <p className="text-base font-semibold text-ink">Inga ärenden ännu</p>
        <p className="text-sm text-muted mt-2">Använd "Nytt ärende" i menyn för att skicka en förfrågan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {pending.length > 0 && (
        <Section title="Pågående" count={pending.length} tickets={pending} />
      )}
      {resolved.length > 0 && (
        <Section title="Avslutade" count={resolved.length} tickets={resolved} muted />
      )}
    </div>
  );
}

function Section({ title, count, tickets, muted }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <p className="text-[11px] uppercase tracking-widest font-semibold text-muted">{title}</p>
        <span className="text-[11px] text-subtle bg-line-soft px-1.5 py-0.5 rounded-full tabular">{count}</span>
      </div>
      <div className="space-y-2">
        {tickets.map(t => <TicketCard key={t.id} ticket={t} muted={muted} />)}
      </div>
    </div>
  );
}

function TicketCard({ ticket: t, muted }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS[t.status] || STATUS.new;
  const cat  = CATEGORY_LABELS[t.category] || "Övrigt";

  return (
    <article className={`bg-surface border rounded-xl overflow-hidden transition-colors ${muted ? "border-line opacity-80" : "border-line"}`}>
      {/* Summary row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-5 py-4 flex items-start gap-4 hover:bg-line-soft/30 transition-colors"
      >
        {/* Status dot */}
        <div className="flex-shrink-0 mt-1.5">
          <span className={`block w-2 h-2 rounded-full ${meta.dot}`} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Tags row */}
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>
              {meta.label}
            </span>
            <span className="text-[10px] text-muted bg-line-soft px-2 py-0.5 rounded-full">{cat}</span>
            {t.risk_level && (
              <span className={`text-[10px] font-semibold ${RISK_CLS[t.risk_level] || ""}`}>
                {t.risk_level === "low" ? "Låg risk" : t.risk_level === "medium" ? "Medel risk" : "Hög risk"}
              </span>
            )}
          </div>

          {/* Ticket text preview */}
          <p className="text-sm text-ink leading-snug line-clamp-2">{t.text}</p>

          {/* AI one-liner — shown when collapsed */}
          {!open && t.agent_analysis && (
            <p className="text-xs text-muted mt-1.5 line-clamp-1 italic">AI: {t.agent_analysis}</p>
          )}
        </div>

        <div className="flex-shrink-0 text-right ml-2">
          <p className="text-xs text-subtle tabular whitespace-nowrap">{formatTs(t.submitted_at)}</p>
          <p className={`text-xs text-muted mt-1 transition-transform inline-block ${open ? "rotate-180" : ""}`}>▾</p>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-line px-5 pb-5 pt-4 space-y-4">
          {/* Full text */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1">Din förfrågan</p>
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{t.text}</p>
            {t.call_context?.from_number && (
              <p className="text-xs text-subtle mono mt-1">Samtal: {t.call_context.from_number}</p>
            )}
          </div>

          {/* AI analysis + actions */}
          {t.agent_analysis && (
            <div className="bg-line-soft rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-2">AI-analys</p>
              <p className="text-sm text-ink leading-relaxed">{t.agent_analysis}</p>
              {t.agent_actions?.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {t.agent_actions.map((a, i) => (
                    <li key={i} className="text-xs text-success flex items-start gap-1.5">
                      <span className="flex-shrink-0 mt-0.5">✓</span>
                      <span className="mono">{a}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Response to tenant */}
          {t.admin_response && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-widest text-accent font-semibold mb-2">Svar</p>
              <p className="text-sm text-ink leading-relaxed">{t.admin_response}</p>
            </div>
          )}

          {t.agent_handled_at && (
            <p className="text-xs text-subtle">Behandlad {formatTs(t.agent_handled_at)}</p>
          )}
        </div>
      )}
    </article>
  );
}
