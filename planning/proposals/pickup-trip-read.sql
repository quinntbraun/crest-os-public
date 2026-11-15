-- Held with pickup-trip.sql. The application receives only this job's pickup
-- trips and a minimal, independently verified original-operation receipt.
RESET ROLE;
DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.custody.policy.revise' in source)=0 OR position('operations.pickup_trip.record' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.pickup_trip.record' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','legId','expectedLegVersionId','action'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb
   OR jsonb_typeof(r->'expectedJobVersion') IS DISTINCT FROM 'string'
   OR (r->>'expectedJobVersion')!~'^[1-9][0-9]{0,18}$'
  THEN RETURN false; END IF;
  RETURN coalesce((r->>'expectedJobVersion')::numeric<9223372036854775807
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobId') IS TRUE
   AND crest_private.original_operation_uuid(r->'legId') IS TRUE
   AND (r->>'action'='depart' AND r->'expectedLegVersionId'='null'::jsonb
    OR r->>'action' IN('arrive','cancel') AND crest_private.original_operation_uuid(r->'expectedLegVersionId') IS TRUE),false);
 END IF;
$case$);
END $reference$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_pickup_trip_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; request jsonb; receipt jsonb; leg jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_trip.record'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_REFERENCE_REVIEW_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_trip_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 request:=saved->'request';receipt:=saved->'receipt';leg:=receipt->'leg';
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR reference IS DISTINCT FROM jsonb_build_object('operationId',leg->'operation_id','recoveryEpoch',request->'recoveryEpoch',
   'jobId',request->'jobId','expectedJobVersion',request->'jobVersion','legId',request->'legId',
   'expectedLegVersionId',request->'expectedLegVersionId','action',request->'body'->'action')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_REFERENCE_REVIEW_REQUIRED'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_trip.record','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',leg->'logical_id','sourceRecordId',leg->'id','sourceVersion',leg->'sequence',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;

CREATE FUNCTION crest_commands.read_pickup_trips(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,
 before_departed_at timestamptz,before_leg uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 IF requested_job IS NULL OR (before_departed_at IS NULL)<>(before_leg IS NULL)
  OR (before_departed_at IS NOT NULL AND NOT isfinite(before_departed_at))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_READ_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),
  set_config('crest.actor_id',authority->>'actorId',true),set_config('crest.operation_id','',true);
 WITH job AS (
  SELECT j.id,j.business_id,j.customer_id,j.version,j.state
  FROM crest.jobs j JOIN crest.fulfillment_mode_versions m ON m.business_id=j.business_id AND m.id=j.mode_version_id
  WHERE j.business_id=requested_business AND j.id=requested_job AND j.operator_actor_id=expected_actor
   AND j.fulfillment_mode='pickup_return' AND m.pickup_return_enabled
 ), page AS (
  SELECT l.* FROM crest.current_travel_legs l JOIN job j ON l.business_id=j.business_id AND l.job_context_id=j.id
  WHERE l.purpose='pickup' AND l.operator_actor_id=expected_actor
   AND (before_leg IS NULL OR (l.departed_at,l.logical_id)<(before_departed_at,before_leg))
  ORDER BY l.departed_at DESC,l.logical_id DESC LIMIT 21
 ), displayed AS (
  SELECT p.logical_id,p.departed_at,
   (crest_private.pickup_trip_original(requested_business,expected_actor,p.operation_id)->'receipt') ||
    jsonb_build_object('drivenVehicleLabel',v.label) receipt
  FROM page p JOIN crest.vehicles v ON v.business_id=p.business_id AND v.id=p.driven_vehicle_id
  ORDER BY p.departed_at DESC,p.logical_id DESC LIMIT 20
 )
 SELECT jsonb_build_object('schemaVersion',1,'state','loaded','businessId',j.business_id,'jobId',j.id,
  'jobVersion',j.version::text,'jobState',j.state,'customerId',j.customer_id,
  'activeLegId',(SELECT l.logical_id FROM crest.current_travel_legs l WHERE l.business_id=j.business_id
   AND l.job_context_id=j.id AND l.operator_actor_id=expected_actor AND l.purpose='pickup' AND l.state='open'),
  'trips',coalesce((SELECT jsonb_agg(d.receipt ORDER BY d.departed_at DESC,d.logical_id DESC) FROM displayed d),'[]'::jsonb),
  'hasMore',(SELECT count(*)>20 FROM page)) INTO result FROM job j;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_trip_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_pickup_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_pickup_trip_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb),
 crest_commands.read_pickup_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_pickup_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid) TO crest_web;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.custody.policy.revise' in source)=0 OR position('operations.pickup_trip.record' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.pickup_trip.record' THEN
  RETURN crest_commands.lookup_pickup_trip_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
