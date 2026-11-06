-- Unregistered BR07: cancel started/paused Mobile work only with an explicit
-- no-fulfilled-scope declaration. Retain actual time, travel and obligations.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.interrupted_job_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_private.unfulfilled_job_result(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'0ce826b3fac30d86c6078c6820cba09b01a0a21c3c632e8de554eb404ac0c90c'),
   ('crest_private.check_amendment_allocation_binding()','crest_booking_integrity_owner',true,'0a7bb6f68ea49031cd2c07ef9e4eec0e41b711d450e91f5fd048017123b37da5'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'73359dddca4a7d105fcc42a20cbd523c00ce8ad2a3d387829acded0e24043b08'),
   ('crest_private.check_booking_job_source()','crest_booking_integrity_owner',true,'5ff80ed99a520c9f51bbcb2744f25feaa2770d28b0195a292c0cb94a442abe7c'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'70075416bafc6cf7979e149ddbad4c46c237a7fcc7b17cca9b53bb5bac2b8d13'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'3d7cf6e5d177f420cd4175ee5f1514d903d01f7e9cb3419a7c6284f18b918014'),
   ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'497421bbf9a44e4431163cb24e47d8923bdb67b740b2b253eb75b566d7c3d9a1'),
   ('crest_private.check_completion_source_audit()','crest_booking_integrity_owner',true,'81795ef2364f1b3378b20bbc5247ecca85991c9ea26d6d12740d4769a339c88c'),
   ('crest_private.check_quote_amendment_accept_operation()','crest_booking_integrity_owner',true,'ee433c24dcdbcb296a0e45c50a0e6df39907b2065693681e8e58b5d3a42bf295'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'f19524e6caee787c38db422232dc15f58aa32d87a6fcf8d5244b784326c2d951'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'72ea5eb9a84b01f74f4f5851b2d74e9d99d9cde606fbf9a045d9c34977638259'),
   ('crest_private.stamp_completion_source()','crest_booking_integrity_owner',true,'08dd3f66588aa784e811a54a4c3d96df180e5c225174b1fc1b880c07ff489274'),
   ('crest_private.validate_booking_reservation()','crest_booking_integrity_owner',true,'03905cce01181e150deb7238483b42884c11446ea2c5c810d9d6141d7b41605c')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNFULFILLED_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY unfulfilled_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled');
CREATE POLICY unfulfilled_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY unfulfilled_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled' AND schema_version=1);
CREATE POLICY unfulfilled_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.job.cancel_unfulfilled' AND schema_version=1);
CREATE FUNCTION crest_private.valid_unfulfilled_cancel_body(body jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE entry jsonb;previous text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['reason','noFulfilledScopeConfirmed','expectedWorkIntervalId','expectedOpenTravelLegVersionIds','customerCommunication','scope']<>'{}'::jsonb OR NOT body ?& ARRAY['reason','noFulfilledScopeConfirmed','expectedWorkIntervalId','expectedOpenTravelLegVersionIds','customerCommunication','scope'] OR octet_length(body::text)>1048576 OR body->'noFulfilledScopeConfirmed' IS DISTINCT FROM 'true'::jsonb
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.booking_uuid(body->'expectedWorkIntervalId') IS NOT TRUE OR crest_private.valid_booking_communication(body->'customerCommunication',recorded) IS NOT TRUE OR jsonb_typeof(body->'expectedOpenTravelLegVersionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'expectedOpenTravelLegVersionIds')>1 OR jsonb_typeof(body->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'scope') NOT BETWEEN 1 AND 1000 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'expectedOpenTravelLegVersionIds') value WHERE crest_private.booking_uuid(value) IS NOT TRUE) THEN RETURN false;END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId']<>'{}'::jsonb OR NOT entry ?& ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId'] OR crest_private.booking_uuid(entry->'sourceAllocationId') IS NOT TRUE OR crest_private.booking_uuid(entry->'expectedPlanId') IS NOT TRUE OR crest_private.booking_uuid(entry->'entitlementVersionId') IS NOT TRUE OR jsonb_typeof(entry->'expectedSequence') IS DISTINCT FROM 'string' OR(entry->>'expectedSequence')!~'^[1-9][0-9]{0,18}$' OR(entry->>'expectedSequence')::numeric>=9223372036854775807 OR previous IS NOT NULL AND previous>=entry->>'sourceAllocationId' THEN RETURN false;END IF;previous:=entry->>'sourceAllocationId';
 END LOOP;RETURN true;
END $valid$;
REVOKE ALL ON FUNCTION crest_private.valid_unfulfilled_cancel_body(jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_unfulfilled_cancel_body(jsonb,timestamptz) TO crest_booking_owner,crest_booking_integrity_owner;

CREATE FUNCTION crest_commands.cancel_unfulfilled_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;j crest.jobs;before_job crest.jobs;old_work crest.work_intervals;closed_work crest.work_intervals;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;reservation crest.schedule_reservations;observed jsonb;previous crest.allocation_plan_versions;p crest.allocation_plan_versions;prior_part crest.allocation_plan_parts;part crest.allocation_plan_parts;outcome crest.work_scope_outcomes;event crest.job_events;family uuid;travel_ids jsonb;audits jsonb;receipt jsonb;result jsonb;stamp timestamptz;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR crest_private.valid_unfulfilled_cancel_body(body,clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNFULFILLED_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.cancel_unfulfilled','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.cancel_unfulfilled',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.cancel_unfulfilled' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.unfulfilled_job_result(requested_business,expected_actor,requested_operation);
  ELSE
   IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||at.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||at.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute at ON at.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND at.attnum>0 AND NOT at.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNFULFILLED_SCHEMA_REVIEW_REQUIRED';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;IF before_job.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='version';END IF;
   IF before_job.state NOT IN('in_progress','paused') OR before_job.fulfillment_mode<>'mobile' OR before_job.first_work_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='state';END IF;
   IF EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=requested_business AND job_id=requested_job) OR crest_private.interruption_scope_valid(requested_business,requested_job,body->'scope',true) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='scope';END IF;
   SELECT * INTO old_work FROM crest.current_work_intervals WHERE business_id=requested_business AND job_id=requested_job AND ended_at IS NULL;
   IF old_work.id IS NULL OR old_work.id::text IS DISTINCT FROM body->>'expectedWorkIntervalId' OR old_work.kind IS DISTINCT FROM(CASE before_job.state WHEN 'paused' THEN 'pause' ELSE 'active' END) THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='work';END IF;
   SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO travel_ids FROM crest.current_travel_legs WHERE business_id=requested_business AND operator_actor_id=before_job.operator_actor_id AND state='open';
   IF travel_ids IS DISTINCT FROM body->'expectedOpenTravelLegVersionIds' THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='travel';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=requested_job;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=requested_job ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR old_appointment.confirmation_state<>'confirmed' OR latest.id IS NULL OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_APPOINTMENT_REQUIRED';END IF;
   stamp:=clock_timestamp();
   INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,started_at,ended_at,pause_reason,change_kind,reason,created_by,operation_id) VALUES(requested_business,old_work.logical_id,old_work.sequence+1,old_work.id,requested_job,old_work.operator_actor_id,old_work.kind,old_work.started_at,stamp,old_work.pause_reason,'close',body->>'reason',expected_actor,requested_operation) RETURNING * INTO closed_work;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',closed_work.logical_id,closed_work.sequence,'close',closed_work.reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(old_work),'after',crest_private.field_work_projection(closed_work)),'manual');
   INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id) VALUES(requested_business,requested_job,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;PERFORM crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=requested_job RETURNING * INTO reservation;
   IF reservation.id IS NULL OR reservation.appointment_id<>old_appointment.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SLOT_REQUIRED';END IF;PERFORM crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL);
   FOR observed IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
    SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND id=(observed->>'expectedPlanId')::uuid;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,previous.source_allocation_id,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation,previous.entitlement_version_id,previous.authorization_state) RETURNING * INTO p;PERFORM crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p));
    FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=requested_job THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;PERFORM crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part));
     IF prior_part.job_id=requested_job THEN INSERT INTO crest.work_scope_outcomes(business_id,job_id,assigned_part_id,completion_part_id,partition_id,outcome,scope_description,completed_cents,reason,created_by,operation_id) VALUES(requested_business,requested_job,prior_part.id,part.id,part.stable_partition_id,'cancelled',part.scope_description,0,body->>'reason',expected_actor,requested_operation) RETURNING * INTO outcome;PERFORM crest_private.append_completion_audit('work_scope_outcomes',to_jsonb(outcome));END IF;
    END LOOP;
   END LOOP;
   UPDATE crest.jobs SET state='cancelled',current_appointment_id=a.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,before_job.state,'cancelled',j.updated_at,body->>'reason',jsonb_build_object('schemaVersion',1,'request',request,'closedWorkIntervalId',closed_work.id,'historyPredecessorId',latest.id,'unresolvedTravelLegVersionIds',travel_ids),expected_actor,requested_operation) RETURNING * INTO event;PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.cancel_unfulfilled','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'state','cancelled','appointmentId',a.id,'appointmentSequence',a.sequence::text,'closedWorkIntervalId',closed_work.id,'effectiveAt',to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'unresolvedTravelLegVersionIds',travel_ids,'outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=requested_business AND operation_id=requested_operation),'sourceAuditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;PERFORM crest_private.check_unfulfilled_job_graph(requested_business,requested_job,requested_operation);result:=crest_private.unfulfilled_job_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1931' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $command$;

CREATE FUNCTION crest_private.unfulfilled_job_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;w crest.work_intervals;old_work crest.work_intervals;a crest.appointments;old_appointment crest.appointments;latest crest.appointments;before_job jsonb;after_job jsonb;request jsonb;body jsonb;audits jsonb;receipt jsonb;source_audit record;stored jsonb;observed jsonb;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;prior_part crest.allocation_plan_parts;part crest.allocation_plan_parts;outcome crest.work_scope_outcomes;expected_parts jsonb;actual_parts jsonb;outcome_count bigint:=0;travel_id uuid;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.cancel_unfulfilled';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 request:=e.evidence->'request';body:=request->'body';
 SELECT * INTO w FROM crest.work_intervals WHERE business_id=business AND id=(e.evidence->>'closedWorkIntervalId')::uuid AND operation_id=operation AND created_by=actor;SELECT * INTO old_work FROM crest.work_intervals WHERE business_id=business AND id=w.replaces_id;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(after_job->>'current_appointment_id')::uuid AND operation_id=operation AND created_by=actor;SELECT * INTO latest FROM crest.appointments WHERE business_id=business AND id=a.replaces_id;SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=business AND id=(before_job->>'current_appointment_id')::uuid AND job_id=e.job_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.cancel_unfulfilled','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'state','cancelled','appointmentId',a.id,'appointmentSequence',a.sequence::text,'closedWorkIntervalId',w.id,'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'unresolvedTravelLegVersionIds',body->'expectedOpenTravelLegVersionIds','outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation),'sourceAuditIds',audits);
 IF e.id IS NULL OR w.id IS NULL OR old_work.id IS NULL OR a.id IS NULL OR latest.id IS NULL OR old_appointment.id IS NULL OR before_job IS NULL OR after_job IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM receipt OR crest_private.valid_unfulfilled_cancel_body(body,e.created_at) IS NOT TRUE
  OR e.evidence-ARRAY['schemaVersion','request','closedWorkIntervalId','historyPredecessorId','unresolvedTravelLegVersionIds']<>'{}'::jsonb OR NOT e.evidence ?& ARRAY['schemaVersion','request','closedWorkIntervalId','historyPredecessorId','unresolvedTravelLegVersionIds'] OR e.evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR e.evidence->'unresolvedTravelLegVersionIds' IS DISTINCT FROM body->'expectedOpenTravelLegVersionIds'
  OR request IS DISTINCT FROM jsonb_build_object('commandType','operations.job.cancel_unfulfilled','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'expectedJobVersion',(e.sequence-1)::text,'body',body) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR e.from_state NOT IN('in_progress','paused') OR e.from_state IS DISTINCT FROM before_job->>'state' OR e.to_state<>'cancelled' OR after_job->>'state'<>'cancelled' OR before_job->>'fulfillment_mode'<>'mobile' OR after_job->>'fulfillment_mode'<>'mobile' OR before_job->>'first_work_at' IS NULL OR after_job->>'first_work_at' IS DISTINCT FROM before_job->>'first_work_at'
  OR after_job->'completed_at'<>'null'::jsonb OR after_job->'completion_outcome'<>'null'::jsonb OR(before_job->>'version')::bigint+1<>e.sequence OR after_job->>'version' IS DISTINCT FROM e.sequence::text OR after_job->>'updated_by' IS DISTINCT FROM actor::text OR after_job->>'operation_id' IS DISTINCT FROM operation::text
  OR before_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id'] IS DISTINCT FROM after_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id']
  OR e.reason IS DISTINCT FROM body->>'reason' OR w.reason IS DISTINCT FROM e.reason OR a.reason IS DISTINCT FROM e.reason OR e.effective_at IS DISTINCT FROM w.ended_at OR(after_job->>'updated_at')::timestamptz IS DISTINCT FROM w.ended_at OR e.effective_at>e.created_at OR w.ended_at<(before_job->>'first_work_at')::timestamptz
  OR old_work.id::text IS DISTINCT FROM body->>'expectedWorkIntervalId' OR old_work.ended_at IS NOT NULL OR w.change_kind<>'close' OR w.sequence<>old_work.sequence+1 OR w.job_id<>e.job_id OR w.operator_actor_id::text IS DISTINCT FROM before_job->>'operator_actor_id' OR w.kind IS DISTINCT FROM(CASE e.from_state WHEN 'paused' THEN 'pause' ELSE 'active' END)
  OR ROW(w.logical_id,w.job_id,w.operator_actor_id,w.kind,w.started_at,w.pause_reason) IS DISTINCT FROM ROW(old_work.logical_id,old_work.job_id,old_work.operator_actor_id,old_work.kind,old_work.started_at,old_work.pause_reason)
  OR a.job_id<>e.job_id OR a.sequence<>latest.sequence+1 OR e.evidence->>'historyPredecessorId' IS DISTINCT FROM latest.id::text OR old_appointment.confirmation_state<>'confirmed' OR a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL
  OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,old_appointment.contact_snapshot)
  OR(SELECT count(*) FROM crest.job_events WHERE business_id=business AND operation_id=operation)<>1 OR(SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)<>1 OR(SELECT count(*) FROM crest.appointments WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)
  OR crest_private.interruption_scope_valid(business,e.job_id,body->'scope',false) IS NOT TRUE OR(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(body->'scope')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_RESULT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='jobs' AND prior.entity_id=e.job_id AND prior.entity_version=e.sequence-1 AND prior.delta->'after'=before_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_HISTORY_REQUIRED';END IF;
 FOR travel_id IN SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(body->'expectedOpenTravelLegVersionIds') LOOP
  IF NOT EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND id=travel_id AND operator_actor_id=w.operator_actor_id AND state='open' AND departed_at<=e.effective_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_TRAVEL_REQUIRED';END IF;
 END LOOP;
 FOR observed IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
  SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=business AND id=(observed->>'expectedPlanId')::uuid;SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND source_allocation_id=previous.source_allocation_id;
  IF p.id IS NULL OR p.replaces_id<>previous.id OR p.sequence<>previous.sequence+1 OR p.entitlement_version_id IS DISTINCT FROM previous.entitlement_version_id OR p.authorization_state IS DISTINCT FROM previous.authorization_state THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SCOPE_REQUIRED';END IF;
  SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',CASE WHEN job_id=e.job_id THEN 'cancelled' ELSE allocation_state END,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO expected_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=previous.id;
  SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',allocation_state,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO actual_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id;
  IF actual_parts IS DISTINCT FROM expected_parts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SCOPE_REQUIRED';END IF;PERFORM crest_private.check_completed_scope_floor(business,p.source_allocation_id,p.id);
  FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=previous.id AND job_id=e.job_id LOOP
   outcome_count:=outcome_count+1;SELECT * INTO part FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id AND stable_partition_id=prior_part.stable_partition_id;
   SELECT * INTO outcome FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation AND assigned_part_id=prior_part.id;
   IF part.id IS NULL OR outcome.id IS NULL OR outcome.job_id<>e.job_id OR outcome.completion_part_id<>part.id OR outcome.partition_id<>part.stable_partition_id OR outcome.outcome<>'cancelled' OR outcome.completed_cents<>0 OR outcome.scope_description IS DISTINCT FROM part.scope_description OR outcome.reason IS DISTINCT FROM body->>'reason' OR outcome.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_OUTCOMES_REQUIRED';END IF;
  END LOOP;
 END LOOP;
 IF outcome_count=0 OR(SELECT count(*) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation)<>outcome_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_OUTCOMES_REQUIRED';END IF;
 FOR source_audit IN SELECT id,entity_kind,entity_id,entity_version,action,reason,delta,origin,import_row_id,created_by FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor LOOP
  stored:=NULL;IF source_audit.origin<>'manual' OR source_audit.import_row_id IS NOT NULL OR source_audit.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
  IF source_audit.entity_kind='jobs' THEN IF source_audit.entity_id<>e.job_id OR source_audit.entity_version<>e.sequence OR source_audit.action<>'revise' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_job,'after',after_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='work_intervals' THEN IF source_audit.entity_id<>w.logical_id OR source_audit.entity_version<>w.sequence OR source_audit.action<>'close' OR source_audit.reason IS DISTINCT FROM w.reason OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(old_work),'after',crest_private.field_work_projection(w)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='schedule_reservations' THEN
   IF source_audit.action<>'release' OR source_audit.entity_version<>2 OR source_audit.delta->'after'<>'null'::jsonb OR source_audit.delta->'before'->>'id' IS DISTINCT FROM source_audit.entity_id::text OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM e.job_id::text OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM old_appointment.id::text OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='schedule_reservations' AND prior.entity_id=source_audit.entity_id AND prior.action='create' AND prior.delta->'after'=source_audit.delta->'before') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SLOT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='work_scope_outcomes' THEN
   SELECT crest_private.completion_projection('work_scope_outcomes',to_jsonb(v)) INTO stored FROM crest.work_scope_outcomes v WHERE business_id=business AND id=source_audit.entity_id AND operation_id=operation AND created_by=actor;
   IF source_audit.reason IS DISTINCT FROM body->>'reason' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
  ELSIF source_audit.entity_kind IN('appointments','job_events','allocation_plan_versions','allocation_plan_parts') THEN EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',source_audit.entity_kind,source_audit.entity_kind) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.entity_version<>1 OR source_audit.action<>'create' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
 END LOOP;
 IF(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='schedule_reservations')<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
CREATE FUNCTION crest_private.check_unfulfilled_job_graph(business uuid,job uuid,operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;w crest.work_intervals;after_job jsonb;body jsonb;travel_ids jsonb;saved jsonb;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM operation OR e.operation_id IS DISTINCT FROM operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_GRAPH_REQUIRED';END IF;
 saved:=crest_private.unfulfilled_job_result(business,j.updated_by,operation);body:=e.evidence->'request'->'body';SELECT delta->'after' INTO after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 SELECT * INTO w FROM crest.work_intervals WHERE business_id=business AND id=(saved->'receipt'->>'closedWorkIntervalId')::uuid;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO travel_ids FROM crest.current_travel_legs WHERE business_id=business AND operator_actor_id=j.operator_actor_id AND state='open';
 IF saved->>'state' IS DISTINCT FROM 'committed' OR crest_private.jobs_projection(j) IS DISTINCT FROM after_job OR j.state<>'cancelled' OR j.first_work_at IS NULL OR j.completed_at IS NOT NULL OR j.completion_outcome IS NOT NULL OR travel_ids IS DISTINCT FROM body->'expectedOpenTravelLegVersionIds'
  OR NOT EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND id=w.id) OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND job_id=job AND ended_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state<>'cancelled')
  OR EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=business AND job_id=job AND(operation_id<>operation OR outcome<>'cancelled' OR completed_cents<>0))
  OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job)
  OR EXISTS(SELECT 1 FROM crest.review_requests WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.messages WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.message_events WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.message_templates WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.review_request_encounters WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation)
  OR EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_GRAPH_REQUIRED';END IF;
END $graph$;
CREATE FUNCTION crest_private.check_unfulfilled_job_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN IF NEW.command_type<>'operations.job.cancel_unfulfilled' THEN RETURN NULL;END IF;IF crest_private.unfulfilled_job_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_RESULT_REQUIRED';END IF;RETURN NULL;END $check$;
CREATE FUNCTION crest_commands.lookup_unfulfilled_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNFULFILLED_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.unfulfilled_job_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.unfulfilled_job_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_unfulfilled_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_unfulfilled_job_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.unfulfilled_job_result(uuid,uuid,uuid),crest_private.check_unfulfilled_job_graph(uuid,uuid,uuid),crest_private.check_unfulfilled_job_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.unfulfilled_job_result(uuid,uuid,uuid),crest_private.check_unfulfilled_job_graph(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_unfulfilled_job_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER unfulfilled_original AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_unfulfilled_job_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_unfulfilled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_unfulfilled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_unfulfilled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

DO $extend$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.interrupt''',
  'IF NOT coalesce(kind=''operations.job.cancel_unfulfilled'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''DELETE'' AND TG_TABLE_NAME=''schedule_reservations'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME IN(''appointments'',''job_events'',''allocation_plan_versions'',''allocation_plan_parts'')) OR kind=''operations.job.interrupt''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'''operations.job.complete'',''operations.job.interrupt'')','''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'IF kind=''operations.job.interrupt'' THEN',$branch$
 IF kind='operations.job.cancel_unfulfilled' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' THEN
   IF OLD.state NOT IN('in_progress','paused') OR OLD.fulfillment_mode<>'mobile' OR OLD.first_work_at IS NULL OR NEW.state<>'cancelled' OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor
    OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_GRAPH_REQUIRED';END IF;
   SELECT ended_at INTO stamp FROM crest.work_intervals WHERE business_id=NEW.business_id AND operation_id=operation AND job_id=NEW.id AND change_kind='close';
   IF stamp IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_TIME_REQUIRED';END IF;NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','allocation_plan_versions','allocation_plan_parts') AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SOURCE_REQUIRED';END IF;
 END IF;
 IF kind='operations.job.interrupt' THEN$branch$);
 IF updated=definition OR position('CREST_UNFULFILLED_TIME_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')','o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')','o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.interrupt'' THEN','IF kind=''operations.job.cancel_unfulfilled'' THEN PERFORM crest_private.check_unfulfilled_job_graph(business,job,source_operation);RETURN;END IF; IF kind=''operations.job.interrupt'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.interrupt'' THEN','IF kind=''operations.job.cancel_unfulfilled'' THEN PERFORM crest_private.check_unfulfilled_job_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF; IF kind=''operations.job.interrupt'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'',''operations.job.interrupt'')','kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'IF kind=''operations.job.interrupt'' THEN',$branch$
 IF kind='operations.job.cancel_unfulfilled' THEN
  SELECT job_id INTO completion_job FROM crest.job_events WHERE business_id=p.business_id AND operation_id=p.operation_id;
  IF completion_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SCOPE_REQUIRED';END IF;
  PERFORM crest_private.check_unfulfilled_job_graph(p.business_id,completion_job,p.operation_id);RETURN NULL;
 END IF;
 IF kind='operations.job.interrupt' THEN$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 updated:=replace(definition,'''operations.job.complete'',''operations.job.interrupt'')','''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'IF command=''operations.job.interrupt'' THEN',$branch$
 IF command='operations.job.cancel_unfulfilled' THEN
  IF TG_TABLE_NAME<>'work_intervals' OR NEW.change_kind<>'close' OR NEW.reason IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNFULFILLED_TIME_REQUIRED';END IF;
  PERFORM 1 FROM crest.jobs WHERE business_id=NEW.business_id AND id=NEW.job_id AND operator_actor_id=NEW.operator_actor_id AND state IN('in_progress','paused') AND fulfillment_mode='mobile' AND first_work_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_TIME_REQUIRED';END IF;
 END IF;
 IF command='operations.job.interrupt' THEN$branch$);
 IF updated=definition OR position('CREST_UNFULFILLED_TIME_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.validate_booking_reservation()'::regprocedure);
 updated:=replace(definition,'command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')','command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_amendment_allocation_binding()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.complete'',''operations.job.interrupt'')','o.command_type IN(''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_quote_amendment_accept_operation()'::regprocedure);
 updated:=replace(definition,'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'')','old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_completion_source()'::regprocedure);
 updated:=replace(definition,'AND command_type=''operations.job.complete'' AND schema_version=1','AND(command_type=''operations.job.complete'' OR command_type=''operations.job.cancel_unfulfilled'' AND TG_TABLE_NAME=''work_scope_outcomes'') AND schema_version=1');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_completion_source_audit()'::regprocedure);
 updated:=replace(definition,'AND o.command_type=''operations.job.complete'' AND o.schema_version=1','AND(o.command_type=''operations.job.complete'' OR o.command_type=''operations.job.cancel_unfulfilled'' AND TG_TABLE_NAME=''work_scope_outcomes'') AND o.schema_version=1');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;
RESET ROLE;
