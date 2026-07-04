import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { logAudit } from "@/lib/audit";
import { clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Manual credit top-up (ADR-005). For the Laos MVP, credit bundles are paid via bank transfer /
 * LAO-QR and credited by an admin here — no external PSP. Provider/reference record the payment
 * source (manual_qr / bcel / phajay) so a future automated driver is a drop-in swap.
 */
const Body = z.object({
  businessId: z.string().uuid(),
  credits: z.number().int().positive().max(100_000),
  provider: z.enum(["manual_qr", "bcel", "phajay", "stripe_th", "xendit_vn", "adjust"]),
  reference: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  const access = await requireRole(req.headers, "admin");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    // Business must exist (FK) — fail clearly rather than on a constraint error.
    const biz = await client.query("select 1 from businesses where id = $1", [body.businessId]);
    if (biz.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    await client.query(
      `insert into credit_accounts (business_id, balance) values ($1, $2)
       on conflict (business_id) do update set balance = credit_accounts.balance + $2, updated_at = now()`,
      [body.businessId, body.credits],
    );
    await client.query(
      "insert into credit_transactions (business_id, delta, kind, provider, reference) values ($1, $2, 'topup', $3, $4)",
      [body.businessId, body.credits, body.provider, body.reference ?? null],
    );
    const balance = (await client.query("select balance from credit_accounts where business_id = $1", [body.businessId])).rows[0].balance;
    await client.query("commit");

    await logAudit({
      userId: access.user.id,
      action: "credits.topup",
      entityType: "business",
      entityId: body.businessId,
      metadata: { credits: body.credits, provider: body.provider, reference: body.reference ?? null },
      ip: clientIp(req.headers),
    });

    return NextResponse.json({ success: true, balance });
  } catch (err) {
    await client.query("rollback");
    console.error("topup error:", err);
    return NextResponse.json({ error: "Top-up failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
