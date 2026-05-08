"use client";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";
import { SuggestionPanel } from "./SuggestionPanel";

// CRM-style tenants get "Ärenden" instead of "Samtal" in their nav.
const CRM_TENANTS = new Set(["enkla-juridik"]);
// suffix lets us preserve impersonation params (?as=customer&tenant=X) across nav clicks.
// Without it, clicking "Ärenden" while impersonating drops the params and redirects to /admin.
const TENANT_NAV = (tenantId, suffix = "") => [
  { href: `/${suffix}`,             label: "Översikt",      icon: "home" },
  { href: `/calls${suffix}`,        label: CRM_TENANTS.has(tenantId) ? "Ärenden" : "Samtal", icon: CRM_TENANTS.has(tenantId) ? "users" : "phone" },
  { href: `/agent${suffix}`,        label: "Min assistent", icon: "mic" },
  { href: `/settings${suffix}`,     label: "Inställningar", icon: "settings" },
  { href: `/support${suffix}`,      label: "Support",       icon: "inbox" },
];

const ADMIN_NAV = [
  { href: "/admin", label: "Customers", icon: "users" },
  { href: "/admin/stats", label: "Statistics", icon: "chart" },
  { href: "/admin/suggestions", label: "Suggestions", icon: "inbox" },
  { href: "/admin/incidents", label: "Incidents", icon: "alert" },
];

const ADMIN_TENANT_NAV = (tenant) => [
  { href: `/?tenant=${tenant}`, label: "Overview", icon: "home" },
  { href: `/calls?tenant=${tenant}`, label: CRM_TENANTS.has(tenant) ? "Cases" : "Calls", icon: CRM_TENANTS.has(tenant) ? "users" : "phone" },
  { href: `/agent?tenant=${tenant}`, label: "Agent", icon: "mic" },
  { href: `/settings?tenant=${tenant}`, label: "Settings", icon: "settings" },
  { href: `/billing?tenant=${tenant}`, label: "Billing", icon: "chart" },
];

export function Sidebar({ email, admin, tenantId, tenantName, impersonating }) {
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Determine which nav to show
  let nav;
  let context;
  if (impersonating) {
    // Preserve impersonation across navigation
    nav = TENANT_NAV(tenantId, `?tenant=${tenantId}&as=customer`);
    context = { kind: "tenant", tenantId, tenantName };
  } else if (admin && tenantId) {
    nav = ADMIN_TENANT_NAV(tenantId);
    context = { kind: "admin-tenant", tenantId, tenantName };
  } else if (admin) {
    nav = ADMIN_NAV;
    context = { kind: "admin" };
  } else {
    nav = TENANT_NAV(tenantId);
    context = { kind: "tenant", tenantId, tenantName };
  }

  const isActive = (href) => {
    const basePath = href.split("?")[0];
    if (basePath === "/") return pathname === "/";
    return pathname?.startsWith(basePath);
  };

  return (
    <>
      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-30 bg-surface border-b border-line h-14 flex items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-semibold text-ink tracking-tightest">Voice</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-muted hover:text-ink p-2"
          aria-label="Menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {/* Sidebar */}
      <aside
        className={`fixed md:sticky md:top-0 left-0 top-14 md:top-0 z-40 h-[calc(100vh-3.5rem)] md:h-screen w-64 bg-surface border-r border-line flex flex-col transition-transform ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Logo */}
        <div className="hidden md:flex items-center gap-2.5 px-5 h-16 border-b border-line">
          <Logo />
          <span className="font-semibold text-ink tracking-tightest text-[15px]">Voice Platform</span>
        </div>

        {/* Context label */}
        {context.kind === "admin-tenant" && (
          <div className="px-4 pt-4 pb-2">
            <Link
              href="/admin"
              className="flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors"
            >
              <Icon name="arrowLeft" size={12} />
              All customers
            </Link>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-accent-soft flex items-center justify-center text-xs font-semibold text-accent">
                {(tenantName || tenantId)?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink truncate">{tenantName || tenantId}</div>
                <div className="text-[10px] text-subtle mono truncate">{tenantId}</div>
              </div>
            </div>
            <Link
              href={`/?tenant=${tenantId}&as=customer`}
              className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-muted hover:text-ink border border-line rounded-md py-1.5 hover:bg-line-soft transition-colors"
            >
              <Icon name="users" size={12} />
              Visa som kund
            </Link>
          </div>
        )}

        {context.kind === "tenant" && (
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-accent-soft flex items-center justify-center text-xs font-semibold text-accent">
                {(tenantName || tenantId)?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink truncate">{tenantName || tenantId}</div>
              </div>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive(item.href)
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:text-ink hover:bg-line-soft"
              }`}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Footer: quick compose button */}
        {tenantId && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setPanelOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-ink text-white hover:bg-ink/85 transition-colors"
            >
              <Icon name="sparkles" size={15} />
              Nytt ärende
            </button>
          </div>
        )}

        <div className="border-t border-line px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-line-soft border border-line flex items-center justify-center text-[11px] font-semibold text-muted uppercase">
                {email?.[0]}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-ink truncate font-medium">{email?.split("@")[0]}</div>
                {admin && (
                  <div className="text-[10px] text-accent font-semibold uppercase tracking-wider">Admin</div>
                )}
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-muted hover:text-ink p-1.5 rounded-md hover:bg-line-soft transition-colors"
              title="Logga ut"
              aria-label="Logout"
            >
              <Icon name="logout" size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-ink/30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {tenantId && (
        <SuggestionPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          tenantId={tenantId}
        />
      )}
    </>
  );
}

function Logo() {
  return (
    <div className="w-7 h-7 rounded-md bg-ink flex items-center justify-center">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      </svg>
    </div>
  );
}
