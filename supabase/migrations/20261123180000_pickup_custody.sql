-- P08 / BR08. Pickup travel, per-vehicle collection, policy, private photos and source evidence.

-- pickup-trip.sql
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

-- pickup-trip-read.sql
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

-- pickup-custody-collection.sql
-- Held BR08 collection over the verified pickup trip commands. One immutable
-- handoff per booked vehicle. The shared claim excludes simultaneous custody
-- under either service mode. A claim is never released by job cancellation.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.pickup_custody_policies (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 mode_version_id uuid NOT NULL,
 acknowledgement_text text CHECK (char_length(acknowledgement_text)<=2000 AND btrim(acknowledgement_text,E' \t\r\n')<>''),
 condition_photo_required boolean NOT NULL,
 UNIQUE (business_id,id), UNIQUE (business_id,mode_version_id),
 FOREIGN KEY (business_id,mode_version_id) REFERENCES crest.fulfillment_mode_versions(business_id,id)
);
CREATE TABLE crest_private.pickup_custody_collections (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 pickup_leg_version_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 effective_at timestamptz NOT NULL CHECK (isfinite(effective_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(recorded_at) AND effective_at<=recorded_at),
 person_snapshot jsonb NOT NULL CHECK (jsonb_typeof(person_snapshot)='object'),
 location_snapshot jsonb NOT NULL CHECK (jsonb_typeof(location_snapshot)='object'),
 notes text,
 missing_photo_reason text NOT NULL,
 acknowledgement_confirmed boolean CHECK (acknowledgement_confirmed IS TRUE OR acknowledgement_confirmed IS NULL),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 CHECK (id=operation_id),
 UNIQUE (business_id,id), UNIQUE (business_id,job_vehicle_id), UNIQUE (business_id,operation_id),
 FOREIGN KEY (business_id,job_vehicle_id,job_id,vehicle_id) REFERENCES crest.job_vehicles(business_id,id,job_id,vehicle_id),
 FOREIGN KEY (business_id,pickup_leg_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY (business_id,policy_id) REFERENCES crest_private.pickup_custody_policies(business_id,id),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest_private.vehicle_custody_claims (
 business_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 dropoff_case_id uuid,
 pickup_collection_id uuid,
 CONSTRAINT custody_cross_mode_vehicle_held PRIMARY KEY (business_id,vehicle_id),
 CHECK ((dropoff_case_id IS NULL)<>(pickup_collection_id IS NULL)),
 FOREIGN KEY (business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),
 FOREIGN KEY (business_id,dropoff_case_id) REFERENCES crest.custody_cases(business_id,id),
 FOREIGN KEY (business_id,pickup_collection_id) REFERENCES crest_private.pickup_custody_collections(business_id,id)
);

ALTER TABLE crest_private.pickup_custody_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_collections FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.vehicle_custody_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.vehicle_custody_claims FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_policy BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_custody_policies
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
CREATE TRIGGER retain_pickup_collection BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_custody_collections
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();

GRANT SELECT ON crest_private.pickup_custody_policies,crest_private.pickup_custody_collections TO crest_booking_owner,crest_booking_integrity_owner;
GRANT INSERT ON crest_private.pickup_custody_collections TO crest_booking_owner;
GRANT SELECT,INSERT,DELETE ON crest_private.vehicle_custody_claims TO crest_booking_integrity_owner;
GRANT SELECT(business_id,vehicle_id,pickup_collection_id) ON crest_private.vehicle_custody_claims TO crest_booking_owner;
CREATE POLICY pickup_policy_read ON crest_private.pickup_custody_policies FOR SELECT TO crest_booking_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY pickup_collection_read ON crest_private.pickup_custody_collections FOR SELECT TO crest_booking_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_collection_insert ON crest_private.pickup_custody_collections FOR INSERT TO crest_booking_owner WITH CHECK (
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_policy_integrity ON crest_private.pickup_custody_policies FOR SELECT TO crest_booking_integrity_owner USING (true);
CREATE POLICY pickup_collection_integrity ON crest_private.pickup_custody_collections FOR SELECT TO crest_booking_integrity_owner USING (true);
CREATE POLICY custody_claim_read ON crest_private.vehicle_custody_claims FOR SELECT TO crest_booking_integrity_owner USING (true);
CREATE POLICY custody_claim_business_scope ON crest_private.vehicle_custody_claims FOR SELECT TO crest_booking_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_claim_insert ON crest_private.vehicle_custody_claims FOR INSERT TO crest_booking_integrity_owner WITH CHECK (true);
CREATE POLICY custody_claim_release ON crest_private.vehicle_custody_claims FOR DELETE TO crest_booking_integrity_owner USING (true);

CREATE POLICY pickup_collect_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING (
 command_type='operations.pickup_custody.collect' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_collect_operation_insert ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK (
 command_type='operations.pickup_custody.collect' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY pickup_collect_operation_commit ON crest_private.operations FOR UPDATE TO crest_booking_owner USING (
 command_type='operations.pickup_custody.collect' AND state='pending' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
) WITH CHECK (
 command_type='operations.pickup_custody.collect' AND state='committed' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_collect_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING (command_type='operations.pickup_custody.collect');
CREATE POLICY pickup_collect_audit_insert ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK (
 entity_kind='pickup_custody_collections' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND created_by=actor_id AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY pickup_collect_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING (
 entity_kind='pickup_custody_collections' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_collect_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING (entity_kind='pickup_custody_collections');

CREATE FUNCTION crest_private.project_vehicle_custody_claim() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
BEGIN
 IF TG_TABLE_NAME='pickup_custody_collections' THEN
  INSERT INTO crest_private.vehicle_custody_claims(business_id,vehicle_id,pickup_collection_id)
  VALUES(NEW.business_id,NEW.vehicle_id,NEW.id);
 ELSIF TG_OP='INSERT' THEN
  INSERT INTO crest_private.vehicle_custody_claims(business_id,vehicle_id,dropoff_case_id)
  VALUES(NEW.business_id,NEW.vehicle_id,NEW.id);
 ELSE
  DELETE FROM crest_private.vehicle_custody_claims
  WHERE business_id=OLD.business_id AND vehicle_id=OLD.vehicle_id AND dropoff_case_id=OLD.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_DROPOFF_CUSTODY_CLAIM_MISSING'; END IF;
 END IF;
 RETURN NEW;
END $claim$;

CREATE FUNCTION crest_private.valid_pickup_collection_body(body jsonb,recorded timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(jsonb_typeof(body)='object'
  AND body ?& ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed']
  AND body-ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed']='{}'::jsonb
  AND octet_length(body::text)<=16384
  AND crest_private.valid_support_instant(body->'effectiveAt',recorded)
  AND jsonb_typeof(body->'person')='object' AND (body->'person')-ARRAY['schemaVersion','displayName']='{}'::jsonb
  AND body->'person'->'schemaVersion'='1'::jsonb AND crest_private.booking_text_required(body->'person'->'displayName',200)
  AND crest_private.valid_support_location(body->'location')
  AND (body->'notes'='null'::jsonb OR crest_private.booking_text_required(body->'notes',1000))
  AND crest_private.booking_text_required(body->'missingPhotoReason',1000)
  AND body->'acknowledgementConfirmed' IN ('null'::jsonb,'true'::jsonb),false)
$valid$;

CREATE FUNCTION crest_private.pickup_collection_projection(c crest_private.pickup_custody_collections) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(c)||jsonb_build_object(
  'effective_at',to_char(c.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

CREATE FUNCTION crest_private.pickup_collection_arrival(business uuid,actor uuid,job uuid,target uuid,leg uuid) RETURNS timestamptz
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $arrival$
DECLARE arrived crest.travel_legs; verified jsonb;
BEGIN
 SELECT l.* INTO arrived FROM crest.travel_legs l
 WHERE l.business_id=business AND l.id=leg AND l.job_context_id=job AND l.operator_actor_id=actor
  AND l.purpose='pickup' AND l.change_kind='arrive' AND l.state='closed';
 IF NOT FOUND THEN RETURN NULL; END IF;
 verified:=crest_private.pickup_trip_original(business,actor,arrived.operation_id);
 IF verified->>'state' IS DISTINCT FROM 'committed' OR verified->'receipt'->'leg'->>'id' IS DISTINCT FROM leg::text
  OR NOT coalesce((verified->'receipt'->'jobVehicleIds') ? target::text,false)
 THEN RETURN NULL; END IF;
 RETURN arrived.arrived_at;
END $arrival$;

CREATE FUNCTION crest_private.pickup_collection_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; collection crest_private.pickup_custody_collections; policy crest_private.pickup_custody_policies;
 audit record; request jsonb; body jsonb; receipt jsonb; projected jsonb; arrived timestamptz;
BEGIN
 SELECT o.state,o.schema_version,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch INTO saved
 FROM crest_private.operations o WHERE o.business_id=business AND o.actor_id=actor
  AND o.operation_id=operation AND o.command_type='operations.pickup_custody.collect';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved'); END IF;
 SELECT * INTO STRICT collection FROM crest_private.pickup_custody_collections
 WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies WHERE business_id=business AND id=collection.policy_id;
 SELECT a.id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action,a.effective_at,a.delta,a.origin,a.import_row_id,a.created_by,a.reason INTO STRICT audit
 FROM crest_private.audit_events a WHERE a.business_id=business AND a.operation_id=operation AND a.entity_kind='pickup_custody_collections';
 request:=saved.result->'request';
 projected:=crest_private.pickup_collection_projection(collection);
 body:=jsonb_build_object('effectiveAt',projected->'effective_at','person',collection.person_snapshot,'location',collection.location_snapshot,
  'notes',collection.notes,'missingPhotoReason',collection.missing_photo_reason,'acknowledgementConfirmed',collection.acknowledgement_confirmed);
 receipt:=jsonb_build_object('collection',projected,'auditId',audit.id);
 arrived:=crest_private.pickup_collection_arrival(business,actor,collection.job_id,collection.job_vehicle_id,collection.pickup_leg_version_id);
 IF saved.schema_version<>1 OR saved.result_schema_version<>1 OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
  OR request IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.collect',
   'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,'jobId',collection.job_id,
   'expectedJobVersion',request->>'expectedJobVersion','jobVehicleId',collection.job_vehicle_id,'pickupLegVersionId',collection.pickup_leg_version_id,
   'policyId',collection.policy_id,'body',body)
  OR coalesce(request->>'expectedJobVersion','')!~'^[1-9][0-9]{0,18}$'
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR crest_private.valid_pickup_collection_body(body,collection.recorded_at) IS NOT TRUE
  OR arrived IS NULL OR collection.effective_at<arrived OR policy.condition_photo_required
  OR collection.acknowledgement_confirmed IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
  OR audit.actor_id<>actor OR audit.created_by<>actor OR audit.entity_id<>collection.id OR audit.entity_version<>1
  OR audit.action<>'create' OR audit.effective_at<>collection.effective_at OR audit.origin<>'manual' OR audit.import_row_id IS NOT NULL OR audit.reason IS NOT NULL
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',projected)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt,'request',request);
END $original$;

CREATE FUNCTION crest_private.pickup_policy_for_job(requested_business uuid,requested_job uuid) RETURNS uuid
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $policy$
 SELECT p.id FROM crest.jobs j JOIN crest_private.pickup_custody_policies p
  ON p.business_id=j.business_id AND p.mode_version_id=j.mode_version_id
 WHERE j.business_id=requested_business AND j.id=requested_job AND j.fulfillment_mode='pickup_return'
$policy$;

CREATE FUNCTION crest_private.check_pickup_collection() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE business uuid:=NEW.business_id; operation uuid:=NEW.operation_id; actor uuid; collection crest_private.pickup_custody_collections;
 expected_version text;
BEGIN
 actor:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'operations' THEN 'actor_id' ELSE 'created_by' END)::uuid;
 IF crest_private.pickup_collection_original(business,actor,operation)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
 SELECT * INTO STRICT collection FROM crest_private.pickup_custody_collections
 WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT o.result->'request'->>'expectedJobVersion' INTO STRICT expected_version
 FROM crest_private.operations o WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor;
 IF NOT EXISTS(SELECT FROM crest.jobs j JOIN crest.fulfillment_mode_versions m ON m.business_id=j.business_id AND m.id=j.mode_version_id
  WHERE j.business_id=business AND j.id=collection.job_id AND j.operator_actor_id=actor AND j.fulfillment_mode='pickup_return'
   AND j.state='scheduled' AND j.version::text=expected_version AND m.pickup_return_enabled
   AND crest_private.pickup_policy_for_job(business,collection.job_id)=collection.policy_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_JOB_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=business
  AND c.vehicle_id=collection.vehicle_id AND c.pickup_collection_id=collection.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_CLAIM_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_commands.collect_pickup_vehicle(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,
 requested_job_vehicle uuid,requested_pickup_leg_version uuid,requested_policy uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $collect$
DECLARE context jsonb; request jsonb; digest text; claim uuid; existing record; booked crest.job_vehicles; job crest.jobs;
 policy crest_private.pickup_custody_policies; collected crest_private.pickup_custody_collections; arrived timestamptz; effective timestamptz;
 audit_id uuid; receipt jsonb; result jsonb; violation text; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_job_vehicle IS NULL
  OR requested_pickup_leg_version IS NULL OR requested_policy IS NULL OR expected_job_version IS NULL OR expected_job_version<1
  OR expected_job_version=9223372036854775807
  OR crest_private.valid_pickup_collection_body(body,clock_timestamp()) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_COLLECTION_INPUT_REQUIRED'; END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.collect','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_job_version::text,'jobVehicleId',requested_job_vehicle,'pickupLegVersionId',requested_pickup_leg_version,
  'policyId',requested_policy,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.collect',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
   WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.pickup_custody.collect'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   SELECT * INTO job FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job FOR SHARE;
   IF NOT FOUND OR job.operator_actor_id<>expected_actor OR job.fulfillment_mode<>'pickup_return' OR job.state<>'scheduled'
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='job'; END IF;
   IF job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='job_version'; END IF;
   SELECT * INTO booked FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.id=requested_job_vehicle AND v.job_id=requested_job;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='vehicle'; END IF;
   SELECT p.* INTO policy FROM crest_private.pickup_custody_policies p
   JOIN crest.fulfillment_mode_versions m ON m.business_id=p.business_id AND m.id=job.mode_version_id
   WHERE p.business_id=requested_business AND p.id=requested_policy AND m.pickup_return_enabled
    AND p.id=crest_private.pickup_policy_for_job(requested_business,requested_job);
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='policy'; END IF;
   IF policy.condition_photo_required THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='photo'; END IF;
   IF (body->>'acknowledgementConfirmed')::boolean IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='acknowledgement'; END IF;
   arrived:=crest_private.pickup_collection_arrival(requested_business,expected_actor,requested_job,requested_job_vehicle,requested_pickup_leg_version);
   effective:=(body->>'effectiveAt')::timestamptz;
   IF arrived IS NULL OR effective<arrived THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='arrival'; END IF;
   INSERT INTO crest_private.pickup_custody_collections(id,business_id,job_id,job_vehicle_id,vehicle_id,pickup_leg_version_id,policy_id,
    effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,acknowledgement_confirmed,created_by,operation_id)
   VALUES(requested_operation,requested_business,requested_job,requested_job_vehicle,booked.vehicle_id,requested_pickup_leg_version,requested_policy,
    effective,body->'person',body->'location',body->>'notes',body->>'missingPhotoReason',(body->>'acknowledgementConfirmed')::boolean,expected_actor,requested_operation)
   RETURNING * INTO collected;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_custody_collections',collected.id,1,'create',effective,
    jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.pickup_collection_projection(collected)),'manual')
   RETURNING id INTO audit_id;
   receipt:=jsonb_build_object('collection',crest_private.pickup_collection_projection(collected),'auditId',audit_id);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.pickup_collection_original(requested_business,expected_actor,requested_operation)-'request';
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1943' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME;
  IF violation='custody_cross_mode_vehicle_held' THEN RETURN jsonb_build_object('state','conflict','reason','vehicle_held'); END IF;
  IF violation='pickup_custody_collections_business_id_job_vehicle_id_key'
  THEN RETURN jsonb_build_object('state','conflict','reason','collected'); END IF;
  RAISE;
 END;
END $collect$;
RESET ROLE;

-- Backfill and install these triggers in one coordinator transaction.
INSERT INTO crest_private.vehicle_custody_claims(business_id,vehicle_id,dropoff_case_id)
 SELECT business_id,vehicle_id,id FROM crest.custody_cases WHERE state='held';

GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.project_vehicle_custody_claim() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_collection_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_collection() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_policy_for_job(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_policy_for_job(uuid,uuid) TO crest_booking_owner,crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.project_vehicle_custody_claim(),crest_private.pickup_collection_original(uuid,uuid,uuid),
 crest_private.check_pickup_collection(),crest_private.valid_pickup_collection_body(jsonb,timestamptz),
 crest_private.pickup_collection_projection(crest_private.pickup_custody_collections),crest_private.pickup_collection_arrival(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_pickup_collection_body(jsonb,timestamptz),
 crest_private.pickup_collection_projection(crest_private.pickup_custody_collections),crest_private.pickup_collection_arrival(uuid,uuid,uuid,uuid,uuid)
 TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_collection_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_trip_original(uuid,uuid,uuid) TO crest_booking_integrity_owner;

CREATE TRIGGER dropoff_project_vehicle_claim AFTER INSERT OR UPDATE ON crest.custody_cases
 FOR EACH ROW EXECUTE FUNCTION crest_private.project_vehicle_custody_claim();
CREATE TRIGGER pickup_project_vehicle_claim AFTER INSERT ON crest_private.pickup_custody_collections
 FOR EACH ROW EXECUTE FUNCTION crest_private.project_vehicle_custody_claim();
CREATE CONSTRAINT TRIGGER verify_pickup_collection_row AFTER INSERT ON crest_private.pickup_custody_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_collection();
CREATE CONSTRAINT TRIGGER verify_pickup_collection_operation AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.collect')
 EXECUTE FUNCTION crest_private.check_pickup_collection();

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb) TO crest_web;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_pickup_collection(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_job_vehicle uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; job crest.jobs; policy crest_private.pickup_custody_policies; saved crest_private.pickup_custody_collections; vehicle uuid;
 arrival crest.travel_legs; arrived timestamptz; verified jsonb; status text; result jsonb;
BEGIN
 IF requested_job IS NULL OR requested_job_vehicle IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_COLLECTION_READ_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id','',true);
 SELECT j.* INTO job FROM crest.jobs j JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id
 WHERE j.business_id=requested_business AND j.id=requested_job AND v.id=requested_job_vehicle
  AND j.fulfillment_mode='pickup_return' AND j.operator_actor_id=expected_actor;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT v.vehicle_id INTO STRICT vehicle FROM crest.job_vehicles v WHERE v.business_id=requested_business
  AND v.job_id=requested_job AND v.id=requested_job_vehicle;
 SELECT * INTO saved FROM crest_private.pickup_custody_collections
 WHERE business_id=requested_business AND job_id=requested_job AND job_vehicle_id=requested_job_vehicle;
 IF FOUND THEN
  SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies WHERE business_id=requested_business AND id=saved.policy_id;
  verified:=crest_private.pickup_collection_original(requested_business,expected_actor,saved.operation_id);
  IF verified->>'state' IS DISTINCT FROM 'committed'
   OR NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business
    AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  status:=CASE WHEN job.state='cancelled' THEN 'return_required' ELSE 'held' END;
 ELSE
  SELECT * INTO policy FROM crest_private.pickup_custody_policies
  WHERE business_id=requested_business AND id=crest_private.pickup_policy_for_job(requested_business,requested_job);
  SELECT l.* INTO arrival FROM crest.travel_legs l JOIN crest_private.operations o
   ON o.business_id=l.business_id AND o.operation_id=l.operation_id AND o.actor_id=l.created_by
  WHERE l.business_id=requested_business AND l.job_context_id=requested_job AND l.operator_actor_id=expected_actor
   AND l.purpose='pickup' AND l.change_kind='arrive' AND l.state='closed' AND o.command_type='operations.pickup_trip.record'
   AND (o.result->'receipt'->'jobVehicleIds') ? requested_job_vehicle::text
  ORDER BY l.arrived_at DESC,l.id DESC LIMIT 1;
  IF arrival.id IS NOT NULL THEN
   arrived:=crest_private.pickup_collection_arrival(requested_business,expected_actor,requested_job,requested_job_vehicle,arrival.id);
   IF arrived IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  END IF;
  status:=CASE WHEN job.state<>'scheduled' THEN 'closed' WHEN arrived IS NULL THEN 'awaiting_arrival'
   WHEN policy.id IS NULL THEN 'requires_policy' WHEN policy.condition_photo_required THEN 'photo_required'
   WHEN EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business AND c.vehicle_id=vehicle)
    THEN 'vehicle_held' ELSE 'ready' END;
 END IF;
 result:=jsonb_build_object('schemaVersion',1,'state',status,'businessId',requested_business,'jobId',requested_job,
  'jobVehicleId',requested_job_vehicle,'jobVersion',job.version::text,
  'policy',CASE WHEN policy.id IS NOT NULL THEN jsonb_build_object('id',policy.id,'conditionPhotoRequired',policy.condition_photo_required,
    'acknowledgementText',policy.acknowledgement_text) END,
  'arrival',CASE WHEN arrived IS NOT NULL THEN jsonb_build_object('versionId',arrival.id,
    'arrivedAt',to_char(arrived AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END,
  'collection',verified->'receipt'->'collection');
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_web;

DO $conflict$
DECLARE definition text; marker constant text:='violated_constraint=''custody_one_held_case_per_vehicle''';
BEGIN
 definition:=pg_get_functiondef('crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,marker,'')))<>length(marker)
 THEN RAISE EXCEPTION 'CREST_DROPOFF_CLAIM_EXTENSION_REQUIRED'; END IF;
 EXECUTE replace(definition,marker,'violated_constraint IN (''custody_one_held_case_per_vehicle'',''custody_cross_mode_vehicle_held'')');
END $conflict$;

-- pickup-custody-recovery.sql
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

-- pickup-custody-policy.sql
-- Held BR08 policy settings. Booking and policy saves share the existing
-- arrangement lock. Each new pickup job retains the selected policy forever.
RESET ROLE;
DO $review$ BEGIN
 IF EXISTS(SELECT FROM crest_private.pickup_custody_policies)
  OR EXISTS(SELECT FROM crest_private.pickup_custody_collections)
 THEN RAISE EXCEPTION 'CREST_PICKUP_POLICY_ADOPTION_REQUIRES_EMPTY_CANDIDATE'; END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest_private.pickup_custody_policies
 DROP CONSTRAINT pickup_custody_policies_business_id_mode_version_id_key,
 ADD COLUMN sequence bigint NOT NULL CHECK(sequence>0),
 ADD COLUMN replaces_sequence bigint CHECK(replaces_sequence=sequence-1),
 ADD COLUMN reason text CHECK(reason IS NULL OR char_length(reason)<=1000 AND btrim(reason,E' \t\r\n')<>''),
 ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 ADD COLUMN created_by uuid NOT NULL,
 ADD UNIQUE(business_id,sequence),
 ADD FOREIGN KEY(business_id,replaces_sequence) REFERENCES crest_private.pickup_custody_policies(business_id,sequence),
 ADD FOREIGN KEY(business_id,id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 ADD CHECK((sequence=1)=(replaces_sequence IS NULL) AND (sequence=1 OR reason IS NOT NULL));

CREATE TABLE crest_private.pickup_job_policies(
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 PRIMARY KEY(business_id,job_id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY(business_id,policy_id) REFERENCES crest_private.pickup_custody_policies(business_id,id)
);
ALTER TABLE crest_private.pickup_job_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_job_policies FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_job_policy BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_job_policies
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_job_policies TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_job_policies TO crest_booking_integrity_owner;
CREATE POLICY pickup_job_policy_read ON crest_private.pickup_job_policies FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY pickup_job_policy_integrity ON crest_private.pickup_job_policies FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY pickup_job_policy_append ON crest_private.pickup_job_policies FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.jobs j WHERE j.business_id=pickup_job_policies.business_id AND j.id=pickup_job_policies.job_id
   AND j.fulfillment_mode='pickup_return' AND j.operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid));

CREATE POLICY pickup_policy_op_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(command_type='operations.pickup_custody.policy.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_policy_op_append ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(command_type='operations.pickup_custody.policy.save' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_policy_op_commit ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(command_type='operations.pickup_custody.policy.save' AND state='pending' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid)
 WITH CHECK(command_type='operations.pickup_custody.policy.save' AND state='committed' AND result_schema_version=1
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_policy_op_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.pickup_custody.policy.save');
GRANT INSERT ON crest_private.pickup_custody_policies TO crest_booking_owner;
CREATE POLICY pickup_policy_append ON crest_private.pickup_custody_policies FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=pickup_custody_policies.business_id
   AND o.operation_id=pickup_custody_policies.id AND o.actor_id=pickup_custody_policies.created_by
   AND o.command_type='operations.pickup_custody.policy.save' AND o.state='pending'));
CREATE POLICY pickup_policy_audit_append ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(entity_kind='pickup_custody_policies' AND action='create' AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_id=operation_id);
CREATE POLICY pickup_policy_audit_receipt ON crest_private.audit_events FOR SELECT TO crest_booking_owner
 USING(entity_kind='pickup_custody_policies' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_policy_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='pickup_custody_policies');

CREATE OR REPLACE FUNCTION crest_private.pickup_policy_for_job(requested_business uuid,requested_job uuid) RETURNS uuid
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $policy$
 SELECT policy_id FROM crest_private.pickup_job_policies WHERE business_id=requested_business AND job_id=requested_job
$policy$;

CREATE FUNCTION crest_private.pickup_policy_projection(p crest_private.pickup_custody_policies) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('id',p.id,'modeVersionId',p.mode_version_id,'sequence',p.sequence::text,
  'acknowledgementText',p.acknowledgement_text,'conditionPhotoRequired',p.condition_photo_required,'reason',p.reason,
  'recordedAt',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

CREATE FUNCTION crest_private.pickup_policy_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; policy crest_private.pickup_custody_policies; prior crest_private.pickup_custody_policies;
 audit record; projected jsonb; expected jsonb; request jsonb;
BEGIN
 SELECT o.recovery_epoch,o.payload_hash,o.result INTO saved FROM crest_private.operations o WHERE o.business_id=business
  AND o.operation_id=operation AND o.actor_id=actor AND o.command_type='operations.pickup_custody.policy.save'
  AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies
 WHERE business_id=business AND id=operation AND created_by=actor;
 SELECT * INTO prior FROM crest_private.pickup_custody_policies
 WHERE business_id=business AND sequence=policy.replaces_sequence;
 SELECT a.id,a.delta INTO STRICT audit FROM crest_private.audit_events a WHERE a.business_id=business AND a.actor_id=actor
  AND a.operation_id=operation AND a.entity_id=operation AND a.entity_kind='pickup_custody_policies'
  AND a.entity_version=policy.sequence AND a.action='create' AND a.origin='manual' AND a.import_row_id IS NULL;
 projected:=crest_private.pickup_policy_projection(policy);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.policy.save',
  'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,
  'expectedSequence',(policy.sequence-1)::text,'body',projected-ARRAY['id','modeVersionId','sequence','recordedAt']);
 expected:=jsonb_build_object('schemaVersion',1,'policy',projected,'auditId',audit.id);
 IF audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',
   CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.pickup_policy_projection(prior) END,'after',projected)
  OR saved.result IS DISTINCT FROM expected
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',expected,'request',request);
END $original$;

CREATE FUNCTION crest_private.check_pickup_policy_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE row_data jsonb:=to_jsonb(NEW);
BEGIN
 IF crest_private.pickup_policy_original(NEW.business_id,coalesce(row_data->>'actor_id',row_data->>'created_by')::uuid,
    coalesce(row_data->>'operation_id',row_data->>'id')::uuid)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_private.bind_pickup_booking_policy() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $bind$
DECLARE chosen uuid;
BEGIN
 -- book_job already takes this lock before checking the current mode.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||NEW.business_id::text,0));
 SELECT id INTO STRICT chosen FROM crest_private.pickup_custody_policies
 WHERE business_id=NEW.business_id ORDER BY sequence DESC LIMIT 1;
 INSERT INTO crest_private.pickup_job_policies(business_id,job_id,policy_id) VALUES(NEW.business_id,NEW.id,chosen);
 RETURN NULL;
END $bind$;

CREATE FUNCTION crest_commands.save_pickup_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,expected_sequence bigint,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE authority jsonb; mode_id uuid; claim uuid; request jsonb; digest text; original jsonb; conflict text;
 prior crest_private.pickup_custody_policies; policy crest_private.pickup_custody_policies; projected jsonb; audit_id uuid;
BEGIN
 IF requested_operation IS NULL OR expected_sequence IS NULL OR expected_sequence<0 OR expected_sequence=9223372036854775807
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT body ?& ARRAY['acknowledgementText','conditionPhotoRequired','reason']
  OR body-ARRAY['acknowledgementText','conditionPhotoRequired','reason']<>'{}'::jsonb OR octet_length(body::text)>16384
  OR jsonb_typeof(body->'conditionPhotoRequired') IS DISTINCT FROM 'boolean'
  OR (body->'acknowledgementText'<>'null'::jsonb AND crest_private.booking_text_required(body->'acknowledgementText',2000) IS NOT TRUE)
  OR (body->'reason'='null'::jsonb AND expected_sequence>0
   OR body->'reason'<>'null'::jsonb AND crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.policy.save','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'expectedSequence',expected_sequence::text,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.policy.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   original:=crest_private.pickup_policy_original(requested_business,expected_actor,requested_operation);
   IF original->'request' IS DISTINCT FROM request THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT id INTO mode_id FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF mode_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='arrangements'; END IF;
   SELECT * INTO prior FROM crest_private.pickup_custody_policies WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF coalesce(prior.sequence,0)<>expected_sequence THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='version'; END IF;
   IF prior.id IS NOT NULL AND ROW(prior.acknowledgement_text,prior.condition_photo_required)
    IS NOT DISTINCT FROM ROW(body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean)
   THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='unchanged'; END IF;
   INSERT INTO crest_private.pickup_custody_policies(id,business_id,mode_version_id,sequence,replaces_sequence,
    acknowledgement_text,condition_photo_required,reason,created_by)
   VALUES(requested_operation,requested_business,mode_id,expected_sequence+1,prior.sequence,
    body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean,body->>'reason',expected_actor) RETURNING * INTO policy;
   projected:=crest_private.pickup_policy_projection(policy);
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_custody_policies',policy.id,policy.sequence,'create',
    jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.pickup_policy_projection(prior) END,
     'after',projected),'manual') RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'policy',projected,'auditId',audit_id)
   WHERE business_id=requested_business AND operation_id=requested_operation;
   original:=crest_private.pickup_policy_original(requested_business,expected_actor,requested_operation);
   IF original->'request' IS DISTINCT FROM request THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN original-'request';
 EXCEPTION WHEN SQLSTATE 'P1969' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $save$;

CREATE FUNCTION crest_commands.read_pickup_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,before_sequence bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; policy crest_private.pickup_custody_policies; latest bigint; cursor_sequence bigint; verified jsonb; versions jsonb:='[]';
BEGIN
 IF before_sequence IS NOT NULL AND before_sequence<1
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id','',true);
 SELECT coalesce(max(sequence),0) INTO latest FROM crest_private.pickup_custody_policies WHERE business_id=requested_business;
 IF before_sequence>latest THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_INPUT_REQUIRED'; END IF;
 FOR policy IN SELECT * FROM crest_private.pickup_custody_policies WHERE business_id=requested_business
  AND sequence<=latest AND (before_sequence IS NULL OR sequence<before_sequence) ORDER BY sequence DESC LIMIT 20
 LOOP
  verified:=crest_private.pickup_policy_original(requested_business,policy.created_by,policy.id);
  IF verified->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
  versions:=versions||jsonb_build_array(verified->'receipt'->'policy');cursor_sequence:=policy.sequence;
 END LOOP;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'currentSequence',latest::text,'versions',versions,
  'hasMore',coalesce(cursor_sequence>1,false));
END $read$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_booking_owner,crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_policy_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_policy_original() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.bind_pickup_booking_policy() OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.save_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_booking_owner,crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_policy_projection(crest_private.pickup_custody_policies),
 crest_private.pickup_policy_original(uuid,uuid,uuid),crest_private.check_pickup_policy_original(),crest_private.bind_pickup_booking_policy(),
 crest_commands.save_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.read_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_policy_projection(crest_private.pickup_custody_policies) TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_policy_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.read_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint) TO crest_web;
CREATE CONSTRAINT TRIGGER pickup_policy_row_original AFTER INSERT ON crest_private.pickup_custody_policies
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_policy_original();
CREATE CONSTRAINT TRIGGER pickup_policy_operation_original AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.policy.save')
 EXECUTE FUNCTION crest_private.check_pickup_policy_original();
CREATE TRIGGER capture_pickup_booking_policy AFTER INSERT ON crest.jobs
 FOR EACH ROW WHEN(NEW.fulfillment_mode='pickup_return') EXECUTE FUNCTION crest_private.bind_pickup_booking_policy();

DO $booking$
DECLARE source text; marker constant text:=E'   IF EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job)';
 signature constant text:='crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('crest.fulfillment.modes/1:' in source)=0 OR position('pickup_policy' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_BOOKING_POLICY_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,$require$
   IF body->>'fulfillmentMode'='pickup_return' AND NOT EXISTS(
    SELECT FROM crest_private.pickup_custody_policies WHERE business_id=requested_business)
   THEN reason:='pickup_policy';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
$require$||marker);
END $booking$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.policy.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.pickup_custody.policy.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','expectedSequence'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb
   OR jsonb_typeof(r->'expectedSequence') IS DISTINCT FROM 'string'
   OR (r->>'expectedSequence')!~'^(0|[1-9][0-9]{0,18})$' THEN RETURN false; END IF;
  RETURN coalesce((r->>'expectedSequence')::numeric<9223372036854775807
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE,false);
 END IF;
$case$);
END $reference$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_pickup_policy_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE ref jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.policy.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 ref:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_policy_original(requested_business,expected_actor,(ref->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR ref IS DISTINCT FROM (saved->'request')-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed',
  'receipt',jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.policy.save',
   'businessId',requested_business,'actorId',expected_actor,'operationId',ref->'operationId','recoveryEpoch',ref->'recoveryEpoch',
   'subjectId',requested_business,'sourceRecordId',receipt->'policy'->'id','sourceVersion',receipt->'policy'->'sequence',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_pickup_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.policy.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.pickup_custody.policy.save' THEN
  RETURN crest_commands.lookup_pickup_policy_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;

-- The normal settings command shares the lock used above. Its dedicated
-- definer can see that a scoped policy exists without seeing its contents.
GRANT SELECT(business_id) ON crest_private.pickup_custody_policies TO crest_mode_owner;
CREATE POLICY pickup_policy_exists_for_mode ON crest_private.pickup_custody_policies FOR SELECT TO crest_mode_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
DO $modes$
DECLARE source text; marker constant text:='   IF expected_sequence>0 AND ROW(';
 handler constant text:='WHEN SQLSTATE ''P1002'' THEN RETURN jsonb_build_object(''state'',''conflict'',''reason'',''review'');END;';
 signature constant text:='crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR (length(source)-length(replace(source,handler,'')))<>length(handler)
  OR position('crest.fulfillment.modes/1:' in source)=0 OR position('pickup_policy' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_MODE_POLICY_REVIEW_REQUIRED'; END IF;
 source:=replace(source,marker,$require$
   IF (body->>'pickupReturnEnabled')::boolean AND NOT EXISTS(
    SELECT FROM crest_private.pickup_custody_policies WHERE business_id=requested_business)
   THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='CREST_PICKUP_POLICY_REQUIRED'; END IF;
$require$||marker);
 EXECUTE replace(source,handler,replace(handler,';END;',';
  WHEN SQLSTATE ''P1969'' THEN RETURN jsonb_build_object(''state'',''conflict'',''reason'',''pickup_policy'');END;'));
END $modes$;

-- pickup-custody-photos.sql
-- Shared private photo transport with an immutable pickup-specific reservation.
-- The case identifier on a pickup attempt is the planned collection operation.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.pickup_photo_slots (
 business_id uuid NOT NULL,
 photo_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 arrival_version_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 job_version bigint NOT NULL CHECK(job_version>0 AND job_version<9223372036854775807),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 PRIMARY KEY(business_id,photo_id),
 FOREIGN KEY(business_id,photo_id) REFERENCES crest.custody_photo_attempts(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(business_id,job_id,actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),
 FOREIGN KEY(business_id,arrival_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY(business_id,policy_id) REFERENCES crest_private.pickup_custody_policies(business_id,id)
);
ALTER TABLE crest_private.pickup_photo_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_photo_slots FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_photo_slot BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_photo_slots
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_photo_slots TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_photo_slots TO crest_booking_integrity_owner;
CREATE POLICY pickup_photo_slot_read ON crest_private.pickup_photo_slots FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_photo_slot_append ON crest_private.pickup_photo_slots FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_photo_slot_integrity ON crest_private.pickup_photo_slots FOR SELECT TO crest_booking_integrity_owner USING(true);

ALTER TABLE crest_private.pickup_custody_collections
 ALTER COLUMN missing_photo_reason DROP NOT NULL,
 ADD COLUMN condition_photo_id uuid,
 ADD FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest.custody_photo_originals(business_id,photo_id),
 ADD FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest_private.pickup_photo_slots(business_id,photo_id),
 ADD UNIQUE(business_id,condition_photo_id),
 ADD CHECK((condition_photo_id IS NULL)<>(missing_photo_reason IS NULL));

CREATE FUNCTION crest_private.lock_custody_photo_slot(
 business uuid,actor uuid,booked_vehicle uuid,custody_case uuid,handoff integer,photo uuid
) RETURNS crest.job_vehicles LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $slot$
DECLARE slot crest_private.pickup_photo_slots; booked crest.job_vehicles; job crest.jobs;
BEGIN
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=business AND s.photo_id=photo AND s.actor_id=actor;
 IF NOT FOUND THEN RETURN crest_private.lock_dropoff_photo_slot(business,actor,booked_vehicle,custody_case,handoff); END IF;
 SELECT v.* INTO booked FROM crest.job_vehicles v WHERE v.business_id=business AND v.id=booked_vehicle;
 SELECT j.* INTO job FROM crest.jobs j WHERE j.business_id=business AND j.id=booked.job_id FOR SHARE;
 IF job.id IS NULL OR job.operator_actor_id IS DISTINCT FROM actor OR job.fulfillment_mode<>'pickup_return' OR job.state<>'scheduled'
  OR (slot.job_id,slot.job_vehicle_id,slot.collection_id,slot.job_version) IS DISTINCT FROM (job.id,booked_vehicle,custody_case,job.version)
  OR handoff IS DISTINCT FROM 1 OR slot.policy_id IS DISTINCT FROM crest_private.pickup_policy_for_job(business,job.id)
  OR crest_private.pickup_collection_arrival(business,actor,job.id,booked_vehicle,slot.arrival_version_id) IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||business::text||':'||booked_vehicle::text,0));
 IF EXISTS(SELECT FROM crest_private.pickup_custody_collections c WHERE c.business_id=business AND c.job_vehicle_id=booked_vehicle)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'; END IF;
 RETURN booked;
END $slot$;

CREATE FUNCTION crest_private.verified_pickup_photo(
 business uuid,actor uuid,photo uuid,collection uuid,job uuid,booked_vehicle uuid,arrival uuid,policy uuid,
 version bigint,epoch uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $photo$
 SELECT EXISTS(SELECT FROM crest_private.pickup_photo_slots s
  JOIN crest.custody_photo_attempts a ON (a.business_id,a.id)=(s.business_id,s.photo_id)
  JOIN crest.custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)
  WHERE (s.business_id,s.actor_id,s.photo_id,s.collection_id,s.job_id,s.job_vehicle_id,s.arrival_version_id,
   s.policy_id,s.job_version,s.recovery_epoch)=(business,actor,photo,collection,job,booked_vehicle,arrival,policy,version,epoch)
   AND (a.actor_id,a.job_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
       =(actor,job,booked_vehicle,collection,1,epoch) AND o.verified_at>=a.reserved_at)
$photo$;

CREATE FUNCTION crest_commands.reserve_pickup_photo(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 photo uuid,booked_vehicle uuid,collection uuid,arrival uuid,policy uuid,expected_job_version bigint,content_type text,size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE authority jsonb; slot crest_private.pickup_photo_slots; requested_job uuid;
BEGIN
 IF photo IS NULL OR booked_vehicle IS NULL OR collection IS NULL OR photo=collection OR arrival IS NULL OR policy IS NULL
  OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version=9223372036854775807
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_PHOTO_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 -- Take the same owner lock as reserve_dropoff_photo, before either identity can be claimed.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.owner/1:'||requested_business::text||':'||expected_actor::text,0));
 SELECT job_id INTO requested_job FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.id=booked_vehicle;
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;
 IF slot.photo_id IS NOT NULL THEN
  IF (slot.job_vehicle_id,slot.collection_id,slot.arrival_version_id,slot.policy_id,slot.job_version,slot.recovery_epoch)
   IS DISTINCT FROM (booked_vehicle,collection,arrival,policy,expected_job_version,expected_epoch)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_RESERVATION_CHANGED'; END IF;
 ELSE
  IF requested_job IS NULL OR EXISTS(SELECT FROM crest.custody_photo_attempts a WHERE a.business_id=requested_business AND a.id=photo)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'; END IF;
  INSERT INTO crest_private.pickup_photo_slots(business_id,photo_id,job_id,job_vehicle_id,collection_id,arrival_version_id,policy_id,
   job_version,actor_id,recovery_epoch)
  VALUES(requested_business,photo,requested_job,booked_vehicle,collection,arrival,policy,expected_job_version,expected_actor,expected_epoch);
 END IF;
 RETURN crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,photo,booked_vehicle,collection,1,content_type,size);
END $reserve$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_booking_owner,crest_booking_integrity_owner;
ALTER FUNCTION crest_private.lock_custody_photo_slot(uuid,uuid,uuid,uuid,integer,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.verified_pickup_photo(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.reserve_pickup_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_booking_owner,crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.lock_custody_photo_slot(uuid,uuid,uuid,uuid,integer,uuid),
 crest_private.verified_pickup_photo(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid),
 crest_commands.reserve_pickup_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_private.verified_pickup_photo(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_pickup_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 TO crest_web;

CREATE OR REPLACE FUNCTION crest_private.valid_pickup_collection_body(body jsonb,recorded timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(jsonb_typeof(body)='object'
  AND body ?& ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed']
  AND body-ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed','conditionPhotoId']='{}'::jsonb
  AND octet_length(body::text)<=16384
  AND crest_private.valid_support_instant(body->'effectiveAt',recorded)
  AND jsonb_typeof(body->'person')='object' AND (body->'person')-ARRAY['schemaVersion','displayName']='{}'::jsonb
  AND body->'person'->'schemaVersion'='1'::jsonb AND crest_private.booking_text_required(body->'person'->'displayName',200)
  AND crest_private.valid_support_location(body->'location')
  AND (body->'notes'='null'::jsonb OR crest_private.booking_text_required(body->'notes',1000))
  AND (CASE WHEN body ? 'conditionPhotoId' THEN body->'missingPhotoReason'='null'::jsonb
        AND crest_private.original_operation_uuid(body->'conditionPhotoId') IS TRUE
       ELSE crest_private.booking_text_required(body->'missingPhotoReason',1000) END)
  AND body->'acknowledgementConfirmed' IN ('null'::jsonb,'true'::jsonb),false)
$valid$;

CREATE OR REPLACE FUNCTION crest_private.pickup_collection_projection(c crest_private.pickup_custody_collections) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN c.condition_photo_id IS NULL THEN to_jsonb(c)-'condition_photo_id' ELSE to_jsonb(c) END)
  ||jsonb_build_object('effective_at',to_char(c.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recorded_at',to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

DO $transport$
DECLARE source text; name text; routine text; marker text; replacement text;
BEGIN
 FOR name,routine,marker,replacement IN SELECT * FROM (VALUES
  ('reserve','crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer)',
   'crest_private.lock_dropoff_photo_slot(requested_business,expected_actor,booked_vehicle,custody_case,handoff)',
   'crest_private.lock_custody_photo_slot(requested_business,expected_actor,booked_vehicle,custody_case,handoff,photo)'),
  ('upload','crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)',
   'crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version)',
   'crest_private.lock_custody_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.id)'),
  ('publish','crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)',
   'crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version)',
   'crest_private.lock_custody_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.id)'),
  ('read','crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
   'SELECT 1 FROM crest.custody_events e WHERE e.business_id=a.business_id AND e.condition_photo_id=a.id))',
   $link$SELECT 1 FROM crest.custody_events e WHERE e.business_id=a.business_id AND e.condition_photo_id=a.id
    UNION ALL SELECT 1 FROM crest_private.pickup_custody_collections c
      WHERE c.business_id=a.business_id AND c.id=a.case_id AND c.job_id=a.job_id AND c.job_vehicle_id=a.job_vehicle_id
       AND c.condition_photo_id=a.id))$link$),
  ('original access','crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)',
   ' IF handoff_id IS NULL THEN RAISE EXCEPTION',
   $access$ IF handoff_id IS NULL THEN
  SELECT c.id INTO handoff_id FROM crest_private.pickup_custody_collections c
  WHERE c.business_id=requested_business AND c.id=custody_case AND c.condition_photo_id=photo
   AND c.job_vehicle_id=booked_vehicle AND c.job_id=(current_record->'reservation'->>'job_id')::uuid;
 END IF;
 IF handoff_id IS NULL THEN RAISE EXCEPTION$access$),
  ('reservation audit','crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals)',
   ' after_row:=CASE WHEN publication THEN snapshot',
   $audit$ snapshot:=snapshot||coalesce((SELECT jsonb_build_object('pickup',jsonb_build_object('arrivalVersionId',s.arrival_version_id,
   'policyId',s.policy_id,'jobVersion',s.job_version::text)) FROM crest_private.pickup_photo_slots s
   WHERE s.business_id=a.business_id AND s.photo_id=a.id),'{}'::jsonb);
 after_row:=CASE WHEN publication THEN snapshot$audit$)
 ) AS commands(name,routine,marker,replacement)
 LOOP
  source:=pg_get_functiondef(to_regprocedure(routine));
  IF source IS NULL OR length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_PHOTO_TRANSPORT_REVIEW_REQUIRED: %',name; END IF;
  EXECUTE replace(source,marker,replacement);
 END LOOP;
END $transport$;

DO $collection$
DECLARE source text; routine text; marker text; replacement text; current_routine text;
BEGIN
 FOR routine,marker,replacement IN SELECT * FROM (VALUES
  ('crest_private.pickup_collection_original(uuid,uuid,uuid)',
   ' receipt:=jsonb_build_object(''collection'',projected',
   $body$ IF collection.condition_photo_id IS NOT NULL THEN
  body:=body||jsonb_build_object('conditionPhotoId',collection.condition_photo_id);
 END IF;
 receipt:=jsonb_build_object('collection',projected$body$),
  ('crest_private.pickup_collection_original(uuid,uuid,uuid)',
   'OR arrived IS NULL OR collection.effective_at<arrived OR policy.condition_photo_required',
   $body$OR arrived IS NULL OR collection.effective_at<arrived
  OR (policy.condition_photo_required AND collection.condition_photo_id IS NULL)
  OR (collection.condition_photo_id IS NOT NULL AND NOT crest_private.verified_pickup_photo(
   business,actor,collection.condition_photo_id,collection.id,collection.job_id,collection.job_vehicle_id,
   collection.pickup_leg_version_id,collection.policy_id,(request->>'expectedJobVersion')::bigint,saved.recovery_epoch))$body$),
  ('crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
   '   IF policy.condition_photo_required THEN RAISE EXCEPTION USING ERRCODE=''P1943'',MESSAGE=''photo''; END IF;',
   $body$   PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||requested_job_vehicle::text,0));
   IF (policy.condition_photo_required AND NOT body ? 'conditionPhotoId') OR (body ? 'conditionPhotoId'
    AND NOT crest_private.verified_pickup_photo(requested_business,expected_actor,(body->>'conditionPhotoId')::uuid,
     requested_operation,requested_job,requested_job_vehicle,requested_pickup_leg_version,requested_policy,expected_job_version,expected_epoch))
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='photo'; END IF;$body$),
  ('crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
   'effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,acknowledgement_confirmed,created_by,operation_id)',
   'effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,condition_photo_id,acknowledgement_confirmed,created_by,operation_id)'),
  ('crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
   'body->>''missingPhotoReason'',(body->>''acknowledgementConfirmed'')::boolean',
   'body->>''missingPhotoReason'',(body->>''conditionPhotoId'')::uuid,(body->>''acknowledgementConfirmed'')::boolean'),
  ('crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)',
   $state$WHEN policy.id IS NULL THEN 'requires_policy' WHEN policy.condition_photo_required THEN 'photo_required'
   WHEN EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business AND c.vehicle_id=vehicle)
    THEN 'vehicle_held' ELSE 'ready' END;$state$,
   $state$WHEN policy.id IS NULL THEN 'requires_policy'
   WHEN EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business AND c.vehicle_id=vehicle)
    THEN 'vehicle_held' WHEN policy.condition_photo_required THEN 'photo_required' ELSE 'ready' END;$state$)
 ) AS changes(routine,marker,replacement)
 LOOP
  IF current_routine IS DISTINCT FROM routine THEN
   IF current_routine IS NOT NULL THEN EXECUTE source; END IF;
   source:=pg_get_functiondef(to_regprocedure(routine));current_routine:=routine;
  END IF;
  IF source IS NULL OR length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_PHOTO_COLLECTION_REVIEW_REQUIRED: %',routine; END IF;
  source:=replace(source,marker,replacement);
 END LOOP;
 IF current_routine IS NOT NULL THEN EXECUTE source; END IF;
END $collection$;

-- The same closed verifier used by collection receipts also parses the photo id.
GRANT EXECUTE ON FUNCTION crest_private.original_operation_uuid(jsonb) TO crest_booking_integrity_owner;

CREATE FUNCTION crest_private.check_pickup_photo_reservation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.custody_photo_attempts a
  WHERE (a.business_id,a.id,a.actor_id,a.job_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
   =(NEW.business_id,NEW.photo_id,NEW.actor_id,NEW.job_id,NEW.job_vehicle_id,NEW.collection_id,1,NEW.recovery_epoch))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_RESERVATION_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_photo_reservation() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_pickup_photo_reservation() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER verify_pickup_photo_reservation AFTER INSERT ON crest_private.pickup_photo_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_photo_reservation();

-- pickup-custody-source.sql
-- Held pickup source capture. Shared photo byte metadata stays in the existing
-- custody inventory and is joined through the immutable pickup slot.
RESET ROLE;
DO $review$ BEGIN
 IF EXISTS(SELECT FROM (VALUES ('pickup_custody_policies'),('pickup_job_policies'),('pickup_custody_collections'),
  ('pickup_photo_slots'),('vehicle_custody_claims')) expected(name)
  LEFT JOIN pg_class c ON c.oid=to_regclass('crest_private.'||expected.name)
  WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
   OR has_table_privilege('crest_web',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   OR has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION 'CREST_PICKUP_SOURCE_REVIEW_REQUIRED'; END IF;
END $review$;

CREATE FUNCTION crest_private.pickup_custody_source_rows(requested_business uuid,requested_group text)
 RETURNS TABLE(row_id uuid,row_value jsonb) LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $rows$
 SELECT p.id,jsonb_build_object(
  'id',p.id,'business_id',p.business_id,'mode_version_id',p.mode_version_id,'sequence',p.sequence::text,
  'replaces_sequence',p.replaces_sequence::text,'reason',p.reason,'created_by',p.created_by,
  'acknowledgement_text',p.acknowledgement_text,'condition_photo_required',p.condition_photo_required,
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 FROM crest_private.pickup_custody_policies p WHERE requested_group='pickup_custody_policies' AND p.business_id=requested_business
 UNION ALL
 SELECT p.job_id,jsonb_build_object('business_id',p.business_id,'job_id',p.job_id,'policy_id',p.policy_id)
 FROM crest_private.pickup_job_policies p WHERE requested_group='pickup_job_policies' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,'business_id',p.business_id,'job_id',p.job_id,'job_vehicle_id',p.job_vehicle_id,'vehicle_id',p.vehicle_id,
  'pickup_leg_version_id',p.pickup_leg_version_id,'policy_id',p.policy_id,
  'effective_at',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person_snapshot',p.person_snapshot::text,'location_snapshot',p.location_snapshot::text,'notes',p.notes,
  'missing_photo_reason',p.missing_photo_reason,'condition_photo_id',p.condition_photo_id,
  'acknowledgement_confirmed',p.acknowledgement_confirmed,'created_by',p.created_by,'operation_id',p.operation_id)
 FROM crest_private.pickup_custody_collections p WHERE requested_group='pickup_custody_collections' AND p.business_id=requested_business
 UNION ALL
 SELECT p.photo_id,jsonb_build_object(
  'business_id',p.business_id,'photo_id',p.photo_id,'job_id',p.job_id,'job_vehicle_id',p.job_vehicle_id,'collection_id',p.collection_id,
  'arrival_version_id',p.arrival_version_id,'policy_id',p.policy_id,'job_version',p.job_version::text,
  'actor_id',p.actor_id,'recovery_epoch',p.recovery_epoch)
 FROM crest_private.pickup_photo_slots p WHERE requested_group='pickup_photo_slots' AND p.business_id=requested_business
 UNION ALL
 SELECT p.vehicle_id,jsonb_build_object(
  'business_id',p.business_id,'vehicle_id',p.vehicle_id,'dropoff_case_id',p.dropoff_case_id,'pickup_collection_id',p.pickup_collection_id)
 FROM crest_private.vehicle_custody_claims p WHERE requested_group='vehicle_custody_claims' AND p.business_id=requested_business
$rows$;

CREATE FUNCTION crest_commands.pickup_custody_source_context(requested_business uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb; counts jsonb; total bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PICKUP_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_SOURCE_SCOPE_REQUIRED'; END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT jsonb_object_agg(name,rows::text),sum(rows) INTO counts,total FROM (
  SELECT 'pickup_custody_policies' AS name,count(*) AS rows FROM crest_private.pickup_custody_policies WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_job_policies',count(*) FROM crest_private.pickup_job_policies WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_custody_collections',count(*) FROM crest_private.pickup_custody_collections WHERE business_id=requested_business
  UNION ALL SELECT 'pickup_photo_slots',count(*) FROM crest_private.pickup_photo_slots WHERE business_id=requested_business
  UNION ALL SELECT 'vehicle_custody_claims',count(*) FROM crest_private.vehicle_custody_claims WHERE business_id=requested_business
 ) counted;
 IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PICKUP_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.pickup-custody-source.v1','businessId',requested_business,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.pickup-custody-source/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'historySnapshotToken',history->>'snapshotToken','expectedCounts',counts);
END $context$;

CREATE FUNCTION crest_commands.pickup_custody_source_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.pickup_custody_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL
  OR NOT (context->'expectedCounts') ? requested_group OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_SOURCE_PAGE_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(
  SELECT row_id,row_value FROM crest_private.pickup_custody_source_rows(requested_business,requested_group)
  WHERE after_id IS NULL OR row_id>after_id ORDER BY row_id LIMIT page_limit+1
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'group',requested_group,
  'hasMore',(SELECT count(*)>page_limit FROM page),'rows',coalesce(jsonb_agg(row_value ORDER BY row_id),'[]'::jsonb))
 INTO result FROM (SELECT * FROM page ORDER BY row_id LIMIT page_limit) shown;
 RETURN result;
END $page$;

GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_custody_source_rows(uuid,text) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.pickup_custody_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_custody_source_rows(uuid,text),crest_commands.pickup_custody_source_context(uuid),
 crest_commands.pickup_custody_source_page(uuid,text,text,uuid,integer) FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;
