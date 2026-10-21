-- SECURITY2: one boolean provider check, never a general auth-table reader.
-- The provider's own migrations must already have installed auth.sessions.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relname='sessions' AND c.relkind='r' AND c.relrowsecurity
      AND pg_catalog.pg_get_userbyid(c.relowner)='supabase_auth_admin')
    OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=pg_catalog.to_regclass('auth.sessions')
      AND NOT attisdropped AND ((attname IN ('id','user_id') AND atttypid='uuid'::regtype)
        OR (attname='not_after' AND atttypid='timestamptz'::regtype)
        OR (attname='aal' AND atttypid=pg_catalog.to_regtype('auth.aal_level'))))<>4 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_PROVIDER_SCHEMA_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_auth_reader') THEN
    CREATE ROLE crest_auth_reader NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  -- As with the existing cluster roles, reject privilege/membership drift.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_auth_reader'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_auth_reader'::regrole OR member='crest_auth_reader'::regrole) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PROVIDER_ROLE_REVIEW_REQUIRED';
  END IF;
END
$review$;

ALTER DEFAULT PRIVILEGES FOR ROLE crest_auth_reader REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_auth_reader REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_auth_reader REVOKE ALL ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_auth_reader REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_auth_reader REVOKE ALL ON SCHEMAS FROM PUBLIC;
GRANT USAGE ON SCHEMA auth TO crest_auth_reader;
GRANT SELECT(id,user_id,not_after,aal) ON auth.sessions TO crest_auth_reader;
-- RLS stays enabled. This non-login function owner has no role memberships,
-- no user/refresh-token access, and no application-table rights.
CREATE POLICY crest_auth_reader_sessions ON auth.sessions FOR SELECT TO crest_auth_reader USING (true);

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.provider_session_is_live(expected_subject uuid,expected_session uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PROVIDER_FRESH_READ_REQUIRED';
  END IF;
  RETURN EXISTS (SELECT 1 FROM auth.sessions s
    WHERE s.id=expected_session AND s.user_id=expected_subject AND s.aal='aal2'
      AND (s.not_after IS NULL OR (pg_catalog.isfinite(s.not_after) AND s.not_after>pg_catalog.clock_timestamp())));
END
$lookup$;
RESET ROLE;
-- Temporary CREATE is required to transfer the function to its restricted owner.
GRANT USAGE,CREATE ON SCHEMA crest_commands TO crest_auth_reader;
ALTER FUNCTION crest_commands.provider_session_is_live(uuid,uuid) OWNER TO crest_auth_reader;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_auth_reader;
REVOKE ALL ON FUNCTION crest_commands.provider_session_is_live(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.provider_session_is_live(uuid,uuid) TO crest_web;
