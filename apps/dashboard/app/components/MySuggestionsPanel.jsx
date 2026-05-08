"use client";
import { useState, useEffect } from "react";

const STATUS = {
  new:      { label: "Väntar på hantering", dot: "bg-warning",  pill: "bg-warning/10 text-warning" },
  reviewed: { label: "Granskat",            dot: "bg-accent",   pill: "bg-accent/10 text-accent"   },
  applied:  { label: "Tillämpat ✓",         dot: "bg-success",  pill: "bg-success/10 text-success"  },
  rejected: { label: "Avvisat",             dot: "bg-danger",   pill: "bg-danger/10 text-danger"    },
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
    <p className="text-sm text-muted py-4 text-center">Inga förslag inskickade ännu.</p>
  );

  const pending  = suggestions.filter(s => s.status === "new" || s.status === "reviewed");
  const resolved = suggestions.filter(s => s.status === "applied" || s.status === "rejected");

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Väntar på hantering · {pending.length}</p>
          <ul className="space-y-3">
            {pending.map(s => <SuggestionCard key={s.id} s={s} />)}
          </ul>
        </div>
      )}
      {resolved.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-muted font-semibold mb-3">Hanterade · {resolved.length}</p>
          <ul className="space-y-3">
            {resolved.map(s => <SuggestionCard key={s.id} s={s} />)}
          </ul>
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s }) {
  const meta = STATUS[s.status] || STATUS.new;
  return (
    <li className="bg-surface border border-line rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${meta.pill}`}>
          {meta.label}
        </span>
        <span className="text-xs text-subtle tabular flex-shrink-0">{formatTs(s.submitted_at)}</span>
      </div>
      <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{s.text}</p>
      {s.admin_response && (
        <div className="mt-3 pt-3 border-t border-line">
          <p className="text-[10px] uppercase tracking-widest text-accent font-semibold mb-1">Agent svarade</p>
          <p className="text-sm text-ink leading-relaxed">{s.admin_response}</p>
        </div>
      )}
    </li>
  );
}
