-- SECURITY2: serialize app issuance with immutable local finish observations.
-- A local fence never certifies external I/O completion or browser delivery.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_session_owner','crest_inventory_owner','crest_command_owner')
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)<>3
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_session_owner','crest_inventory_owner','crest_command_owner'))
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
      'crest_commands.issue_targeted_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)'::regprocedure,
      'crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid)'::regprocedure)
      AND (proowner<>'crest_session_owner'::regrole OR NOT prosecdef OR provolatile<>'v'
        OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','row_security=on']))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='crest_commands.revoke_app_session(bytea,uuid)'::regprocedure
      AND proowner='crest_command_owner'::regrole AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_FINISH_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_login_finishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES crest_private.provider_login_attempts(attempt_id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('registration_closed','stopped_review')),
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  issued_security_epoch uuid NOT NULL,
  provider_issuer text NOT NULL CHECK (length(provider_issuer) BETWEEN 1 AND 500),
  provider_subject uuid NOT NULL,
  provider_session_id uuid,
  registration_event_id uuid REFERENCES crest_private.session_events(id) ON DELETE RESTRICT,
  local_revoked_at timestamptz CHECK (isfinite(local_revoked_at)),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  database_principal text NOT NULL,
  canonical_evidence text NOT NULL CHECK (octet_length(canonical_evidence)<=8192),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$' AND event_hash=encode(sha256(convert_to(canonical_evidence,'UTF8')),'hex')),
  UNIQUE(attempt_id,phase)
);
CREATE INDEX provider_login_finish_actor ON crest_private.provider_login_finishes(actor_id,id);
CREATE INDEX provider_login_finish_source ON crest_private.provider_login_finishes(registration_event_id);
ALTER TABLE crest_private.provider_login_finishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_login_finishes FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.provider_login_finishes TO crest_session_owner;
GRANT SELECT ON crest_private.provider_login_finishes TO crest_inventory_owner;
CREATE POLICY login_finish_session_read ON crest_private.provider_login_finishes FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY login_finish_session_append ON crest_private.provider_login_finishes FOR INSERT TO crest_session_owner WITH CHECK (true);
CREATE POLICY login_finish_inventory ON crest_private.provider_login_finishes FOR SELECT TO crest_inventory_owner USING (true);

CREATE FUNCTION crest_private.validate_provider_login_finish() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on SET TimeZone='UTC' SET DateStyle='ISO, YMD' AS $capture$
DECLARE attempt crest_private.provider_login_attempts%ROWTYPE; target_id uuid; source_id uuid; local_session record;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_FINISH_FRESH_READ_REQUIRED'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.login.lifecycle/1:'||NEW.attempt_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_LOGIN_FINISH_BUSY';
  END IF;
  SELECT * INTO attempt FROM crest_private.provider_login_attempts WHERE attempt_id=NEW.attempt_id;
  IF NOT FOUND OR NEW.actor_id IS DISTINCT FROM attempt.actor_id OR NEW.issued_security_epoch IS DISTINCT FROM attempt.issued_security_epoch
    OR NEW.provider_issuer IS DISTINCT FROM attempt.provider_issuer OR NEW.provider_subject IS DISTINCT FROM attempt.provider_subject THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LOGIN_FINISH_SOURCE_REQUIRED';
  END IF;
  SELECT t.provider_session_id INTO target_id FROM crest_private.provider_login_targets t WHERE t.attempt_id=NEW.attempt_id;
  SELECT s.id,s.actor_id,s.issued_security_epoch,s.provider_session_id,s.revoked_at INTO local_session FROM crest_private.app_sessions s WHERE s.id=attempt.reserved_app_session_id;
  SELECT CASE WHEN count(*)=1 THEN (array_agg(e.id))[1] ELSE NULL END INTO source_id FROM crest_private.session_events e WHERE e.session_id=local_session.id AND e.actor_id=attempt.actor_id AND e.operation_id=attempt.attempt_id AND e.action='CREATED';
  IF local_session.id IS NOT NULL AND (local_session.actor_id IS DISTINCT FROM attempt.actor_id OR local_session.issued_security_epoch IS DISTINCT FROM attempt.issued_security_epoch
    OR source_id IS NULL OR target_id IS NOT NULL AND target_id IS DISTINCT FROM local_session.provider_session_id)
    OR NEW.phase='registration_closed' AND (local_session.id IS NULL OR EXISTS (SELECT 1 FROM crest_private.provider_login_finishes f WHERE f.attempt_id=NEW.attempt_id AND f.phase='stopped_review'))
    OR NEW.phase='stopped_review' AND local_session.id IS NOT NULL AND local_session.revoked_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LOGIN_FINISH_SOURCE_REQUIRED';
  END IF;
  NEW.provider_session_id:=coalesce(local_session.provider_session_id,target_id); NEW.registration_event_id:=source_id; NEW.local_revoked_at:=local_session.revoked_at;
  NEW.schema_version:=1; NEW.origin:='system'; NEW.created_at:=clock_timestamp(); NEW.database_principal:=session_user;
  NEW.canonical_evidence:=jsonb_build_object('schemaVersion',1,'origin','system','finishId',NEW.id,'attemptId',NEW.attempt_id,'phase',NEW.phase,
    'appSessionId',attempt.reserved_app_session_id,'actorId',NEW.actor_id,'securityEpoch',NEW.issued_security_epoch,'providerIssuer',NEW.provider_issuer,
    'providerSubject',NEW.provider_subject,'providerSessionId',NEW.provider_session_id,'registrationEventId',NEW.registration_event_id,
    'localRevokedAt',NEW.local_revoked_at,'createdAt',NEW.created_at,'databasePrincipal',NEW.database_principal)::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.canonical_evidence,'UTF8')),'hex'); RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.validate_provider_login_finish() FROM PUBLIC;
CREATE TRIGGER provider_login_finish_source BEFORE INSERT ON crest_private.provider_login_finishes FOR EACH ROW EXECUTE FUNCTION crest_private.validate_provider_login_finish();
CREATE TRIGGER provider_login_finish_retained BEFORE UPDATE OR DELETE ON crest_private.provider_login_finishes FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER provider_login_finish_no_truncate BEFORE TRUNCATE ON crest_private.provider_login_finishes FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();

CREATE FUNCTION crest_commands.finish_provider_login(request_attempt uuid,expected_actor uuid,expected_epoch uuid,expected_issuer text,expected_subject uuid,finish_phase text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE attempt crest_private.provider_login_attempts%ROWTYPE; saved crest_private.provider_login_finishes%ROWTYPE; local_session record; source_id uuid; target_id uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_FINISH_FRESH_READ_REQUIRED'; END IF;
  IF request_attempt IS NULL OR expected_actor IS NULL OR expected_epoch IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500
    OR expected_subject IS NULL OR finish_phase IS NULL OR finish_phase NOT IN ('registration_closed','stopped_review') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_FINISH_INPUT_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.login.lifecycle/1:'||request_attempt::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_LOGIN_FINISH_BUSY';
  END IF;
  SELECT * INTO attempt FROM crest_private.provider_login_attempts WHERE attempt_id=request_attempt;
  IF NOT FOUND OR attempt.actor_id IS DISTINCT FROM expected_actor OR attempt.issued_security_epoch IS DISTINCT FROM expected_epoch
    OR attempt.provider_issuer IS DISTINCT FROM expected_issuer OR attempt.provider_subject IS DISTINCT FROM expected_subject THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_FINISH_BINDING_REQUIRED';
  END IF;
  SELECT * INTO saved FROM crest_private.provider_login_finishes WHERE attempt_id=request_attempt AND phase=finish_phase;
  IF NOT FOUND THEN
    IF finish_phase='stopped_review' THEN
      SELECT s.id,s.actor_id,s.issued_security_epoch,s.provider_session_id,s.token_hash INTO local_session FROM crest_private.app_sessions s WHERE s.id=attempt.reserved_app_session_id FOR UPDATE;
      IF local_session.id IS NOT NULL THEN
        SELECT CASE WHEN count(*)=1 THEN (array_agg(e.id))[1] ELSE NULL END INTO source_id FROM crest_private.session_events e WHERE e.session_id=local_session.id AND e.actor_id=expected_actor AND e.operation_id=request_attempt AND e.action='CREATED';
        SELECT t.provider_session_id INTO target_id FROM crest_private.provider_login_targets t WHERE t.attempt_id=request_attempt;
        IF local_session.actor_id IS DISTINCT FROM expected_actor OR local_session.issued_security_epoch IS DISTINCT FROM expected_epoch
          OR source_id IS NULL OR target_id IS NOT NULL AND target_id IS DISTINCT FROM local_session.provider_session_id THEN
          RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_FINISH_BINDING_REQUIRED';
        END IF;
        PERFORM crest_commands.revoke_app_session(local_session.token_hash,gen_random_uuid());
      END IF;
    END IF;
    INSERT INTO crest_private.provider_login_finishes(attempt_id,phase,actor_id,issued_security_epoch,provider_issuer,provider_subject)
      VALUES(request_attempt,finish_phase,expected_actor,expected_epoch,expected_issuer,expected_subject) RETURNING * INTO saved;
  END IF;
  RETURN jsonb_build_object('evidence',saved.canonical_evidence::jsonb,'evidenceHash',saved.event_hash,'canonicalEvidence',saved.canonical_evidence);
END
$finish$;

CREATE FUNCTION crest_commands.issue_open_app_session(new_id uuid,credential_hash bytea,expected_actor uuid,expected_epoch uuid,
  expected_issuer text,expected_subject uuid,provider_session uuid,password_at timestamptz,totp_at timestamptz,
  is_trusted boolean,token_ciphertext bytea,token_key text,request_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $issue$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_FINISH_FRESH_READ_REQUIRED'; END IF;
  IF request_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_FINISH_INPUT_REQUIRED'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.login.lifecycle/1:'||request_operation::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_LOGIN_FINISH_BUSY';
  END IF;
  IF EXISTS (SELECT 1 FROM crest_private.provider_login_finishes WHERE attempt_id=request_operation) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_FINISHED';
  END IF;
  PERFORM crest_commands.issue_targeted_app_session(new_id,credential_hash,expected_actor,expected_epoch,expected_issuer,expected_subject,
    provider_session,password_at,totp_at,is_trusted,token_ciphertext,token_key,request_operation);
END
$issue$;

CREATE FUNCTION crest_commands.provider_login_finish_inventory(expected_actor uuid,expected_issuer text,after_finish uuid,page_size integer)
RETURNS TABLE(finish_id uuid,evidence jsonb,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $inventory$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_FINISH_FRESH_READ_REQUIRED'; END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_FINISH_INPUT_REQUIRED';
  END IF;
  RETURN QUERY SELECT f.id,f.canonical_evidence::jsonb,f.canonical_evidence,f.event_hash FROM crest_private.provider_login_finishes f
    WHERE f.actor_id=expected_actor AND f.provider_issuer=expected_issuer AND (after_finish IS NULL OR f.id>after_finish) ORDER BY f.id LIMIT page_size;
END
$inventory$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_inventory_owner;
ALTER FUNCTION crest_commands.finish_provider_login(uuid,uuid,uuid,text,uuid,text) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.issue_open_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.provider_login_finish_inventory(uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.finish_provider_login(uuid,uuid,uuid,text,uuid,text),crest_commands.issue_open_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.provider_login_finish_inventory(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.finish_provider_login(uuid,uuid,uuid,text,uuid,text),crest_commands.issue_open_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.provider_login_finish_inventory(uuid,text,uuid,integer) TO crest_inventory;
-- Retire direct issuance from ordinary runtime. Old functions remain callable
-- by their fixed owner/delegation chain, not by an older web producer.
REVOKE EXECUTE ON FUNCTION crest_commands.issue_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.issue_tracked_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid),crest_commands.issue_targeted_app_session(uuid,bytea,uuid,uuid,text,uuid,uuid,timestamptz,timestamptz,boolean,bytea,text,uuid) FROM crest_web;
