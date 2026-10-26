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
