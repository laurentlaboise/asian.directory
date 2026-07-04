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
| DB + Auth | Supabase (Postgres + GoTrue), pgvector + PGroonga | ADR-002 |
| Embeddings | **BGE-M3 → `vector(1024)`** (self-host); A/B vs SEA-LION-E5-600M | ADR-001 |
| Retrieval | dense HNSW + PGroonga lexical, fused with **RRF** in-DB | ADR-002 |
| Synthesis LLM | **Claude/Gemini primary** + self-host SEA-LION (v4, 8B-class) fallback | ADR-003 |
| Orchestration | Vercel AI SDK (streaming) | spec §3.1 |
| Background jobs | Inngest | spec §5.1 |
| Notifications | dashboard → LINE → SMS (WhatsApp dropped; Zalo needs VN entity) | ADR-004 |
| Payments | manual BCEL/LAO-QR + credit ledger → PhaJay later | ADR-005 |

## Why not the obvious spec defaults

- **`vector(1024)`, not `vector(3072)`** — HNSW indexes cap at 2000 dims; 3072 fails at index build (silently → seq scans).
- **PGroonga, not `to_tsvector('english', …)`** — Thai/Lao have no inter-word spaces; the default parser makes the whole phrase one token and lexical search dies.
- **No BM25 in Supabase** — the extensions (`pg_search`/`pg_textsearch`) need `shared_preload_libraries`, which hosted Supabase doesn't expose. Native FTS + RRF is the MVP path.
- **SEA-LION as fallback, not backbone** — the free hosted API is 10 req/min with no SLA and no safety alignment; v3.5 is already superseded by v4.

## Target structure

```
platform/
├── README.md
├── supabase/
│   └── migrations/
│       └── 0001_init.sql        # schema: taxonomy, businesses, embeddings, leads, credits, RRF fn
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

`supabase/migrations/0001_init.sql` is idempotent-ish DDL for hosted Supabase. Key objects:

- `categories` (multilingual, hierarchical) · `cities` (geo pre-filter nodes)
- `businesses` (+ `search_doc` for PGroonga, trigram fallback on name)
- `business_embeddings` — one row per (business, lang) so a Lao profile can carry both its
  native-Lao vector **and** a pivot-translated vector (the key mitigation for Lao being a
  benchmark-less low-resource language)
- `leads` / `lead_interactions` — asymmetric lead objects + CRM state
- `credit_accounts` / `credit_transactions` — provider-agnostic ledger (deferred revenue)
- `hybrid_search(query_text, query_embedding, …)` — the RRF fusion function

Apply with the Supabase CLI (`supabase db push`) once a project is linked.

## Open business decisions (from Phase 0)

1. **Market scope** — proceeding Laos-only unless told otherwise (removes the Vietnam-entity blocker).
2. **Vietnam entity vs BSP** — only relevant once VN is in scope; the longest external pole.
3. **Primary synthesis LLM** — Claude vs Gemini (cost/latency/data-residency).

## Next (Phase 1 build)

Next.js scaffold · BGE-M3 ingestion for Vientiane · `/api/search` over `hybrid_search()` ·
streaming Rich-Card chat UI · programmatic SEO routes. Intended to run as parallel,
worktree-isolated agents each paired with a verify agent, integrated via PRs + Vercel previews.
