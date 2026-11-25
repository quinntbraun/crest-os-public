-- Export snapshots compare actual applied migration identity to their bundled
-- source. No migration statements, financial data or write privilege is granted.
RESET ROLE;
GRANT USAGE ON SCHEMA supabase_migrations TO crest_export;
GRANT SELECT(version,name) ON supabase_migrations.schema_migrations TO crest_export;
