-- Candidate51 prerequisite for a complete booking/reschedule review screen.
-- No migration registration, runtime activation or historical data rewrite.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.booking_slot_review_details(uuid,uuid,uuid,tstzrange,integer,integer)') IS NOT NULL
 OR to_regprocedure('crest_commands.review_booking_slot(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,timestamptz,integer,integer)') IS NOT NULL
 OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_booking_integrity_owner','crest_booking_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole) OR member IN('crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole))
 OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole) AND d.defaclobjtype='f' AND a.grantee NOT IN(d.defaclrole,0))
 OR EXISTS(SELECT 1 FROM (VALUES
 ('crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer)','crest_booking_integrity_owner','a87f2cfa9288b21fad2b5de03b221554bb9fd0bac6206004c3214a509a17e116'),
 ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','3937e854155ab0c1e84a93e529fcc75c486c4587fa1da21565f8250e64fb12a7'),
 ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','ca57088deddeac85b24ba6ebdfdd766a461610ae26f7514e7e179627ec409424'),
 ('crest_commands.change_job_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','d8f0d095e09ea22521674f26e65cca9b99face35899203b01a6eea728c6e3a0d')
 ) expected(signature,owner_name,body_hash) WHERE NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=to_regrole(expected.owner_name) AND p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN(p.proowner,CASE WHEN expected.owner_name='crest_booking_integrity_owner' THEN 'crest_booking_owner'::regrole ELSE 'crest_web'::regrole END))))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_REVIEW_SOURCE_REQUIRED';END IF;
END $review$;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE FUNCTION crest_private.booking_slot_review_details(p_business uuid,p_operator uuid,p_job uuid,p_blocked tstzrange,p_before integer,p_after integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $details$
DECLARE result jsonb;
BEGIN
 IF p_business IS NULL OR p_operator IS NULL OR p_blocked IS NULL OR isempty(p_blocked) OR lower_inf(p_blocked) OR upper_inf(p_blocked) OR NOT isfinite(lower(p_blocked)) OR NOT isfinite(upper(p_blocked)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_REVIEW_INPUT_REQUIRED';END IF;
 -- One statement snapshot; stable UUID tie-breaks agree in preview and saving.
 -- Unknown travel retains the existing directional nearest-neighbour rule.
 WITH overlapping_rows AS MATERIALIZED(
  SELECT r.appointment_id,a.travel_before_seconds,a.travel_after_seconds FROM crest.schedule_reservations r JOIN crest.appointments a ON a.business_id=r.business_id AND a.id=r.appointment_id
  WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND r.blocked_interval&&p_blocked
 ),prior_row AS MATERIALIZED(
  SELECT r.appointment_id,a.travel_after_seconds FROM crest.schedule_reservations r JOIN crest.appointments a ON a.business_id=r.business_id AND a.id=r.appointment_id
  WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND upper(r.blocked_interval)<=lower(p_blocked) ORDER BY upper(r.blocked_interval) DESC,r.appointment_id LIMIT 1
 ),next_row AS MATERIALIZED(
  SELECT r.appointment_id,a.travel_before_seconds FROM crest.schedule_reservations r JOIN crest.appointments a ON a.business_id=r.business_id AND a.id=r.appointment_id
  WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND lower(r.blocked_interval)>=upper(p_blocked) ORDER BY lower(r.blocked_interval),r.appointment_id LIMIT 1
 ) SELECT jsonb_build_object('conflictingAppointmentIds',coalesce((SELECT jsonb_agg(appointment_id ORDER BY appointment_id) FROM overlapping_rows),'[]'::jsonb),
  'unknownTravel',p_before IS NULL OR p_after IS NULL OR EXISTS(SELECT 1 FROM overlapping_rows WHERE travel_before_seconds IS NULL OR travel_after_seconds IS NULL) OR EXISTS(SELECT 1 FROM prior_row WHERE travel_after_seconds IS NULL) OR EXISTS(SELECT 1 FROM next_row WHERE travel_before_seconds IS NULL),
  'beforeAppointmentId',(SELECT appointment_id FROM prior_row),'afterAppointmentId',(SELECT appointment_id FROM next_row)) INTO result;
 RETURN result;
END $details$;
CREATE OR REPLACE FUNCTION crest_private.booking_slot_review(p_business uuid,p_operator uuid,p_job uuid,p_blocked tstzrange,p_before integer,p_after integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
BEGIN
 RETURN crest_private.booking_slot_review_details(p_business,p_operator,p_job,p_blocked,p_before,p_after)-ARRAY['beforeAppointmentId','afterAppointmentId'];
END $review$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.booking_slot_review_details(uuid,uuid,uuid,tstzrange,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.booking_slot_review_details(uuid,uuid,uuid,tstzrange,integer,integer) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
SET LOCAL ROLE crest_booking_owner;
CREATE FUNCTION crest_commands.review_booking_slot(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operator uuid,rescheduled_job uuid,proposed_start timestamptz,proposed_end timestamptz,travel_before integer,travel_after integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $slot$
DECLARE context jsonb;blocked tstzrange;review jsonb;result jsonb;ids uuid[];rows_count integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operator IS NULL OR proposed_start IS NULL OR proposed_end IS NULL OR NOT isfinite(proposed_start) OR NOT isfinite(proposed_end) OR proposed_start<'0001-01-01T00:00:00Z'::timestamptz OR proposed_end>='10000-01-01T00:00:00Z'::timestamptz OR proposed_end<=proposed_start OR travel_before<0 OR travel_after<0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_REVIEW_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 -- Same lock namespace and order as every registered50 reservation writer.
 -- Shared read lock prevents a mixed helper/detail snapshot, creates no row,
 -- reserves no visit and remains bounded by the ordinary request timeout.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
 IF NOT EXISTS(SELECT 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=requested_operator AND active)
 OR rescheduled_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=rescheduled_job AND operator_actor_id=requested_operator)
 THEN PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN jsonb_build_object('state','absent');END IF;
 blocked:=tstzrange(proposed_start-coalesce(travel_before,0)*interval '1 second',proposed_end+coalesce(travel_after,0)*interval '1 second','[)');
 review:=crest_private.booking_slot_review_details(requested_business,requested_operator,rescheduled_job,blocked,travel_before,travel_after);
 IF jsonb_array_length(review->'conflictingAppointmentIds')>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_REVIEW_LIMIT';END IF;
 SELECT coalesce(array_agg(DISTINCT value),ARRAY[]::uuid[]) INTO ids FROM(
  SELECT (value#>>'{}')::uuid AS value FROM jsonb_array_elements(review->'conflictingAppointmentIds') UNION SELECT(review->>'beforeAppointmentId')::uuid UNION SELECT(review->>'afterAppointmentId')::uuid
 ) selected WHERE value IS NOT NULL;
 WITH candidates AS MATERIALIZED(
  SELECT r.appointment_id,r.job_id,j.version,a.sequence,a.start_at,a.end_at,a.timezone,a.travel_before_seconds,a.travel_after_seconds,c.display_name,
   CASE WHEN r.appointment_id=(review->>'beforeAppointmentId')::uuid THEN 'before' WHEN r.appointment_id=(review->>'afterAppointmentId')::uuid THEN 'after' ELSE 'overlap' END AS relation
  FROM crest.schedule_reservations r JOIN crest.jobs j ON j.business_id=r.business_id AND j.id=r.job_id AND j.current_appointment_id=r.appointment_id JOIN crest.appointments a ON a.business_id=r.business_id AND a.id=r.appointment_id AND a.job_id=r.job_id JOIN crest.customers c ON c.business_id=j.business_id AND c.id=j.customer_id
  WHERE r.business_id=requested_business AND r.operator_actor_id=requested_operator AND r.appointment_id=ANY(ids)
 ) SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operatorId',requested_operator,'rescheduledJobId',rescheduled_job,
  'startAt',to_char(proposed_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(proposed_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'travelBeforeSeconds',travel_before,'travelAfterSeconds',travel_after,
  'conflictingAppointmentIds',review->'conflictingAppointmentIds','unknownTravel',review->'unknownTravel','reservations',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'appointmentId',appointment_id,'jobId',job_id,'jobVersion',version::text,'appointmentSequence',sequence::text,'customerName',display_name,'startAt',to_char(start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',timezone,'travelBeforeSeconds',travel_before_seconds,'travelAfterSeconds',travel_after_seconds,'relation',relation) ORDER BY appointment_id) FROM candidates),'[]'::jsonb)),(SELECT count(*) FROM candidates) INTO result,rows_count;
 IF rows_count<>cardinality(ids) OR octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_REVIEW_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $slot$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.review_booking_slot(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,timestamptz,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_booking_slot(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,timestamptz,timestamptz,integer,integer) TO crest_web;
