import { NextResponse } from "next/server";
import { z } from "zod";
import { pool } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { screenReview } from "@/lib/moderation";
import { logAudit } from "@/lib/audit";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Params = z.object({ id: z.string().uuid() });

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().max(4000).optional(),
  media: z
    .array(z.object({ url: z.string().url().max(1000), kind: z.enum(["image", "video"]) }))
    .max(10)
    .optional(),
});

/** Public: published reviews for a business. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });

  const r = await pool.query(
    `select id, rating, body, media, created_at
     from reviews
     where business_id = $1 and status = 'published'
     order by created_at desc
     limit 100`,
    [p.data.id],
  );
  return NextResponse.json({ reviews: r.rows });
}

/**
 * Submit a review (media-first). Held as 'pending' for moderation — aggregates on the business
 * update only when a review is later published, so unmoderated content can't move rankings.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = Params.safeParse(await ctx.params);
  if (!p.success) return NextResponse.json({ error: "Invalid business id" }, { status: 400 });
  const businessId = p.data.id;

  const user = await getSessionUser(req.headers);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const rl = rateLimit(`review:${user.id}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "Too many submissions" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const biz = await pool.query("select owner_id from businesses where id = $1", [businessId]);
  if (biz.rowCount === 0) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  if (biz.rows[0].owner_id === user.id) {
    return NextResponse.json({ error: "You cannot review your own business" }, { status: 403 });
  }

  const screen = screenReview(body.body ?? null);
  const media = body.media ?? [];

  try {
    const r = await pool.query(
      `insert into reviews (business_id, author_id, rating, body, media, status, flagged, flag_reason)
       values ($1, $2, $3, $4, $5, 'pending', $6, $7)
       returning id`,
      [businessId, user.id, body.rating, body.body ?? null, JSON.stringify(media), screen.flagged, screen.reason ?? null],
    );
    await logAudit({
      userId: user.id,
      action: "review.submitted",
      entityType: "business",
      entityId: businessId,
      metadata: { rating: body.rating, hasMedia: media.length > 0, flagged: screen.flagged },
      ip: clientIp(req.headers),
    });
    return NextResponse.json({ success: true, reviewId: r.rows[0].id, status: "pending" });
  } catch (err) {
    // unique (business_id, author_id) -> already reviewed
    if ((err as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "You have already reviewed this business" }, { status: 409 });
    }
    console.error("review submit error:", err);
    return NextResponse.json({ error: "Failed to submit review" }, { status: 500 });
  }
}
