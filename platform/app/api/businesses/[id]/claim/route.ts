import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });

/**
 * Register intent to claim an unclaimed business. Protected, sensitive surface:
 *  - server-side session required (SEC-7 — never trust the client).
 *  - the ownership transition is atomic under `SELECT … FOR UPDATE`, so two concurrent
 *    claims can't both win (no double-claim race).
 *  - rejects already-claimed businesses with 409.
 *  - audits both success and denied attempts.
 *
 * IMPORTANT: this assigns OWNERSHIP only. It does NOT confer a verification tier — no OTP,
 * email, or phone proof has occurred, so `verification_tier` stays 0 (unverified). Tier 1+
 * requires a real proof flow (OTP / community endorsement / MOIC), which lands separately.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const ip = clientIp(req.headers);

  // Authenticate first, then rate-limit by identity so one IP behind a NAT can't
  // exhaust another user's claim budget; unauthenticated traffic is bounded by IP.
  const user = await requireUser(req.headers);
  if (!user) {
    const anon = rateLimit(`claim:anon:${ip}`, 10, 60_000);
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: anon.ok ? undefined : { "Retry-After": String(anon.retryAfter ?? 60) } },
    );
  }

  const rl = rateLimit(`claim:${user.id}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
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
      await logAudit({ userId: user.id, action: "business.claim.denied", entityType: "business", entityId: businessId, metadata: { reason: "not_found" }, ip });
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    if (biz.rows[0].owner_id) {
      await client.query("rollback");
      await logAudit({ userId: user.id, action: "business.claim.denied", entityType: "business", entityId: businessId, metadata: { reason: "already_claimed" }, ip });
      return NextResponse.json({ error: "Business already claimed" }, { status: 409 });
    }

    // Ownership only — NOT verification. verification_tier stays as-is (0 for a fresh listing);
    // a real proof flow (OTP/community/MOIC) raises it later.
    await client.query(
      "update businesses set owner_id = $1, updated_at = now() where id = $2",
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
