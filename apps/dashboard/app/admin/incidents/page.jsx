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

  const newCount = incidents.filter((i) => (i.status || "new") === "new").length;
  const actionableCount = incidents.filter((i) => i.ai?.is_actionable && (i.status || "new") === "new").length;

  return (
    <AppShell email={session.user.email} admin={true}>
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Errors observed</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Incidents</h1>
          <p className="text-sm text-muted mt-1">
            Cloud Logging errors auto-classified by GPT-4o-mini.{" "}
            {newCount > 0 ? (
              <span className="text-ink font-medium">{newCount} new</span>
            ) : (
              <span>All triaged.</span>
            )}
            {actionableCount > 0 && <span className="text-warning font-medium ml-1">· {actionableCount} actionable</span>}
          </p>
        </header>

        <IncidentsList initial={incidents} />
      </div>
    </AppShell>
  );
}
