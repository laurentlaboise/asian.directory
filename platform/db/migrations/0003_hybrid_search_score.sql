-- =============================================================================
-- 0003_hybrid_search_score.sql
-- Redefine hybrid_search to also return the fused RRF score, so the app can apply a
-- confidence threshold (graceful "couldn't find a strong match" fallback — spec §1.3).
-- Return type changes, so we DROP then CREATE (CREATE OR REPLACE can't change the signature).
-- =============================================================================

drop function if exists hybrid_search(text, vector, integer, integer, integer, real, real);

create function hybrid_search(
    query_text       text,
    query_embedding  vector(1024),
    filter_city_id   integer default null,
    match_count      integer default 15,
    rrf_k            integer default 50,
    full_text_weight real default 1.0,
    semantic_weight  real default 1.0
)
returns table(business businesses, score real)
language sql stable
as $$
    with semantic as (
        select business_id,
               row_number() over (order by dist) as rank_ix
        from (
            select distinct on (be.business_id)
                   be.business_id,
                   be.embedding <=> query_embedding as dist
            from business_embeddings be
            join businesses b on b.id = be.business_id
            where b.status = 'active'
              and (filter_city_id is null or b.city_id = filter_city_id)
            order by be.business_id, be.embedding <=> query_embedding
        ) d
        order by dist
        limit least(match_count, 30) * 2
    ),
    lexical as (
        select b.id as business_id,
               row_number() over (order by pgroonga_score(tableoid, ctid) desc) as rank_ix
        from businesses b
        where b.status = 'active'
          and b.search_doc &@~ pgroonga_query_escape(query_text)
          and (filter_city_id is null or b.city_id = filter_city_id)
        order by pgroonga_score(tableoid, ctid) desc
        limit least(match_count, 30) * 2
    )
    select b as business,
           (coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight +
            coalesce(1.0 / (rrf_k + l.rank_ix), 0.0) * full_text_weight)::real as score
    from semantic s
    full outer join lexical l on s.business_id = l.business_id
    join businesses b on b.id = coalesce(s.business_id, l.business_id)
    order by score desc, b.id   -- deterministic tiebreak (stable order on equal RRF scores)
    limit least(match_count, 30);
$$;
