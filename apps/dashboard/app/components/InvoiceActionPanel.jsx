"use client";
import { useState } from "react";

export function InvoiceActionPanel({ tenantId, month, initialInvoice }) {
  const [invoice, setInvoice] = useState(initialInvoice);
  const [loading, setLoading] = useState(null); // "create" | "send"
  const [error, setError] = useState(null);

  async function callAction(action) {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch("/api/billing/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, month, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInvoice(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(null);
    }
  }

  const status = invoice?.status || "not_invoiced";

  return (
    <div className="space-y-4">
      {/* Status badge */}
      <div className="flex items-center gap-3">
        <StatusBadge status={status} />
        {invoice?.fortnox_invoice_number && (
          <span className="text-sm text-gray-600 mono">
            Invoice #{invoice.fortnox_invoice_number}
          </span>
        )}
        {invoice?.created_at && (
          <span className="text-xs text-gray-400">
            Created {formatTs(invoice.created_at)}
          </span>
        )}
        {invoice?.sent_at && (
          <span className="text-xs text-gray-400">
            · Sent {formatTs(invoice.sent_at)}
          </span>
        )}
      </div>

      {invoice?.error && (
        <p className="text-xs text-red-600 bg-red-50 rounded p-2 font-mono">{invoice.error}</p>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 rounded p-2">{error}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {(status === "not_invoiced" || status === "failed") && (
          <button
            onClick={() => callAction("create")}
            disabled={loading === "create"}
            className="bg-ink text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {loading === "create" ? "Creating…" : "Create invoice"}
          </button>
        )}
        {status === "created" && (
          <button
            onClick={() => callAction("send")}
            disabled={loading === "send"}
            className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 disabled:opacity-50"
          >
            {loading === "send" ? "Sending…" : "Send via Fortnox"}
          </button>
        )}
        {status === "sent" && (
          <span className="text-sm text-green-700 font-medium">Invoice sent via Fortnox</span>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    not_invoiced: ["bg-gray-100 text-gray-600", "Not invoiced"],
    created: ["bg-blue-100 text-blue-700", "Created in Fortnox"],
    sent: ["bg-green-100 text-green-700", "Sent"],
    failed: ["bg-red-100 text-red-700", "Failed"],
  };
  const [cls, label] = map[status] || ["bg-gray-100 text-gray-600", status];
  return (
    <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${cls}`}>{label}</span>
  );
}

function formatTs(ts) {
  if (!ts) return "";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleDateString("sv-SE");
}
