"use client";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.push("/calls");
  }, [status, router]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-line p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Voice Platform</h1>
          <p className="text-sm text-muted mt-1">Sign in to view your AI receptionist's calls.</p>
        </div>
        <button
          onClick={() => signIn("google", { callbackUrl: "/calls" })}
          className="w-full bg-ink text-white py-3 px-4 rounded-lg hover:bg-ink/85 transition font-medium"
        >
          Sign in with Google
        </button>
        <p className="text-xs text-subtle">
          Access is granted by your operator. If your email isn't authorized, contact support.
        </p>
      </div>
    </main>
  );
}
