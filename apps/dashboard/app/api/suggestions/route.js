import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { createSuggestion, listSuggestions } from "@/lib/control-plane";

function pickTenantForRequest(scope, body, searchParams) {
  if (scope.admin) return body?.tenant_id || searchParams?.get("tenant") || null;
  return scope.tenantId;
}

export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tenantId = pickTenantForRequest(scope, null, searchParams);
  if (!tenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });

  if (!scope.admin && tenantId !== scope.tenantId) {
    return Response.json({ error: "not your tenant" }, { status: 403 });
  }

  try {
    return Response.json(await listSuggestions(tenantId));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const tenantId = pickTenantForRequest(scope, body, null);
  if (!tenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });
  if (!scope.admin && tenantId !== scope.tenantId) {
    return Response.json({ error: "not your tenant" }, { status: 403 });
  }

  try {
    const result = await createSuggestion(tenantId, {
      text: body.text,
      submitted_by: session.user.email,
      call_context: body.call_context,
      category: body.category,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
