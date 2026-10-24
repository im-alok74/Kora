-- The health check (GET /api/health) runs as the application role and compares the migrations it ships with against the
-- ones recorded here, so it needs to read the names. Names only; the role still cannot change the table. Safe to repeat.
grant select on schema_migration to kora_app;
