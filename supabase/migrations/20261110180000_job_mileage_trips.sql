-- Candidate read for selecting a real trip from a saved job.
-- Recording distance and correcting evidence use the registered commands.
CREATE FUNCTION crest_commands.read_job_mileage_trips(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_job uuid, after_departed_at timestamptz, after_leg uuid,
 page_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL OR (after_departed_at IS NULL)<>(after_leg IS NULL)
    OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 25
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_JOB_MILEAGE_TRIPS_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH trips AS MATERIALIZED (
  SELECT l.logical_id,l.id,l.departed_at,l.arrived_at,l.state,l.purpose,
   coalesce(e.sequence,0)::text AS evidence_version,coalesce(e.distance_status,'unresolved') AS distance_status
  FROM crest.current_travel_legs l
  LEFT JOIN crest.current_mileage_evidence e ON e.business_id=l.business_id AND e.leg_id=l.logical_id
  WHERE l.business_id=requested_business AND l.job_context_id=requested_job
   AND (after_leg IS NULL OR (l.departed_at,l.logical_id)<(after_departed_at,after_leg))
  ORDER BY l.departed_at DESC,l.logical_id DESC LIMIT page_size+1
 ), visible AS (
  SELECT * FROM trips ORDER BY departed_at DESC,logical_id DESC LIMIT page_size
 )
 SELECT jsonb_build_object('schemaVersion',1,'state','loaded','businessId',j.business_id,'jobId',j.id,
  'hasMore',(SELECT count(*)>page_size FROM trips),
  'trips',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'legId',v.logical_id,'legVersionId',v.id,'evidenceVersion',v.evidence_version,
   'departedAt',to_char(v.departed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'arrivedAt',to_char(v.arrived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'state',v.state,'purpose',v.purpose,'distanceStatus',v.distance_status
  ) ORDER BY v.departed_at DESC,v.logical_id DESC),'[]'::jsonb) FROM visible v))
 INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','not_found'));
END $read$;

ALTER FUNCTION crest_commands.read_job_mileage_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_job_mileage_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_job_mileage_trips(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) TO crest_web;
