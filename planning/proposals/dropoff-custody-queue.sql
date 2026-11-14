-- Held collection queue. Reuse the custody projection and the existing
-- owner read authority. The queue is independent of calendar date filters.
GRANT SELECT ON crest_private.dropoff_custody_collection_queue TO crest_booking_owner;

CREATE FUNCTION crest_commands.list_dropoff_collections(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,after_received_at timestamptz,after_case_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $queue$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (after_received_at IS NULL)<>(after_case_id IS NULL) OR after_received_at IS NOT NULL AND NOT isfinite(after_received_at)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_DROPOFF_COLLECTION_CURSOR_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH page AS MATERIALIZED (
  SELECT q.case_id,q.job_id,q.job_vehicle_id,q.received_at,q.collection_state,
   v.vehicle_snapshot->>'label' AS vehicle_label,v.customer_snapshot->>'display_name' AS customer_name
  FROM crest_private.dropoff_custody_collection_queue q
  JOIN crest.jobs j ON j.business_id=q.business_id AND j.id=q.job_id
  JOIN crest.job_vehicles v ON (v.business_id,v.job_id,v.id)=(q.business_id,q.job_id,q.job_vehicle_id)
  WHERE q.business_id=requested_business AND j.operator_actor_id=expected_actor
   AND (after_received_at IS NULL OR (q.received_at,q.case_id)>(after_received_at,after_case_id))
  ORDER BY q.received_at,q.case_id LIMIT 26
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'hasMore',(SELECT count(*) FROM page)>25,
  'rows',coalesce(jsonb_agg(jsonb_build_object('caseId',case_id,'jobId',job_id,'jobVehicleId',job_vehicle_id,
   'receivedAt',to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'state',collection_state,'vehicleLabel',vehicle_label,'customerName',customer_name) ORDER BY received_at,case_id),'[]'::jsonb))
 INTO result FROM (SELECT * FROM page ORDER BY received_at,case_id LIMIT 25) shown;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $queue$;

ALTER FUNCTION crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid) TO crest_web;
