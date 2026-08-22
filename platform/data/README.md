# Import datasets

- `vientiane-seed.json` — existing validated Vientiane seed
- `laos-qualified-2026-08-22.json` — phone-verified Laos listings (`source`: `laos-qualified-2026-08-22`, `status`: `active`). Operator-box source: `/workspace/lncci-clean/asian-directory-import-qualified.json`. Copy that file here; do not invent phones, emails, websites, coordinates, or CEOs. Do not import the empty-phone eBRS dump.

From `platform/`:

```bash
DATABASE_URL=... EMBEDDINGS_URL=... npm run db:import -- data/laos-qualified-2026-08-22.json
```

Blockers: data file not on the branch yet; live import also needs `DATABASE_URL` and `EMBEDDINGS_URL`. See `db/IMPORT.md`.
