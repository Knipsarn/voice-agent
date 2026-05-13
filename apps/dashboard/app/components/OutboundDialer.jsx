"use client";
import { useState } from "react";

export function OutboundDialer({ tenantId }) {
  const [phone, setPhone] = useState("+46");
  const [ownerName, setOwnerName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function handleDial(e) {
    e.preventDefault();
    if (!/^\+\d{8,15}$/.test(phone)) {
      setError("Ange ett giltigt E.164-nummer (t.ex. +46701234567)");
      return;
    }
    setCalling(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/outbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: tenantId,
          to: phone,
          lead_name: ownerName || undefined,
          lead_business: businessName || undefined,
          lead_website: website || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.detail || `HTTP ${res.status}`);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCalling(false);
    }
  }

  return (
    <section className="bg-surface border border-line rounded-xl p-6">
      <p className="text-xs uppercase tracking-widest text-muted font-semibold mb-1">Manuell uppringning</p>
      <h2 className="text-lg font-semibold text-ink tracking-tight mb-1">Ring ett lead</h2>
      <p className="text-sm text-muted mb-5">
        Ulrika ringer direkt till numret du anger och personaliserar samtalet med leadets information.
      </p>

      <form onSubmit={handleDial} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-medium">Kontaktperson</label>
            <input
              type="text"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              placeholder="Johan Svensson"
              className="text-sm text-ink bg-canvas border border-line rounded-lg px-3 py-2 placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={calling}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted font-medium">Företag</label>
            <input
              type="text"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              placeholder="Svensson Plåt AB"
              className="text-sm text-ink bg-canvas border border-line rounded-lg px-3 py-2 placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={calling}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted font-medium">Hemsida</label>
          <input
            type="url"
            value={website}
            onChange={e => setWebsite(e.target.value)}
            placeholder="https://svenssonplat.se"
            className="text-sm text-ink bg-canvas border border-line rounded-lg px-3 py-2 placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={calling}
          />
        </div>
        <div className="flex items-stretch gap-3">
          <input
            type="tel"
            value={phone}
            onChange={e => { setPhone(e.target.value); setError(null); }}
            placeholder="+46701234567"
            className="flex-1 text-base text-ink bg-canvas border border-line rounded-lg px-3 py-2.5 mono placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
            disabled={calling}
          />
          <button
            type="submit"
            disabled={calling || !phone}
            className="inline-flex items-center gap-2 bg-success text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-success/85 disabled:opacity-40 transition-colors"
          >
            {calling ? "Ringer…" : "📞 Ring"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 bg-danger/5 border border-danger/20 text-danger text-sm rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 bg-success/5 border border-success/20 text-success text-sm rounded-lg px-3 py-2.5">
          <p className="font-medium">✓ Samtal initierat</p>
          <p className="text-xs text-muted mt-1 mono">
            {result.from} → {result.to}
          </p>
          <p className="text-xs text-muted mt-0.5 mono">trace: {result.trace_id?.slice(0, 8)}</p>
        </div>
      )}
    </section>
  );
}
