-- BR08 Pickup + Return work-site transport, work, return and custody queue.
-- The source boundaries below preserve reviewed construction order.

-- pickup-worksite-transport.sql
-- Held BR08 work-site transport. A completed pickup leg records operator
-- arrival only. A separate leg may carry vehicles whose custody is recorded.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.pickup_transport_collected(business uuid,job uuid,targets jsonb,stamp timestamptz,require_held boolean)
 RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $collected$
 SELECT coalesce(jsonb_array_length(targets)>0 AND count(*)=jsonb_array_length(targets),false)
 FROM crest_private.pickup_custody_collections collection
 WHERE collection.business_id=business AND collection.job_id=job AND targets ? collection.job_vehicle_id::text
  AND collection.recorded_at<=stamp
  AND (NOT require_held OR EXISTS(
   SELECT 1 FROM crest_private.vehicle_custody_claims claim
   WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)
    =(collection.business_id,collection.vehicle_id,collection.id)
  ))
$collected$;
REVOKE ALL ON FUNCTION crest_private.pickup_transport_collected(uuid,uuid,jsonb,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_transport_collected(uuid,uuid,jsonb,timestamptz,boolean)
 TO crest_booking_owner,crest_booking_integrity_owner;
CREATE FUNCTION crest_private.pickup_return_destination(business uuid,job uuid,targets jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $destination$
 SELECT vehicle.return_location_snapshot
 FROM crest.job_vehicles vehicle
 WHERE vehicle.business_id=business AND vehicle.job_id=job
  AND targets ? vehicle.id::text AND vehicle.return_location_snapshot IS NOT NULL
 GROUP BY vehicle.return_location_snapshot
 HAVING count(*)=jsonb_array_length(targets)
$destination$;
REVOKE ALL ON FUNCTION crest_private.pickup_return_destination(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_destination(uuid,uuid,jsonb)
 TO crest_booking_owner,crest_booking_integrity_owner;
CREATE FUNCTION crest_private.pickup_arrived_vehicles(business uuid,job uuid,travel_purpose text)
 RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $arrived$
 SELECT DISTINCT target.id::uuid
 FROM crest.current_travel_legs leg
 JOIN crest_private.operations operation ON (operation.business_id,operation.operation_id,operation.actor_id)
  =(leg.business_id,leg.operation_id,leg.created_by)
 CROSS JOIN LATERAL jsonb_array_elements_text(operation.result->'receipt'->'jobVehicleIds') target(id)
 WHERE leg.business_id=business AND leg.job_context_id=job AND leg.purpose=travel_purpose AND leg.state='closed'
  AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'
$arrived$;
REVOKE ALL ON FUNCTION crest_private.pickup_arrived_vehicles(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_arrived_vehicles(uuid,uuid,text) TO crest_booking_owner;
RESET ROLE;

CREATE OR REPLACE FUNCTION crest_private.valid_pickup_trip_body(body jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $validate$
DECLARE action text := body->>'action'; trip jsonb := body->'trip';
 targets jsonb := trip->'jobVehicleIds'; keys text[] := ARRAY['action', 'reason', 'trip'];
BEGIN
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT body ?& keys OR body-keys <> '{}'::jsonb
  OR action IS NULL OR action NOT IN ('depart', 'arrive', 'cancel')
  OR NOT coalesce(body->'reason' = 'null'::jsonb AND action <> 'cancel'
    OR crest_private.booking_text_required(body->'reason', 1000), false)
 THEN RETURN false; END IF;
 IF action = 'arrive' THEN RETURN trip = 'null'::jsonb; END IF;
 IF jsonb_typeof(trip) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF action = 'cancel' THEN
  RETURN trip ? 'actualStop' AND trip-'actualStop' = '{}'::jsonb
   AND crest_private.valid_support_location(trip->'actualStop');
 END IF;
 IF jsonb_typeof(targets) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 RETURN jsonb_array_length(targets) > 0
  AND (SELECT count(DISTINCT target) FROM jsonb_array_elements(targets) AS rows(target)) = jsonb_array_length(targets)
  AND NOT EXISTS (SELECT FROM jsonb_array_elements(targets) AS rows(target)
    WHERE crest_private.booking_uuid(target) IS NOT TRUE)
  AND (NOT trip ? 'purpose' OR coalesce(trip->>'purpose' IN ('to_work_site','return_to_customer'),false))
  AND crest_private.valid_field_session_body((body-'trip') || jsonb_build_object('trip', trip-ARRAY['jobVehicleIds','purpose']));
END $validate$;

CREATE OR REPLACE FUNCTION crest_private.pickup_trip_original(business uuid, actor uuid, operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $original$
DECLARE saved record; leg crest.travel_legs; departure crest.travel_legs;
 audit record; request jsonb; body jsonb; departure_body jsonb; targets jsonb;
 before_leg jsonb := 'null'::jsonb; receipt jsonb; action text;
BEGIN
 SELECT state, schema_version, result_schema_version, result, payload_hash, recovery_epoch, created_at INTO saved
 FROM crest_private.operations
 WHERE business_id = business AND actor_id = actor AND operation_id = operation
  AND command_type = 'operations.pickup_trip.record';
 IF NOT FOUND THEN RETURN jsonb_build_object('state', 'absent'); END IF;
 IF saved.state <> 'committed' THEN RETURN jsonb_build_object('state', 'unresolved'); END IF;

 SELECT * INTO STRICT leg FROM crest.travel_legs
 WHERE business_id = business AND created_by = actor AND operation_id = operation;
 SELECT * INTO STRICT departure FROM crest.travel_legs
 WHERE business_id = business AND id = leg.logical_id;
 SELECT a.id, a.entity_kind, a.entity_id, a.entity_version, a.action, a.reason, a.delta, a.origin, a.import_row_id, a.created_by, a.actor_id INTO STRICT audit
 FROM crest_private.audit_events a WHERE a.business_id = business AND a.operation_id = operation;
 request := saved.result->'request';
 body := request->'body';
 action := body->>'action';
 IF leg.replaces_id IS NULL THEN
  departure_body := body;
 ELSE
  IF departure.id = leg.id OR departure.replaces_id IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CREST_PICKUP_DEPARTURE_REQUIRED';
  END IF;
  departure_body := crest_private.pickup_trip_original(business, actor, departure.operation_id)->'departure';
  before_leg := crest_private.field_travel_projection(departure);
 END IF;
 targets := departure_body->'trip'->'jobVehicleIds';
 receipt := jsonb_build_object('leg', crest_private.field_travel_projection(leg),
  'jobVehicleIds', targets, 'auditId', audit.id, 'departure', departure_body);

 IF saved.schema_version <> 1 OR saved.result_schema_version <> 1
  OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion', 1, 'request', request, 'receipt', receipt)
  OR crest_private.valid_pickup_trip_body(body) IS NOT TRUE
  OR request IS DISTINCT FROM jsonb_build_object('schemaVersion', 1, 'commandType', 'operations.pickup_trip.record',
    'businessId', business, 'actorId', actor, 'recoveryEpoch', saved.recovery_epoch, 'jobId', leg.job_context_id,
    'jobVersion', request->>'jobVersion', 'legId', leg.logical_id, 'expectedLegVersionId', leg.replaces_id, 'body', body)
  OR coalesce(request->>'jobVersion', '') !~ '^[1-9][0-9]{0,18}$'
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text, 'UTF8')), 'hex')
  OR leg.purpose NOT IN ('pickup','to_work_site','return_to_customer') OR leg.purpose <> coalesce(departure_body->'trip'->>'purpose','pickup')
  OR leg.operator_actor_id <> actor OR leg.job_context_id IS NULL
  OR leg.change_kind IS DISTINCT FROM action OR leg.reason IS DISTINCT FROM body->>'reason'
  OR departure.job_context_id IS DISTINCT FROM leg.job_context_id OR departure.purpose IS DISTINCT FROM leg.purpose
  OR audit.entity_kind <> 'travel_legs' OR audit.entity_id <> leg.logical_id OR audit.entity_version <> leg.sequence
  OR audit.action IS DISTINCT FROM (CASE WHEN action = 'depart' THEN 'create' ELSE action END)
  OR audit.reason IS DISTINCT FROM leg.reason OR audit.created_by <> actor OR audit.actor_id <> actor
  OR audit.origin <> 'manual' OR audit.import_row_id IS NOT NULL
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion', 1, 'before', before_leg, 'after', crest_private.field_travel_projection(leg))
 THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CREST_PICKUP_TRIP_RESULT_REQUIRED'; END IF;

 IF action = 'depart' THEN
  IF leg.id <> leg.logical_id OR leg.sequence <> 1 OR leg.replaces_id IS NOT NULL OR leg.state <> 'open'
   OR leg.departed_at NOT BETWEEN saved.created_at AND leg.created_at
   OR leg.driven_vehicle_id::text IS DISTINCT FROM body->'trip'->>'drivenVehicleId'
   OR leg.origin_snapshot IS DISTINCT FROM body->'trip'->'origin'
   OR leg.destination_snapshot IS DISTINCT FROM (CASE leg.purpose
    WHEN 'pickup' THEN crest_private.pickup_trip_destination(business, leg.job_context_id, targets)
    WHEN 'to_work_site' THEN (SELECT work_location_snapshot FROM crest.jobs WHERE business_id=business AND id=leg.job_context_id)
    WHEN 'return_to_customer' THEN crest_private.pickup_return_destination(business,leg.job_context_id,targets)
   END)
   OR leg.purpose IN ('to_work_site','return_to_customer') AND NOT crest_private.pickup_transport_collected(business,leg.job_context_id,targets,leg.departed_at,false)
   OR leg.eta_at IS DISTINCT FROM (body->'trip'->>'etaAt')::timestamptz
   OR leg.eta_source IS DISTINCT FROM (CASE WHEN leg.eta_at IS NOT NULL THEN 'owner_entered' END)
   OR leg.eta_calculated_at IS DISTINCT FROM (CASE WHEN leg.eta_at IS NOT NULL THEN leg.departed_at END)
   OR leg.notes IS DISTINCT FROM body->'trip'->>'notes'
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CREST_PICKUP_DEPARTURE_REQUIRED'; END IF;
 ELSE
  IF targets IS NULL OR leg.replaces_id IS DISTINCT FROM departure.id OR leg.sequence <> 2
   OR leg.arrived_at IS NULL OR leg.arrived_at NOT BETWEEN saved.created_at AND leg.created_at
   OR ROW(leg.driven_vehicle_id, leg.origin_snapshot, leg.departed_at, leg.eta_at, leg.eta_source, leg.eta_calculated_at, leg.notes)
    IS DISTINCT FROM ROW(departure.driven_vehicle_id, departure.origin_snapshot, departure.departed_at,
     departure.eta_at, departure.eta_source, departure.eta_calculated_at, departure.notes)
   OR leg.state IS DISTINCT FROM (CASE WHEN action = 'arrive' THEN 'closed' ELSE 'cancelled' END)
   OR leg.destination_snapshot IS DISTINCT FROM (CASE WHEN action = 'arrive' THEN departure.destination_snapshot ELSE body->'trip'->'actualStop' END)
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CREST_PICKUP_STOP_REQUIRED'; END IF;
 END IF;
 RETURN jsonb_build_object('state', 'committed', 'receipt', receipt - 'departure', 'departure', departure_body, 'request', request);
END $original$;

CREATE OR REPLACE FUNCTION crest_commands.record_pickup_trip(credential_hash bytea, expected_session uuid, expected_actor uuid,
 expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_job uuid,
 expected_job_version bigint, requested_leg uuid, expected_leg_version uuid, body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $record$
DECLARE context jsonb; request jsonb; digest text; claim uuid; existing record; result jsonb;
 job crest.jobs; family uuid; leg crest.travel_legs; prior crest.travel_legs;
 stamp timestamptz; action text := body->>'action'; trip jsonb := body->'trip';
 targets jsonb; departure_body jsonb; destination jsonb; eta timestamptz; purpose text;
 audit_id uuid; before_leg jsonb := 'null'::jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id', '', true), set_config('crest.actor_id', '', true), set_config('crest.operation_id', '', true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL
  OR expected_job_version IS NULL OR expected_job_version < 1 OR expected_job_version = 9223372036854775807 OR requested_leg IS NULL
  OR crest_private.valid_pickup_trip_body(body) IS NOT TRUE
  OR (action = 'depart') IS DISTINCT FROM (expected_leg_version IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CREST_PICKUP_TRIP_INPUT_REQUIRED'; END IF;
 context := crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id', context->>'businessId', true), set_config('crest.actor_id', context->>'actorId', true),
  set_config('crest.operation_id', requested_operation::text, true);
 request := jsonb_build_object('schemaVersion', 1, 'commandType', 'operations.pickup_trip.record',
  'businessId', requested_business, 'actorId', expected_actor, 'recoveryEpoch', expected_epoch,
  'jobId', requested_job, 'jobVersion', expected_job_version::text, 'legId', requested_leg,
  'expectedLegVersionId', expected_leg_version, 'body', body);
 digest := encode(sha256(convert_to(request::text, 'UTF8')), 'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id, operation_id, actor_id, command_type, schema_version, recovery_epoch, payload_hash, created_by, origin)
  VALUES (requested_business, requested_operation, expected_actor, 'operations.pickup_trip.record', 1, expected_epoch, digest, expected_actor, 'manual')
  ON CONFLICT (business_id, operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id, command_type, recovery_epoch, payload_hash INTO existing FROM crest_private.operations
   WHERE business_id = requested_business AND operation_id = requested_operation;
   IF NOT FOUND OR existing.actor_id <> expected_actor OR existing.command_type <> 'operations.pickup_trip.record'
    OR existing.recovery_epoch <> expected_epoch OR existing.payload_hash <> digest
   THEN RETURN jsonb_build_object('state', 'conflict', 'reason', 'operation'); END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:' || requested_business::text, 0));
   FOR family IN SELECT DISTINCT e.family_id FROM crest.job_encounters e
    WHERE e.business_id = requested_business AND e.job_id = requested_job ORDER BY e.family_id
   LOOP PERFORM crest_private.lock_booking_family(requested_business, family); END LOOP;
   SELECT * INTO job FROM crest.jobs WHERE business_id = requested_business AND id = requested_job;
   IF NOT FOUND OR job.operator_actor_id <> expected_actor OR job.fulfillment_mode <> 'pickup_return'
    OR NOT EXISTS (SELECT FROM crest.fulfillment_mode_versions mode WHERE mode.business_id = requested_business
      AND mode.id = job.mode_version_id AND mode.pickup_return_enabled)
   THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'job'; END IF;
   PERFORM crest_private.lock_booking_operator(requested_business, expected_actor);
   SELECT * INTO STRICT job FROM crest.jobs WHERE business_id = requested_business AND id = requested_job;
   IF job.version <> expected_job_version THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'job_version'; END IF;
   SELECT * INTO prior FROM crest.current_travel_legs WHERE business_id = requested_business AND logical_id = requested_leg;
   IF prior.id IS DISTINCT FROM expected_leg_version THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'leg_version'; END IF;
   purpose := CASE WHEN action='depart' THEN coalesce(trip->>'purpose','pickup') ELSE prior.purpose END;
   IF purpose='return_to_customer' AND job.state NOT IN ('completed','cancelled')
    OR purpose<>'return_to_customer' AND job.state<>'scheduled' AND NOT (action='cancel' AND job.state='cancelled')
   THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='state'; END IF;

   stamp := clock_timestamp();
   IF action = 'depart' THEN
    IF NOT EXISTS (SELECT FROM crest.vehicles WHERE business_id = requested_business
      AND id = (trip->>'drivenVehicleId')::uuid AND archived_at IS NULL)
    THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'vehicle'; END IF;
    targets := trip->'jobVehicleIds';
    IF purpose='return_to_customer' THEN
     IF NOT crest_private.pickup_transport_collected(requested_business,requested_job,targets,stamp,true)
     THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='custody'; END IF;
     IF EXISTS(
      SELECT 1 FROM crest_private.pickup_arrived_vehicles(requested_business,requested_job,purpose) earlier(vehicle)
      WHERE targets ? earlier.vehicle::text
     ) THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='already_at_return'; END IF;
     destination := crest_private.pickup_return_destination(requested_business,requested_job,targets);
     IF destination IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='return_location'; END IF;
    ELSIF purpose='to_work_site' THEN
     IF NOT crest_private.pickup_transport_collected(requested_business,requested_job,targets,stamp,true)
     THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='custody'; END IF;
     IF EXISTS(
      SELECT 1 FROM crest_private.pickup_arrived_vehicles(requested_business,requested_job,'to_work_site') earlier(vehicle)
      WHERE targets ? earlier.vehicle::text
     ) THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='already_at_work_site'; END IF;
     destination := job.work_location_snapshot;
    ELSE
     destination := crest_private.pickup_trip_destination(requested_business, requested_job, targets);
     IF destination IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'pickup_location'; END IF;
    END IF;
    IF EXISTS (SELECT FROM crest.current_travel_legs WHERE business_id = requested_business
      AND operator_actor_id = expected_actor AND state = 'open')
    THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'occupancy'; END IF;
    eta := (trip->>'etaAt')::timestamptz;
    departure_body := body;
    INSERT INTO crest.travel_legs(id, business_id, logical_id, sequence, operator_actor_id, driven_vehicle_id,
     job_context_id, purpose, origin_snapshot, destination_snapshot, departed_at, state, eta_at, eta_source,
     eta_calculated_at, notes, change_kind, reason, created_by, operation_id)
    VALUES (requested_leg, requested_business, requested_leg, 1, expected_actor, (trip->>'drivenVehicleId')::uuid,
     requested_job, purpose, trip->'origin', destination, stamp, 'open', eta,
     CASE WHEN eta IS NOT NULL THEN 'owner_entered' END, CASE WHEN eta IS NOT NULL THEN stamp END,
     trip->>'notes', action, body->>'reason', expected_actor, requested_operation) RETURNING * INTO leg;
   ELSE
    IF prior.job_context_id IS DISTINCT FROM requested_job OR prior.operator_actor_id <> expected_actor OR prior.purpose NOT IN ('pickup','to_work_site','return_to_customer')
    THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'leg'; END IF;
    IF prior.state <> 'open' OR prior.sequence <> 1 THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'state'; END IF;
    departure_body := crest_private.pickup_trip_original(requested_business, expected_actor, prior.operation_id)->'departure';
    targets := departure_body->'trip'->'jobVehicleIds';
    IF purpose='return_to_customer' AND NOT crest_private.pickup_transport_collected(requested_business,requested_job,targets,stamp,true)
    THEN RAISE EXCEPTION USING ERRCODE='P1942', MESSAGE='custody'; END IF;
    before_leg := crest_private.field_travel_projection(prior);
    INSERT INTO crest.travel_legs(business_id, logical_id, sequence, replaces_id, operator_actor_id, driven_vehicle_id,
     job_context_id, purpose, origin_snapshot, destination_snapshot, departed_at, arrived_at, state, eta_at, eta_source,
     eta_calculated_at, notes, change_kind, reason, created_by, operation_id)
    VALUES (requested_business, requested_leg, 2, prior.id, expected_actor, prior.driven_vehicle_id, requested_job,
     prior.purpose, prior.origin_snapshot, CASE WHEN action = 'cancel' THEN trip->'actualStop' ELSE prior.destination_snapshot END,
     prior.departed_at, stamp, CASE WHEN action = 'arrive' THEN 'closed' ELSE 'cancelled' END,
     prior.eta_at, prior.eta_source, prior.eta_calculated_at, prior.notes, action, body->>'reason', expected_actor, requested_operation)
    RETURNING * INTO leg;
   END IF;
   INSERT INTO crest_private.audit_events(business_id, operation_id, actor_id, created_by, entity_kind,
    entity_id, entity_version, action, reason, delta, origin)
   VALUES (requested_business, requested_operation, expected_actor, expected_actor, 'travel_legs',
    leg.logical_id, leg.sequence, CASE WHEN action = 'depart' THEN 'create' ELSE action END, leg.reason,
    jsonb_build_object('schemaVersion', 1, 'before', before_leg, 'after', crest_private.field_travel_projection(leg)), 'manual')
   RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state = 'committed', result_schema_version = 1,
    result = jsonb_build_object('schemaVersion', 1, 'request', request, 'receipt',
     jsonb_build_object('leg', crest_private.field_travel_projection(leg), 'jobVehicleIds', targets, 'auditId', audit_id, 'departure', departure_body))
   WHERE business_id = requested_business AND operation_id = requested_operation;
  END IF;
  result := crest_private.pickup_trip_original(requested_business, expected_actor, requested_operation) - ARRAY['departure','request'];
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1942' THEN
  GET STACKED DIAGNOSTICS conflict = MESSAGE_TEXT;
  RETURN jsonb_build_object('state', 'conflict', 'reason', conflict);
 WHEN exclusion_violation THEN RETURN jsonb_build_object('state', 'conflict', 'reason', 'occupancy');
 END;
END $record$;

CREATE OR REPLACE FUNCTION crest_commands.read_pickup_trips(
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
  WHERE l.purpose IN('pickup','to_work_site','return_to_customer') AND l.operator_actor_id=expected_actor
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
  'worksiteVehicleIds',coalesce((
   SELECT jsonb_agg(collection.job_vehicle_id ORDER BY collection.job_vehicle_id)
   FROM crest_private.pickup_custody_collections collection
   JOIN crest_private.vehicle_custody_claims claim
    ON (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(collection.business_id,collection.vehicle_id,collection.id)
   WHERE j.state='scheduled' AND collection.business_id=j.business_id AND collection.job_id=j.id
    AND NOT EXISTS(SELECT 1 FROM crest_private.pickup_arrived_vehicles(j.business_id,j.id,'to_work_site') earlier(vehicle)
     WHERE earlier.vehicle=collection.job_vehicle_id)
  ),'[]'::jsonb),
  'returnVehicleIds',coalesce((
   SELECT jsonb_agg(collection.job_vehicle_id ORDER BY collection.job_vehicle_id)
   FROM crest_private.pickup_custody_collections collection
   JOIN crest_private.vehicle_custody_claims claim
    ON (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(collection.business_id,collection.vehicle_id,collection.id)
   WHERE j.state IN ('completed','cancelled') AND collection.business_id=j.business_id AND collection.job_id=j.id
    AND NOT EXISTS(SELECT 1 FROM crest_private.pickup_arrived_vehicles(j.business_id,j.id,'return_to_customer') earlier(vehicle)
     WHERE earlier.vehicle=collection.job_vehicle_id)
  ),'[]'::jsonb),
  'activeLegId',(SELECT l.logical_id FROM crest.current_travel_legs l WHERE l.business_id=j.business_id
   AND l.job_context_id=j.id AND l.operator_actor_id=expected_actor AND l.purpose IN('pickup','to_work_site','return_to_customer') AND l.state='open'),
  'trips',coalesce((SELECT jsonb_agg(d.receipt ORDER BY d.departed_at DESC,d.logical_id DESC) FROM displayed d),'[]'::jsonb),
  'hasMore',(SELECT count(*)>20 FROM page)) INTO result FROM job j;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;


DO $source$
DECLARE definition text; old_check constant text:=$old$NEW.purpose <> 'pickup' OR NEW.change_kind NOT IN ('depart', 'arrive', 'cancel')$old$;
BEGIN
 definition := pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 IF length(definition)-length(replace(definition,old_check,''))<>length(old_check)
 THEN RAISE EXCEPTION 'CREST_PICKUP_WORKSITE_SOURCE_REQUIRED'; END IF;
 EXECUTE replace(definition,old_check,$new$NEW.purpose NOT IN ('pickup','to_work_site','return_to_customer') OR NEW.change_kind NOT IN ('depart', 'arrive', 'cancel')$new$);
END $source$;
RESET ROLE;

-- pickup-work-session.sql
-- Held BR07/BR08 work start, completion and no-fulfilled-work cancellation
-- after separately recorded transport to the work site.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.pickup_work_ready(business uuid,job uuid,stamp timestamptz,require_held boolean)
 RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $ready$
 SELECT EXISTS(SELECT 1 FROM crest.job_vehicles vehicle WHERE vehicle.business_id=business AND vehicle.job_id=job)
  AND NOT EXISTS(
   SELECT 1 FROM crest.job_vehicles vehicle
   WHERE vehicle.business_id=business AND vehicle.job_id=job AND NOT EXISTS(
    SELECT 1 FROM crest_private.pickup_custody_collections collection
    JOIN crest.travel_legs leg ON leg.business_id=collection.business_id AND leg.job_context_id=collection.job_id
    JOIN crest_private.operations operation ON (operation.business_id,operation.operation_id,operation.actor_id)
     =(leg.business_id,leg.operation_id,leg.created_by)
    WHERE (collection.business_id,collection.job_id,collection.job_vehicle_id,collection.vehicle_id)
     =(vehicle.business_id,vehicle.job_id,vehicle.id,vehicle.vehicle_id)
     AND collection.recorded_at<=leg.departed_at AND leg.arrived_at<=stamp
     AND leg.purpose='to_work_site' AND leg.state='closed' AND leg.change_kind='arrive'
     AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'
     AND operation.result->'receipt'->'jobVehicleIds' ? collection.job_vehicle_id::text
     AND (NOT require_held OR EXISTS(
      SELECT 1 FROM crest_private.vehicle_custody_claims claim
      WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)
       =(collection.business_id,collection.vehicle_id,collection.id)
     ))
   )
  )
$ready$;
REVOKE ALL ON FUNCTION crest_private.pickup_work_ready(uuid,uuid,timestamptz,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_work_ready(uuid,uuid,timestamptz,boolean) TO crest_booking_owner,crest_booking_integrity_owner;
RESET ROLE;

DO $review$
DECLARE entry record; replacement record; routine regprocedure; definition text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_commands.read_pickup_trips(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, timestamp with time zone, uuid)',
   'crest_booking_owner',true,'v','02e8728014e6fa9cff8edf5905a6b4f6eb65347040f8300fc4bb08bca74a0a72',$map$[{"marker":"  'worksiteVehicleIds',coalesce((","value":"  'worksiteReady',j.state='scheduled' AND crest_private.pickup_work_ready(requested_business,j.id,statement_timestamp(),true),\n  'worksiteVehicleIds',coalesce((","occurrences":1}]$map$::jsonb),
  ('crest_commands.read_pickup_collection(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid)',
   'crest_booking_owner',true,'v','2be63ad9d6b9f5113da21e3b2fccf8777898155d8906522fc95378bdd7f82e09',$map$[{"marker":"status:=CASE WHEN job.state='cancelled' THEN 'return_required' ELSE 'held' END;","value":"status:=CASE job.state WHEN 'cancelled' THEN 'return_required' WHEN 'completed' THEN 'awaiting_return' ELSE 'held' END;","occurrences":1}]$map$::jsonb),
  ('crest_commands.cancel_unfulfilled_job(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, integer, uuid, bigint, jsonb)','crest_booking_owner',true,'v','84c753a17368c0703685d83db8c1673187afc6e70243f2f11a717b9eed13f72b',$map$[
  {
    "marker": "before_job.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "before_job.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_commands.change_field_session(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, integer, uuid, bigint, jsonb)','crest_booking_owner',true,'v','a0c2b33ff16fd0614e9804b99a38db729ee3418143fbedcbb556a4d2c7d0209f',$map$[
  {
    "marker": "    OR j.fulfillment_mode='dropoff' AND action='start_dropoff' AND j.state='scheduled' AND j.first_work_at IS NULL",
    "value": "    OR j.fulfillment_mode='dropoff' AND action='start_dropoff' AND j.state='scheduled' AND j.first_work_at IS NULL\n    OR j.fulfillment_mode='pickup_return' AND action='start_pickup' AND j.state='scheduled' AND j.first_work_at IS NULL",
    "occurrences": 1
  },
  {
    "marker": "j.fulfillment_mode IN('mobile','dropoff')",
    "value": "j.fulfillment_mode IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  },
  {
    "marker": "   IF action='start_dropoff' AND NOT crest_private.dropoff_work_ready(requested_business,j.id,stamp)",
    "value": "   IF action='start_pickup' AND NOT crest_private.pickup_work_ready(requested_business,j.id,stamp,true)\n   THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='custody';END IF;\n   IF action='start_dropoff' AND NOT crest_private.dropoff_work_ready(requested_business,j.id,stamp)",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_commands.complete_job(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid, uuid, integer, uuid, bigint, jsonb)','crest_booking_owner',true,'v','bd37c11aa0a94e3b3bd1adb53f40e9809ccdfc31dad495f1ce2db0ac71d7d6bd',$map$[
  {
    "marker": "j.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "j.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_commands.read_job_completion_context(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid)','crest_booking_owner',true,'v','2a640a10855db3cbe24aa886268cb2fa6f43a22587ae78599bea4177f915e3f6',$map$[
  {
    "marker": "j.fulfillment_mode IN('mobile','dropoff')",
    "value": "j.fulfillment_mode IN('mobile','dropoff','pickup_return')",
    "occurrences": 2
  }
]$map$::jsonb),
  ('crest_commands.read_unfulfilled_cancellation_context(bytea, uuid, uuid, text, uuid, uuid, timestamp with time zone, uuid, uuid)','crest_booking_owner',true,'v','eea6db39fc156df075b7b0778d7dbb750de224a9b11f2840e880ee6f1f0d0323',$map$[
  {
    "marker": "j.fulfillment_mode IN('mobile','dropoff')",
    "value": "j.fulfillment_mode IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.check_completed_job_graph(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'v','13577757d5719ab599d224587ac9cbd695e2c20dd9bc0e8d4ba45016ea0762fc',$map$[
  {
    "marker": "j.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "j.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.check_field_session_graph(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'v','04839f7b364bf1d95ecf4e92845ab6f15ed2a90546a162b56cd61cfd00d6ee62',$map$[
  {
    "marker": "OR j.fulfillment_mode='dropoff' AND action IN('start_dropoff','pause','resume'))",
    "value": "OR j.fulfillment_mode='dropoff' AND action IN('start_dropoff','pause','resume')\n     OR j.fulfillment_mode='pickup_return' AND action IN('start_pickup','pause','resume'))",
    "occurrences": 1
  },
  {
    "marker": "action IN('direct_arrive','arrive','start_dropoff')",
    "value": "action IN('direct_arrive','arrive','start_dropoff','start_pickup')",
    "occurrences": 2
  },
  {
    "marker": "   OR action='start_dropoff' AND NOT crest_private.dropoff_work_ready(business,job,e.effective_at)",
    "value": "   OR action='start_dropoff' AND NOT crest_private.dropoff_work_ready(business,job,e.effective_at)\n   OR action='start_pickup' AND NOT crest_private.pickup_work_ready(business,job,e.effective_at,false)",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.field_session_result(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'s','c6a883241a4deba36562f83ed35ceb6055e4bc911af670ece3fe52ebe31577d5',$map$[
  {
    "marker": "'direct_arrive','depart','start_dropoff'",
    "value": "'direct_arrive','depart','start_dropoff','start_pickup'",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'v','bc177a0e5ac4b76a62813483a9530e7509f189541dbdee9ebad9fcfe4b2c3b3b',$map$[
  {
    "marker": "AND fulfillment_mode IN('mobile','dropoff') AND first_work_at IS NOT NULL",
    "value": "AND fulfillment_mode IN('mobile','dropoff','pickup_return') AND first_work_at IS NOT NULL",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','ab90587c2e5b0f9e3547e72128c8907904916fb288b3a5c7251d0b08dcbc2ac8',$map$[
  {
    "marker": "'pause','resume','start_dropoff'",
    "value": "'pause','resume','start_dropoff','start_pickup'",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'v','9938de6faf801dd0cd5141640ae204468de8469ec66d180ad0aaed4312fe030f',$map$[
  {
    "marker": "OLD.fulfillment_mode NOT IN('mobile','dropoff')",
    "value": "OLD.fulfillment_mode NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.unfulfilled_job_result(uuid, uuid, uuid)','crest_booking_integrity_owner',true,'s','f77297d7137886eb3fdac18e8fc784bf632151f49dab225c53941a03549d1f4a',$map$[
  {
    "marker": "before_job->>'fulfillment_mode' NOT IN('mobile','dropoff')",
    "value": "before_job->>'fulfillment_mode' NOT IN('mobile','dropoff','pickup_return')",
    "occurrences": 1
  }
]$map$::jsonb),
  ('crest_private.valid_field_session_body(jsonb)','crest_schema_owner',false,'i','1bdde85caafda3cd7b44b446846c246d2ac2ef61651d3468c43d9189e6d8a129',$map$[
  {
    "marker": "'pause','resume','start_dropoff'",
    "value": "'pause','resume','start_dropoff','start_pickup'",
    "occurrences": 1
  },
  {
    "marker": "'arrive','resume','start_dropoff'",
    "value": "'arrive','resume','start_dropoff','start_pickup'",
    "occurrences": 1
  }
]$map$::jsonb)
 ) expected(signature,owner,security_definer,volatility,digest,replacements) LOOP
  routine:=to_regprocedure(entry.signature);
  IF NOT EXISTS(
   SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=routine AND p.proowner=entry.owner::regrole AND p.prosecdef=entry.security_definer
    AND p.provolatile::text=entry.volatility AND NOT p.proleakproof AND l.lanname='plpgsql'
    AND p.proconfig=CASE WHEN entry.security_definer THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
     ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.digest
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PICKUP_WORK_SOURCE_REVIEW_REQUIRED',DETAIL=entry.signature;END IF;
  definition:=pg_get_functiondef(routine);
  FOR replacement IN SELECT * FROM jsonb_to_recordset(entry.replacements) AS mapping(marker text,value text,occurrences integer) LOOP
   IF (length(definition)-length(replace(definition,replacement.marker,'')))/length(replacement.marker)<>replacement.occurrences
   THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PICKUP_WORK_SOURCE_REVIEW_REQUIRED',DETAIL=entry.signature;END IF;
   definition:=replace(definition,replacement.marker,replacement.value);
  END LOOP;
  EXECUTE definition;
 END LOOP;
END $review$;
RESET ROLE;

-- pickup-custody-release.sql
-- Held BR08 pickup return handoff. A trip arrival leaves custody open.
-- The immutable handoff is the only pickup operation that releases its claim.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest_private.pickup_custody_collections
 ADD CONSTRAINT pickup_collection_release_identity UNIQUE(business_id,id,job_id,job_vehicle_id,vehicle_id,policy_id);

ALTER TABLE crest_private.pickup_photo_slots
 ADD COLUMN return_collection_id uuid,
 ADD FOREIGN KEY(business_id,return_collection_id) REFERENCES crest_private.pickup_custody_collections(business_id,id),
 ADD CHECK(return_collection_id IS NULL OR return_collection_id<>collection_id);

CREATE TABLE crest_private.pickup_custody_releases(
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 return_leg_version_id uuid NOT NULL,
 job_version bigint NOT NULL CHECK (job_version BETWEEN 1 AND 9223372036854775806),
 effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at) AND effective_at<=recorded_at),
 person_snapshot jsonb NOT NULL CHECK(jsonb_typeof(person_snapshot)='object'),
 location_snapshot jsonb NOT NULL CHECK(jsonb_typeof(location_snapshot)='object'),
 notes text,
 missing_photo_reason text,
 condition_photo_id uuid,
 acknowledgement_confirmed boolean CHECK(acknowledgement_confirmed IS TRUE OR acknowledgement_confirmed IS NULL),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL CHECK(operation_id=id),
 UNIQUE(business_id,collection_id), UNIQUE(business_id,condition_photo_id),
 CHECK((condition_photo_id IS NULL)<>(missing_photo_reason IS NULL)),
 FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest_private.pickup_photo_slots(business_id,photo_id),
 FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest.custody_photo_originals(business_id,photo_id),
 FOREIGN KEY(business_id,collection_id,job_id,job_vehicle_id,vehicle_id,policy_id)
  REFERENCES crest_private.pickup_custody_collections(business_id,id,job_id,job_vehicle_id,vehicle_id,policy_id),
 FOREIGN KEY(business_id,return_leg_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

ALTER TABLE crest_private.pickup_custody_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_releases FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_release BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_custody_releases
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_custody_releases TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_custody_releases TO crest_booking_integrity_owner;
CREATE POLICY pickup_release_read ON crest_private.pickup_custody_releases FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_release_create ON crest_private.pickup_custody_releases FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_release_integrity ON crest_private.pickup_custody_releases FOR SELECT TO crest_booking_integrity_owner USING(true);

CREATE POLICY pickup_release_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(
 command_type='operations.pickup_custody.release'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_release_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(
 command_type='operations.pickup_custody.release' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY pickup_release_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(
 command_type='operations.pickup_custody.release' AND state='pending'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
) WITH CHECK(
 command_type='operations.pickup_custody.release' AND state='committed'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_release_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.pickup_custody.release');
CREATE POLICY pickup_release_audit_write ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(
 entity_kind='pickup_custody_releases' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY pickup_release_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(
 entity_kind='pickup_custody_releases' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_release_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='pickup_custody_releases');

CREATE FUNCTION crest_private.pickup_return_arrival(business uuid,actor uuid,job uuid,target uuid,leg_version uuid)
 RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $arrival$
DECLARE arrival crest.travel_legs; saved jsonb;
BEGIN
 SELECT * INTO arrival FROM crest.travel_legs leg
 WHERE leg.business_id=business AND leg.id=leg_version AND leg.job_context_id=job AND leg.operator_actor_id=actor
  AND leg.purpose='return_to_customer' AND leg.state='closed' AND leg.change_kind='arrive';
 IF NOT FOUND THEN RETURN NULL; END IF;
 saved:=crest_private.pickup_trip_original(business,actor,arrival.operation_id);
 IF saved->>'state' IS DISTINCT FROM 'committed' OR saved->'receipt'->'leg'->>'id' IS DISTINCT FROM leg_version::text
  OR NOT coalesce((saved->'receipt'->'jobVehicleIds') ? target::text,false)
 THEN RETURN NULL; END IF;
 RETURN arrival.arrived_at;
END $arrival$;

CREATE FUNCTION crest_private.pickup_release_projection(released crest_private.pickup_custody_releases)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN released.condition_photo_id IS NULL THEN to_jsonb(released)-'condition_photo_id' ELSE to_jsonb(released) END)
  ||jsonb_build_object('job_version',released.job_version::text,
  'effective_at',to_char(released.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(released.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

CREATE FUNCTION crest_private.verified_pickup_return_photo(
 business uuid,actor uuid,photo uuid,release_id uuid,collected_id uuid,arrival uuid,version bigint,epoch uuid,recorded timestamptz
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $photo$
 SELECT EXISTS(SELECT FROM crest_private.pickup_photo_slots s
  JOIN crest_private.pickup_custody_collections c ON (c.business_id,c.id)=(s.business_id,s.return_collection_id)
  JOIN crest.custody_photo_attempts a ON (a.business_id,a.id)=(s.business_id,s.photo_id)
  JOIN crest.custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)
  WHERE (s.business_id,s.actor_id,s.photo_id,s.collection_id,s.return_collection_id,s.arrival_version_id,
   s.job_version,s.recovery_epoch)=(business,actor,photo,release_id,collected_id,arrival,version,epoch)
   AND (s.job_id,s.job_vehicle_id,s.policy_id)=(c.job_id,c.job_vehicle_id,c.policy_id)
   AND (a.actor_id,a.job_id,a.job_vehicle_id,a.vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
       =(actor,c.job_id,c.job_vehicle_id,c.vehicle_id,release_id,2,epoch)
   AND o.verified_at BETWEEN a.reserved_at AND recorded)
$photo$;

CREATE FUNCTION crest_private.pickup_release_original(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; released crest_private.pickup_custody_releases; collected crest_private.pickup_custody_collections;
 policy crest_private.pickup_custody_policies; audit record; image jsonb; request jsonb; body jsonb; receipt jsonb; arrived timestamptz;
BEGIN
 SELECT o.state,o.schema_version,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch,o.created_at INTO saved
 FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.pickup_custody.release';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved'); END IF;
 SELECT * INTO STRICT released FROM crest_private.pickup_custody_releases r
 WHERE r.business_id=business AND r.operation_id=operation AND r.created_by=actor;
 SELECT * INTO STRICT collected FROM crest_private.pickup_custody_collections c
 WHERE c.business_id=business AND c.id=released.collection_id;
 SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies p WHERE p.business_id=business AND p.id=released.policy_id;
 SELECT a.id,a.actor_id,a.created_by,a.entity_id,a.entity_version,a.action,a.effective_at,a.delta,a.origin,a.import_row_id,a.reason
 INTO STRICT audit FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.operation_id=operation AND a.entity_kind='pickup_custody_releases';
 image:=crest_private.pickup_release_projection(released);
 body:=jsonb_build_object('effectiveAt',image->'effective_at','person',released.person_snapshot,'location',released.location_snapshot,
  'notes',released.notes,'missingPhotoReason',released.missing_photo_reason,'acknowledgementConfirmed',released.acknowledgement_confirmed)
  ||CASE WHEN released.condition_photo_id IS NOT NULL THEN jsonb_build_object('conditionPhotoId',released.condition_photo_id) ELSE '{}'::jsonb END;
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.release','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,'jobId',released.job_id,
  'expectedJobVersion',released.job_version::text,'collectionId',released.collection_id,
  'returnLegVersionId',released.return_leg_version_id,'body',body);
 receipt:=jsonb_build_object('release',image,'auditId',audit.id);
 arrived:=crest_private.pickup_return_arrival(business,actor,released.job_id,released.job_vehicle_id,released.return_leg_version_id);
 IF saved.schema_version<>1 OR saved.result_schema_version<>1
  OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR released.recorded_at<saved.created_at OR released.effective_at<collected.effective_at
  OR crest_private.valid_pickup_collection_body(body,released.recorded_at) IS NOT TRUE
  OR arrived IS NULL OR released.effective_at<arrived OR policy.condition_photo_required AND released.condition_photo_id IS NULL
  OR released.condition_photo_id IS NOT NULL AND NOT crest_private.verified_pickup_return_photo(business,actor,released.condition_photo_id,
   released.id,released.collection_id,released.return_leg_version_id,released.job_version,saved.recovery_epoch,released.recorded_at)
  OR released.acknowledgement_confirmed IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
  OR audit.actor_id<>actor OR audit.created_by<>actor OR audit.entity_id<>released.id OR audit.entity_version<>1
  OR audit.action<>'create' OR audit.effective_at<>released.effective_at OR audit.origin<>'manual'
  OR audit.import_row_id IS NOT NULL OR audit.reason IS NOT NULL
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',image)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt,'request',request);
END $original$;

CREATE FUNCTION crest_private.project_pickup_release() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $project$
BEGIN
 DELETE FROM crest_private.vehicle_custody_claims claim
 WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(NEW.business_id,NEW.vehicle_id,NEW.collection_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_CLAIM_REQUIRED'; END IF;
 RETURN NEW;
END $project$;

CREATE FUNCTION crest_private.check_pickup_release() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE business uuid:=NEW.business_id; operation uuid:=NEW.operation_id; actor uuid;
 released crest_private.pickup_custody_releases;
BEGIN
 actor:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'operations' THEN 'actor_id' ELSE 'created_by' END)::uuid;
 IF crest_private.pickup_release_original(business,actor,operation)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ORIGINAL_REQUIRED'; END IF;
 SELECT * INTO STRICT released FROM crest_private.pickup_custody_releases r
 WHERE r.business_id=business AND r.operation_id=operation AND r.created_by=actor;
 IF NOT EXISTS(SELECT FROM crest.jobs job JOIN crest.fulfillment_mode_versions mode
  ON (mode.business_id,mode.id)=(job.business_id,job.mode_version_id)
  WHERE job.business_id=business AND job.id=released.job_id AND job.operator_actor_id=actor
   AND job.fulfillment_mode='pickup_return' AND mode.pickup_return_enabled AND job.version=released.job_version
   AND job.state IN('completed','cancelled') AND released.policy_id=crest_private.pickup_policy_for_job(business,job.id))
 OR EXISTS(SELECT FROM crest_private.vehicle_custody_claims claim
  WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(business,released.vehicle_id,released.collection_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_JOB_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_commands.release_pickup_vehicle(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,
 requested_collection uuid,requested_return_leg uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $release$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; existing record; job crest.jobs;
 collected crest_private.pickup_custody_collections; policy crest_private.pickup_custody_policies;
 released crest_private.pickup_custody_releases; effective timestamptz; arrived timestamptz; audit_id uuid; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_collection IS NULL
  OR requested_return_leg IS NULL OR expected_job_version IS NULL OR expected_job_version NOT BETWEEN 1 AND 9223372036854775806
  OR crest_private.valid_pickup_collection_body(body,clock_timestamp()) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RELEASE_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.release','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_job_version::text,'collectionId',requested_collection,'returnLegVersionId',requested_return_leg,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.release',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
   WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.pickup_custody.release'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   SELECT * INTO job FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job FOR SHARE;
   IF NOT FOUND OR job.operator_actor_id<>expected_actor OR job.fulfillment_mode<>'pickup_return' OR job.state NOT IN('completed','cancelled')
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='job'; END IF;
   IF job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='job_version'; END IF;
   SELECT * INTO collected FROM crest_private.pickup_custody_collections c
   WHERE c.business_id=requested_business AND c.job_id=requested_job AND c.id=requested_collection;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='custody'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||collected.job_vehicle_id::text,0));
   IF EXISTS(SELECT FROM crest_private.pickup_custody_releases r WHERE r.business_id=requested_business AND r.collection_id=collected.id)
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='released'; END IF;
   IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c
    WHERE (c.business_id,c.vehicle_id,c.pickup_collection_id)=(requested_business,collected.vehicle_id,collected.id))
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='custody'; END IF;
   SELECT p.* INTO STRICT policy FROM crest_private.pickup_custody_policies p
   WHERE p.business_id=requested_business AND p.id=collected.policy_id;
   IF policy.condition_photo_required AND NOT body ? 'conditionPhotoId'
    OR body ? 'conditionPhotoId' AND NOT crest_private.verified_pickup_return_photo(requested_business,expected_actor,
     (body->>'conditionPhotoId')::uuid,requested_operation,collected.id,requested_return_leg,expected_job_version,expected_epoch,clock_timestamp())
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='photo'; END IF;
   IF (body->>'acknowledgementConfirmed')::boolean IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='acknowledgement'; END IF;
   arrived:=crest_private.pickup_return_arrival(requested_business,expected_actor,requested_job,collected.job_vehicle_id,requested_return_leg);
   effective:=(body->>'effectiveAt')::timestamptz;
   IF arrived IS NULL OR effective<arrived OR effective<collected.effective_at
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='arrival'; END IF;
   INSERT INTO crest_private.pickup_custody_releases(id,business_id,collection_id,job_id,job_vehicle_id,vehicle_id,policy_id,
    return_leg_version_id,job_version,effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,condition_photo_id,
    acknowledgement_confirmed,created_by,operation_id)
   VALUES(requested_operation,requested_business,collected.id,requested_job,collected.job_vehicle_id,collected.vehicle_id,collected.policy_id,
    requested_return_leg,expected_job_version,effective,body->'person',body->'location',body->>'notes',body->>'missingPhotoReason',
    (body->>'conditionPhotoId')::uuid,(body->>'acknowledgementConfirmed')::boolean,expected_actor,requested_operation) RETURNING * INTO released;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_custody_releases',released.id,1,'create',effective,
    jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.pickup_release_projection(released)),'manual')
   RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',
     jsonb_build_object('release',crest_private.pickup_release_projection(released),'auditId',audit_id))
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.pickup_release_original(requested_business,expected_actor,requested_operation)-'request';
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1951' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $release$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_private.verified_pickup_return_photo(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,timestamptz) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_release_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.project_pickup_release() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_release() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_return_arrival(uuid,uuid,uuid,uuid,uuid),
 crest_private.pickup_release_projection(crest_private.pickup_custody_releases),
 crest_private.verified_pickup_return_photo(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,timestamptz),
 crest_private.pickup_release_original(uuid,uuid,uuid),crest_private.project_pickup_release(),crest_private.check_pickup_release(),
 crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_arrival(uuid,uuid,uuid,uuid,uuid),
 crest_private.pickup_release_projection(crest_private.pickup_custody_releases) TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_release_original(uuid,uuid,uuid),
 crest_private.verified_pickup_return_photo(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,timestamptz) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 TO crest_web;

CREATE TRIGGER pickup_release_project_claim AFTER INSERT ON crest_private.pickup_custody_releases
 FOR EACH ROW EXECUTE FUNCTION crest_private.project_pickup_release();
CREATE CONSTRAINT TRIGGER verify_pickup_release_row AFTER INSERT ON crest_private.pickup_custody_releases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_release();
CREATE CONSTRAINT TRIGGER verify_pickup_release_operation AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.release')
 EXECUTE FUNCTION crest_private.check_pickup_release();

-- Keep the original collection readable after custody ends. The read route
-- already authenticates this job and the exact booked vehicle.
DO $read_release$
DECLARE source text; marker text; replacement text;
BEGIN
 source:=pg_get_functiondef('crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)'::regprocedure);
 FOR marker,replacement IN SELECT * FROM (VALUES
  ($before$verified jsonb; status text; result jsonb;$before$,
   $after$verified jsonb; status text; result jsonb; released jsonb; release_id uuid; return_arrival crest.travel_legs; return_at timestamptz;$after$),
  ($before$  IF verified->>'state' IS DISTINCT FROM 'committed'
   OR NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business
    AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  status:=CASE job.state WHEN 'cancelled' THEN 'return_required' WHEN 'completed' THEN 'awaiting_return' ELSE 'held' END;$before$,
   $after$  IF verified->>'state' IS DISTINCT FROM 'committed'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  SELECT id INTO release_id FROM crest_private.pickup_custody_releases r
  WHERE r.business_id=requested_business AND r.collection_id=saved.id;
  IF release_id IS NOT NULL THEN
   released:=crest_private.pickup_release_original(requested_business,expected_actor,release_id);
   IF released->>'state' IS DISTINCT FROM 'committed' OR EXISTS(SELECT FROM crest_private.vehicle_custody_claims c
    WHERE c.business_id=requested_business AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ORIGINAL_REQUIRED'; END IF;
   status:='released';
  ELSE
   IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business
    AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
   status:=CASE job.state WHEN 'cancelled' THEN 'return_required' WHEN 'completed' THEN 'awaiting_return' ELSE 'held' END;
   IF status IN('awaiting_return','return_required') THEN
    SELECT leg.* INTO return_arrival FROM crest.travel_legs leg JOIN crest_private.operations op
     ON (op.business_id,op.operation_id,op.actor_id)=(leg.business_id,leg.operation_id,leg.created_by)
    WHERE leg.business_id=requested_business AND leg.job_context_id=requested_job AND leg.operator_actor_id=expected_actor
     AND leg.purpose='return_to_customer' AND leg.state='closed' AND leg.change_kind='arrive'
     AND op.command_type='operations.pickup_trip.record' AND (op.result->'receipt'->'jobVehicleIds') ? requested_job_vehicle::text
    ORDER BY leg.arrived_at DESC,leg.id DESC LIMIT 1;
    IF FOUND THEN
     return_at:=crest_private.pickup_return_arrival(requested_business,expected_actor,requested_job,requested_job_vehicle,return_arrival.id);
     IF return_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ARRIVAL_REQUIRED'; END IF;
     status:='ready_to_release';
    END IF;
   END IF;
  END IF;$after$),
  ($before$ 'collection',verified->'receipt'->'collection');$before$,
   $after$ 'collection',verified->'receipt'->'collection')
  ||CASE status WHEN 'released' THEN jsonb_build_object('release',released->'receipt'->'release')
   WHEN 'ready_to_release' THEN jsonb_build_object('returnArrival',jsonb_build_object('versionId',return_arrival.id,
    'arrivedAt',to_char(return_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ELSE '{}'::jsonb END;$after$)
 ) AS edits(marker,replacement)
 LOOP
  IF length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RELEASE_READ_REVIEW_REQUIRED'; END IF;
  source:=replace(source,marker,replacement);
 END LOOP;
 EXECUTE source;
END $read_release$;

-- Reservation, relay and publication use the existing condition-photo pipeline.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.reserve_pickup_return_photo(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 photo uuid,booked_vehicle uuid,release_id uuid,collected_id uuid,arrival uuid,expected_job_version bigint,content_type text,size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE authority jsonb; slot crest_private.pickup_photo_slots; collected crest_private.pickup_custody_collections;
BEGIN
 IF photo IS NULL OR booked_vehicle IS NULL OR release_id IS NULL OR collected_id IS NULL OR arrival IS NULL
  OR photo IN (release_id,collected_id) OR release_id=collected_id
  OR expected_job_version IS NULL OR expected_job_version NOT BETWEEN 1 AND 9223372036854775806
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_PHOTO_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.owner/1:'||requested_business::text||':'||expected_actor::text,0));
 SELECT * INTO collected FROM crest_private.pickup_custody_collections c
 WHERE c.business_id=requested_business AND c.id=collected_id AND c.job_vehicle_id=booked_vehicle;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;
 IF FOUND THEN
  IF (slot.job_id,slot.job_vehicle_id,slot.collection_id,slot.return_collection_id,slot.arrival_version_id,slot.policy_id,slot.job_version,slot.recovery_epoch)
   IS DISTINCT FROM (collected.job_id,booked_vehicle,release_id,collected_id,arrival,collected.policy_id,expected_job_version,expected_epoch)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_RESERVATION_CHANGED'; END IF;
 ELSE
  IF EXISTS(SELECT FROM crest.custody_photo_attempts a WHERE a.business_id=requested_business AND a.id=photo)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
  INSERT INTO crest_private.pickup_photo_slots(business_id,photo_id,job_id,job_vehicle_id,collection_id,
   return_collection_id,arrival_version_id,policy_id,job_version,actor_id,recovery_epoch)
  VALUES(requested_business,photo,collected.job_id,booked_vehicle,release_id,collected_id,arrival,collected.policy_id,
   expected_job_version,expected_actor,expected_epoch);
 END IF;
 RETURN crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,photo,booked_vehicle,release_id,2,content_type,size);
END $reserve$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 TO crest_web;

DO $return_photo$
DECLARE entry record; source text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_private.lock_custody_photo_slot(uuid,uuid,uuid,uuid,integer,uuid)',
   $old$ IF job.id IS NULL OR job.operator_actor_id$old$,
   $new$ IF slot.return_collection_id IS NOT NULL THEN
  IF job.id IS NULL OR job.operator_actor_id IS DISTINCT FROM actor OR job.fulfillment_mode<>'pickup_return'
   OR job.state NOT IN('completed','cancelled') OR handoff IS DISTINCT FROM 2
   OR (slot.job_id,slot.job_vehicle_id,slot.collection_id,slot.job_version) IS DISTINCT FROM (job.id,booked_vehicle,custody_case,job.version)
   OR slot.policy_id IS DISTINCT FROM crest_private.pickup_policy_for_job(business,job.id)
   OR crest_private.pickup_return_arrival(business,actor,job.id,booked_vehicle,slot.arrival_version_id) IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||business::text||':'||booked_vehicle::text,0));
  IF NOT EXISTS(SELECT FROM crest_private.pickup_custody_collections c
   JOIN crest_private.vehicle_custody_claims claim
     ON (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(c.business_id,c.vehicle_id,c.id)
   WHERE (c.business_id,c.id,c.job_id,c.job_vehicle_id,c.policy_id)=(business,slot.return_collection_id,job.id,booked_vehicle,slot.policy_id))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
  RETURN booked;
 END IF;
 IF job.id IS NULL OR job.operator_actor_id$new$),
  ('crest_private.check_pickup_photo_reservation()',
   $old$NEW.collection_id,1,NEW.recovery_epoch)$old$,
   $new$NEW.collection_id,CASE WHEN NEW.return_collection_id IS NULL THEN 1 ELSE 2 END,NEW.recovery_epoch)$new$),
  ('crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
   $old$       AND c.condition_photo_id=a.id))$old$,
   $new$       AND c.condition_photo_id=a.id
    UNION ALL SELECT 1 FROM crest_private.pickup_custody_releases r
      WHERE (r.business_id,r.id,r.job_id,r.job_vehicle_id,r.condition_photo_id)=(a.business_id,a.case_id,a.job_id,a.job_vehicle_id,a.id)
       AND a.handoff_version=2))$new$),
  ('crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)',
   $old$ IF handoff_id IS NULL THEN RAISE EXCEPTION$old$,
   $new$ IF handoff_id IS NULL AND current_record->'reservation'->>'handoff_version'='2' THEN
  SELECT r.id INTO handoff_id FROM crest_private.pickup_custody_releases r
  WHERE r.business_id=requested_business AND r.id=custody_case AND r.condition_photo_id=photo
   AND r.job_vehicle_id=booked_vehicle AND r.job_id=(current_record->'reservation'->>'job_id')::uuid;
 END IF;
 IF handoff_id IS NULL THEN RAISE EXCEPTION$new$),
  ('crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals)',
   $old$'policyId',s.policy_id,'jobVersion',s.job_version::text)) FROM crest_private.pickup_photo_slots s$old$,
   $new$'policyId',s.policy_id,'jobVersion',s.job_version::text)
   ||CASE WHEN s.return_collection_id IS NOT NULL THEN jsonb_build_object('returnCollectionId',s.return_collection_id) ELSE '{}'::jsonb END)
   FROM crest_private.pickup_photo_slots s$new$)
 ) edits(routine,marker,replacement) LOOP
  source:=pg_get_functiondef(to_regprocedure(entry.routine));
  IF source IS NULL OR length(source)-length(replace(source,entry.marker,''))<>length(entry.marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_PHOTO_REVIEW_REQUIRED: %',entry.routine; END IF;
  EXECUTE replace(source,entry.marker,entry.replacement);
 END LOOP;
END $return_photo$;

-- A lost response can recover the verified handoff with opaque identifiers.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_pickup_release_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.release'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RELEASE_REFERENCE_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_release_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR reference IS DISTINCT FROM (saved->'request')-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_REFERENCE_REQUIRED'; END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed',
  'receipt',jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.release',
   'businessId',requested_business,'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'collectionId','sourceRecordId',receipt->'release'->'id','sourceVersion','1',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_release_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_pickup_release_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF length(source)-length(replace(source,marker,''))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.release' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_RELEASE_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.pickup_custody.release' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','collectionId','returnLegVersionId'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb
   OR jsonb_typeof(r->'expectedJobVersion') IS DISTINCT FROM 'string'
   OR (r->>'expectedJobVersion')!~'^[1-9][0-9]{0,18}$'
  THEN RETURN false; END IF;
  RETURN coalesce((r->>'expectedJobVersion')::numeric<9223372036854775807
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobId') IS TRUE
   AND crest_private.original_operation_uuid(r->'collectionId') IS TRUE
   AND crest_private.original_operation_uuid(r->'returnLegVersionId') IS TRUE,false);
 END IF;
$case$);
END $reference$;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF length(source)-length(replace(source,marker,''))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.release' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_RELEASE_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.pickup_custody.release' THEN
  RETURN crest_commands.lookup_pickup_release_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;

-- pickup-return-source.sql
-- Held after pickup-custody-release.sql. Keep the registered v1 source intact.
RESET ROLE;
DO $review$
DECLARE routine record; source text; changed text; edit record;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='crest_private.pickup_custody_releases'::regclass
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity
  AND NOT has_table_privilege('crest_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_SOURCE_REVIEW_REQUIRED'; END IF;
 FOR routine IN SELECT * FROM (VALUES
  ('crest_private.pickup_custody_source_rows(uuid,text)',1),
  ('crest_commands.pickup_custody_source_context(uuid)',2),
  ('crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer)',3)
 ) AS routines(signature,kind)
 LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT source FROM pg_proc p
  WHERE p.oid=to_regprocedure(routine.signature) AND p.proowner='crest_booking_integrity_owner'::regrole
   AND p.prosecdef AND p.proconfig @> ARRAY['row_security=on'];
  FOR edit IN SELECT * FROM (VALUES
   (1,$old$'arrival_version_id',p.arrival_version_id,'policy_id',p.policy_id,'job_version',p.job_version::text,$old$,
      $new$'arrival_version_id',p.arrival_version_id,'policy_id',p.policy_id,'job_version',p.job_version::text,
  'return_collection_id',p.return_collection_id,$new$),
   (1,$old$FROM crest_private.vehicle_custody_claims p WHERE requested_group='vehicle_custody_claims' AND p.business_id=requested_business$old$,
      $new$FROM crest_private.vehicle_custody_claims p WHERE requested_group='vehicle_custody_claims' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,'business_id',p.business_id,'collection_id',p.collection_id,'job_id',p.job_id,
  'job_vehicle_id',p.job_vehicle_id,'vehicle_id',p.vehicle_id,'policy_id',p.policy_id,
  'return_leg_version_id',p.return_leg_version_id,'job_version',p.job_version::text,
  'effective_at',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person_snapshot',p.person_snapshot::text,'location_snapshot',p.location_snapshot::text,
  'notes',p.notes,'missing_photo_reason',p.missing_photo_reason,'condition_photo_id',p.condition_photo_id,
  'acknowledgement_confirmed',p.acknowledgement_confirmed,'created_by',p.created_by,'operation_id',p.operation_id)
 FROM crest_private.pickup_custody_releases p
 WHERE requested_group='pickup_custody_releases' AND p.business_id=requested_business$new$),
   (2,$old$UNION ALL SELECT 'vehicle_custody_claims',count(*) FROM crest_private.vehicle_custody_claims WHERE business_id=requested_business$old$,
      $new$UNION ALL SELECT 'vehicle_custody_claims',count(*) FROM crest_private.vehicle_custody_claims WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_custody_releases',count(*) FROM crest_private.pickup_custody_releases WHERE business_id=requested_business$new$),
   (2,$old$'schemaVersion',1,'profile','crest.pickup-custody-source.v1'$old$,
      $new$'schemaVersion',2,'profile','crest.pickup-custody-source.v2'$new$),
   (2,$old$'crest.pickup-custody-source/1'$old$,$new$'crest.pickup-custody-source/2'$new$),
   (3,$old$'schemaVersion',1,'businessId',requested_business$old$,$new$'schemaVersion',2,'businessId',requested_business$new$)
  ) AS edits(kind,before,after) WHERE edits.kind=routine.kind
  LOOP
   changed:=replace(source,edit.before,edit.after);
   IF length(source)-length(replace(source,edit.before,''))<>length(edit.before)
   THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_SOURCE_REVIEW_REQUIRED'; END IF;
   source:=changed;
  END LOOP;
  EXECUTE source;
 END LOOP;
END $review$;

-- pickup-return-failure.sql
-- Held BR08 follow-up after pickup-custody-release.sql.
-- A failed handoff closes only the arrival's eligibility for this vehicle.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.pickup_return_failures(
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 return_leg_version_id uuid NOT NULL,
 job_version bigint NOT NULL CHECK(job_version BETWEEN 1 AND 9223372036854775806),
 reason text NOT NULL CHECK(length(reason)>=1 AND length(reason)<=1000 AND btrim(reason)=reason),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL CHECK(operation_id=id),
 UNIQUE(business_id,collection_id,return_leg_version_id),
 FOREIGN KEY(business_id,collection_id) REFERENCES crest_private.pickup_custody_collections(business_id,id),
 FOREIGN KEY(business_id,return_leg_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest_private.pickup_return_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_return_failures FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_return_failure BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_return_failures
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_return_failures TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_return_failures TO crest_booking_integrity_owner;
CREATE POLICY pickup_failure_read ON crest_private.pickup_return_failures FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_failure_write ON crest_private.pickup_return_failures FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_failure_integrity ON crest_private.pickup_return_failures FOR SELECT TO crest_booking_integrity_owner USING(true);

ALTER POLICY pickup_release_operation_read ON crest_private.operations USING(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return')
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
ALTER POLICY pickup_release_operation_create ON crest_private.operations WITH CHECK(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return')
 AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
ALTER POLICY pickup_release_operation_finish ON crest_private.operations USING(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return') AND state='pending'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
) WITH CHECK(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return') AND state='committed'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
ALTER POLICY pickup_release_operation_integrity ON crest_private.operations
 USING(command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return'));
ALTER POLICY pickup_release_audit_write ON crest_private.audit_events WITH CHECK(
 entity_kind IN('pickup_custody_releases','pickup_return_failures') AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
ALTER POLICY pickup_release_audit_read ON crest_private.audit_events USING(
 entity_kind IN('pickup_custody_releases','pickup_return_failures')
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
ALTER POLICY pickup_release_audit_integrity ON crest_private.audit_events
 USING(entity_kind IN('pickup_custody_releases','pickup_return_failures'));

CREATE FUNCTION crest_private.pickup_return_failure_image(failure crest_private.pickup_return_failures)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $image$
 SELECT to_jsonb(failure)||jsonb_build_object('job_version',failure.job_version::text,
  'recorded_at',to_char(failure.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$image$;

CREATE FUNCTION crest_private.pickup_return_failure_original(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; failed crest_private.pickup_return_failures; collected crest_private.pickup_custody_collections;
 audit record; arrived timestamptz; image jsonb; request jsonb; receipt jsonb;
BEGIN
 SELECT o.state,o.schema_version,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch,o.created_at INTO saved
 FROM crest_private.operations o WHERE (o.business_id,o.actor_id,o.operation_id)=(business,actor,operation)
  AND o.command_type='operations.pickup_custody.fail_return';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved'); END IF;
 SELECT * INTO STRICT failed FROM crest_private.pickup_return_failures f
 WHERE (f.business_id,f.operation_id,f.created_by)=(business,operation,actor);
 SELECT * INTO STRICT collected FROM crest_private.pickup_custody_collections c
 WHERE (c.business_id,c.id)=(business,failed.collection_id);
 SELECT a.id,a.actor_id,a.created_by,a.entity_id,a.entity_version,a.action,a.effective_at,a.delta,a.origin,a.import_row_id,a.reason
 INTO STRICT audit FROM crest_private.audit_events a
 WHERE (a.business_id,a.operation_id,a.entity_kind)=(business,operation,'pickup_return_failures');
 arrived:=crest_private.pickup_return_arrival(business,actor,collected.job_id,collected.job_vehicle_id,failed.return_leg_version_id);
 image:=crest_private.pickup_return_failure_image(failed);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.fail_return','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,'jobId',collected.job_id,
  'expectedJobVersion',failed.job_version::text,'collectionId',collected.id,'returnLegVersionId',failed.return_leg_version_id,
  'body',jsonb_build_object('reason',failed.reason));
 receipt:=jsonb_build_object('failure',image,'auditId',audit.id);
 IF saved.schema_version<>1 OR saved.result_schema_version<>1
  OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR arrived IS NULL OR failed.recorded_at<greatest(arrived,saved.created_at,collected.effective_at)
  OR crest_private.booking_text_required(to_jsonb(failed.reason),1000) IS NOT TRUE
  OR collected.created_by<>actor OR audit.actor_id<>actor OR audit.created_by<>actor OR audit.entity_id<>failed.id OR audit.entity_version<>1
  OR audit.action<>'create' OR audit.effective_at IS DISTINCT FROM failed.recorded_at OR audit.origin<>'manual'
  OR audit.import_row_id IS NOT NULL OR audit.reason IS DISTINCT FROM failed.reason
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',image)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt,'request',request);
END $original$;

CREATE FUNCTION crest_private.check_pickup_return_failure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE actor uuid:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'operations' THEN 'actor_id' ELSE 'created_by' END)::uuid;
BEGIN
 IF crest_private.pickup_return_failure_original(NEW.business_id,actor,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_ORIGINAL_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_commands.fail_pickup_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,
 requested_collection uuid,requested_return_leg uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $failure$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; existing record; job crest.jobs;
 collected crest_private.pickup_custody_collections; failed crest_private.pickup_return_failures;
 audit_id uuid; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_collection IS NULL
  OR requested_operation=requested_collection OR requested_return_leg IS NULL
  OR expected_job_version IS NULL OR expected_job_version NOT BETWEEN 1 AND 9223372036854775806
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-'reason'<>'{}'::jsonb
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_FAILURE_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.fail_return','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_job_version::text,'collectionId',requested_collection,'returnLegVersionId',requested_return_leg,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.fail_return',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
   WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.pickup_custody.fail_return'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   SELECT * INTO job FROM crest.jobs j WHERE (j.business_id,j.id)=(requested_business,requested_job) FOR SHARE;
   IF NOT FOUND OR job.operator_actor_id<>expected_actor OR job.fulfillment_mode<>'pickup_return' OR job.state NOT IN('completed','cancelled')
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='job'; END IF;
   IF job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='job_version'; END IF;
   SELECT * INTO collected FROM crest_private.pickup_custody_collections c
   WHERE (c.business_id,c.job_id,c.id,c.created_by)=(requested_business,requested_job,requested_collection,expected_actor);
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='custody'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||collected.job_vehicle_id::text,0));
   IF EXISTS(SELECT FROM crest_private.pickup_custody_releases r WHERE (r.business_id,r.collection_id)=(requested_business,collected.id))
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='released'; END IF;
   IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c
    WHERE (c.business_id,c.vehicle_id,c.pickup_collection_id)=(requested_business,collected.vehicle_id,collected.id))
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='custody'; END IF;
   IF crest_private.pickup_return_arrival(requested_business,expected_actor,requested_job,collected.job_vehicle_id,requested_return_leg) IS NULL
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='arrival'; END IF;
   IF EXISTS(SELECT FROM crest_private.pickup_return_failures f WHERE (f.business_id,f.collection_id,f.return_leg_version_id)
    =(requested_business,collected.id,requested_return_leg))
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='failed'; END IF;
   INSERT INTO crest_private.pickup_return_failures(id,business_id,collection_id,return_leg_version_id,job_version,reason,created_by,operation_id)
   VALUES(requested_operation,requested_business,collected.id,requested_return_leg,expected_job_version,body->>'reason',expected_actor,requested_operation)
   RETURNING * INTO failed;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,
    reason,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_return_failures',failed.id,1,'create',
    failed.reason,failed.recorded_at,jsonb_build_object('schemaVersion',1,'before','null'::jsonb,
     'after',crest_private.pickup_return_failure_image(failed)),'manual') RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,
    'request',request,'receipt',jsonb_build_object('failure',crest_private.pickup_return_failure_image(failed),'auditId',audit_id))
   WHERE (business_id,operation_id)=(requested_business,requested_operation);
  END IF;
  result:=crest_private.pickup_return_failure_original(requested_business,expected_actor,requested_operation)-'request';
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1952' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $failure$;

CREATE FUNCTION crest_commands.lookup_pickup_return_failure_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.fail_return'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_FAILURE_REFERENCE_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_return_failure_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR reference IS DISTINCT FROM (saved->'request')-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_REFERENCE_REQUIRED'; END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed',
  'receipt',jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.fail_return',
   'businessId',requested_business,'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'collectionId','sourceRecordId',receipt->'failure'->'id','sourceVersion','1',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_private.pickup_return_failure_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_return_failure() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.fail_pickup_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_return_failure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_return_failure_image(crest_private.pickup_return_failures),
 crest_private.pickup_return_failure_original(uuid,uuid,uuid),crest_private.check_pickup_return_failure(),
 crest_commands.fail_pickup_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb),
 crest_commands.lookup_pickup_return_failure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_failure_image(crest_private.pickup_return_failures) TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_failure_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.fail_pickup_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 TO crest_web;

CREATE CONSTRAINT TRIGGER verify_pickup_return_failure AFTER INSERT ON crest_private.pickup_return_failures
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_return_failure();
CREATE CONSTRAINT TRIGGER verify_pickup_return_failure_operation AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.fail_return' AND NEW.state='committed')
 EXECUTE FUNCTION crest_private.check_pickup_return_failure();

-- The current arrival filter is shared by departure eligibility and the trip
-- reader. The original arrival remains authoritative in historical proofs.
DO $eligibility$
DECLARE routine record; source text; marker text; replacement text;
BEGIN
 FOR routine IN SELECT * FROM (VALUES
  ('crest_private.pickup_arrived_vehicles(uuid,uuid,text)',
   $old$AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'$old$,
   $new$AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'
  AND (travel_purpose<>'return_to_customer' OR NOT EXISTS(
   SELECT FROM crest_private.pickup_return_failures f
   JOIN crest_private.pickup_custody_collections c ON (c.business_id,c.id)=(f.business_id,f.collection_id)
   WHERE f.business_id=leg.business_id AND f.return_leg_version_id=leg.id AND c.job_vehicle_id=target.id::uuid))$new$),
  ('crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)',
   $old$   SELECT p.* INTO STRICT policy FROM crest_private.pickup_custody_policies p$old$,
   $new$   IF EXISTS(SELECT FROM crest_private.pickup_return_failures f
    WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,collected.id,requested_return_leg))
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='arrival'; END IF;
   SELECT p.* INTO STRICT policy FROM crest_private.pickup_custody_policies p$new$),
  ('crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)',
   $old$ SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;$old$,
   $new$ PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||booked_vehicle::text,0));
 IF EXISTS(SELECT FROM crest_private.pickup_return_failures f
  WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,collected_id,arrival))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;$new$)
 ) AS changes(signature,marker,replacement)
 LOOP
  SELECT pg_get_functiondef(to_regprocedure(routine.signature)) INTO STRICT source;
  IF source IS NULL OR length(source)-length(replace(source,routine.marker,''))<>length(routine.marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
  EXECUTE replace(source,routine.marker,routine.replacement);
 END LOOP;

 source:=pg_get_functiondef('crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)'::regprocedure);
 FOR marker,replacement IN SELECT * FROM (VALUES
  ($old$return_arrival crest.travel_legs; return_at timestamptz;$old$,
   $new$return_arrival crest.travel_legs; return_at timestamptz; failure_id uuid; failure jsonb;$new$),
  ($old$  SELECT id INTO release_id FROM crest_private.pickup_custody_releases r$old$,
   $new$  SELECT f.id INTO failure_id FROM crest_private.pickup_return_failures f
  WHERE (f.business_id,f.collection_id)=(requested_business,saved.id) ORDER BY f.recorded_at DESC,f.id DESC LIMIT 1;
  IF failure_id IS NOT NULL THEN
   failure:=crest_private.pickup_return_failure_original(requested_business,expected_actor,failure_id);
   IF failure->>'state' IS DISTINCT FROM 'committed'
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_ORIGINAL_REQUIRED'; END IF;
   failure:=failure->'receipt'->'failure';
  END IF;
  SELECT id INTO release_id FROM crest_private.pickup_custody_releases r$new$),
  ($old$    ORDER BY leg.arrived_at DESC,leg.id DESC LIMIT 1;$old$,
   $new$     AND NOT EXISTS(SELECT FROM crest_private.pickup_return_failures f
      WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,saved.id,leg.id))
    ORDER BY leg.arrived_at DESC,leg.id DESC LIMIT 1;$new$),
  ($old$     status:='ready_to_release';
    END IF;$old$,
   $new$     status:='ready_to_release';
    ELSIF failure IS NOT NULL THEN
     status:='return_failed';
    END IF;$new$),
  ($old$'arrivedAt',to_char(return_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ELSE '{}'::jsonb END;$old$,
   $new$'arrivedAt',to_char(return_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ELSE '{}'::jsonb END
  ||CASE WHEN failure IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('returnFailure',failure) END;$new$)
 ) AS changes(marker,replacement)
 LOOP
  IF length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
  source:=replace(source,marker,replacement);
 END LOOP;
 EXECUTE source;

 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 marker:=$old$IF kind='operations.pickup_custody.release' THEN$old$;
 replacement:=$new$IF kind IN('operations.pickup_custody.release','operations.pickup_custody.fail_return') THEN$new$;
 IF length(source)-length(replace(source,marker,''))<>length(marker)
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,replacement);

 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 marker:=$old$ IF original->>'commandType'='operations.pickup_custody.release' THEN$old$;
 replacement:=$new$ IF original->>'commandType'='operations.pickup_custody.fail_return' THEN
  RETURN crest_commands.lookup_pickup_return_failure_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
 IF original->>'commandType'='operations.pickup_custody.release' THEN$new$;
 IF length(source)-length(replace(source,marker,''))<>length(marker)
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,replacement);
END $eligibility$;

-- pickup-return-failure-source.sql
-- Held after pickup-return-source.sql and pickup-return-failure.sql.
-- The v3 source adds unresolved and historical failed-arrival evidence.
RESET ROLE;
DO $review$
DECLARE routine record; source text; edit record;
BEGIN
 IF NOT EXISTS(SELECT FROM pg_class c WHERE c.oid='crest_private.pickup_return_failures'::regclass
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity
  AND NOT has_table_privilege('crest_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  AND NOT has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_SOURCE_REVIEW_REQUIRED'; END IF;
 FOR routine IN SELECT * FROM (VALUES
  ('crest_private.pickup_custody_source_rows(uuid,text)',1),
  ('crest_commands.pickup_custody_source_context(uuid)',2),
  ('crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer)',3)
 ) AS routines(signature,kind)
 LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT source FROM pg_proc p
  WHERE p.oid=to_regprocedure(routine.signature) AND p.proowner='crest_booking_integrity_owner'::regrole
   AND p.prosecdef AND p.proconfig @> ARRAY['row_security=on'];
  FOR edit IN SELECT * FROM (VALUES
   (1,$old$WHERE requested_group='pickup_custody_releases' AND p.business_id=requested_business$old$,
      $new$WHERE requested_group='pickup_custody_releases' AND p.business_id=requested_business
 UNION ALL
 SELECT f.id,crest_private.pickup_return_failure_image(f)
 FROM crest_private.pickup_return_failures f
 WHERE requested_group='pickup_return_failures' AND f.business_id=requested_business$new$),
   (2,$old$UNION ALL SELECT 'pickup_custody_releases',count(*) FROM crest_private.pickup_custody_releases WHERE business_id=requested_business$old$,
      $new$UNION ALL SELECT 'pickup_custody_releases',count(*) FROM crest_private.pickup_custody_releases WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_return_failures',count(*) FROM crest_private.pickup_return_failures WHERE business_id=requested_business$new$),
   (2,$old$'schemaVersion',2,'profile','crest.pickup-custody-source.v2'$old$,
      $new$'schemaVersion',3,'profile','crest.pickup-custody-source.v3'$new$),
   (2,$old$'crest.pickup-custody-source/2'$old$,$new$'crest.pickup-custody-source/3'$new$),
   (3,$old$'schemaVersion',2,'businessId',requested_business$old$,$new$'schemaVersion',3,'businessId',requested_business$new$)
  ) AS edits(kind,before,after) WHERE edits.kind=routine.kind
  LOOP
   IF length(source)-length(replace(source,edit.before,''))<>length(edit.before)
   THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_SOURCE_REVIEW_REQUIRED'; END IF;
   source:=replace(source,edit.before,edit.after);
  END LOOP;
  EXECUTE source;
 END LOOP;
END $review$;

-- pickup-return-queue.sql
-- Held BR08 return queue. A terminal job remains visible until its
-- per-vehicle custody claim is released. The list spans all dates.
RESET ROLE;
CREATE FUNCTION crest_commands.list_pickup_returns(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,after_received_at timestamptz,after_case_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $queue$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (after_received_at IS NULL)<>(after_case_id IS NULL) OR after_received_at IS NOT NULL AND NOT isfinite(after_received_at)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_CURSOR_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH page AS MATERIALIZED(
  SELECT c.id AS case_id,c.job_id,c.job_vehicle_id,c.effective_at AS received_at,
   v.vehicle_snapshot->>'label' AS vehicle_label,v.customer_snapshot->>'display_name' AS customer_name
  FROM crest_private.pickup_custody_collections c
  JOIN crest_private.vehicle_custody_claims claim ON
   (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(c.business_id,c.vehicle_id,c.id)
  JOIN crest.jobs j ON (j.business_id,j.id)=(c.business_id,c.job_id)
  JOIN crest.job_vehicles v ON (v.business_id,v.job_id,v.id)=(c.business_id,c.job_id,c.job_vehicle_id)
  WHERE c.business_id=requested_business AND c.created_by=expected_actor AND j.operator_actor_id=expected_actor
   AND j.fulfillment_mode='pickup_return' AND j.state IN('completed','cancelled')
   AND (after_received_at IS NULL OR (c.effective_at,c.id)>(after_received_at,after_case_id))
  ORDER BY c.effective_at,c.id LIMIT 26
 ), visible AS(
  SELECT * FROM page ORDER BY received_at,case_id LIMIT 25
 ), statuses AS(
  SELECT visible.*,CASE latest.state
   WHEN 'open' THEN 'returning'
   WHEN 'cancelled' THEN 'return_stopped'
   WHEN 'closed' THEN CASE WHEN EXISTS(SELECT FROM crest_private.pickup_return_failures f
    WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,visible.case_id,latest.id))
    THEN 'return_failed' ELSE 'ready_for_handoff' END
   ELSE 'awaiting_return' END AS return_state
  FROM visible
  LEFT JOIN LATERAL(
   SELECT l.id,l.state
   FROM crest.current_travel_legs l
   JOIN crest_private.operations op ON (op.business_id,op.operation_id,op.actor_id)=(l.business_id,l.operation_id,l.created_by)
   WHERE l.business_id=requested_business AND l.job_context_id=visible.job_id AND l.operator_actor_id=expected_actor
    AND l.purpose='return_to_customer' AND op.command_type='operations.pickup_trip.record' AND op.state='committed'
    AND (op.result->'receipt'->'jobVehicleIds') ? visible.job_vehicle_id::text
   ORDER BY l.departed_at DESC,l.id DESC LIMIT 1
  ) latest ON true
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'hasMore',(SELECT count(*) FROM page)>25,
  'rows',coalesce(jsonb_agg(jsonb_build_object('caseId',case_id,'jobId',job_id,'jobVehicleId',job_vehicle_id,
   'receivedAt',to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'state',return_state,'vehicleLabel',vehicle_label,'customerName',customer_name) ORDER BY received_at,case_id),'[]'::jsonb))
 INTO result FROM statuses;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $queue$;

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.list_pickup_returns(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.list_pickup_returns(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_commands.list_pickup_returns(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid) TO crest_web;
