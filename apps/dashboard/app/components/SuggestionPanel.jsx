"use client";
import { useState, useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function SuggestionPanel({ open, onClose, tenantId, callContext, category }) {
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
        setSuggestions((d.suggestions || []).reverse());
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
          category: category || (callContext ? "prompt" : "other"),
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
      <div className="flex-1 bg-ink/30 backdrop-blur-sm animate-fade-in" onClick={onClose}></div>
      <div className="w-full max-w-md bg-surface shadow-elevated flex flex-col animate-slide-in-right border-l border-line">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink tracking-tight">
            {callContext ? "Förbättra agentens svar" : "Förbättringsförslag"}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            {callContext
              ? "Berätta vad agenten borde ha sagt eller gjort annorlunda i detta samtal. En mänsklig utvecklare granskar förslaget."
              : "Berätta vad du vill ändra. Vår AI-agent hanterar förslaget direkt."}
          </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink p-1 -m-1">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-paper">
          {loading && <p className="text-xs text-subtle text-center">Laddar tidigare förslag…</p>}

          {!loading && suggestions.length === 0 && (
            <div className="text-center py-12 px-2">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-line-soft text-subtle mb-3">
                <Icon name="message" size={18} />
              </div>
              <p className="text-sm text-muted">
                Skicka ditt första förslag.
              </p>
              <p className="text-xs text-subtle mt-2 italic">
                T.ex. &quot;Aila ska fråga om ärendetyp innan hon föreslår tid&quot;
              </p>
            </div>
          )}

          {suggestions.map((s) => (
            <SuggestionBubble key={s.id} suggestion={s} />
          ))}

          {error && (
            <div className="bg-danger/[0.06] border border-danger/20 text-danger text-xs rounded-md p-3">{error}</div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-line bg-surface p-4">
          {callContext?.call_control_id && (
            <div className="mb-2 text-xs bg-accent-soft text-accent rounded-md px-3 py-2 flex items-center gap-2">
              <Icon name="phone" size={13} />
              <span>Kopplat till samtal från {callContext.from_number || "okänt nummer"}</span>
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Skriv ditt förslag…"
            rows={3}
            className="w-full text-sm border border-line rounded-md px-3 py-2.5 focus:outline-none focus:border-accent focus-ring resize-none"
          />
          <div className="flex items-center justify-between mt-2">
            <p className="text-[10px] text-subtle uppercase tracking-wider">⌘ + Enter</p>
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="bg-ink text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-ink/85 disabled:opacity-40 transition-opacity inline-flex items-center gap-1.5"
            >
              {sending ? "Skickar…" : (
                <>
                  <Icon name="send" size={13} /> Skicka
                </>
              )}
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
    new: { cls: "text-accent bg-accent-soft", label: "Nytt" },
    reviewed: { cls: "text-warning bg-warning/10", label: "Granskat" },
    applied: { cls: "text-success bg-success/10", label: "Tillämpat" },
    rejected: { cls: "text-muted bg-line-soft", label: "Avvisat" },
  }[suggestion.status || "new"];

  return (
    <div className="space-y-2">
      <div className="bg-surface rounded-md border border-line p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-subtle tabular">{time}</span>
          {statusBadge && (
            <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
          )}
        </div>
        <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{suggestion.text}</p>
        {suggestion.call_context?.from_number && (
          <p className="text-[10px] text-subtle mt-2 mono">{suggestion.call_context.from_number}</p>
        )}
      </div>
      {suggestion.admin_response && (
        <div className="bg-accent-soft/60 rounded-md p-3 ml-6 border border-accent/10">
          <p className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-1">Svar från supportteamet</p>
          <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{suggestion.admin_response}</p>
        </div>
      )}
    </div>
  );
}
