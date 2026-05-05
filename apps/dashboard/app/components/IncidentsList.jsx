"use client";
import { useState, useMemo } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

// Which statuses are "open" (need attention or were auto-handled)
const OPEN_STATUSES = new Set(["new", "investigating", "patch_proposed", "auto_deployed", "investigated", "patch_failed"]);

// Build a recurrence map: service → count of incidents in the list
function buildRecurrenceMap(incidents) {
  const counts = {};
  for (const i of incidents) {
    const key = i.service || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function IncidentsList({ initial }) {
  const [incidents, setIncidents] = useState(initial || []);
  const [filter, setFilter]       = useState("open");
  const [expanded, setExpanded]   = useState(null);

  const recurrenceMap = useMemo(() => buildRecurrenceMap(incidents), [incidents]);

  const filtered = useMemo(() => {
    if (filter === "all")  return incidents;
    if (filter === "open") return incidents.filter((i) => OPEN_STATUSES.has(i.status || "new"));
    return incidents.filter((i) => (i.status || "new") === filter);
  }, [incidents, filter]);

  const counts = useMemo(() => {
    const c = { all: incidents.length, open: 0 };
    for (const i of incidents) {
      const s = i.status || "new";
      c[s] = (c[s] || 0) + 1;
      if (OPEN_STATUSES.has(s)) c.open++;
    }
    return c;
  }, [incidents]);

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
        <p className="text-sm text-muted mt-1">No incidents recorded yet.</p>
      </div>
    );
  }

  const TABS = [
    { key: "open",          label: "Open" },
    { key: "auto_deployed", label: "Auto-deployed" },
    { key: "patch_proposed",label: "Awaiting review" },
    { key: "resolved",      label: "Resolved" },
    { key: "ignored",       label: "Ignored" },
    { key: "all",           label: "All" },
  ];

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
              filter === key ? "bg-ink text-white" : "bg-line-soft text-muted hover:text-ink"
            }`}
          >
            {label}
            {counts[key] != null && (
              <span className="ml-1.5 opacity-60 tabular">({counts[key] || 0})</span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted py-6 text-center">No incidents with this filter.</p>
      )}

      <ul className="space-y-2">
        {filtered.map((inc) => {
          const ts = inc.created_at?._seconds
            ? new Date(inc.created_at._seconds * 1000).toLocaleString("sv-SE")
            : (inc.timestamp ? new Date(inc.timestamp).toLocaleString("sv-SE") : "?");
          const isOpen     = expanded === inc.id;
          const status     = inc.status || "new";
          const isRecurring = (recurrenceMap[inc.service] || 0) >= 3;

          return (
            <li key={inc.id} className="bg-surface border border-line rounded-lg overflow-hidden">
              <div className="flex items-stretch">
              <button
                onClick={() => setExpanded(isOpen ? null : inc.id)}
                className="flex-1 text-left px-5 py-4 hover:bg-line-soft/40 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-1">
                    <SeverityDot severity={inc.severity} status={status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3 mb-1">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="text-sm font-semibold text-ink">{inc.service || "unknown"}</span>
                        <StatusBadge status={status} risk={inc.patch_risk} />
                        {isRecurring && (
                          <span className="text-[10px] uppercase tracking-wider font-semibold text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                            recurring ×{recurrenceMap[inc.service]}
                          </span>
                        )}
                        {inc.tenant_id && (
                          <span className="text-[10px] mono text-subtle">{inc.tenant_id}</span>
                        )}
                      </div>
                      <span className="text-xs text-subtle tabular flex-shrink-0">{ts}</span>
                    </div>
                    <p className="text-sm text-muted leading-relaxed line-clamp-1">
                      {inc.ai?.summary || inc.message?.split("\n")[0] || "(no message)"}
                    </p>
                  </div>
                </div>
              </button>
              <Link
                href={`/admin/incidents/${inc.id}`}
                className="flex items-center px-3 border-l border-line text-subtle hover:text-ink hover:bg-line-soft/40 transition-colors text-xs"
                title="View full timeline"
              >
                →
              </Link>
              </div>

              {isOpen && (
                <div className="px-5 pb-5 pt-0 border-t border-line bg-line-soft/30 space-y-4">

                  {/* Patch-agent outcome */}
                  <div className="pt-4 space-y-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">Auto-patch outcome</div>

                    {status === "auto_deployed" && (
                      <div className="flex items-center gap-2 text-xs text-success">
                        <Icon name="check" size={13} />
                        <span>Auto-merged and deployed by patch-agent</span>
                        {inc.patch_pr_url && (
                          <a href={inc.patch_pr_url} target="_blank" rel="noopener noreferrer"
                            className="underline text-muted hover:text-ink ml-1">
                            PR #{inc.patch_pr_number}
                          </a>
                        )}
                      </div>
                    )}

                    {status === "patch_proposed" && inc.patch_pr_url && (
                      <a
                        href={inc.patch_pr_url}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-accent-soft text-accent border border-accent/20 hover:bg-accent hover:text-white transition-colors"
                      >
                        <Icon name="globe" size={11} />
                        View PR #{inc.patch_pr_number} — awaiting your review
                      </a>
                    )}

                    {status === "investigating" && (
                      <span className="text-xs text-muted italic">Claude is investigating…</span>
                    )}

                    {(status === "investigated" || status === "no_fix") && inc.patch_no_fix_reason && (
                      <p className="text-xs text-muted">{inc.patch_no_fix_reason}</p>
                    )}

                    {status === "patch_failed" && (
                      <p className="text-xs text-danger">{inc.patch_error || "Patch job failed"}</p>
                    )}

                    {inc.patch_analysis && (
                      <div className="text-xs text-ink leading-relaxed mt-1">
                        {inc.patch_analysis.slice(0, 400)}{inc.patch_analysis.length > 400 ? "…" : ""}
                      </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap mt-1">
                      {inc.patch_risk && <RiskBadge risk={inc.patch_risk} />}
                      {inc.patch_files_changed && (
                        <span className="text-[10px] mono text-subtle">{inc.patch_files_changed}</span>
                      )}
                      {inc.patch_iterations != null && (
                        <span className="text-[10px] text-subtle">{inc.patch_iterations} investigation steps</span>
                      )}
                    </div>
                  </div>

                  {/* Raw error */}
                  <div>
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

                  {/* Actions */}
                  <div className="flex gap-2 pt-1 flex-wrap">
                    {status !== "acknowledged" && status !== "resolved" && status !== "auto_deployed" && (
                      <button onClick={() => setStatus(inc.id, "acknowledged")}
                        className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink hover:border-ink">
                        Acknowledge
                      </button>
                    )}
                    {status !== "resolved" && (
                      <button onClick={() => setStatus(inc.id, "resolved")}
                        className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-success hover:border-success">
                        Mark resolved
                      </button>
                    )}
                    {status !== "ignored" && status !== "resolved" && (
                      <button onClick={() => setStatus(inc.id, "ignored")}
                        className="text-xs px-2.5 py-1 rounded-md border border-line text-muted hover:text-danger hover:border-danger">
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

function SeverityDot({ severity, status }) {
  if (status === "auto_deployed" || status === "resolved") {
    return <div className="w-1.5 h-1.5 rounded-full bg-success" title={status} />;
  }
  if (status === "ignored") {
    return <div className="w-1.5 h-1.5 rounded-full bg-subtle" title="ignored" />;
  }
  const cls = {
    EMERGENCY: "bg-danger", ALERT: "bg-danger", CRITICAL: "bg-danger", ERROR: "bg-danger",
    WARNING: "bg-warning",
  }[severity?.toUpperCase()] || "bg-subtle";
  return <div className={`w-1.5 h-1.5 rounded-full ${cls}`} title={severity} />;
}

function StatusBadge({ status, risk }) {
  const map = {
    new:            { label: "New",           cls: "bg-danger/10 text-danger" },
    investigating:  { label: "Investigating", cls: "bg-warning/10 text-warning" },
    auto_deployed:  { label: "Auto-deployed", cls: "bg-success/10 text-success" },
    patch_proposed: { label: "Awaiting review", cls: "bg-accent/10 text-accent" },
    investigated:   { label: "Investigated",  cls: "bg-line-soft text-muted" },
    patch_failed:   { label: "Patch failed",  cls: "bg-danger/10 text-danger" },
    acknowledged:   { label: "Acknowledged",  cls: "bg-line-soft text-muted" },
    resolved:       { label: "Resolved",      cls: "bg-success/10 text-success" },
    ignored:        { label: "Ignored",       cls: "bg-line-soft text-subtle" },
  };
  const { label, cls } = map[status] || { label: status, cls: "bg-line-soft text-muted" };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  );
}

function RiskBadge({ risk }) {
  const cls = risk === "low"    ? "bg-success/10 text-success"
            : risk === "medium" ? "bg-warning/10 text-warning"
            :                     "bg-danger/10 text-danger";
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${cls}`}>
      {risk} risk
    </span>
  );
}
