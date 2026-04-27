"use client";
import { useState, useEffect } from "react";

export function FortnoxCustomersPanel() {
  const [customers, setCustomers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // New customer form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", org_number: "", email: "", city: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    fetch("/api/billing/customers")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setCustomers(d.customers || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [created]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/billing/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCreated(data);
      setShowForm(false);
      setForm({ name: "", org_number: "", email: "", city: "" });
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading Fortnox customers…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      {created && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">
          Created customer <span className="font-medium">{created.name}</span> — customer number{" "}
          <span className="mono font-semibold">{created.customer_number}</span>. Copy this number into Settings → Fortnox customer number for the tenant.
        </div>
      )}

      {/* Customer table */}
      {customers.length === 0 ? (
        <p className="text-sm text-gray-500">No customers in Fortnox yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-gray-500 uppercase text-xs tracking-wider">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Org number</th>
                <th className="px-4 py-2">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {customers.map((c) => (
                <tr key={c.customer_number}>
                  <td className="px-4 py-2 mono font-semibold text-accent">{c.customer_number}</td>
                  <td className="px-4 py-2">{c.name}</td>
                  <td className="px-4 py-2 mono text-gray-500">{c.org_number || "—"}</td>
                  <td className="px-4 py-2 text-gray-500">{c.email || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add customer */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="text-sm text-accent hover:underline"
        >
          + Create new Fortnox customer
        </button>
      ) : (
        <form onSubmit={handleCreate} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
          <p className="text-sm font-medium text-ink">New Fortnox customer</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Company name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Org number</label>
              <input
                value={form.org_number}
                onChange={(e) => setForm({ ...form, org_number: e.target.value })}
                placeholder="556123-4567"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">City</label>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="bg-ink text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {creating ? "Creating…" : "Create in Fortnox"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 rounded text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
