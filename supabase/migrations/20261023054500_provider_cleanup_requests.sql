-- SECURITY2: immutable exact-source selection requests; no provider execution.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_session_owner','crest_inventory_owner','crest_command_owner','crest_inventory')
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)<>4
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_session_owner','crest_inventory_owner','crest_command_owner','crest_inventory'))
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
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_REQUEST_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_cleanup_requests (
  request_id uuid PRIMARY KEY,
  source_finish_id uuid NOT NULL UNIQUE REFERENCES crest_private.provider_login_finishes(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL REFERENCES crest_private.provider_login_targets(attempt_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  issued_security_epoch uuid NOT NULL,
  provider_issuer text NOT NULL CHECK (length(provider_issuer) BETWEEN 1 AND 500),
  provider_subject uuid NOT NULL,
  provider_session_id uuid NOT NULL,
  app_session_id uuid NOT NULL,
  registration_event_id uuid REFERENCES crest_private.session_events(id) ON DELETE RESTRICT,
  cleanup_reference_id uuid REFERENCES crest_private.provider_cleanup_references(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending_review' CHECK (state='pending_review'),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  database_principal text NOT NULL,
  canonical_evidence text NOT NULL CHECK (octet_length(canonical_evidence)<=8192),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$' AND event_hash=encode(sha256(convert_to(canonical_evidence,'UTF8')),'hex')),
  UNIQUE(provider_issuer,provider_session_id)
);
CREATE INDEX provider_cleanup_request_actor ON crest_private.provider_cleanup_requests(actor_id,request_id);
CREATE INDEX provider_cleanup_request_registration ON crest_private.provider_cleanup_requests(registration_event_id);
CREATE INDEX provider_cleanup_request_reference ON crest_private.provider_cleanup_requests(cleanup_reference_id);
ALTER TABLE crest_private.provider_cleanup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_cleanup_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.provider_cleanup_requests TO crest_inventory_owner;
CREATE POLICY cleanup_request_read ON crest_private.provider_cleanup_requests FOR SELECT TO crest_inventory_owner USING (true);
CREATE POLICY cleanup_request_append ON crest_private.provider_cleanup_requests FOR INSERT TO crest_inventory_owner WITH CHECK (true);

CREATE FUNCTION crest_private.validate_provider_cleanup_request() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on SET TimeZone='UTC' SET DateStyle='ISO, YMD' AS $capture$
DECLARE stopped crest_private.provider_login_finishes%ROWTYPE; attempt crest_private.provider_login_attempts%ROWTYPE;
  target crest_private.provider_login_targets%ROWTYPE; local_session record; source_id uuid; reference_id uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CLEANUP_REQUEST_FRESH_READ_REQUIRED'; END IF;
  SELECT * INTO stopped FROM crest_private.provider_login_finishes WHERE id=NEW.source_finish_id AND phase='stopped_review';
  IF NOT FOUND OR stopped.actor_id IS DISTINCT FROM NEW.actor_id OR stopped.provider_issuer IS DISTINCT FROM NEW.provider_issuer THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_REQUEST_SOURCE_REQUIRED';
  END IF;
  -- Share the local producer fence, including privileged direct INSERT. No
  -- timeout is promoted into a stopped outcome, and no provider row is locked.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.login.lifecycle/1:'||stopped.attempt_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_CLEANUP_REQUEST_BUSY';
  END IF;
  SELECT * INTO attempt FROM crest_private.provider_login_attempts WHERE attempt_id=stopped.attempt_id;
  SELECT * INTO target FROM crest_private.provider_login_targets WHERE attempt_id=stopped.attempt_id;
  IF target.attempt_id IS NULL OR (attempt.actor_id,attempt.issued_security_epoch,attempt.provider_issuer,attempt.provider_subject)
    IS DISTINCT FROM (stopped.actor_id,stopped.issued_security_epoch,stopped.provider_issuer,stopped.provider_subject)
    OR (target.actor_id,target.issued_security_epoch,target.provider_issuer,target.provider_subject)
    IS DISTINCT FROM (stopped.actor_id,stopped.issued_security_epoch,stopped.provider_issuer,stopped.provider_subject)
    OR stopped.provider_session_id IS NOT NULL AND stopped.provider_session_id IS DISTINCT FROM target.provider_session_id
    OR NOT EXISTS (SELECT 1 FROM crest_private.actors a WHERE a.id=stopped.actor_id AND a.kind='owner'
      AND a.auth_provider_issuer=stopped.provider_issuer AND a.auth_user_id=stopped.provider_subject::text) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_REQUEST_SOURCE_REQUIRED';
  END IF;
  SELECT s.id,s.actor_id,s.issued_security_epoch,s.provider_session_id,s.revoked_at INTO local_session FROM crest_private.app_sessions s
    WHERE s.id=attempt.reserved_app_session_id;
  SELECT CASE WHEN count(*)=1 THEN (array_agg(e.id))[1] ELSE NULL END INTO source_id FROM crest_private.session_events e
    WHERE e.session_id=local_session.id AND e.actor_id=stopped.actor_id AND e.operation_id=attempt.attempt_id AND e.action='CREATED';
  SELECT r.id INTO reference_id FROM crest_private.provider_cleanup_references r WHERE r.app_session_id=local_session.id
    AND r.actor_id=stopped.actor_id AND r.provider_session_id=target.provider_session_id;
  IF EXISTS (SELECT 1 FROM crest_private.app_sessions s WHERE s.provider_session_id=target.provider_session_id AND s.id<>attempt.reserved_app_session_id)
    OR local_session.id IS NOT NULL AND (local_session.actor_id IS DISTINCT FROM stopped.actor_id
      OR local_session.issued_security_epoch IS DISTINCT FROM stopped.issued_security_epoch
      OR local_session.provider_session_id IS DISTINCT FROM target.provider_session_id OR local_session.revoked_at IS NULL
      OR source_id IS NULL OR reference_id IS NULL)
    OR stopped.registration_event_id IS NOT NULL AND stopped.registration_event_id IS DISTINCT FROM source_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_REQUEST_SOURCE_REQUIRED';
  END IF;
  NEW.attempt_id:=attempt.attempt_id; NEW.issued_security_epoch:=stopped.issued_security_epoch;
  NEW.provider_subject:=stopped.provider_subject; NEW.provider_session_id:=target.provider_session_id;
  NEW.app_session_id:=attempt.reserved_app_session_id; NEW.registration_event_id:=source_id; NEW.cleanup_reference_id:=reference_id;
  NEW.state:='pending_review'; NEW.schema_version:=1; NEW.origin:='system'; NEW.created_at:=clock_timestamp(); NEW.database_principal:=session_user;
  NEW.canonical_evidence:=jsonb_build_object('schemaVersion',1,'origin','system','state',NEW.state,'requestId',NEW.request_id,
    'sourceFinishId',stopped.id,'sourceFinishHash',stopped.event_hash,'attemptId',attempt.attempt_id,'targetHash',target.event_hash,
    'actorId',NEW.actor_id,'securityEpoch',NEW.issued_security_epoch,'providerIssuer',NEW.provider_issuer,'providerSubject',NEW.provider_subject,
    'providerSessionId',NEW.provider_session_id,'appSessionId',NEW.app_session_id,'registrationEventId',NEW.registration_event_id,
    'cleanupReferenceId',NEW.cleanup_reference_id,'localRevokedAt',local_session.revoked_at,'createdAt',NEW.created_at,'databasePrincipal',NEW.database_principal)::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.canonical_evidence,'UTF8')),'hex'); RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.validate_provider_cleanup_request() FROM PUBLIC;
CREATE TRIGGER provider_cleanup_request_source BEFORE INSERT ON crest_private.provider_cleanup_requests FOR EACH ROW EXECUTE FUNCTION crest_private.validate_provider_cleanup_request();
CREATE TRIGGER provider_cleanup_request_retained BEFORE UPDATE OR DELETE ON crest_private.provider_cleanup_requests FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER provider_cleanup_request_no_truncate BEFORE TRUNCATE ON crest_private.provider_cleanup_requests FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();

CREATE FUNCTION crest_commands.request_provider_cleanup(requested_id uuid,source_finish uuid,expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $request$
DECLARE saved crest_private.provider_cleanup_requests%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CLEANUP_REQUEST_FRESH_READ_REQUIRED'; END IF;
  IF requested_id IS NULL OR source_finish IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CLEANUP_REQUEST_INPUT_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.cleanup.request/1:'||requested_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_CLEANUP_REQUEST_BUSY';
  END IF;
  SELECT * INTO saved FROM crest_private.provider_cleanup_requests WHERE request_id=requested_id;
  IF FOUND THEN
    IF (saved.source_finish_id,saved.actor_id,saved.provider_issuer) IS DISTINCT FROM (source_finish,expected_actor,expected_issuer) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='CREST_CLEANUP_REQUEST_CONFLICT';
    END IF;
  ELSE
    INSERT INTO crest_private.provider_cleanup_requests(request_id,source_finish_id,actor_id,provider_issuer)
      VALUES(requested_id,source_finish,expected_actor,expected_issuer) RETURNING * INTO saved;
  END IF;
  RETURN jsonb_build_object('evidence',saved.canonical_evidence::jsonb,'evidenceHash',saved.event_hash,'canonicalEvidence',saved.canonical_evidence);
END
$request$;

CREATE FUNCTION crest_commands.read_provider_cleanup_request(requested_id uuid,expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE result jsonb;
BEGIN
  IF requested_id IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CLEANUP_REQUEST_INPUT_REQUIRED';
  END IF;
  SELECT jsonb_build_object('evidence',r.canonical_evidence::jsonb,'evidenceHash',r.event_hash,'canonicalEvidence',r.canonical_evidence) INTO result
    FROM crest_private.provider_cleanup_requests r WHERE r.request_id=requested_id AND r.actor_id=expected_actor AND r.provider_issuer=expected_issuer;
  RETURN result;
END
$read$;

CREATE FUNCTION crest_commands.provider_cleanup_request_inventory(expected_actor uuid,expected_issuer text,after_request uuid,page_size integer)
RETURNS TABLE(request_id uuid,evidence jsonb,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $inventory$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CLEANUP_REQUEST_FRESH_READ_REQUIRED'; END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CLEANUP_REQUEST_INPUT_REQUIRED';
  END IF;
  RETURN QUERY SELECT r.request_id,r.canonical_evidence::jsonb,r.canonical_evidence,r.event_hash FROM crest_private.provider_cleanup_requests r
    WHERE r.actor_id=expected_actor AND r.provider_issuer=expected_issuer AND (after_request IS NULL OR r.request_id>after_request) ORDER BY r.request_id LIMIT page_size;
END
$inventory$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.request_provider_cleanup(uuid,uuid,uuid,text) OWNER TO crest_inventory_owner;
ALTER FUNCTION crest_commands.read_provider_cleanup_request(uuid,uuid,text) OWNER TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_cleanup_request_inventory(uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.request_provider_cleanup(uuid,uuid,uuid,text),crest_commands.read_provider_cleanup_request(uuid,uuid,text),crest_commands.provider_cleanup_request_inventory(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_provider_cleanup(uuid,uuid,uuid,text),crest_commands.read_provider_cleanup_request(uuid,uuid,text),crest_commands.provider_cleanup_request_inventory(uuid,text,uuid,integer) TO crest_inventory;
-- Requests preserve reviewed selection inputs. They are not an executable
-- provider capability, completed cleanup, lease or permission to bypass revalidation.
