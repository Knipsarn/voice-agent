"use client";
import { useState } from "react";
import { Icon } from "./Icon";

export function IncidentsList({ initial }) {
  const [incidents, setIncidents] = useState(initial || []);
  const [filter, setFilter] = useState("new");
  const [expanded, setExpanded] = useState(null);

  const filtered = filter === "all" ? incidents : incidents.filter((i) => (i.status || "new") === filter);

  async function setStatus(id, status) {
    try {
      const res = await fetch(`/api/incidents/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIncidents((prev) => prev.map((i) => i.id === id ? { ...i, ...data } : i));
    } catch (err) {
      alert("Failed: " + err.message);
    }
  }

  if (incidents.length === 0) {
    return (
      <div className="bg-surface border border-line rounded-lg p-12 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-success/10 text-success mb-3">
          <Icon name="check" size={20} />
        </div>
        <h2 className="text-lg font-semibold text-ink tracking-tight">All clear</h2>
        <p className="text-sm text-muted mt-1">No incidents recorded yet. The error agent watches Cloud Logging in the background.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {["new", "acknowledged", "resolved", "ignored", "all"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              filter === f
                ? "bg-ink text-white"
                : "bg-line-soft text-muted hover:text-ink"
            }`}
          >
            {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
            <span className="ml-1.5 opacity-60 tabular">
              ({f === "all" ? incidents.length : incidents.filter((i) => (i.status || "new") === f).length})
            </span>
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {filtered.map((inc) => {
          const ts = inc.created_at?._seconds
            ? new Date(inc.created_at._seconds * 1000).toLocaleString("sv-SE")
            : (inc.timestamp ? new Date(inc.timestamp).toLocaleString("sv-SE") : "?");
          const isOpen = expanded === inc.id;

          return (
            <li key={inc.id} className="bg-surface border border-line rounded-lg overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : inc.id)}
                className="w-full text-left px-5 py-4 hover:bg-line-soft/40 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    <SeverityDot severity={inc.severity} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-sm font-semibold text-ink">{inc.service || "unknown"}</span>
                        {inc.ai?.category && (
                          <span className="text-[10px] uppercase tracking-wider font-semibold text-muted bg-line-soft px-1.5 py-0.5 rounded">
                            {inc.ai.category}
                          </span>
                        )}
                        {inc.tenant_id && (
                          <span className="text-[10px] mono text-subtle">{inc.tenant_id}</span>
                        )}
                      </div>
                      <span className="text-xs text-subtle tabular flex-shrink-0">{ts}</span>
                    </div>
                    <p className="text-sm text-ink leading-relaxed line-clamp-1">
                      {inc.ai?.summary || inc.message?.split("\n")[0] || "(no message)"}
                    </p>
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 pt-0 border-t border-line bg-line-soft/30 space-y-4">
                  {inc.ai && (
                    <div className="space-y-2 pt-4">
                      <KV label="Likely cause" value={inc.ai.likely_cause} />
                      <KV label="Suggested fix" value={inc.ai.suggested_fix} />
                      <KV label="Actionable?" value={inc.ai.is_actionable ? "Yes — needs developer action" : "No — likely transient"} />
                    </div>
                  )}

                  <div className="pt-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-1">Raw error</div>
                    <pre className="text-xs bg-surface border border-line rounded p-3 mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-auto">
{inc.message || "(no message)"}
                    </pre>
                  </div>

                  {inc.trace_id && (
                    <div className="text-xs text-muted">
                      <span className="text-subtle">trace_id:</span>{" "}
                      <span className="mono">{inc.trace_id}</span>
                    </div>
                  )}

                  {/* Patch agent status */}
                  {(inc.patch_result || inc.status === "investigating") && (
                    <div className="pt-2 space-y-1.5">
                      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">Auto-patch</div>
                      {inc.patch_pr_url ? (
                        <a
                          href={inc.patch_pr_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-accent-soft text-accent border border-accent/20 hover:bg-accent hover:text-white transition-colors"
                        >
                          <Icon name="globe" size={11} />
                          View PR #{inc.patch_pr_number}
                        </a>
                      ) : inc.status === "investigating" ? (
                        <span className="text-xs text-muted italic">Claude is investigating…</span>
                      ) : inc.patch_no_fix_reason ? (
                        <span className="text-xs text-muted">{inc.patch_no_fix_reason}</span>
                      ) : null}
                      {inc.patch_analysis && (
                        <div className="text-xs text-ink leading-relaxed">{inc.patch_analysis.slice(0, 300)}{inc.patch_analysis.length > 300 ? "…" : ""}</div>
                      )}
                      {inc.patch_risk && (
                        <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                          inc.patch_risk === "low" ? "bg-success/10 text-success" :
                          inc.patch_risk === "medium" ? "bg-warning/10 text-warning" :
                          "bg-danger/10 text-danger"
                        }`}>
                          {inc.patch_risk} risk
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    {!["investigating", "patch_proposed"].includes(inc.status) && (inc.status || "new") !== "acknowledged" && (
                      <button onClick={() => setStatus(inc.id, "acknowledged")} className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-ink">
                        Acknowledge
                      </button>
                    )}
                    {(inc.status || "new") !== "resolved" && (
                      <button onClick={() => setStatus(inc.id, "resolved")} className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-success hover:border-success">
                        Resolve
                      </button>
                    )}
                    {(inc.status || "new") !== "ignored" && (
                      <button onClick={() => setStatus(inc.id, "ignored")} className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-danger hover:border-danger">
                        Ignore
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SeverityDot({ severity }) {
  const cls = {
    EMERGENCY: "bg-danger",
    ALERT: "bg-danger",
    CRITICAL: "bg-danger",
    ERROR: "bg-danger",
    WARNING: "bg-warning",
  }[severity?.toUpperCase()] || "bg-subtle";
  return <div className={`w-1.5 h-1.5 rounded-full ${cls}`} title={severity}></div>;
}

function KV({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className="text-sm text-ink mt-0.5">{value}</div>
    </div>
  );
}
