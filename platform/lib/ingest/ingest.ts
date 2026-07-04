import { pool } from "@/lib/db";
import { embedText, toVectorLiteral } from "@/lib/embeddings";

/**
 * Ingestion: upsert a business and its per-language embeddings.
 *
 * Multilingual by design (ADR-001): pass multiple `langs` to store both a native-language
 * vector and a pivot-translated one (the mitigation for Lao being low-resource). If no langs
 * are given, we embed the English name+description as a single `en` vector.
 */
export type IngestLang = { lang: "en" | "th" | "lo" | "vi"; content: string };

export type IngestBusiness = {
  name: string;
  slug: string;
  description: string;
  categorySlug: string;
  citySlug: string;
  lat?: number;
  lng?: number;
  phone?: string;
  website?: string;
  langs?: IngestLang[];
};

export async function ingestBusiness(b: IngestBusiness): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const cat = await client.query("select id from categories where slug = $1", [b.categorySlug]);
    const city = await client.query("select id from cities where slug = $1", [b.citySlug]);

    const res = await client.query(
      `insert into businesses (name, slug, description, category_id, city_id, lat, lng, phone, website)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (slug) do update set
         name = excluded.name, description = excluded.description,
         category_id = excluded.category_id, city_id = excluded.city_id,
         lat = excluded.lat, lng = excluded.lng, phone = excluded.phone,
         website = excluded.website, updated_at = now()
       returning id`,
      [
        b.name, b.slug, b.description,
        cat.rows[0]?.id ?? null, city.rows[0]?.id ?? null,
        b.lat ?? null, b.lng ?? null, b.phone ?? null, b.website ?? null,
      ],
    );
    const businessId: string = res.rows[0].id;

    const langs = b.langs ?? [{ lang: "en" as const, content: `${b.name}. ${b.description}` }];
    for (const l of langs) {
      const embedding = await embedText(l.content);
      await client.query(
        `insert into business_embeddings (business_id, lang, content, embedding)
         values ($1,$2,$3,$4::vector)
         on conflict (business_id, lang) do update set
           content = excluded.content, embedding = excluded.embedding`,
        [businessId, l.lang, l.content, toVectorLiteral(embedding)],
      );
    }

    await client.query("commit");
    return businessId;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
