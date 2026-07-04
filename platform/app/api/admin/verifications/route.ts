import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export const runtime = "nodejs";

/** Admin: pending Tier-2/3 verification submissions awaiting review. */
export async function GET(req: Request) {
  const access = await requireRole(req.headers, "admin");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const r = await pool.query(
    `select vs.id, vs.business_id, b.name as business_name, vs.tier_requested, vs.kind,
            vs.evidence_url, vs.note, vs.created_at
     from verification_submissions vs
     join businesses b on b.id = vs.business_id
     where vs.status = 'pending'
     order by vs.created_at asc
     limit 100`,
  );
  return NextResponse.json({ submissions: r.rows });
}
