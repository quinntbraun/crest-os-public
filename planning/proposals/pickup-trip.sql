-- Held P08 pickup transport over registered68. The coordinator applies this
-- transactionally in a disposable database until the workflow is integrated.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;

CREATE POLICY pickup_trip_operation_read ON crest_private.operations
FOR SELECT TO crest_booking_owner USING (
 command_type = 'operations.pickup_trip.record'
 AND business_id = nullif(current_setting('crest.business_id', true), '')::uuid
 AND actor_id = nullif(current_setting('crest.actor_id', true), '')::uuid
);
CREATE POLICY pickup_trip_operation_create ON crest_private.operations
FOR INSERT TO crest_booking_owner WITH CHECK (
 command_type = 'operations.pickup_trip.record' AND schema_version = 1 AND state = 'pending'
 AND business_id = nullif(current_setting('crest.business_id', true), '')::uuid
 AND actor_id = nullif(current_setting('crest.actor_id', true), '')::uuid
 AND operation_id = nullif(current_setting('crest.operation_id', true), '')::uuid
 AND created_by = actor_id AND origin = 'manual' AND import_row_id IS NULL
);
CREATE POLICY pickup_trip_operation_finish ON crest_private.operations
FOR UPDATE TO crest_booking_owner USING (
 command_type = 'operations.pickup_trip.record' AND state = 'pending'
 AND business_id = nullif(current_setting('crest.business_id', true), '')::uuid
 AND actor_id = nullif(current_setting('crest.actor_id', true), '')::uuid
 AND operation_id = nullif(current_setting('crest.operation_id', true), '')::uuid
) WITH CHECK (
 command_type = 'operations.pickup_trip.record' AND state = 'committed'
 AND business_id = nullif(current_setting('crest.business_id', true), '')::uuid
 AND actor_id = nullif(current_setting('crest.actor_id', true), '')::uuid
 AND operation_id = nullif(current_setting('crest.operation_id', true), '')::uuid
);
CREATE POLICY pickup_trip_integrity_read ON crest_private.operations
FOR SELECT TO crest_booking_integrity_owner USING (command_type = 'operations.pickup_trip.record');

CREATE FUNCTION crest_private.valid_pickup_trip_body(body jsonb)
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
  AND crest_private.valid_field_session_body((body-'trip') || jsonb_build_object('trip', trip-'jobVehicleIds'));
END $validate$;

-- A physical leg may serve several booked vehicles at the same saved stop.
-- The destination always comes from the booking, including its instructions.
CREATE FUNCTION crest_private.pickup_trip_destination(business uuid, job uuid, targets jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $destination$
 SELECT vehicle.pickup_location_snapshot
 FROM crest.job_vehicles vehicle
 WHERE vehicle.business_id = business AND vehicle.job_id = job
  AND targets ? vehicle.id::text AND vehicle.pickup_location_snapshot IS NOT NULL
 GROUP BY vehicle.pickup_location_snapshot
 HAVING count(*) = jsonb_array_length(targets)
$destination$;

CREATE FUNCTION crest_private.pickup_trip_original(business uuid, actor uuid, operation uuid)
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
  OR leg.purpose <> 'pickup' OR leg.operator_actor_id <> actor OR leg.job_context_id IS NULL
  OR leg.change_kind IS DISTINCT FROM action OR leg.reason IS DISTINCT FROM body->>'reason'
  OR departure.job_context_id IS DISTINCT FROM leg.job_context_id
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
   OR leg.destination_snapshot IS DISTINCT FROM crest_private.pickup_trip_destination(business, leg.job_context_id, targets)
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

CREATE FUNCTION crest_private.check_pickup_trip_original()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $check$
BEGIN
 IF crest_private.pickup_trip_original(NEW.business_id, NEW.actor_id, NEW.operation_id)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CREST_PICKUP_TRIP_RESULT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER pickup_trip_original
AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.command_type = 'operations.pickup_trip.record')
EXECUTE FUNCTION crest_private.check_pickup_trip_original();

CREATE FUNCTION crest_commands.record_pickup_trip(credential_hash bytea, expected_session uuid, expected_actor uuid,
 expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_job uuid,
 expected_job_version bigint, requested_leg uuid, expected_leg_version uuid, body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $record$
DECLARE context jsonb; request jsonb; digest text; claim uuid; existing record; result jsonb;
 job crest.jobs; family uuid; leg crest.travel_legs; prior crest.travel_legs;
 stamp timestamptz; action text := body->>'action'; trip jsonb := body->'trip';
 targets jsonb; departure_body jsonb; destination jsonb; eta timestamptz;
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
   IF job.state <> 'scheduled' AND NOT (action = 'cancel' AND job.state = 'cancelled')
   THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'state'; END IF;
   SELECT * INTO prior FROM crest.current_travel_legs WHERE business_id = requested_business AND logical_id = requested_leg;
   IF prior.id IS DISTINCT FROM expected_leg_version THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'leg_version'; END IF;

   stamp := clock_timestamp();
   IF action = 'depart' THEN
    IF NOT EXISTS (SELECT FROM crest.vehicles WHERE business_id = requested_business
      AND id = (trip->>'drivenVehicleId')::uuid AND archived_at IS NULL)
    THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'vehicle'; END IF;
    targets := trip->'jobVehicleIds';
    destination := crest_private.pickup_trip_destination(requested_business, requested_job, targets);
    IF destination IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'pickup_location'; END IF;
    IF EXISTS (SELECT FROM crest.current_travel_legs WHERE business_id = requested_business
      AND operator_actor_id = expected_actor AND state = 'open')
    THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'occupancy'; END IF;
    eta := (trip->>'etaAt')::timestamptz;
    departure_body := body;
    INSERT INTO crest.travel_legs(id, business_id, logical_id, sequence, operator_actor_id, driven_vehicle_id,
     job_context_id, purpose, origin_snapshot, destination_snapshot, departed_at, state, eta_at, eta_source,
     eta_calculated_at, notes, change_kind, reason, created_by, operation_id)
    VALUES (requested_leg, requested_business, requested_leg, 1, expected_actor, (trip->>'drivenVehicleId')::uuid,
     requested_job, 'pickup', trip->'origin', destination, stamp, 'open', eta,
     CASE WHEN eta IS NOT NULL THEN 'owner_entered' END, CASE WHEN eta IS NOT NULL THEN stamp END,
     trip->>'notes', action, body->>'reason', expected_actor, requested_operation) RETURNING * INTO leg;
   ELSE
    IF prior.job_context_id IS DISTINCT FROM requested_job OR prior.operator_actor_id <> expected_actor OR prior.purpose <> 'pickup'
    THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'leg'; END IF;
    IF prior.state <> 'open' OR prior.sequence <> 1 THEN RAISE EXCEPTION USING ERRCODE = 'P1942', MESSAGE = 'state'; END IF;
    departure_body := crest_private.pickup_trip_original(requested_business, expected_actor, prior.operation_id)->'departure';
    targets := departure_body->'trip'->'jobVehicleIds';
    before_leg := crest_private.field_travel_projection(prior);
    INSERT INTO crest.travel_legs(business_id, logical_id, sequence, replaces_id, operator_actor_id, driven_vehicle_id,
     job_context_id, purpose, origin_snapshot, destination_snapshot, departed_at, arrived_at, state, eta_at, eta_source,
     eta_calculated_at, notes, change_kind, reason, created_by, operation_id)
    VALUES (requested_business, requested_leg, 2, prior.id, expected_actor, prior.driven_vehicle_id, requested_job,
     'pickup', prior.origin_snapshot, CASE WHEN action = 'cancel' THEN trip->'actualStop' ELSE prior.destination_snapshot END,
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

CREATE FUNCTION crest_commands.lookup_pickup_trip_operation(credential_hash bytea, expected_session uuid, expected_actor uuid,
 expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET row_security = on AS $lookup$
DECLARE result jsonb;
BEGIN
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CREST_PICKUP_TRIP_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 result := crest_private.pickup_trip_original(requested_business, expected_actor, requested_operation) - ARRAY['departure','request'];
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $lookup$;
RESET ROLE;

DO $source$ DECLARE definition text; marker text := ' IF command IS NULL OR command NOT IN(''operations.job.field'''; BEGIN
 definition := pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 IF length(definition)-length(replace(definition, marker, '')) <> length(marker)
 THEN RAISE EXCEPTION 'CREST_PICKUP_SOURCE_EXTENSION_REQUIRED'; END IF;
 EXECUTE replace(definition, marker, $mapping$
 IF command = 'operations.pickup_trip.record' THEN
  IF TG_TABLE_NAME <> 'travel_legs' THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CREST_PICKUP_TRIP_ONLY'; END IF;
  IF NEW.purpose <> 'pickup' OR NEW.change_kind NOT IN ('depart', 'arrive', 'cancel')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CREST_PICKUP_TRIP_ONLY'; END IF;
  command := 'operations.travel.record';
 END IF;
$mapping$ || marker);
END $source$;

GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_trip_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_trip_original() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.valid_pickup_trip_body(jsonb), crest_private.pickup_trip_destination(uuid,uuid,jsonb),
 crest_private.pickup_trip_original(uuid,uuid,uuid), crest_private.check_pickup_trip_original() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_field_session_body(jsonb),
 crest_private.valid_pickup_trip_body(jsonb), crest_private.pickup_trip_destination(uuid,uuid,jsonb)
 TO crest_booking_owner, crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_trip_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_pickup_trip_original() TO crest_schema_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.record_pickup_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_pickup_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb),
 crest_commands.lookup_pickup_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_pickup_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb),
 crest_commands.lookup_pickup_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
