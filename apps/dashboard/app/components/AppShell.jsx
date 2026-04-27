import { Sidebar } from "./Sidebar";

export function AppShell({ email, admin, tenantId, tenantName, children }) {
  return (
    <div className="min-h-screen flex">
      <Sidebar email={email} admin={admin} tenantId={tenantId} tenantName={tenantName} />
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
