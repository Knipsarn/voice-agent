"use client";
import { useState, useEffect } from "react";

export function AdminSuggestionsInbox({ tenants }) {
  const [allSuggestions, setAllSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("new");
  const [responding, setResponding] = useState(null);
  const [responseText, setResponseText] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function fetchAll() {
      try {
        const results = await Promise.all(
          tenants.map((t) =>
            fetch(`/api/suggestions?tenant=${encodeURIComponent(t.tenant_id)}`)
              .then((r) => r.json())
              .then((d) => (d.suggestions || []).map((s) => ({ ...s, tenant_id: t.tenant_id, company_name: t.company_name })))
              .catch(() => []),
          ),
        );
        if (cancelled) return;
        const combined = results.flat();
        combined.sort((a, b) => {
          const ta = a.submitted_at?._seconds || 0;
          const tb = b.submitted_at?._seconds || 0;
          return tb - ta;
        });
        setAllSuggestions(combined);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [tenants]);

  const filtered = filter === "all" ? allSuggestions : allSuggestions.filter((s) => s.status === filter);

  async function updateStatus(suggestion, newStatus, text) {
    try {
      const res = await fetch(`/api/suggestions/${suggestion.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: suggestion.tenant_id,
          status: newStatus,
          ...(text !== undefined && { admin_response: text }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAllSuggestions((prev) => prev.map((s) => s.id === suggestion.id ? { ...s, ...data } : s));
      setResponding(null);
      setResponseText("");
    } catch (err) {
      alert("Failed: " + err.message);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading suggestions…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {["new", "reviewed", "applied", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f
                ? "bg-ink text-white"
                : "bg-paper text-muted hover:text-ink"
            }`}
          >
            {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            <span className="ml-1.5 opacity-60">
              ({f === "all" ? allSuggestions.length : allSuggestions.filter((s) => s.status === f).length})
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted text-center py-8">No suggestions in this view.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((s) => {
            const ts = s.submitted_at?._seconds
              ? new Date(s.submitted_at._seconds * 1000).toLocaleString("sv-SE")
              : "?";
            return (
              <li key={s.id} className="bg-surface border border-line rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink">{s.company_name || s.tenant_id}</span>
                    <span className="text-xs text-subtle">·</span>
                    <span className="text-xs text-muted">{s.submitted_by || "anon"}</span>
                  </div>
                  <span className="text-xs text-subtle">{ts}</span>
                </div>
                <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{s.text}</p>
                {s.call_context?.call_control_id && (
                  <a
                    href={`/calls/${encodeURIComponent(s.call_context.call_control_id)}`}
                    className="text-xs text-accent hover:underline inline-block mt-2"
                  >
                    📞 View call from {s.call_context.from_number}
                  </a>
                )}
                {s.admin_response && (
                  <div className="bg-accent-soft rounded-lg p-3 mt-3">
                    <p className="text-[10px] uppercase tracking-wider text-accent font-semibold mb-1">Your response</p>
                    <p className="text-sm text-ink">{s.admin_response}</p>
                  </div>
                )}
                {responding === s.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Reply to tenant…"
                      rows={2}
                      className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => { setResponding(null); setResponseText(""); }} className="text-xs text-muted px-2 py-1">Cancel</button>
                      <button
                        onClick={() => updateStatus(s, "reviewed", responseText)}
                        className="bg-accent text-white text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-accent-hover"
                      >
                        Send + mark reviewed
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 mt-3">
                    {s.status !== "applied" && (
                      <button onClick={() => updateStatus(s, "applied")} className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-ink">
                        Mark applied
                      </button>
                    )}
                    <button onClick={() => { setResponding(s.id); setResponseText(s.admin_response || ""); }} className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-ink">
                      Respond
                    </button>
                    {s.status !== "rejected" && (
                      <button onClick={() => updateStatus(s, "rejected")} className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-danger hover:border-danger">
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
