import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { synthesizeRationales } from "@/lib/synthesis";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  q: z.string().trim().min(2).max(300),
  ids: z.array(z.string().uuid()).min(1).max(15),
});

/**
 * Generate "Why Recommended" rationales for a set of businesses.
 *
 * Security posture:
 *  - tighter rate limit (LLM calls cost money) — 15/min per IP.
 *  - business content used in the prompt is fetched from the DB by id, NOT taken from the
 *    request body, so a client can't inject arbitrary text into the model prompt (only the
 *    short `q` is user-supplied, and model output is schema-constrained + rendered as text).
 *  - generic errors; detail logged only.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`synth:${ip}`, 15, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  let input: z.infer<typeof Body>;
  try {
    input = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const { rows } = await pool.query(
      `select b.id, b.name, b.description, c.name_en as category
       from businesses b
       left join categories c on c.id = b.category_id
       where b.id = any($1::uuid[])`,
      [input.ids],
    );
    const rationales = await synthesizeRationales(input.q, rows);
    return NextResponse.json({ rationales });
  } catch (err) {
    console.error("synthesis error:", err);
    return NextResponse.json({ error: "Synthesis failed" }, { status: 500 });
  }
}
