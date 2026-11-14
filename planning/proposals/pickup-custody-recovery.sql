-- Opaque original identity and minimized receipt for a collected vehicle.
RESET ROLE;
DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.pickup_trip.record' in source)=0 OR position('operations.pickup_custody.collect' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_COLLECTION_REFERENCE_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.pickup_custody.collect' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','jobVehicleId','pickupLegVersionId','policyId'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb
   OR jsonb_typeof(r->'expectedJobVersion') IS DISTINCT FROM 'string'
   OR (r->>'expectedJobVersion')!~'^[1-9][0-9]{0,18}$'
  THEN RETURN false; END IF;
  RETURN coalesce((r->>'expectedJobVersion')::numeric<9223372036854775807
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobId') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobVehicleId') IS TRUE
   AND crest_private.original_operation_uuid(r->'pickupLegVersionId') IS TRUE
   AND crest_private.original_operation_uuid(r->'policyId') IS TRUE,false);
 END IF;
$case$);
END $reference$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_pickup_collection_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; request jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.collect'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_COLLECTION_REFERENCE_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_collection_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 request:=saved->'request';receipt:=saved->'receipt';
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR reference IS DISTINCT FROM request-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_REFERENCE_REQUIRED'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.collect','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'jobVehicleId','sourceRecordId',receipt->'collection'->'id','sourceVersion','1',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_collection_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_pickup_collection_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.pickup_trip.record' in source)=0 OR position('operations.pickup_custody.collect' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_COLLECTION_REFERENCE_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.pickup_custody.collect' THEN
  RETURN crest_commands.lookup_pickup_collection_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
