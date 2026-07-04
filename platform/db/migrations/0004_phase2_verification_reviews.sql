-- =============================================================================
-- 0004_phase2_verification_reviews.sql  (Phase 2)
-- MUST run AFTER `npx @better-auth/cli migrate` (references "user"). Adds:
--   - otp_challenges          : real Tier-1 verification (proves control of a contact)
--   - verification_submissions: Tier-2/3 evidence (community / MOIC / O2O), admin-reviewed
--   - reviews                 : media-first reviews with a moderation status
-- =============================================================================

-- Tier-1 OTP challenges. The code is stored HASHED (peppered); we never persist the plaintext.
create table if not exists otp_challenges (
    id           uuid primary key default gen_random_uuid(),
    user_id      text not null,
    business_id  uuid not null references businesses(id) on delete cascade,
    channel      text not null check (channel in ('email', 'phone')),
    destination  text not null,
    code_hash    text not null,
    expires_at   timestamptz not null,
    attempts     smallint not null default 0,
    consumed_at  timestamptz,
    created_at   timestamptz not null default now()
);
create index if not exists idx_otp_business on otp_challenges(business_id);
create index if not exists idx_otp_active on otp_challenges(user_id, business_id) where consumed_at is null;

-- Tier-2/3 evidence, reviewed by an admin (approval raises verification_tier).
create table if not exists verification_submissions (
    id             uuid primary key default gen_random_uuid(),
    business_id    uuid not null references businesses(id) on delete cascade,
    submitted_by   text not null,
    tier_requested smallint not null check (tier_requested in (2, 3)),
    kind           text not null check (kind in ('community', 'moic', 'o2o')),
    evidence_url   text not null,
    note           text,
    status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by    text,
    reviewed_at    timestamptz,
    created_at     timestamptz not null default now()
);
create index if not exists idx_verif_business on verification_submissions(business_id);
create index if not exists idx_verif_status on verification_submissions(status) where status = 'pending';

-- Media-first reviews. Media are URLs uploaded to object storage out-of-band. Moderation
-- status gates publication; aggregates on `businesses` update only when a review is published.
create table if not exists reviews (
    id           uuid primary key default gen_random_uuid(),
    business_id  uuid not null references businesses(id) on delete cascade,
    author_id    text not null,
    rating       smallint not null check (rating between 1 and 5),
    body         text,
    media        jsonb not null default '[]',   -- [{ url, kind: 'image'|'video' }]
    status       text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
    flagged      boolean not null default false,
    flag_reason  text,
    created_at   timestamptz not null default now(),
    unique (business_id, author_id)             -- one review per author per business
);
create index if not exists idx_reviews_business on reviews(business_id, status);

-- FKs to Better Auth's user table (guarded; "user" is reserved).
do $$ begin
    alter table otp_challenges add constraint fk_otp_user
        foreign key (user_id) references "user"(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
    alter table verification_submissions add constraint fk_verif_user
        foreign key (submitted_by) references "user"(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
    alter table reviews add constraint fk_reviews_author
        foreign key (author_id) references "user"(id) on delete cascade;
exception when duplicate_object then null; end $$;
