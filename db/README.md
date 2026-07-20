# Database ownership

The Python worker owns the shared PostgreSQL/PostGIS schema. Apply migrations from the repository
root with:

```powershell
uv run alembic -c services/worker/alembic.ini upgrade head
```

The first migration creates `sync_runs`, the API transactional `outbox_events`, normalized
`activities`, and `ingestion_failures`. The `route` column is a nullable PostGIS
`geometry(LineString,4326)` with a GiST index. Migration downgrades leave the shared `postgis`
extension installed intentionally.

