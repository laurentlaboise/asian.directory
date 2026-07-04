import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireBusinessAccess } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ businessId: z.string().uuid(), outcome: z.enum(["won", "lost"]) });

/**
 * Mark a claimed lead won/lost. Only the business that ACCEPTED the lead (and the caller must own
 * it) may set the outcome — verified by requiring an 'accepted' interaction for (lead, business).
 * (A 'won' outcome will later trigger the review-solicitation loop.)
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid lead id" }, { status: 400 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const access = await requireBusinessAccess(req.headers, body.businessId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  // The caller's business must be the one that accepted this lead.
  const offer = await pool.query(
    "select 1 from lead_interactions where lead_id = $1 and business_id = $2 and interaction_status = 'accepted'",
    [p.data.id, body.businessId],
  );
  if (offer.rowCount === 0) {
    return NextResponse.json({ error: "You have not claimed this lead" }, { status: 403 });
  }

  const upd = await pool.query(
    "update leads set status = $2 where id = $1 and status = 'claimed'",
    [p.data.id, body.outcome],
  );
  if (upd.rowCount === 0) {
    return NextResponse.json({ error: "Lead is not in a claimable state" }, { status: 409 });
  }

  await logAudit({
    userId: access.user.id,
    action: `lead.${body.outcome}`,
    entityType: "lead",
    entityId: p.data.id,
    metadata: { businessId: body.businessId },
    ip: clientIp(req.headers),
  });

  // Closed-loop data quality (spec §7.4): a won deal enqueues a review request to the consumer.
  // Best-effort — never fail the outcome update on this. Delivery (email/LINE/Zalo) wires later.
  if (body.outcome === "won") {
    try {
      await pool.query(
        `insert into review_solicitations (lead_id, business_id, consumer_email)
         select $1, $2, contact_email from leads where id = $1`,
        [p.data.id, body.businessId],
      );
    } catch (err) {
      console.error("review solicitation enqueue failed (non-fatal):", err);
    }
  }

  return NextResponse.json({ success: true });
}
