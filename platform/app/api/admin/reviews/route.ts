import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export const runtime = "nodejs";

/** Admin: reviews awaiting moderation (flagged first). */
export async function GET(req: Request) {
  const access = await requireRole(req.headers, "admin");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const r = await pool.query(
    `select r.id, r.business_id, b.name as business_name, r.rating, r.body, r.media,
            r.flagged, r.flag_reason, r.created_at
     from reviews r
     join businesses b on b.id = r.business_id
     where r.status = 'pending'
     order by r.flagged desc, r.created_at asc
     limit 100`,
  );
  return NextResponse.json({ reviews: r.rows });
}
