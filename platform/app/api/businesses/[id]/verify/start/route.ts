import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { requireBusinessAccess } from "@/lib/authz";
import { createChallenge } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/mailer";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });

function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  const head = name!.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, name!.length - 2))}@${domain}`;
}

/**
 * Start Tier-1 verification: emails a one-time code to the business's ON-FILE contact address,
 * proving control of that contact. The destination is the stored business email — NOT a
 * caller-supplied address — so a merchant can't verify against an address they just typed in.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  const businessId = p.data.id;

  const access = await requireBusinessAccess(req.headers, businessId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const rl = rateLimit(`verify-start:${access.user.id}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const r = await pool.query("select email from businesses where id = $1", [businessId]);
  const email: string | null = r.rows[0]?.email;
  if (!email) {
    return NextResponse.json({ error: "No contact email on file to verify against" }, { status: 400 });
  }

  const code = await createChallenge(access.user.id, businessId, "email", email);
  await sendOtpEmail(email, code);

  await logAudit({
    userId: access.user.id,
    action: "verification.otp.sent",
    entityType: "business",
    entityId: businessId,
    metadata: { channel: "email" },
    ip: clientIp(req.headers),
  });

  return NextResponse.json({ success: true, sentTo: maskEmail(email) });
}
