import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireBusinessAccess } from "@/lib/authz";

export const runtime = "nodejs";

/** Credit balance + recent ledger for a business the caller owns. */
export async function GET(req: Request) {
  const businessId = new URL(req.url).searchParams.get("businessId") ?? "";
  if (!z.string().uuid().safeParse(businessId).success) {
    return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  }

  const access = await requireBusinessAccess(req.headers, businessId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const balance = (
    await pool.query("select coalesce((select balance from credit_accounts where business_id = $1), 0) as balance", [businessId])
  ).rows[0].balance as number;

  const transactions = (
    await pool.query(
      `select delta, kind, provider, reference, lead_id, created_at
       from credit_transactions where business_id = $1 order by created_at desc limit 50`,
      [businessId],
    )
  ).rows;

  return NextResponse.json({ balance, transactions });
}
