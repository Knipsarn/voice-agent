"use client";
import { useState, useEffect, useRef } from "react";

export function SuggestionPanel({ open, onClose, tenantId, callContext }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/suggestions?tenant=${encodeURIComponent(tenantId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setSuggestions((d.suggestions || []).reverse()); // newest at bottom
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [open, tenantId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [suggestions, open]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          text: text.trim(),
          call_context: callContext || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSuggestions((prev) => [...prev, data]);
      setText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink/20 backdrop-blur-sm animate-fade-in" onClick={onClose}></div>
      <div className="w-full max-w-md bg-white shadow-elevated flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-5 border-b border-line">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink flex items-center gap-2">
                <span className="text-xl">✨</span>
                Förbättra agenten
              </h2>
              <p className="text-xs text-muted mt-1">
                Berätta vad agenten bör göra annorlunda. Vi går igenom varje förslag.
              </p>
            </div>
            <button onClick={onClose} className="text-muted hover:text-ink text-xl leading-none">×</button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-paper">
          {loading && <p className="text-sm text-subtle text-center">Laddar tidigare förslag…</p>}

          {!loading && suggestions.length === 0 && (
            <div className="text-center py-12 px-4">
              <div className="inline-block w-12 h-12 rounded-2xl bg-accent-soft flex items-center justify-center text-2xl mb-3">💡</div>
              <p className="text-sm text-muted">
                Skicka ditt första förslag.
                <br />
                Ex: <em>&quot;Aila ska fråga om ärendetyp innan hon föreslår tid&quot;</em>
              </p>
            </div>
          )}

          {suggestions.map((s) => (
            <SuggestionBubble key={s.id} suggestion={s} />
          ))}

          {error && (
            <div className="bg-danger/10 text-danger text-xs rounded-lg p-3">{error}</div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-white p-4">
          {callContext?.call_control_id && (
            <div className="mb-2 text-xs bg-accent-soft text-accent rounded-lg px-3 py-2 flex items-center gap-2">
              <span>📞</span>
              <span>Kopplat till samtal från {callContext.from_number || "okänt nummer"}</span>
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Skriv ditt förslag…"
            rows={3}
            className="w-full text-sm border border-line rounded-xl px-3 py-2.5 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-subtle">⌘ + Enter för att skicka</p>
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="bg-gradient-accent text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {sending ? "Skickar…" : "Skicka"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SuggestionBubble({ suggestion }) {
  const ts = suggestion.submitted_at;
  const time = ts?._seconds
    ? new Date(ts._seconds * 1000).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })
    : "nu";

  const statusBadge = {
    new: { cls: "bg-accent-soft text-accent", label: "Nytt" },
    reviewed: { cls: "bg-amber-100 text-amber-700", label: "Granskat" },
    applied: { cls: "bg-emerald-100 text-emerald-700", label: "Tillämpat" },
    rejected: { cls: "bg-slate-100 text-slate-600", label: "Avvisat" },
  }[suggestion.status || "new"];

  return (
    <div className="space-y-2">
      <div className="bg-white rounded-2xl border border-line p-3 shadow-card">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-subtle">{time}</span>
          {statusBadge && (
            <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          )}
        </div>
        <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{suggestion.text}</p>
        {suggestion.call_context?.from_number && (
          <p className="text-[10px] text-subtle mt-2">📞 från samtal {suggestion.call_context.from_number}</p>
        )}
      </div>
      {suggestion.admin_response && (
        <div className="bg-accent-soft rounded-2xl p-3 ml-6">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-accent mb-1">Svar från supportteamet</p>
          <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{suggestion.admin_response}</p>
        </div>
      )}
    </div>
  );
}
