import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";

/** List the businesses owned by the authenticated user (merchant dashboard). */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const r = await pool.query(
    `select id, name, slug, description, city_id, category_id, verification_tier,
            review_score, review_count, phone, website
     from businesses
     where owner_id = $1
     order by created_at desc`,
    [user.id],
  );
  return NextResponse.json({ businesses: r.rows });
}
