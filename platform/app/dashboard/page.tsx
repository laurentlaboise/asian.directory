import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/session";
import { pool } from "@/lib/db";
import { MerchantPanel, type MerchantBusiness } from "./MerchantPanel";
import { LeadsPanel } from "./LeadsPanel";

export const dynamic = "force-dynamic"; // per-user, never cached

export default async function DashboardPage() {
  // Real server-side auth boundary (middleware is only an optimistic redirect).
  const user = await getSessionUser(await headers());
  if (!user) redirect("/login?next=/dashboard");

  const r = await pool.query(
    `select id, name, slug, description, phone, website, verification_tier, review_score, review_count
     from businesses where owner_id = $1 order by created_at desc`,
    [user.id],
  );
  const businesses = r.rows as MerchantBusiness[];

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <h1 className="text-2xl font-bold">Your businesses</h1>
      {businesses.length === 0 ? (
        <p className="text-gray-500">
          You haven&apos;t claimed any businesses yet. Find your listing in the directory and claim it.
        </p>
      ) : (
        businesses.map((b) => <MerchantPanel key={b.id} business={b} />)
      )}

      <h2 className="mt-6 text-xl font-bold">Leads</h2>
      <LeadsPanel />
    </main>
  );
}
