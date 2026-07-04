-- =============================================================================
-- 0008_rich_business_fields.sql  (richer business profiles)
-- Adds the fuller data model the spec's Rich Cards / profiles want, and rebuilds
-- search_doc so address / business_type / keywords are lexically searchable too.
-- =============================================================================

alter table businesses add column if not exists business_type    text;
alter table businesses add column if not exists address          text;
alter table businesses add column if not exists socials          jsonb not null default '{}'::jsonb;
alter table businesses add column if not exists keywords         jsonb not null default '[]'::jsonb;
alter table businesses add column if not exists year_established  integer;
alter table businesses add column if not exists employee_count   text;
alter table businesses add column if not exists business_hours   jsonb;
alter table businesses add column if not exists meta_description  text;

-- Rebuild search_doc (a generated column) to include the new searchable text. Generated columns
-- can't use subqueries, so keywords is folded in as its raw JSON text (PGroonga tokenizes the
-- words and ignores the punctuation). Drop the dependent PGroonga index, swap the column, recreate.
drop index if exists idx_biz_search_pgroonga;
alter table businesses drop column if exists search_doc;
alter table businesses add column search_doc text generated always as (
    coalesce(name, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(business_type, '') || ' ' ||
    coalesce(address, '') || ' ' ||
    coalesce(keywords::text, '')
) stored;
create index idx_biz_search_pgroonga on businesses using pgroonga (search_doc);
