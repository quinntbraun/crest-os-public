-- Unregistered owner booking RPC. crm.manage is the existing nonfinancial
-- owner authority. No finance posting, provider action or runtime activation.
DO $review$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner') OR to_regprocedure('crest_private.check_booking_job_graph(uuid,uuid,uuid)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_SOURCE_REQUIRED';END IF;
 CREATE ROLE crest_booking_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_booking_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_booking_owner;
DO $grants$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'] LOOP
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);
  EXECUTE format('GRANT USAGE ON TYPE crest.%I TO crest_booking_owner',name);
  EXECUTE format('CREATE POLICY booking_command_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY booking_command_create ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid AND origin=''manual'')',name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION crest_private.%I_projection(crest.%I) TO crest_booking_owner',name,name);
 END LOOP;
END $grants$;
GRANT SELECT ON crest.current_scope_allocation_parts TO crest_booking_owner;
GRANT SELECT ON crest.customers,crest.vehicles,crest.addresses,crest.customer_vehicles,crest.memberships,crest.quote_families,crest.quote_family_commercial_state,crest.agreements,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions TO crest_booking_owner;
DO $read$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['customers','vehicles','addresses','customer_vehicles','memberships','quote_families','quote_family_commercial_state','agreements','scope_allocations','scope_entitlements','entitlement_versions'] LOOP
  EXECUTE format('CREATE POLICY booking_command_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
 END LOOP;
END $read$;
GRANT SELECT,INSERT ON crest.fulfillment_mode_versions TO crest_booking_owner;
GRANT USAGE ON TYPE crest.fulfillment_mode_versions TO crest_booking_owner;
CREATE POLICY booking_modes_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY booking_modes_initialize ON crest.fulfillment_mode_versions FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND sequence=1 AND origin='manual');
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_booking_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_booking_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_booking_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_booking_owner;
CREATE POLICY booking_command_operations_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel'));
CREATE POLICY booking_command_operations_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY booking_command_operations_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel'));
CREATE POLICY booking_command_audits_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events','fulfillment_modes'));
CREATE POLICY booking_command_audits_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL AND entity_kind IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events','fulfillment_modes'));
CREATE FUNCTION crest_private.booking_uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $uuid$
 SELECT coalesce(jsonb_typeof(v)='string' AND(v#>>'{}')~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$uuid$;
CREATE FUNCTION crest_private.append_booking_audit(kind text,entity uuid,revision bigint,verb text,before_row jsonb,after_row jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE result uuid;
BEGIN
 IF kind NOT IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events','fulfillment_modes') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_AUDIT_KIND_REQUIRED';END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(nullif(current_setting('crest.business_id',true),'')::uuid,nullif(current_setting('crest.operation_id',true),'')::uuid,nullif(current_setting('crest.actor_id',true),'')::uuid,nullif(current_setting('crest.actor_id',true),'')::uuid,kind,entity,revision,verb,jsonb_build_object('schemaVersion',1,'before',coalesce(before_row,'null'::jsonb),'after',coalesce(after_row,'null'::jsonb)),'manual') RETURNING id INTO result;RETURN result;
END $audit$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions),crest_private.customer_projection(crest.customers),crest_private.vehicle_projection(crest.vehicles),crest_private.address_projection(crest.addresses),crest_private.lock_booking_family(uuid,uuid),crest_private.lock_booking_operator(uuid,uuid),crest_private.booking_text_required(jsonb,integer),crest_private.valid_booking_contact(jsonb),crest_private.valid_booking_confirmation(jsonb,timestamptz),crest_private.valid_booking_location(jsonb,uuid,uuid,boolean) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.booking_uuid(jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.append_booking_audit(text,uuid,bigint,text,jsonb,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.booking_uuid(jsonb),crest_private.append_booking_audit(text,uuid,bigint,text,jsonb,jsonb) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
-- Shared locks protect source snapshots through commit without permitting this
-- private command role to edit the underlying CRM records.
GRANT UPDATE(id) ON crest.customers,crest.vehicles,crest.addresses,crest.customer_vehicles,crest.memberships TO crest_booking_owner;
CREATE POLICY booking_command_lock ON crest.customers FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.vehicles FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.addresses FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.customer_vehicles FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.memberships FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE FUNCTION crest_private.booked_job_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;original jsonb;body jsonb;mode crest.fulfillment_mode_versions;source_audit crest_private.audit_events;stored jsonb;table_name text;digest text;counted bigint;expected_count bigint;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.book';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text OR r->>'version' IS DISTINCT FROM '1' OR r->>'appointmentSequence' IS DISTINCT FROM '1' OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=1 AND action='create';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';body:=original->'payload';
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR original->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR journal.delta->'before' IS DISTINCT FROM 'null'::jsonb OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR journal.delta->'after'->>'customer_id' IS DISTINCT FROM body->>'customerId' OR journal.delta->'after'->>'operator_actor_id' IS DISTINCT FROM body->>'operatorId' OR journal.delta->'after'->>'fulfillment_mode' IS DISTINCT FROM body->>'fulfillmentMode' OR journal.delta->'after'->'work_location_snapshot' IS DISTINCT FROM body->'workLocation' OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedModeSequence',original->>'expectedModeSequence','payload',body)::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');
 SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds'));
 IF counted<>expected_count OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   -- Reservations are mutable projections; their immutable original is audited.
   stored:=source_audit.delta->'after';
   IF stored->>'job_id' IS DISTINCT FROM r->>'jobId' OR stored->>'appointment_id' IS DISTINCT FROM a.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  ELSIF table_name='fulfillment_modes' THEN
   SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=business AND id=(source_audit.delta->'after'->>'id')::uuid;
   stored:=crest_private.fulfillment_mode_projection(mode);
  ELSIF table_name IN('job_vehicles','job_encounters','appointments','operator_controls','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.action NOT IN('create','initialize') OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.booked_job_operation_result(uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.booked_job_operation_result(uuid,uuid,uuid) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.book_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_mode_sequence bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $book$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;mode crest.fulfillment_mode_versions;customer crest.customers;vehicle crest.vehicles;association crest.customer_vehicles;control crest.operator_controls;j crest.jobs;a crest.appointments;jv crest.job_vehicles;encounter crest.job_encounters;p crest.allocation_plan_versions;part crest.allocation_plan_parts;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;reservation crest.schedule_reservations;event crest.job_events;source_row crest.scope_allocations;source_entitlement crest.scope_entitlements;input_vehicle jsonb;input_plan jsonb;input_part jsonb;slot jsonb;review jsonb;family uuid;conflicting uuid;actual_conflicts uuid[];expected_conflicts uuid[];unknown_travel boolean;blocked tstzrange;current_sequence bigint;reason text;job_audit uuid;audit_ids jsonb:='[]'::jsonb;plan_ids jsonb:='[]'::jsonb;original jsonb;command_result jsonb;review_snapshot jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_mode_sequence IS NULL OR expected_mode_sequence<0 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>1048576 OR body-ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview']<>'{}'::jsonb OR NOT body ?& ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview'] OR NOT crest_private.booking_uuid(body->'customerId') OR NOT crest_private.booking_uuid(body->'operatorId') OR jsonb_typeof(body->'expectedCustomerVersion') IS DISTINCT FROM 'string' OR(body->>'expectedCustomerVersion')!~'^[1-9][0-9]{0,18}$' OR body->>'fulfillmentMode' NOT IN('mobile','dropoff','pickup_return') OR jsonb_typeof(body->'fulfillmentMode') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'vehicles') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'vehicles')=0 OR jsonb_typeof(body->'allocationPlans') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocationPlans')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 slot:=body->'appointment';review:=body->'conflictReview';
 IF jsonb_typeof(slot) IS DISTINCT FROM 'object' OR slot-ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed']<>'{}'::jsonb OR NOT slot ?& ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed'] OR jsonb_typeof(slot->'unknown_travel_reviewed') IS DISTINCT FROM 'boolean' OR crest_private.valid_booking_contact(slot->'contact_snapshot') IS NOT TRUE OR crest_private.valid_booking_confirmation(slot->'customer_confirmation',clock_timestamp()) IS NOT TRUE
  OR jsonb_typeof(review) IS DISTINCT FROM 'object' OR review-ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason']<>'{}'::jsonb OR NOT review ?& ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason'] OR jsonb_typeof(review->'expectedAppointmentIds') IS DISTINCT FROM 'array' OR jsonb_typeof(review->'expectedUnknownTravel') IS DISTINCT FROM 'boolean' OR(review->'overrideReason'<>'null'::jsonb AND crest_private.booking_text_required(review->'overrideReason',1000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(review->'expectedAppointmentIds') item WHERE NOT crest_private.booking_uuid(item)) OR(SELECT count(DISTINCT value) FROM jsonb_array_elements(review->'expectedAppointmentIds'))<>jsonb_array_length(review->'expectedAppointmentIds') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 FOREACH reason IN ARRAY ARRAY['travel_before_seconds','travel_after_seconds'] LOOP IF slot->reason<>'null'::jsonb AND(jsonb_typeof(slot->reason) IS DISTINCT FROM 'number' OR(slot->>reason)!~'^(0|[1-9][0-9]{0,9})$' OR(slot->>reason)::numeric>2147483647) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
 FOR input_vehicle IN SELECT value FROM jsonb_array_elements(body->'vehicles') LOOP
  IF jsonb_typeof(input_vehicle) IS DISTINCT FROM 'object' OR input_vehicle-ARRAY['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation']<>'{}'::jsonb OR NOT input_vehicle ?& ARRAY['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation'] OR NOT crest_private.booking_uuid(input_vehicle->'vehicleId') OR jsonb_typeof(input_vehicle->'expectedVersion') IS DISTINCT FROM 'string' OR(input_vehicle->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR(input_vehicle->'customerVehicleId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_vehicle->'customerVehicleId')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'vehicleId') FROM jsonb_array_elements(body->'vehicles'))<>jsonb_array_length(body->'vehicles') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
  IF jsonb_typeof(input_plan) IS DISTINCT FROM 'object' OR input_plan-ARRAY['sourceAllocationId','expectedSequence','reason','parts']<>'{}'::jsonb OR NOT input_plan ?& ARRAY['sourceAllocationId','expectedSequence','reason','parts'] OR NOT crest_private.booking_uuid(input_plan->'sourceAllocationId') OR jsonb_typeof(input_plan->'expectedSequence') IS DISTINCT FROM 'string' OR(input_plan->>'expectedSequence')!~'^(0|[1-9][0-9]{0,18})$' OR(input_plan->>'expectedSequence')::numeric>=9223372036854775807 OR jsonb_typeof(input_plan->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(input_plan->'parts')=0 OR(input_plan->'reason'<>'null'::jsonb AND crest_private.booking_text_required(input_plan->'reason',1000) IS NOT TRUE) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
  FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
   IF jsonb_typeof(input_part) IS DISTINCT FROM 'object' OR input_part-ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription']<>'{}'::jsonb OR NOT input_part ?& ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'] OR NOT crest_private.booking_uuid(input_part->'partitionId') OR(input_part->'jobId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_part->'jobId')) OR jsonb_typeof(input_part->'state') IS DISTINCT FROM 'string' OR input_part->>'state' NOT IN('unassigned','assigned','completed','cancelled') OR crest_private.booking_text_required(input_part->'scopeDescription',2000) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
   FOREACH reason IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP IF jsonb_typeof(input_part->reason) IS DISTINCT FROM 'string' OR(input_part->>reason)!~'^(0|[1-9][0-9]{0,18})$' OR(input_part->>reason)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
  END LOOP;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'sourceAllocationId') FROM jsonb_array_elements(body->'allocationPlans'))<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.book',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.book' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF mode.id IS NULL THEN
    IF expected_mode_sequence<>0 THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.fulfillment_mode_versions(business_id,sequence,replaces_sequence,mobile_enabled,dropoff_enabled,pickup_return_enabled,reason,created_by,operation_id) VALUES(requested_business,1,NULL,true,true,false,NULL,expected_actor,requested_operation) RETURNING * INTO mode;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('fulfillment_modes',requested_business,1,'initialize',NULL,crest_private.fulfillment_mode_projection(mode)));
   ELSIF mode.sequence<>expected_mode_sequence THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF NOT(CASE body->>'fulfillmentMode' WHEN 'mobile' THEN mode.mobile_enabled WHEN 'dropoff' THEN mode.dropoff_enabled WHEN 'pickup_return' THEN mode.pickup_return_enabled ELSE false END) THEN reason:='mode_disabled';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job) THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   SELECT * INTO customer FROM crest.customers WHERE business_id=requested_business AND id=(body->>'customerId')::uuid FOR SHARE;
   IF customer.id IS NULL OR customer.archived_at IS NOT NULL OR customer.version::text<>body->>'expectedCustomerVersion' THEN reason:='customer';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF crest_private.valid_booking_location(body->'workLocation',requested_business,customer.id,true) IS NOT TRUE THEN reason:='location';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   PERFORM 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=(body->>'operatorId')::uuid AND active FOR SHARE;
   IF NOT FOUND THEN reason:='operator';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   FOR family IN SELECT DISTINCT e.agreement_family_id FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.id IN(SELECT(value->>'sourceAllocationId')::uuid FROM jsonb_array_elements(body->'allocationPlans')) ORDER BY e.agreement_family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   INSERT INTO crest.operator_controls(business_id,operator_actor_id,created_by,operation_id) VALUES(requested_business,(body->>'operatorId')::uuid,expected_actor,requested_operation) ON CONFLICT(business_id,operator_actor_id) DO NOTHING RETURNING * INTO control;
   IF control.id IS NOT NULL THEN audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('operator_controls',control.id,1,'create',NULL,crest_private.operator_controls_projection(control)));END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,(body->>'operatorId')::uuid);
   INSERT INTO crest.jobs(id,business_id,customer_id,operator_actor_id,fulfillment_mode,mode_version_id,work_address_id,work_location_snapshot,state,current_appointment_id,created_by,updated_by,operation_id)
   VALUES(requested_job,requested_business,customer.id,(body->>'operatorId')::uuid,body->>'fulfillmentMode',mode.id,CASE WHEN body->'workLocation'->>'kind'='customer_address' THEN(body->'workLocation'->>'addressId')::uuid ELSE NULL END,body->'workLocation','scheduled',gen_random_uuid(),expected_actor,expected_actor,requested_operation) RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'create',NULL,crest_private.jobs_projection(j));audit_ids:=audit_ids||jsonb_build_array(job_audit);
   FOR input_vehicle IN SELECT value FROM jsonb_array_elements(body->'vehicles') ORDER BY value->>'vehicleId' LOOP
    SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=requested_business AND id=(input_vehicle->>'vehicleId')::uuid FOR SHARE;
    IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL OR vehicle.version::text<>input_vehicle->>'expectedVersion' THEN reason:='vehicle';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF input_vehicle->'customerVehicleId'<>'null'::jsonb THEN SELECT * INTO association FROM crest.customer_vehicles WHERE business_id=requested_business AND id=(input_vehicle->>'customerVehicleId')::uuid AND customer_id=customer.id AND vehicle_id=vehicle.id AND valid_to IS NULL FOR SHARE;IF association.id IS NULL THEN reason:='vehicle';RAISE EXCEPTION USING ERRCODE='P1601';END IF;END IF;
    INSERT INTO crest.job_vehicles(business_id,job_id,vehicle_id,customer_vehicle_id,vehicle_snapshot,customer_snapshot,pickup_address_id,return_address_id,pickup_location_snapshot,return_location_snapshot,created_by,operation_id)
    VALUES(requested_business,j.id,vehicle.id,(input_vehicle->>'customerVehicleId')::uuid,crest_private.vehicle_projection(vehicle),crest_private.customer_projection(customer),CASE WHEN input_vehicle->'pickupLocation'->>'kind'='customer_address' THEN(input_vehicle->'pickupLocation'->>'addressId')::uuid ELSE NULL END,CASE WHEN input_vehicle->'returnLocation'->>'kind'='customer_address' THEN(input_vehicle->'returnLocation'->>'addressId')::uuid ELSE NULL END,nullif(input_vehicle->'pickupLocation','null'::jsonb),nullif(input_vehicle->'returnLocation','null'::jsonb),expected_actor,requested_operation) RETURNING * INTO jv;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_vehicles',jv.id,1,'create',NULL,crest_private.job_vehicles_projection(jv)));
   END LOOP;
   FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
    SELECT * INTO source_row FROM crest.scope_allocations WHERE business_id=requested_business AND id=(input_plan->>'sourceAllocationId')::uuid;
    SELECT * INTO source_entitlement FROM crest.scope_entitlements WHERE business_id=requested_business AND id=source_row.entitlement_id;
    IF source_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state active JOIN crest.agreements agreement ON agreement.business_id=active.business_id AND agreement.id=active.current_agreement_id WHERE active.business_id=requested_business AND active.family_id=source_entitlement.agreement_family_id AND active.current_agreement_id=source_row.agreement_id AND agreement.customer_id=customer.id) THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF NOT EXISTS(SELECT 1 FROM crest.job_encounters WHERE business_id=requested_business AND job_id=j.id AND family_id=source_entitlement.agreement_family_id) THEN
     INSERT INTO crest.job_encounters(business_id,job_id,customer_id,family_id,agreement_id,encounter_id,created_by,operation_id) VALUES(requested_business,j.id,customer.id,source_entitlement.agreement_family_id,source_row.agreement_id,source_entitlement.agreement_family_id,expected_actor,requested_operation) RETURNING * INTO encounter;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_encounters',encounter.id,1,'create',NULL,crest_private.job_encounters_projection(encounter)));
    END IF;
    SELECT coalesce(max(sequence),0) INTO current_sequence FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id;
    IF current_sequence::text<>input_plan->>'expectedSequence' THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id) VALUES(requested_business,source_row.id,current_sequence+1,(SELECT id FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id AND sequence=current_sequence),input_plan->>'reason',expected_actor,requested_operation) RETURNING * INTO p;
    plan_ids:=plan_ids||jsonb_build_array(p.id);audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,(input_part->>'partitionId')::uuid,(input_part->>'jobId')::uuid,input_part->>'state',(input_part->>'grossInclusiveCents')::bigint,(input_part->>'discountInclusiveCents')::bigint,(input_part->>'amountCents')::bigint,input_part->>'scopeDescription',expected_actor,requested_operation) RETURNING * INTO part;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   INSERT INTO crest.appointments(id,business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(j.current_appointment_id,requested_business,j.id,1,NULL,(slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz,slot->>'timezone',(slot->>'local_start')::timestamp,(slot->>'local_end')::timestamp,(slot->>'start_offset_minutes')::integer,(slot->>'end_offset_minutes')::integer,(slot->>'travel_before_seconds')::integer,(slot->>'travel_after_seconds')::integer,'confirmed',slot->'customer_confirmation',slot->'contact_snapshot',(slot->>'unknown_travel_reviewed')::boolean,NULL,expected_actor,requested_operation) RETURNING * INTO a;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');
   review_snapshot:=crest_private.booking_slot_review(requested_business,j.operator_actor_id,j.id,blocked,a.travel_before_seconds,a.travel_after_seconds);
   SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO actual_conflicts FROM jsonb_array_elements(review_snapshot->'conflictingAppointmentIds');
   SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO expected_conflicts FROM jsonb_array_elements(review->'expectedAppointmentIds');
   unknown_travel:=(review_snapshot->>'unknownTravel')::boolean;
   IF actual_conflicts IS DISTINCT FROM expected_conflicts OR unknown_travel IS DISTINCT FROM(review->>'expectedUnknownTravel')::boolean OR unknown_travel AND NOT a.unknown_travel_reviewed THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF cardinality(actual_conflicts)>0 THEN
    IF review->'overrideReason'='null'::jsonb THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.schedule_overrides(business_id,job_id,appointment_id,reason,created_by,operation_id) VALUES(requested_business,j.id,a.id,review->>'overrideReason',expected_actor,requested_operation) RETURNING * INTO override_row;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_overrides',override_row.id,1,'create',NULL,crest_private.schedule_overrides_projection(override_row)));
    FOREACH conflicting IN ARRAY actual_conflicts LOOP INSERT INTO crest.schedule_override_conflicts(business_id,override_id,conflicting_appointment_id,created_by,operation_id) VALUES(requested_business,override_row.id,conflicting,expected_actor,requested_operation) RETURNING * INTO conflict_row;audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_override_conflicts',conflict_row.id,1,'create',NULL,crest_private.schedule_override_conflicts_projection(conflict_row)));END LOOP;
   END IF;
   INSERT INTO crest.schedule_reservations(business_id,job_id,appointment_id,operator_actor_id,blocked_interval,unknown_travel,override_id,created_by,operation_id) VALUES(requested_business,j.id,a.id,j.operator_actor_id,blocked,unknown_travel,override_row.id,expected_actor,requested_operation) RETURNING * INTO reservation;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,1,'create',NULL,crest_private.schedule_reservations_projection(reservation)));
   original:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,1,NULL,'scheduled',j.created_at,NULL,jsonb_build_object('request',original,'planIds',plan_ids,'confirmationDraft',crest_private.schedule_confirmation_draft(requested_business,j.id,a.id)),expected_actor,requested_operation) RETURNING * INTO event;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',audit_ids);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1601' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $book$;
CREATE FUNCTION crest_commands.lookup_booked_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
