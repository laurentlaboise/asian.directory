# Import datasets

- `vientiane-seed.json` — existing validated Vientiane seed
- `laos-qualified-2026-08-22.json` — phone-verified Laos listings (`source`: `laos-qualified-2026-08-22`, `status`: `active`). Drop the 1,586-record `ImportFile` array here; do not invent phones, emails, websites, coordinates, or CEOs.

From `platform/`:

```bash
DATABASE_URL=... EMBEDDINGS_URL=... npm run db:import -- data/laos-qualified-2026-08-22.json
```

Live import is blocked until both `DATABASE_URL` and `EMBEDDINGS_URL` are available. See `db/IMPORT.md`.
