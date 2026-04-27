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

  const Btn = ({ value, label, color }) => (
    <button
      type="button"
      disabled={saving}
      onClick={() => submit(value)}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition border ${
        rating === value
          ? color === "green"
            ? "bg-green-600 text-white border-green-600"
            : color === "red"
            ? "bg-red-600 text-white border-red-600"
            : "bg-amber-500 text-white border-amber-500"
          : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-medium text-ink">Your feedback</h2>
        <p className="text-xs text-gray-400">
          Helps your operator improve the agent. Does not auto-train the AI.
        </p>
      </div>

      <div className="flex gap-2 mb-4">
        <Btn value="good" label="✓ Good call" color="green" />
        <Btn value="bad" label="✗ Bad call" color="red" />
        <Btn value="needs_followup" label="⚠ Needs follow-up" color="amber" />
      </div>

      <textarea
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note — what was wrong, what should have happened, etc."
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-accent"
      />

      <div className="flex items-center justify-between mt-3">
        <button
          type="button"
          disabled={saving || !rating}
          onClick={() => submit(rating)}
          className="text-xs text-gray-500 hover:text-ink disabled:opacity-50"
        >
          Save note
        </button>
        <div className="text-xs text-gray-400">
          {error && <span className="text-red-600">{error}</span>}
          {!error && savedAt && <span>Saved {new Date(savedAt * 1000).toLocaleString("sv-SE")}</span>}
        </div>
      </div>
    </section>
  );
}
