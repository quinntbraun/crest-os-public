-- SECURITY2: retain the signed password-session reference before further login I/O.
-- Historical evidence only; no provider mutation, cleanup grant or closing outcome.
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
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.users'::regclass,'auth.refresh_tokens'::regclass)
      AND has_any_column_privilege('crest_inventory_owner',c.oid,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='crest_private.session_events'::regclass AND attnum>0 AND NOT attisdropped
      AND attname NOT IN ('id','session_id','actor_id','operation_id','action') AND has_column_privilege('crest_inventory_owner',attrelid,attnum,'SELECT'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid IN ('crest_commands.session_actor_context(text,uuid)'::regprocedure,
      'crest_commands.issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)'::regprocedure,
      'crest_commands.begin_provider_login(uuid,uuid,text,uuid)'::regprocedure,
      'crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)'::regprocedure)
      AND (proowner<>'crest_session_owner'::regrole OR NOT prosecdef OR provolatile<>'v'
        OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_TARGET_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_login_targets (
  attempt_id uuid PRIMARY KEY REFERENCES crest_private.provider_login_attempts(attempt_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  issued_security_epoch uuid NOT NULL,
  provider_issuer text NOT NULL CHECK (length(provider_issuer) BETWEEN 1 AND 500),
  provider_subject uuid NOT NULL,
  provider_session_id uuid NOT NULL,
  password_at timestamptz NOT NULL CHECK (isfinite(password_at)),
  access_expires_at timestamptz NOT NULL CHECK (isfinite(access_expires_at) AND access_expires_at>password_at),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  database_principal text NOT NULL,
  canonical_evidence text NOT NULL CHECK (octet_length(canonical_evidence)<=8192),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$' AND event_hash=encode(sha256(convert_to(canonical_evidence,'UTF8')),'hex')),
  UNIQUE(provider_issuer,provider_session_id)
);
CREATE INDEX provider_login_target_actor ON crest_private.provider_login_targets(actor_id,attempt_id);
ALTER TABLE crest_private.provider_login_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_login_targets FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.provider_login_targets TO crest_session_owner;
GRANT SELECT ON crest_private.provider_login_targets TO crest_inventory_owner;
CREATE POLICY login_target_session_read ON crest_private.provider_login_targets FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY login_target_session_append ON crest_private.provider_login_targets FOR INSERT TO crest_session_owner WITH CHECK (true);
CREATE POLICY login_target_inventory ON crest_private.provider_login_targets FOR SELECT TO crest_inventory_owner USING (true);

CREATE FUNCTION crest_private.validate_provider_login_target() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on SET TimeZone='UTC' SET DateStyle='ISO, YMD' AS $capture$
DECLARE attempt crest_private.provider_login_attempts%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_TARGET_FRESH_READ_REQUIRED'; END IF;
  SELECT * INTO attempt FROM crest_private.provider_login_attempts WHERE attempt_id=NEW.attempt_id;
  IF NOT FOUND OR NEW.actor_id IS DISTINCT FROM attempt.actor_id OR NEW.issued_security_epoch IS DISTINCT FROM attempt.issued_security_epoch
    OR NEW.provider_issuer IS DISTINCT FROM attempt.provider_issuer OR NEW.provider_subject IS DISTINCT FROM attempt.provider_subject
    OR NEW.password_at IS NULL OR NOT isfinite(NEW.password_at) OR NEW.password_at<date_trunc('second',attempt.created_at) OR NEW.password_at>clock_timestamp()
    OR NEW.access_expires_at IS NULL OR NOT isfinite(NEW.access_expires_at) OR NEW.access_expires_at<=NEW.password_at
    OR EXISTS (SELECT 1 FROM crest_private.app_sessions s WHERE s.id=attempt.reserved_app_session_id OR s.provider_session_id=NEW.provider_session_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LOGIN_TARGET_SOURCE_REQUIRED';
  END IF;
  -- Retain a late signed observation even after recovery/disable/provider loss.
  -- It neither authorizes continued login nor asserts a currently live device.
  NEW.schema_version:=1; NEW.origin:='system'; NEW.created_at:=clock_timestamp(); NEW.database_principal:=session_user;
  NEW.canonical_evidence:=jsonb_build_object('schemaVersion',1,'origin','system','attemptId',NEW.attempt_id,
    'appSessionId',attempt.reserved_app_session_id,'actorId',NEW.actor_id,'securityEpoch',NEW.issued_security_epoch,
    'providerIssuer',NEW.provider_issuer,'providerSubject',NEW.provider_subject,'providerSessionId',NEW.provider_session_id,
    'passwordAt',NEW.password_at,'accessExpiresAt',NEW.access_expires_at,'createdAt',NEW.created_at,'databasePrincipal',NEW.database_principal)::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.canonical_evidence,'UTF8')),'hex');
  RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.validate_provider_login_target() FROM PUBLIC;
CREATE TRIGGER provider_login_target_source BEFORE INSERT ON crest_private.provider_login_targets FOR EACH ROW EXECUTE FUNCTION crest_private.validate_provider_login_target();
CREATE TRIGGER provider_login_target_retained BEFORE UPDATE OR DELETE ON crest_private.provider_login_targets FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER provider_login_target_no_truncate BEFORE TRUNCATE ON crest_private.provider_login_targets FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();

CREATE FUNCTION crest_commands.record_provider_login_target(request_attempt uuid,expected_actor uuid,expected_epoch uuid,expected_issuer text,
  expected_subject uuid,provider_session uuid,password_at timestamptz,access_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
DECLARE saved crest_private.provider_login_targets%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_TARGET_FRESH_READ_REQUIRED'; END IF;
  IF request_attempt IS NULL OR expected_actor IS NULL OR expected_epoch IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500
    OR expected_subject IS NULL OR provider_session IS NULL OR password_at IS NULL OR NOT isfinite(password_at)
    OR access_expires_at IS NULL OR NOT isfinite(access_expires_at) OR access_expires_at<=password_at THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_TARGET_INPUT_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.login.target/1:'||request_attempt::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_LOGIN_TARGET_BUSY';
  END IF;
  SELECT * INTO saved FROM crest_private.provider_login_targets WHERE attempt_id=request_attempt;
  IF FOUND THEN
    IF saved.actor_id IS DISTINCT FROM expected_actor OR saved.issued_security_epoch IS DISTINCT FROM expected_epoch
      OR saved.provider_issuer IS DISTINCT FROM expected_issuer OR saved.provider_subject IS DISTINCT FROM expected_subject
      OR saved.provider_session_id IS DISTINCT FROM provider_session OR saved.password_at IS DISTINCT FROM password_at
      OR saved.access_expires_at IS DISTINCT FROM access_expires_at THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='CREST_LOGIN_TARGET_CONFLICT';
    END IF;
  ELSE
    INSERT INTO crest_private.provider_login_targets(attempt_id,actor_id,issued_security_epoch,provider_issuer,provider_subject,provider_session_id,password_at,access_expires_at)
      VALUES(request_attempt,expected_actor,expected_epoch,expected_issuer,expected_subject,provider_session,password_at,access_expires_at) RETURNING * INTO saved;
  END IF;
  RETURN jsonb_build_object('evidence',saved.canonical_evidence::jsonb,'evidenceHash',saved.event_hash,'canonicalEvidence',saved.canonical_evidence);
END
$record$;

CREATE FUNCTION crest_commands.issue_targeted_app_session(new_id uuid,credential_hash bytea,expected_actor uuid,expected_epoch uuid,
  expected_issuer text,expected_subject uuid,provider_session uuid,password_at timestamptz,totp_at timestamptz,
  is_trusted boolean,token_ciphertext bytea,token_key text,request_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $issue$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM crest_private.provider_login_targets t WHERE t.attempt_id=request_operation AND t.actor_id=expected_actor
    AND t.issued_security_epoch=expected_epoch AND t.provider_issuer=expected_issuer AND t.provider_subject=expected_subject
    AND t.provider_session_id=provider_session AND t.password_at=issue_targeted_app_session.password_at) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_TARGET_BINDING_REQUIRED';
  END IF;
  PERFORM crest_commands.issue_tracked_app_session(new_id,credential_hash,expected_actor,expected_epoch,expected_issuer,expected_subject,
    provider_session,password_at,totp_at,is_trusted,token_ciphertext,token_key,request_operation);
END
$issue$;

CREATE FUNCTION crest_commands.provider_login_target_inventory(expected_actor uuid,expected_issuer text,after_attempt uuid,page_size integer)
RETURNS TABLE(attempt_id uuid,evidence jsonb,canonical_evidence text,evidence_hash text,registration_state text,provider_session_id uuid,local_revoked_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $inventory$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_TARGET_FRESH_READ_REQUIRED'; END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_TARGET_INPUT_REQUIRED';
  END IF;
  RETURN QUERY SELECT t.attempt_id,t.canonical_evidence::jsonb,t.canonical_evidence,t.event_hash,
    CASE WHEN s.id IS NULL THEN 'registration_unconfirmed'
      WHEN s.actor_id=t.actor_id AND s.issued_security_epoch=t.issued_security_epoch AND s.provider_session_id=t.provider_session_id
        AND EXISTS (SELECT 1 FROM crest_private.session_events e WHERE e.session_id=s.id AND e.actor_id=t.actor_id AND e.operation_id=t.attempt_id AND e.action='CREATED')
        THEN 'registration_recorded' ELSE 'binding_conflict_review' END,t.provider_session_id,
    CASE WHEN s.actor_id=t.actor_id AND s.issued_security_epoch=t.issued_security_epoch AND s.provider_session_id=t.provider_session_id
      AND EXISTS (SELECT 1 FROM crest_private.session_events e WHERE e.session_id=s.id AND e.actor_id=t.actor_id AND e.operation_id=t.attempt_id AND e.action='CREATED') THEN s.revoked_at ELSE NULL END
    FROM crest_private.provider_login_targets t JOIN crest_private.provider_login_attempts a ON a.attempt_id=t.attempt_id
    LEFT JOIN crest_private.app_sessions s ON s.id=a.reserved_app_session_id
    WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_attempt IS NULL OR t.attempt_id>after_attempt)
    ORDER BY t.attempt_id LIMIT page_size;
END
$inventory$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_inventory_owner;
ALTER FUNCTION crest_commands.record_provider_login_target(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.issue_targeted_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.provider_login_target_inventory(uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.record_provider_login_target(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz),crest_commands.issue_targeted_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.provider_login_target_inventory(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_provider_login_target(uuid,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz),crest_commands.issue_targeted_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.provider_login_target_inventory(uuid,text,uuid,integer) TO crest_inventory;
