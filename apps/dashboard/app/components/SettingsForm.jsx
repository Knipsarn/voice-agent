"use client";
import { useState, useEffect } from "react";

const DAYS = [
  { key: "mon", label: "Måndag" }, { key: "tue", label: "Tisdag" }, { key: "wed", label: "Onsdag" },
  { key: "thu", label: "Torsdag" }, { key: "fri", label: "Fredag" },
  { key: "sat", label: "Lördag" }, { key: "sun", label: "Söndag" },
];

function defaultBH() {
  return {
    enabled: false, timezone: "Europe/Stockholm",
    schedule: { mon: { open: "08:00", close: "17:00" }, tue: { open: "08:00", close: "17:00" }, wed: { open: "08:00", close: "17:00" }, thu: { open: "08:00", close: "17:00" }, fri: { open: "08:00", close: "17:00" }, sat: null, sun: null },
  };
}

export function SettingsForm({ tenantId, initialSettings, isAdmin, fortnoxConnected }) {
  const [summaryEmail, setSummaryEmail] = useState(initialSettings.summary_email || "");
  const [mode, setMode] = useState(initialSettings.summary_email_mode || "per_call");
  const [bh, setBh] = useState(initialSettings.business_hours || defaultBH());
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
        business_hours: bh,
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
    <form onSubmit={save} className="bg-surface border border-line rounded-lg p-6 space-y-5">
      <div>
        <label className="block text-sm font-medium text-ink mb-1">Summary email destination</label>
        <input
          type="email"
          value={summaryEmail}
          onChange={(e) => setSummaryEmail(e.target.value)}
          placeholder="recipient@example.se"
          className="w-full border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
        <p className="text-xs text-muted mt-1">Where post-call summaries get sent. Leave empty to disable.</p>
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
              className="w-full border border-line rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
            <p className="text-xs text-muted mt-1">
              Comma-separated. These emails get scoped access to this tenant&apos;s dashboard.
            </p>
          </div>

          {/* Fortnox customer picker */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">Fortnox customer (admin only)</label>
            {!fortnoxConnected ? (
              <p className="text-xs text-subtle italic">
                Connect Fortnox below to enable customer picker.
              </p>
            ) : fnLoading ? (
              <p className="text-xs text-subtle">Loading Fortnox customers…</p>
            ) : fnError ? (
              <div className="space-y-1">
                <p className="text-xs text-danger">{fnError}</p>
                <input
                  type="text"
                  value={fortnoxCustomerNumber}
                  onChange={(e) => setFortnoxCustomerNumber(e.target.value)}
                  placeholder="Enter customer number manually"
                  className="w-full border border-line rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
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
                  className="w-full border border-line rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
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
                  <p className="text-xs text-muted mono">Customer #{fortnoxCustomerNumber} selected</p>
                )}

                {showCreateForm && (
                  <div className="border border-line rounded-lg p-4 bg-line-soft space-y-3">
                    <p className="text-sm font-medium text-ink">New Fortnox customer</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-muted mb-1">Company name *</label>
                        <input
                          required
                          value={newCustomer.name}
                          onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                          className="w-full border border-line rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-muted mb-1">Org number</label>
                        <input
                          value={newCustomer.org_number}
                          onChange={(e) => setNewCustomer({ ...newCustomer, org_number: e.target.value })}
                          placeholder="556123-4567"
                          className="w-full border border-line rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-muted mb-1">Invoice email</label>
                        <input
                          type="email"
                          value={newCustomer.email}
                          onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                          className="w-full border border-line rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                    {fnError && <p className="text-xs text-danger">{fnError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={createFortnoxCustomer}
                        disabled={creating || !newCustomer.name}
                        className="bg-ink text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-ink/85 disabled:opacity-50"
                      >
                        {creating ? "Creating…" : "Create in Fortnox"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowCreateForm(false); setFortnoxCustomerNumber(""); }}
                        className="px-3 py-1.5 rounded text-sm text-muted hover:bg-line-soft"
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

      {/* Business hours */}
      <div className="pt-2 border-t border-line">
        <div className="flex items-center justify-between mb-3">
          <div>
            <label className="text-sm font-medium text-ink">Öppettider</label>
            <p className="text-xs text-muted mt-0.5">Agenten informerar uppringare utanför dessa tider om att ni är stängda.</p>
          </div>
          <button
            type="button"
            onClick={() => setBh(p => ({ ...p, enabled: !p.enabled }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${bh.enabled ? "bg-accent" : "bg-line"}`}
          >
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${bh.enabled ? "translate-x-4" : "translate-x-1"}`} />
          </button>
        </div>
        {bh.enabled && (
          <div className="space-y-2 pl-1">
            {DAYS.map(({ key, label }) => {
              const on = !!bh.schedule?.[key];
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <button type="button" onClick={() => setBh(p => ({ ...p, schedule: { ...p.schedule, [key]: on ? null : { open: "08:00", close: "17:00" } } }))}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${on ? "bg-accent border-accent text-white" : "border-line"}`}>
                    {on && <svg width="9" height="9" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>}
                  </button>
                  <span className="w-20 text-ink">{label}</span>
                  {on ? (
                    <div className="flex items-center gap-1.5 text-xs">
                      <input type="time" value={bh.schedule[key]?.open || "08:00"}
                        onChange={e => setBh(p => ({ ...p, schedule: { ...p.schedule, [key]: { ...p.schedule[key], open: e.target.value } } }))}
                        className="border border-line rounded px-2 py-1 mono focus:outline-none focus:border-accent" />
                      <span className="text-muted">–</span>
                      <input type="time" value={bh.schedule[key]?.close || "17:00"}
                        onChange={e => setBh(p => ({ ...p, schedule: { ...p.schedule, [key]: { ...p.schedule[key], close: e.target.value } } }))}
                        className="border border-line rounded px-2 py-1 mono focus:outline-none focus:border-accent" />
                    </div>
                  ) : (
                    <span className="text-xs text-subtle italic">Stängt</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-line">
        <div className="text-xs text-muted">
          {savedAt && <span className="text-success">Saved at {new Date(savedAt).toLocaleTimeString("sv-SE")}</span>}
          {error && <span className="text-danger">{error}</span>}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-ink/85 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
