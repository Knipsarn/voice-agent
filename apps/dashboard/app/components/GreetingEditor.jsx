"use client";
import { useState } from "react";
import { Icon } from "./Icon";

export function GreetingEditor({ tenantId, initialGreeting, fallbackGreeting, isOverride }) {
  const [text, setText] = useState(initialGreeting || "");
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const dirty = text !== initialGreeting;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          first_message: text.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setText(fallbackGreeting || "");
  }

  return (
    <section className="bg-surface border border-line rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">Hälsningsfras</h2>
        {isOverride && (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-accent bg-accent-soft px-2 py-0.5 rounded">
            Anpassad
          </span>
        )}
      </div>
      <p className="text-sm text-muted mb-4">
        Detta är de första orden din AI-assistent säger när någon ringer. Ändringar gäller från och med nästa samtal.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Hej och välkommen…"
        className="w-full text-sm border border-line rounded-md px-3 py-2.5 focus:outline-none focus:border-accent focus-ring resize-none leading-relaxed"
      />

      <div className="flex items-center justify-between mt-3">
        <div className="text-xs text-muted">
          {savedAt && !error && <span className="text-success inline-flex items-center gap-1"><Icon name="check" size={12} /> Sparat</span>}
          {error && <span className="text-danger">{error}</span>}
          {!savedAt && !error && dirty && <span>Osparade ändringar</span>}
        </div>
        <div className="flex gap-2">
          {isOverride && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted hover:text-ink px-2 py-1.5"
            >
              Återställ standard
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="bg-ink text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-ink/85 disabled:opacity-40 transition-opacity"
          >
            {saving ? "Sparar…" : "Spara hälsning"}
          </button>
        </div>
      </div>
    </section>
  );
}
