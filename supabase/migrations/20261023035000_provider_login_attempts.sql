-- SECURITY2: commit a token-free intent before provider I/O. No expiry, close,
-- provider mutation or automatic conclusion about an unknown login outcome.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_session_owner','crest_inventory_owner')
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_session_owner','crest_inventory_owner'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege('crest_session_owner',n.oid,'CREATE')
      OR has_schema_privilege('crest_inventory_owner',n.oid,'CREATE'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_session_owner','crest_inventory_owner') AND a.grantee<>d.defaclrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.sessions'::regclass,'auth.users'::regclass,'auth.refresh_tokens'::regclass,
      'crest_private.actors'::regclass,'crest_private.app_sessions'::regclass,'crest_private.provider_cleanup_references'::regclass,'crest_private.session_events'::regclass)
      AND (has_any_column_privilege('crest_inventory_owner',c.oid,'INSERT,UPDATE,REFERENCES')
        OR has_table_privilege('crest_inventory_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.users'::regclass,'auth.refresh_tokens'::regclass,'crest_private.session_events'::regclass)
      AND has_any_column_privilege('crest_inventory_owner',c.oid,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid IN ('crest_commands.session_actor_context(text,uuid)'::regprocedure,
      'crest_commands.issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)'::regprocedure)
      AND (proowner<>'crest_session_owner'::regrole OR NOT prosecdef OR provolatile<>'v'
        OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_ATTEMPT_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_login_attempts (
  attempt_id uuid PRIMARY KEY,
  reserved_app_session_id uuid NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  issued_security_epoch uuid NOT NULL,
  provider_issuer text NOT NULL CHECK (length(provider_issuer) BETWEEN 1 AND 500),
  provider_subject uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  database_principal text NOT NULL,
  canonical_evidence text NOT NULL CHECK (octet_length(canonical_evidence)<=8192),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$' AND event_hash=encode(sha256(convert_to(canonical_evidence,'UTF8')),'hex'))
);
CREATE INDEX provider_login_attempt_actor ON crest_private.provider_login_attempts(actor_id,created_at,attempt_id);
ALTER TABLE crest_private.provider_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_login_attempts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.provider_login_attempts TO crest_session_owner;
GRANT SELECT ON crest_private.provider_login_attempts TO crest_inventory_owner;
CREATE POLICY login_attempt_session_read ON crest_private.provider_login_attempts FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY login_attempt_session_append ON crest_private.provider_login_attempts FOR INSERT TO crest_session_owner WITH CHECK (true);
CREATE POLICY login_attempt_inventory ON crest_private.provider_login_attempts FOR SELECT TO crest_inventory_owner USING (true);
-- Safe source identity only; no event payload, tokens or credential storage.
GRANT SELECT(id,session_id,actor_id,operation_id,action) ON crest_private.session_events TO crest_inventory_owner;
CREATE POLICY login_attempt_source_event ON crest_private.session_events FOR SELECT TO crest_inventory_owner USING (true);

CREATE FUNCTION crest_private.validate_provider_login_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on SET TimeZone='UTC' SET DateStyle='ISO, YMD' AS $capture$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_ATTEMPT_FRESH_READ_REQUIRED';
  END IF;
  PERFORM 1 FROM crest_private.actors a WHERE a.id=NEW.actor_id FOR SHARE;
  IF NOT EXISTS (SELECT 1 FROM crest_private.actors a WHERE a.id=NEW.actor_id AND a.kind='owner' AND a.disabled_at IS NULL
    AND a.current_security_epoch=NEW.issued_security_epoch AND a.auth_provider_issuer=NEW.provider_issuer AND a.auth_user_id=NEW.provider_subject::text)
    OR EXISTS (SELECT 1 FROM crest_private.app_sessions s WHERE s.id=NEW.reserved_app_session_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LOGIN_ATTEMPT_SOURCE_REQUIRED';
  END IF;
  NEW.schema_version:=1; NEW.origin:='system'; NEW.created_at:=clock_timestamp(); NEW.database_principal:=session_user;
  NEW.canonical_evidence:=jsonb_build_object('schemaVersion',1,'origin','system','attemptId',NEW.attempt_id,
    'appSessionId',NEW.reserved_app_session_id,'actorId',NEW.actor_id,'securityEpoch',NEW.issued_security_epoch,
    'providerIssuer',NEW.provider_issuer,'providerSubject',NEW.provider_subject,'createdAt',NEW.created_at,'databasePrincipal',NEW.database_principal)::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.canonical_evidence,'UTF8')),'hex');
  RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.validate_provider_login_attempt() FROM PUBLIC;
CREATE TRIGGER provider_login_attempt_source BEFORE INSERT ON crest_private.provider_login_attempts
  FOR EACH ROW EXECUTE FUNCTION crest_private.validate_provider_login_attempt();
CREATE TRIGGER provider_login_attempt_retained BEFORE UPDATE OR DELETE ON crest_private.provider_login_attempts
  FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER provider_login_attempt_no_truncate BEFORE TRUNCATE ON crest_private.provider_login_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();

CREATE FUNCTION crest_commands.begin_provider_login(new_attempt uuid,new_app_session uuid,expected_issuer text,expected_subject uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $begin$
DECLARE context jsonb;
BEGIN
  IF new_attempt IS NULL OR new_app_session IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR expected_subject IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_ATTEMPT_INPUT_REQUIRED';
  END IF;
  context:=crest_commands.session_actor_context(expected_issuer,expected_subject);
  IF context IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_ATTEMPT_BINDING_REQUIRED'; END IF;
  -- A duplicate is not permission to repeat a password exchange. No replay or
  -- automatic retry; uncertain begin commit must stop before provider I/O.
  INSERT INTO crest_private.provider_login_attempts(attempt_id,reserved_app_session_id,actor_id,issued_security_epoch,provider_issuer,provider_subject)
    VALUES(new_attempt,new_app_session,(context->>'actorId')::uuid,(context->>'securityEpoch')::uuid,expected_issuer,expected_subject);
  RETURN context||jsonb_build_object('attemptId',new_attempt,'appSessionId',new_app_session);
END
$begin$;

CREATE FUNCTION crest_commands.issue_tracked_app_session(new_id uuid,credential_hash bytea,expected_actor uuid,expected_epoch uuid,
  expected_issuer text,expected_subject uuid,provider_session uuid,password_at timestamptz,totp_at timestamptz,
  is_trusted boolean,token_ciphertext bytea,token_key text,request_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $issue$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crest_private.provider_login_attempts a WHERE a.attempt_id=request_operation
    AND a.reserved_app_session_id=new_id AND a.actor_id=expected_actor AND a.issued_security_epoch=expected_epoch
    AND a.provider_issuer=expected_issuer AND a.provider_subject=expected_subject) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_ATTEMPT_BINDING_REQUIRED';
  END IF;
  PERFORM crest_commands.issue_app_session(new_id,credential_hash,expected_actor,expected_epoch,expected_issuer,expected_subject,
    provider_session,password_at,totp_at,is_trusted,token_ciphertext,token_key,request_operation);
END
$issue$;

CREATE FUNCTION crest_commands.provider_login_attempt_inventory(expected_actor uuid,expected_issuer text,after_attempt uuid,page_size integer)
RETURNS TABLE(attempt_id uuid,evidence jsonb,canonical_evidence text,evidence_hash text,registration_state text,provider_session_id uuid,local_revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $inventory$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_ATTEMPT_FRESH_READ_REQUIRED'; END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_ATTEMPT_INPUT_REQUIRED';
  END IF;
  RETURN QUERY SELECT a.attempt_id,a.canonical_evidence::jsonb,a.canonical_evidence,a.event_hash,
    CASE WHEN s.id IS NULL THEN 'registration_unconfirmed'
      WHEN s.actor_id=a.actor_id AND s.issued_security_epoch=a.issued_security_epoch AND EXISTS (SELECT 1 FROM crest_private.session_events e
        WHERE e.session_id=s.id AND e.actor_id=a.actor_id AND e.operation_id=a.attempt_id AND e.action='CREATED') THEN 'registration_recorded'
      ELSE 'binding_conflict_review' END,
    CASE WHEN s.actor_id=a.actor_id AND s.issued_security_epoch=a.issued_security_epoch AND EXISTS (SELECT 1 FROM crest_private.session_events e
      WHERE e.session_id=s.id AND e.actor_id=a.actor_id AND e.operation_id=a.attempt_id AND e.action='CREATED') THEN s.provider_session_id ELSE NULL END,
    CASE WHEN s.actor_id=a.actor_id AND s.issued_security_epoch=a.issued_security_epoch AND EXISTS (SELECT 1 FROM crest_private.session_events e
      WHERE e.session_id=s.id AND e.actor_id=a.actor_id AND e.operation_id=a.attempt_id AND e.action='CREATED') THEN s.revoked_at ELSE NULL END
    FROM crest_private.provider_login_attempts a LEFT JOIN crest_private.app_sessions s ON s.id=a.reserved_app_session_id
    WHERE a.actor_id=expected_actor AND a.provider_issuer=expected_issuer AND (after_attempt IS NULL OR a.attempt_id>after_attempt)
    ORDER BY a.attempt_id LIMIT page_size;
END
$inventory$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_inventory_owner;
ALTER FUNCTION crest_commands.begin_provider_login(uuid,uuid,text,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.begin_provider_login(uuid,uuid,text,uuid),crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.begin_provider_login(uuid,uuid,text,uuid),crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer) TO crest_inventory;
