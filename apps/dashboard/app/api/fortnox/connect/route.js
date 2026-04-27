import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";

const CLIENT_ID = process.env.FORTNOX_CLIENT_ID;
const REDIRECT_URI =
  process.env.FORTNOX_REDIRECT_URI ||
  "https://dashboard-service-360579353014.europe-west1.run.app/api/fortnox/callback";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin) return Response.json({ error: "admin only" }, { status: 403 });

  if (!CLIENT_ID) {
    return Response.json({ error: "FORTNOX_CLIENT_ID not configured on server" }, { status: 500 });
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "invoice customer",
    state: "fortnox_connect",
    response_type: "code",
    access_type: "offline",
  });

  return redirect(`https://apps.fortnox.se/oauth-v1/auth?${params.toString()}`);
}
