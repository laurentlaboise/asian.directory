-- =============================================================================
-- 0007_phase5_import.sql  (Phase 5 — bulk ingestion)
-- Adds a stable external key so re-running an import is idempotent (upsert by the
-- source's own id, not by the mutable name/slug).
-- =============================================================================

alter table businesses add column if not exists source      varchar(50) not null default 'manual';
alter table businesses add column if not exists external_id  text;

-- One row per (source, external_id) — the idempotency key for imports.
create unique index if not exists uq_biz_source_external
    on businesses(source, external_id) where external_id is not null;
