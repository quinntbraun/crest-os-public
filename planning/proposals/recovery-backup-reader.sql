-- UNREGISTERED review of the dedicated full-database backup reader over137.
-- Operator-only, whole configured database; never a tenant/browser export role.
-- A registered migration and current-schema adoption remain required.
RESET ROLE;
DO $review$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>137
 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'20270130180000'
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_backup_reader')
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR (rolcreaterole AND rolbypassrls)))
 OR (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY (n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex')
   FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped)
   IS DISTINCT FROM '0acf82b5964422749c238644181cd8d9b29f6168813db9f8dc910435852f8ee8'
 OR EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid,
   LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   WHERE n.nspname IN('crest','crest_private','auth','supabase_migrations','public') AND c.relkind IN('r','p')
   AND a.grantee=0 AND a.privilege_type IN('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
 OR EXISTS(SELECT 1 FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid,
   LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE n.nspname IN('crest','crest_private','crest_commands','auth','public') AND p.prosecdef AND a.grantee=0 AND a.privilege_type='EXECUTE')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BACKUP_READER_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_backup_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands,auth,supabase_migrations,public TO crest_backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA crest,crest_private,auth,supabase_migrations,public TO crest_backup_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA crest,crest_private,auth,supabase_migrations,public TO crest_backup_reader;
-- No login/membership, business command, function EXECUTE, write, schema CREATE,
-- grant option or default privilege is introduced. Future tables fail closed.
