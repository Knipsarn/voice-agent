import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { patchModel } from "@/lib/control-plane";

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = effectiveScope(session.user.email, Object.fromEntries(searchParams));
  if (!scope.admin) return Response.json({ error: "admin only" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const { tenant_id, model } = body || {};
  if (!tenant_id) return Response.json({ error: "tenant_id required" }, { status: 400 });
  if (!model) return Response.json({ error: "model required" }, { status: 400 });

  try {
    const result = await patchModel(tenant_id, model);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
