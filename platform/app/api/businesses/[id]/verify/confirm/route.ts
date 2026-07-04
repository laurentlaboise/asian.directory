import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireBusinessAccess } from "@/lib/authz";
import { verifyChallenge } from "@/lib/otp";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

/** Confirm the Tier-1 OTP. On success raises verification_tier to at least 1 (claimed+verified). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  const businessId = p.data.id;

  const access = await requireBusinessAccess(req.headers, businessId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rl = rateLimit(`verify-confirm:${access.user.id}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const result = await verifyChallenge(access.user.id, businessId, body.code);
  if (!result.ok) {
    await logAudit({
      userId: access.user.id,
      action: "verification.otp.failed",
      entityType: "business",
      entityId: businessId,
      metadata: { reason: result.reason },
      ip: clientIp(req.headers),
    });
    // Reason is logged above, not returned — avoid a client-visible oracle (generic error only).
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  await pool.query(
    "update businesses set verification_tier = greatest(verification_tier, 1), updated_at = now() where id = $1",
    [businessId],
  );
  await logAudit({
    userId: access.user.id,
    action: "verification.tier1",
    entityType: "business",
    entityId: businessId,
    ip: clientIp(req.headers),
  });

  return NextResponse.json({ success: true, verificationTier: 1 });
}
