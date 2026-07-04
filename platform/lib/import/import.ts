import { createHash } from "node:crypto";
import { pool } from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/embeddings";
import type { ImportRecord } from "./schema";

export type ImportOutcome = {
  externalId: string;
  ok: boolean;
  businessId?: string;
  action?: "insert" | "update";
  error?: string;
};

// 12 hex = 48 bits — negligible birthday-collision risk even at large scale.
const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180);
}

/**
 * Import one record: upserts its city + category, then upserts the business by (source,
 * externalId), then (re)builds its per-language embeddings — all in one transaction. Never throws;
 * returns a per-row outcome so the CLI can report insert/update/failed counts.
 *
 * The slug is deterministic per externalId (`name-city-<hash>`), so re-imports are stable and
 * two different records can't collide.
 */
export async function importRecord(rec: ImportRecord): Promise<ImportOutcome> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const city = await client.query(
      `insert into cities (slug, name_en, name_local, country, lat, lng)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (slug) do update set
         name_en = excluded.name_en,
         name_local = coalesce(excluded.name_local, cities.name_local),
         lat = coalesce(excluded.lat, cities.lat),
         lng = coalesce(excluded.lng, cities.lng)
       returning id`,
      [rec.city.slug, rec.city.name_en, rec.city.name_local ?? null, rec.city.country.toUpperCase(), rec.city.lat ?? null, rec.city.lng ?? null],
    );

    const category = await client.query(
      `insert into categories (slug, name_en) values ($1,$2)
       on conflict (slug) do update set name_en = excluded.name_en
       returning id`,
      [rec.category.slug, rec.category.name_en],
    );

    // Cap the base BEFORE appending the hash so the disambiguator is never truncated away
    // (name+city could otherwise exceed the column width and drop the hash → false collisions).
    const base = ([slugify(rec.name), rec.city.slug].filter(Boolean).join("-") || "biz").slice(0, 200);
    const slug = `${base}-${shortHash(`${rec.source}:${rec.externalId}`)}`;

    // xmax = 0 distinguishes a fresh insert from an on-conflict update.
    const res = await client.query(
      `insert into businesses
         (name, slug, description, category_id, city_id, lat, lng, phone, website, status, source, external_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (source, external_id) where external_id is not null do update set
         name = excluded.name, description = excluded.description, category_id = excluded.category_id,
         city_id = excluded.city_id, lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
         website = excluded.website, status = excluded.status, updated_at = now()
       returning id, (xmax = 0) as inserted`,
      [
        rec.name, slug, rec.description ?? null, category.rows[0].id, city.rows[0].id,
        rec.lat ?? null, rec.lng ?? null, rec.phone ?? null, rec.website ?? null,
        rec.status, rec.source, rec.externalId,
      ],
    );
    const businessId: string = res.rows[0].id;
    const inserted: boolean = res.rows[0].inserted;

    const langs =
      rec.translations && rec.translations.length > 0
        ? rec.translations
        : [{ lang: rec.primaryLanguage, text: `${rec.name}. ${rec.description ?? ""}`.trim() }];

    for (const l of langs) {
      const embedding = await embedText(l.text);
      await client.query(
        `insert into business_embeddings (business_id, lang, content, embedding)
         values ($1,$2,$3,$4::vector)
         on conflict (business_id, lang) do update set content = excluded.content, embedding = excluded.embedding`,
        [businessId, l.lang, l.text, toVectorLiteral(embedding)],
      );
    }

    await client.query("commit");
    return { externalId: rec.externalId, ok: true, businessId, action: inserted ? "insert" : "update" };
  } catch (err) {
    await client.query("rollback");
    return { externalId: rec.externalId, ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.release();
  }
}
