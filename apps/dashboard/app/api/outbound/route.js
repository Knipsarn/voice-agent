import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { outboundDial } from "@/lib/control-plane";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const { tenant_id, to, lead_name, lead_business, lead_website, provider } = body || {};
  const tenantId = scope.admin ? tenant_id : scope.tenantId;
  if (!tenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });
  if (!scope.admin && tenantId !== scope.tenantId) return Response.json({ error: "not your tenant" }, { status: 403 });
  if (!to) return Response.json({ error: "to required" }, { status: 400 });

  try {
    const result = await outboundDial(tenantId, to, { lead_name, lead_business, lead_website, provider });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
