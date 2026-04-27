import { redirect } from "next/navigation";

const REDIRECT_URI =
  process.env.FORTNOX_REDIRECT_URI ||
  "https://dashboard-service-360579353014.europe-west1.run.app/api/fortnox/callback";

const CP_BASE =
  process.env.CONTROL_PLANE_BASE_URL ||
  "https://control-plane-service-360579353014.europe-west1.run.app";
const CP_KEY = process.env.CONTROL_PLANE_API_KEY;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state") || "";

  // Extract tenant from state: "fortnox_connect:<tenantId>"
  const tenant = state.startsWith("fortnox_connect:") ? state.slice("fortnox_connect:".length) : "";
  const backUrl = tenant ? `/settings?tenant=${encodeURIComponent(tenant)}` : "/settings";

  if (error) {
    return redirect(`${backUrl}&fortnox=error&msg=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return redirect(`${backUrl}&fortnox=error&msg=no_code`);
  }

  try {
    const headers = { "Content-Type": "application/json" };
    if (CP_KEY) headers.Authorization = `Bearer ${CP_KEY}`;
    const res = await fetch(`${CP_BASE}/fortnox/exchange`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code, redirect_uri: REDIRECT_URI }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "exchange_failed");
      return redirect(`${backUrl}&fortnox=error&msg=${encodeURIComponent(text.slice(0, 200))}`);
    }
    return redirect(`${backUrl}&fortnox=connected`);
  } catch (err) {
    return redirect(`${backUrl}&fortnox=error&msg=${encodeURIComponent(err.message)}`);
  }
}
