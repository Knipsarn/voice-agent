"use client";
import { useState } from "react";
import { Icon } from "./Icon";

export function SuggestionPanel({ open, onClose, tenantId, callContext, category }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  const resolvedCategory = category || (callContext ? "prompt" : "other");

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
          category: resolvedCategory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDone(true);
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

  function handleClose() {
    setDone(false);
    setText("");
    setError(null);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-ink/30 backdrop-blur-sm" onClick={handleClose} />
      <div className="w-full max-w-md bg-surface shadow-elevated flex flex-col border-l border-line">

        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink tracking-tight">
              {callContext ? "Förbättra agentsvaret" : "Nytt ärende"}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {callContext
                ? "Berätta vad agenten borde ha gjort annorlunda. En mänsklig utvecklare granskar förslaget."
                : "Vår AI-agent hanterar enkla ärenden direkt. Komplexa frågor eskaleras till teamet."}
            </p>
          </div>
          <button onClick={handleClose} className="text-muted hover:text-ink p-1 -m-1 ml-3">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-5 flex flex-col justify-center">
          {done ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-full bg-success/10 text-success flex items-center justify-center mx-auto mb-4">
                <Icon name="check" size={22} />
              </div>
              <p className="text-base font-semibold text-ink">Skickat!</p>
              <p className="text-sm text-muted mt-2 leading-relaxed">
                Du ser status och svar under{" "}
                <a href="/support" className="text-accent hover:underline" onClick={handleClose}>
                  Support
                </a>.
              </p>
              <button
                onClick={() => { setDone(false); setText(""); }}
                className="mt-5 text-xs text-muted hover:text-ink border border-line rounded-lg px-3 py-1.5"
              >
                Skicka ett till
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {callContext?.call_control_id && (
                <div className="text-xs bg-accent/5 text-accent border border-accent/20 rounded-lg px-3 py-2 flex items-center gap-2">
                  <Icon name="phone" size={13} />
                  <span>Kopplat till samtal från {callContext.from_number || "okänt nummer"}</span>
                </div>
              )}
              <textarea
                value={text}
                onChange={e => { setText(e.target.value); setError(null); }}
                onKeyDown={onKeyDown}
                placeholder={callContext
                  ? "Beskriv vad agenten borde ha sagt eller gjort annorlunda…"
                  : "Beskriv vad du vill rapportera eller förbättra…"}
                rows={6}
                className="w-full text-sm text-ink border border-line rounded-lg px-3 py-3 focus:outline-none focus:border-accent resize-none placeholder:text-subtle"
                autoFocus
              />
              {error && <p className="text-xs text-danger">{error}</p>}
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-subtle">⌘ + Enter för att skicka</p>
                <button
                  onClick={send}
                  disabled={sending || !text.trim()}
                  className="inline-flex items-center gap-1.5 bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ink/85 disabled:opacity-40 transition-colors"
                >
                  {sending ? "Skickar…" : <><Icon name="send" size={13} /> Skicka</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
