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
