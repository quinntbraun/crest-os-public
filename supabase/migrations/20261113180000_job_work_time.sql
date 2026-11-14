-- P07/BR07: read saved interval versions and a server observation on one snapshot.
CREATE FUNCTION crest_commands.read_job_work_time(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_TIME_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH observation AS MATERIALIZED (SELECT clock_timestamp() AS observed_at)
 SELECT jsonb_build_object(
  'schemaVersion',1,'businessId',j.business_id,'jobId',j.id,'jobVersion',j.version::text,'jobState',j.state,
  'observedAt',to_char(o.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'intervalVersions',source.rows
 ) INTO result
 FROM crest.jobs j
 CROSS JOIN observation o
 CROSS JOIN LATERAL (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'intervalId',w.logical_id,'versionId',w.id,'sequence',w.sequence::text,'kind',w.kind,
   'startedAt',to_char(w.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'endedAt',to_char(w.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'pauseReason',w.pause_reason,'recordReason',w.reason,'changeKind',w.change_kind,
   'replacesVersionId',w.replaces_id,
   'recordedAt',to_char(w.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ) ORDER BY w.logical_id,w.sequence),'[]'::jsonb) rows
  FROM (
   SELECT * FROM crest.work_intervals w
   WHERE w.business_id=j.business_id AND w.job_id=j.id AND w.operator_actor_id=j.operator_actor_id
   ORDER BY w.logical_id,w.sequence LIMIT 1001
  ) w
 ) source
 WHERE j.business_id=requested_business AND j.id=requested_job AND j.operator_actor_id=expected_actor
  AND j.fulfillment_mode='mobile';
 IF result IS NOT NULL AND (jsonb_array_length(result->'intervalVersions')>1000 OR octet_length(result::text)>1048576) THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_WORK_TIME_LIMIT';
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;

ALTER FUNCTION crest_commands.read_job_work_time(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_job_work_time(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_job_work_time(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
