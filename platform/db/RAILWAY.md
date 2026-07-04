# Railway Postgres provisioning runbook (pgvector + PGroonga)

Everything needed to stand up the database this week and apply the migration cleanly.

---

## 1. The image

Use `platform/db/Dockerfile` (Postgres 17 + pgvector + PGroonga). Nothing else to configure in
the image — no `shared_preload_libraries`, no custom `postgresql.conf`. Extensions are enabled by
the migration (`create extension …`).

## 2. Create the Railway service

Create a **new service → Deploy from a Dockerfile** and point it at `platform/db/Dockerfile`
(a small dedicated repo containing just the Dockerfile also works). Do **not** use Railway's
one-click Postgres — that image lacks pgvector/PGroonga.

**Volume (required for persistence):**
- Add a Volume, mount path: `/var/lib/postgresql/data`

**Service variables:**

| Variable | Value | Notes |
|---|---|---|
| `POSTGRES_USER` | `postgres` | default |
| `POSTGRES_PASSWORD` | *(strong secret)* | generate: `openssl rand -hex 24` |
| `POSTGRES_DB` | `railway` | any name; used in the connection string |
| `PGDATA` | `/var/lib/postgresql/data/pgdata` | **important** — a subdir of the mount, so `initdb` doesn't trip over the volume's `lost+found` |

Deploy. First boot runs `initdb` and starts Postgres on port `5432`.

## 3. shared_preload_libraries

**None needed.** Confirm after boot with `SHOW shared_preload_libraries;` (empty/default is fine).
If you later adopt ParadeDB BM25, that's the only thing that would require adding it + a restart.

## 4. Connection strings & `DATABASE_SSL`

**Internal (app → db, same Railway project — preferred):**
```
postgresql://postgres:<POSTGRES_PASSWORD>@<db-service-name>.railway.internal:5432/railway
```
Set the app's `DATABASE_SSL=off` — the private network is isolated and the image serves plaintext
(this matches `lib/db.ts`, which only enables TLS for `require`/`insecure`).

**External (local psql / one-off migration):** enable the service's **TCP Proxy** to get a public
`HOST:PORT`, then:
```
postgresql://postgres:<POSTGRES_PASSWORD>@<host>.proxy.rlwy.net:<port>/railway
```
The stock image has no server-side TLS, so keep `sslmode` out of the URL. Prefer running migrations
*inside* Railway (below) so nothing sensitive crosses the public internet in cleartext.

## 5. Apply the schema migration

The runner is `platform/scripts/migrate.mjs` (forward-only; tracks applied files in `_migrations`).
It needs exactly one env var: **`DATABASE_URL`**.

**Preferred — as a Railway Pre-deploy Command on the app service** (runs with internal networking):
```
node scripts/migrate.mjs
```
**Or one-off from local** (with the external URL above):
```
DATABASE_URL="postgresql://postgres:…@<host>.proxy.rlwy.net:<port>/railway" \
  node platform/scripts/migrate.mjs
```

## 6. Create the Better Auth tables, then finish migrations + seed

The full order matters — `0002` adds FKs onto Better Auth's `user` table, so auth must be
migrated between `0001` and `0002` (the runner is idempotent, so re-running it is safe):

```
npm run db:migrate:core  # applies ONLY 0001 (domain tables + hybrid_search)
npm run auth:migrate      # Better Auth creates user/session/account/verification  (add --config lib/auth.ts if needed)
npm run db:migrate        # now applies 0002+ (audit/FKs, verification & reviews, leads)
npm run db:seed           # ingests the Vientiane seed (needs EMBEDDINGS_URL live)
```
(Running `db:migrate:core` first avoids 0002 failing on a fresh DB where `"user"` doesn't exist yet.)

## 7. Verify (before any app boot)

```
psql "$DATABASE_URL" -c "\dx"                                   # expect: vector, pgroonga
psql "$DATABASE_URL" -c "select extname, extversion from pg_extension where extname in ('vector','pgroonga');"
psql "$DATABASE_URL" -c "\dt"                                   # businesses, business_embeddings, leads, …
psql "$DATABASE_URL" -c "\df hybrid_search"                     # the RRF function exists
```

## 8. End-to-end boot smoke test

**8a. Data-layer smoke (exercises the dedup fix directly).** Inserts one business with TWO
language embeddings; `hybrid_search` must return it **once**, not twice:
```sql
-- throwaway fixture
insert into cities (slug, name_en, country) values ('vientiane','Vientiane','LA')
  on conflict do nothing;
insert into businesses (id, name, slug, description, city_id)
  values ('11111111-1111-1111-1111-111111111111', 'Sabaidee Ramen', 'sabaidee-ramen',
          'Cozy ramen shop in central Vientiane', (select id from cities where slug='vientiane'));
insert into business_embeddings (business_id, lang, content, embedding) values
  ('11111111-1111-1111-1111-111111111111','en','Sabaidee Ramen', array_fill(0.1::real, array[1024])::vector),
  ('11111111-1111-1111-1111-111111111111','lo','ຮ້ານ ຣາເມັງ',   array_fill(0.1::real, array[1024])::vector);

-- expect EXACTLY ONE row:
select count(*) from hybrid_search('ramen', array_fill(0.1::real, array[1024])::vector, null, 15);
```
Then clean up: `delete from businesses where id='11111111-1111-1111-1111-111111111111';`

**8b. App boot.** Wire the app service env (`DATABASE_URL`, `DATABASE_SSL=off`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `EMBEDDINGS_URL`, `ANTHROPIC_API_KEY`), deploy, then check:
- **Auth:** sign up → sign in → session cookie is `__Secure-sead.session_token`, httpOnly; `/dashboard` redirects when logged out, loads when logged in.
- **Search:** `POST /api/search {"q":"ramen"}` returns deduplicated results (once real ingestion exists).
- **Rate limit:** 31 rapid requests → the 31st returns `429` with `Retry-After`.

---

### Notes
- The BGE-M3 endpoint (`EMBEDDINGS_URL`) is a **separate** service (a container serving BGE-M3 that
  returns 1024-dim normalized vectors at `POST /embed`). Search will error without it; auth and the
  data-layer smoke test (8a) do not need it.
- If migrations ever run against an SSL-enabled external endpoint, add `ssl` options to
  `scripts/migrate.mjs` — not needed for the internal/plaintext path used here.
