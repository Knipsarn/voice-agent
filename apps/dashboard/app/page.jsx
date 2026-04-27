import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  redirect("/calls");
}
