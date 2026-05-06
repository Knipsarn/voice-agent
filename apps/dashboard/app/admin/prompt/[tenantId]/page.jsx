import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getPrompt, getTenant } from "@/lib/control-plane";
import { AppShell } from "../../../components/AppShell";
import { PromptEditor } from "../../../components/PromptEditor";

export default async function AdminPromptPage({ params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const tenantId = params.tenantId;

  const [promptData, tenantDoc] = await Promise.all([
    getPrompt(tenantId).catch(() => ({ sections: {} })),
    getTenant(tenantId).catch(() => null),
  ]);

  const tenantName = tenantDoc?.company_name || tenantId;

  return (
    <AppShell email={session.user.email} admin={true} tenantId={tenantId} tenantName={tenantName}>
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">
            Prompt Management
          </p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">
            {tenantName}
          </h1>
          <p className="text-sm text-muted mt-1">
            Live prompt sections from Firestore. Edits are hotfixes — back-port to Git within 24h.
          </p>
        </header>

        <PromptEditor
          tenantId={tenantId}
          sections={promptData.sections}
          isAdmin={true}
        />
      </div>
    </AppShell>
  );
}
