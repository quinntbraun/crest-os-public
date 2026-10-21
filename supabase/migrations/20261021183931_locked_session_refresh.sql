-- SECURITY2: only provider ciphertext/key/version may change during refresh.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='crest_private.app_sessions'::regclass
      AND (NOT relrowsecurity OR NOT relforcerowsecurity OR relowner<>'crest_schema_owner'::regrole))
    OR pg_catalog.has_any_column_privilege('crest_session_owner','crest_private.app_sessions','UPDATE') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_REFRESH_BOUNDARY_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT UPDATE(provider_token_ciphertext,key_id,version,updated_by,operation_id) ON crest_private.app_sessions TO crest_session_owner;
CREATE POLICY session_owner_refresh ON crest_private.app_sessions FOR UPDATE TO crest_session_owner
  USING (true) WITH CHECK (revoked_at IS NULL AND provider_token_ciphertext IS NOT NULL AND key_id IS NOT NULL);

CREATE FUNCTION crest_commands.lock_app_session(credential_hash bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
DECLARE session_actor uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_FRESH_READ_REQUIRED'; END IF;
  IF credential_hash IS NULL OR octet_length(credential_hash)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_REFRESH_INPUT_REQUIRED'; END IF;
  SELECT s.actor_id INTO session_actor FROM crest_private.app_sessions s WHERE s.token_hash=credential_hash;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Actor before session: epoch/disable changes and session rotation serialize.
  PERFORM 1 FROM crest_private.actors a WHERE a.id=session_actor FOR SHARE;
  PERFORM 1 FROM crest_private.app_sessions s WHERE s.token_hash=credential_hash AND s.revoked_at IS NULL FOR UPDATE;
  RETURN crest_commands.app_session_snapshot(credential_hash);
END
$lock$;

CREATE FUNCTION crest_commands.replace_session_tokens(credential_hash bytea,expected_version bigint,token_ciphertext bytea,token_key text,request_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $replace$
DECLARE current_row jsonb; stamp bigint;
BEGIN
  IF expected_version IS NULL OR expected_version<1 OR token_ciphertext IS NULL OR octet_length(token_ciphertext) NOT BETWEEN 1 AND 65536
    OR token_key IS NULL OR token_key !~ '^[A-Za-z0-9_-]{1,100}$' OR request_operation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_REFRESH_INPUT_REQUIRED';
  END IF;
  current_row:=crest_commands.lock_app_session(credential_hash);
  stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF current_row IS NULL OR (current_row->>'version')::bigint<>expected_version
    OR stamp>=(current_row->'session'->>'expiresAt')::bigint
    OR ((current_row->'session'->>'trusted')::boolean AND stamp-(current_row->'session'->>'lastActiveAt')::bigint>=604800000)
    OR NOT crest_commands.provider_session_is_live((current_row->'binding'->>'subject')::uuid,(current_row->'binding'->>'providerSessionId')::uuid) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CREST_REFRESH_STATE_CHANGED';
  END IF;
  UPDATE crest_private.app_sessions SET provider_token_ciphertext=token_ciphertext,key_id=token_key,version=version+1,
    updated_by=(current_row->'binding'->>'actorId')::uuid,operation_id=request_operation
    WHERE token_hash=credential_hash AND version=expected_version AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CREST_REFRESH_STATE_CHANGED'; END IF;
END
$replace$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.lock_app_session(bytea) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.replace_session_tokens(bytea,bigint,bytea,text,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.lock_app_session(bytea),crest_commands.replace_session_tokens(bytea,bigint,bytea,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_app_session(bytea),crest_commands.replace_session_tokens(bytea,bigint,bytea,text,uuid) TO crest_web;
