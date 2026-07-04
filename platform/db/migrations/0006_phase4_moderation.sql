-- =============================================================================
-- 0006_phase4_moderation.sql  (Phase 4 — trust & moderation closed loop)
--   - businesses.trust_summary : AI Semantic Trust Summary (spec §3.2), grounded in reviews
--   - review_solicitations      : closed-loop review requests triggered on lead.won
-- Admin approval of Tier-2/3 evidence and pending reviews is enforced in the app layer.
-- =============================================================================

alter table businesses add column if not exists trust_summary    text;
alter table businesses add column if not exists trust_summary_at timestamptz;

create table if not exists review_solicitations (
    id             uuid primary key default gen_random_uuid(),
    lead_id        uuid references leads(id) on delete set null,
    business_id    uuid not null references businesses(id) on delete cascade,
    consumer_email text,
    status         text not null default 'pending' check (status in ('pending', 'sent', 'completed')),
    created_at     timestamptz not null default now()
);
create index if not exists idx_solicit_business on review_solicitations(business_id);
create index if not exists idx_solicit_status on review_solicitations(status) where status = 'pending';
