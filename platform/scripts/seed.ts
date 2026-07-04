/**
 * Seed the Vientiane MVP data. Upserts cities + categories, then ingests each business
 * (embedding its content via the BGE-M3 endpoint).
 *
 * Prereqs: DATABASE_URL + EMBEDDINGS_URL set, migrations applied.
 * Run: npm run db:seed   (tsx scripts/seed.ts)
 */
import { pool } from "@/lib/db";
import { ingestBusiness } from "@/lib/ingest/ingest";
import { cities, categories, businesses } from "@/db/seed/vientiane";

async function main() {
  for (const c of cities) {
    await pool.query(
      `insert into cities (slug, name_en, name_local, country, lat, lng)
       values ($1,$2,$3,$4,$5,$6) on conflict (slug) do nothing`,
      [c.slug, c.name_en, c.name_local, c.country, c.lat, c.lng],
    );
  }

  for (const cat of categories) {
    await pool.query(
      `insert into categories (slug, name_en, name_lo)
       values ($1,$2,$3) on conflict (slug) do nothing`,
      [cat.slug, cat.name_en, cat.name_lo],
    );
  }

  let ok = 0;
  for (const b of businesses) {
    try {
      await ingestBusiness(b);
      ok += 1;
      console.log(`  ✓ ${b.name}`);
    } catch (err) {
      console.error(`  ✗ ${b.name}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`Seeded ${ok}/${businesses.length} businesses.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
