import type { PoolClient } from "pg";

/**
 * Recompute a business's cached rating aggregates from its PUBLISHED reviews only. Runs inside the
 * same transaction as the publish so the aggregate can never drift from the moderated review set.
 */
export async function recomputeBusinessRating(client: PoolClient, businessId: string): Promise<void> {
  await client.query(
    `update businesses b
        set review_count = sub.cnt,
            review_score = sub.avg,
            updated_at   = now()
       from (
         select count(*)::int as cnt, coalesce(avg(rating), 0)::real as avg
         from reviews where business_id = $1 and status = 'published'
       ) sub
      where b.id = $1`,
    [businessId],
  );
}
