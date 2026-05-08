import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { effectiveScope } from "@/lib/tenant-map";
import { getCase, deleteCase } from "@/lib/control-plane";

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const scope = effectiveScope(session.user.email, {});
  if (!scope.admin && !scope.tenantId) return Response.json({ error: "no access" }, { status: 403 });

  const id = decodeURIComponent(params.id);

  try {
    // Verify tenant ownership for non-admins
    if (!scope.admin) {
      const caseDoc = await getCase(id);
      if (caseDoc.tenant_id !== scope.tenantId) {
        return Response.json({ error: "not your case" }, { status: 403 });
      }
    }
    const result = await deleteCase(id);
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
