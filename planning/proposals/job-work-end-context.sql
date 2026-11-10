-- Held BR07 dependency for correcting the completion timestamp. A writer
-- must acquire the operator lock before resolving the current version.
CREATE FUNCTION crest_private.job_work_end_context(business uuid, actor uuid, job uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,pg_temp AS $context$
DECLARE
 saved_job crest.jobs;
 completion_event crest.job_events;
 original_work crest.work_intervals;
 current_work crest.work_intervals;
BEGIN
 SELECT j.* INTO saved_job FROM crest.jobs j
  WHERE j.business_id=business AND j.id=job AND j.operator_actor_id=actor AND j.fulfillment_mode='mobile';
 IF saved_job.state IS DISTINCT FROM 'completed' THEN RETURN NULL;END IF;
 IF saved_job.completed_at IS NULL OR saved_job.first_work_at IS NULL
  OR saved_job.completed_at<saved_job.first_work_at OR saved_job.completion_outcome IS NULL
  OR saved_job.completion_outcome NOT IN('full','partial') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_CONTEXT_INVALID';
 END IF;

 SELECT e.* INTO STRICT completion_event FROM crest.job_events e
  WHERE e.business_id=business AND e.job_id=job AND e.created_by=actor
   AND e.from_state IN('in_progress','paused') AND e.to_state='completed' AND e.evidence->>'action'='complete';
 SELECT w.* INTO STRICT original_work FROM crest.work_intervals w
  WHERE w.business_id=business AND w.id=(completion_event.evidence->>'closedWorkIntervalId')::uuid
   AND w.job_id=job AND w.operator_actor_id=actor AND w.operation_id=completion_event.operation_id
   AND w.change_kind='close' AND w.ended_at=completion_event.effective_at
   AND w.kind=(CASE completion_event.from_state WHEN 'paused' THEN 'pause' ELSE 'active' END);
 SELECT w.* INTO STRICT current_work FROM crest.current_work_intervals w
  WHERE w.business_id=business AND w.logical_id=original_work.logical_id AND w.job_id=job AND w.operator_actor_id=actor
   AND w.kind=original_work.kind AND w.ended_at=saved_job.completed_at AND w.started_at>=saved_job.first_work_at;
 IF EXISTS(SELECT 1 FROM crest.current_work_intervals w
  WHERE w.business_id=business AND w.job_id=job AND w.operator_actor_id=actor AND w.logical_id<>current_work.logical_id
   AND (w.ended_at IS NULL OR w.ended_at>current_work.started_at)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_CONTEXT_INVALID';
 END IF;

 RETURN jsonb_build_object('schemaVersion',1,'jobId',saved_job.id,'jobVersion',saved_job.version::text,
  'completionEventId',completion_event.id,'completionOutcome',saved_job.completion_outcome,
  'firstStartedAt',to_char(saved_job.first_work_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'originalCompletedAt',to_char(completion_event.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'currentWork',crest_private.field_work_projection(current_work));
EXCEPTION WHEN no_data_found OR too_many_rows OR invalid_text_representation THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_CONTEXT_INVALID';
END $context$;

ALTER FUNCTION crest_private.job_work_end_context(uuid,uuid,uuid) OWNER TO crest_schema_owner;
REVOKE ALL ON FUNCTION crest_private.job_work_end_context(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.job_work_end_context(uuid,uuid,uuid) TO crest_booking_owner;
