-- Unregistered P06/BR06 lifecycle. A proposal/withdrawal retains the current
-- confirmed pointer and reservation. Only recorded customer confirmation swaps
-- them. Every version and generated draft is retained; no message is sent.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NULL
  OR to_regprocedure('crest_private.schedule_confirmation_draft(uuid,uuid,uuid)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole) OR member IN('crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RESCHEDULE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.schedule_confirmation_draft(business uuid,job uuid,appointment uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $draft$
DECLARE j crest.jobs;a crest.appointments;customer_name text;labels jsonb;scope_rows jsonb;location_text text;body_text text;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO a FROM crest.appointments WHERE business_id=business AND job_id=job AND id=appointment;
 SELECT display_name INTO customer_name FROM crest.customers WHERE business_id=business AND id=j.customer_id;
 IF j.id IS NULL OR a.id IS NULL OR customer_name IS NULL OR a.confirmation_state NOT IN('proposed','confirmed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_DRAFT_SOURCE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('vehicleId',vehicle_id,'label',vehicle_snapshot->>'label') ORDER BY vehicle_id),'[]'::jsonb) INTO labels FROM crest.job_vehicles WHERE business_id=business AND job_id=job;
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceAllocationId',source_allocation_id,'partitionId',stable_partition_id,'scopeDescription',scope_description,'amountCents',amount_cents::text) ORDER BY source_allocation_id,stable_partition_id),'[]'::jsonb) INTO scope_rows FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state='assigned';
 location_text:=CASE WHEN j.work_location_snapshot->>'kind'='manual' THEN j.work_location_snapshot->>'locationText' ELSE coalesce(nullif(j.work_location_snapshot->'snapshot'->>'exact_location_text',''),concat_ws(', ',j.work_location_snapshot->'snapshot'->>'line1',j.work_location_snapshot->'snapshot'->>'line2',j.work_location_snapshot->'snapshot'->>'city',j.work_location_snapshot->'snapshot'->>'region',j.work_location_snapshot->'snapshot'->>'postal_code',j.work_location_snapshot->'snapshot'->>'country')) END;
 body_text:='Hi '||customer_name||CASE WHEN a.confirmation_state='confirmed' THEN ', your detailing appointment is confirmed for ' ELSE ', please confirm your updated detailing appointment for ' END||to_char(a.local_start,'YYYY-MM-DD HH24:MI')||' to '||to_char(a.local_end,'YYYY-MM-DD HH24:MI')||' ('||a.timezone||') at '||location_text||'.';
 RETURN jsonb_build_object('schemaVersion',1,'kind','appointment_confirmation','state','prepared','businessId',business,'jobId',j.id,'appointmentId',a.id,'confirmationState',a.confirmation_state,'customerId',j.customer_id,'customerName',customer_name,'fulfillmentMode',j.fulfillment_mode,'workLocation',j.work_location_snapshot,'startAt',to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(a.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',a.timezone,'vehicles',labels,'scope',scope_rows,'bodyText',body_text);
END $draft$;
CREATE FUNCTION crest_private.validate_booking_appointment_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $append$
DECLARE latest crest.appointments;operator uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 SELECT operator_actor_id INTO operator FROM crest.jobs WHERE business_id=NEW.business_id AND id=NEW.job_id;PERFORM crest_private.lock_booking_operator(NEW.business_id,operator);
 SELECT * INTO latest FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(latest.sequence,0)+1 OR NEW.replaces_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_APPOINTMENT_APPEND_CONFLICT';END IF;RETURN NEW;
END $append$;
CREATE TRIGGER booking_appointment_append BEFORE INSERT ON crest.appointments FOR EACH ROW EXECUTE FUNCTION crest_private.validate_booking_appointment_append();
CREATE FUNCTION crest_private.check_booking_schedule_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $event$
DECLARE kind text;action text;a crest.appointments;prior crest.appointments;old_current crest.appointments;before_row jsonb;after_row jsonb;review jsonb;blocked tstzrange;
BEGIN
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND state='committed';
 SELECT * INTO a FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND operation_id=NEW.operation_id;
 SELECT * INTO prior FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND id=a.replaces_id;
 SELECT delta->'before',delta->'after' INTO before_row,after_row FROM crest_private.audit_events WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND entity_kind='jobs' AND entity_id=NEW.job_id AND entity_version=NEW.sequence;
 IF a.id IS NULL OR after_row IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 IF kind='operations.job.book' THEN
  IF NEW.evidence->'confirmationDraft' IS DISTINCT FROM crest_private.schedule_confirmation_draft(NEW.business_id,NEW.job_id,a.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_DRAFT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF before_row IS NULL OR prior.id IS NULL OR a.sequence<>prior.sequence+1 OR a.reason IS DISTINCT FROM NEW.reason THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 SELECT * INTO old_current FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND id=(before_row->>'current_appointment_id')::uuid;
 IF kind='operations.job.cancel' THEN
  IF a.replaces_id IS DISTINCT FROM(NEW.evidence->>'historyPredecessorId')::uuid OR a.customer_confirmation IS NOT NULL OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(old_current.start_at,old_current.end_at,old_current.timezone,old_current.local_start,old_current.local_end,old_current.start_offset_minutes,old_current.end_offset_minutes,old_current.travel_before_seconds,old_current.travel_after_seconds,old_current.contact_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_APPOINTMENT_SOURCE_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF kind IS DISTINCT FROM 'operations.job.reschedule' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 action:=NEW.evidence->'request'->'payload'->>'action';
 IF action NOT IN('propose','confirm','withdraw') OR action IS NULL OR NEW.evidence->'request'->'payload'->>'latestAppointmentId' IS DISTINCT FROM prior.id::text
  OR(before_row-ARRAY['version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id']) IS DISTINCT FROM(after_row-ARRAY['version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id'])
  OR action<>'confirm' AND ROW(before_row->>'current_appointment_id',before_row->>'mode_version_id') IS DISTINCT FROM ROW(after_row->>'current_appointment_id',after_row->>'mode_version_id')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 IF action='confirm' THEN
  IF prior.confirmation_state<>'proposed' OR a.confirmation_state<>'confirmed' OR after_row->>'current_appointment_id' IS DISTINCT FROM a.id::text OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(prior.start_at,prior.end_at,prior.timezone,prior.local_start,prior.local_end,prior.start_offset_minutes,prior.end_offset_minutes,prior.travel_before_seconds,prior.travel_after_seconds,prior.contact_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_CONFIRMATION_SOURCE_REQUIRED';END IF;
 ELSIF action='withdraw' THEN
  IF prior.confirmation_state<>'proposed' OR a.confirmation_state<>'withdrawn' OR coalesce(NEW.evidence->'confirmationDraft','null'::jsonb)<>'null'::jsonb OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(prior.start_at,prior.end_at,prior.timezone,prior.local_start,prior.local_end,prior.start_offset_minutes,prior.end_offset_minutes,prior.travel_before_seconds,prior.travel_after_seconds,prior.contact_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_WITHDRAWAL_SOURCE_REQUIRED';END IF;RETURN NULL;
 ELSE
  IF a.confirmation_state<>'proposed' OR a.customer_confirmation IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_PROPOSAL_SOURCE_REQUIRED';END IF;
  blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');review:=crest_private.booking_slot_review(NEW.business_id,(after_row->>'operator_actor_id')::uuid,NEW.job_id,blocked,a.travel_before_seconds,a.travel_after_seconds);
  IF NEW.evidence->'slotReview' IS DISTINCT FROM review THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_REVIEW_SOURCE_REQUIRED';END IF;
 END IF;
 IF NEW.evidence->'confirmationDraft' IS DISTINCT FROM crest_private.schedule_confirmation_draft(NEW.business_id,NEW.job_id,a.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_DRAFT_REQUIRED';END IF;RETURN NULL;
END $event$;
CREATE CONSTRAINT TRIGGER booking_schedule_event AFTER INSERT ON crest.job_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_schedule_event();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.schedule_confirmation_draft(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.validate_booking_appointment_append() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_schedule_event() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.schedule_confirmation_draft(uuid,uuid,uuid),crest_private.validate_booking_appointment_append(),crest_private.check_booking_schedule_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.schedule_confirmation_draft(uuid,uuid,uuid) TO crest_booking_owner;
