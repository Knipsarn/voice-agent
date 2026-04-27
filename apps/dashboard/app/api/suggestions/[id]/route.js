import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { updateSuggestion } from "@/lib/control-plane";

export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin) return Response.json({ error: "admin only" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const tenantId = body.tenant_id;
  if (!tenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });

  try {
    const result = await updateSuggestion(tenantId, params.id, {
      status: body.status,
      admin_response: body.admin_response,
      admin_responded_by: session.user.email,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
