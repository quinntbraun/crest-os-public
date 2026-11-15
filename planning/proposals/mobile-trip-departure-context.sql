-- Held BR07/BR09 dependency. Identify the exact original Mobile departure
-- and the latest version of that trip, including after an interrupted visit.
CREATE FUNCTION crest_private.mobile_trip_departure_context(business uuid, actor uuid, job uuid, leg uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,pg_temp AS $context$
DECLARE
 saved_job crest.jobs;
 departure crest.job_events;
 original_trip crest.travel_legs;
 current_trip crest.travel_legs;
BEGIN
 SELECT j.* INTO saved_job FROM crest.jobs j
  WHERE j.business_id=business AND j.id=job AND j.operator_actor_id=actor AND j.fulfillment_mode='mobile';
 IF NOT FOUND THEN RETURN NULL;END IF;

 SELECT l.* INTO current_trip FROM crest.current_travel_legs l
  WHERE l.business_id=business AND l.logical_id=leg AND l.job_context_id=job
   AND l.operator_actor_id=actor AND l.purpose='mobile_work_site';
 IF NOT FOUND THEN RETURN NULL;END IF;

 SELECT l.* INTO STRICT original_trip FROM crest.travel_legs l
  WHERE l.business_id=business AND l.id=leg AND l.logical_id=leg AND l.job_context_id=job
   AND l.operator_actor_id=actor AND l.created_by=actor AND l.purpose='mobile_work_site'
   AND l.sequence=1 AND l.change_kind='depart' AND l.state='open';
 SELECT e.* INTO STRICT departure FROM crest.job_events e
  WHERE e.business_id=business AND e.job_id=job AND e.operation_id=original_trip.operation_id AND e.created_by=actor
   AND e.from_state='scheduled' AND e.to_state='en_route' AND e.evidence->>'action'='depart'
   AND e.evidence->>'travelLegId'=leg::text AND e.effective_at=original_trip.departed_at;

 IF ROW(current_trip.driven_vehicle_id,current_trip.origin_snapshot,current_trip.eta_at,
   current_trip.eta_source,current_trip.eta_calculated_at,current_trip.notes)
  IS DISTINCT FROM ROW(original_trip.driven_vehicle_id,original_trip.origin_snapshot,original_trip.eta_at,
   original_trip.eta_source,original_trip.eta_calculated_at,original_trip.notes)
  OR current_trip.state<>'cancelled' AND current_trip.destination_snapshot IS DISTINCT FROM original_trip.destination_snapshot
  OR current_trip.state='open' AND saved_job.state<>'en_route'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_CONTEXT_INVALID';END IF;

 RETURN jsonb_build_object('schemaVersion',1,'jobId',job,'jobVersion',saved_job.version::text,
  'departureEventId',departure.id,
  'originalDepartedAt',to_char(original_trip.departed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'currentTrip',crest_private.field_travel_projection(current_trip));
EXCEPTION WHEN no_data_found OR too_many_rows THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_CONTEXT_INVALID';
END $context$;

ALTER FUNCTION crest_private.mobile_trip_departure_context(uuid,uuid,uuid,uuid) OWNER TO crest_schema_owner;
REVOKE ALL ON FUNCTION crest_private.mobile_trip_departure_context(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.mobile_trip_departure_context(uuid,uuid,uuid,uuid) TO crest_booking_owner;
