// Bulk importer CLI. Reads a JSON array of ImportRecord (see lib/import/schema.ts / db/IMPORT.md),
// validates the WHOLE file up front (fails loudly with the first issues), then upserts each row.
// Usage:  DATABASE_URL=... EMBEDDINGS_URL=... tsx scripts/import.ts data/businesses.json
import { readFileSync } from "node:fs";
import { ImportFile } from "@/lib/import/schema";
import { importRecord } from "@/lib/import/import";

const file = process.argv[2];
if (!file) {
  console.error("Usage: tsx scripts/import.ts <file.json>");
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`Could not read/parse ${file}:`, (e as Error).message);
  process.exit(1);
}

const parsed = ImportFile.safeParse(raw);
if (!parsed.success) {
  console.error("Dataset failed validation. First issues:");
  console.error(JSON.stringify(parsed.error.issues.slice(0, 20), null, 2));
  process.exit(1);
}

console.log(`Importing ${parsed.data.length} records…`);
let inserted = 0;
let updated = 0;
let failed = 0;

for (const [i, rec] of parsed.data.entries()) {
  const r = await importRecord(rec);
  if (!r.ok) {
    failed++;
    console.error(`  ✗ [${i}] ${rec.source}:${rec.externalId} — ${r.error}`);
  } else if (r.action === "insert") {
    inserted++;
  } else {
    updated++;
  }
  if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${parsed.data.length}`);
}

console.log(`Done. inserted=${inserted} updated=${updated} failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
