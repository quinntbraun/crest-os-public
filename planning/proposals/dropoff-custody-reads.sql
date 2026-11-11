-- Private per-vehicle read for the held Drop-Off command candidate.
-- The saved booking is the scope. No raw table access is granted.
CREATE FUNCTION crest_commands.read_dropoff_job_custody(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,requested_job uuid,requested_job_vehicle uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL OR requested_job_vehicle IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',j.business_id,'jobId',j.id,'jobState',j.state,
   'jobVehicleId',v.id,'vehicleId',v.vehicle_id,'caseId',c.id,'version',coalesce(c.version,0)::text,
   'state',CASE
    WHEN c.state='released' THEN 'released'
    WHEN c.state='held' AND j.state='cancelled' THEN 'return_required'
    WHEN c.state='held' AND j.state='completed' THEN 'awaiting_collection'
    WHEN c.state='held' THEN 'in_custody'
    WHEN j.state='scheduled' THEN 'expected'
    ELSE 'not_received' END,
   'policy',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,
    'acknowledgementText',a.acknowledgement_text,'conditionPhotoRequired',a.condition_photo_required) END,
   'events',coalesce((SELECT jsonb_agg(crest_private.dropoff_custody_snapshot(c,e) ORDER BY e.version)
     FROM crest.custody_events e WHERE e.business_id=c.business_id AND e.case_id=c.id),'[]'::jsonb))
 INTO result
 FROM crest.jobs j
 JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id AND v.id=requested_job_vehicle
 LEFT JOIN crest.custody_cases c ON c.business_id=v.business_id AND c.job_vehicle_id=v.id
 LEFT JOIN crest.custody_authorization_configs a ON a.business_id=v.business_id AND
  (CASE WHEN c.id IS NULL THEN a.mode_version_id=j.mode_version_id ELSE a.id=c.authorization_config_id END)
 WHERE j.business_id=requested_business AND j.id=requested_job AND j.operator_actor_id=expected_actor AND j.fulfillment_mode='dropoff';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;
ALTER FUNCTION crest_commands.read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_web;
