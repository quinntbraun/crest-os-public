-- Held BR07 dependency. Resolve the saved start and its actual arrival before
-- a correction can bind the versions. A writer must take the operator lock
-- before reading this context. No web grant or write capability.
CREATE FUNCTION crest_private.job_work_start_context(business uuid, actor uuid, job uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,pg_temp AS $context$
DECLARE
 saved_job crest.jobs;
 initial_event crest.job_events;
 initial_work crest.work_intervals;
 current_work crest.work_intervals;
 arrival crest.travel_legs;
 current_trip crest.travel_legs;
BEGIN
 SELECT j.* INTO saved_job FROM crest.jobs j
  WHERE j.business_id=business AND j.id=job AND j.operator_actor_id=actor AND j.fulfillment_mode='mobile';
 IF saved_job.first_work_at IS NULL THEN RETURN NULL;END IF;

 SELECT e.* INTO STRICT initial_event FROM crest.job_events e
  WHERE e.business_id=business AND e.job_id=job AND e.created_by=actor AND e.to_state='in_progress'
   AND ((e.from_state='en_route' AND e.evidence->>'action'='arrive')
     OR (e.from_state='scheduled' AND e.evidence->>'action'='direct_arrive'));
 SELECT w.* INTO STRICT initial_work FROM crest.work_intervals w
  WHERE w.business_id=business AND w.id=(initial_event.evidence->>'workIntervalId')::uuid
   AND w.job_id=job AND w.operator_actor_id=actor AND w.operation_id=initial_event.operation_id
   AND w.kind='active' AND w.sequence=1 AND w.change_kind='open' AND w.started_at=initial_event.effective_at;
 SELECT w.* INTO STRICT current_work FROM crest.current_work_intervals w
  WHERE w.business_id=business AND w.logical_id=initial_work.logical_id
   AND w.job_id=job AND w.operator_actor_id=actor AND w.kind='active' AND w.started_at=saved_job.first_work_at;

 IF initial_event.from_state='en_route' THEN
  IF initial_event.evidence->'travelOmissionRecorded' IS DISTINCT FROM 'false'::jsonb THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_CONTEXT_INVALID';
  END IF;
  SELECT l.* INTO STRICT arrival FROM crest.travel_legs l
   WHERE l.business_id=business AND l.id=(initial_event.evidence->>'travelLegId')::uuid
    AND l.job_context_id=job AND l.operator_actor_id=actor AND l.operation_id=initial_event.operation_id
    AND l.purpose='mobile_work_site' AND l.state='closed' AND l.change_kind='arrive'
    AND l.arrived_at=initial_event.effective_at;
  SELECT l.* INTO STRICT current_trip FROM crest.current_travel_legs l
   WHERE l.business_id=business AND l.logical_id=arrival.logical_id
    AND l.job_context_id=job AND l.operator_actor_id=actor AND l.purpose='mobile_work_site'
    AND l.state='closed' AND l.arrived_at=saved_job.first_work_at;
 ELSIF initial_event.evidence->'travelOmissionRecorded' IS DISTINCT FROM 'true'::jsonb
  OR initial_event.evidence->'travelLegId' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_CONTEXT_INVALID';
 END IF;

 RETURN jsonb_build_object(
  'schemaVersion',1,'jobId',saved_job.id,'jobVersion',saved_job.version::text,'initialEventId',initial_event.id,
  'originalStartedAt',to_char(initial_event.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'currentWork',crest_private.field_work_projection(current_work),
  'currentArrivalTrip',CASE WHEN current_trip.id IS NOT NULL THEN crest_private.field_travel_projection(current_trip) END
 );
EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_text_representation THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_CONTEXT_INVALID';
END $context$;

ALTER FUNCTION crest_private.job_work_start_context(uuid,uuid,uuid) OWNER TO crest_schema_owner;
REVOKE ALL ON FUNCTION crest_private.job_work_start_context(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.job_work_start_context(uuid,uuid,uuid) TO crest_booking_owner;
