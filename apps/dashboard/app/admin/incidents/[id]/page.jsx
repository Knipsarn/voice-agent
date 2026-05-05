import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";

import { authOptions }  from "@/lib/auth-config";
import { userScope }    from "@/lib/tenant-map";
import { getIncident }  from "@/lib/control-plane";
import { AppShell }     from "../../../components/AppShell";

export const dynamic = "force-dynamic";

function ts(t) {
  if (!t) return "—";
  const ms = t._seconds ? t._seconds * 1000 : t.seconds ? t.seconds * 1000 : new Date(t).getTime();
  return new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "medium" });
}
function tsShort(t) {
  if (!t) return "?";
  const ms = t._seconds ? t._seconds * 1000 : t.seconds ? t.seconds * 1000 : new Date(t).getTime();
  return new Date(ms).toLocaleDateString("sv-SE");
}

const STATUS_LABEL = {
  new:            "New",
  investigating:  "Investigating",
  auto_deployed:  "Auto-deployed",
  patch_proposed: "Awaiting review",
  patch_failed:   "Patch failed",
  investigated:   "Investigated",
  acknowledged:   "Acknowledged",
  resolved:       "Resolved",
  ignored:        "Ignored",
};
const STATUS_CLS = {
  new:            "bg-danger/10 text-danger",
  investigating:  "bg-warning/10 text-warning",
  auto_deployed:  "bg-success/10 text-success",
  patch_proposed: "bg-accent/10 text-accent",
  patch_failed:   "bg-danger/10 text-danger",
  investigated:   "bg-line-soft text-muted",
  acknowledged:   "bg-line-soft text-muted",
  resolved:       "bg-success/10 text-success",
  ignored:        "bg-line-soft text-subtle",
};

export default async function IncidentDetailPage({ params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const { id } = params;
  const data = await getIncident(id).catch(() => null);
  if (!data) {
    return (
      <AppShell email={session.user.email} admin={true}>
        <div className="max-w-3xl mx-auto px-6 py-12 text-center text-muted">Incident not found.</div>
      </AppShell>
    );
  }

  const { incident: inc, history } = data;
  const status = inc.status || "new";

  return (
    <AppShell email={session.user.email} admin={true}>
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12 space-y-8">

        {/* Back */}
        <Link href="/admin/incidents" className="text-xs text-muted hover:text-ink transition-colors">
          ← All incidents
        </Link>

        {/* Header */}
        <header>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${STATUS_CLS[status] || "bg-line-soft text-muted"}`}>
              {STATUS_LABEL[status] || status}
            </span>
            {inc.severity && (
              <span className="text-[11px] uppercase tracking-wider text-muted font-semibold">{inc.severity}</span>
            )}
            {inc.patch_risk && (
              <span className={`text-[11px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                inc.patch_risk === "low"    ? "bg-success/10 text-success" :
                inc.patch_risk === "medium" ? "bg-warning/10 text-warning" :
                                              "bg-danger/10 text-danger"
              }`}>
                {inc.patch_risk} risk
              </span>
            )}
          </div>
          <h1 className="text-3xl font-semibold text-ink tracking-tightest">{inc.service || "unknown"}</h1>
          <p className="text-sm text-muted mt-1 tabular">{ts(inc.created_at)} · <span className="mono text-xs">{inc.id}</span></p>
          {inc.tenant_id && <p className="text-xs text-subtle mt-0.5">tenant: <span className="mono">{inc.tenant_id}</span></p>}
        </header>

        {/* Error */}
        <Section title="Error">
          <pre className="text-xs bg-surface border border-line rounded-lg p-4 mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto">
{inc.message || "(no message)"}
          </pre>
          {inc.trace_id && (
            <p className="text-xs text-muted mt-2">trace_id: <span className="mono">{inc.trace_id}</span></p>
          )}
        </Section>

        {/* AI reasoning */}
        {inc.patch_analysis && (
          <Section title="Claude's root cause analysis">
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{inc.patch_analysis}</p>
          </Section>
        )}

        {/* Fix applied */}
        {(inc.patch_files_changed || inc.patch_result) && (
          <Section title="Fix">
            <div className="space-y-3">
              {inc.patch_files_changed && (
                <div>
                  <Label>Files changed</Label>
                  <p className="text-sm mono text-ink mt-0.5">{inc.patch_files_changed}</p>
                </div>
              )}
              {inc.patch_pr_url && (
                <div>
                  <Label>Pull request</Label>
                  <a
                    href={inc.patch_pr_url}
                    target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-accent hover:underline mt-0.5"
                  >
                    PR #{inc.patch_pr_number}
                    {status === "auto_deployed" && " (auto-merged)"}
                    {status === "patch_proposed" && " (awaiting your review)"}
                  </a>
                </div>
              )}
              {inc.patch_result === "no_fix" && inc.patch_no_fix_reason && (
                <div>
                  <Label>Why no fix was applied</Label>
                  <p className="text-sm text-muted mt-0.5">{inc.patch_no_fix_reason}</p>
                </div>
              )}
              {inc.patch_iterations != null && (
                <p className="text-xs text-subtle">{inc.patch_iterations} investigation steps by Claude</p>
              )}
            </div>
          </Section>
        )}

        {/* Verification */}
        {inc.patch_test_suggestion && (
          <Section title="How to verify the fix">
            <p className="text-sm text-ink leading-relaxed">{inc.patch_test_suggestion}</p>
          </Section>
        )}

        {/* Deployment outcome */}
        {(status === "auto_deployed" || status === "patch_proposed") && (
          <Section title="Deployment">
            {status === "auto_deployed" ? (
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-success mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-success font-medium">Auto-deployed</p>
                  <p className="text-xs text-muted mt-0.5">
                    Low-risk fix — squash-merged by patch-agent, Cloud Build deployed automatically.
                    {inc.patch_completed_at && ` Deployed ${ts(inc.patch_completed_at)}.`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-2 h-2 rounded-full bg-warning mt-1.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-warning font-medium">Awaiting manual review</p>
                  <p className="text-xs text-muted mt-0.5">
                    {inc.patch_risk?.toUpperCase()} risk — review the PR before merging. Cloud Build deploys on merge.
                  </p>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Prior incidents for same service */}
        {history?.length > 0 && (
          <Section title={`Incident history — ${inc.service} (${history.length} prior)`}>
            <ul className="space-y-3">
              {history.map((h) => {
                const hStatus = h.status || "new";
                const recurred = status !== "auto_deployed" && h.status === "auto_deployed";
                return (
                  <li key={h.id} className="border border-line rounded-lg overflow-hidden">
                    <Link
                      href={`/admin/incidents/${h.id}`}
                      className="flex items-start gap-4 px-4 py-3 hover:bg-line-soft/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[hStatus] || "bg-line-soft text-muted"}`}>
                            {STATUS_LABEL[hStatus] || hStatus}
                          </span>
                          {recurred && (
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-danger bg-danger/10 px-1.5 py-0.5 rounded">
                              fix didn't hold
                            </span>
                          )}
                          <span className="text-xs text-subtle tabular">{tsShort(h.created_at)}</span>
                        </div>
                        <p className="text-xs text-muted truncate">{(h.message || "").split("\n")[0].slice(0, 120)}</p>
                        {h.patch_files_changed && (
                          <p className="text-[11px] mono text-subtle mt-0.5 truncate">{h.patch_files_changed}</p>
                        )}
                        {h.patch_analysis && (
                          <p className="text-xs text-ink mt-1 line-clamp-2">{h.patch_analysis.slice(0, 200)}</p>
                        )}
                      </div>
                      <span className="text-subtle text-xs flex-shrink-0">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

      </div>
    </AppShell>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-surface border border-line rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-line">
        <h2 className="text-[11px] uppercase tracking-widest text-muted font-semibold">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Label({ children }) {
  return <div className="text-[10px] uppercase tracking-widest text-muted font-semibold mb-0.5">{children}</div>;
}
