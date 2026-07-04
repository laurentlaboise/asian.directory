# SEA AI Business Directory — Platform (greenfield seed)

AI-first, conversational business directory + lead-gen marketplace for Southeast Asia.
**MVP market: Vientiane, Laos.** Built to the master spec, corrected by the Phase 0 ADRs
(see `../PHASE0_VALIDATION.md`). This folder is the seed for a standalone repo — lift it out
once the target repo exists.

## Status

Phase 0 (validation/ADRs) ✅ complete. Phase 1 (discovery engine) — schema landed; app scaffold pending.

## Stack (locked)

| Layer | Choice | ADR |
|---|---|---|
| Frontend | Next.js (App Router) + TypeScript, Tailwind, shadcn/ui, PWA | spec §5.1 |
| Hosting + DB | **Railway** (self-managed Postgres image with pgvector + PGroonga) | ADR-006 |
| Auth | **Better Auth / Auth.js** in Next.js (app-layer authz); self-host GoTrue optional | ADR-006 |
| Embeddings | **BGE-M3 → `vector(1024)`** (self-host); A/B vs SEA-LION-E5-600M | ADR-001 |
| Retrieval | dense HNSW + PGroonga lexical, fused with **RRF** in-DB (BM25 available on Railway) | ADR-002 |
| Synthesis LLM | **Claude/Gemini primary** + self-host SEA-LION (v4, 8B-class) fallback | ADR-003 |
| Orchestration | Vercel AI SDK (streaming) | spec §3.1 |
| Background jobs | Inngest | spec §5.1 |
| Notifications | dashboard → LINE → SMS (WhatsApp dropped; Zalo needs VN entity) | ADR-004 |
| Payments | manual BCEL/LAO-QR + credit ledger → PhaJay later | ADR-005 |

## Why not the obvious spec defaults

- **`vector(1024)`, not `vector(3072)`** — HNSW indexes cap at 2000 dims; 3072 fails at index build (silently → seq scans).
- **PGroonga, not `to_tsvector('english', …)`** — Thai/Lao have no inter-word spaces; the default parser makes the whole phrase one token and lexical search dies.
- **Native FTS + RRF for the MVP** — good enough for short, uniform listings. On Railway we *could* add true BM25 (ParadeDB `pg_search`) later since we control `shared_preload_libraries` — the thing hosted Supabase blocked — but it isn't needed for MVP.
- **SEA-LION as fallback, not backbone** — the free hosted API is 10 req/min with no SLA and no safety alignment; v3.5 is already superseded by v4.
- **Railway over Supabase** — you already run Railway; controlling the Postgres image guarantees pgvector + PGroonga and unlocks BM25. The only thing given up is managed auth, which our LINE/Zalo providers needed custom wiring for anyway (ADR-006).

## Target structure

```
platform/
├── README.md
├── db/
│   └── migrations/
│       └── 0001_init.sql        # schema: users, taxonomy, businesses, embeddings, leads, credits, RRF fn
├── app/                          # Next.js App Router (pending)
│   ├── (search)/                 #   conversational discovery UI + Rich Cards
│   ├── [location]/[category]/    #   programmatic SEO (ISR) + JSON-LD + hreflang
│   ├── biz/[slug]/               #   business profile (SSR) + Semantic Trust Summary
│   └── api/search/               #   hybrid retrieval endpoint (calls hybrid_search())
├── lib/
│   ├── embeddings/               #   BGE-M3 client (self-hosted inference)
│   ├── llm/                      #   AI SDK: Claude/Gemini primary + SEA-LION fallback
│   └── ingest/                   #   Vientiane seed ingestion + pivot-translation
└── inngest/                      # lead state machine (Phase 3)
```

## Database

`db/migrations/0001_init.sql` is DDL for a self-managed Postgres (pgvector + PGroonga) on Railway. Key objects:

- `users` (owned by this schema; populated by the auth library)
- `categories` (multilingual, hierarchical) · `cities` (geo pre-filter nodes)
- `businesses` (+ `search_doc` for PGroonga, trigram fallback on name)
- `business_embeddings` — one row per (business, lang) so a Lao profile can carry both its
  native-Lao vector **and** a pivot-translated vector (the key mitigation for Lao being a
  benchmark-less low-resource language)
- `leads` / `lead_interactions` — asymmetric lead objects + CRM state
- `credit_accounts` / `credit_transactions` — provider-agnostic ledger (deferred revenue)
- `hybrid_search(query_text, query_embedding, …)` — the RRF fusion function

Apply with `psql "$DATABASE_URL" -f db/migrations/0001_init.sql` against the Railway Postgres
(image must include pgvector + PGroonga), or wire it into a Railway deploy/release step. A
lightweight migration runner (node-pg-migrate / drizzle-kit) can manage ordering as more land.

## Open business decisions (from Phase 0)

1. **Market scope** — proceeding Laos-only unless told otherwise (removes the Vietnam-entity blocker).
2. **Vietnam entity vs BSP** — only relevant once VN is in scope; the longest external pole.
3. **Primary synthesis LLM** — Claude vs Gemini (cost/latency/data-residency).

## Next (Phase 1 build)

Next.js scaffold · BGE-M3 ingestion for Vientiane · `/api/search` over `hybrid_search()` ·
streaming Rich-Card chat UI · programmatic SEO routes. Intended to run as parallel,
worktree-isolated agents each paired with a verify agent, integrated via PRs + Vercel previews.
