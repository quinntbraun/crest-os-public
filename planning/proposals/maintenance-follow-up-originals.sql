-- P10/BR10 reuse of Crest's exact interrupted-save lookup and retirement.
-- Opaque references carry no dates, notes, recipient information, or draft.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','53289985fd8e9cc20363d9281fcf038a051145e5fa724d9f3e04c3346bc11676'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','7d692ed409998217e608e6a418be8f12da0dd2120a17376367ba80b7cdc98e7b'),
  ('crest_private.operation_retirement_result(uuid,uuid,jsonb)','crest_schema_owner',false,'v','b4333c16f147af24b46b36652c0aea60f36a0e104e93c8f8ffff9e4aafd85100')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) OR to_regprocedure('crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED';END IF;
END $review$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.follow_up.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','taskId','expectedVersion','action'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r ?& keys) OR r-keys<>'{}'::jsonb
   OR crest_private.original_operation_uuid(r->'operationId') IS NOT TRUE
   OR crest_private.original_operation_uuid(r->'recoveryEpoch') IS NOT TRUE
   OR crest_private.original_operation_uuid(r->'taskId') IS NOT TRUE
   OR crest_private.original_operation_version(r->'expectedVersion',true) IS NOT TRUE
   OR coalesce(r->>'action','') NOT IN ('created','snoozed','completed','dismissed')
  THEN RETURN false;END IF;
  RETURN (r->>'expectedVersion')::numeric<9223372036854775807
   AND (r->>'action'='created')=(r->>'expectedVersion'='0');
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_maintenance_follow_up_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.follow_up.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_ORIGINAL_REQUIRED';END IF;
 reference:=original->'reference';
 saved:=crest_commands.lookup_maintenance_follow_up($1,$2,$3,$4,$5,$6,$7,$8,
  (reference->>'recoveryEpoch')::uuid,(reference->>'operationId')::uuid,(reference->>'taskId')::uuid,
  (reference->>'expectedVersion')::bigint,reference->>'action');
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.follow_up.save','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'taskId','sourceRecordId',receipt->'record'->'eventId',
   'sourceVersion',receipt->'record'->'version','sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_maintenance_follow_up_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_maintenance_follow_up_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.follow_up.save' THEN
  RETURN crest_commands.lookup_maintenance_follow_up_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
