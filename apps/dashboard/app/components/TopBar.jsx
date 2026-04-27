"use client";
import { signOut } from "next-auth/react";
import Link from "next/link";

export function TopBar({ email, admin }) {
  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/calls" className="font-semibold text-ink">Voice Platform</Link>
          <nav className="flex items-center gap-4 text-sm text-gray-600">
            <Link href="/calls" className="hover:text-ink">Calls</Link>
            <Link href="/agent" className="hover:text-ink">Agent</Link>
            <Link href="/settings" className="hover:text-ink">Settings</Link>
            <Link href="/billing" className="hover:text-ink">Billing</Link>
            {admin && <Link href="/admin" className="hover:text-ink">Admin</Link>}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          {admin && (
            <span className="bg-blue-50 text-accent text-xs font-medium px-2 py-0.5 rounded">Admin</span>
          )}
          <span className="mono text-xs">{email}</span>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-xs text-gray-500 hover:text-ink">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
