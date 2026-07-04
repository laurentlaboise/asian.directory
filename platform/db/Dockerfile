# =============================================================================
# Postgres 17 + pgvector + PGroonga — the SEA Directory database image.
#   pgvector  -> ADR-001 (vector(1024) HNSW dense search)
#   PGroonga  -> ADR-002 (Thai/Lao/Vietnamese tokenizing full-text)
#
# shared_preload_libraries: NONE required. Neither pgvector nor PGroonga needs it
# (both are enabled per-database with CREATE EXTENSION, which 0001_init.sql does).
# Only ParadeDB BM25 would need shared_preload_libraries — and we deferred it.
# =============================================================================
FROM postgres:17-bookworm

# pgvector comes from the PGDG apt repo already configured in the official image.
# PGroonga comes from the Groonga apt repo (bookworm, pinned to match the base).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        postgresql-17-pgvector \
        curl ca-certificates; \
    curl -fsSL -o /tmp/groonga-apt-source.deb \
        https://packages.groonga.org/debian/groonga-apt-source-latest-bookworm.deb; \
    apt-get install -y --no-install-recommends /tmp/groonga-apt-source.deb; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-17-pgroonga; \
    rm -rf /var/lib/apt/lists/* /tmp/groonga-apt-source.deb

# Inherits the official postgres entrypoint: it runs initdb and honors
# POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / PGDATA at first boot.
EXPOSE 5432
