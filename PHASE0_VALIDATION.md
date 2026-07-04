# Phase 0 — Validation & Architecture Decision Records

**Project:** AI-First Business Directory & Lead-Gen Platform (SEA; Vientiane/Laos first).
**Purpose:** de-risk the master spec before any code. Every decision below is backed by source-cited research (2026-07-04) and, where it contradicts the spec, says so explicitly.
**Method:** six parallel research agents, each instructed to *disprove* the spec's assumptions rather than confirm them.

---

## 0. Decisions locked (TL;DR)

| Area | Spec assumption | Decision | Why |
|---|---|---|---|
| Embedding vector | `vector(3072)` + HNSW | **BGE-M3 → `vector(1024)` + HNSW cosine** (A/B vs SEA-LION-E5-600M @512) | `vector(3072)`+HNSW **fails at index build** (2000-dim cap). BGE-M3 has confirmed Lao pretraining, 8192-ctx, self-hostable |
| Lexical search | BM25 via `pg_textsearch` in Supabase | **Native FTS (`ts_rank_cd`) + RRF**; BM25 deferred | No BM25 extension is installable on hosted Supabase (needs `shared_preload_libraries`) |
| Thai/Lao tokenization | implicit `to_tsvector('english', …)` | **PGroonga** (or external segmenter → `'simple'`) | Thai/Lao have no inter-word spaces; default parser makes one giant token → lexical search silently breaks |
| Synthesis LLM | SEA-LION v3.5 (hosted) | **Claude/Gemini primary + self-hosted SEA-LION (v4, 8B-class) fallback** | Hosted SEA-LION API = 10 req/min, no SLA, not safety-aligned. v3.5 already superseded by v4 |
| Notifications | LINE + Zalo from day one | **Phase-3 feature; LINE-first (unverified OA), SMS as true fallback, drop WhatsApp** | Zalo needs a VN entity; WhatsApp has ~0 TH/VN adoption |
| Payments | credit purchases (Stripe implied) | **Manual BCEL/LAO-QR + admin-credited ledger; PhaJay API later** | Stripe unavailable in Laos & Vietnam; local B2B pays by bank QR |
| Hosting / DB | Supabase | **Railway** (self-managed Postgres + pgvector + PGroonga) + app-layer auth | Already in use; controls the image (guarantees PGroonga, unlocks BM25); managed-auth loss is minor for LINE/Zalo |

**Net effect on the roadmap:** Phase 1 (discovery engine) is fully unblocked. The hardest external dependencies (Vietnamese legal entity, Thai verified-OA badge, VN SMS brand registration, payment rails) are all **Phase 3** concerns — but three of them have multi-week lead times and must be *initiated* during Phase 1.

---

## ADR-001 — Embeddings & vector storage

**Decision:** Self-host **BGE-M3** producing **1024-dim** dense vectors, stored as `vector(1024)`, indexed with HNSW `vector_cosine_ops`. Keep **SEA-LION-E5-Embedding-600M (512-dim)** as a benchmark challenger on a real Lao eval set before final lock.

**Rationale / evidence:**
- pgvector caps HNSW/IVFFlat at **2000 dims for `vector`**, 4000 for `halfvec`. `CREATE INDEX … USING hnsw` on `vector(3072)` errors: `column cannot have more than 2000 dimensions for hnsw index`. The column + inserts succeed, so the failure is silent → sequential scans. **The spec's schema is broken as written.**
- BGE-M3 and multilingual-e5-large are both XLM-RoBERTa-based, whose pretraining **includes Lao (`lo`)** — the single most important fact for the lowest-resource target language. BGE-M3 leads on MIRACL (67.8 dense / 70.0 hybrid) and adds native sparse + ColBERT heads and 8192-token context.
- SEA-LION's generative 8B/70B models are **decoders** — "embedding compatible with SEA-LION output dimensions" is a **category error**. AI Singapore does now publish a real embedding suite (E5-600M @512, ModernBERT @768); embedding dimension is dictated by the embedder, never by the synthesis LLM.

**Lao risk & mitigations (no published Lao retrieval benchmark exists — this is measured-nowhere territory):**
1. **Pivot-translate at index time** — embed a machine-translated (EN/TH/VI) copy of each Lao profile alongside the native text (rows tagged by `lang`). Highest-leverage fix for a low-resource language.
2. **Hybrid, not pure dense** — lexical/sparse recall rescues business-name/entity matches where the Lao dense vector is weak.
3. **Build a 30–50-pair Lao eval set** and measure recall@10 (BGE-M3 vs E5-600M) on real data before committing; both are ≤1024-dim so the schema doesn't change if we switch.

**Corrected DDL:**
```sql
create extension if not exists vector;

create table business_embeddings (
    id           bigint generated always as identity primary key,
    business_id  bigint not null references businesses(id) on delete cascade,
    lang         text   not null check (lang in ('th','lo','vi','en')),
    content      text   not null,
    embedding    vector(1024) not null            -- BGE-M3 dense, unit-normalized
);
create index on business_embeddings using hnsw (embedding vector_cosine_ops)
    with (m = 16, ef_construction = 64);
-- query-time recall/latency knob: set hnsw.ef_search = 100;
```
*(If a 3072-dim API model is ever mandated: use `halfvec(3072)` + `halfvec_cosine_ops`, or Matryoshka-truncate to 1024/1536 — never plain `vector(3072)` with an index.)*

---

## ADR-002 — Hybrid retrieval (dense + lexical + RRF)

**Decision:** Dense pgvector HNSW + **native Postgres FTS** (`tsvector` / `ts_rank_cd` / `websearch_to_tsquery`) fused with **Reciprocal Rank Fusion**, entirely inside hosted Supabase. Solve Thai/Lao segmentation with **PGroonga** (Supabase-supported) or an external Thai/Lao segmenter (PyThaiNLP/ICU) writing space-delimited tokens into a `'simple'`-config `tsvector`. **True BM25 is deferred**, not adopted.

**Rationale / evidence:**
- Hosted Supabase supports pgvector 0.8.0 (+ halfvec) but **no BM25 extension** — ParadeDB `pg_search`, Timescale `pg_textsearch`, and `vchord_bm25` all require `shared_preload_libraries`, which managed Supabase does not expose. The spec's "BM25 inside Supabase" is **infeasible** without self-hosting Postgres or an external ParadeDB replica (which loses RLS). **The spec's central search premise fails.**
- For **short, uniform business listings under RRF**, BM25's advantages (TF saturation, length normalization, IDF) are marginal and RRF only consumes rank order anyway — native `ts_rank_cd` is good enough for MVP. Revisit BM25 only if ranking quality proves insufficient, as a self-hosted-Postgres migration.
- **The load-bearing gotcha:** Thai and Lao are written without spaces. `to_tsvector('english'|'simple', thai_text)` yields one token → lexical search matches only on exact full-string equality. Core Postgres has no built-in ICU segmenter. Fix in priority order: **PGroonga** (in-DB, Supabase-enablable, CJK/Thai tokenizers) → external segmentation at ingest → `pg_trgm` fuzzy fallback. Use **language-conditional indexing** (`'english'`/`'simple'` for Latin script; PGroonga for Thai/Lao), not one global config.

Metadata pre-filters (city, category, verification tier) belong **inside the CTEs before vector distance** to hold retrieval latency low; note pgvector 0.8.0 iterative index scans (`hnsw.iterative_scan`) fix under-filling on filtered queries. Also on Supabase the type is `extensions.vector`, not bare `vector`.

---

## ADR-003 — Synthesis & intent LLM

**Decision:** **Claude or Gemini (multilingual) as primary synthesis LLM** — real SLA, safety alignment, streaming. **Self-host SEA-LION (v4-class, 8B-equivalent, reasoning OFF)** as a regional-language specialist/fallback for query understanding and Lao/Thai/Vietnamese edge cases. Do **not** build production on the free hosted SEA-LION endpoint.

**Rationale / evidence:**
- Hosted `api.sea-lion.ai` is **10 requests/min, no published SLA, models explicitly not safety-aligned** — a research/eval service, not a customer-facing backbone.
- **SEA-LION v3.5 is already superseded** by v4 (`Gemma-SEA-LION-v4-27B-IT`, `Qwen-SEA-LION-v4-32B-IT`); the ADR should not pin v3.5. v3.5 "-R" variants **reason by default** (DeepSeek-R1 style) — a latency/token-cost trap for synthesis; toggle reasoning off.
- Licensing (Llama 3.1 community license) permits commercial use but carries Meta's 700M-MAU clause + acceptable-use policy; you must add your own moderation before public generation.
- Self-host sizing: 8B ≈ 16 GB VRAM FP16 (single 24 GB GPU); 70B ≈ 140 GB FP16 (2–4× A100) — reserve 70B only where it demonstrably beats 8B on SEA languages, and even then weigh against Claude/Gemini.

**Latency reality:** the spec's "15–30 ms" is **retrieval only**. Full pipeline (intent parse → hybrid → cross-encoder rerank → LLM synthesis) is **1–4 s**. Stream tokens (Vercel AI SDK), target first-token <1 s, rerank ≤50 candidates.

---

## ADR-004 — Merchant notification channels

**Decision (Phase 3, but procurement starts in Phase 1):**
- **In-dashboard notifications first** (works everywhere, zero external dependency).
- **LINE (Thailand) first external channel** — stand up an **unverified** LINE OA + Messaging API; onboard merchants by QR/deep-link.
- **SMS via aggregator (Twilio/Infobip/8x8) as the true fallback** — the only channel needing **no local entity**.
- **Zalo ZNS only once a Vietnamese entity/partner exists.**
- **Drop WhatsApp from the MVP.**

**Rationale / evidence:**
- **LINE:** a Lao/foreign entity **can push Flex messages to Thai merchants same-day** via an unverified OA. The **blue verified badge** is the only thing gated behind a **Thai company registration** (~5–10 business days) — it blocks discoverability, not sending. TH pricing: free ≤300 broadcasts/mo, then Basic ฿1,280 (15k msgs, +฿0.10) or Pro ฿1,780 (35k, +฿0.06). **LINE Login SSO** is OIDC-ish but omits `userinfo_endpoint` and needs a separate email-scope review → **custom OIDC wiring in Supabase**, not plug-and-play.
- **Zalo (the hard blocker):** branded ZNS **and** OA-linked Zalo Login **legally require a Vietnamese business registration + tax code + Vietnamese phone**. Without a VN entity you can send **OTP-only** — which does **not** cover lead alerts. Zalo Login is **plain OAuth2 (no `id_token`)** → cannot be a GoTrue OIDC provider; needs a custom Edge Function broker. **Vietnam is effectively gated on securing a VN footprint.** Two paths: **(a)** incorporate/partner for a VN entity (weeks–months), or **(b)** contract a Vietnamese **BSP** (Infobip / 8x8 / VietGuys) that fronts its own verified OA — faster (weeks of KYC) but the sender identity legally belongs to the BSP/partner, not you.
- **WhatsApp:** entity/verification is *not* the problem (a Lao entity verifies fine) — **adoption is**. LINE ≈ 78% of Thailand, Zalo ≈ 85% of Vietnam; WhatsApp is a rounding error there. A fallback that rarely has a valid recipient is dead weight.
- **SMS:** the aggregator holds the carrier relationship and registers sender IDs via LOA on your **international (Lao) business license** — no TH/VN subsidiary needed. But: **Vietnam branded-sender registration ≈ 30 business days** (start early), and **Thailand (Oct 2025) blocks unregistered senders and restricts URL links in SMS** (Jan 2025) — a real constraint for a link-driven lead product; pre-clear link usage with NBTC.

---

## ADR-005 — Monetization collection (lead credits)

**Decision:** **Manual bank-transfer / BCEL One / LAO-QR + admin-credited top-ups**, behind a **provider-agnostic top-up + credit-ledger abstraction**. Automate with the **PhaJay/PhaPay** Lao aggregator API once volume justifies it; adopt **Stripe (Thailand only)** and **Xendit/Omise (Vietnam)** per-country on expansion — a driver swap, not a re-architecture.

**Rationale / evidence:**
- **Stripe does not serve Laos or Vietnam** (only Thailand, THB + PromptPay). Architecting Phase-3 monetization around Stripe is a trap.
- Lao rails (BCEL One, LAPNet/LAO-QR, U-Money) are **bank-relationship products, not self-serve APIs** — except **PhaJay/PhaPay**, the one Lao aggregator with published developer docs (EMVCo QR generation across BCEL + wallets). Regional PSPs mostly **don't touch Laos** (only 2C2P has a Lao office, enterprise-only).
- For low-frequency, high-value B2B credit bundles sold to price-sensitive Vientiane SMEs, a payments API is **premature** — manual QR + admin crediting is exactly how Lao B2B already runs.
- **Fiscal traps to build in from day one:** **10% Lao VAT** on your domestic credit sales (issue compliant invoices); **10% withholding VAT** if you route fees to any foreign PSP (another reason to stay on local rails); **LAK volatility** (peg credit value to USD, re-price bundles frequently; mind BOL FX controls); prepaid credits are **deferred revenue** (recognize on consumption, track breakage).

---

## ADR-006 — Hosting & platform: Railway over Supabase

**Decision:** Host on **Railway** (already in use for another site) with a **self-managed Postgres image carrying pgvector + PGroonga**. Replace Supabase's managed auth with an **app-layer auth library (Better Auth / Auth.js)** in Next.js; self-hosting GoTrue on Railway is the fallback if RLS-with-JWT is wanted. This **supersedes the Supabase assumption** in ADR-001/002 (the SQL is portable — pgvector, PGroonga, FTS, and RRF are plain Postgres).

**Rationale:**
- **We control the Postgres image**, so pgvector + PGroonga are guaranteed and **true BM25 (ParadeDB `pg_search`) becomes available** — the one thing hosted Supabase blocked (revises ADR-002's constraint; BM25 stays deferred but is now a config choice, not an impossibility).
- **Operational consolidation** — one vendor already in use; no new managed service, no Supabase project to run alongside Railway.
- **The only thing given up is managed auth**, and for our providers that advantage was already thin: **LINE omits the OIDC `userinfo_endpoint` and Zalo is plain OAuth2** — both required custom wiring on Supabase too (ADR-004). So we lose little and simplify the stack.

**Consequences / what changed in the seed:**
- Schema owns its own `users` table (no `auth.users` FK); `owner_id`/`user_id` reference it.
- **RLS is not enabled** — authorization is enforced in the app layer, connecting as a least-privileged DB role. (Re-enable RLS + `auth.uid()` policies only if self-hosting GoTrue.)
- Migrations apply via `psql`/a Railway release step (or node-pg-migrate/drizzle-kit), not the Supabase CLI.
- **Caution:** use a vetted auth library — do **not** hand-roll JWT auth (that path produced the original `asian.directory` backend's worst issues: hardcoded secret fallback, privilege-escalation bootstrap).

**New decision for the human:** auth approach — **Better Auth/Auth.js (recommended, lower ops)** vs **self-hosted GoTrue** (keeps RLS model, more ops).

---

## Critical-path / long-pole dependencies (start during Phase 1)

| Dependency | Lead time | Needed for | Start when |
|---|---|---|---|
| Vietnamese legal entity / partner | weeks–months | Zalo ZNS + Zalo Login (all of VN monetized notifications) | Before committing VN to the roadmap |
| Thai verified LINE OA badge | ~5–10 business days + Thai docs | LINE discoverability + trust badge | When Thailand notifications are scoped |
| VN SMS branded-sender registration | ~30 business days | SMS fallback in Vietnam | Phase 1 (longest pole among channels) |
| Thai SMS ASID + NBTC link pre-clearance | ~10 business days | SMS fallback in Thailand | Phase 1 |
| Payment rails (PhaJay contract / BCEL) | weeks | Automated top-ups | Phase 2–3 |
| Self-hosted embedding + LLM inference (GPU) | days–weeks | Discovery engine | Phase 1 |

## Revised MVP sequencing (unchanged shape, corrected internals)

- **Phase 1 — Discovery engine (Vientiane):** Next.js App Router + Supabase; **corrected schema** (`vector(1024)`, PGroonga/segmentation, native-FTS+RRF function); BGE-M3 ingestion; hybrid search + cross-encoder rerank; Claude/Gemini synthesis with SEA-LION fallback; streaming Rich Cards; programmatic SEO. **Fully unblocked today.** In parallel: begin VN SMS registration and (if VN is in scope) VN-entity process.
- **Phase 2 — Claiming & verification:** merchant portal; LINE SSO (custom OIDC) + email/OTP; 3-tier verification; media-first reviews; fake-review detection.
- **Phase 3 — Lead routing & monetization:** intent classifier + lead scoring; Inngest state machine; LINE Flex (+ SMS fallback; Zalo *iff* VN entity secured); manual credit ledger → PhaJay; webhooks.

## Decisions that need a human (business/legal, not technical)

1. **Is Vietnam in the MVP, or Laos+Thailand first?** VN's notification + payment stack is gated on a Vietnamese entity; deferring VN removes the single biggest external blocker.
2. **Do you have (or can you partner for) a Thai entity?** Determines LINE verified badge + native Stripe-TH later.
3. **Primary synthesis LLM preference** — Claude vs Gemini vs self-hosted-only (cost/latency/data-residency tradeoff).
4. **Auth approach (ADR-006)** — Better Auth/Auth.js (recommended, lower ops) vs self-hosted GoTrue (keeps RLS).
