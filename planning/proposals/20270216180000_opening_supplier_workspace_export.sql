-- HELD141 workspace export: retained supplier evidence, allocation reviews and versioned export requests.
-- No new financial posting, refund, provider or runtime activation authority.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.business_source_dictionary_v3()
RETURNS TABLE(source_name text,fields text[],business_column text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 SELECT * FROM crest_private.business_source_dictionary_v2()
 UNION ALL SELECT * FROM (VALUES
 ('crest.opening_payables_origins',ARRAY['id','business_id','source_namespace','external_id','vendor','operation_id','recorded_by','recorded_at'],'business_id'),
 ('crest.opening_payables_schedule_revisions',ARRAY['id','business_id','worksheet_revision_id','revision','prior_revision','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],'business_id'),
 ('crest.opening_allocations_origins',ARRAY['id','business_id','source_namespace','external_id','vendor','kind','reference','operation_id','recorded_by','recorded_at'],'business_id'),
 ('crest.opening_allocations_schedule_revisions',ARRAY['id','business_id','worksheet_revision_id','payables_revision','revision','prior_revision','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],'business_id')) AS added(source_name,fields,business_column);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.business_source_dictionary_v3() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.business_source_dictionary_v3() TO crest_business_source_owner;
DO $grant$
DECLARE d record; source_oid oid; projection text;
BEGIN
 FOR d IN SELECT * FROM crest_private.business_source_dictionary_v3() WHERE source_name IN('crest.opening_payables_origins','crest.opening_payables_schedule_revisions','crest.opening_allocations_origins','crest.opening_allocations_schedule_revisions') LOOP
  source_oid:=to_regclass(d.source_name);
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=source_oid AND relkind='r'
   AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR NOT EXISTS(SELECT FROM pg_index i WHERE i.indrelid=source_oid AND i.indisprimary
    AND NOT EXISTS(SELECT FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid=source_oid AND a.attnum=k WHERE NOT a.attname=ANY(d.fields)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO projection FROM unnest(d.fields) field;
  EXECUTE format('GRANT SELECT(%s) ON %s TO crest_business_source_owner',projection,source_oid::regclass);
  EXECUTE format('CREATE POLICY current_business_source_scope ON %s FOR SELECT TO crest_business_source_owner USING(%I=nullif(current_setting(''crest.business_source_business'',true),'''')::uuid)',source_oid::regclass,d.business_column);
 END LOOP;
END $grant$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_business_source_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.business_source_page_v3(requested_business uuid,requested_source text,expected_snapshot text,after_key text[],page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' SET bytea_output='hex' SET extra_float_digits=3 AS $source$
DECLARE d record; source_oid oid; pk text[]; projection text; key_sql text; keys jsonb; data jsonb; snapshot_value text; token text; next_cursor jsonb; types jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF page_size IS NULL OR page_size<1 OR page_size>100 OR requested_business IS NULL
  OR (after_key IS NOT NULL AND (expected_snapshot IS NULL OR cardinality(after_key)<1 OR cardinality(after_key)>16 OR array_position(after_key,NULL) IS NOT NULL))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT * INTO d FROM crest_private.business_source_dictionary_v3() WHERE source_name=requested_source;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('crest.business.rows/2',requested_business,pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
 IF expected_snapshot IS NOT NULL AND expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_CHANGED'; END IF;
 source_oid:=to_regclass(d.source_name);
 SELECT array_agg(a.attname::text ORDER BY k.position) INTO pk FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number WHERE i.indrelid=source_oid AND i.indisprimary;
 IF pk IS NULL OR cardinality(pk)>16 OR after_key IS NOT NULL AND cardinality(after_key)<>cardinality(pk)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT string_agg(format('%L,%s',field,CASE WHEN a.atttypid='timestamptz'::regtype
  THEN format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',field)
  ELSE format('t.%I::text',field) END),',' ORDER BY position),
  jsonb_object_agg(field,format_type(a.atttypid,a.atttypmod)) INTO projection,types
  FROM unnest(d.fields) WITH ORDINALITY f(field,position) JOIN pg_attribute a ON a.attrelid=source_oid AND a.attname=field;
 SELECT 'ARRAY['||string_agg(format('t.%I::text',field),',' ORDER BY position)||']::text[]' INTO key_sql FROM unnest(pk) WITH ORDINALITY f(field,position);
 EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),''[]''::jsonb),coalesce(jsonb_agg(to_jsonb(key) ORDER BY key COLLATE "C"),''[]''::jsonb) FROM (SELECT %s AS key,jsonb_build_object(%s) AS value FROM %s t WHERE t.%I=$1 AND ($2::text[] IS NULL OR (%s COLLATE "C")>($2::text[] COLLATE "C")) ORDER BY %s COLLATE "C" LIMIT $3) bounded',key_sql,projection,source_oid::regclass,d.business_column,key_sql,key_sql)
  INTO data,keys USING requested_business,after_key,page_size+1;
 IF jsonb_array_length(data)>page_size THEN data:=data-page_size;next_cursor:=keys->(page_size-1); END IF;
 IF octet_length(data::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'source',requested_source,'snapshotToken',token,
  'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'columns',d.fields,'types',types,'primaryKey',pk,'rows',data,'nextCursor',next_cursor);
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.business_source_page_v3(uuid,text,text,text[],integer) OWNER TO crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_commands.business_source_page_v3(uuid,text,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_source_page_v3(uuid,text,text,text[],integer) TO crest_export;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_business_source_owner;

-- Versioned workspace export jobs141; old request writers and receipts retained.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.export_jobs DROP CONSTRAINT export_jobs_profile_schema_check;
ALTER TABLE crest_private.export_jobs ADD CONSTRAINT export_jobs_profile_schema_check CHECK((profile='crest.business-source-journal-bundle.v1' AND source_schema_version=43) OR(profile='crest.current-business-source-bundle.v1' AND source_schema_version IN(134,135,136,137,138,140,141)));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_source_schema_version_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_source_schema_version_check CHECK(source_schema_version IN(43,134,135,136,137,138,140,141));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_request_text_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_request_text_check CHECK(octet_length(request_text) BETWEEN 1 AND (CASE WHEN source_schema_version IN(136,137,138,140,141) THEN 33554432 ELSE 1048576 END));
CREATE OR REPLACE FUNCTION crest_private.source_export_snapshot_plan(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE maximum_bytes integer:=CASE WHEN j.source_schema_version IN(136,137,138,140,141) THEN 33554432 ELSE 1048576 END;r jsonb;p jsonb;f jsonb;names text[]:=ARRAY[]::text[];ids text[]:=ARRAY[]::text[];previous_name text;name text;n bigint:=0;position integer:=0;stamp timestamptz;plan_text text;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND maximum_bytes OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;p:=r->'plan';plan_text:=(original::json->'plan')::text;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256'])
 OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR r->>'planSha256' IS DISTINCT FROM encode(sha256(convert_to(plan_text,'UTF8')),'hex')
 OR NOT crest_private.export_json_object(p,ARRAY['formatVersion','claim','generationId','observedAt','appReleaseId','sourceSchemaVersion','manifestSha256','parts','totalBytes','referenceClosureComplete','completePortableExport','completeBackup']||CASE WHEN j.source_schema_version IN(136,137,138,140,141) THEN ARRAY['originals'] ELSE ARRAY[]::text[] END)
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
 IF j.source_schema_version IN(136,137,138,140,141) AND crest_private.source_export_original_index_valid(p->'originals') IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_ORIGINAL_INDEX_REQUIRED';END IF;
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
 IF o.command_type='export.request' AND r->'job'->>'profile'='crest.current-business-source-bundle.v1' AND r->'job'->'source_schema_version' IN('134'::jsonb,'135'::jsonb,'136'::jsonb,'137'::jsonb,'138'::jsonb,'140'::jsonb,'141'::jsonb) THEN
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
 AND ((v->'reference'->>'profile'='crest.business-source-journal-bundle.v1' AND v->'reference'->'sourceSchemaVersion'='43'::jsonb) OR (v->'reference'->>'profile'='crest.current-business-source-bundle.v1' AND v->'reference'->'sourceSchemaVersion' IN('134'::jsonb,'135'::jsonb,'136'::jsonb,'137'::jsonb,'138'::jsonb,'140'::jsonb,'141'::jsonb))),false);
END $$;
CREATE FUNCTION crest_commands.request_current_source_export_v7_for_execution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_job uuid,requested_release text)
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
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType','export.request','businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',NULL::text,'leaseId',NULL::uuid,'appReleaseId',requested_release,'profile','crest.current-business-source-bundle.v1','sourceSchemaVersion',141)::text,'UTF8')),'hex');
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
  INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(requested_job,requested_business,expected_actor,'crest.current-business-source-bundle.v1',requested_release,141,expected_epoch,requested_operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO j;
  after_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'export_jobs',requested_job,j.version,'request',jsonb_build_object('schemaVersion',1,'before',NULL,'after',after_state),'manual') RETURNING id INTO event;
  receipt:=jsonb_build_object('schemaVersion',1,'command',jsonb_set(jsonb_set(crest_private.source_export_command('export.request',requested_business,expected_epoch,requested_operation,requested_job,NULL::text,NULL::uuid,requested_release),'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}','141'::jsonb),'job',after_state,'auditEventId',event);
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
REVOKE ALL ON FUNCTION crest_commands.request_current_source_export_v7_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_current_source_export_v7_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.request_current_source_export_v7_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_source_export_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;original jsonb;original_index jsonb;matches jsonb;
BEGIN
 IF requested_attachment IS NULL OR requested_kind IS NULL OR requested_kind NOT IN('expense_receipt','supplier_document','condition_photo') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 IF context->'header'->>'profile' IS DISTINCT FROM 'crest.current-business-source-bundle.v1'
 OR (context->'header'->>'sourceSchemaVersion')::integer NOT IN(136,137,138,140,141)
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
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
