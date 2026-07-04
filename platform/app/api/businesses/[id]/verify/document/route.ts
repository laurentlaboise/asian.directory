import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireBusinessAccess } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({
  tier: z.union([z.literal(2), z.literal(3)]),
  kind: z.enum(["community", "moic", "o2o"]),
  evidenceUrl: z.string().url().max(1000),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Submit Tier-2/3 evidence (community endorsement / MOIC certificate / O2O storefront). Creates a
 * pending submission for admin review — it does NOT itself raise the tier (approval, later, does).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  const businessId = p.data.id;

  const access = await requireBusinessAccess(req.headers, businessId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rl = rateLimit(`verify-doc:${access.user.id}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many submissions" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const r = await pool.query(
    `insert into verification_submissions (business_id, submitted_by, tier_requested, kind, evidence_url, note)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [businessId, access.user.id, body.tier, body.kind, body.evidenceUrl, body.note ?? null],
  );

  await logAudit({
    userId: access.user.id,
    action: "verification.submission",
    entityType: "business",
    entityId: businessId,
    metadata: { tier: body.tier, kind: body.kind },
    ip: clientIp(req.headers),
  });

  return NextResponse.json({ success: true, submissionId: r.rows[0].id, status: "pending" });
}
