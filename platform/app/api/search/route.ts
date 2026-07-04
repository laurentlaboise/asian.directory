import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { embedQuery, toVectorLiteral } from "@/lib/embeddings";
import { reformulateQuery } from "@/lib/reformulate";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  q: z.string().trim().min(2).max(300),
  cityId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(30).default(15),
  history: z.array(z.string().trim().min(1).max(300)).max(6).optional(),
});

/**
 * Hybrid retrieval endpoint (ADR-002): dense (pgvector) + lexical (PGroonga) fused with RRF
 * in-database via hybrid_search(), now returning the fused score for a confidence signal.
 *
 * Security baseline: per-IP rate limit, strict zod validation, fully parameterized SQL,
 * proxy-aware client IP, generic error responses (detail logged only).
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
    // Multi-turn: fold recent history into a standalone query before embedding (graceful).
    const searchQuery = input.history?.length ? await reformulateQuery(input.q, input.history) : input.q;
    const embedding = await embedQuery(searchQuery);

    const { rows } = await pool.query(
      `select (hs.business).id, (hs.business).name, (hs.business).slug, (hs.business).description,
              (hs.business).city_id, (hs.business).category_id, (hs.business).review_score,
              (hs.business).review_count, (hs.business).verification_tier, (hs.business).is_featured,
              (hs.business).lat, (hs.business).lng, hs.score
       from hybrid_search($1, $2::vector, $3, $4) hs`,
      [searchQuery, toVectorLiteral(embedding), input.cityId ?? null, input.limit],
    );

    const topScore: number = rows[0]?.score ?? 0;
    const lowConfidence = rows.length === 0 || topScore < env.SEARCH_CONFIDENCE_MIN;

    return NextResponse.json({ query: searchQuery, results: rows, lowConfidence });
  } catch (err) {
    console.error("search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
