-- =============================================================================
-- 0005_phase3_leads.sql  (Phase 3 — lead routing & monetization, in-app core)
-- Extends the lead objects from 0001 with contact + routing + expiry fields.
-- Notifications beyond in-dashboard (LINE/Zalo/SMS) and automated payment
-- collection are deferred (Phase 0 entity/PSP blockers); this is the in-app core.
-- =============================================================================

alter table leads add column if not exists matched_business_id uuid references businesses(id) on delete set null;
alter table leads add column if not exists contact_name  text;
alter table leads add column if not exists contact_email text;
alter table leads add column if not exists message       text;
alter table leads add column if not exists city_id       integer references cities(id) on delete set null;
alter table leads add column if not exists expires_at    timestamptz;

-- Find expirable leads cheaply (pool/notified past their window).
create index if not exists idx_leads_expiring on leads(expires_at)
    where status in ('opportunity_pool', 'notified', 'auto_routed');

-- One business can only be offered a given lead once (idempotent routing / no double-charge path).
create unique index if not exists uq_lead_interaction_pair on lead_interactions(lead_id, business_id);
