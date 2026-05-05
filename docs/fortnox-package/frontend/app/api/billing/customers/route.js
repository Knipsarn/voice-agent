import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import { userScope } from "@/lib/tenant-map";
import { listFortnoxCustomers, createFortnoxCustomer } from "@/lib/control-plane-fortnox";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin) return Response.json({ error: "admin only" }, { status: 403 });
  try {
    return Response.json(await listFortnoxCustomers());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = userScope(session.user.email);
  if (!scope.admin) return Response.json({ error: "admin only" }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
  try {
    return Response.json(await createFortnoxCustomer(body), { status: 201 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: err.status || 500 });
  }
}
