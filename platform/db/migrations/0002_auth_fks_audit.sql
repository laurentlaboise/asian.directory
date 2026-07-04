-- =============================================================================
-- 0002_auth_fks_audit.sql
-- MUST run AFTER `npx @better-auth/cli migrate` has created the `user` table.
-- Adds: audit_log, and the hard FKs from domain tables to Better Auth's user id
-- (deferred out of 0001 to avoid a create-time ordering dependency on auth tables).
-- =============================================================================

-- Audit trail for security-relevant events (auth, claims, lead actions).
create table if not exists audit_log (
    id          bigint generated always as identity primary key,
    user_id     text,                    -- Better Auth user.id (nullable for anonymous/system)
    action      text not null,           -- e.g. business.claim, auth.login, lead.claim
    entity_type text not null,
    entity_id   text,
    metadata    jsonb,
    ip          text,
    created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created on audit_log(created_at);
create index if not exists idx_audit_user    on audit_log(user_id);
create index if not exists idx_audit_entity  on audit_log(entity_type, entity_id);

-- Hard FKs to Better Auth's user table ("user" is a reserved word -> must be quoted).
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each is guarded to stay re-runnable.
do $$ begin
    alter table businesses add constraint fk_businesses_owner
        foreign key (owner_id) references "user"(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
    alter table profiles add constraint fk_profiles_user
        foreign key (user_id) references "user"(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
    alter table leads add constraint fk_leads_user
        foreign key (user_id) references "user"(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
    alter table audit_log add constraint fk_audit_user
        foreign key (user_id) references "user"(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Owner lookups (merchant dashboard "my businesses").
create index if not exists idx_businesses_owner on businesses(owner_id);
