import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { saveSettings } from "@/lib/control-plane";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  const { tenant_id, ...rest } = body || {};
  if (!tenant_id) return Response.json({ error: "tenant_id required" }, { status: 400 });

  // Customer can only modify their own tenant
  if (!scope.admin && tenant_id !== scope.tenantId) {
    return Response.json({ error: "not your tenant" }, { status: 403 });
  }

  // Customers can edit summary_email + summary_email_mode only
  // Admins can also edit authorized_customer_emails
  const allowed = scope.admin
    ? ["summary_email", "summary_email_mode", "authorized_customer_emails"]
    : ["summary_email", "summary_email_mode"];
  const partial = {};
  for (const k of allowed) if (k in rest) partial[k] = rest[k];

  if (Object.keys(partial).length === 0) {
    return Response.json({ error: "no allowed fields in body" }, { status: 400 });
  }

  partial.updated_by = session.user.email;

  try {
    const result = await saveSettings(tenant_id, partial);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
