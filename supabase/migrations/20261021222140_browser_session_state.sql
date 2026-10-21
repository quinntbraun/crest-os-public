-- SECURITY2/4: bounded anonymous login contexts and private synchronizer state.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_login_owner','crest_session_owner')
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid IN ('crest_login_owner'::regrole,'crest_session_owner'::regrole)
      OR member IN ('crest_login_owner'::regrole,'crest_session_owner'::regrole))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege('crest_login_owner',n.oid,'CREATE')
      OR pg_catalog.has_schema_privilege('crest_session_owner',n.oid,'CREATE')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BROWSER_OWNER_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.login_contexts (
  id uuid PRIMARY KEY,
  credential_hash bytea NOT NULL UNIQUE CHECK (octet_length(credential_hash)=32),
  ip_hash bytea NOT NULL CHECK (octet_length(ip_hash)=32),
  csrf_hash bytea CHECK (csrf_hash IS NULL OR octet_length(csrf_hash)=32),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (expires_at=created_at+interval '10 minutes'),
  consumed_at timestamptz CHECK (isfinite(consumed_at) AND consumed_at>=created_at),
  CHECK ((consumed_at IS NULL)=(csrf_hash IS NOT NULL))
);
CREATE INDEX login_context_ip ON crest_private.login_contexts(ip_hash,created_at);
CREATE INDEX login_context_expiry ON crest_private.login_contexts(created_at,id);
CREATE TABLE crest_private.session_csrf_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
  token_hash bytea NOT NULL CHECK (octet_length(token_hash)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  UNIQUE(session_id,token_hash)
);
CREATE INDEX session_csrf_parent ON crest_private.session_csrf_tokens(session_id,created_at,id);
ALTER TABLE crest_private.login_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.login_contexts FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.session_csrf_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.session_csrf_tokens FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON crest_private.login_contexts TO crest_login_owner;
GRANT UPDATE(csrf_hash,consumed_at) ON crest_private.login_contexts TO crest_login_owner;
CREATE POLICY login_context_read ON crest_private.login_contexts FOR SELECT TO crest_login_owner USING (true);
CREATE POLICY login_context_insert ON crest_private.login_contexts FOR INSERT TO crest_login_owner WITH CHECK (true);
CREATE POLICY login_context_consume ON crest_private.login_contexts FOR UPDATE TO crest_login_owner
  USING (consumed_at IS NULL) WITH CHECK (consumed_at IS NOT NULL AND csrf_hash IS NULL);
CREATE POLICY login_context_expire ON crest_private.login_contexts FOR DELETE TO crest_login_owner
  USING (created_at<=clock_timestamp()-interval '15 minutes');
GRANT SELECT,INSERT,DELETE ON crest_private.session_csrf_tokens TO crest_session_owner;
CREATE POLICY session_csrf_read ON crest_private.session_csrf_tokens FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY session_csrf_insert ON crest_private.session_csrf_tokens FOR INSERT TO crest_session_owner WITH CHECK (true);
CREATE POLICY session_csrf_retire ON crest_private.session_csrf_tokens FOR DELETE TO crest_session_owner USING (true);

CREATE FUNCTION crest_commands.create_login_context(context_id uuid,credential bytea,ip_digest bytea,csrf_digest bytea,expected_key bytea,previous_credential bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $create$
DECLARE stored_key bytea; stamp timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BROWSER_FRESH_READ_REQUIRED'; END IF;
  IF context_id IS NULL OR credential IS NULL OR octet_length(credential)<>32 OR ip_digest IS NULL OR octet_length(ip_digest)<>32
    OR csrf_digest IS NULL OR octet_length(csrf_digest)<>32 OR expected_key IS NULL OR octet_length(expected_key)<>32
    OR (previous_credential IS NOT NULL AND octet_length(previous_credential)<>32) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BROWSER_INPUT_REQUIRED';
  END IF;
  SELECT key_fingerprint INTO stored_key FROM crest_private.login_limit_state WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_STATE_REQUIRED'; END IF;
  IF stored_key IS NULL THEN UPDATE crest_private.login_limit_state SET key_fingerprint=expected_key WHERE singleton;
  ELSIF stored_key<>expected_key THEN RETURN NULL; END IF;
  stamp:=clock_timestamp();
  DELETE FROM crest_private.login_contexts WHERE id IN
    (SELECT id FROM crest_private.login_contexts WHERE created_at<=stamp-interval '15 minutes' ORDER BY created_at,id LIMIT 256);
  IF (SELECT count(*) FROM crest_private.login_contexts WHERE ip_hash=ip_digest AND created_at>stamp-interval '15 minutes')>=20
    OR (SELECT count(*) FROM crest_private.login_contexts WHERE created_at>stamp-interval '15 minutes')>=1000 THEN RETURN NULL; END IF;
  UPDATE crest_private.login_contexts SET consumed_at=stamp,csrf_hash=NULL WHERE credential_hash=previous_credential AND consumed_at IS NULL;
  INSERT INTO crest_private.login_contexts(id,credential_hash,ip_hash,csrf_hash,created_at,expires_at)
    VALUES(context_id,credential,ip_digest,csrf_digest,stamp,stamp+interval '10 minutes');
  RETURN jsonb_build_object('id',context_id,'expiresAt',floor(extract(epoch FROM stamp+interval '10 minutes')*1000)::bigint);
END
$create$;
CREATE FUNCTION crest_commands.login_context_snapshot(credential bytea,ip_digest bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $snapshot$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BROWSER_FRESH_READ_REQUIRED'; END IF;
  IF credential IS NULL OR octet_length(credential)<>32 OR ip_digest IS NULL OR octet_length(ip_digest)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BROWSER_INPUT_REQUIRED'; END IF;
  RETURN (SELECT jsonb_build_object('id',id,'csrfHash',encode(csrf_hash,'base64')) FROM crest_private.login_contexts
    WHERE credential_hash=credential AND ip_hash=ip_digest AND consumed_at IS NULL AND expires_at>clock_timestamp());
END
$snapshot$;
CREATE FUNCTION crest_commands.consume_login_context(credential bytea,ip_digest bytea,csrf_digest bytea)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $consume$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BROWSER_FRESH_READ_REQUIRED'; END IF;
  IF credential IS NULL OR octet_length(credential)<>32 OR ip_digest IS NULL OR octet_length(ip_digest)<>32 OR csrf_digest IS NULL OR octet_length(csrf_digest)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BROWSER_INPUT_REQUIRED'; END IF;
  UPDATE crest_private.login_contexts SET consumed_at=clock_timestamp(),csrf_hash=NULL
    WHERE credential_hash=credential AND ip_hash=ip_digest AND csrf_hash=csrf_digest AND consumed_at IS NULL AND expires_at>clock_timestamp();
  RETURN FOUND;
END
$consume$;

CREATE FUNCTION crest_commands.bind_browser_session(credential bytea,csrf_digest bytea,previous_credential bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $bind$
DECLARE current_row jsonb; stamp bigint; new_proof uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BROWSER_FRESH_READ_REQUIRED'; END IF;
  IF credential IS NULL OR octet_length(credential)<>32 OR csrf_digest IS NULL OR octet_length(csrf_digest)<>32
    OR (previous_credential IS NOT NULL AND (octet_length(previous_credential)<>32 OR previous_credential=credential)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BROWSER_INPUT_REQUIRED';
  END IF;
  -- Lock all actor roots, then all session roots in UUID order for replacement.
  PERFORM a.id FROM crest_private.actors a WHERE EXISTS
    (SELECT 1 FROM crest_private.app_sessions s WHERE s.actor_id=a.id AND s.token_hash IN (credential,previous_credential)) ORDER BY a.id FOR SHARE OF a;
  PERFORM s.id FROM crest_private.app_sessions s WHERE s.token_hash IN (credential,previous_credential) ORDER BY s.id FOR UPDATE OF s;
  current_row:=crest_commands.app_session_snapshot(credential);stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
  IF current_row IS NULL OR stamp>=(current_row->'session'->>'expiresAt')::bigint
    OR ((current_row->'session'->>'trusted')::boolean AND stamp-(current_row->'session'->>'lastActiveAt')::bigint>=604800000)
    OR NOT crest_commands.provider_session_is_live((current_row->'binding'->>'subject')::uuid,(current_row->'binding'->>'providerSessionId')::uuid) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BROWSER_SESSION_DENIED';
  END IF;
  INSERT INTO crest_private.session_csrf_tokens(session_id,token_hash) VALUES((current_row->>'id')::uuid,csrf_digest) RETURNING id INTO new_proof;
  -- Always retain the just-issued proof even if timestamps tie or clock steps.
  DELETE FROM crest_private.session_csrf_tokens WHERE session_id=(current_row->>'id')::uuid AND id<>new_proof AND id NOT IN
    (SELECT id FROM crest_private.session_csrf_tokens WHERE session_id=(current_row->>'id')::uuid AND id<>new_proof ORDER BY created_at DESC,id DESC LIMIT 7);
  IF previous_credential IS NOT NULL THEN PERFORM crest_commands.revoke_app_session(previous_credential,gen_random_uuid()); END IF;
  RETURN jsonb_build_object('id',current_row->>'id');
END
$bind$;
CREATE FUNCTION crest_commands.browser_csrf_snapshot(credential bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $csrf$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BROWSER_FRESH_READ_REQUIRED'; END IF;
  IF credential IS NULL OR octet_length(credential)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BROWSER_INPUT_REQUIRED'; END IF;
  -- This grants no positive session/tenant evidence. Retained proofs permit
  -- local logout even for an expired, disabled or already-revoked session.
  RETURN (SELECT jsonb_build_object('id',s.id,'hashes',(SELECT jsonb_agg(encode(c.token_hash,'base64') ORDER BY c.created_at DESC,c.id DESC)
      FROM crest_private.session_csrf_tokens c WHERE c.session_id=s.id)) FROM crest_private.app_sessions s WHERE s.token_hash=credential);
END
$csrf$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.revoke_app_session(bytea,uuid) TO crest_session_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_login_owner,crest_session_owner;
ALTER FUNCTION crest_commands.create_login_context(uuid,bytea,bytea,bytea,bytea,bytea) OWNER TO crest_login_owner;
ALTER FUNCTION crest_commands.login_context_snapshot(bytea,bytea) OWNER TO crest_login_owner;
ALTER FUNCTION crest_commands.consume_login_context(bytea,bytea,bytea) OWNER TO crest_login_owner;
ALTER FUNCTION crest_commands.bind_browser_session(bytea,bytea,bytea) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.browser_csrf_snapshot(bytea) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_login_owner,crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.create_login_context(uuid,bytea,bytea,bytea,bytea,bytea),crest_commands.login_context_snapshot(bytea,bytea),
  crest_commands.consume_login_context(bytea,bytea,bytea),crest_commands.bind_browser_session(bytea,bytea,bytea),crest_commands.browser_csrf_snapshot(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.create_login_context(uuid,bytea,bytea,bytea,bytea,bytea),crest_commands.login_context_snapshot(bytea,bytea),
  crest_commands.consume_login_context(bytea,bytea,bytea),crest_commands.bind_browser_session(bytea,bytea,bytea),crest_commands.browser_csrf_snapshot(bytea) TO crest_web;
