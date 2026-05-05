"use client";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.push("/calls");
  }, [status, router]);

  async function handleCredentials(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Fel e-post eller lösenord.");
    } else {
      router.push("/calls");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-paper">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-line p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Voice Platform</h1>
          <p className="text-sm text-muted mt-1">Sign in to view your AI receptionist's calls.</p>
        </div>

        {/* Credentials form */}
        <form onSubmit={handleCredentials} className="space-y-3">
          <input
            type="email"
            placeholder="E-post"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ink/20"
          />
          <input
            type="password"
            placeholder="Lösenord"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full border border-line rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-ink/20"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-white py-2.5 px-4 rounded-lg hover:bg-ink/85 transition font-medium text-sm disabled:opacity-50"
          >
            {loading ? "Loggar in…" : "Logga in"}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-line" />
          <span className="text-xs text-subtle">eller</span>
          <div className="flex-1 h-px bg-line" />
        </div>

        <button
          onClick={() => signIn("google", { callbackUrl: "/calls" })}
          className="w-full border border-line text-ink py-2.5 px-4 rounded-lg hover:bg-paper transition font-medium text-sm flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        <p className="text-xs text-subtle">
          Access is granted by your operator. If your email isn't authorized, contact support.
        </p>
      </div>
    </main>
  );
}
