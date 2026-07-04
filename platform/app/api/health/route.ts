import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Readiness probe: OK only if the DB is reachable. Use as Railway's healthcheck path. */
export async function GET() {
  try {
    await pool.query("select 1");
    return NextResponse.json({ status: "ok" });
  } catch (err) {
    console.error("health check failed:", err);
    return NextResponse.json({ status: "degraded" }, { status: 503 });
  }
}
