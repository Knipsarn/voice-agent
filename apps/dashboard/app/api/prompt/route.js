import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { getPrompt, updatePromptSection, submitPromptSuggestion } from "@/lib/control-plane";

function resolveTenantId(scope, searchParams, body) {
  if (scope.admin) return searchParams?.get("tenant") || body?.tenant_id || null;
  return scope.tenantId;
}

// GET /api/prompt?tenant=<tenantId>
export async function GET(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const tenantId = resolveTenantId(scope, searchParams, null);
  if (!tenantId) return Response.json({ error: "tenant required" }, { status: 400 });
  if (!scope.admin && tenantId !== scope.tenantId) {
    return Response.json({ error: "not your tenant" }, { status: 403 });
  }

  try {
    return Response.json(await getPrompt(tenantId));
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}

// PATCH /api/prompt — update a prompt section. Admins can edit any tenant;
// tenant users can edit only their own tenant.
export async function PATCH(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const { tenant_id, section, content } = body || {};
  const effectiveTenantId = scope.admin ? tenant_id : scope.tenantId;
  if (!effectiveTenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });
  if (!scope.admin && tenant_id && tenant_id !== scope.tenantId) {
    return Response.json({ error: "not your tenant" }, { status: 403 });
  }
  if (!section) return Response.json({ error: "section required" }, { status: 400 });
  if (content === undefined) return Response.json({ error: "content required" }, { status: 400 });

  try {
    return Response.json(await updatePromptSection(effectiveTenantId, section, content));
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}

// POST /api/prompt — customer suggestion
export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }

  const tenantId = resolveTenantId(scope, null, body);
  if (!tenantId) return Response.json({ error: "tenant_id required" }, { status: 400 });
  if (!scope.admin && tenantId !== scope.tenantId) {
    return Response.json({ error: "not your tenant" }, { status: 403 });
  }

  const { text, category } = body || {};
  if (!text || !text.trim()) return Response.json({ error: "text required" }, { status: 400 });

  try {
    const result = await submitPromptSuggestion(tenantId, text, session.user.email, category);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
