"use client";
import { useState, useEffect } from "react";

export function SettingsForm({ tenantId, initialSettings, isAdmin, fortnoxConnected }) {
  const [summaryEmail, setSummaryEmail] = useState(initialSettings.summary_email || "");
  const [mode, setMode] = useState(initialSettings.summary_email_mode || "per_call");
  const [authorizedEmails, setAuthorizedEmails] = useState(
    (initialSettings.authorized_customer_emails || []).join(", "),
  );
  const [fortnoxCustomerNumber, setFortnoxCustomerNumber] = useState(
    initialSettings.fortnox_customer_number || "",
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);

  // Fortnox customer picker
  const [fnCustomers, setFnCustomers] = useState(null);
  const [fnLoading, setFnLoading] = useState(false);
  const [fnError, setFnError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", org_number: "", email: "" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isAdmin || !fortnoxConnected) return;
    setFnLoading(true);
    fetch("/api/billing/customers")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setFnCustomers(d.customers || []);
      })
      .catch((err) => setFnError(err.message))
      .finally(() => setFnLoading(false));
  }, [isAdmin, fortnoxConnected]);

  async function createFortnoxCustomer(e) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/billing/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCustomer),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFnCustomers((prev) => [...(prev || []), {
        customer_number: data.customer_number,
        name: data.name,
        org_number: data.org_number,
        email: data.email,
      }]);
      setFortnoxCustomerNumber(data.customer_number);
      setShowCreateForm(false);
      setNewCustomer({ name: "", org_number: "", email: "" });
    } catch (err) {
      setFnError(err.message);
    } finally {
      setCreating(false);
    }
  }

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
        partial.fortnox_customer_number = fortnoxCustomerNumber || null;
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
        <p className="text-xs text-gray-500 mt-1">Where post-call summaries get sent. Leave empty to disable.</p>
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
        <>
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
              Comma-separated. These emails get scoped access to this tenant&apos;s dashboard.
            </p>
          </div>

          {/* Fortnox customer picker */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Fortnox customer (admin only)</label>
            {!fortnoxConnected ? (
              <p className="text-xs text-gray-400 italic">
                Connect Fortnox below to enable customer picker.
              </p>
            ) : fnLoading ? (
              <p className="text-xs text-gray-400">Loading Fortnox customers…</p>
            ) : fnError ? (
              <div className="space-y-1">
                <p className="text-xs text-red-600">{fnError}</p>
                <input
                  type="text"
                  value={fortnoxCustomerNumber}
                  onChange={(e) => setFortnoxCustomerNumber(e.target.value)}
                  placeholder="Enter customer number manually"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={fortnoxCustomerNumber}
                  onChange={(e) => {
                    if (e.target.value === "__create__") {
                      setShowCreateForm(true);
                    } else {
                      setFortnoxCustomerNumber(e.target.value);
                      setShowCreateForm(false);
                    }
                  }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                >
                  <option value="">— Select Fortnox customer —</option>
                  {(fnCustomers || []).map((c) => (
                    <option key={c.customer_number} value={c.customer_number}>
                      {c.name} (#{c.customer_number})
                    </option>
                  ))}
                  <option value="__create__">+ Create new customer in Fortnox…</option>
                </select>

                {fortnoxCustomerNumber && fortnoxCustomerNumber !== "__create__" && (
                  <p className="text-xs text-gray-500 mono">Customer #{fortnoxCustomerNumber} selected</p>
                )}

                {showCreateForm && (
                  <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 space-y-3">
                    <p className="text-sm font-medium text-ink">New Fortnox customer</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Company name *</label>
                        <input
                          required
                          value={newCustomer.name}
                          onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Org number</label>
                        <input
                          value={newCustomer.org_number}
                          onChange={(e) => setNewCustomer({ ...newCustomer, org_number: e.target.value })}
                          placeholder="556123-4567"
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-gray-500 mb-1">Invoice email</label>
                        <input
                          type="email"
                          value={newCustomer.email}
                          onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    {fnError && <p className="text-xs text-red-600">{fnError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={createFortnoxCustomer}
                        disabled={creating || !newCustomer.name}
                        className="bg-ink text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                      >
                        {creating ? "Creating…" : "Create in Fortnox"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowCreateForm(false); setFortnoxCustomerNumber(""); }}
                        className="px-3 py-1.5 rounded text-sm text-gray-600 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
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
