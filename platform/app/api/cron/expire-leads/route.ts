import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { expireStaleLeads } from "@/lib/leads";

export const runtime = "nodejs";

function secretOk(provided: string | null): boolean {
  if (!env.CRON_SECRET || !provided) return false; // fails closed when unset
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Expire leads past their 24h window. Called on a schedule (Railway cron or Inngest later).
 * Gated by a constant-time secret compare on the `x-cron-secret` header — if CRON_SECRET is
 * unset, the endpoint is disabled (fails closed) rather than open.
 */
export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  try {
    const expired = await expireStaleLeads();
    return NextResponse.json({ success: true, expired });
  } catch (err) {
    console.error("expire-leads cron error:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
