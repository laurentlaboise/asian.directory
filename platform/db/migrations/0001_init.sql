-- =============================================================================
-- 0001_init.sql — SEA AI Business Directory (Vientiane/Laos MVP)
-- Implements the Phase 0 ADRs. Every choice here is deliberate — see PHASE0_VALIDATION.md.
--
-- Corrections vs the master spec baked into this migration:
--   ADR-001  embedding is vector(1024) (BGE-M3), NOT vector(3072) — HNSW caps at 2000 dims.
--   ADR-002  lexical search = native FTS + RRF; Thai/Lao via PGroonga (no spaces -> no tsvector).
--   ADR-006  Target: self-managed Postgres on RAILWAY (not hosted Supabase). We control the
--            image, so pgvector + PGroonga are guaranteed and true BM25 (ParadeDB pg_search)
--            is available later if wanted. Auth is app-layer (Better Auth), which owns the
--            identity tables (`user`/`session`/`account`/`verification`) via its own CLI.
-- Requires a Postgres image with pgvector + PGroonga (e.g. groonga/pgroonga + pgvector, or a
-- custom image). Run via Railway on deploy, or `psql "$DATABASE_URL" -f 0001_init.sql`.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions (installable because we control the Postgres image on Railway)
-- ---------------------------------------------------------------------------
create extension if not exists vector;      -- pgvector (dense semantic search)
create extension if not exists pg_trgm;     -- trigram fuzzy fallback
create extension if not exists pgroonga;    -- CJK/Thai/Lao tokenizing full-text (ADR-002)
-- Optional later: create extension if not exists pg_search;  -- ParadeDB BM25 (needs shared_preload_libraries)

-- ---------------------------------------------------------------------------
-- Identity: Better Auth OWNS the `user`, `session`, `account`, `verification` tables —
-- created by `npx @better-auth/cli migrate` (see lib/auth.ts), NOT this file. Better Auth
-- user ids are text. Application role/state lives in `profiles`, keyed to that id. Domain
-- FKs below use `text` soft references to the auth user id (a hard FK is added in a later
-- migration, once the Better Auth tables exist, to avoid create-time ordering coupling).
-- ---------------------------------------------------------------------------
create table profiles (
    user_id     text primary key,               -- = Better Auth user.id
    role        text not null default 'viewer' check (role in ('viewer','merchant','editor','admin')),
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Hierarchical taxonomy (drives programmatic SEO: /[location]/[category]/[modifier])
-- ---------------------------------------------------------------------------
create table categories (
    id         uuid primary key default gen_random_uuid(),
    parent_id  uuid references categories(id) on delete set null,
    slug       varchar(255) unique not null,
    name_en    varchar(255),
    name_th    varchar(255),
    name_lo    varchar(255),
    name_vi    varchar(255),
    created_at timestamptz not null default now()
);
create index idx_categories_parent on categories(parent_id);

-- ---------------------------------------------------------------------------
-- Geographic nodes (city_id used as a hard pre-filter inside retrieval CTEs)
-- ---------------------------------------------------------------------------
create table cities (
    id         integer generated always as identity primary key,
    slug       varchar(255) unique not null,
    name_en    varchar(255) not null,
    name_local varchar(255),
    country    char(2) not null,              -- ISO-3166-1 alpha-2: LA, TH, VN
    lat        double precision,
    lng        double precision
);

-- ---------------------------------------------------------------------------
-- Businesses — the core entity. owner_id nullable to allow programmatic stubs.
-- ---------------------------------------------------------------------------
create table businesses (
    id                 uuid primary key default gen_random_uuid(),
    owner_id           text,                       -- Better Auth user.id (soft ref; hard FK in 0002)
    name               varchar(255) not null,
    slug               varchar(255) unique not null,
    description        text,
    category_id        uuid references categories(id) on delete set null,
    city_id            integer references cities(id) on delete set null,
    -- verification tiers (ADR / spec §7): 0 unverified, 1 claimed(OTP), 2 community, 3 MOIC/O2O
    verification_tier  smallint not null default 0 check (verification_tier between 0 and 3),
    is_verified        boolean generated always as (verification_tier >= 2) stored,
    lat                double precision,
    lng                double precision,
    phone              text,
    website            text,
    review_score       real not null default 0,
    review_count       integer not null default 0,
    is_featured        boolean not null default false,
    -- Lexical search: PGroonga indexes this directly and DOES tokenize Thai/Lao (no spaces).
    -- We do NOT use to_tsvector('english', ...) here — it would collapse Thai/Lao to one token.
    search_doc         text generated always as (coalesce(name,'') || ' ' || coalesce(description,'')) stored,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- Dense-vector index requires <= 2000 dims; 1024 (BGE-M3) fits natively. See business_embeddings.
create index idx_biz_city       on businesses(city_id);
create index idx_biz_category   on businesses(category_id);
create index idx_biz_verified   on businesses(verification_tier);
-- PGroonga full-text index (handles Thai/Lao/Vietnamese/English uniformly):
create index idx_biz_search_pgroonga on businesses using pgroonga (search_doc);
-- Trigram fuzzy fallback on name (typos, partial business names):
create index idx_biz_name_trgm  on businesses using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Per-language embeddings (ADR-001). One row per (business, lang) so we can store
-- BOTH the native-Lao vector AND a pivot-translated (en/th/vi) vector for recall.
-- ---------------------------------------------------------------------------
create table business_embeddings (
    id          bigint generated always as identity primary key,
    business_id uuid not null references businesses(id) on delete cascade,
    lang        text not null check (lang in ('en','th','lo','vi')),
    content     text not null,
    embedding   vector(1024) not null,          -- BGE-M3 dense, unit-normalized
    created_at  timestamptz not null default now(),
    unique (business_id, lang)
);
-- HNSW cosine index — valid because 1024 <= 2000 (this is exactly what the spec's 3072 broke).
create index idx_biz_emb_hnsw on business_embeddings
    using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- Asymmetric lead objects (spec §2 / §5.2)
-- ---------------------------------------------------------------------------
create table leads (
    id               uuid primary key default gen_random_uuid(),
    query_session_id uuid not null,
    user_id          text,                           -- Better Auth user.id (soft ref; hard FK in 0002)
    intent_score     integer not null default 0 check (intent_score between 0 and 100),
    service_requested text,
    budget_hint      varchar(50),
    geo_lat          double precision,
    geo_lng          double precision,
    -- lifecycle mirrors the CRM state machine (spec §2.4)
    status           varchar(30) not null default 'generated'
                       check (status in ('generated','scoring','auto_routed','opportunity_pool',
                                         'notified','claimed','expired','won','lost')),
    created_at       timestamptz not null default now()
);
create index idx_leads_status  on leads(status);
create index idx_leads_created on leads(created_at);

create table lead_interactions (
    id                   uuid primary key default gen_random_uuid(),
    lead_id              uuid not null references leads(id) on delete cascade,
    business_id          uuid not null references businesses(id) on delete cascade,
    notification_channel varchar(30),          -- dashboard, line, zalo, sms
    interaction_status   varchar(30) not null default 'sent'
                           check (interaction_status in ('sent','viewed','accepted','declined','expired')),
    credit_cost          integer not null default 0,
    responded_at         timestamptz,
    created_at           timestamptz not null default now()
);
create index idx_lead_int_lead     on lead_interactions(lead_id);
create index idx_lead_int_business on lead_interactions(business_id);

-- ---------------------------------------------------------------------------
-- Credit ledger (ADR-005). Prepaid credits = DEFERRED REVENUE; recognize on consumption.
-- Provider-agnostic: top-ups carry a `provider` so manual QR -> PhaJay -> Stripe is a driver swap.
-- ---------------------------------------------------------------------------
create table credit_accounts (
    business_id uuid primary key references businesses(id) on delete cascade,
    balance     integer not null default 0 check (balance >= 0),
    updated_at  timestamptz not null default now()
);

create table credit_transactions (
    id          bigint generated always as identity primary key,
    business_id uuid not null references businesses(id) on delete cascade,
    delta       integer not null,               -- +topup / -consumption
    kind        varchar(20) not null check (kind in ('topup','consume','refund','adjust')),
    provider    varchar(30),                     -- manual_qr, phajay, bcel, stripe_th, xendit_vn
    reference   text,                            -- bank slip ref / PSP txn id
    lead_id     uuid references leads(id) on delete set null,
    created_at  timestamptz not null default now()
);
create index idx_credit_txn_business on credit_transactions(business_id);

-- ---------------------------------------------------------------------------
-- Reciprocal Rank Fusion (ADR-002) — fuses dense (pgvector) + lexical (PGroonga) rankings.
-- RRF consumes rank ORDER only, so incompatible score scales never need normalizing.
--   query_embedding : BGE-M3 vector(1024) for the user query
--   query_text      : raw query string (PGroonga &@~ handles Thai/Lao tokenization)
-- ---------------------------------------------------------------------------
create or replace function hybrid_search(
    query_text       text,
    query_embedding  vector(1024),
    filter_city_id   integer default null,
    match_count      integer default 15,
    rrf_k            integer default 50,
    full_text_weight real default 1.0,
    semantic_weight  real default 1.0
)
returns setof businesses
language sql stable
as $$
    with semantic as (
        -- Collapse the per-(business,lang) embedding rows to ONE row per business (its best/
        -- nearest language vector) BEFORE ranking, so a business can't appear 2-4x and skew RRF.
        select business_id,
               row_number() over (order by dist) as rank_ix
        from (
            select distinct on (be.business_id)
                   be.business_id,
                   be.embedding <=> query_embedding as dist
            from business_embeddings be
            join businesses b on b.id = be.business_id
            where (filter_city_id is null or b.city_id = filter_city_id)
            order by be.business_id, be.embedding <=> query_embedding
        ) d
        order by dist
        limit least(match_count, 30) * 2
    ),
    lexical as (
        select b.id as business_id,
               row_number() over (order by pgroonga_score(tableoid, ctid) desc) as rank_ix
        from businesses b
        where b.search_doc &@~ query_text
          and (filter_city_id is null or b.city_id = filter_city_id)
        order by pgroonga_score(tableoid, ctid) desc
        limit least(match_count, 30) * 2
    )
    select b.*
    from semantic s
    full outer join lexical l on s.business_id = l.business_id
    join businesses b on b.id = coalesce(s.business_id, l.business_id)
    order by
        coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight +
        coalesce(1.0 / (rrf_k + l.rank_ix), 0.0) * full_text_weight desc
    limit least(match_count, 30);
$$;

-- ---------------------------------------------------------------------------
-- Authorization note (ADR-006): with app-layer auth (Better Auth / Auth.js) rather than
-- Supabase GoTrue, there is no in-Postgres `auth.uid()`, so we do NOT enable RLS here —
-- the application layer (Next.js route handlers / service) enforces ownership + role checks,
-- connecting as a least-privileged DB role. If you instead self-host GoTrue and want RLS,
-- re-enable it in 0002 and add `auth.uid()`-based policies. The directory itself is public-read.
