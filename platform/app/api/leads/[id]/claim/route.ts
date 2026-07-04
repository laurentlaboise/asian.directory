import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBusinessAccess } from "@/lib/authz";
import { claimLead } from "@/lib/leads";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });
const Body = z.object({ businessId: z.string().uuid() });

/**
 * Claim a routed lead for a business the caller owns. Ownership is checked here
 * (requireBusinessAccess on businessId); the credit debit + single-claim guarantee are enforced
 * atomically in claimLead(). On success the (previously withheld) consumer contact is returned.
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

  const rl = rateLimit(`lead-claim:${access.user.id}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  const result = await claimLead(p.data.id, body.businessId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await logAudit({
    userId: access.user.id,
    action: "lead.claimed",
    entityType: "lead",
    entityId: p.data.id,
    metadata: { businessId: body.businessId, cost: result.cost },
    ip: clientIp(req.headers),
  });

  return NextResponse.json({ success: true, contact: result.contact, creditsCharged: result.cost });
}
