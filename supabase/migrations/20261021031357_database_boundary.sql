-- DATABASE 2 / SECURITY 3: closed application namespaces before identity storage.
-- No login credentials, provider grants, business rows or executable commands.
-- Existing cluster roles must already satisfy the contract; never adopt or repair
-- an overprivileged role. Roles are cluster-wide, defaults/schemas database-local.
DO $boundary$
DECLARE
  role_name text;
  role_id oid;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'crest_schema_owner', 'crest_command_owner', 'crest_web',
    'crest_worker', 'crest_recovery'
  ] LOOP
    SELECT oid INTO role_id FROM pg_catalog.pg_roles WHERE rolname = role_name;
    IF role_id IS NULL THEN
      EXECUTE pg_catalog.format(
        'CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        role_name
      );
      SELECT oid INTO role_id FROM pg_catalog.pg_roles WHERE rolname = role_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles
      WHERE oid = role_id AND (
        rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole
        OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL
      )
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members
      WHERE roleid = role_id OR member = role_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CREST_ROLE_REVIEW_REQUIRED';
    END IF;
  END LOOP;
END
$boundary$;

-- Fail on namespace collisions rather than silently taking over existing objects.
CREATE SCHEMA crest AUTHORIZATION crest_schema_owner;
CREATE SCHEMA crest_private AUTHORIZATION crest_schema_owner;
CREATE SCHEMA crest_commands AUTHORIZATION crest_schema_owner;
REVOKE ALL ON SCHEMA crest, crest_private, crest_commands FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- USAGE is name resolution only. Every future table/routine needs a separate,
-- reviewed grant and its own session/capability/RLS enforcement.
GRANT USAGE ON SCHEMA crest, crest_commands TO crest_web;
GRANT USAGE ON SCHEMA crest, crest_private, crest_commands TO crest_command_owner;
-- Worker/recovery have no application access until narrowly reviewed commands exist.

-- Per-schema REVOKE cannot remove globally inherited PUBLIC EXECUTE/USAGE.
-- Object creation must run AS its intended owner, not just transfer ownership
-- afterwards (defaults belong to the creating role).
ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner, crest_command_owner
  REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner, crest_command_owner
  REVOKE ALL ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner, crest_command_owner
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner, crest_command_owner
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_schema_owner, crest_command_owner
  REVOKE ALL ON SCHEMAS FROM PUBLIC;
