import { cache } from "react";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";

/** Public origin used for canonical / JSON-LD URLs. */
export const siteOrigin = env.SITE_URL ?? env.BETTER_AUTH_URL;

export type SeoBusiness = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  review_score: number;
  review_count: number;
  verification_tier: number;
  lat: number | null;
  lng: number | null;
};

// Wrapped in React cache() so generateMetadata + the page body share one query per request
// (no double DB hit within a single render).
export const getCity = cache(async (slug: string) => {
  const r = await pool.query(
    "select id, slug, name_en, name_local, country from cities where slug = $1",
    [slug],
  );
  return r.rows[0] ?? null;
});

export const getCategory = cache(async (slug: string) => {
  const r = await pool.query(
    "select id, slug, name_en, name_lo from categories where slug = $1",
    [slug],
  );
  return r.rows[0] ?? null;
});

export const getBusinessesByLocationCategory = cache(
  async (citySlug: string, categorySlug: string): Promise<SeoBusiness[]> => {
    const r = await pool.query(
      `select b.id, b.name, b.slug, b.description, b.review_score, b.review_count,
              b.verification_tier, b.lat, b.lng
       from businesses b
       join cities c    on c.id = b.city_id     and c.slug = $1
       join categories cat on cat.id = b.category_id and cat.slug = $2
       where b.status = 'active'
       order by b.is_featured desc, b.review_score desc, b.review_count desc
       limit 100`,
      [citySlug, categorySlug],
    );
    return r.rows;
  },
);

export const getBusinessBySlug = cache(async (slug: string) => {
  const r = await pool.query(
    `select b.*, c.name_en as city_name, c.country, cat.name_en as category_name
     from businesses b
     left join cities c      on c.id = b.city_id
     left join categories cat on cat.id = b.category_id
     where b.slug = $1 and b.status = 'active'`,
    [slug],
  );
  return r.rows[0] ?? null;
});
