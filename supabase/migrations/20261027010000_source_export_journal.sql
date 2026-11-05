-- Registered migration43 source export journal (ADR43).
-- Retained proposal bodies below are exact reviewed source; historical
-- construction comments are provenance. Registry/canonical adoption controls
-- registration. Production activation and complete-backup claims stay blocked.

-- Retained proposal 1/7: planning/proposals/source-export-jobs.sql SHA256 82849fd3749128b6b6fc1938a426deb5d888c20b2d452ab53d6210b5b397cc7f
-- UNREGISTERED forward43 candidate. Apply with snapshots, parts and ready.
-- No runtime activation; Ready requires the separately retained completion.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.memberships'::regclass,'crest_private.app_sessions'::regclass,'crest_private.business_recovery_authorities'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>5
 OR to_regprocedure('crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,jsonb,text)') IS NULL THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_JOB_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.export_jobs(
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL,
 profile text NOT NULL CHECK(profile='crest.business-source-journal-bundle.v1'),
 app_release_id text NOT NULL CHECK(app_release_id~'^[a-f0-9]{40}$'),
 source_schema_version integer NOT NULL CHECK(source_schema_version=43),
 recovery_epoch uuid NOT NULL,
 request_operation_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('Queued','Running','Failed','Ready')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
 lease_id uuid,
 lease_until timestamptz,
 next_run_at timestamptz NOT NULL,
 failure_code text CHECK(failure_code IN('LEASE_EXPIRED','OWNER_STOPPED')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),
 operation_id uuid NOT NULL,
 import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,request_operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id),CHECK((lease_id IS NULL)=(lease_until IS NULL)),
 CHECK((state='Running')=(lease_id IS NOT NULL)),
 CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at AND isfinite(next_run_at) AND (lease_until IS NULL OR isfinite(lease_until)))
);
CREATE UNIQUE INDEX export_jobs_one_active_business ON crest_private.export_jobs(business_id) WHERE state IN('Queued','Running');
CREATE INDEX export_jobs_actor ON crest_private.export_jobs(business_id,actor_id);
CREATE INDEX export_jobs_creator ON crest_private.export_jobs(business_id,created_by);
CREATE INDEX export_jobs_updater ON crest_private.export_jobs(business_id,updated_by);
CREATE INDEX export_jobs_request_operation ON crest_private.export_jobs(business_id,request_operation_id,actor_id);
CREATE INDEX export_jobs_operation ON crest_private.export_jobs(business_id,operation_id,updated_by);
CREATE INDEX export_jobs_cursor ON crest_private.export_jobs(business_id,created_at,id);
CREATE INDEX export_jobs_runnable ON crest_private.export_jobs(business_id,next_run_at,id) WHERE state='Queued';
CREATE TABLE crest_private.export_job_attempts(
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 export_job_id uuid NOT NULL,
 attempt_no integer NOT NULL CHECK(attempt_no BETWEEN 1 AND 5),
 recovery_epoch uuid NOT NULL,
 leased_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),
 operation_id uuid NOT NULL,
 import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),UNIQUE(business_id,export_job_id,attempt_no),UNIQUE(business_id,export_job_id,id),
 FOREIGN KEY(business_id,export_job_id) REFERENCES crest_private.export_jobs(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(isfinite(created_at) AND isfinite(leased_at) AND isfinite(lease_until) AND lease_until=leased_at+interval '15 minutes' AND created_at=leased_at)
);
CREATE INDEX export_attempts_creator ON crest_private.export_job_attempts(business_id,created_by);
CREATE INDEX export_attempts_operation ON crest_private.export_job_attempts(business_id,operation_id,created_by);
CREATE INDEX export_attempts_cursor ON crest_private.export_job_attempts(business_id,created_at,id);
ALTER TABLE crest_private.export_jobs ADD CONSTRAINT export_jobs_current_lease FOREIGN KEY(business_id,id,lease_id) REFERENCES crest_private.export_job_attempts(business_id,export_job_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE crest_private.export_jobs ENABLE ROW LEVEL SECURITY;ALTER TABLE crest_private.export_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.export_job_attempts ENABLE ROW LEVEL SECURITY;ALTER TABLE crest_private.export_job_attempts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.export_jobs,crest_private.export_job_attempts TO crest_command_owner;
GRANT UPDATE(state,attempt_count,lease_id,lease_until,next_run_at,failure_code,version,updated_at,updated_by,operation_id) ON crest_private.export_jobs TO crest_command_owner;
CREATE POLICY export_job_read ON crest_private.export_jobs FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY export_job_insert ON crest_private.export_jobs FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND updated_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND request_operation_id=operation_id);
CREATE POLICY export_job_update ON crest_private.export_jobs FOR UPDATE TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY export_attempt_read ON crest_private.export_job_attempts FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY export_attempt_insert ON crest_private.export_job_attempts FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE TRIGGER export_attempt_retained BEFORE UPDATE OR DELETE ON crest_private.export_job_attempts FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_attempt_truncate BEFORE TRUNCATE ON crest_private.export_job_attempts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_job_delete BEFORE DELETE ON crest_private.export_jobs FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_job_truncate BEFORE TRUNCATE ON crest_private.export_jobs FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE FUNCTION crest_private.source_export_job_projection(j crest_private.export_jobs) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',(j).id,'business_id',(j).business_id,'actor_id',(j).actor_id,'profile',(j).profile,'app_release_id',(j).app_release_id,'source_schema_version',(j).source_schema_version,'recovery_epoch',(j).recovery_epoch,'request_operation_id',(j).request_operation_id,'state',(j).state,'attempt_count',(j).attempt_count,'lease_id',(j).lease_id,'lease_until',to_char((j).lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'next_run_at',to_char((j).next_run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'failure_code',(j).failure_code,'version',(j).version::text,'created_at',to_char((j).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((j).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(j).created_by,'updated_by',(j).updated_by,'origin',(j).origin,'operation_id',(j).operation_id,'import_row_id',(j).import_row_id)
$$;
CREATE FUNCTION crest_private.guard_source_export_job() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'Queued' OR NEW.version<>1 OR NEW.attempt_count<>0 OR NEW.lease_id IS NOT NULL OR NEW.failure_code IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_INITIAL_STATE_REQUIRED';END IF;
  NEW.created_at:=stamp;NEW.updated_at:=stamp;NEW.next_run_at:=stamp;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','updated_at','updated_by','operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','updated_at','updated_by','operation_id']) OR NEW.version<>OLD.version+1
   OR NOT coalesce((OLD.state='Queued' AND NEW.state='Running' AND NEW.attempt_count=OLD.attempt_count+1 AND NEW.lease_id IS NOT NULL AND NEW.lease_until>stamp AND NEW.failure_code IS NULL
    OR OLD.state='Running' AND NEW.state IN('Queued','Failed') AND NEW.attempt_count=OLD.attempt_count AND NEW.lease_id IS NULL AND NEW.failure_code='LEASE_EXPIRED' AND OLD.lease_until<=stamp
    OR OLD.state='Running' AND NEW.state='Ready' AND NEW.attempt_count=OLD.attempt_count AND NEW.lease_id IS NULL AND NEW.failure_code IS NULL AND OLD.lease_until>stamp AND NEW.updated_by=OLD.actor_id AND NEW.next_run_at=OLD.next_run_at AND EXISTS(SELECT 1 FROM crest_private.export_job_completions c WHERE c.business_id=OLD.business_id AND c.export_job_id=OLD.id AND c.lease_id=OLD.lease_id AND c.actor_id=OLD.actor_id AND c.recovery_epoch=OLD.recovery_epoch AND c.operation_id=NEW.operation_id AND c.expected_version=OLD.version)
    OR OLD.state IN('Queued','Running') AND NEW.state='Failed' AND NEW.attempt_count=OLD.attempt_count AND NEW.lease_id IS NULL AND NEW.failure_code='OWNER_STOPPED'),false) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_EXPORT_JOB_TRANSITION_REQUIRED';END IF;
  NEW.updated_at:=stamp;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER export_job_guard BEFORE INSERT OR UPDATE ON crest_private.export_jobs FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_job();
CREATE FUNCTION crest_private.guard_source_export_attempt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.export_jobs j WHERE j.business_id=NEW.business_id AND j.id=NEW.export_job_id AND j.state='Queued' AND j.actor_id=NEW.created_by AND j.recovery_epoch=NEW.recovery_epoch AND j.attempt_count+1=NEW.attempt_no) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_ATTEMPT_SOURCE_REQUIRED';END IF;
 NEW.leased_at:=stamp;NEW.created_at:=stamp;NEW.lease_until:=stamp+interval '15 minutes';RETURN NEW;
END $$;
CREATE TRIGGER export_attempt_guard BEFORE INSERT ON crest_private.export_job_attempts FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_attempt();
CREATE FUNCTION crest_private.check_source_export_attempt_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='export_jobs' AND a.entity_id=NEW.export_job_id AND a.action='claim' AND a.delta->'after'->>'lease_id'=NEW.id::text AND a.delta->'after'->>'attempt_count'=NEW.attempt_no::text AND a.delta->'after'->>'recovery_epoch'=NEW.recovery_epoch::text AND a.delta->'after'->>'lease_until'=to_char(NEW.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_ATTEMPT_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER export_attempt_audit AFTER INSERT ON crest_private.export_job_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_source_export_attempt_audit();
CREATE FUNCTION crest_private.check_source_export_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j crest_private.export_jobs;
BEGIN
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=NEW.business_id AND id=NEW.id;
 IF j.state='Running' AND NOT EXISTS(SELECT 1 FROM crest_private.export_job_attempts x WHERE x.business_id=j.business_id AND x.export_job_id=j.id AND x.id=j.lease_id AND x.attempt_no=j.attempt_count AND x.recovery_epoch=j.recovery_epoch AND x.created_by=j.actor_id AND x.lease_until=j.lease_until) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_LEASE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=j.business_id AND a.operation_id=j.operation_id AND a.actor_id=j.updated_by AND a.entity_kind='export_jobs' AND a.entity_id=j.id AND a.entity_version=j.version AND a.delta->'after'=crest_private.source_export_job_projection(j)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER export_job_audit AFTER INSERT OR UPDATE ON crest_private.export_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_source_export_audit();
-- Every meaningful state transition uses a new ordinary immutable operation.
CREATE POLICY source_export_operation_claim ON crest_private.operations FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('export.request','export.claim','export.expire','export.stop','export.ready') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY source_export_operation_finish ON crest_private.operations FOR UPDATE TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('export.request','export.claim','export.expire','export.stop','export.ready')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('export.request','export.claim','export.expire','export.stop','export.ready') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY source_export_audit_insert ON crest_private.audit_events FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='export_jobs' AND action IN('request','claim','expire','stop','ready') AND origin='manual' AND import_row_id IS NULL AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.command_type='export.'||audit_events.action AND o.schema_version=1 AND o.state='pending'));
CREATE POLICY source_export_audit_read ON crest_private.audit_events FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='export_jobs');
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta) ON crest_private.audit_events TO crest_command_owner;

CREATE FUNCTION crest_commands.authorize_source_export_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;stamp timestamptz;
BEGIN
 context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM crest.memberships m JOIN crest_private.role_capabilities c ON c.role=m.role WHERE m.business_id=requested_business AND m.actor_id=expected_actor AND m.active AND m.role='owner' AND c.capability='export.bulk') OR NOT EXISTS(SELECT 1 FROM crest_private.app_sessions WHERE id=expected_session AND actor_id=expected_actor AND authenticated_at<=stamp AND (reauth_at IS NULL OR reauth_at<=stamp) AND coalesce(reauth_at,authenticated_at)>stamp-interval '15 minutes' AND expires_at>stamp) OR provider_valid_until<=stamp THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_JOB_DENIED';END IF;
 RETURN context;
END $$;
CREATE FUNCTION crest_commands.lock_source_export_authority(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN
 context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'export.bulk',true);
 IF NOT EXISTS(SELECT 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=expected_actor AND active AND role='owner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_JOB_DENIED';END IF;
 RETURN context;
END $$;
CREATE FUNCTION crest_private.source_export_command(kind text,business uuid,epoch uuid,operation uuid,job uuid,expected_version text,lease uuid,release_id text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE reference jsonb;
BEGIN
 reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',epoch,'exportJobId',job);
 IF kind='export.request' THEN reference:=reference||jsonb_build_object('appReleaseId',release_id,'profile','crest.business-source-journal-bundle.v1','sourceSchemaVersion',43);
 ELSIF kind IN('export.claim','export.expire') THEN reference:=reference||jsonb_build_object('expectedVersion',expected_version,'leaseId',lease);
 ELSIF kind='export.stop' THEN reference:=reference||jsonb_build_object('expectedVersion',expected_version);
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'commandType',kind,'reference',reference);
END $$;
CREATE FUNCTION crest_private.source_export_receipt(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE o crest_private.operations;r jsonb;a record;expected_command jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 r:=o.result;
 IF o.command_type NOT IN('export.request','export.claim','export.expire','export.stop','export.ready') OR o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR r IS NULL OR jsonb_typeof(r)<>'object' OR NOT(r?&ARRAY['schemaVersion','command','job','auditEventId']) OR r-ARRAY['schemaVersion','command','job','auditEventId']<>'{}'::jsonb OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(r->'job') IS DISTINCT FROM 'object' OR r->'job'->>'business_id' IS DISTINCT FROM business::text OR r->'job'->>'operation_id' IS DISTINCT FROM operation::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 SELECT id,delta INTO a FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id::text=r->>'auditEventId' AND entity_kind='export_jobs' AND entity_id::text=r->'job'->>'id' AND entity_version::text=r->'job'->>'version' AND action=split_part(o.command_type,'.',2) AND delta->'after'=r->'job';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 IF o.command_type='export.ready' THEN
  SELECT crest_private.source_export_ready_command(business,o.recovery_epoch,operation,(r->'job'->>'id')::uuid,c.expected_version::text,c.lease_id,c.generation_id,c.request_sha256) INTO expected_command FROM crest_private.export_job_completions c WHERE c.business_id=business AND c.export_job_id=(r->'job'->>'id')::uuid AND c.operation_id=operation AND c.actor_id=actor AND c.expected_version::text=a.delta->'before'->>'version' AND c.lease_id::text=a.delta->'before'->>'lease_id' AND a.delta->'before'->>'state'='Running' AND r->'job'->>'state'='Ready';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 ELSE
 expected_command:=crest_private.source_export_command(o.command_type,business,o.recovery_epoch,operation,(r->'job'->>'id')::uuid,a.delta->'before'->>'version',CASE WHEN o.command_type='export.claim' THEN (a.delta->'after'->>'lease_id')::uuid WHEN o.command_type='export.expire' THEN (a.delta->'before'->>'lease_id')::uuid ELSE NULL END,CASE WHEN o.command_type='export.request' THEN r->'job'->>'app_release_id' ELSE NULL END);
 END IF;
 IF r->'command' IS DISTINCT FROM expected_command THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $$;
CREATE FUNCTION crest_commands.source_export_transition(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,job uuid,action text,expected_version bigint,lease uuid,release_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;j crest_private.export_jobs;before_state jsonb;after_state jsonb;event uuid;stamp timestamptz;lease_end timestamptz;receipt jsonb;kind text:='export.'||action;delay interval;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF operation IS NULL OR job IS NULL OR action IS NULL OR action NOT IN('request','claim','expire','stop') OR action='request' AND (release_id IS NULL OR release_id!~'^[a-f0-9]{40}$' OR expected_version IS NOT NULL OR lease IS NOT NULL) OR action<>'request' AND (expected_version IS NULL OR expected_version<1 OR release_id IS NOT NULL) OR action IN('claim','expire') AND lease IS NULL OR action='stop' AND lease IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType',kind,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',job,'expectedVersion',expected_version::text,'leaseId',lease,'appReleaseId',release_id,'profile','crest.business-source-journal-bundle.v1','sourceSchemaVersion',43)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,kind,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=operation;
   PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
   IF NOT FOUND OR existing.actor_id IS DISTINCT FROM expected_actor OR existing.command_type IS DISTINCT FROM kind OR existing.recovery_epoch IS DISTINCT FROM expected_epoch OR existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   RETURN crest_private.source_export_receipt(requested_business,expected_actor,operation);
  END IF;
  IF action='request' THEN
   INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(job,requested_business,expected_actor,'crest.business-source-journal-bundle.v1',release_id,43,expected_epoch,operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',operation) RETURNING * INTO j;
  ELSE
   SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=job FOR UPDATE SKIP LOCKED;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1101',MESSAGE='CREST_EXPORT_JOB_BUSY';END IF;
   PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
   IF j.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION USING ERRCODE='P1102',MESSAGE='CREST_EXPORT_JOB_VERSION';END IF;
   before_state:=crest_private.source_export_job_projection(j);stamp:=clock_timestamp();
   IF action='claim' THEN
    IF j.actor_id<>expected_actor OR j.recovery_epoch<>expected_epoch OR j.state<>'Queued' OR j.attempt_count>=5 OR j.next_run_at>stamp THEN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='CREST_EXPORT_JOB_NOT_RUNNABLE';END IF;
    INSERT INTO crest_private.export_job_attempts(id,business_id,export_job_id,attempt_no,recovery_epoch,leased_at,lease_until,created_at,created_by,origin,operation_id) VALUES(lease,requested_business,job,j.attempt_count+1,expected_epoch,stamp,stamp+interval '15 minutes',stamp,expected_actor,'manual',operation) RETURNING lease_until INTO lease_end;
    UPDATE crest_private.export_jobs SET state='Running',attempt_count=attempt_count+1,lease_id=lease,lease_until=lease_end,failure_code=NULL,version=version+1,updated_by=expected_actor,operation_id=operation WHERE business_id=requested_business AND id=job RETURNING * INTO j;
   ELSIF action='expire' THEN
    IF j.actor_id<>expected_actor OR j.recovery_epoch<>expected_epoch OR j.state<>'Running' OR j.lease_id IS DISTINCT FROM lease OR j.lease_until>stamp THEN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='CREST_EXPORT_JOB_NOT_RUNNABLE';END IF;
    delay:=CASE j.attempt_count WHEN 1 THEN interval '1 minute' WHEN 2 THEN interval '5 minutes' WHEN 3 THEN interval '15 minutes' ELSE interval '60 minutes' END;
    UPDATE crest_private.export_jobs SET state=CASE WHEN attempt_count=5 THEN 'Failed' ELSE 'Queued' END,lease_id=NULL,lease_until=NULL,next_run_at=stamp+delay,failure_code='LEASE_EXPIRED',version=version+1,updated_by=expected_actor,operation_id=operation WHERE business_id=requested_business AND id=job RETURNING * INTO j;
   ELSE
    IF j.state NOT IN('Queued','Running') THEN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='CREST_EXPORT_JOB_NOT_RUNNABLE';END IF;
    UPDATE crest_private.export_jobs SET state='Failed',lease_id=NULL,lease_until=NULL,failure_code='OWNER_STOPPED',version=version+1,updated_by=expected_actor,operation_id=operation WHERE business_id=requested_business AND id=job RETURNING * INTO j;
   END IF;
  END IF;
  after_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,operation,expected_actor,expected_actor,'export_jobs',job,j.version,action,jsonb_build_object('schemaVersion',1,'before',before_state,'after',after_state),'manual') RETURNING id INTO event;
  receipt:=jsonb_build_object('schemaVersion',1,'command',crest_private.source_export_command(kind,requested_business,expected_epoch,operation,job,expected_version::text,lease,release_id),'job',after_state,'auditEventId',event);
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=operation;
  PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
  RETURN crest_private.source_export_receipt(requested_business,expected_actor,operation);
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('state','conflict','reason','active_or_identity');
 WHEN SQLSTATE 'P1101' THEN RETURN jsonb_build_object('state','busy');
 WHEN SQLSTATE 'P1102' THEN RETURN jsonb_build_object('state','conflict','reason','version');
 WHEN SQLSTATE 'P1103' THEN RETURN jsonb_build_object('state','conflict','reason','state');
 END;
END $$;
CREATE FUNCTION crest_commands.request_source_export(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,job uuid,release_id text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.source_export_transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'request',NULL,NULL,$12) $$;
CREATE FUNCTION crest_commands.claim_source_export(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,job uuid,expected_version bigint,lease uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.source_export_transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'claim',$12,$13,NULL) $$;
CREATE FUNCTION crest_commands.expire_source_export(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,job uuid,expected_version bigint,lease uuid) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.source_export_transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'expire',$12,$13,NULL) $$;
CREATE FUNCTION crest_commands.stop_source_export(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,job uuid,expected_version bigint) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.source_export_transition($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'stop',$12,NULL,NULL) $$;
CREATE FUNCTION crest_commands.read_source_export(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;j crest_private.export_jobs;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=job;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 RETURN jsonb_build_object('state','found','job',crest_private.source_export_job_projection(j));
END $$;
CREATE FUNCTION crest_commands.lookup_source_export_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.source_export_receipt(requested_business,expected_actor,operation);
END $$;
RESET ROLE;
-- Deferred checks fire at outer COMMIT after the command definer returned.
-- Give only these non-callable trigger routines the existing scoped command
-- identity; the web caller still has no source SELECT or trigger EXECUTE.
GRANT CREATE ON SCHEMA crest_private TO crest_command_owner;
ALTER FUNCTION crest_private.check_source_export_attempt_audit() OWNER TO crest_command_owner;
ALTER FUNCTION crest_private.check_source_export_audit() OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_command_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_command_owner;
ALTER FUNCTION crest_commands.authorize_source_export_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.lock_source_export_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.source_export_transition(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,bigint,uuid,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.request_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.claim_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.expire_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.stop_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.lookup_source_export_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_job_projection(crest_private.export_jobs),crest_private.guard_source_export_job(),crest_private.check_source_export_audit(),crest_private.guard_source_export_attempt(),crest_private.check_source_export_attempt_audit(),crest_private.source_export_receipt(uuid,uuid,uuid),crest_commands.authorize_source_export_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.lock_source_export_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.source_export_transition(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,bigint,uuid,text),crest_commands.request_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),crest_commands.claim_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid),crest_commands.expire_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid),crest_commands.stop_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),crest_commands.read_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.lookup_source_export_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_job_projection(crest_private.export_jobs),crest_private.source_export_receipt(uuid,uuid,uuid),crest_commands.authorize_source_export_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.lock_source_export_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.request_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),crest_commands.claim_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid),crest_commands.expire_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,uuid),crest_commands.stop_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),crest_commands.read_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.lookup_source_export_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
REVOKE ALL ON FUNCTION crest_private.source_export_command(text,uuid,uuid,uuid,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_command(text,uuid,uuid,uuid,uuid,text,uuid,text) TO crest_command_owner;

-- Retained proposal 2/7: planning/proposals/source-export-snapshots.sql SHA256 f7287735b4277e5b3ec4b385f98fd09f20fe9f10424562133e64a6149c9930a9
-- UNREGISTERED continuation of forward43; apply after source-export-jobs.sql.
-- Durable plan ONLY. No part intent, verified custody, Ready or worker dispatch.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.export_job_snapshots(
 generation_id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 export_job_id uuid NOT NULL,
 lease_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 app_release_id text NOT NULL CHECK(app_release_id~'^[a-f0-9]{40}$'),
 source_schema_version integer NOT NULL CHECK(source_schema_version=43),
 observed_at timestamptz NOT NULL CHECK(isfinite(observed_at)),
 plan_sha256 text NOT NULL CHECK(plan_sha256~'^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request_text text NOT NULL CHECK(octet_length(request_text) BETWEEN 1 AND 1048576),
 file_count integer NOT NULL CHECK(file_count BETWEEN 2 AND 1024),
 total_bytes integer NOT NULL CHECK(total_bytes BETWEEN 2 AND 67108864),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),
 operation_id uuid NOT NULL,
 import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,generation_id),UNIQUE(business_id,export_job_id,lease_id),
 FOREIGN KEY(business_id,export_job_id,lease_id) REFERENCES crest_private.export_job_attempts(business_id,export_job_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id AND isfinite(created_at) AND created_at>=observed_at),
 CHECK(request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex'))
);
CREATE INDEX export_snapshots_actor ON crest_private.export_job_snapshots(business_id,actor_id);
CREATE INDEX export_snapshots_operation ON crest_private.export_job_snapshots(business_id,operation_id,created_by);
CREATE INDEX export_snapshots_cursor ON crest_private.export_job_snapshots(business_id,created_at,generation_id);
ALTER TABLE crest_private.export_job_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.export_job_snapshots FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.export_job_snapshots TO crest_command_owner;
CREATE POLICY export_snapshot_read ON crest_private.export_job_snapshots FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY export_snapshot_insert ON crest_private.export_job_snapshots FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND origin='manual' AND import_row_id IS NULL);
CREATE TRIGGER export_snapshot_retained BEFORE UPDATE OR DELETE ON crest_private.export_job_snapshots FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_snapshot_truncate BEFORE TRUNCATE ON crest_private.export_job_snapshots FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.export_json_object(v jsonb,keys text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_typeof(v)='object' AND v?&keys AND v-keys='{}'::jsonb,false)
$$;
CREATE FUNCTION crest_private.export_json_uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_typeof(v)='string' AND (v#>>'{}')~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$$;
CREATE FUNCTION crest_private.source_export_claim_matches(v jsonb,j crest_private.export_jobs) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT crest_private.export_json_object(v,ARRAY['formatVersion','profile','businessId','actorId','exportJobId','recoveryEpoch','leaseId']) AND v=jsonb_build_object('formatVersion',1,'profile',(j).profile,'businessId',(j).business_id,'actorId',(j).actor_id,'exportJobId',(j).id,'recoveryEpoch',(j).recovery_epoch,'leaseId',(j).lease_id)
$$;
CREATE FUNCTION crest_private.source_export_snapshot_plan(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE r jsonb;p jsonb;f jsonb;names text[]:=ARRAY[]::text[];ids text[]:=ARRAY[]::text[];previous_name text;name text;n bigint:=0;position integer:=0;stamp timestamptz;plan_text text;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 1048576 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;p:=r->'plan';plan_text:=(original::json->'plan')::text;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256'])
 OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR r->>'planSha256' IS DISTINCT FROM encode(sha256(convert_to(plan_text,'UTF8')),'hex')
 OR NOT crest_private.export_json_object(p,ARRAY['formatVersion','claim','generationId','observedAt','appReleaseId','sourceSchemaVersion','manifestSha256','parts','totalBytes','referenceClosureComplete','completePortableExport','completeBackup'])
 OR p->'formatVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.source_export_claim_matches(p->'claim',j) OR NOT crest_private.export_json_uuid(p->'generationId')
 OR p->'appReleaseId' IS DISTINCT FROM to_jsonb(j.app_release_id) OR p->'sourceSchemaVersion' IS DISTINCT FROM to_jsonb(j.source_schema_version)
 OR p->'referenceClosureComplete' IS DISTINCT FROM 'false'::jsonb OR p->'completePortableExport' IS DISTINCT FROM 'false'::jsonb OR p->'completeBackup' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(p->'manifestSha256') IS DISTINCT FROM 'string' OR coalesce(p->>'manifestSha256','')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(p->'observedAt') IS DISTINCT FROM 'string' OR coalesce(p->>'observedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?\+00:00$'
 OR jsonb_typeof(p->'parts') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'totalBytes') IS DISTINCT FROM 'number' OR coalesce(p->>'totalBytes','')!~'^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 IF jsonb_array_length(p->'parts') NOT BETWEEN 2 AND 1024 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 stamp:=(p->>'observedAt')::timestamptz;
 IF NOT isfinite(stamp) OR stamp>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM crest_private.export_job_attempts a WHERE a.business_id=j.business_id AND a.export_job_id=j.id AND a.id=j.lease_id AND a.leased_at<=stamp) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'parts') LOOP
  position:=position+1;
  IF NOT crest_private.export_json_object(f,ARRAY['partId','fileName','contentType','bytes','sha256']) OR NOT crest_private.export_json_uuid(f->'partId')
  OR jsonb_typeof(f->'fileName') IS DISTINCT FROM 'string' OR coalesce(f->>'fileName','')!~'^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$'
  OR jsonb_typeof(f->'bytes') IS DISTINCT FROM 'number' OR coalesce(f->>'bytes','')!~'^[1-9][0-9]{0,6}$' OR (f->>'bytes')::bigint>8388608
  OR jsonb_typeof(f->'sha256') IS DISTINCT FROM 'string' OR coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$'
  OR f->'contentType' IS DISTINCT FROM to_jsonb(CASE WHEN right(f->>'fileName',4)='.csv' THEN 'text/csv; charset=utf-8' WHEN right(f->>'fileName',5)='.json' THEN 'application/json' ELSE 'text/plain; charset=utf-8' END)
  OR f->>'fileName'=ANY(names) OR f->>'partId'=ANY(ids) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
  name:=f->>'fileName';
  IF position=jsonb_array_length(p->'parts') THEN
   IF name<>'source_manifest.json' OR f->'sha256' IS DISTINCT FROM p->'manifestSha256' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
  ELSIF name='source_manifest.json' OR previous_name IS NOT NULL AND name COLLATE "C"<=previous_name COLLATE "C" THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
  END IF;
  previous_name:=name;names:=array_append(names,name);ids:=array_append(ids,f->>'partId');n:=n+(f->>'bytes')::bigint;
 END LOOP;
 IF n<>(p->>'totalBytes')::bigint OR n>67108864 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 RETURN p;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
END $$;
CREATE FUNCTION crest_private.guard_source_export_snapshot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j crest_private.export_jobs;p jsonb;a crest_private.export_job_attempts;
BEGIN
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=NEW.business_id AND id=NEW.export_job_id;
 IF NOT FOUND OR j.state<>'Running' OR j.lease_id IS DISTINCT FROM NEW.lease_id OR j.actor_id IS DISTINCT FROM NEW.actor_id OR j.recovery_epoch IS DISTINCT FROM NEW.recovery_epoch OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_SNAPSHOT_SOURCE_REQUIRED';END IF;
 SELECT * INTO a FROM crest_private.export_job_attempts WHERE business_id=j.business_id AND export_job_id=j.id AND id=j.lease_id;
 p:=crest_private.source_export_snapshot_plan(NEW.request_text,j);
 IF NOT FOUND OR NEW.generation_id IS DISTINCT FROM (p->>'generationId')::uuid OR NEW.app_release_id IS DISTINCT FROM j.app_release_id OR NEW.source_schema_version IS DISTINCT FROM j.source_schema_version OR NEW.observed_at IS DISTINCT FROM (p->>'observedAt')::timestamptz OR NEW.plan_sha256 IS DISTINCT FROM NEW.request_text::jsonb->>'planSha256' OR NEW.file_count IS DISTINCT FROM jsonb_array_length(p->'parts') OR NEW.total_bytes IS DISTINCT FROM (p->>'totalBytes')::integer OR NEW.manifest_sha256 IS DISTINCT FROM p->>'manifestSha256' OR NEW.operation_id IS DISTINCT FROM a.operation_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_SNAPSHOT_SOURCE_REQUIRED';END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE TRIGGER export_snapshot_guard BEFORE INSERT ON crest_private.export_job_snapshots FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_snapshot();

CREATE FUNCTION crest_private.lock_source_export_live_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,job uuid,lease uuid) RETURNS crest_private.export_jobs LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j crest_private.export_jobs;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 IF j.state<>'Running' OR j.actor_id IS DISTINCT FROM expected_actor OR j.recovery_epoch IS DISTINCT FROM expected_epoch OR j.lease_id IS DISTINCT FROM lease OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 RETURN j;
END $$;
CREATE FUNCTION crest_commands.authorize_source_export_worker(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;j crest_private.export_jobs;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 2048 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;
 IF NOT crest_private.export_json_object(r,ARRAY['formatVersion','profile','businessId','actorId','exportJobId','recoveryEpoch','leaseId']) OR NOT crest_private.export_json_uuid(r->'exportJobId') OR NOT crest_private.export_json_uuid(r->'leaseId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 j:=crest_private.lock_source_export_live_job(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,(r->>'exportJobId')::uuid,(r->>'leaseId')::uuid);
 IF NOT crest_private.source_export_claim_matches(r,j) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 RETURN jsonb_build_object('formatVersion',1,'stage','authorize','requestSha256',encode(sha256(convert_to(original,'UTF8')),'hex'));
END $$;
CREATE FUNCTION crest_commands.record_source_export_snapshot(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;p jsonb;j crest_private.export_jobs;s crest_private.export_job_snapshots;digest text;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 1048576 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;
 IF NOT crest_private.export_json_uuid(r->'plan'->'claim'->'exportJobId') OR NOT crest_private.export_json_uuid(r->'plan'->'claim'->'leaseId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 j:=crest_private.lock_source_export_live_job(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,(r->'plan'->'claim'->>'exportJobId')::uuid,(r->'plan'->'claim'->>'leaseId')::uuid);
 p:=crest_private.source_export_snapshot_plan(original,j);digest:=encode(sha256(convert_to(original,'UTF8')),'hex');
 SELECT * INTO s FROM crest_private.export_job_snapshots WHERE business_id=j.business_id AND export_job_id=j.id AND lease_id=j.lease_id;
 IF FOUND THEN
  IF s.request_text IS DISTINCT FROM original OR s.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_SNAPSHOT_ALREADY_FROZEN';END IF;
 ELSE
  INSERT INTO crest_private.export_job_snapshots(generation_id,business_id,export_job_id,lease_id,actor_id,recovery_epoch,app_release_id,source_schema_version,observed_at,plan_sha256,request_sha256,request_text,file_count,total_bytes,manifest_sha256,created_by,origin,operation_id) VALUES((p->>'generationId')::uuid,j.business_id,j.id,j.lease_id,j.actor_id,j.recovery_epoch,j.app_release_id,j.source_schema_version,(p->>'observedAt')::timestamptz,r->>'planSha256',digest,original,jsonb_array_length(p->'parts'),(p->>'totalBytes')::integer,p->>'manifestSha256',j.actor_id,'manual',j.operation_id);
 END IF;
 -- Recheck after every lock/insert before acknowledging. No network I/O here.
 PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 IF j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 RETURN jsonb_build_object('formatVersion',1,'stage','snapshot','requestSha256',digest);
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.authorize_source_export_worker(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_snapshot(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.export_json_object(jsonb,text[]),crest_private.export_json_uuid(jsonb),crest_private.source_export_claim_matches(jsonb,crest_private.export_jobs),crest_private.source_export_snapshot_plan(text,crest_private.export_jobs),crest_private.guard_source_export_snapshot(),crest_private.lock_source_export_live_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),crest_commands.authorize_source_export_worker(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text),crest_commands.record_source_export_snapshot(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.export_json_object(jsonb,text[]),crest_private.export_json_uuid(jsonb),crest_private.source_export_claim_matches(jsonb,crest_private.export_jobs),crest_private.source_export_snapshot_plan(text,crest_private.export_jobs),crest_private.guard_source_export_snapshot(),crest_private.lock_source_export_live_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_source_export_worker(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text),crest_commands.record_source_export_snapshot(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) TO crest_web;

-- Retained proposal 3/7: planning/proposals/source-export-parts.sql SHA256 29fa85cb60795db7a7d987a1e77f88af363ab651c0587d2e98b2cbac13ea1522
-- UNREGISTERED forward43 continuation. Apply after jobs and snapshots.
-- These are immutable metadata/verification attestations, not Ready/download.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.export_part_intents(
 business_id uuid NOT NULL,generation_id uuid NOT NULL,part_id uuid NOT NULL,
 export_job_id uuid NOT NULL,lease_id uuid NOT NULL,actor_id uuid NOT NULL,recovery_epoch uuid NOT NULL,
 plan_sha256 text NOT NULL CHECK(plan_sha256~'^[a-f0-9]{64}$'),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 1024),
 file_name text NOT NULL,content_type text NOT NULL,object_key text NOT NULL UNIQUE,
 key_id text NOT NULL CHECK(key_id~'^[A-Za-z0-9_-]{1,100}$'),
 plaintext_bytes integer NOT NULL CHECK(plaintext_bytes BETWEEN 1 AND 8388608),
 plaintext_sha256 text NOT NULL CHECK(plaintext_sha256~'^[a-f0-9]{64}$'),
 ciphertext_bytes integer NOT NULL CHECK(ciphertext_bytes BETWEEN 1 AND 16777216),
 ciphertext_sha256 text NOT NULL CHECK(ciphertext_sha256~'^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request_text text NOT NULL CHECK(octet_length(request_text) BETWEEN 1 AND 8192),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 PRIMARY KEY(business_id,generation_id,part_id),UNIQUE(business_id,generation_id,ordinal),
 UNIQUE(business_id,generation_id,part_id,request_sha256),
 FOREIGN KEY(business_id,generation_id) REFERENCES crest_private.export_job_snapshots(business_id,generation_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,export_job_id,lease_id) REFERENCES crest_private.export_job_attempts(business_id,export_job_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id AND isfinite(created_at)),
 CHECK(request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex'))
);
CREATE INDEX export_intents_operation ON crest_private.export_part_intents(business_id,operation_id,created_by);
CREATE INDEX export_intents_lease ON crest_private.export_part_intents(business_id,export_job_id,lease_id);
CREATE INDEX export_intents_cursor ON crest_private.export_part_intents(business_id,created_at,generation_id,part_id);
CREATE TABLE crest_private.export_part_verifications(
 business_id uuid NOT NULL,generation_id uuid NOT NULL,part_id uuid NOT NULL,
 export_job_id uuid NOT NULL,lease_id uuid NOT NULL,actor_id uuid NOT NULL,recovery_epoch uuid NOT NULL,
 plan_sha256 text NOT NULL CHECK(plan_sha256~'^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request_text text NOT NULL CHECK(octet_length(request_text) BETWEEN 1 AND 8192),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 PRIMARY KEY(business_id,generation_id,part_id),
 FOREIGN KEY(business_id,generation_id,part_id,request_sha256) REFERENCES crest_private.export_part_intents(business_id,generation_id,part_id,request_sha256) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id AND isfinite(verified_at) AND verified_at=created_at),
 CHECK(request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex'))
);
CREATE INDEX export_verifications_operation ON crest_private.export_part_verifications(business_id,operation_id,created_by);
CREATE INDEX export_verifications_cursor ON crest_private.export_part_verifications(business_id,created_at,generation_id,part_id);
ALTER TABLE crest_private.export_part_intents ENABLE ROW LEVEL SECURITY;ALTER TABLE crest_private.export_part_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.export_part_verifications ENABLE ROW LEVEL SECURITY;ALTER TABLE crest_private.export_part_verifications FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.export_part_intents,crest_private.export_part_verifications TO crest_command_owner;
CREATE POLICY export_intent_read ON crest_private.export_part_intents FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY export_intent_insert ON crest_private.export_part_intents FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY export_verification_read ON crest_private.export_part_verifications FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY export_verification_insert ON crest_private.export_part_verifications FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id);
CREATE TRIGGER export_intent_retained BEFORE UPDATE OR DELETE ON crest_private.export_part_intents FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_intent_truncate BEFORE TRUNCATE ON crest_private.export_part_intents FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_verification_retained BEFORE UPDATE OR DELETE ON crest_private.export_part_verifications FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_verification_truncate BEFORE TRUNCATE ON crest_private.export_part_verifications FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.source_export_part_source(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;i jsonb;s crest_private.export_job_snapshots;f jsonb;n integer;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 8192 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 r:=original::jsonb;i:=r->'intent';
 IF NOT crest_private.export_json_object(r,ARRAY['claim','generationId','planSha256','partId','intent']) OR NOT crest_private.source_export_claim_matches(r->'claim',j)
 OR NOT crest_private.export_json_uuid(r->'generationId') OR NOT crest_private.export_json_uuid(r->'partId') OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR coalesce(r->>'planSha256','')!~'^[a-f0-9]{64}$'
 OR NOT crest_private.export_json_object(i,ARRAY['formatVersion','objectKey','keyId','plaintextBytes','plaintextSha256','ciphertextBytes','ciphertextSha256']) OR i->'formatVersion' IS DISTINCT FROM '1'::jsonb
 OR i->'objectKey' IS DISTINCT FROM to_jsonb('exports/'||j.business_id::text||'/'||j.id::text||'/'||(r->>'generationId')||'/'||(r->>'partId')||'.jwe')
 OR jsonb_typeof(i->'keyId') IS DISTINCT FROM 'string' OR coalesce(i->>'keyId','')!~'^[A-Za-z0-9_-]{1,100}$'
 OR jsonb_typeof(i->'plaintextBytes') IS DISTINCT FROM 'number' OR coalesce(i->>'plaintextBytes','')!~'^[1-9][0-9]{0,6}$' OR (i->>'plaintextBytes')::bigint>8388608
 OR jsonb_typeof(i->'ciphertextBytes') IS DISTINCT FROM 'number' OR coalesce(i->>'ciphertextBytes','')!~'^[1-9][0-9]{0,7}$' OR (i->>'ciphertextBytes')::bigint>16777216
 OR jsonb_typeof(i->'plaintextSha256') IS DISTINCT FROM 'string' OR coalesce(i->>'plaintextSha256','')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(i->'ciphertextSha256') IS DISTINCT FROM 'string' OR coalesce(i->>'ciphertextSha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 SELECT * INTO s FROM crest_private.export_job_snapshots WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND export_job_id=j.id AND lease_id=j.lease_id AND actor_id=j.actor_id AND recovery_epoch=j.recovery_epoch AND plan_sha256=r->>'planSha256';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_PART_SNAPSHOT_REQUIRED';END IF;
 SELECT value,ordinality::integer INTO f,n FROM jsonb_array_elements(s.request_text::jsonb->'plan'->'parts') WITH ORDINALITY WHERE value->'partId'=r->'partId';
 IF NOT FOUND OR i->'plaintextBytes' IS DISTINCT FROM f->'bytes' OR i->'plaintextSha256' IS DISTINCT FROM f->'sha256' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 RETURN jsonb_build_object('request',r,'file',f,'ordinal',n);
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';
END $$;
CREATE FUNCTION crest_private.guard_source_export_part() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j crest_private.export_jobs;v jsonb;r jsonb;i jsonb;f jsonb;recorded crest_private.export_part_intents;stamp timestamptz:=clock_timestamp();n integer;
BEGIN
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=NEW.business_id AND id=NEW.export_job_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'Running' OR j.lease_id IS DISTINCT FROM NEW.lease_id OR j.actor_id IS DISTINCT FROM NEW.actor_id OR j.recovery_epoch IS DISTINCT FROM NEW.recovery_epoch OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_SOURCE_REQUIRED';END IF;
 v:=crest_private.source_export_part_source(NEW.request_text,j);r:=v->'request';i:=r->'intent';f:=v->'file';n:=(v->>'ordinal')::integer;
 IF NEW.generation_id IS DISTINCT FROM (r->>'generationId')::uuid OR NEW.part_id IS DISTINCT FROM (r->>'partId')::uuid OR NEW.plan_sha256 IS DISTINCT FROM r->>'planSha256' OR NEW.operation_id IS DISTINCT FROM j.operation_id OR NEW.created_by IS DISTINCT FROM j.actor_id OR NEW.origin IS DISTINCT FROM 'manual' OR NEW.import_row_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_SOURCE_REQUIRED';END IF;
 IF TG_TABLE_NAME='export_part_intents' THEN
  IF ROW(NEW.ordinal,NEW.file_name,NEW.content_type,NEW.object_key,NEW.key_id,NEW.plaintext_bytes,NEW.plaintext_sha256,NEW.ciphertext_bytes,NEW.ciphertext_sha256) IS DISTINCT FROM ROW(n,f->>'fileName',f->>'contentType',i->>'objectKey',i->>'keyId',(i->>'plaintextBytes')::integer,i->>'plaintextSha256',(i->>'ciphertextBytes')::integer,i->>'ciphertextSha256') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_SOURCE_REQUIRED';END IF;
  IF n<>(SELECT count(*)+1 FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=NEW.generation_id) OR EXISTS(SELECT 1 FROM crest_private.export_part_intents x WHERE x.business_id=j.business_id AND x.generation_id=NEW.generation_id AND NOT EXISTS(SELECT 1 FROM crest_private.export_part_verifications y WHERE y.business_id=x.business_id AND y.generation_id=x.generation_id AND y.part_id=x.part_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED';END IF;
 ELSE
  SELECT * INTO recorded FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=NEW.generation_id AND part_id=NEW.part_id;
  IF NOT FOUND OR recorded.request_text IS DISTINCT FROM NEW.request_text OR recorded.request_sha256 IS DISTINCT FROM NEW.request_sha256 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ORIGINAL_REQUIRED';END IF;
  IF n<>(SELECT count(*)+1 FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=NEW.generation_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_PREVIOUS_UNVERIFIED';END IF;
 END IF;
 stamp:=clock_timestamp();IF TG_TABLE_NAME='export_part_verifications' THEN NEW.verified_at:=stamp;END IF;NEW.created_at:=stamp;RETURN NEW;
END $$;
CREATE TRIGGER export_intent_guard BEFORE INSERT ON crest_private.export_part_intents FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_part();
CREATE TRIGGER export_verification_guard BEFORE INSERT ON crest_private.export_part_verifications FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_part();

CREATE FUNCTION crest_commands.record_source_export_part(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text,stage text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;i jsonb;v jsonb;f jsonb;j crest_private.export_jobs;recorded record;digest text;n integer;
BEGIN
 IF stage IS NULL OR stage NOT IN('intent','verified') OR original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 8192 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 r:=original::jsonb;
 IF NOT crest_private.export_json_uuid(r->'claim'->'exportJobId') OR NOT crest_private.export_json_uuid(r->'claim'->'leaseId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_PART_INPUT_REQUIRED';END IF;
 j:=crest_private.lock_source_export_live_job(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,(r->'claim'->>'exportJobId')::uuid,(r->'claim'->>'leaseId')::uuid);
 v:=crest_private.source_export_part_source(original,j);r:=v->'request';i:=r->'intent';f:=v->'file';n:=(v->>'ordinal')::integer;digest:=encode(sha256(convert_to(original,'UTF8')),'hex');
 IF stage='intent' THEN
  SELECT request_text,request_sha256 INTO recorded FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND part_id=(r->>'partId')::uuid;
  IF FOUND THEN
   IF recorded.request_text IS DISTINCT FROM original OR recorded.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ALREADY_FROZEN';END IF;
  ELSE
   INSERT INTO crest_private.export_part_intents(business_id,generation_id,part_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,ordinal,file_name,content_type,object_key,key_id,plaintext_bytes,plaintext_sha256,ciphertext_bytes,ciphertext_sha256,request_sha256,request_text,created_by,origin,operation_id) VALUES(j.business_id,(r->>'generationId')::uuid,(r->>'partId')::uuid,j.id,j.lease_id,j.actor_id,j.recovery_epoch,r->>'planSha256',n,f->>'fileName',f->>'contentType',i->>'objectKey',i->>'keyId',(i->>'plaintextBytes')::integer,i->>'plaintextSha256',(i->>'ciphertextBytes')::integer,i->>'ciphertextSha256',digest,original,j.actor_id,'manual',j.operation_id);
  END IF;
 ELSE
  SELECT request_text,request_sha256 INTO recorded FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND part_id=(r->>'partId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_INTENT_REQUIRED';END IF;
  IF recorded.request_text IS DISTINCT FROM original OR recorded.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ORIGINAL_REQUIRED';END IF;
  SELECT request_text,request_sha256 INTO recorded FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=(r->>'generationId')::uuid AND part_id=(r->>'partId')::uuid;
  IF FOUND THEN
   IF recorded.request_text IS DISTINCT FROM original OR recorded.request_sha256 IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_PART_ORIGINAL_REQUIRED';END IF;
  ELSE
   INSERT INTO crest_private.export_part_verifications(business_id,generation_id,part_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,request_sha256,request_text,created_by,origin,operation_id) VALUES(j.business_id,(r->>'generationId')::uuid,(r->>'partId')::uuid,j.id,j.lease_id,j.actor_id,j.recovery_epoch,r->>'planSha256',digest,original,j.actor_id,'manual',j.operation_id);
  END IF;
 END IF;
 PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 IF j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 RETURN jsonb_build_object('formatVersion',1,'stage',stage,'requestSha256',digest);
END $$;
CREATE FUNCTION crest_commands.record_source_export_part_intent(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.record_source_export_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'intent') $$;
CREATE FUNCTION crest_commands.record_source_export_part_verified(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_commands.record_source_export_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'verified') $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_part_intent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_part_verified(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_part_source(text,crest_private.export_jobs),crest_private.guard_source_export_part(),crest_commands.record_source_export_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text),crest_commands.record_source_export_part_intent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text),crest_commands.record_source_export_part_verified(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_part_source(text,crest_private.export_jobs),crest_private.guard_source_export_part(),crest_commands.record_source_export_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.record_source_export_part_intent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text),crest_commands.record_source_export_part_verified(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text) TO crest_web;

-- Retained proposal 4/7: planning/proposals/source-export-ready.sql SHA256 ef1a3b68a4c6391e683ebf4d41dffb74561c00433e3d9ba6abaa32a228b56025
-- UNREGISTERED forward43 continuation; apply after jobs, snapshots and parts.
-- Historical Ready attestation only. No browser route or download capability.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.export_job_completions(
 business_id uuid NOT NULL,generation_id uuid NOT NULL,export_job_id uuid NOT NULL,
 lease_id uuid NOT NULL,actor_id uuid NOT NULL,recovery_epoch uuid NOT NULL,
 plan_sha256 text NOT NULL CHECK(plan_sha256~'^[a-f0-9]{64}$'),
 expected_version bigint NOT NULL CHECK(expected_version>0),
 request_sha256 text NOT NULL CHECK(request_sha256~'^[a-f0-9]{64}$'),
 request_text text NOT NULL CHECK(octet_length(request_text) BETWEEN 1 AND 12582912),
 file_count integer NOT NULL CHECK(file_count BETWEEN 2 AND 1024),
 total_bytes integer NOT NULL CHECK(total_bytes BETWEEN 2 AND 67108864),
 manifest_sha256 text NOT NULL CHECK(manifest_sha256~'^[a-f0-9]{64}$'),
 completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,origin text NOT NULL CHECK(origin='manual'),
 operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 PRIMARY KEY(business_id,generation_id),UNIQUE(business_id,export_job_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,generation_id) REFERENCES crest_private.export_job_snapshots(business_id,generation_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,export_job_id,lease_id) REFERENCES crest_private.export_job_attempts(business_id,export_job_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(created_by=actor_id AND isfinite(completed_at) AND created_at=completed_at AND expires_at=completed_at+interval '168 hours'),
 CHECK(request_sha256=encode(sha256(convert_to(request_text,'UTF8')),'hex'))
);
CREATE INDEX export_completions_operation ON crest_private.export_job_completions(business_id,operation_id,created_by);
CREATE INDEX export_completions_lease ON crest_private.export_job_completions(business_id,export_job_id,lease_id);
CREATE INDEX export_completions_cursor ON crest_private.export_job_completions(business_id,completed_at,generation_id);
ALTER TABLE crest_private.export_job_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.export_job_completions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.export_job_completions TO crest_command_owner;
CREATE POLICY export_completion_read ON crest_private.export_job_completions FOR SELECT TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY export_completion_insert ON crest_private.export_job_completions FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE TRIGGER export_completion_retained BEFORE UPDATE OR DELETE ON crest_private.export_job_completions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER export_completion_truncate BEFORE TRUNCATE ON crest_private.export_job_completions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.source_export_ready_command(business uuid,epoch uuid,operation uuid,job uuid,expected_version text,lease uuid,generation uuid,request_sha text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',business,'commandType','export.ready','reference',jsonb_build_object('operationId',operation,'recoveryEpoch',epoch,'exportJobId',job,'expectedVersion',expected_version,'leaseId',lease,'generationId',generation,'requestSha256',request_sha))
$$;
CREATE FUNCTION crest_private.source_export_ready_source(original text,j crest_private.export_jobs) RETURNS crest_private.export_job_snapshots LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;s crest_private.export_job_snapshots;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 12582912 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_READY_INPUT_REQUIRED';END IF;
 r:=original::jsonb;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256','parts']) OR NOT crest_private.export_json_uuid(r->'plan'->'generationId') OR NOT crest_private.source_export_claim_matches(r->'plan'->'claim',j) OR jsonb_typeof(r->'parts') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_READY_INPUT_REQUIRED';END IF;
 SELECT * INTO s FROM crest_private.export_job_snapshots WHERE business_id=j.business_id AND export_job_id=j.id AND lease_id=j.lease_id AND generation_id=(r->'plan'->>'generationId')::uuid;
 IF NOT FOUND OR r->'planSha256' IS DISTINCT FROM to_jsonb(s.plan_sha256) OR (original::json->'plan')::text IS DISTINCT FROM (s.request_text::json->'plan')::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_ORIGINAL_PLAN_REQUIRED';END IF;
 IF jsonb_array_length(r->'parts')<>s.file_count OR (SELECT count(*) FROM crest_private.export_part_intents WHERE business_id=j.business_id AND generation_id=s.generation_id)<>s.file_count OR (SELECT count(*) FROM crest_private.export_part_verifications WHERE business_id=j.business_id AND generation_id=s.generation_id)<>s.file_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_COMPLETE_VERIFICATION_REQUIRED';END IF;
 -- Compare original JSON substrings, not jsonb reserialization or just counts.
 IF EXISTS(
  SELECT 1 FROM json_array_elements(original::json->'parts') WITH ORDINALITY AS p(value,n)
  LEFT JOIN crest_private.export_part_intents i ON i.business_id=j.business_id AND i.generation_id=s.generation_id AND i.ordinal=p.n
  LEFT JOIN crest_private.export_part_verifications v ON v.business_id=i.business_id AND v.generation_id=i.generation_id AND v.part_id=i.part_id
  WHERE i.part_id IS NULL OR v.part_id IS NULL OR p.value::text IS DISTINCT FROM i.request_text OR i.request_text IS DISTINCT FROM v.request_text OR i.request_sha256 IS DISTINCT FROM v.request_sha256
   OR ROW(i.export_job_id,i.lease_id,i.actor_id,i.recovery_epoch,i.plan_sha256) IS DISTINCT FROM ROW(j.id,j.lease_id,j.actor_id,j.recovery_epoch,s.plan_sha256)
   OR ROW(v.export_job_id,v.lease_id,v.actor_id,v.recovery_epoch,v.plan_sha256) IS DISTINCT FROM ROW(j.id,j.lease_id,j.actor_id,j.recovery_epoch,s.plan_sha256)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_ORIGINAL_PARTS_REQUIRED';END IF;
 RETURN s;
END $$;
CREATE FUNCTION crest_private.guard_source_export_completion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j crest_private.export_jobs;s crest_private.export_job_snapshots;stamp timestamptz;
BEGIN
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=NEW.business_id AND id=NEW.export_job_id FOR UPDATE;
 IF NOT FOUND OR j.state<>'Running' OR j.lease_id IS DISTINCT FROM NEW.lease_id OR j.actor_id IS DISTINCT FROM NEW.actor_id OR j.recovery_epoch IS DISTINCT FROM NEW.recovery_epoch OR j.version IS DISTINCT FROM NEW.expected_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_SOURCE_REQUIRED';END IF;
 s:=crest_private.source_export_ready_source(NEW.request_text,j);
 IF ROW(NEW.generation_id,NEW.plan_sha256,NEW.file_count,NEW.total_bytes,NEW.manifest_sha256,NEW.created_by,NEW.origin) IS DISTINCT FROM ROW(s.generation_id,s.plan_sha256,s.file_count,s.total_bytes,s.manifest_sha256,j.actor_id,'manual'::text) OR NEW.import_row_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=j.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=j.actor_id AND o.recovery_epoch=j.recovery_epoch AND o.command_type='export.ready' AND o.schema_version=1 AND o.state='pending' AND o.payload_hash=encode(sha256(convert_to(crest_private.source_export_ready_command(j.business_id,j.recovery_epoch,NEW.operation_id,j.id,j.version::text,j.lease_id,s.generation_id,NEW.request_sha256)::text,'UTF8')),'hex')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_SOURCE_REQUIRED';END IF;
 stamp:=clock_timestamp();IF j.lease_until<=stamp THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
 NEW.completed_at:=stamp;NEW.created_at:=stamp;NEW.expires_at:=stamp+interval '168 hours';RETURN NEW;
END $$;
CREATE TRIGGER export_completion_guard BEFORE INSERT ON crest_private.export_job_completions FOR EACH ROW EXECUTE FUNCTION crest_private.guard_source_export_completion();
CREATE FUNCTION crest_private.check_source_export_completion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.export_jobs j JOIN crest_private.operations o ON o.business_id=j.business_id AND o.operation_id=j.operation_id AND o.actor_id=j.updated_by WHERE j.business_id=NEW.business_id AND j.id=NEW.export_job_id AND j.state='Ready' AND j.version=NEW.expected_version+1 AND j.operation_id=NEW.operation_id AND j.actor_id=NEW.actor_id AND j.updated_by=NEW.actor_id AND j.recovery_epoch=NEW.recovery_epoch AND o.command_type='export.ready' AND o.state='committed' AND o.result->'job'=crest_private.source_export_job_projection(j)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_COMPLETION_REQUIRED';END IF;
 PERFORM crest_private.source_export_receipt(NEW.business_id,NEW.actor_id,NEW.operation_id);RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER export_completion_consistency AFTER INSERT ON crest_private.export_job_completions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_source_export_completion();

CREATE FUNCTION crest_commands.record_source_export_ready(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,expected_version bigint,original text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r jsonb;j crest_private.export_jobs;s crest_private.export_job_snapshots;c crest_private.export_job_completions;o crest_private.operations;job uuid;lease uuid;generation uuid;request_sha text;command jsonb;digest text;claimed uuid;before_state jsonb;after_state jsonb;event uuid;receipt jsonb;
BEGIN
 IF operation IS NULL OR expected_version IS NULL OR expected_version<1 OR original IS NULL OR octet_length(original) NOT BETWEEN 1 AND 12582912 OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_READY_INPUT_REQUIRED';END IF;
 r:=original::jsonb;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256','parts']) OR NOT crest_private.export_json_uuid(r->'plan'->'claim'->'exportJobId') OR NOT crest_private.export_json_uuid(r->'plan'->'claim'->'leaseId') OR NOT crest_private.export_json_uuid(r->'plan'->'generationId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_READY_INPUT_REQUIRED';END IF;
 job:=(r->'plan'->'claim'->>'exportJobId')::uuid;lease:=(r->'plan'->'claim'->>'leaseId')::uuid;generation:=(r->'plan'->>'generationId')::uuid;request_sha:=encode(sha256(convert_to(original,'UTF8')),'hex');
 command:=crest_private.source_export_ready_command(requested_business,expected_epoch,operation,job,expected_version::text,lease,generation,request_sha);digest:=encode(sha256(convert_to(command::text,'UTF8')),'hex');
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',operation::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,'export.ready',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=operation;
  PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
  IF NOT FOUND OR o.actor_id IS DISTINCT FROM expected_actor OR o.command_type IS DISTINCT FROM 'export.ready' OR o.recovery_epoch IS DISTINCT FROM expected_epoch OR o.payload_hash IS DISTINCT FROM digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_ORIGINAL_REQUIRED';END IF;
  SELECT * INTO c FROM crest_private.export_job_completions WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
  IF NOT FOUND OR c.request_text IS DISTINCT FROM original OR c.request_sha256 IS DISTINCT FROM request_sha THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_ORIGINAL_REQUIRED';END IF;
  -- Historical acknowledgment after commit. This is not a new live lease,
  -- refreshed expiry, or permission to download any bytes.
  receipt:=crest_private.source_export_receipt(requested_business,expected_actor,operation);
 ELSE
  j:=crest_private.lock_source_export_live_job(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,job,lease);
  PERFORM set_config('crest.operation_id',operation::text,true);
  IF j.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_VERSION_REQUIRED';END IF;
  s:=crest_private.source_export_ready_source(original,j);before_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.export_job_completions(business_id,generation_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,expected_version,request_sha256,request_text,file_count,total_bytes,manifest_sha256,expires_at,created_by,origin,operation_id) VALUES(j.business_id,s.generation_id,j.id,j.lease_id,j.actor_id,j.recovery_epoch,s.plan_sha256,j.version,request_sha,original,s.file_count,s.total_bytes,s.manifest_sha256,clock_timestamp(),j.actor_id,'manual',operation);
  UPDATE crest_private.export_jobs SET state='Ready',lease_id=NULL,lease_until=NULL,failure_code=NULL,version=version+1,updated_by=expected_actor,operation_id=operation WHERE business_id=requested_business AND id=job RETURNING crest_private.source_export_job_projection(export_jobs) INTO after_state;
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,operation,expected_actor,expected_actor,'export_jobs',job,expected_version+1,'ready',jsonb_build_object('schemaVersion',1,'before',before_state,'after',after_state),'manual') RETURNING id INTO event;
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'command',command,'job',after_state,'auditEventId',event) WHERE business_id=requested_business AND operation_id=operation;
  PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
  IF j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_LIVE_LEASE_REQUIRED';END IF;
  receipt:=crest_private.source_export_receipt(requested_business,expected_actor,operation);
 END IF;
 IF receipt->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_READY_COMPLETION_REQUIRED';END IF;
 RETURN jsonb_build_object('formatVersion',1,'stage','ready','requestSha256',request_sha);
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_command_owner;
ALTER FUNCTION crest_private.check_source_export_completion() OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_ready(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_ready_command(uuid,uuid,uuid,uuid,text,uuid,uuid,text),crest_private.source_export_ready_source(text,crest_private.export_jobs),crest_private.guard_source_export_completion(),crest_private.check_source_export_completion(),crest_commands.record_source_export_ready(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_ready_command(uuid,uuid,uuid,uuid,text,uuid,uuid,text),crest_private.source_export_ready_source(text,crest_private.export_jobs),crest_private.guard_source_export_completion() TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.record_source_export_ready(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,text) TO crest_web;

-- Retained proposal 5/7: planning/proposals/source-export-journal-reads.sql SHA256 c9c6da59574540594d8a1e559f1405e2a094908bbcad3b0e0e6a6ba534d731dc
-- UNREGISTERED forward43; apply after jobs, snapshots, parts and ready.
-- Fixed internal export-role reads only. No owner route, dispatch or adoption.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_export','crest_export_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN('crest_export'::regrole,'crest_export_owner'::regrole) OR roleid='crest_export_owner'::regrole) OR has_schema_privilege('crest_export','crest_commands','CREATE') OR has_schema_privilege('crest_export_owner','crest_commands','CREATE') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_jobs'::regclass AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest_private.export_jobs'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','actor_id','profile','app_release_id','source_schema_version','recovery_epoch','request_operation_id','state','attempt_count','lease_id','lease_until','next_run_at','failure_code','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR has_any_column_privilege('crest_export','crest_private.export_jobs','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export','crest_private.export_jobs','DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege('crest_export_owner','crest_private.export_jobs','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner','crest_private.export_jobs','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_job_attempts'::regclass AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest_private.export_job_attempts'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','export_job_id','attempt_no','recovery_epoch','leased_at','lease_until','created_at','created_by','origin','operation_id','import_row_id'] OR has_any_column_privilege('crest_export','crest_private.export_job_attempts','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export','crest_private.export_job_attempts','DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege('crest_export_owner','crest_private.export_job_attempts','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner','crest_private.export_job_attempts','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_job_snapshots'::regclass AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest_private.export_job_snapshots'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['generation_id','business_id','export_job_id','lease_id','actor_id','recovery_epoch','app_release_id','source_schema_version','observed_at','plan_sha256','request_sha256','request_text','file_count','total_bytes','manifest_sha256','created_at','created_by','origin','operation_id','import_row_id'] OR has_any_column_privilege('crest_export','crest_private.export_job_snapshots','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export','crest_private.export_job_snapshots','DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege('crest_export_owner','crest_private.export_job_snapshots','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner','crest_private.export_job_snapshots','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_part_intents'::regclass AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest_private.export_part_intents'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','ordinal','file_name','content_type','object_key','key_id','plaintext_bytes','plaintext_sha256','ciphertext_bytes','ciphertext_sha256','request_sha256','request_text','created_at','created_by','origin','operation_id','import_row_id'] OR has_any_column_privilege('crest_export','crest_private.export_part_intents','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export','crest_private.export_part_intents','DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege('crest_export_owner','crest_private.export_part_intents','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner','crest_private.export_part_intents','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_part_verifications'::regclass AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest_private.export_part_verifications'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['business_id','generation_id','part_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','request_sha256','request_text','verified_at','created_at','created_by','origin','operation_id','import_row_id'] OR has_any_column_privilege('crest_export','crest_private.export_part_verifications','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export','crest_private.export_part_verifications','DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege('crest_export_owner','crest_private.export_part_verifications','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner','crest_private.export_part_verifications','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_job_completions'::regclass AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest_private.export_job_completions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['business_id','generation_id','export_job_id','lease_id','actor_id','recovery_epoch','plan_sha256','expected_version','request_sha256','request_text','file_count','total_bytes','manifest_sha256','completed_at','expires_at','created_at','created_by','origin','operation_id','import_row_id'] OR has_any_column_privilege('crest_export','crest_private.export_job_completions','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export','crest_private.export_job_completions','DELETE,TRUNCATE,TRIGGER,MAINTAIN') OR has_any_column_privilege('crest_export_owner','crest_private.export_job_completions','SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner','crest_private.export_job_completions','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_JOURNAL_EXPORT_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
GRANT SELECT(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,attempt_count,lease_id,lease_until,next_run_at,failure_code,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest_private.export_jobs TO crest_export_owner;
GRANT SELECT(id,business_id,export_job_id,attempt_no,recovery_epoch,leased_at,lease_until,created_at,created_by,origin,operation_id,import_row_id) ON crest_private.export_job_attempts TO crest_export_owner;
GRANT SELECT(generation_id,business_id,export_job_id,lease_id,actor_id,recovery_epoch,app_release_id,source_schema_version,observed_at,plan_sha256,request_sha256,request_text,file_count,total_bytes,manifest_sha256,created_at,created_by,origin,operation_id,import_row_id) ON crest_private.export_job_snapshots TO crest_export_owner;
GRANT SELECT(business_id,generation_id,part_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,ordinal,file_name,content_type,object_key,key_id,plaintext_bytes,plaintext_sha256,ciphertext_bytes,ciphertext_sha256,request_sha256,request_text,created_at,created_by,origin,operation_id,import_row_id) ON crest_private.export_part_intents TO crest_export_owner;
GRANT SELECT(business_id,generation_id,part_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,request_sha256,request_text,verified_at,created_at,created_by,origin,operation_id,import_row_id) ON crest_private.export_part_verifications TO crest_export_owner;
GRANT SELECT(business_id,generation_id,export_job_id,lease_id,actor_id,recovery_epoch,plan_sha256,expected_version,request_sha256,request_text,file_count,total_bytes,manifest_sha256,completed_at,expires_at,created_at,created_by,origin,operation_id,import_row_id) ON crest_private.export_job_completions TO crest_export_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY journal_export_job ON crest_private.export_jobs FOR SELECT TO crest_export_owner USING(true);
CREATE POLICY journal_export_attempt ON crest_private.export_job_attempts FOR SELECT TO crest_export_owner USING(true);
CREATE POLICY journal_export_snapshot ON crest_private.export_job_snapshots FOR SELECT TO crest_export_owner USING(true);
CREATE POLICY journal_export_intent ON crest_private.export_part_intents FOR SELECT TO crest_export_owner USING(true);
CREATE POLICY journal_export_verification ON crest_private.export_part_verifications FOR SELECT TO crest_export_owner USING(true);
CREATE POLICY journal_export_completion ON crest_private.export_job_completions FOR SELECT TO crest_export_owner USING(true);
CREATE FUNCTION crest_private.source_export_journal_token(expected_business uuid) RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE snap text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_JOURNAL_EXPORT_SNAPSHOT_REQUIRED';END IF;
 IF expected_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.business_configuration_export_context(expected_business);
 snap:=pg_current_snapshot()::text;
 IF octet_length(snap)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_JOURNAL_EXPORT_BUDGET_REQUIRED';END IF;
 -- This new protocol additionally pins the owning backend and transaction.
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.source-export.journal.snapshot/1',expected_business,pg_backend_pid(),transaction_timestamp(),snap)::text,'UTF8')),'hex');
END $$;
CREATE FUNCTION crest_commands.source_export_journal_context(expected_business uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE token text;
BEGIN
 token:=crest_private.source_export_journal_token(expected_business);
 RETURN jsonb_build_object('schemaVersion',1,'scope','source_export_journal','businessId',expected_business,'snapshotToken',token,'observedAt',statement_timestamp(),'recordCounts',jsonb_build_object(
'job',(SELECT count(*)::text FROM crest_private.export_jobs WHERE business_id=expected_business),'attempt',(SELECT count(*)::text FROM crest_private.export_job_attempts WHERE business_id=expected_business),'snapshot',(SELECT count(*)::text FROM crest_private.export_job_snapshots WHERE business_id=expected_business),'intent',(SELECT count(*)::text FROM crest_private.export_part_intents WHERE business_id=expected_business),'verification',(SELECT count(*)::text FROM crest_private.export_part_verifications WHERE business_id=expected_business),'completion',(SELECT count(*)::text FROM crest_private.export_job_completions WHERE business_id=expected_business)),'originalTextBytes',((SELECT coalesce(sum(octet_length(request_text)),0) FROM crest_private.export_job_snapshots WHERE business_id=expected_business)+(SELECT coalesce(sum(octet_length(request_text)),0) FROM crest_private.export_part_intents WHERE business_id=expected_business)+(SELECT coalesce(sum(octet_length(request_text)),0) FROM crest_private.export_part_verifications WHERE business_id=expected_business)+(SELECT coalesce(sum(octet_length(request_text)),0) FROM crest_private.export_job_completions WHERE business_id=expected_business))::text);
END $$;
CREATE FUNCTION crest_commands.source_export_journal_page(expected_business uuid,expected_snapshot text,record_kind text,after_key text,requested_page_size integer) RETURNS TABLE(record_key text,canonical_evidence text,evidence_hash text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE token text;source_cursor refcursor;item record;body text;descriptor jsonb;size integer;limit_bytes integer;total integer:=0;
BEGIN
 token:=crest_private.source_export_journal_token(expected_business);
 IF expected_snapshot IS NULL OR expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_SNAPSHOT_MISMATCH';END IF;
 IF record_kind IS NULL OR record_kind NOT IN('job','attempt','snapshot','intent','verification','completion') OR requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 OR after_key IS NOT NULL AND after_key!~(CASE WHEN record_kind IN('intent','verification') THEN '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' ELSE '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' END) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_INPUT_REQUIRED';END IF;
 CASE record_kind
 WHEN 'job' THEN OPEN source_cursor FOR SELECT t.id::text AS key,jsonb_build_object('id',t.id,'business_id',t.business_id,'actor_id',t.actor_id,'profile',t.profile,'app_release_id',t.app_release_id,'source_schema_version',t.source_schema_version,'recovery_epoch',t.recovery_epoch,'request_operation_id',t.request_operation_id,'state',t.state,'attempt_count',t.attempt_count,'lease_id',t.lease_id,'lease_until',to_char(t.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'next_run_at',to_char(t.next_run_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'failure_code',t.failure_code,'version',t.version::text,'created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS metadata,NULL::text AS original,NULL::text AS digest FROM crest_private.export_jobs t WHERE t.business_id=expected_business AND (after_key IS NULL OR t.id>after_key::uuid) ORDER BY t.id LIMIT requested_page_size;
 WHEN 'attempt' THEN OPEN source_cursor FOR SELECT t.id::text AS key,jsonb_build_object('id',t.id,'business_id',t.business_id,'export_job_id',t.export_job_id,'attempt_no',t.attempt_no,'recovery_epoch',t.recovery_epoch,'leased_at',to_char(t.leased_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lease_until',to_char(t.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS metadata,NULL::text AS original,NULL::text AS digest FROM crest_private.export_job_attempts t WHERE t.business_id=expected_business AND (after_key IS NULL OR t.id>after_key::uuid) ORDER BY t.id LIMIT requested_page_size;
 WHEN 'snapshot' THEN OPEN source_cursor FOR SELECT t.generation_id::text AS key,jsonb_build_object('generation_id',t.generation_id,'business_id',t.business_id,'export_job_id',t.export_job_id,'lease_id',t.lease_id,'actor_id',t.actor_id,'recovery_epoch',t.recovery_epoch,'app_release_id',t.app_release_id,'source_schema_version',t.source_schema_version,'observed_at',to_char(t.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'plan_sha256',t.plan_sha256,'request_sha256',t.request_sha256,'file_count',t.file_count,'total_bytes',t.total_bytes,'manifest_sha256',t.manifest_sha256,'created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS metadata,t.request_text AS original,t.request_sha256 AS digest FROM crest_private.export_job_snapshots t WHERE t.business_id=expected_business AND (after_key IS NULL OR t.generation_id>after_key::uuid) ORDER BY t.generation_id LIMIT requested_page_size;
 WHEN 'intent' THEN OPEN source_cursor FOR SELECT t.generation_id::text||':'||t.part_id::text AS key,jsonb_build_object('business_id',t.business_id,'generation_id',t.generation_id,'part_id',t.part_id,'export_job_id',t.export_job_id,'lease_id',t.lease_id,'actor_id',t.actor_id,'recovery_epoch',t.recovery_epoch,'plan_sha256',t.plan_sha256,'ordinal',t.ordinal,'file_name',t.file_name,'content_type',t.content_type,'object_key',t.object_key,'key_id',t.key_id,'plaintext_bytes',t.plaintext_bytes,'plaintext_sha256',t.plaintext_sha256,'ciphertext_bytes',t.ciphertext_bytes,'ciphertext_sha256',t.ciphertext_sha256,'request_sha256',t.request_sha256,'created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS metadata,t.request_text AS original,t.request_sha256 AS digest FROM crest_private.export_part_intents t WHERE t.business_id=expected_business AND (after_key IS NULL OR (t.generation_id,t.part_id)>(split_part(after_key,':',1)::uuid,split_part(after_key,':',2)::uuid)) ORDER BY t.generation_id,t.part_id LIMIT requested_page_size;
 WHEN 'verification' THEN OPEN source_cursor FOR SELECT t.generation_id::text||':'||t.part_id::text AS key,jsonb_build_object('business_id',t.business_id,'generation_id',t.generation_id,'part_id',t.part_id,'export_job_id',t.export_job_id,'lease_id',t.lease_id,'actor_id',t.actor_id,'recovery_epoch',t.recovery_epoch,'plan_sha256',t.plan_sha256,'request_sha256',t.request_sha256,'verified_at',to_char(t.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS metadata,t.request_text AS original,t.request_sha256 AS digest FROM crest_private.export_part_verifications t WHERE t.business_id=expected_business AND (after_key IS NULL OR (t.generation_id,t.part_id)>(split_part(after_key,':',1)::uuid,split_part(after_key,':',2)::uuid)) ORDER BY t.generation_id,t.part_id LIMIT requested_page_size;
 WHEN 'completion' THEN OPEN source_cursor FOR SELECT t.generation_id::text AS key,jsonb_build_object('business_id',t.business_id,'generation_id',t.generation_id,'export_job_id',t.export_job_id,'lease_id',t.lease_id,'actor_id',t.actor_id,'recovery_epoch',t.recovery_epoch,'plan_sha256',t.plan_sha256,'expected_version',t.expected_version::text,'request_sha256',t.request_sha256,'file_count',t.file_count,'total_bytes',t.total_bytes,'manifest_sha256',t.manifest_sha256,'completed_at',to_char(t.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expires_at',to_char(t.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS metadata,t.request_text AS original,t.request_sha256 AS digest FROM crest_private.export_job_completions t WHERE t.business_id=expected_business AND (after_key IS NULL OR t.generation_id>after_key::uuid) ORDER BY t.generation_id LIMIT requested_page_size;
 END CASE;
 LOOP
  FETCH source_cursor INTO item;EXIT WHEN NOT FOUND;descriptor:=NULL;
  IF item.original IS NOT NULL THEN
   size:=octet_length(item.original);limit_bytes:=CASE record_kind WHEN 'snapshot' THEN 1048576 WHEN 'completion' THEN 12582912 ELSE 8192 END;
   IF size NOT BETWEEN 1 AND limit_bytes OR item.digest IS DISTINCT FROM encode(sha256(convert_to(item.original,'UTF8')),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOURNAL_EXPORT_ORIGINAL_REVIEW_REQUIRED';END IF;
   descriptor:=jsonb_build_object('column','request_text','bytes',size,'sha256',item.digest,'chunkBytes',524288,'chunks',(size+524287)/524288);
  END IF;
  body:=jsonb_build_object('schemaVersion',1,'scope','source_export_journal','kind',record_kind,'businessId',expected_business,'recordKey',item.key,'row',item.metadata,'originalText',descriptor)::text;
  IF octet_length(body)>8192 OR total+octet_length(body)>163840 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_JOURNAL_EXPORT_BUDGET_REQUIRED';END IF;
  total:=total+octet_length(body);record_key:=item.key;canonical_evidence:=body;evidence_hash:=encode(sha256(convert_to(body,'UTF8')),'hex');RETURN NEXT;
 END LOOP;CLOSE source_cursor;
END $$;
CREATE FUNCTION crest_commands.source_export_journal_text_chunk(expected_business uuid,expected_snapshot text,record_kind text,requested_key text,chunk_index integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $$
DECLARE token text;original text;digest text;raw bytea;piece bytea;size integer;count integer;limit_bytes integer;
BEGIN
 token:=crest_private.source_export_journal_token(expected_business);
 IF expected_snapshot IS NULL OR expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_SNAPSHOT_MISMATCH';END IF;
 IF record_kind IS NULL OR record_kind NOT IN('snapshot','intent','verification','completion') OR requested_key IS NULL OR requested_key!~(CASE WHEN record_kind IN('intent','verification') THEN '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}:[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' ELSE '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' END) OR chunk_index IS NULL OR chunk_index NOT BETWEEN 0 AND 23 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_INPUT_REQUIRED';END IF;
 CASE record_kind
 WHEN 'snapshot' THEN SELECT t.request_text,t.request_sha256 INTO original,digest FROM crest_private.export_job_snapshots t WHERE t.business_id=expected_business AND t.generation_id=requested_key::uuid;
 WHEN 'intent' THEN SELECT t.request_text,t.request_sha256 INTO original,digest FROM crest_private.export_part_intents t WHERE t.business_id=expected_business AND t.generation_id=split_part(requested_key,':',1)::uuid AND t.part_id=split_part(requested_key,':',2)::uuid;
 WHEN 'verification' THEN SELECT t.request_text,t.request_sha256 INTO original,digest FROM crest_private.export_part_verifications t WHERE t.business_id=expected_business AND t.generation_id=split_part(requested_key,':',1)::uuid AND t.part_id=split_part(requested_key,':',2)::uuid;
 WHEN 'completion' THEN SELECT t.request_text,t.request_sha256 INTO original,digest FROM crest_private.export_job_completions t WHERE t.business_id=expected_business AND t.generation_id=requested_key::uuid;
 END CASE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_ORIGINAL_NOT_FOUND';END IF;
 raw:=convert_to(original,'UTF8');size:=octet_length(raw);count:=(size+524287)/524288;limit_bytes:=CASE record_kind WHEN 'snapshot' THEN 1048576 WHEN 'completion' THEN 12582912 ELSE 8192 END;
 IF size NOT BETWEEN 1 AND limit_bytes OR digest IS DISTINCT FROM encode(sha256(raw),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOURNAL_EXPORT_ORIGINAL_REVIEW_REQUIRED';END IF;
 IF chunk_index>=count THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_JOURNAL_EXPORT_INPUT_REQUIRED';END IF;
 piece:=substring(raw FROM chunk_index*524288+1 FOR 524288);
 RETURN jsonb_build_object('schemaVersion',1,'scope','source_export_journal','businessId',expected_business,'snapshotToken',token,'kind',record_kind,'recordKey',requested_key,'column','request_text','textBytes',size,'textSha256',digest,'chunkIndex',chunk_index,'chunkCount',count,'offsetBytes',chunk_index*524288,'bytes',octet_length(piece),'sha256',encode(sha256(piece),'hex'),'encoding','base64','data',replace(encode(piece,'base64'),E'\n',''));
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_export_owner;
ALTER FUNCTION crest_commands.source_export_journal_context(uuid) OWNER TO crest_export_owner;
ALTER FUNCTION crest_commands.source_export_journal_page(uuid,text,text,text,integer) OWNER TO crest_export_owner;
ALTER FUNCTION crest_commands.source_export_journal_text_chunk(uuid,text,text,text,integer) OWNER TO crest_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_export_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_journal_token(uuid),crest_commands.source_export_journal_context(uuid),crest_commands.source_export_journal_page(uuid,text,text,text,integer),crest_commands.source_export_journal_text_chunk(uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_journal_token(uuid) TO crest_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.source_export_journal_context(uuid),crest_commands.source_export_journal_page(uuid,text,text,text,integer),crest_commands.source_export_journal_text_chunk(uuid,text,text,text,integer) TO crest_export;

-- Retained proposal 6/7: planning/proposals/source-export-request-resolution.sql SHA256 de31ae1ce6e4afff12d7db35044e1b6b06f5e51f94a1e9b0c586a299f6d7cc8d
-- UNREGISTERED forward43 supplement. Apply after the five journal proposals.
-- Existing42 definitions, grants, validator and browser allowlist stay unchanged.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest_private.export_jobs'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3
 OR has_schema_privilege('crest_command_owner','crest_commands','CREATE')
 OR to_regprocedure('crest_commands.request_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)') IS NULL
 OR EXISTS(SELECT 1 FROM (VALUES
('crest_private.original_operation_uuid(jsonb)','ec8d31108ca4387c2217d4d29e5d016938825802365afbda2e2667ea2a7557ee','crest_schema_owner',false,'i','sql'),
('crest_private.operation_retirement_digest(uuid,uuid,jsonb,text)','5359d819c2d454b3378d67fb3ff84d009b2d88f8a68675836666fd29ef66fbf5','crest_schema_owner',false,'i','sql'),
('crest_private.operation_retirement_result(uuid,uuid,jsonb)','da9672544c00bc815b105aae6e37b051dd5ab29594fb18ce31650de5c8f580fc','crest_schema_owner',false,'v','plpgsql'),
('crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','bfde61feafbca626187eb4a50f52cecc8a902a0550bdaff3cf1050ebeaf7aea4','crest_session_owner',true,'v','plpgsql'),
('crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','a2201e2c378a47d11053dfef8297f70652eddf060fc8728c173730157fe19a1d','crest_session_owner',true,'v','plpgsql'),
('crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)','3b796c52c8e7ae4261e75ede6c06c41b36e997a53d5a1199829b8aa7c77fb0ab','crest_session_owner',true,'v','plpgsql')
 ) expected(signature,digest,owner,definer,volatility,language)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid IS NULL OR p.proowner<>expected.owner::regrole OR p.prosecdef<>expected.definer OR p.provolatile::text<>expected.volatility OR l.lanname<>expected.language
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>expected.digest
 OR cardinality(p.proconfig)<>(CASE WHEN expected.definer THEN 2 ELSE 1 END)
 OR NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) setting WHERE setting~'^search_path=pg_catalog, *pg_temp$')
 OR expected.definer AND NOT('row_security=on'=ANY(p.proconfig))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_REQUEST_RESOLUTION_SOURCE_REVIEW_REQUIRED';
 END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.source_export_request_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 RETURN coalesce(v?&ARRAY['schemaVersion','businessId','commandType','reference'] AND v-ARRAY['schemaVersion','businessId','commandType','reference']='{}'::jsonb
 AND v->'schemaVersion'='1'::jsonb AND crest_private.original_operation_uuid(v->'businessId') AND v->>'commandType'='export.request'
 AND jsonb_typeof(v->'reference')='object'
 AND v->'reference'?&ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']
 AND (v->'reference')-ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']='{}'::jsonb
 AND crest_private.original_operation_uuid(v->'reference'->'operationId') AND crest_private.original_operation_uuid(v->'reference'->'recoveryEpoch') AND crest_private.original_operation_uuid(v->'reference'->'exportJobId')
 AND jsonb_typeof(v->'reference'->'appReleaseId')='string' AND v->'reference'->>'appReleaseId'~'^[a-f0-9]{40}$'
 AND v->'reference'->>'profile'='crest.business-source-journal-bundle.v1'
 AND (v->'reference'->'sourceSchemaVersion')::text='43',false);
END $$;
CREATE FUNCTION crest_commands.retire_source_export_request(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original jsonb,requested_reason text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;operation uuid;digest text;claimed uuid;existing record;event uuid;stamp timestamptz;decision jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.source_export_request_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 2000 OR btrim(requested_reason,E' \t\n\r\u000b\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' OR translate(requested_reason,E'\t\n\r','')~('['||chr(1)||'-'||chr(31)||chr(127)||']') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
 -- JSONB numeric equality admits schemaVersion1.0 as version1. Normalize its
 -- representation before hashing/retaining so an equivalent later lookup is
 -- not rejected merely because the original caller used another spelling.
 original:=original||jsonb_build_object('schemaVersion',1);
 context:=crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 operation:=(original->'reference'->>'operationId')::uuid;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',operation::text,true);
 digest:=crest_private.operation_retirement_digest(expected_actor,expected_epoch,original,requested_reason);
 -- The SAME unique key used by every original writer serializes both choices.
 -- A conflicting uncommitted original must finish before this can decide.
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,'operation.retire',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT command_type,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  PERFORM crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
  IF existing.command_type='operation.retire' AND existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  decision:=crest_private.operation_retirement_result(requested_business,expected_actor,original);
  IF decision->>'state'='retired' THEN PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);END IF;
  RETURN decision;
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,operation,expected_actor,expected_actor,'operations',claimed,1,'retire',requested_reason,jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',claimed,'original',original,'recoveryEpoch',expected_epoch,'reason',requested_reason)),'manual') RETURNING id,recorded_at INTO event,stamp;
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','original',original,'retirement',jsonb_build_object('operationRowId',claimed,'auditEventId',event,'recoveryEpoch',expected_epoch,'reason',requested_reason,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=operation;
 PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);
 RETURN crest_private.operation_retirement_result(requested_business,expected_actor,original);
END $$;
CREATE FUNCTION crest_commands.lookup_source_export_request_resolution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.source_export_request_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
 original:=original||jsonb_build_object('schemaVersion',1);
 context:=crest_commands.authorize_operation_resolution_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.operation_retirement_result(requested_business,expected_actor,original);
END $$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.retire_source_export_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.lookup_source_export_request_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_request_reference_valid(jsonb),crest_commands.retire_source_export_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text),crest_commands.lookup_source_export_request_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_request_reference_valid(jsonb) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.retire_source_export_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text),crest_commands.lookup_source_export_request_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;

-- Retained proposal 7/7: planning/proposals/source-export-owner-reads.sql SHA256 7d95e19d6796490396c525c3a429fd3fd3a5da1a546fd46d586b19dc8c74c4ba
-- UNREGISTERED forward43 supplement, after the six journal proposals.
-- Bounded owner metadata/current download evidence and durable access audit.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.export_jobs'::regclass,'crest_private.export_job_snapshots'::regclass,'crest_private.export_part_intents'::regclass,'crest_private.export_part_verifications'::regclass,'crest_private.export_job_completions'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>7
 OR has_schema_privilege('crest_command_owner','crest_commands','CREATE')
 OR EXISTS(SELECT 1 FROM (VALUES
 ('crest_commands.authorize_source_export_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','3ec3c8f8338dec214fa63f9ca81d086badbdd44817e18222262275ead503f4d6','crest_session_owner',true,'v','plpgsql'),
 ('crest_private.source_export_job_projection(crest_private.export_jobs)','0219e951c2ccb4259c49e7f422606c57d84a8ceb1469440ad6101c0c2dad8bb1','crest_schema_owner',false,'i','sql'),
 ('crest_commands.lock_source_export_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','c3b1c29f4662a3443b85a9f404b44ac31196ea723154273ea773188b5ec97e85','crest_session_owner',true,'v','plpgsql')
 ) expected(signature,digest,owner,definer,volatility,language)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) LEFT JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid IS NULL OR p.proowner<>expected.owner::regrole OR p.prosecdef<>expected.definer OR p.provolatile::text<>expected.volatility OR l.lanname<>expected.language
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>expected.digest OR cardinality(p.proconfig)<>(CASE WHEN expected.definer THEN 2 ELSE 1 END)
 OR NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) setting WHERE setting~'^search_path=pg_catalog, *pg_temp$')
 OR expected.definer AND NOT('row_security=on'=ANY(p.proconfig))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_OWNER_READ_SOURCE_REVIEW_REQUIRED';
 END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.list_source_exports(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,before_created_at text,before_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;before_stamp timestamptz;page jsonb;next_cursor jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (before_created_at IS NULL)<>(before_id IS NULL) OR before_created_at IS NOT NULL AND (length(before_created_at)<>27 OR before_created_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_OWNER_CURSOR_REQUIRED';END IF;
 IF before_created_at IS NOT NULL THEN
  before_stamp:=before_created_at::timestamptz;
  IF NOT isfinite(before_stamp) OR to_char(before_stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>before_created_at THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_OWNER_CURSOR_REQUIRED';END IF;
 END IF;
 context:=crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 IF before_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest_private.export_jobs WHERE business_id=requested_business AND id=before_id AND created_at=before_stamp) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_OWNER_CURSOR_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(crest_private.source_export_job_projection(j::crest_private.export_jobs) ORDER BY j.created_at DESC,j.id DESC),'[]'::jsonb) INTO page
 FROM (SELECT * FROM crest_private.export_jobs WHERE business_id=requested_business AND (before_id IS NULL OR (created_at,id)<(before_stamp,before_id)) ORDER BY created_at DESC,id DESC LIMIT 6) j;
 IF jsonb_array_length(page)=6 THEN next_cursor:=jsonb_build_object('createdAt',page->4->>'created_at','id',page->4->>'id');page:=page-5;ELSE next_cursor:=NULL;END IF;
 -- Recheck recent/current authority after any possible source wait. A cursor
 -- and prior page never serve as reusable authority for this live read.
 PERFORM crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'jobs',page,'next',next_cursor);
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.list_source_exports(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.list_source_exports(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_source_exports(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid) TO crest_web;

-- Serialize the session before the read gate takes the recovery-root lock.
-- Otherwise two metadata reads can both hold SHARE and deadlock when the
-- subsequent mutation fence upgrades the same session to UPDATE.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lock_source_export_download_context(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
BEGIN
 IF credential_hash IS NULL OR octet_length(credential_hash)<>32 OR expected_session IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR expected_subject IS NULL OR expected_provider_session IS NULL OR provider_valid_until IS NULL OR NOT isfinite(provider_valid_until) OR requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 PERFORM a.id FROM crest_private.actors a WHERE a.id=expected_actor FOR SHARE;
 PERFORM b.id FROM crest.businesses b WHERE b.id=requested_business FOR SHARE;
 PERFORM s.id FROM crest_private.app_sessions s WHERE s.id=expected_session FOR UPDATE;
 RETURN crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.lock_source_export_download_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.lock_source_export_download_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_source_export_download_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) TO crest_command_owner;
-- Internal read gate. Root locks are released by the completed metadata query,
-- before any later object-store/network I/O. Reacquire on every actual use.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.current_source_export_download(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;j crest_private.export_jobs;c record;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=requested_job;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 -- The shared current recovery fence precedes the job lock, matching command
 -- ordering. Paused/recovered old generations never gain file authority.
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,j.recovery_epoch);
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=requested_job FOR SHARE;
 IF NOT FOUND OR j.state<>'Ready' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 -- The caller is the current owner; encrypted AAD and immutable journal RLS
 -- retain the original recording actor. No policy or raw grant is widened.
 PERFORM set_config('crest.actor_id',j.actor_id::text,true),set_config('crest.operation_id',j.operation_id::text,true);
 SELECT generation_id,actor_id,recovery_epoch,plan_sha256,expected_version,operation_id,completed_at,expires_at,file_count,total_bytes,manifest_sha256 INTO c
 FROM crest_private.export_job_completions WHERE business_id=requested_business AND export_job_id=requested_job AND (requested_generation IS NULL OR generation_id=requested_generation);
 IF NOT FOUND OR c.actor_id<>j.actor_id OR c.recovery_epoch<>j.recovery_epoch OR c.expected_version+1<>j.version OR c.operation_id<>j.operation_id OR c.completed_at>clock_timestamp() OR c.expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 IF (crest_private.source_export_receipt(requested_business,j.actor_id,j.operation_id)->>'state') IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 RETURN jsonb_build_object('header',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'exportJobId',j.id,'generationId',c.generation_id,'profile',j.profile,'appReleaseId',j.app_release_id,'sourceSchemaVersion',j.source_schema_version,'completedAt',to_char(c.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',to_char(c.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'fileCount',c.file_count,'totalBytes',c.total_bytes,'manifestSha256',c.manifest_sha256),
 'authority',jsonb_build_object('currentActorId',expected_actor,'originalActorId',j.actor_id,'recoveryEpoch',j.recovery_epoch,'planSha256',c.plan_sha256));
END $$;
CREATE FUNCTION crest_commands.read_source_export_download_page(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,after_ordinal integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;files jsonb;total integer;last_ordinal integer;
BEGIN
 IF after_ordinal IS NULL OR after_ordinal NOT BETWEEN 0 AND 1023 OR requested_generation IS NULL AND after_ordinal<>0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);total:=(context->'header'->>'fileCount')::integer;
 IF after_ordinal>=total THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',p.ordinal,'partId',p.part_id,'fileName',p.file_name,'contentType',p.content_type,'bytes',p.plaintext_bytes,'sha256',p.plaintext_sha256) ORDER BY p.ordinal),'[]'::jsonb) INTO files FROM
 (SELECT i.ordinal,i.part_id,i.file_name,i.content_type,i.plaintext_bytes,i.plaintext_sha256 FROM crest_private.export_part_intents i JOIN crest_private.export_part_verifications v USING(business_id,generation_id,part_id,request_sha256)
 WHERE i.business_id=requested_business AND i.export_job_id=requested_job AND i.generation_id=(context->'header'->>'generationId')::uuid AND i.plan_sha256=context->'authority'->>'planSha256' AND i.recovery_epoch=(context->'authority'->>'recoveryEpoch')::uuid AND i.ordinal>after_ordinal ORDER BY i.ordinal LIMIT 5) p;
 IF jsonb_array_length(files)<>least(5,total-after_ordinal) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 last_ordinal:=after_ordinal+jsonb_array_length(files);
 IF crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,(context->'header'->>'generationId')::uuid) IS DISTINCT FROM context THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 RETURN context->'header'||jsonb_build_object('files',files,'nextOrdinal',CASE WHEN last_ordinal<total THEN last_ordinal ELSE NULL END);
END $$;
CREATE FUNCTION crest_commands.read_source_export_download_part(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_part uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;part jsonb;
BEGIN
 IF requested_generation IS NULL OR requested_part IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 SELECT jsonb_build_object('file',jsonb_build_object('ordinal',i.ordinal,'partId',i.part_id,'fileName',i.file_name,'contentType',i.content_type,'bytes',i.plaintext_bytes,'sha256',i.plaintext_sha256),
 'intent',jsonb_build_object('formatVersion',1,'objectKey',i.object_key,'keyId',i.key_id,'plaintextBytes',i.plaintext_bytes,'plaintextSha256',i.plaintext_sha256,'ciphertextBytes',i.ciphertext_bytes,'ciphertextSha256',i.ciphertext_sha256)) INTO part
 FROM crest_private.export_part_intents i JOIN crest_private.export_part_verifications v USING(business_id,generation_id,part_id,request_sha256)
 WHERE i.business_id=requested_business AND i.export_job_id=requested_job AND i.generation_id=requested_generation AND i.part_id=requested_part AND i.plan_sha256=context->'authority'->>'planSha256' AND i.recovery_epoch=(context->'authority'->>'recoveryEpoch')::uuid;
 IF NOT FOUND OR crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) IS DISTINCT FROM context THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 RETURN context||part;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.current_source_export_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export_download_page(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export_download_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.current_source_export_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.read_source_export_download_page(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer),crest_commands.read_source_export_download_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_source_export_download_page(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer),crest_commands.read_source_export_download_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_web;

-- User-only completion, never called by worker checks or download metadata
-- probes. Activity commits atomically with the durable foreground operation;
-- authenticated_at/reauth_at and absolute expiry are never extended.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.finish_source_export_foreground_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
BEGIN
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_ACTIVITY_OPERATION_REQUIRED';END IF;
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_ACTIVITY_DENIED';END IF;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_source_export_foreground_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.finish_source_export_foreground_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.finish_source_export_foreground_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_command_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.request_source_export_with_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_job uuid,requested_release text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE result jsonb;
BEGIN
 result:=crest_commands.request_source_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
 IF result->>'state'='committed' THEN
  PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 END IF;
 -- The original writer's verified transaction-local scope must survive its
 -- deferred audit checks at COMMIT. COMMIT/ROLLBACK resets it automatically.
 RETURN result;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.request_source_export_with_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.request_source_export_with_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_source_export_with_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
-- Durable sensitive-read evidence. This records authorization to hand off one
-- verified file, never a claim that a network transfer completed. Existing
-- append-only operations/audit are exported with ordinary business history.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY source_export_access_claim ON crest_private.operations FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='export.download_access' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY source_export_access_finish ON crest_private.operations FOR UPDATE TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='export.download_access') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='export.download_access' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY source_export_access_audit ON crest_private.audit_events FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='export_accesses' AND entity_id=operation_id AND entity_version=1 AND action='authorized_handoff' AND origin='manual' AND import_row_id IS NULL AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.actor_id=audit_events.actor_id AND o.operation_id=audit_events.operation_id AND o.command_type='export.download_access' AND o.state='pending' AND o.schema_version=1));
CREATE FUNCTION crest_commands.record_source_export_download_access(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_part uuid,expected_record text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE current_record jsonb;scope jsonb;operation uuid:=gen_random_uuid();event uuid;stamp timestamptz;receipt jsonb;
BEGIN
 IF expected_record IS NULL OR octet_length(expected_record)>16384 OR NOT(expected_record IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 current_record:=crest_commands.read_source_export_download_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 IF current_record IS DISTINCT FROM expected_record::jsonb THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 scope:=jsonb_build_object('header',current_record->'header','file',current_record->'file','currentActorId',expected_actor,'recoveryEpoch',current_record->'authority'->'recoveryEpoch');
 -- Original encrypted AAD remains separate from the current accessing owner.
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',operation::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,'export.download_access',1,(current_record->'authority'->>'recoveryEpoch')::uuid,encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,operation,expected_actor,expected_actor,'export_accesses',operation,1,'authorized_handoff',jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,stamp;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,(current_record->'authority'->>'recoveryEpoch')::uuid,operation);
 IF crest_commands.read_source_export_download_part($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) IS DISTINCT FROM current_record THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 RETURN receipt;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_download_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.record_source_export_download_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_source_export_download_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
