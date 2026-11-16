-- Saved visits for one CRM record, ordered by immutable recording time.
-- Reuse the schedule's tenant authority and retained job/vehicle bindings.
DO $review$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner'
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL
 ) OR EXISTS (
   SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole
 ) OR EXISTS (
   SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole='crest_schema_owner'::regrole AND d.defaclobjtype='f' AND a.grantee NOT IN (d.defaclrole,0)
 ) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECORD_JOBS_SOURCE_REQUIRED';
 END IF;
END $review$;

SET LOCAL ROLE crest_schema_owner;
CREATE INDEX jobs_customer_record_history ON crest.jobs(business_id,customer_id,created_at DESC,id DESC);
CREATE INDEX job_vehicles_record_history ON crest.job_vehicles(business_id,vehicle_id,created_at DESC,id DESC);
CREATE FUNCTION crest_commands.read_record_jobs(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_kind text,requested_record uuid,after_recorded_at timestamptz,after_entry uuid,page_limit integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
AS $read$
DECLARE context jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_kind IS NULL OR requested_kind NOT IN ('customer','vehicle') OR requested_record IS NULL
   OR (after_recorded_at IS NULL)<>(after_entry IS NULL) OR after_recorded_at IS NOT NULL AND NOT isfinite(after_recorded_at)
   OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50
 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RECORD_JOBS_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);

 WITH candidates AS MATERIALIZED (
  (SELECT j.id AS entry_id,j.id AS job_id,j.created_at AS recorded_at
   FROM crest.jobs j
   WHERE requested_kind='customer' AND j.business_id=requested_business AND j.customer_id=requested_record
    AND (after_recorded_at IS NULL OR ROW(j.created_at,j.id)<ROW(after_recorded_at,after_entry))
   ORDER BY j.created_at DESC,j.id DESC LIMIT page_limit+1)
  UNION ALL
  (SELECT v.id,v.job_id,v.created_at FROM crest.job_vehicles v
   WHERE requested_kind='vehicle' AND v.business_id=requested_business AND v.vehicle_id=requested_record
    AND (after_recorded_at IS NULL OR ROW(v.created_at,v.id)<ROW(after_recorded_at,after_entry))
   ORDER BY v.created_at DESC,v.id DESC LIMIT page_limit+1)
 ), page AS (
  SELECT * FROM candidates ORDER BY recorded_at DESC,entry_id DESC LIMIT page_limit
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'kind',requested_kind,'recordId',requested_record,
  'jobs',coalesce((
   SELECT jsonb_agg(jsonb_build_object(
    'jobId',j.id,'jobVehicleId',v.id,'state',j.state,'fulfillmentMode',j.fulfillment_mode,
    'recordedAt',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'startAt',to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'endAt',to_char(a.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'timezone',a.timezone,'customerName',v.customer_snapshot->>'display_name',
    'vehicleLabels',CASE WHEN requested_kind='vehicle' THEN jsonb_build_array(v.vehicle_snapshot->>'label') ELSE (
      SELECT coalesce(jsonb_agg(picked.label ORDER BY picked.id),'[]'::jsonb) FROM (
        SELECT item.id,item.vehicle_snapshot->>'label' AS label FROM crest.job_vehicles item
        WHERE item.business_id=requested_business AND item.job_id=j.id ORDER BY item.id LIMIT 3
      ) picked
    ) END
   ) ORDER BY p.recorded_at DESC,p.entry_id DESC)
   FROM page p
   JOIN crest.jobs j ON j.business_id=requested_business AND j.id=p.job_id
   JOIN crest.appointments a ON a.business_id=j.business_id AND a.job_id=j.id AND a.id=j.current_appointment_id
   LEFT JOIN crest.job_vehicles v ON requested_kind='vehicle' AND v.business_id=j.business_id AND v.job_id=j.id AND v.id=p.entry_id
  ),'[]'::jsonb),'hasMore',(SELECT count(*) FROM candidates)>page_limit) INTO result;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_record_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,uuid,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_record_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_record_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,uuid,integer) TO crest_web;
