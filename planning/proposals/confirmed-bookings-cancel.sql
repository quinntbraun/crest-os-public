-- Unregistered BR06 cancellation, before any physical work. No fee, message
-- delivery, refund, financial posting or reopening of a terminal job occurs.
-- Communication records owner-observed facts: not_sent / sent / no_contact.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.authorize_booking_statement()') IS NULL OR to_regprocedure('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
  OR(SELECT count(*) FROM pg_trigger WHERE tgname='booking_command_guard' AND tgenabled='O' AND tgfoid='crest_private.authorize_booking_statement()'::regprocedure AND tgrelid IN('crest.jobs'::regclass,'crest.job_vehicles'::regclass,'crest.job_encounters'::regclass,'crest.appointments'::regclass,'crest.operator_controls'::regclass,'crest.schedule_reservations'::regclass,'crest.schedule_overrides'::regclass,'crest.schedule_override_conflicts'::regclass,'crest.allocation_plan_versions'::regclass,'crest.allocation_plan_parts'::regclass,'crest.job_events'::regclass))<>11
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CANCELLATION_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.valid_booking_communication(v jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $communication$
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['state','channel','effectiveAt','evidenceNote']<>'{}'::jsonb OR NOT v ?& ARRAY['state','channel','effectiveAt','evidenceNote'] THEN RETURN false;END IF;
 IF v->>'state'='sent' THEN RETURN crest_private.valid_booking_confirmation(v-'state',recorded);END IF;
 RETURN v->>'state' IN('not_sent','no_contact') AND v->'channel'='null'::jsonb AND v->'effectiveAt'='null'::jsonb AND(CASE WHEN v->>'state'='no_contact' THEN crest_private.booking_text_required(v->'evidenceNote',2000) ELSE v->'evidenceNote'='null'::jsonb OR crest_private.booking_text_required(v->'evidenceNote',2000) END);
END $communication$;
GRANT UPDATE(state,current_appointment_id,version,updated_by,operation_id) ON crest.jobs TO crest_booking_owner;
CREATE POLICY booking_cancel_root ON crest.jobs FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='cancelled');
GRANT DELETE ON crest.schedule_reservations TO crest_booking_owner;
CREATE POLICY booking_cancel_reservation ON crest.schedule_reservations FOR DELETE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_private.cancelled_job_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;predecessor crest.appointments;original jsonb;source_audit crest_private.audit_events;stored jsonb;table_name text;expected_count bigint;counted bigint;prior_appointment uuid;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.cancel';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text OR jsonb_typeof(r->'version') IS DISTINCT FROM 'string' OR(r->>'version')!~'^[1-9][0-9]{0,18}$' OR(r->>'version')::numeric>9223372036854775807 OR jsonb_typeof(r->'appointmentSequence') IS DISTINCT FROM 'string' OR(r->>'appointmentSequence')!~'^[1-9][0-9]{0,18}$' OR(r->>'appointmentSequence')::numeric>9223372036854775807 OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=(r->>'version')::bigint AND action='revise';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'version')::bigint AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'appointmentSequence')::bigint AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';prior_appointment:=(journal.delta->'before'->>'current_appointment_id')::uuid;
 SELECT * INTO predecessor FROM crest.appointments WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND id=(event.evidence->>'historyPredecessorId')::uuid;
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR(original->>'expectedJobVersion')::numeric+1 IS DISTINCT FROM(r->>'version')::numeric
  OR journal.delta->'before'->>'state' IS DISTINCT FROM 'scheduled' OR journal.delta->'after'->>'state' IS DISTINCT FROM 'cancelled' OR journal.delta->'before'->>'version' IS DISTINCT FROM original->>'expectedJobVersion' OR journal.delta->'after'->>'version' IS DISTINCT FROM r->>'version' OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR predecessor.id IS NULL OR a.replaces_id IS DISTINCT FROM predecessor.id OR a.sequence<>predecessor.sequence+1 OR a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL OR a.reason IS DISTINCT FROM original->'payload'->>'reason' OR event.reason IS DISTINCT FROM a.reason OR event.from_state<>'scheduled' OR event.to_state<>'cancelled'
  OR crest_private.valid_booking_communication(original->'payload'->'customerCommunication',event.created_at) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid AND state='cancelled' AND version=(r->>'version')::bigint AND current_appointment_id=a.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedJobVersion',original->>'expectedJobVersion','payload',original->'payload')::text,'UTF8')),'hex');IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 counted:=0; FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  counted:=counted+1;table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN IF source_audit.id<>journal.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   IF source_audit.entity_version<>2 OR source_audit.action<>'release' OR source_audit.delta->'after' IS DISTINCT FROM 'null'::jsonb OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM r->>'jobId' OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM prior_appointment::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;CONTINUE;
  ELSIF table_name IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
   IF source_audit.action<>'create' OR source_audit.entity_version<>1 OR source_audit.delta->'before' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.delta->>'schemaVersion'<>'1' OR source_audit.delta->'after' IS DISTINCT FROM stored THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.valid_booking_communication(jsonb,timestamptz) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.cancelled_job_operation_result(uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.valid_booking_communication(jsonb,timestamptz),crest_private.cancelled_job_operation_result(uuid,uuid,uuid) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.cancel_scheduled_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $cancel$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;before_job crest.jobs;j crest.jobs;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;reservation crest.schedule_reservations;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;part crest.allocation_plan_parts;prior_part crest.allocation_plan_parts;event crest.job_events;family uuid;source uuid;reason text;source_audits jsonb:='[]'::jsonb;job_audit uuid;original jsonb;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['reason','customerCommunication']<>'{}'::jsonb OR NOT body ?& ARRAY['reason','customerCommunication'] OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.valid_booking_communication(body->'customerCommunication',clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.cancel',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.cancel' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF before_job.id IS NULL THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN reason:='version';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   IF before_job.state<>'scheduled' OR before_job.first_work_at IS NOT NULL THEN reason:='state';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=before_job.id;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=before_job.id ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR latest.id IS NULL OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
   INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(requested_business,before_job.id,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=before_job.id RETURNING * INTO reservation;
   IF reservation.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL));
   UPDATE crest.jobs SET state='cancelled',current_appointment_id=a.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=before_job.id RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));source_audits:=source_audits||jsonb_build_array(job_audit);
   FOR source IN SELECT DISTINCT source_allocation_id FROM crest.current_scope_allocation_parts WHERE business_id=requested_business AND job_id=j.id ORDER BY source_allocation_id LOOP
    SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source ORDER BY sequence DESC LIMIT 1;
    IF previous.id IS NULL OR previous.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id) VALUES(requested_business,source,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation) RETURNING * INTO p;
    source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id)
     VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=j.id THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;
     source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   original:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,'scheduled','cancelled',j.updated_at,body->>'reason',jsonb_build_object('request',original,'historyPredecessorId',latest.id),expected_actor,requested_operation) RETURNING * INTO event;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',source_audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1602' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $cancel$;
CREATE FUNCTION crest_commands.lookup_cancelled_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
DECLARE kind text;
BEGIN
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $guard$;
RESET ROLE;
