"use client";
import { useState, useEffect } from "react";

const CATEGORY_LABELS = {
  prompt:    "Agentens svar",
  call:      "Samtalsinställning",
  dashboard: "Dashboard",
  ai_info:   "AI-information",
  other:     "Övrigt",
};

const STATUS = {
  new:      { label: "Behandlas av AI…", pill: "bg-warning/10 text-warning",  dot: "bg-warning" },
  reviewed: { label: "Väntar på mänsklig granskning", pill: "bg-accent/10 text-accent", dot: "bg-accent" },
  applied:  { label: "Tillämpat ✓",     pill: "bg-success/10 text-success", dot: "bg-success" },
  rejected: { label: "Avvisat",          pill: "bg-danger/10 text-danger",   dot: "bg-danger" },
};

const RISK = {
  low:    { label: "Låg risk",    cls: "text-success" },
  medium: { label: "Medel risk",  cls: "text-warning" },
  high:   { label: "Hög risk",    cls: "text-danger"  },
};

function formatTs(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Stockholm" });
}

export function MySuggestionsPanel({ tenantId }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/suggestions?tenant=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then(d => setSuggestions(d.suggestions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) return <p className="text-sm text-muted py-4">Laddar förslag…</p>;
  if (suggestions.length === 0) return (
    <p className="text-sm text-muted py-4 text-center">Inga förfrågningar inskickade ännu.</p>
  );

  const pending  = suggestions.filter(s => s.status === "new" || s.status === "reviewed");
  const resolved = suggestions.filter(s => s.status === "applied" || s.status === "rejected");

  return (
    <div className="space-y-5">
      {pending.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-2">Pågår · {pending.length}</p>
          <ul className="space-y-2">
            {pending.map(s => <TicketCard key={s.id} s={s} />)}
          </ul>
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-2">Hanterade · {resolved.length}</p>
          <ul className="space-y-2">
            {resolved.map(s => <TicketCard key={s.id} s={s} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function TicketCard({ s }) {
  const [open, setOpen] = useState(false);
  const meta   = STATUS[s.status]  || STATUS.new;
  const risk   = s.risk_level ? RISK[s.risk_level] : null;
  const catLabel = CATEGORY_LABELS[s.category] || s.category || "Övrigt";

  return (
    <li className="bg-surface border border-line rounded-lg overflow-hidden">
      <div
        className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-line-soft/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>
              {meta.label}
            </span>
            <span className="text-[10px] text-muted bg-line-soft px-2 py-0.5 rounded-full">{catLabel}</span>
            {risk && <span className={`text-[10px] font-semibold ${risk.cls}`}>{risk.label}</span>}
          </div>
          <p className="text-sm text-ink leading-snug line-clamp-2">{s.text}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs text-subtle tabular">{formatTs(s.submitted_at)}</p>
          <span className={`text-muted transition-transform inline-block mt-1 text-xs ${open ? "rotate-180" : ""}`}>▾</span>
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 border-t border-line space-y-3 pt-3">
          {/* Full text */}
          <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{s.text}</p>

          {/* Agent analysis */}
          {s.agent_analysis && (
            <div className="bg-line-soft rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1">AI-analys</p>
              <p className="text-sm text-ink">{s.agent_analysis}</p>
              {s.agent_actions?.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {s.agent_actions.map((a, i) => (
                    <li key={i} className="text-xs text-success mono">✓ {a}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Agent / admin response */}
          {s.admin_response && (
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-widest text-accent font-semibold mb-1">Svar</p>
              <p className="text-sm text-ink leading-relaxed">{s.admin_response}</p>
            </div>
          )}

          {s.agent_handled_at && (
            <p className="text-xs text-subtle">Behandlad {formatTs(s.agent_handled_at)}</p>
          )}
        </div>
      )}
    </li>
  );
}
