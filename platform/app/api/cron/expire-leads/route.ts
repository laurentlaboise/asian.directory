import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { expireStaleLeads } from "@/lib/leads";

export const runtime = "nodejs";

/**
 * Expire leads past their 24h window. Called on a schedule (Railway cron or Inngest later).
 * Gated by a shared secret in the `x-cron-secret` header — if CRON_SECRET is unset, the endpoint
 * is disabled (fails closed) rather than open.
 */
export async function POST(req: Request) {
  if (!env.CRON_SECRET || req.headers.get("x-cron-secret") !== env.CRON_SECRET) {
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
