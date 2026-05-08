import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { listSuggestions, getTenant } from "@/lib/control-plane";
import { AppShell } from "../components/AppShell";
import { SupportTicketList } from "../components/SupportTicketList";

export default async function SupportPage({ searchParams }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  const scope = effectiveScope(session.user.email, searchParams);

  if (!scope.admin && !scope.tenantId) {
    return (
      <AppShell email={session.user.email} admin={false}>
        <div className="max-w-3xl mx-auto px-6 py-24 text-center text-muted">Ingen åtkomst.</div>
      </AppShell>
    );
  }

  const tenantId = scope.admin ? (searchParams?.tenant || null) : scope.tenantId;
  if (scope.admin && !tenantId) redirect("/admin");

  const [tenantDoc, suggestionsRes] = await Promise.all([
    getTenant(tenantId).catch(() => null),
    listSuggestions(tenantId).catch(() => ({ suggestions: [] })),
  ]);

  const tenantName = tenantDoc?.company_name || tenantId;
  const tickets = suggestionsRes.suggestions || [];

  return (
    <AppShell email={session.user.email} admin={scope.admin} tenantId={tenantId} tenantName={tenantName} impersonating={scope._impersonating}>
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-8 md:py-12">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-widest text-muted font-semibold">Support</p>
          <h1 className="text-4xl font-semibold text-ink tracking-tightest mt-2">Mina ärenden</h1>
          <p className="text-sm text-muted mt-1">
            Förfrågningar du skickat in. Vår AI-agent hanterar enkla ärenden direkt — komplexa frågor granskas av teamet.
          </p>
        </header>
        <SupportTicketList tickets={tickets} tenantId={tenantId} />
      </div>
    </AppShell>
  );
}
