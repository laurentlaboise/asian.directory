import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser, getRole } from "@/lib/session";
import { AdminPanels } from "./AdminPanels";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Real server-side role boundary (middleware is only an optimistic redirect).
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login?next=/admin");
  if ((await getRole(user.id)) !== "admin") redirect("/dashboard");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <h1 className="text-2xl font-bold">Admin moderation</h1>
      <AdminPanels />
    </main>
  );
}
