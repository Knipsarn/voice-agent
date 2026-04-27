"use client";
import { useState } from "react";
import { Icon } from "./Icon";

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

  const Btn = ({ value, label, tone }) => {
    const active = rating === value;
    const cls = {
      good: active ? "bg-success text-white border-success" : "border-line text-muted hover:border-success/40 hover:text-success",
      bad: active ? "bg-danger text-white border-danger" : "border-line text-muted hover:border-danger/40 hover:text-danger",
      followup: active ? "bg-warning text-white border-warning" : "border-line text-muted hover:border-warning/40 hover:text-warning",
      handled: active ? "bg-accent text-white border-accent" : "border-line text-muted hover:border-accent/40 hover:text-accent",
    }[tone];
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => submit(value)}
        className={`px-3.5 py-2 rounded-md text-sm font-medium transition border ${cls}`}
      >
        {label}
      </button>
    );
  };

  return (
    <section className="bg-surface border border-line rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">Hur gick samtalet?</h2>
        {savedAt && !error && (
          <p className="text-xs text-success inline-flex items-center gap-1">
            <Icon name="check" size={12} />
            Sparat
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Btn value="good" label="Bra" tone="good" />
        <Btn value="needs_followup" label="Behöver uppföljning" tone="followup" />
        <Btn value="handled" label="Hanterat" tone="handled" />
        <Btn value="bad" label="Inte bra" tone="bad" />
      </div>

      <textarea
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Eventuell anteckning…"
        className="w-full border border-line rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:border-accent focus-ring"
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
