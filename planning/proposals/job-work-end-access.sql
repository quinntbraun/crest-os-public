-- Held signed-in observation and recovery for the final completion-time correction.
-- Runtime access is granted only with migration, export and restore adoption.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','7024416ad87bb0581c5011f1e623dc9c2746e02b24351c0d2fd066bee44b521b'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','e87c85cf12fddb1626b09fc2d7b4252163a58545c5e5d27d95e02538861330f3')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_END_ACCESS_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_commands.read_job_work_end(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; context jsonb; work jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_END_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 context:=crest_private.job_work_end_context(requested_business,expected_actor,requested_job);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF context IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 work:=context->'currentWork';
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',requested_job,
  'jobVersion',context->'jobVersion','completionEventId',context->'completionEventId','workVersionId',work->'id',
  'originalCompletedAt',context->'originalCompletedAt','completedAt',work->'ended_at',
  'finalIntervalStartedAt',work->'started_at','finalIntervalKind',work->'kind');
END $read$;
ALTER FUNCTION crest_commands.read_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_WORK_END_ACCESS_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.job.work_end.correct' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','workVersionId','completionEventId'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') AND crest_private.original_operation_uuid(r->'recoveryEpoch')
   AND crest_private.original_operation_uuid(r->'jobId') AND crest_private.original_operation_version(r->'expectedJobVersion',false)
   AND r->>'expectedJobVersion'<>'9223372036854775807' AND crest_private.original_operation_uuid(r->'workVersionId')
   AND crest_private.original_operation_uuid(r->'completionEventId'),false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_work_end_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; reference jsonb; saved jsonb; receipt jsonb; operation uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF original->>'commandType' IS DISTINCT FROM 'operations.job.work_end.correct'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_END_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 reference:=original->'reference';operation:=(reference->>'operationId')::uuid;
 saved:=crest_private.work_end_result(requested_business,expected_actor,operation);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 IF receipt->'recoveryEpoch' IS DISTINCT FROM reference->'recoveryEpoch' OR receipt->'jobId' IS DISTINCT FROM reference->'jobId'
  OR (receipt->>'jobVersion')::bigint IS DISTINCT FROM (reference->>'expectedJobVersion')::bigint+1
  OR receipt->'work'->'replaces_id' IS DISTINCT FROM reference->'workVersionId'
  OR receipt->'completionEventId' IS DISTINCT FROM reference->'completionEventId'
 THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_end.correct','businessId',requested_business,
   'actorId',expected_actor,'operationId',operation,'recoveryEpoch',reference->'recoveryEpoch','subjectId',reference->'jobId',
   'sourceRecordId',reference->'jobId','sourceVersion',receipt->'jobVersion','sourceAuditIds',receipt->'auditIds')));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_work_end_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_work_end_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_WORK_END_ACCESS_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.job.work_end.correct' THEN
  RETURN crest_commands.lookup_work_end_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
