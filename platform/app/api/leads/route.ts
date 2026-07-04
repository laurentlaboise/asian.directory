import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createAndRoute } from "@/lib/leads";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  query: z.string().trim().min(2).max(300),
  cityId: z.number().int().positive().optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  contactName: z.string().trim().min(1).max(120),
  contactEmail: z.string().email().max(200),
  message: z.string().trim().max(2000).optional(),
});

/**
 * Create + route a lead from a consumer contact request. Public (consumers needn't have an
 * account) but tightly rate-limited to bound spam. Never reveals which businesses were matched —
 * the response only confirms receipt.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`lead:${ip}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const res = await createAndRoute({
      query: body.query,
      sessionId: randomUUID(),
      cityId: body.cityId ?? null,
      geoLat: body.geoLat ?? null,
      geoLng: body.geoLng ?? null,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      message: body.message ?? null,
    });
    return NextResponse.json({ success: true, leadId: res.leadId, routed: res.routed });
  } catch (err) {
    console.error("lead create error:", err);
    return NextResponse.json({ error: "Could not submit request" }, { status: 500 });
  }
}
