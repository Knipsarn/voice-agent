"use client";

import { useState } from "react";

export function PromptSuggestionForm({ tenantId }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, text: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSubmitted(true);
      setText("");
    } catch (err) {
      setError(err.message || "Något gick fel. Försök igen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="bg-surface border border-line rounded-lg p-6">
      <h2 className="text-xs uppercase tracking-widest text-muted font-semibold mb-4">
        Föreslå en ändring till din agent
      </h2>

      {submitted ? (
        <p className="text-sm text-ink">
          Tack! Din förfrågan har skickats. Vi granskar den och återkommer.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setError(null); }}
            placeholder="Beskriv vad du vill ändra eller förbättra..."
            rows={4}
            maxLength={4000}
            className="w-full text-sm text-ink bg-canvas border border-line rounded-md px-3 py-2 placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent/60 resize-y"
          />
          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-subtle tabular">
              {text.length}/4000
            </span>
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="inline-flex items-center gap-1.5 bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
            >
              {submitting ? "Skickar..." : "Skicka förslag"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
