import Link from "next/link";
import { Sidebar } from "./Sidebar";

export function AppShell({ email, admin, tenantId, tenantName, impersonating, children }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar email={email} admin={admin} tenantId={tenantId} tenantName={tenantName} impersonating={impersonating} />
      <main className="flex-1 min-w-0">
        {impersonating && (
          <div className="bg-warning/10 border-b border-warning/30 px-6 py-2.5 flex items-center justify-between gap-3 text-sm">
            <div className="text-ink">
              <span className="font-semibold">Visar som kund</span>
              <span className="text-muted"> · {tenantName || tenantId} · du ser exakt vad kunden ser</span>
            </div>
            <Link
              href={`/?tenant=${tenantId}`}
              className="text-warning font-medium hover:text-warning/80 whitespace-nowrap"
            >
              Tillbaka till admin-vy →
            </Link>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
