-- Registered136: frozen original membership, exact private handoff and old-job compatibility.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.export_jobs DROP CONSTRAINT export_jobs_profile_schema_check;
ALTER TABLE crest_private.export_jobs ADD CONSTRAINT export_jobs_profile_schema_check CHECK((profile='crest.business-source-journal-bundle.v1' AND source_schema_version=43) OR(profile='crest.current-business-source-bundle.v1' AND source_schema_version IN(134,135,136)));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_source_schema_version_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_source_schema_version_check CHECK(source_schema_version IN(43,134,135,136));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_request_text_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_request_text_check CHECK(octet_length(request_text) BETWEEN 1 AND (CASE WHEN source_schema_version=136 THEN 33554432 ELSE 1048576 END));
CREATE FUNCTION crest_private.source_export_original_index_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE f jsonb;previous_id text;extension text;stamp timestamptz;
BEGIN
 IF NOT crest_private.export_json_object(v,ARRAY['profile','inventorySha256','files']) OR v->>'profile' IS DISTINCT FROM 'crest.source-export-original-index.v1' OR jsonb_typeof(v->'inventorySha256') IS DISTINCT FROM 'string' OR coalesce(v->>'inventorySha256','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(v->'files') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF jsonb_array_length(v->'files')>100000 THEN RETURN false;END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(v->'files') LOOP
  IF NOT crest_private.export_json_object(f,ARRAY['kind','attachmentId','objectId','path','mediaType','byteSize','sha256','recordedAt']) OR NOT crest_private.export_json_uuid(f->'attachmentId') OR NOT crest_private.export_json_uuid(f->'objectId') OR coalesce(f->>'kind','') NOT IN('expense_receipt','supplier_document','condition_photo') OR jsonb_typeof(f->'byteSize') IS DISTINCT FROM 'number' OR coalesce(f->>'byteSize','')!~'^[1-9][0-9]{0,7}$' OR (f->>'byteSize')::bigint>26214400 OR jsonb_typeof(f->'sha256') IS DISTINCT FROM 'string' OR coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$' OR jsonb_typeof(f->'recordedAt') IS DISTINCT FROM 'string' OR coalesce(f->>'recordedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN false;END IF;
  extension:=CASE f->>'mediaType' WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/heic' THEN 'heic' WHEN 'application/pdf' THEN 'pdf' ELSE NULL END;
  IF extension IS NULL OR f->>'path' IS DISTINCT FROM 'attachments/'||(f->>'attachmentId')||'/'||(f->>'objectId')||'.'||extension OR f->>'kind'='condition_photo' AND extension='pdf' OR f->>'kind'<>'condition_photo' AND f->'attachmentId' IS DISTINCT FROM f->'objectId' OR previous_id IS NOT NULL AND (f->>'attachmentId') COLLATE "C"<=previous_id COLLATE "C" THEN RETURN false;END IF;
  stamp:=(f->>'recordedAt')::timestamptz;IF NOT isfinite(stamp) THEN RETURN false;END IF;previous_id:=f->>'attachmentId';
 END LOOP;RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION crest_private.source_export_original_index_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_original_index_valid(jsonb) TO crest_command_owner;
CREATE OR REPLACE FUNCTION crest_private.source_export_snapshot_plan(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE maximum_bytes integer:=CASE WHEN j.source_schema_version=136 THEN 33554432 ELSE 1048576 END;r jsonb;p jsonb;f jsonb;names text[]:=ARRAY[]::text[];ids text[]:=ARRAY[]::text[];previous_name text;name text;n bigint:=0;position integer:=0;stamp timestamptz;plan_text text;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND maximum_bytes OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;p:=r->'plan';plan_text:=(original::json->'plan')::text;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256'])
 OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR r->>'planSha256' IS DISTINCT FROM encode(sha256(convert_to(plan_text,'UTF8')),'hex')
 OR NOT crest_private.export_json_object(p,ARRAY['formatVersion','claim','generationId','observedAt','appReleaseId','sourceSchemaVersion','manifestSha256','parts','totalBytes','referenceClosureComplete','completePortableExport','completeBackup']||CASE WHEN j.source_schema_version=136 THEN ARRAY['originals'] ELSE ARRAY[]::text[] END)
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
 IF j.source_schema_version=136 AND crest_private.source_export_original_index_valid(p->'originals') IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_ORIGINAL_INDEX_REQUIRED';END IF;
 RETURN p;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
END $$;
CREATE OR REPLACE FUNCTION crest_private.source_export_receipt(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
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
 IF o.command_type='export.request' AND r->'job'->>'profile'='crest.current-business-source-bundle.v1' AND r->'job'->'source_schema_version' IN('134'::jsonb,'135'::jsonb,'136'::jsonb) THEN
  expected_command:=jsonb_set(jsonb_set(expected_command,'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}',r->'job'->'source_schema_version');
 END IF;
 IF r->'command' IS DISTINCT FROM expected_command THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $$;
CREATE OR REPLACE FUNCTION crest_private.source_export_request_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 RETURN coalesce(v?&ARRAY['schemaVersion','businessId','commandType','reference'] AND v-ARRAY['schemaVersion','businessId','commandType','reference']='{}'::jsonb
 AND v->'schemaVersion'='1'::jsonb AND crest_private.original_operation_uuid(v->'businessId') AND v->>'commandType'='export.request'
 AND jsonb_typeof(v->'reference')='object'
 AND v->'reference'?&ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']
 AND (v->'reference')-ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']='{}'::jsonb
 AND crest_private.original_operation_uuid(v->'reference'->'operationId') AND crest_private.original_operation_uuid(v->'reference'->'recoveryEpoch') AND crest_private.original_operation_uuid(v->'reference'->'exportJobId')
 AND jsonb_typeof(v->'reference'->'appReleaseId')='string' AND v->'reference'->>'appReleaseId'~'^[a-f0-9]{40}$'
 AND ((v->'reference'->>'profile'='crest.business-source-journal-bundle.v1' AND v->'reference'->'sourceSchemaVersion'='43'::jsonb) OR (v->'reference'->>'profile'='crest.current-business-source-bundle.v1' AND v->'reference'->'sourceSchemaVersion' IN('134'::jsonb,'135'::jsonb,'136'::jsonb))),false);
END $$;
CREATE FUNCTION crest_commands.request_current_source_export_v3_for_execution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_job uuid,requested_release text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;j crest_private.export_jobs;after_state jsonb;event uuid;receipt jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_job IS NULL OR requested_release IS NULL OR requested_release!~'^[a-f0-9]{40}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 -- Actor/business/session-update precedes recovery and the original operation
 -- key. No lock spans provider, collection or object-store I/O.
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 context:=crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 -- Exactly the unchanged schema43 request writer's canonical payload hash.
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType','export.request','businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',NULL::text,'leaseId',NULL::uuid,'appReleaseId',requested_release,'profile','crest.current-business-source-bundle.v1','sourceSchemaVersion',136)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'export.request',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
   IF existing.id IS NULL OR existing.actor_id IS DISTINCT FROM expected_actor OR existing.command_type IS DISTINCT FROM 'export.request' OR existing.recovery_epoch IS DISTINCT FROM expected_epoch OR existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.source_export_receipt(requested_business,expected_actor,requested_operation);
   PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
   RETURN jsonb_build_object('state','recorded','result',result);
  END IF;
  INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(requested_job,requested_business,expected_actor,'crest.current-business-source-bundle.v1',requested_release,136,expected_epoch,requested_operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO j;
  after_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'export_jobs',requested_job,j.version,'request',jsonb_build_object('schemaVersion',1,'before',NULL,'after',after_state),'manual') RETURNING id INTO event;
  receipt:=jsonb_build_object('schemaVersion',1,'command',jsonb_set(jsonb_set(crest_private.source_export_command('export.request',requested_business,expected_epoch,requested_operation,requested_job,NULL::text,NULL::uuid,requested_release),'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}','136'::jsonb),'job',after_state,'auditEventId',event);
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
  result:=crest_private.source_export_receipt(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  -- Keep the original verified scope through deferred audit checks at COMMIT.
  RETURN jsonb_build_object('state','created','result',result);
 EXCEPTION WHEN unique_violation THEN
  PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  RETURN jsonb_build_object('state','conflict','reason','active_or_identity');
 END;
END $$;
REVOKE ALL ON FUNCTION crest_commands.request_current_source_export_v3_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_current_source_export_v3_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.request_current_source_export_v3_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
-- Held original-file handoff proposal. Register only after native verification.
-- Uses existing source-reader privileges and the existing immutable export
-- access operation/audit trail. No new table, role, membership or financial rule.
RESET ROLE;
DO $review$ BEGIN
 IF to_regprocedure('crest_private.current_source_export_original(uuid,text,uuid)') IS NOT NULL
 OR to_regprocedure('crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid)') IS NOT NULL
 OR to_regprocedure('crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_ACCESS_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.current_source_export_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') AND proowner='crest_command_owner'::regrole AND prosecdef AND provolatile='v')
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_business_source_owner' AND NOT(rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_business_source_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_ACCESS_DEPENDENCY_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.current_source_export_original(business uuid,kind text,attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $$
DECLARE r record;extension text;original_key text;
BEGIN
 IF business IS NULL OR attachment IS NULL OR kind IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 PERFORM set_config('crest.business_source_business',business::text,true);
 IF kind='expense_receipt' THEN
  SELECT receipt_id AS attachment_id,receipt_id AS object_id,reservation->>'declaredType' AS media_type,
   (candidate->'original'->>'byteSize')::integer AS byte_size,candidate->'original'->>'sha256' AS sha256,
   candidate->'original'->>'key' AS object_key,recorded_at
  INTO r FROM crest.expense_receipt_revisions
  WHERE business_id=business AND receipt_id=attachment AND revision=2 AND candidate IS NOT NULL;
 ELSIF kind='condition_photo' THEN
  SELECT o.photo_id AS attachment_id,a.dispatch_id AS object_id,o.detected_type AS media_type,
   o.byte_size,o.sha256,'originals/'||business::text||'/'||a.dispatch_id::text AS object_key,o.verified_at AS recorded_at
  INTO r FROM crest.custody_photo_originals o JOIN crest.custody_photo_attempts a ON a.business_id=o.business_id AND a.id=o.photo_id
  WHERE o.business_id=business AND o.photo_id=attachment;
 ELSIF kind='supplier_document' THEN
  SELECT id AS attachment_id,id AS object_id,media_type,byte_size,file_sha256 AS sha256,object_key,verified_at AS recorded_at
  INTO r FROM crest.supplier_bill_originals WHERE business_id=business AND id=attachment;
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_FILE_UNAVAILABLE';END IF;
 extension:=CASE r.media_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/heic' THEN 'heic' WHEN 'application/pdf' THEN 'pdf' ELSE NULL END;
 original_key:='originals/'||business::text||'/'||r.object_id::text;
 IF extension IS NULL OR r.byte_size IS NULL OR r.byte_size NOT BETWEEN 1 AND 26214400 OR r.sha256 IS NULL OR r.sha256!~'^[a-f0-9]{64}$'
 OR r.object_key IS DISTINCT FROM original_key OR r.recorded_at IS NULL OR NOT isfinite(r.recorded_at)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ORIGINAL_FILE_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('file',jsonb_build_object('kind',kind,'attachmentId',attachment,'objectId',r.object_id,
  'path','attachments/'||attachment::text||'/'||r.object_id::text||'.'||extension,'mediaType',r.media_type,'byteSize',r.byte_size,
  'sha256',r.sha256,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  'object',jsonb_build_object('domain',kind,'key',original_key));
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_business_source_owner;
ALTER FUNCTION crest_private.current_source_export_original(uuid,text,uuid) OWNER TO crest_business_source_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_private.current_source_export_original(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.current_source_export_original(uuid,text,uuid) TO crest_command_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_source_export_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;original jsonb;original_index jsonb;matches jsonb;
BEGIN
 IF requested_attachment IS NULL OR requested_kind IS NULL OR requested_kind NOT IN('expense_receipt','supplier_document','condition_photo') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 IF context->'header'->>'profile' IS DISTINCT FROM 'crest.current-business-source-bundle.v1'
 OR (context->'header'->>'sourceSchemaVersion')::integer<>136
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT request_text::jsonb->'plan'->'originals' INTO original_index FROM crest_private.export_job_snapshots WHERE business_id=requested_business AND export_job_id=requested_job AND generation_id=requested_generation;
 IF NOT FOUND OR original_index->>'profile' IS DISTINCT FROM 'crest.source-export-original-index.v1' OR jsonb_typeof(original_index->'files') IS DISTINCT FROM 'array'
 OR coalesce(original_index->>'inventorySha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO matches FROM jsonb_array_elements(original_index->'files') WHERE value->>'kind'=requested_kind AND value->>'attachmentId'=requested_attachment::text;
 IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_OUTSIDE_SNAPSHOT';END IF;
 original:=crest_private.current_source_export_original(requested_business,requested_kind,requested_attachment);
 IF original->'file' IS DISTINCT FROM matches->0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 IF crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) IS DISTINCT FROM context
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 RETURN jsonb_build_object('profile','crest.source-export-original-permit.v1','header',context->'header','authority',context->'authority','indexSha256',original_index->'inventorySha256','file',original->'file','object',original->'object');
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_source_export_original_access(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid,expected_record text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE current_record jsonb;scope jsonb;operation uuid:=gen_random_uuid();event uuid;stamp timestamptz;receipt jsonb;
BEGIN
 IF expected_record IS NULL OR octet_length(expected_record)>16384 OR NOT(expected_record IS JSON OBJECT WITH UNIQUE KEYS)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_EXPORT_INPUT_REQUIRED';END IF;
 current_record:=crest_commands.read_source_export_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
 IF current_record IS DISTINCT FROM expected_record::jsonb THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 scope:=jsonb_build_object('profile','crest.source-export-original-scope.v1','header',current_record->'header','indexSha256',current_record->'indexSha256','file',current_record->'file','currentActorId',expected_actor,'recoveryEpoch',current_record->'authority'->'recoveryEpoch');
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',operation::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'export.download_access',1,(current_record->'authority'->>'recoveryEpoch')::uuid,encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'export_accesses',operation,1,'authorized_handoff',jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,stamp;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,(current_record->'authority'->>'recoveryEpoch')::uuid,operation);
 IF crest_commands.read_source_export_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) IS DISTINCT FROM current_record
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 RETURN receipt;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text) TO crest_web;

RESET ROLE;
