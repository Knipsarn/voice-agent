import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { createInvoice, sendInvoice } from "@/lib/control-plane-fortnox";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin) return Response.json({ error: "admin only" }, { status: 403 });

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const { tenant_id, month, action = "create" } = body || {};
  if (!tenant_id || !month) {
    return Response.json({ error: "tenant_id and month required" }, { status: 400 });
  }

  try {
    const result = action === "send"
      ? await sendInvoice(tenant_id, month)
      : await createInvoice(tenant_id, month);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
