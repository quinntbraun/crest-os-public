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
