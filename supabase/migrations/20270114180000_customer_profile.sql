-- Bounded customer profile projection under the existing CRM and scheduling authority.
SET LOCAL ROLE crest_schema_owner;

CREATE INDEX jobs_customer_last_completed ON crest.jobs(business_id,customer_id,completed_at DESC,id DESC)
 WHERE state='completed' AND completed_at IS NOT NULL;

CREATE FUNCTION crest_commands.read_customer_profile(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,after_association uuid,page_limit integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
AS $read$
DECLARE context jsonb; observed timestamptz; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_customer IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_PROFILE_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 observed:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM crest.customers c WHERE c.business_id=requested_business AND c.id=requested_customer) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_PROFILE_UNAVAILABLE';
 END IF;

 WITH linked AS MATERIALIZED (
   SELECT cv.id,cv.vehicle_id,cv.relationship,cv.is_billing,v.label,v.archived_at
   FROM crest.customer_vehicles cv
   JOIN crest.vehicles v ON v.business_id=cv.business_id AND v.id=cv.vehicle_id
   WHERE cv.business_id=requested_business AND cv.customer_id=requested_customer
     AND cv.valid_from<=observed AND (cv.valid_to IS NULL OR cv.valid_to>observed)
     AND (after_association IS NULL OR cv.id>after_association)
   ORDER BY cv.id LIMIT page_limit+1
 ), page AS (
   SELECT * FROM linked ORDER BY id LIMIT page_limit
 )
 SELECT jsonb_build_object(
   'schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
   'asOf',to_char(observed AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'lastVisit',(
     SELECT jsonb_build_object('jobId',j.id,'at',to_char(j.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',a.timezone)
     FROM crest.jobs j
     JOIN crest.appointments a ON a.business_id=j.business_id AND a.job_id=j.id AND a.id=j.current_appointment_id
     WHERE j.business_id=requested_business AND j.customer_id=requested_customer AND j.state='completed' AND j.completed_at<=observed
     ORDER BY j.completed_at DESC,j.id DESC LIMIT 1
   ),
   'nextVisit',(
     SELECT jsonb_build_object('jobId',j.id,'at',to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',a.timezone)
     FROM crest.jobs j
     JOIN crest.appointments a ON a.business_id=j.business_id AND a.job_id=j.id AND a.id=j.current_appointment_id
     WHERE j.business_id=requested_business AND j.customer_id=requested_customer
       AND j.state IN ('scheduled','en_route') AND a.start_at>=observed
     ORDER BY a.start_at,j.id LIMIT 1
   ),
   'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('associationId',id,'vehicleId',vehicle_id,
       'label',label,'relationship',relationship,'billing',is_billing,'archived',archived_at IS NOT NULL) ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*) FROM linked)>page_limit
 ) INTO result;
 PERFORM crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_customer_profile(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_customer_profile(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_customer_profile(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer) TO crest_web;
