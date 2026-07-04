import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });

/**
 * Claim an unclaimed business (Tier-1 verification). Protected, sensitive surface:
 *  - server-side session required (SEC-7 — never trust the client).
 *  - the ownership transition is atomic under `SELECT … FOR UPDATE`, so two concurrent
 *    claims can't both win (no double-claim race).
 *  - rejects already-claimed businesses with 409.
 *  - writes an audit-log entry.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`claim:${ip}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  const user = await requireUser(req.headers);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const parsed = Params.safeParse(await ctx.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  }
  const businessId = parsed.data.id;

  const client = await pool.connect();
  try {
    await client.query("begin");

    const biz = await client.query(
      "select id, owner_id from businesses where id = $1 for update",
      [businessId],
    );
    if (biz.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    if (biz.rows[0].owner_id) {
      await client.query("rollback");
      return NextResponse.json({ error: "Business already claimed" }, { status: 409 });
    }

    await client.query(
      `update businesses
         set owner_id = $1, verification_tier = greatest(verification_tier, 1), updated_at = now()
       where id = $2`,
      [user.id, businessId],
    );
    await client.query(
      `insert into profiles (user_id, role) values ($1, 'merchant')
       on conflict (user_id) do update
         set role = case when profiles.role = 'viewer' then 'merchant' else profiles.role end`,
      [user.id],
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    console.error("claim error:", err);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  } finally {
    client.release();
  }

  await logAudit({
    userId: user.id,
    action: "business.claim",
    entityType: "business",
    entityId: businessId,
    ip,
  });

  return NextResponse.json({ success: true });
}
