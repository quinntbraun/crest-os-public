-- Fixed actor-scoped retained provider source. No authentication/financial
-- semantics or old migration changes. Legacy43/134 jobs keep their identity.
RESET ROLE;
DO $review$ BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='crest_provider_source_owner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_ROLE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.business_identity_export_review(uuid)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='b9d3f65895fd2f5fdd96b0d37615deccedb6b103f367dec3e866adc18a3c3ef2') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_DEPENDENCY_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.session_metadata_export_context(uuid,text)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='562a59ad4108938c7587bd3277f5b404132da3bd24d47485e3a1eca42b523e44') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_DEPENDENCY_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.source_export_receipt(uuid,uuid,uuid)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='181683c6c7e2b98f24f38265efd8670e683e6c664dc6e915d49e6a74891bc330') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_DEPENDENCY_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.source_export_request_reference_valid(jsonb)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='acbef071093cda1e6d60be92f2202f7c528606c9d37cbab43ebd85e93e529426') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_DEPENDENCY_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_provider_source_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA crest_private,crest_commands TO crest_provider_source_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_provider_source_owner;
GRANT EXECUTE ON FUNCTION crest_private.business_identity_export_review(uuid),crest_commands.session_metadata_export_context(uuid,text) TO crest_provider_source_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.provider_source_dictionary_v1() RETURNS TABLE(source_name text,fields text[],has_issuer boolean)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 VALUES
 ('crest_private.provider_cleanup_outcomes',ARRAY['request_id','actor_id','provider_issuer','provider_subject','provider_session_id','outcome','schema_version','origin','created_at','database_principal','canonical_evidence','event_hash'],true),
 ('crest_private.provider_cleanup_references',ARRAY['id','schema_version','app_session_id','actor_id','provider_session_id','issued_security_epoch','source_version','revoked_at','source_event_id','source_event_hash','state','created_at','created_by','origin','operation_id'],false),
 ('crest_private.provider_cleanup_requests',ARRAY['request_id','source_finish_id','attempt_id','actor_id','issued_security_epoch','provider_issuer','provider_subject','provider_session_id','app_session_id','registration_event_id','cleanup_reference_id','state','schema_version','origin','created_at','database_principal','canonical_evidence','event_hash'],true),
 ('crest_private.provider_inventory_observations',ARRAY['request_id','schema_version','actor_id','provider_issuer','after_session','page_size','observed_at','created_at','database_principal','origin','evidence','canonical_evidence','event_hash'],true),
 ('crest_private.provider_login_attempts',ARRAY['attempt_id','reserved_app_session_id','actor_id','issued_security_epoch','provider_issuer','provider_subject','schema_version','origin','created_at','database_principal','canonical_evidence','event_hash'],true),
 ('crest_private.provider_login_finishes',ARRAY['id','attempt_id','phase','actor_id','issued_security_epoch','provider_issuer','provider_subject','provider_session_id','registration_event_id','local_revoked_at','schema_version','origin','created_at','database_principal','canonical_evidence','event_hash'],true),
 ('crest_private.provider_login_targets',ARRAY['attempt_id','actor_id','issued_security_epoch','provider_issuer','provider_subject','provider_session_id','password_at','access_expires_at','schema_version','origin','created_at','database_principal','canonical_evidence','event_hash'],true),
 ('crest_private.session_events',ARRAY['id','session_id','actor_id','created_at','created_by','origin','operation_id','action','database_principal','payload','event_hash'],false);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.provider_source_dictionary_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.provider_source_dictionary_v1() TO crest_provider_source_owner;
RESET ROLE;
DO $grant$ DECLARE d record; target oid; projection text; BEGIN
 FOR d IN SELECT * FROM crest_private.provider_source_dictionary_v1() LOOP
  target:=to_regclass(d.source_name);
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=target AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR NOT EXISTS(SELECT FROM pg_index i WHERE i.indrelid=target AND i.indisprimary AND NOT EXISTS(SELECT FROM unnest(i.indkey) key JOIN pg_attribute a ON a.attrelid=target AND a.attnum=key WHERE NOT a.attname=ANY(d.fields)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_SCHEMA_REQUIRED';END IF;
  SELECT string_agg(format('%I',field),',') INTO projection FROM unnest(d.fields) field;
  EXECUTE format('GRANT SELECT(%s) ON %s TO crest_provider_source_owner',projection,target::regclass);
  EXECUTE format('CREATE POLICY current_provider_source_scope ON %s FOR SELECT TO crest_provider_source_owner USING(actor_id=nullif(current_setting(''crest.provider_source_actor'',true),'''')::uuid%s)',target::regclass,CASE WHEN d.has_issuer THEN ' AND provider_issuer=nullif(current_setting(''crest.provider_source_issuer'',true),'''')' ELSE '' END);
 END LOOP;
END $grant$;
CREATE FUNCTION crest_commands.provider_source_page_v1(requested_business uuid,requested_actor uuid,expected_issuer text,requested_source text,expected_snapshot text,after_key text[],page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' SET bytea_output='hex' SET extra_float_digits=3 AS $source$
DECLARE d record; target oid; pk text[]; projection text; key_sql text; keys jsonb; data jsonb; token text; snapshot_value text; next_cursor jsonb; types jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='PROVIDER_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL OR requested_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR after_key IS NOT NULL AND(expected_snapshot IS NULL OR cardinality(after_key) NOT BETWEEN 1 AND 16 OR array_position(after_key,NULL) IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PROVIDER_SOURCE_REQUEST_REQUIRED';END IF;
 SELECT * INTO d FROM crest_private.provider_source_dictionary_v1() WHERE source_name=requested_source;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PROVIDER_SOURCE_REQUEST_REQUIRED';END IF;
 IF NOT coalesce(requested_actor=ANY(crest_private.business_identity_export_review(requested_business)),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PROVIDER_SOURCE_ACTOR_REQUIRED';END IF;
 PERFORM crest_commands.session_metadata_export_context(requested_actor,expected_issuer);
 PERFORM set_config('crest.provider_source_actor',requested_actor::text,true);PERFORM set_config('crest.provider_source_issuer',expected_issuer,true);
 snapshot_value:=pg_current_snapshot()::text;IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='PROVIDER_SOURCE_LIMIT';END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('crest.provider.rows/1',requested_business,requested_actor,expected_issuer,pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
 IF expected_snapshot IS NOT NULL AND expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PROVIDER_SOURCE_SNAPSHOT_CHANGED';END IF;
 target:=to_regclass(d.source_name);
 SELECT array_agg(a.attname::text ORDER BY key.position) INTO pk FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY key(number,position) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.number WHERE i.indrelid=target AND i.indisprimary;
 IF pk IS NULL OR cardinality(pk)>16 OR after_key IS NOT NULL AND cardinality(after_key)<>cardinality(pk) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PROVIDER_SOURCE_REQUEST_REQUIRED';END IF;
 SELECT string_agg(format('%L,%s',field,CASE WHEN a.atttypid='timestamptz'::regtype THEN format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',field) ELSE format('t.%I::text',field) END),',' ORDER BY position),jsonb_object_agg(field,format_type(a.atttypid,a.atttypmod)) INTO projection,types FROM unnest(d.fields) WITH ORDINALITY fields(field,position) JOIN pg_attribute a ON a.attrelid=target AND a.attname=field;
 SELECT 'ARRAY['||string_agg(format('t.%I::text',field),',' ORDER BY position)||']::text[]' INTO key_sql FROM unnest(pk) WITH ORDINALITY fields(field,position);
 EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),''[]''::jsonb),coalesce(jsonb_agg(to_jsonb(key) ORDER BY key COLLATE "C"),''[]''::jsonb) FROM(SELECT %s AS key,jsonb_build_object(%s) AS value FROM %s t WHERE t.actor_id=$1 AND %s AND($3::text[] IS NULL OR(%s COLLATE "C")>($3::text[] COLLATE "C")) ORDER BY %s COLLATE "C" LIMIT $4) bounded',key_sql,projection,target::regclass,CASE WHEN d.has_issuer THEN 't.provider_issuer=$2' ELSE '$2::text IS NOT NULL' END,key_sql,key_sql) INTO data,keys USING requested_actor,expected_issuer,after_key,page_size+1;
 IF jsonb_array_length(data)>page_size THEN data:=data-page_size;next_cursor:=keys->(page_size-1);END IF;
 IF octet_length(data::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='PROVIDER_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'providerIssuer',expected_issuer,'source',requested_source,'snapshotToken',token,'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'columns',d.fields,'types',types,'primaryKey',pk,'rows',data,'nextCursor',next_cursor);
END $source$;
ALTER FUNCTION crest_commands.provider_source_page_v1(uuid,uuid,text,text,text,text[],integer) OWNER TO crest_provider_source_owner;
REVOKE ALL ON FUNCTION crest_commands.provider_source_page_v1(uuid,uuid,text,text,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.provider_source_page_v1(uuid,uuid,text,text,text,text[],integer) TO crest_export;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_provider_source_owner;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.export_jobs DROP CONSTRAINT export_jobs_profile_schema_check;
ALTER TABLE crest_private.export_jobs ADD CONSTRAINT export_jobs_profile_schema_check CHECK((profile='crest.business-source-journal-bundle.v1' AND source_schema_version=43) OR(profile='crest.current-business-source-bundle.v1' AND source_schema_version IN(134,135)));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_source_schema_version_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_source_schema_version_check CHECK(source_schema_version IN(43,134,135));
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
 IF o.command_type='export.request' AND r->'job'->>'profile'='crest.current-business-source-bundle.v1' AND r->'job'->'source_schema_version' IN('134'::jsonb,'135'::jsonb) THEN
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
 AND ((v->'reference'->>'profile'='crest.business-source-journal-bundle.v1' AND v->'reference'->'sourceSchemaVersion'='43'::jsonb) OR (v->'reference'->>'profile'='crest.current-business-source-bundle.v1' AND v->'reference'->'sourceSchemaVersion' IN('134'::jsonb,'135'::jsonb))),false);
END $$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.request_current_source_export_v2_for_execution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_job uuid,requested_release text)
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
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType','export.request','businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',NULL::text,'leaseId',NULL::uuid,'appReleaseId',requested_release,'profile','crest.current-business-source-bundle.v1','sourceSchemaVersion',135)::text,'UTF8')),'hex');
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
  INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(requested_job,requested_business,expected_actor,'crest.current-business-source-bundle.v1',requested_release,135,expected_epoch,requested_operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO j;
  after_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'export_jobs',requested_job,j.version,'request',jsonb_build_object('schemaVersion',1,'before',NULL,'after',after_state),'manual') RETURNING id INTO event;
  receipt:=jsonb_build_object('schemaVersion',1,'command',jsonb_set(jsonb_set(crest_private.source_export_command('export.request',requested_business,expected_epoch,requested_operation,requested_job,NULL::text,NULL::uuid,requested_release),'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}','135'::jsonb),'job',after_state,'auditEventId',event);
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
REVOKE ALL ON FUNCTION crest_commands.request_current_source_export_v2_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_current_source_export_v2_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.request_current_source_export_v2_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
