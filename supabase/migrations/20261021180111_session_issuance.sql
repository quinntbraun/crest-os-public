-- SECURITY2: narrow server-only session creation/snapshots, never tenant access.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner') THEN
    CREATE ROLE crest_session_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_OWNER_REVIEW_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege('crest_session_owner',n.oid,'CREATE'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN
      ('crest_private.actors'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass,
       'crest_private.app_sessions'::regclass,'crest_private.session_events'::regclass)
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR c.relowner<>'crest_schema_owner'::regrole
        OR pg_catalog.has_any_column_privilege('crest_session_owner',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        OR pg_catalog.has_table_privilege('crest_session_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN'))) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_GRANT_REVIEW_REQUIRED';
  END IF;
END
$role$;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_owner REVOKE ALL ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_session_owner;
GRANT EXECUTE ON FUNCTION crest_commands.provider_session_is_live(uuid,uuid) TO crest_session_owner;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,kind,auth_provider_issuer,auth_user_id,current_security_epoch,disabled_at) ON crest_private.actors TO crest_session_owner;
GRANT SELECT(id,status) ON crest.businesses TO crest_session_owner;
GRANT SELECT(business_id,actor_id,active) ON crest.memberships TO crest_session_owner;
-- PostgreSQL requires UPDATE privilege for SELECT FOR SHARE. The immutable id
-- column and false UPDATE checks permit locks but cannot persist identity writes.
GRANT UPDATE(id) ON crest_private.actors,crest.businesses TO crest_session_owner;
CREATE POLICY session_actor_read ON crest_private.actors FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY session_actor_lock ON crest_private.actors FOR UPDATE TO crest_session_owner USING (true) WITH CHECK (false);
CREATE POLICY session_business_read ON crest.businesses FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY session_business_lock ON crest.businesses FOR UPDATE TO crest_session_owner USING (true) WITH CHECK (false);
CREATE POLICY session_membership_read ON crest.memberships FOR SELECT TO crest_session_owner USING (true);
GRANT SELECT(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,revoked_at,trusted,reauth_at,provider_token_ciphertext,key_id,version)
  ON crest_private.app_sessions TO crest_session_owner;
GRANT INSERT(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by,operation_id)
  ON crest_private.app_sessions TO crest_session_owner;
GRANT INSERT ON crest_private.session_events TO crest_session_owner;
CREATE POLICY session_owner_read ON crest_private.app_sessions FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY session_owner_insert ON crest_private.app_sessions FOR INSERT TO crest_session_owner WITH CHECK (true);
CREATE POLICY session_owner_history ON crest_private.session_events FOR INSERT TO crest_session_owner WITH CHECK (true);

CREATE FUNCTION crest_commands.session_actor_context(expected_issuer text,expected_subject uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_FRESH_READ_REQUIRED'; END IF;
  RETURN (SELECT jsonb_build_object('actorId',a.id,'securityEpoch',a.current_security_epoch)
    FROM crest_private.actors a WHERE a.auth_provider_issuer=expected_issuer AND a.auth_user_id=expected_subject::text
      AND a.kind='owner' AND a.disabled_at IS NULL
      AND EXISTS (SELECT 1 FROM crest.memberships m JOIN crest.businesses b ON b.id=m.business_id
        WHERE m.actor_id=a.id AND m.active AND b.status IN ('setup','active')));
END
$context$;

CREATE FUNCTION crest_commands.issue_app_session(new_id uuid,credential_hash bytea,expected_actor uuid,expected_epoch uuid,
  expected_issuer text,expected_subject uuid,provider_session uuid,password_at timestamptz,totp_at timestamptz,
  is_trusted boolean,token_ciphertext bytea,token_key text,request_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $issue$
DECLARE stamp timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_FRESH_READ_REQUIRED'; END IF;
  IF new_id IS NULL OR credential_hash IS NULL OR octet_length(credential_hash)<>32 OR expected_actor IS NULL OR expected_epoch IS NULL
    OR expected_issuer IS NULL OR length(expected_issuer)>500 OR expected_subject IS NULL OR provider_session IS NULL
    OR password_at IS NULL OR totp_at IS NULL OR NOT isfinite(password_at) OR NOT isfinite(totp_at) OR is_trusted IS NULL
    OR token_ciphertext IS NULL OR octet_length(token_ciphertext) NOT BETWEEN 1 AND 65536
    OR token_key IS NULL OR token_key !~ '^[A-Za-z0-9_-]{1,100}$' OR request_operation IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_ISSUE_INPUT_REQUIRED';
  END IF;
  PERFORM 1 FROM crest_private.actors a WHERE a.id=expected_actor FOR SHARE;
  -- Same actor-before-business order used by identity mutations. Fresh checks
  -- after waiting on roots close epoch/disable/membership transition races.
  PERFORM b.id FROM crest.businesses b WHERE EXISTS
    (SELECT 1 FROM crest.memberships m WHERE m.business_id=b.id AND m.actor_id=expected_actor) ORDER BY b.id FOR SHARE OF b;
  stamp:=date_trunc('milliseconds',clock_timestamp());
  IF password_at>stamp OR totp_at>stamp OR password_at<=stamp-interval '15 minutes' OR totp_at<=stamp-interval '15 minutes'
    OR NOT EXISTS (SELECT 1 FROM crest_private.actors a WHERE a.id=expected_actor AND a.kind='owner' AND a.disabled_at IS NULL
      AND a.current_security_epoch=expected_epoch AND a.auth_provider_issuer=expected_issuer AND a.auth_user_id=expected_subject::text
      AND EXISTS (SELECT 1 FROM crest.memberships m JOIN crest.businesses b ON b.id=m.business_id
        WHERE m.actor_id=a.id AND m.active AND b.status IN ('setup','active')))
    OR NOT crest_commands.provider_session_is_live(expected_subject,provider_session) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_ISSUE_DENIED';
  END IF;
  INSERT INTO crest_private.app_sessions(id,actor_id,provider_session_id,token_hash,issued_security_epoch,created_at,authenticated_at,
    last_active_at,expires_at,trusted,provider_token_ciphertext,key_id,created_by,updated_by,operation_id)
    VALUES(new_id,expected_actor,provider_session,credential_hash,expected_epoch,stamp,least(password_at,totp_at),stamp,
      stamp+CASE WHEN is_trusted THEN interval '720 hours' ELSE interval '12 hours' END,is_trusted,token_ciphertext,token_key,
      expected_actor,expected_actor,request_operation);
END
$issue$;

CREATE FUNCTION crest_commands.app_session_snapshot(credential_hash bytea)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $snapshot$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_FRESH_READ_REQUIRED'; END IF;
  IF credential_hash IS NULL OR octet_length(credential_hash)<>32 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_SNAPSHOT_INPUT_REQUIRED'; END IF;
  RETURN (SELECT jsonb_build_object('id',s.id,'version',s.version::text,'now',floor(extract(epoch FROM clock_timestamp())*1000)::bigint,
    'binding',jsonb_build_object('actorId',a.id,'appSessionId',s.id,'providerSessionId',s.provider_session_id,
      'securityEpoch',s.issued_security_epoch,'subject',a.auth_user_id,'issuer',a.auth_provider_issuer),
    'actor',jsonb_build_object('id',a.id,'kind',a.kind,'securityEpoch',a.current_security_epoch,'disabled',a.disabled_at IS NOT NULL),
    'session',jsonb_build_object('actorId',s.actor_id,'issuedSecurityEpoch',s.issued_security_epoch,'trusted',s.trusted,
      'createdAt',floor(extract(epoch FROM s.created_at)*1000)::bigint,'authenticatedAt',floor(extract(epoch FROM s.authenticated_at)*1000)::bigint,
      'lastActiveAt',floor(extract(epoch FROM s.last_active_at)*1000)::bigint,'expiresAt',floor(extract(epoch FROM s.expires_at)*1000)::bigint,
      'revokedAt',NULL,'reauthAt',floor(extract(epoch FROM s.reauth_at)*1000)::bigint),
    'keyId',s.key_id,'ciphertext',encode(s.provider_token_ciphertext,'base64'))
    FROM crest_private.app_sessions s JOIN crest_private.actors a ON a.id=s.actor_id
    WHERE s.token_hash=credential_hash AND s.revoked_at IS NULL AND s.provider_token_ciphertext IS NOT NULL AND s.key_id IS NOT NULL
      AND a.kind='owner' AND a.disabled_at IS NULL AND a.current_security_epoch=s.issued_security_epoch);
END
$snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.session_actor_context(text,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.app_session_snapshot(bytea) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.session_actor_context(text,uuid),crest_commands.issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.app_session_snapshot(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.session_actor_context(text,uuid),crest_commands.issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.app_session_snapshot(bytea) TO crest_web;
