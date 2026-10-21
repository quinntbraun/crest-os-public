-- SECURITY2: reduce access using possession of a session credential hash.
-- No session issuance, positive authorization, browser route or provider call.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_command_owner'
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
      WHERE roleid='crest_command_owner'::regrole OR member='crest_command_owner'::regrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('crest_private.app_sessions'::regclass,'crest_private.session_events'::regclass)
      AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>2
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest_private.app_sessions','SELECT,INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_table_privilege('crest_command_owner','crest_private.app_sessions','DELETE,TRUNCATE,TRIGGER')
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest_private.session_events','SELECT,INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_table_privilege('crest_command_owner','crest_private.session_events','DELETE,TRUNCATE,TRIGGER') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_COMMAND_BOUNDARY_REVIEW_REQUIRED';
  END IF;
END
$review$;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,actor_id,token_hash,revoked_at,version) ON crest_private.app_sessions TO crest_command_owner;
GRANT UPDATE(revoked_at,version,updated_by,operation_id) ON crest_private.app_sessions TO crest_command_owner;
-- Only the existing invoker trigger appends the safe audit projection.
GRANT INSERT ON crest_private.session_events TO crest_command_owner;
CREATE POLICY session_command_read ON crest_private.app_sessions FOR SELECT TO crest_command_owner USING (true);
CREATE POLICY session_command_revoke ON crest_private.app_sessions FOR UPDATE TO crest_command_owner
  USING (true) WITH CHECK (revoked_at IS NOT NULL AND provider_token_ciphertext IS NULL AND key_id IS NULL);
CREATE POLICY session_command_history ON crest_private.session_events FOR INSERT TO crest_command_owner WITH CHECK (true);

CREATE FUNCTION crest_commands.revoke_app_session(credential_hash bytea,request_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $revoke$
DECLARE session_id uuid; session_actor uuid; session_version bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_COMMAND_FRESH_READ_REQUIRED';
  END IF;
  IF credential_hash IS NULL OR pg_catalog.octet_length(credential_hash)<>32 OR request_operation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_COMMAND_INPUT_REQUIRED';
  END IF;
  SELECT s.id,s.actor_id,s.version INTO session_id,session_actor,session_version
    FROM crest_private.app_sessions s WHERE s.token_hash=credential_hash AND s.revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  -- Current credential possession may always reduce access, even when the
  -- provider is offline, the actor is disabled, or local eligibility has expired.
  -- The immutable trigger clears ciphertext/key_id in the same transaction.
  UPDATE crest_private.app_sessions SET revoked_at=pg_catalog.clock_timestamp(),version=session_version+1,
    updated_by=session_actor,operation_id=request_operation
    WHERE id=session_id AND version=session_version AND revoked_at IS NULL;
END
$revoke$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.revoke_app_session(bytea,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.revoke_app_session(bytea,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.revoke_app_session(bytea,uuid) TO crest_web;
