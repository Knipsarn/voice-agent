"use client";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { SuggestionPanel } from "./SuggestionPanel";

const TENANT_NAV = [
  { href: "/", label: "Översikt" },
  { href: "/calls", label: "Samtal" },
  { href: "/settings", label: "Inställningar" },
];

const ADMIN_NAV = [
  { href: "/", label: "Overview" },
  { href: "/calls", label: "Calls" },
  { href: "/agent", label: "Agent" },
  { href: "/settings", label: "Settings" },
  { href: "/billing", label: "Billing" },
  { href: "/admin", label: "Admin" },
];

export function TopBar({ email, admin, tenantId }) {
  const pathname = usePathname();
  const [panelOpen, setPanelOpen] = useState(false);

  const nav = admin ? ADMIN_NAV : TENANT_NAV;
  const isActive = (href) => href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-line">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-accent shadow-glow"></div>
              <span className="font-semibold text-ink tracking-tight">Voice</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? "text-ink bg-paper"
                      : "text-muted hover:text-ink hover:bg-paper"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {tenantId && (
              <button
                onClick={() => setPanelOpen(true)}
                className="hidden sm:inline-flex items-center gap-2 bg-accent-soft text-accent hover:bg-accent hover:text-white transition-all px-3 py-1.5 rounded-lg text-sm font-medium"
              >
                <span className="text-base leading-none">✨</span>
                <span>Förbättra agenten</span>
              </button>
            )}
            {admin && (
              <span className="hidden sm:inline-block bg-accent-soft text-accent text-xs font-semibold px-2 py-1 rounded-md">Admin</span>
            )}
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted">
              <div className="w-7 h-7 rounded-full bg-paper border border-line flex items-center justify-center text-muted font-medium uppercase">
                {email?.[0]}
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs text-muted hover:text-ink"
            >
              Logga ut
            </button>
          </div>
        </div>
      </header>

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
