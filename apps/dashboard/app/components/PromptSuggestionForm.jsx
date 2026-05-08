"use client";
import { useState } from "react";

const CATEGORIES = [
  { id: "prompt",    label: "Agentens svar",   desc: "Vad agenten säger, dess personlighet, kunskapsbas" },
  { id: "call",      label: "Samtalsinställning", desc: "Röst, modell, svarshastighet" },
  { id: "dashboard", label: "Dashboard",        desc: "Förbättringar i plattformsgränssnittet" },
  { id: "ai_info",   label: "AI-information",   desc: "Fakta agenten ska känna till om er verksamhet" },
  { id: "other",     label: "Övrigt",           desc: "Annat" },
];

export function PromptSuggestionForm({ tenantId }) {
  const [category, setCategory] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!text.trim() || !category) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, text: text.trim(), category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSubmitted(true);
      setText("");
      setCategory("");
    } catch (err) {
      setError(err.message || "Något gick fel. Försök igen.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <section className="bg-surface border border-line rounded-lg p-6">
        <h2 className="text-xs uppercase tracking-widest text-muted font-semibold mb-4">Föreslå en ändring</h2>
        <div className="text-center py-4">
          <div className="text-2xl mb-2">✓</div>
          <p className="text-sm font-medium text-ink">Skickat!</p>
          <p className="text-xs text-muted mt-1">Vår AI-agent granskar din förfrågan direkt. Statusen visas under "Mina förslag".</p>
          <button onClick={() => setSubmitted(false)} className="mt-4 text-xs text-accent hover:text-accent-hover">
            Skicka ett till
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-surface border border-line rounded-lg p-6">
      <h2 className="text-xs uppercase tracking-widest text-muted font-semibold mb-4">
        Skicka en förfrågan
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Step 1: Category */}
        <div>
          <p className="text-xs text-muted mb-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-accent mr-1.5">1</span>
            Vad gäller det?
          </p>
          <div className="grid grid-cols-1 gap-1.5">
            {CATEGORIES.map(c => (
              <label key={c.id} className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                category === c.id ? "border-accent bg-accent/5" : "border-line hover:border-accent/40"
              }`}>
                <input
                  type="radio"
                  name="category"
                  value={c.id}
                  checked={category === c.id}
                  onChange={() => setCategory(c.id)}
                  className="mt-0.5 accent-accent"
                />
                <div>
                  <span className="text-sm font-medium text-ink">{c.label}</span>
                  <span className="text-xs text-muted ml-2">{c.desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Step 2: Text — only show after category picked */}
        {category && (
          <div>
            <p className="text-xs text-muted mb-2">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-accent mr-1.5">2</span>
              Beskriv vad du vill ändra
            </p>
            <textarea
              value={text}
              onChange={e => { setText(e.target.value); setError(null); }}
              placeholder="Beskriv så tydligt som möjligt vad som behöver ändras och varför..."
              rows={4}
              maxLength={4000}
              className="w-full text-sm text-ink bg-canvas border border-line rounded-lg px-3 py-2.5 placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent/60 resize-y"
            />
            {error && <p className="text-xs text-danger mt-1">{error}</p>}
            <div className="flex items-center justify-between mt-2">
              <span className="text-[10px] text-subtle tabular">{text.length}/4000</span>
              <button
                type="submit"
                disabled={submitting || !text.trim()}
                className="inline-flex items-center gap-1.5 bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ink/85 transition-colors disabled:opacity-50"
              >
                {submitting ? "Skickar…" : "Skicka"}
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
