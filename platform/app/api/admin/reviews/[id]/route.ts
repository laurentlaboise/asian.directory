import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { recomputeBusinessRating } from "@/lib/ratings";
import { generateTrustSummary } from "@/lib/trust-summary";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ action: z.enum(["approve", "reject"]) });

/**
 * Admin decision on a pending review. Approve = publish; the business rating aggregates are
 * recomputed in the SAME transaction (so they never drift from the published set), then the Trust
 * Summary is regenerated best-effort. Reject leaves aggregates untouched. Atomic under a row lock.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const access = await requireRole(req.headers, "admin");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let publishedBusinessId: string | null = null;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const rev = await client.query("select id, business_id, status from reviews where id = $1 for update", [p.data.id]);
    if (rev.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }
    if (rev.rows[0].status !== "pending") {
      await client.query("rollback");
      return NextResponse.json({ error: "Already moderated" }, { status: 409 });
    }

    if (body.action === "approve") {
      await client.query("update reviews set status = 'published' where id = $1", [p.data.id]);
      await recomputeBusinessRating(client, rev.rows[0].business_id);
      publishedBusinessId = rev.rows[0].business_id;
    } else {
      await client.query("update reviews set status = 'rejected' where id = $1", [p.data.id]);
    }
    await client.query("commit");

    await logAudit({
      userId: access.user.id,
      action: `review.${body.action}`,
      entityType: "business",
      entityId: rev.rows[0].business_id,
      metadata: { reviewId: p.data.id },
      ip: clientIp(req.headers),
    });
  } catch (err) {
    await client.query("rollback");
    console.error("review moderation error:", err);
    return NextResponse.json({ error: "Moderation failed" }, { status: 500 });
  } finally {
    client.release();
  }

  // Best-effort, outside the transaction (LLM call) — a failure here must not undo the publish.
  if (publishedBusinessId) await generateTrustSummary(publishedBusinessId);

  return NextResponse.json({ success: true });
}
