-- Unregistered authorized job reads. No direct table access or financial data.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.booked_job_operation_result(uuid,uuid,uuid)') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_READ_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_confirmed_jobs(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_from timestamptz,requested_until timestamptz,after_start timestamptz,after_job uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_from IS NULL OR requested_until IS NULL OR NOT isfinite(requested_from) OR NOT isfinite(requested_until) OR requested_from<'0001-01-01T00:00:00Z'::timestamptz OR requested_until>='10000-01-01T00:00:00Z'::timestamptz OR requested_until<=requested_from OR requested_until-requested_from>interval '93 days' OR(after_start IS NULL)<>(after_job IS NULL) OR after_start IS NOT NULL AND NOT isfinite(after_start) OR page_limit IS NULL OR page_limit<1 OR page_limit>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH candidates AS MATERIALIZED(
  SELECT j.*,a.id AS appointment_id,a.sequence AS appointment_sequence,a.start_at,a.end_at,a.timezone,a.confirmation_state,r.unknown_travel,c.display_name
  FROM crest.jobs j JOIN crest.appointments a ON a.business_id=j.business_id AND a.job_id=j.id AND a.id=j.current_appointment_id
  JOIN crest.customers c ON c.business_id=j.business_id AND c.id=j.customer_id
  LEFT JOIN crest.schedule_reservations r ON r.business_id=j.business_id AND r.job_id=j.id AND r.appointment_id=a.id
  WHERE j.business_id=requested_business AND a.end_at>requested_from AND a.start_at<requested_until AND(after_start IS NULL OR ROW(a.start_at,j.id)>ROW(after_start,after_job)) ORDER BY a.start_at,j.id LIMIT page_limit+1
 ), page AS(SELECT * FROM candidates ORDER BY start_at,id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobs',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'jobId',p.id,'version',p.version::text,'state',p.state,'customerId',p.customer_id,'customerName',p.display_name,'operatorId',p.operator_actor_id,'fulfillmentMode',p.fulfillment_mode,
  'appointmentId',p.appointment_id,'appointmentSequence',p.appointment_sequence::text,'startAt',to_char(p.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(p.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',p.timezone,'confirmationState',p.confirmation_state,'unknownTravel',p.unknown_travel,'workLocation',p.work_location_snapshot,
  'vehicleCount',(SELECT count(*)::integer FROM crest.job_vehicles v WHERE v.business_id=p.business_id AND v.job_id=p.id),
  'pendingAppointment',(SELECT CASE WHEN latest.confirmation_state='proposed' AND latest.sequence>p.appointment_sequence THEN jsonb_build_object('appointmentId',latest.id,'sequence',latest.sequence::text,'startAt',to_char(latest.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(latest.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',latest.timezone) ELSE NULL END FROM crest.appointments latest WHERE latest.business_id=p.business_id AND latest.job_id=p.id ORDER BY latest.sequence DESC LIMIT 1),
  'vehicleLabels',coalesce((SELECT jsonb_agg(v.label ORDER BY v.id) FROM(SELECT id,vehicle_snapshot->>'label' AS label FROM crest.job_vehicles WHERE business_id=p.business_id AND job_id=p.id ORDER BY id LIMIT 3)v),'[]'::jsonb)
 ) ORDER BY p.start_at,p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*) FROM candidates)>page_limit) INTO result;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $list$;
CREATE FUNCTION crest_commands.read_confirmed_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $detail$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'job',crest_private.jobs_projection(j),'appointment',crest_private.appointments_projection(a),
  'latestAppointment',(SELECT crest_private.appointments_projection(latest) FROM crest.appointments latest WHERE latest.business_id=j.business_id AND latest.job_id=j.id ORDER BY latest.sequence DESC LIMIT 1),
  'confirmationDraft',(SELECT e.evidence->'confirmationDraft' FROM crest.job_events e WHERE e.business_id=j.business_id AND e.job_id=j.id AND e.operation_id=(SELECT latest.operation_id FROM crest.appointments latest WHERE latest.business_id=j.business_id AND latest.job_id=j.id ORDER BY latest.sequence DESC LIMIT 1)),
  'vehicleCount',(SELECT count(*)::integer FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
  'encounterCount',(SELECT count(*)::integer FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
  'allocationCount',(SELECT count(*)::integer FROM crest.current_scope_allocation_parts p WHERE p.business_id=j.business_id AND p.job_id=j.id)) INTO result
 FROM crest.jobs j JOIN crest.appointments a ON a.business_id=j.business_id AND a.id=j.current_appointment_id AND a.job_id=j.id WHERE j.business_id=requested_business AND j.id=requested_job;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $detail$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_confirmed_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,timestamptz,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_confirmed_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,timestamptz,uuid,integer),crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_confirmed_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,timestamptz,uuid,integer),crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
