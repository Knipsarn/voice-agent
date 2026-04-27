import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getCall, postFeedback } from "@/lib/control-plane";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const { call_control_id, rating, note } = body || {};
  if (!call_control_id) return Response.json({ error: "call_control_id required" }, { status: 400 });

  // Verify the user has access to this call's tenant before letting them write feedback
  if (!scope.admin) {
    try {
      const call = await getCall(call_control_id);
      if (call.tenant_id !== scope.tenantId) {
        return Response.json({ error: "not your tenant" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "call not found" }, { status: 404 });
    }
  }

  try {
    const result = await postFeedback(call_control_id, { rating, note, by: session.user.email });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
