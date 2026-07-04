import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { embedQuery, toVectorLiteral } from "@/lib/embeddings";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  q: z.string().trim().min(2).max(300),
  cityId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(30).default(15),
});

/**
 * Hybrid retrieval endpoint (ADR-002): dense (pgvector) + lexical (PGroonga) fused with RRF
 * in-database via hybrid_search().
 *
 * Security baseline applied here:
 *  - per-IP rate limit (30/min) with correct proxy-aware IP.
 *  - strict input validation (zod); reject anything off-shape.
 *  - fully parameterized SQL — no string interpolation of user input (no injection).
 *  - generic error responses; internal detail is logged, never leaked to the client.
 */
export async function POST(req: Request) {
  const ip = clientIp(req.headers);
  const rl = rateLimit(`search:${ip}`, 30, 60_000);
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
    const embedding = await embedQuery(input.q);

    const { rows } = await pool.query(
      `select id, name, slug, description, city_id, category_id,
              review_score, review_count, verification_tier, is_featured, lat, lng
       from hybrid_search($1, $2::vector, $3, $4)`,
      [input.q, toVectorLiteral(embedding), input.cityId ?? null, input.limit],
    );

    return NextResponse.json({ results: rows });
  } catch (err) {
    console.error("search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
