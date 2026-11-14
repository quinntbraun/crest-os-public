-- Held signed-in observation and exact original review for a Mobile departure.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','c3c522a6afa3f9e42912928ea54909245cad1bf786e83dc954611aa85415dcad'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','85bb33cc5979e2e1d29110dac6a56c4adbb34c29d6f07d0776297bd07cf847b8')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MOBILE_DEPARTURE_ACCESS_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_commands.read_mobile_departure(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_leg uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; context jsonb; trip jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL OR requested_leg IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MOBILE_DEPARTURE_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 context:=crest_private.mobile_trip_departure_context(requested_business,expected_actor,requested_job,requested_leg);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF context IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 trip:=context->'currentTrip';
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',requested_job,'jobVersion',context->'jobVersion',
  'legId',requested_leg,'legVersionId',trip->'id','departureEventId',context->'departureEventId',
  'originalDepartedAt',context->'originalDepartedAt','departedAt',trip->'departed_at','arrivedAt',trip->'arrived_at','legState',trip->'state');
END $read$;
ALTER FUNCTION crest_commands.read_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_MOBILE_DEPARTURE_ACCESS_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.mobile_departure.correct' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','legId','legVersionId','departureEventId'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') AND crest_private.original_operation_uuid(r->'recoveryEpoch')
   AND crest_private.original_operation_uuid(r->'jobId') AND crest_private.original_operation_version(r->'expectedJobVersion',false)
   AND crest_private.original_operation_uuid(r->'legId') AND crest_private.original_operation_uuid(r->'legVersionId')
   AND crest_private.original_operation_uuid(r->'departureEventId'),false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_mobile_departure_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; reference jsonb; saved jsonb; receipt jsonb; operation uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF original->>'commandType' IS DISTINCT FROM 'operations.mobile_departure.correct'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MOBILE_DEPARTURE_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 reference:=original->'reference';operation:=(reference->>'operationId')::uuid;
 saved:=crest_private.mobile_departure_result(requested_business,expected_actor,operation);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 IF receipt->'recoveryEpoch' IS DISTINCT FROM reference->'recoveryEpoch' OR receipt->'jobId' IS DISTINCT FROM reference->'jobId'
  OR receipt->'jobVersion' IS DISTINCT FROM reference->'expectedJobVersion' OR receipt->'legId' IS DISTINCT FROM reference->'legId'
  OR receipt->'leg'->'replaces_id' IS DISTINCT FROM reference->'legVersionId'
  OR receipt->'departureEventId' IS DISTINCT FROM reference->'departureEventId'
 THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.mobile_departure.correct','businessId',requested_business,
   'actorId',expected_actor,'operationId',operation,'recoveryEpoch',reference->'recoveryEpoch','subjectId',reference->'legId',
   'sourceRecordId',receipt->'leg'->'id','sourceVersion',receipt->'leg'->'sequence','sourceAuditIds',receipt->'auditIds')));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_mobile_departure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_mobile_departure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_MOBILE_DEPARTURE_ACCESS_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.mobile_departure.correct' THEN
  RETURN crest_commands.lookup_mobile_departure_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
