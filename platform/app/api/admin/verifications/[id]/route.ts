import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ action: z.enum(["approve", "reject"]), note: z.string().trim().max(1000).optional() });

/**
 * Admin decision on a Tier-2/3 submission. Approval raises the business's verification_tier to the
 * requested tier (monotonic — never lowers). Atomic under a row lock so a submission can't be
 * double-processed.
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

  const client = await pool.connect();
  try {
    await client.query("begin");
    const sub = await client.query(
      "select id, business_id, tier_requested, status from verification_submissions where id = $1 for update",
      [p.data.id],
    );
    if (sub.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }
    if (sub.rows[0].status !== "pending") {
      await client.query("rollback");
      return NextResponse.json({ error: "Already reviewed" }, { status: 409 });
    }

    const newStatus = body.action === "approve" ? "approved" : "rejected";
    await client.query(
      "update verification_submissions set status = $2, reviewed_by = $3, reviewed_at = now() where id = $1",
      [p.data.id, newStatus, access.user.id],
    );
    if (body.action === "approve") {
      await client.query(
        "update businesses set verification_tier = greatest(verification_tier, $2), updated_at = now() where id = $1",
        [sub.rows[0].business_id, sub.rows[0].tier_requested],
      );
    }
    await client.query("commit");

    await logAudit({
      userId: access.user.id,
      action: `verification.${body.action}`,
      entityType: "business",
      entityId: sub.rows[0].business_id,
      metadata: { submissionId: p.data.id, tier: sub.rows[0].tier_requested, note: body.note ?? null },
      ip: clientIp(req.headers),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query("rollback");
    console.error("verification review error:", err);
    return NextResponse.json({ error: "Review failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
