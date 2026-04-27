"use client";
import { useState } from "react";

export function SettingsForm({ tenantId, initialSettings, isAdmin }) {
  const [summaryEmail, setSummaryEmail] = useState(initialSettings.summary_email || "");
  const [mode, setMode] = useState(initialSettings.summary_email_mode || "per_call");
  const [authorizedEmails, setAuthorizedEmails] = useState(
    (initialSettings.authorized_customer_emails || []).join(", "),
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const partial = {
        summary_email: summaryEmail || null,
        summary_email_mode: mode,
      };
      if (isAdmin) {
        partial.authorized_customer_emails = authorizedEmails
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
      }
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, ...partial }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Summary email destination</label>
        <input
          type="email"
          value={summaryEmail}
          onChange={(e) => setSummaryEmail(e.target.value)}
          placeholder="recipient@example.se"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
        <p className="text-xs text-gray-500 mt-1">
          Where post-call summaries get sent. Leave empty to disable.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Delivery mode</label>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value="per_call" checked={mode === "per_call"} onChange={() => setMode("per_call")} />
            One email per call (immediate)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="mode" value="daily_digest" checked={mode === "daily_digest"} onChange={() => setMode("daily_digest")} />
            Daily digest (one email/day with all calls)
          </label>
        </div>
      </div>

      {isAdmin && (
        <div>
          <label className="block text-sm font-medium text-ink mb-1">Authorized customer emails (admin only)</label>
          <textarea
            rows={3}
            value={authorizedEmails}
            onChange={(e) => setAuthorizedEmails(e.target.value)}
            placeholder="customer1@example.se, customer2@example.se"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
          />
          <p className="text-xs text-gray-500 mt-1">
            Comma-separated. These emails get scoped access to this tenant's dashboard.
            <br />
            Note: also requires backend env update <span className="mono">DASHBOARD_TENANT_EMAILS</span> to take effect (auto-loading from Firestore comes next sprint).
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="text-xs text-gray-500">
          {savedAt && <span className="text-green-700">Saved at {new Date(savedAt).toLocaleTimeString("sv-SE")}</span>}
          {error && <span className="text-red-600">{error}</span>}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
