# Bulk data import

Loads externally-gathered business records into the directory. The input is a **JSON array** of
records matching `lib/import/schema.ts`. Import is **idempotent** on `(source, externalId)` — re-run
the same file to update rather than duplicate.

## Run

```bash
# needs a reachable DB (migrated) and the BGE-M3 embeddings endpoint (it embeds each record)
DATABASE_URL=... EMBEDDINGS_URL=... npm run db:import -- data/businesses.json
```

The whole file is validated before anything is written; on a schema error it prints the first
issues and exits non-zero. Per-record failures (e.g. a slug hash collision) are reported and counted
but don't abort the run. Output: `inserted=… updated=… failed=…`.

## Record format

```jsonc
{
  "source": "gemini",                     // who produced this batch (namespaces externalId)
  "externalId": "ChIJ_abc123",            // STABLE id from the source — the idempotency key
  "name": "Ichiran Ramen Vientiane",
  "description": "Tonkotsu ramen specialist with solo dining booths.",
  "category": { "slug": "ramen", "name_en": "Ramen" },
  "city": {
    "slug": "vientiane", "name_en": "Vientiane", "name_local": "ວຽງຈັນ",
    "country": "LA", "lat": 17.9757, "lng": 102.6331
  },
  "lat": 17.96, "lng": 102.61,            // the business's own coordinates (optional)
  "phone": "+856 21 123456",              // optional
  "website": "https://example.com",       // optional, MUST be http(s)
  "primaryLanguage": "lo",                // en | th | lo | vi
  "translations": [                       // optional; see "Embeddings" below
    { "lang": "lo", "text": "ຮ້ານ​ລາ​ເມັນ… (native description)" },
    { "lang": "en", "text": "Ramen shop… (English pivot for retrieval)" }
  ],
  "status": "active"                      // active (discoverable) | pending (hidden until reviewed)
}
```

Required: `source`, `externalId`, `name`, `category.{slug,name_en}`, `city.{slug,name_en,country}`.
Everything else is optional. Unknown keys are **rejected** (`.strict()`) — keep records clean.

- `slug` fields must be lowercase-hyphen (`ramen`, `vientiane`). Cities and categories are
  **upserted** by slug, so keep them consistent across records to avoid fragmentation.
- `country` is ISO-3166 alpha-2 (`LA`, `TH`, `VN`).
- The business's own URL slug is generated deterministically (`name-city-<hash>`); you don't supply it.

## Embeddings (why `translations` matters for Lao)

Each record is embedded with BGE-M3 into `business_embeddings`, one vector per `lang`. If you omit
`translations`, a single vector is built from `name + description` under `primaryLanguage`.

For **Lao** (a low-resource language for embedding models), provide `translations` with BOTH the
native Lao text AND an English (or Thai) pivot. Both are stored and searched, which materially
improves recall — this is ADR-001's mitigation. Prefer supplying an English pivot for any non-English
listing.

## Guidance for LLM-generated datasets (Gemini / Comet)

- Emit a single JSON array; one object per business; conform exactly to the format above.
- Use a **stable, real** `externalId` (e.g. the map/provider place id) so updates are idempotent —
  never a random value per run.
- Do not invent coordinates, phone, or website — omit a field rather than fabricate it.
- Keep `category.slug` / `city.slug` from a controlled vocabulary you reuse across the batch.
- For Lao/Thai/Vietnamese businesses, include an English pivot in `translations`.
