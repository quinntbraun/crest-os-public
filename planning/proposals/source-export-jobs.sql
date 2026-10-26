-- UNREGISTERED forward43 candidate: request/lease core only. No Ready or runtime activation.
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
 profile text NOT NULL CHECK(profile='crest.business-source-bundle.v1'),
 app_release_id text NOT NULL CHECK(app_release_id~'^[a-f0-9]{40}$'),
 source_schema_version integer NOT NULL CHECK(source_schema_version=43),
 recovery_epoch uuid NOT NULL,
 request_operation_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('Queued','Running','Failed')),
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
CREATE FUNCTION crest_private.check_source_export_attempt_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='export_jobs' AND a.entity_id=NEW.export_job_id AND a.action='claim' AND a.delta->'after'->>'lease_id'=NEW.id::text AND a.delta->'after'->>'attempt_count'=NEW.attempt_no::text AND a.delta->'after'->>'recovery_epoch'=NEW.recovery_epoch::text AND a.delta->'after'->>'lease_until'=to_char(NEW.lease_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_ATTEMPT_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER export_attempt_audit AFTER INSERT ON crest_private.export_job_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_source_export_attempt_audit();
CREATE FUNCTION crest_private.check_source_export_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE j crest_private.export_jobs;
BEGIN
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=NEW.business_id AND id=NEW.id;
 IF j.state='Running' AND NOT EXISTS(SELECT 1 FROM crest_private.export_job_attempts x WHERE x.business_id=j.business_id AND x.export_job_id=j.id AND x.id=j.lease_id AND x.attempt_no=j.attempt_count AND x.recovery_epoch=j.recovery_epoch AND x.created_by=j.actor_id AND x.lease_until=j.lease_until) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_LEASE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=j.business_id AND a.operation_id=j.operation_id AND a.actor_id=j.updated_by AND a.entity_kind='export_jobs' AND a.entity_id=j.id AND a.entity_version=j.version AND a.delta->'after'=crest_private.source_export_job_projection(j)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER export_job_audit AFTER INSERT OR UPDATE ON crest_private.export_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_source_export_audit();
-- Every meaningful state transition uses a new ordinary immutable operation.
CREATE POLICY source_export_operation_claim ON crest_private.operations FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('export.request','export.claim','export.expire','export.stop') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY source_export_operation_finish ON crest_private.operations FOR UPDATE TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('export.request','export.claim','export.expire','export.stop')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('export.request','export.claim','export.expire','export.stop') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY source_export_audit_insert ON crest_private.audit_events FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='export_jobs' AND action IN('request','claim','expire','stop') AND origin='manual' AND import_row_id IS NULL AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.command_type='export.'||audit_events.action AND o.schema_version=1 AND o.state='pending'));
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
CREATE FUNCTION crest_private.source_export_receipt(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE o crest_private.operations;r jsonb;a record;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 r:=o.result;
 IF o.command_type NOT IN('export.request','export.claim','export.expire','export.stop') OR o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR r IS NULL OR jsonb_typeof(r)<>'object' OR NOT(r?&ARRAY['schemaVersion','job','auditEventId']) OR r-ARRAY['schemaVersion','job','auditEventId']<>'{}'::jsonb OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(r->'job') IS DISTINCT FROM 'object' OR r->'job'->>'business_id' IS DISTINCT FROM business::text OR r->'job'->>'operation_id' IS DISTINCT FROM operation::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 SELECT id INTO a FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id::text=r->>'auditEventId' AND entity_kind='export_jobs' AND entity_id::text=r->'job'->>'id' AND entity_version::text=r->'job'->>'version' AND action=split_part(o.command_type,'.',2) AND delta->'after'=r->'job';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $$;
CREATE FUNCTION crest_commands.source_export_transition(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,operation uuid,job uuid,action text,expected_version bigint,lease uuid,release_id text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;j crest_private.export_jobs;before_state jsonb;after_state jsonb;event uuid;stamp timestamptz;lease_end timestamptz;receipt jsonb;kind text:='export.'||action;delay interval;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF operation IS NULL OR job IS NULL OR action IS NULL OR action NOT IN('request','claim','expire','stop') OR action='request' AND (release_id IS NULL OR release_id!~'^[a-f0-9]{40}$' OR expected_version IS NOT NULL OR lease IS NOT NULL) OR action<>'request' AND (expected_version IS NULL OR expected_version<1 OR release_id IS NOT NULL) OR action IN('claim','expire') AND lease IS NULL OR action='stop' AND lease IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType',kind,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',job,'expectedVersion',expected_version::text,'leaseId',lease,'appReleaseId',release_id,'profile','crest.business-source-bundle.v1','sourceSchemaVersion',43)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,kind,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=operation;
   PERFORM crest_commands.lock_source_export_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
   IF NOT FOUND OR existing.actor_id IS DISTINCT FROM expected_actor OR existing.command_type IS DISTINCT FROM kind OR existing.recovery_epoch IS DISTINCT FROM expected_epoch OR existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   RETURN crest_private.source_export_receipt(requested_business,expected_actor,operation);
  END IF;
  IF action='request' THEN
   INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(job,requested_business,expected_actor,'crest.business-source-bundle.v1',release_id,43,expected_epoch,operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',operation) RETURNING * INTO j;
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
  receipt:=jsonb_build_object('schemaVersion',1,'job',after_state,'auditEventId',event);
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
