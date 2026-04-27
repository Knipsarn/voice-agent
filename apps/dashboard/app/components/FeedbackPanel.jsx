"use client";
import { useState } from "react";

export function FeedbackPanel({ callControlId, initialFeedback, currentEmail }) {
  const [rating, setRating] = useState(initialFeedback?.rating || null);
  const [note, setNote] = useState(initialFeedback?.note || "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(initialFeedback?.at?._seconds || null);
  const [error, setError] = useState(null);

  async function submit(newRating) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_control_id: callControlId, rating: newRating, note, by: currentEmail }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setRating(newRating);
      setSavedAt(Math.floor(Date.now() / 1000));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const Btn = ({ value, label, icon, tone }) => {
    const active = rating === value;
    const baseTone = {
      good: active ? "bg-emerald-600 text-white border-emerald-600" : "border-line text-muted hover:border-emerald-300 hover:text-emerald-700",
      bad: active ? "bg-danger text-white border-danger" : "border-line text-muted hover:border-danger/40 hover:text-danger",
      followup: active ? "bg-warning text-white border-warning" : "border-line text-muted hover:border-warning/40 hover:text-warning",
      handled: active ? "bg-accent text-white border-accent" : "border-line text-muted hover:border-accent/40 hover:text-accent",
    }[tone];
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => submit(value)}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${baseTone}`}
      >
        <span className="text-base leading-none">{icon}</span>
        {label}
      </button>
    );
  };

  return (
    <section className="bg-surface rounded-2xl border border-line p-6 shadow-card">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-base font-semibold text-ink">Hur gick samtalet?</h2>
        {savedAt && !error && (
          <p className="text-xs text-emerald-700">✓ Sparat</p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Btn value="good" label="Bra" icon="✓" tone="good" />
        <Btn value="needs_followup" label="Behöver uppföljning" icon="⚠" tone="followup" />
        <Btn value="handled" label="Hanterat" icon="✔" tone="handled" />
        <Btn value="bad" label="Inte bra" icon="✗" tone="bad" />
      </div>

      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Eventuell anteckning…"
        className="w-full border border-line rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />

      <div className="flex items-center justify-end mt-2">
        <button
          type="button"
          disabled={saving || !rating}
          onClick={() => submit(rating)}
          className="text-xs text-muted hover:text-ink disabled:opacity-50"
        >
          Spara anteckning
        </button>
      </div>
    </section>
  );
}
