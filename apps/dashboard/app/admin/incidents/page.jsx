import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listIncidents } from "@/lib/control-plane";
import { AppShell } from "../../components/AppShell";
import { IncidentsList } from "../../components/IncidentsList";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const data = await listIncidents({ limit: 100 }).catch(() => ({ incidents: [] }));
  const incidents = data.incidents || [];

  const openStatuses = new Set(["new", "investigating", "patch_proposed", "auto_deployed", "investigated", "patch_failed"]);
  const openCount       = incidents.filter((i) => openStatuses.has(i.status || "new")).length;
  const autoDeployCount = incidents.filter((i) => i.status === "auto_deployed").length;
  const reviewCount     = incidents.filter((i) => i.status === "patch_proposed").length;

  // Recurring: services that appear 3+ times
  const serviceCounts = {};
  for (const i of incidents) { const s = i.service || "unknown"; serviceCounts[s] = (serviceCounts[s] || 0) + 1; }
  const recurringServices = Object.entries(serviceCounts).filter(([, c]) => c >= 3).map(([s]) => s);

  return (
    <AppShell email={session.user.email} admin={true}>
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Errors observed</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Incidents</h1>
          <p className="text-sm text-muted mt-1">
            Cloud Logging errors investigated by Claude — auto-deployed when safe, PR opened when risky.
          </p>
          <div className="flex flex-wrap gap-4 mt-3">
            <Stat label="Open" value={openCount} tone={openCount > 0 ? "warn" : "ok"} />
            <Stat label="Auto-deployed" value={autoDeployCount} tone="ok" />
            <Stat label="Awaiting review" value={reviewCount} tone={reviewCount > 0 ? "accent" : "ok"} />
            <Stat label="Total logged" value={incidents.length} />
            {recurringServices.length > 0 && (
              <Stat label={`Recurring (${recurringServices.join(", ")})`} value={recurringServices.length} tone="warn" />
            )}
          </div>
        </header>

        <IncidentsList initial={incidents} />
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }) {
  const cls = tone === "warn"   ? "text-warning"
            : tone === "accent" ? "text-accent"
            : tone === "ok"     ? "text-success"
            : "text-ink";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">{label}</div>
      <div className={`text-2xl font-semibold tabular mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}
