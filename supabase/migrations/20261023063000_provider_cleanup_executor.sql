-- ADR36 / SECURITY2: one exact-source reduction plus immutable result, one DB transaction.
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
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_EXECUTOR_REVIEW_REQUIRED';
  END IF;
END
$review$;
DO $roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['crest_cleanup_owner','crest_cleanup'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname=role_name)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
        LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname=role_name AND a.grantee<>d.defaclrole)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.relowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=r.oid))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute c JOIN pg_catalog.pg_roles r ON r.rolname=role_name,
        LATERAL pg_catalog.aclexplode(c.attacl) a WHERE a.grantee=r.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.nspowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.nspacl) a WHERE a.grantee=r.oid))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.proowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.proacl) a WHERE a.grantee=r.oid))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_type c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.typowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.typacl) a WHERE a.grantee=r.oid)) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_ROLE_REVIEW_REQUIRED';
    END IF;
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON ROUTINES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TYPES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SCHEMAS FROM PUBLIC',role_name);
  END LOOP;
END
$roles$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.assert_cleanup_provider_schema() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $provider$
DECLARE sessions_oid oid:=to_regclass('auth.sessions'); children oid[]:=ARRAY[to_regclass('auth.refresh_tokens')::oid,to_regclass('auth.mfa_amr_claims')::oid]; id_att smallint;
BEGIN
  SELECT attnum INTO id_att FROM pg_attribute WHERE attrelid=sessions_oid AND attname='id' AND NOT attisdropped AND atttypid='uuid'::regtype AND attnotnull;
  IF sessions_oid IS NULL OR id_att IS NULL OR array_position(children,NULL) IS NOT NULL
    OR (SELECT max(version::text) FROM auth.schema_migrations) IS DISTINCT FROM '20260831180000'
    OR (SELECT count(*) FROM pg_class WHERE oid=ANY(children||sessions_oid) AND relkind='r' AND relowner='supabase_auth_admin'::regrole AND relrowsecurity AND NOT relispartition)<>3
    OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=sessions_oid AND attname='user_id' AND NOT attisdropped AND atttypid='uuid'::regtype AND attnotnull)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=sessions_oid AND contype='p' AND conkey=ARRAY[id_att] AND convalidated)
    OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid=ANY(children||sessions_oid) OR inhparent=ANY(children||sessions_oid))
    OR EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class=ANY(children||sessions_oid))
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=ANY(children||sessions_oid) AND NOT tgisinternal)
    OR (SELECT count(*) FROM pg_constraint WHERE contype='f' AND confrelid=sessions_oid)<>2
    OR (SELECT count(*) FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='session_id' AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
      WHERE c.contype='f' AND c.confrelid=sessions_oid AND c.conrelid=ANY(children) AND c.conkey=ARRAY[a.attnum] AND c.confkey=ARRAY[id_att]
        AND c.confdeltype='c' AND c.confupdtype='a' AND c.confmatchtype='s' AND c.convalidated AND NOT c.condeferrable)<>2
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid=ANY(children)) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_CLEANUP_PROVIDER_REVIEW_REQUIRED';
  END IF;
END
$provider$;
REVOKE ALL ON FUNCTION crest_private.assert_cleanup_provider_schema() FROM PUBLIC;
RESET ROLE;
-- Review pinned upstream ownership/cascades before granting the isolated owner.
SELECT crest_private.assert_cleanup_provider_schema();
GRANT USAGE ON SCHEMA auth,crest_private,crest_commands TO crest_cleanup_owner;
GRANT SELECT(id,user_id),DELETE ON auth.sessions TO crest_cleanup_owner;
GRANT SELECT(version) ON auth.schema_migrations TO crest_cleanup_owner;
-- PostgreSQL17 MAINTAIN permits DDL-fencing table locks without secret SELECT or child DML.
GRANT MAINTAIN ON auth.refresh_tokens,auth.mfa_amr_claims TO crest_cleanup_owner;
CREATE POLICY cleanup_provider_read ON auth.sessions FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_provider_remove ON auth.sessions FOR DELETE TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_provider_version ON auth.schema_migrations FOR SELECT TO crest_cleanup_owner USING (true);
GRANT SELECT(id,kind,auth_provider_issuer,auth_user_id,current_security_epoch,disabled_at) ON crest_private.actors TO crest_cleanup_owner;
GRANT SELECT(id,actor_id,provider_session_id,issued_security_epoch,expires_at,revoked_at) ON crest_private.app_sessions TO crest_cleanup_owner;
GRANT SELECT(id,session_id,actor_id,operation_id,action) ON crest_private.session_events TO crest_cleanup_owner;
GRANT SELECT(id,app_session_id,actor_id,provider_session_id) ON crest_private.provider_cleanup_references TO crest_cleanup_owner;
CREATE POLICY cleanup_actor_read ON crest_private.actors FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_app_read ON crest_private.app_sessions FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_event_read ON crest_private.session_events FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_reference_read ON crest_private.provider_cleanup_references FOR SELECT TO crest_cleanup_owner USING (true);
GRANT SELECT ON crest_private.provider_login_attempts,crest_private.provider_login_targets,crest_private.provider_login_finishes,crest_private.provider_cleanup_requests TO crest_cleanup_owner;
CREATE POLICY cleanup_attempt_read ON crest_private.provider_login_attempts FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_target_read ON crest_private.provider_login_targets FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_finish_read ON crest_private.provider_login_finishes FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_request_source ON crest_private.provider_cleanup_requests FOR SELECT TO crest_cleanup_owner USING (true);

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_cleanup_outcomes (
  request_id uuid PRIMARY KEY REFERENCES crest_private.provider_cleanup_requests(request_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  provider_issuer text NOT NULL CHECK (length(provider_issuer) BETWEEN 1 AND 500),
  provider_subject uuid NOT NULL,
  provider_session_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('provider_removed','provider_absent_observed')),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at)),
  database_principal text NOT NULL,
  canonical_evidence text NOT NULL CHECK (octet_length(canonical_evidence)<=8192),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$' AND event_hash=encode(sha256(convert_to(canonical_evidence,'UTF8')),'hex'))
);
CREATE INDEX provider_cleanup_outcome_actor ON crest_private.provider_cleanup_outcomes(actor_id,request_id);
ALTER TABLE crest_private.provider_cleanup_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_cleanup_outcomes FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.provider_cleanup_outcomes TO crest_cleanup_owner;
GRANT SELECT ON crest_private.provider_cleanup_outcomes TO crest_inventory_owner;
CREATE POLICY cleanup_outcome_read ON crest_private.provider_cleanup_outcomes FOR SELECT TO crest_cleanup_owner USING (true);
CREATE POLICY cleanup_outcome_append ON crest_private.provider_cleanup_outcomes FOR INSERT TO crest_cleanup_owner WITH CHECK (true);
CREATE POLICY cleanup_outcome_inventory ON crest_private.provider_cleanup_outcomes FOR SELECT TO crest_inventory_owner USING (true);

CREATE FUNCTION crest_private.capture_provider_cleanup_outcome() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on SET TimeZone='UTC' SET DateStyle='ISO, YMD' SET lock_timeout='2s' AS $capture$
DECLARE req crest_private.provider_cleanup_requests%ROWTYPE; stopped crest_private.provider_login_finishes%ROWTYPE;
  attempt crest_private.provider_login_attempts%ROWTYPE; target crest_private.provider_login_targets%ROWTYPE;
  local_session record; source_id uuid; reference_id uuid; removed_id uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CLEANUP_EXECUTION_FRESH_READ_REQUIRED'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.cleanup.execute/1:'||NEW.request_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_CLEANUP_EXECUTION_BUSY';
  END IF;
  SELECT * INTO req FROM crest_private.provider_cleanup_requests WHERE request_id=NEW.request_id;
  IF NOT FOUND OR NEW.actor_id IS DISTINCT FROM req.actor_id OR NEW.provider_issuer IS DISTINCT FROM req.provider_issuer THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_EXECUTION_BINDING_REQUIRED';
  END IF;
  SELECT * INTO stopped FROM crest_private.provider_login_finishes WHERE id=req.source_finish_id AND phase='stopped_review';
  IF NOT FOUND OR stopped.actor_id IS DISTINCT FROM req.actor_id OR stopped.provider_issuer IS DISTINCT FROM req.provider_issuer THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_EXECUTION_SOURCE_REQUIRED';
  END IF;
  -- Share the local producer fence, including privileged direct INSERT. No
  -- timeout is promoted into a stopped outcome, and no provider row is locked.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.login.lifecycle/1:'||stopped.attempt_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_CLEANUP_EXECUTION_BUSY';
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
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_EXECUTION_SOURCE_REQUIRED';
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
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_EXECUTION_SOURCE_REQUIRED';
  END IF;
  IF (req.attempt_id,req.issued_security_epoch,req.provider_subject,req.provider_session_id,req.app_session_id,req.registration_event_id,req.cleanup_reference_id)
    IS DISTINCT FROM (attempt.attempt_id,stopped.issued_security_epoch,stopped.provider_subject,target.provider_session_id,attempt.reserved_app_session_id,source_id,reference_id)
    OR req.canonical_evidence::jsonb->>'sourceFinishHash' IS DISTINCT FROM stopped.event_hash
    OR req.canonical_evidence::jsonb->>'targetHash' IS DISTINCT FROM target.event_hash THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_EXECUTION_SOURCE_REQUIRED';
  END IF;
  -- ROW EXCLUSIVE is compatible with ordinary provider writes, but fences
  -- schema/trigger/FK changes across inspection, deletion and outcome commit.
  LOCK TABLE ONLY auth.sessions,ONLY auth.refresh_tokens,ONLY auth.mfa_amr_claims IN ROW EXCLUSIVE MODE;
  PERFORM crest_private.assert_cleanup_provider_schema();
  IF EXISTS (SELECT 1 FROM auth.sessions p WHERE p.id=req.provider_session_id AND p.user_id<>req.provider_subject) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_EXECUTION_BINDING_REQUIRED';
  END IF;
  -- DELETE takes the actual provider row lock, bounded by lock_timeout. Its
  -- predicate is rechecked after a wait; no UPDATE/secret/child DML grant.
  DELETE FROM auth.sessions p WHERE p.id=req.provider_session_id AND p.user_id=req.provider_subject RETURNING p.id INTO removed_id;
  IF removed_id IS NULL AND EXISTS (SELECT 1 FROM auth.sessions p WHERE p.id=req.provider_session_id) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CREST_CLEANUP_PROVIDER_REVIEW_REQUIRED';
  END IF;
  NEW.provider_subject:=req.provider_subject; NEW.provider_session_id:=req.provider_session_id;
  NEW.outcome:=CASE WHEN removed_id IS NULL THEN 'provider_absent_observed' ELSE 'provider_removed' END;
  NEW.schema_version:=1; NEW.origin:='system'; NEW.created_at:=clock_timestamp(); NEW.database_principal:=session_user;
  NEW.canonical_evidence:=jsonb_build_object('schemaVersion',1,'origin','system','requestId',NEW.request_id,'requestHash',req.event_hash,
    'actorId',NEW.actor_id,'securityEpoch',req.issued_security_epoch,'providerIssuer',NEW.provider_issuer,'providerSubject',NEW.provider_subject,
    'providerSessionId',NEW.provider_session_id,'appSessionId',req.app_session_id,'sourceFinishId',req.source_finish_id,
    'outcome',NEW.outcome,'createdAt',NEW.created_at,'databasePrincipal',NEW.database_principal)::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.canonical_evidence,'UTF8')),'hex'); RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.capture_provider_cleanup_outcome() FROM PUBLIC;
CREATE TRIGGER provider_cleanup_outcome_capture BEFORE INSERT ON crest_private.provider_cleanup_outcomes FOR EACH ROW EXECUTE FUNCTION crest_private.capture_provider_cleanup_outcome();
CREATE TRIGGER provider_cleanup_outcome_retained BEFORE UPDATE OR DELETE ON crest_private.provider_cleanup_outcomes FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER provider_cleanup_outcome_no_truncate BEFORE TRUNCATE ON crest_private.provider_cleanup_outcomes FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();

CREATE FUNCTION crest_commands.execute_provider_cleanup(requested_id uuid,expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $execute$
DECLARE saved crest_private.provider_cleanup_outcomes%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CLEANUP_EXECUTION_FRESH_READ_REQUIRED'; END IF;
  IF requested_id IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CLEANUP_EXECUTION_INPUT_REQUIRED';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.cleanup.execute/1:'||requested_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_CLEANUP_EXECUTION_BUSY';
  END IF;
  SELECT * INTO saved FROM crest_private.provider_cleanup_outcomes WHERE request_id=requested_id;
  IF FOUND THEN
    IF saved.actor_id IS DISTINCT FROM expected_actor OR saved.provider_issuer IS DISTINCT FROM expected_issuer THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_EXECUTION_BINDING_REQUIRED';
    END IF;
  ELSE
    INSERT INTO crest_private.provider_cleanup_outcomes(request_id,actor_id,provider_issuer)
      VALUES(requested_id,expected_actor,expected_issuer) RETURNING * INTO saved;
  END IF;
  RETURN jsonb_build_object('evidence',saved.canonical_evidence::jsonb,'evidenceHash',saved.event_hash,'canonicalEvidence',saved.canonical_evidence);
END
$execute$;

CREATE FUNCTION crest_commands.read_provider_cleanup_outcome(requested_id uuid,expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE result jsonb;
BEGIN
  IF requested_id IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CLEANUP_EXECUTION_INPUT_REQUIRED';
  END IF;
  SELECT jsonb_build_object('evidence',r.canonical_evidence::jsonb,'evidenceHash',r.event_hash,'canonicalEvidence',r.canonical_evidence) INTO result
    FROM crest_private.provider_cleanup_outcomes r WHERE r.request_id=requested_id AND r.actor_id=expected_actor AND r.provider_issuer=expected_issuer;
  RETURN result;
END
$read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands,crest_private TO crest_cleanup_owner;
ALTER FUNCTION crest_private.assert_cleanup_provider_schema() OWNER TO crest_cleanup_owner;
ALTER FUNCTION crest_commands.execute_provider_cleanup(uuid,uuid,text) OWNER TO crest_cleanup_owner;
REVOKE CREATE ON SCHEMA crest_commands,crest_private FROM crest_cleanup_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.read_provider_cleanup_outcome(uuid,uuid,text) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.execute_provider_cleanup(uuid,uuid,text),crest_commands.read_provider_cleanup_outcome(uuid,uuid,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA crest_commands TO crest_cleanup;
GRANT EXECUTE ON FUNCTION crest_commands.execute_provider_cleanup(uuid,uuid,text) TO crest_cleanup;
GRANT EXECUTE ON FUNCTION crest_commands.read_provider_cleanup_outcome(uuid,uuid,text) TO crest_inventory;
-- No service login/membership, worker adapter, scheduler or production activation.
