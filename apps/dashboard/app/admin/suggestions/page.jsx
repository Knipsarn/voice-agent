import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listTenants } from "@/lib/control-plane";
import { AppShell } from "../../components/AppShell";
import { AdminSuggestionsInbox } from "../../components/AdminSuggestionsInbox";

export default async function SuggestionsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = userScope(session.user.email);
  if (!scope.admin) redirect("/");

  const tenantsRes = await listTenants().catch(() => ({ tenants: [] }));
  const tenants = tenantsRes.tenants || [];

  return (
    <AppShell email={session.user.email} admin={true}>
      <div className="max-w-4xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Inbox</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Suggestions</h1>
          <p className="text-sm text-muted mt-1">Customer feedback on agent behavior. Respond inline — your reply appears in their dashboard chat.</p>
        </header>

        <AdminSuggestionsInbox tenants={tenants} />
      </div>
    </AppShell>
  );
}
