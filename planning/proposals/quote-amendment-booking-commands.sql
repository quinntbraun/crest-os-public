-- UNREGISTERED bound-version booking/cancellation after acceptance closure.
-- Version1 remains supported; version2 records explicit current entitlement
-- observations. No fee/refund/posting, route or owner upgrade is enabled.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.validate_booking_reservation()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='d45d9d3a640240d01da9f3beb749bed7c86a1e664376e36379af82764d6b38d5')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_fulfillment_mode_audit()') AND proowner='crest_mode_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='9b274eafa3f1550b11bd725a110a345b11c38d7ab4ea6dc33fbc6aba53667ba3')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='3e0dfb68312aa691b1b56a32233c9c0ae6ae83860af169a89c6e07aba50d8ef5')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='f5adbe387750c19c45731027f626be05c0e1e7dbb82ac273183e24ca25e5c707')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.authorize_booking_statement()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4bc28b0224d3ecf7671e9f34a0e2ecc894deafa03a49bbaf7ce6f63d6bf26028')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_booking_row()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='e6a901bb89cd46d0b2ce832288c34ebdf0c5ef76abdf9e29f6ea6c30748f07cb')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_row_audit()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='73165396c5497008eab3d3ba8237dcb3665bf6988f391a5faf47c24c742d4307')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_plan()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='ba15dc5cccba69d9ce701fe02f3c35484ad5fb386e2a2c60144c818a0b5a4216')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.booked_job_operation_result(uuid,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='9837f614ac8d0c0ec49a5d2a54d4823749af1ff98b6d469ea5ed6a7f3461dd28')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.cancelled_job_operation_result(uuid,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='5c14d9ce8713f25aaf35055ec8264c87cc79f4adf93790cac8346d48f3581aa6')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4ad7fd691b4657eb2d554633a4c71758a5dbda76195897b1e13fe508c8237866')
  OR(SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_mode_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_mode_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDED_BOOKING_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT INSERT(entitlement_version_id,authorization_state) ON crest.allocation_plan_versions TO crest_booking_owner;
CREATE POLICY amended_booking_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.cancel') AND schema_version=2 AND origin='manual' AND import_row_id IS NULL);
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.book_job(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_job uuid, expected_mode_sequence bigint, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;mode crest.fulfillment_mode_versions;customer crest.customers;vehicle crest.vehicles;association crest.customer_vehicles;control crest.operator_controls;j crest.jobs;a crest.appointments;jv crest.job_vehicles;encounter crest.job_encounters;p crest.allocation_plan_versions;part crest.allocation_plan_parts;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;reservation crest.schedule_reservations;event crest.job_events;source_row crest.scope_allocations;source_entitlement crest.scope_entitlements;bound_version crest.entitlement_versions;prior_plan crest.allocation_plan_versions;input_vehicle jsonb;input_plan jsonb;input_part jsonb;slot jsonb;review jsonb;family uuid;conflicting uuid;actual_conflicts uuid[];expected_conflicts uuid[];unknown_travel boolean;blocked tstzrange;current_sequence bigint;reason text;job_audit uuid;audit_ids jsonb:='[]'::jsonb;plan_ids jsonb:='[]'::jsonb;original jsonb;command_result jsonb;review_snapshot jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema=2 AND (SELECT encode(sha256(convert_to(string_agg(catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname,E'\n' ORDER BY (catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace catalog_n JOIN pg_class catalog_c ON catalog_c.relnamespace=catalog_n.oid JOIN pg_attribute catalog_a ON catalog_a.attrelid=catalog_c.oid WHERE catalog_n.nspname='crest' AND catalog_c.relkind IN('r','p') AND catalog_a.attnum>0 AND NOT catalog_a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDED_BOOKING_SCHEMA_REVIEW_REQUIRED';END IF;
 IF (request_schema IS NULL OR request_schema NOT IN(1,2)) OR requested_operation IS NULL OR requested_job IS NULL OR expected_mode_sequence IS NULL OR expected_mode_sequence<0 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>1048576 OR body-ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview']<>'{}'::jsonb OR NOT body ?& ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview'] OR NOT crest_private.booking_uuid(body->'customerId') OR NOT crest_private.booking_uuid(body->'operatorId') OR jsonb_typeof(body->'expectedCustomerVersion') IS DISTINCT FROM 'string' OR(body->>'expectedCustomerVersion')!~'^[1-9][0-9]{0,18}$' OR body->>'fulfillmentMode' NOT IN('mobile','dropoff','pickup_return') OR jsonb_typeof(body->'fulfillmentMode') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'vehicles') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'vehicles')=0 OR jsonb_typeof(body->'allocationPlans') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocationPlans')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
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
  IF jsonb_typeof(input_plan) IS DISTINCT FROM 'object' OR input_plan-(ARRAY['sourceAllocationId','expectedSequence','reason','parts']||(CASE WHEN request_schema=2 THEN ARRAY['entitlementVersionId'] ELSE ARRAY[]::text[] END))<>'{}'::jsonb OR NOT input_plan ?& (ARRAY['sourceAllocationId','expectedSequence','reason','parts']||(CASE WHEN request_schema=2 THEN ARRAY['entitlementVersionId'] ELSE ARRAY[]::text[] END)) OR request_schema=2 AND NOT crest_private.booking_uuid(input_plan->'entitlementVersionId') OR NOT crest_private.booking_uuid(input_plan->'sourceAllocationId') OR jsonb_typeof(input_plan->'expectedSequence') IS DISTINCT FROM 'string' OR(input_plan->>'expectedSequence')!~'^(0|[1-9][0-9]{0,18})$' OR(input_plan->>'expectedSequence')::numeric>=9223372036854775807 OR jsonb_typeof(input_plan->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(input_plan->'parts')=0 OR(input_plan->'reason'<>'null'::jsonb AND crest_private.booking_text_required(input_plan->'reason',1000) IS NOT TRUE) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
  FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
   IF jsonb_typeof(input_part) IS DISTINCT FROM 'object' OR input_part-ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription']<>'{}'::jsonb OR NOT input_part ?& ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'] OR NOT crest_private.booking_uuid(input_part->'partitionId') OR(input_part->'jobId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_part->'jobId')) OR jsonb_typeof(input_part->'state') IS DISTINCT FROM 'string' OR input_part->>'state' NOT IN('unassigned','assigned','completed','cancelled') OR crest_private.booking_text_required(input_part->'scopeDescription',2000) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
   FOREACH reason IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP IF jsonb_typeof(input_part->reason) IS DISTINCT FROM 'string' OR(input_part->>reason)!~'^(0|[1-9][0-9]{0,18})$' OR(input_part->>reason)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
  END LOOP;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'sourceAllocationId') FROM jsonb_array_elements(body->'allocationPlans'))<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',request_schema,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.book',request_schema,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
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
    SELECT * INTO bound_version FROM crest.entitlement_versions WHERE business_id=requested_business AND id=(CASE WHEN request_schema=2 THEN(input_plan->>'entitlementVersionId')::uuid ELSE source_row.entitlement_version_id END);
    SELECT * INTO prior_plan FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id ORDER BY sequence DESC LIMIT 1;
    IF source_row.id IS NULL OR bound_version.id IS NULL OR bound_version.entitlement_id IS DISTINCT FROM source_entitlement.id OR bound_version.family_id IS DISTINCT FROM source_entitlement.agreement_family_id
     OR request_schema=1 AND prior_plan.entitlement_version_id IS NOT NULL
     OR request_schema=2 AND(prior_plan.authorization_state='withdrawn' OR bound_version.id IS DISTINCT FROM coalesce(prior_plan.entitlement_version_id,source_row.entitlement_version_id))
     OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state active JOIN crest.agreements agreement ON agreement.business_id=active.business_id AND agreement.id=active.current_agreement_id WHERE active.business_id=requested_business AND active.family_id=source_entitlement.agreement_family_id AND active.current_agreement_id=bound_version.agreement_id AND agreement.customer_id=customer.id) THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF NOT EXISTS(SELECT 1 FROM crest.job_encounters WHERE business_id=requested_business AND job_id=j.id AND family_id=source_entitlement.agreement_family_id) THEN
     INSERT INTO crest.job_encounters(business_id,job_id,customer_id,family_id,agreement_id,encounter_id,created_by,operation_id) VALUES(requested_business,j.id,customer.id,source_entitlement.agreement_family_id,bound_version.agreement_id,source_entitlement.agreement_family_id,expected_actor,requested_operation) RETURNING * INTO encounter;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_encounters',encounter.id,1,'create',NULL,crest_private.job_encounters_projection(encounter)));
    END IF;
    SELECT coalesce(max(sequence),0) INTO current_sequence FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id;
    IF current_sequence::text<>input_plan->>'expectedSequence' THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,source_row.id,current_sequence+1,(SELECT id FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id AND sequence=current_sequence),input_plan->>'reason',expected_actor,requested_operation,CASE WHEN request_schema=2 THEN bound_version.id ELSE NULL END,CASE WHEN request_schema=2 THEN 'active' ELSE NULL END) RETURNING * INTO p;
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
   original:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,1,NULL,'scheduled',j.created_at,NULL,jsonb_build_object('request',original,'planIds',plan_ids,'confirmationDraft',crest_private.schedule_confirmation_draft(requested_business,j.id,a.id)),expected_actor,requested_operation) RETURNING * INTO event;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',audit_ids);
   UPDATE crest_private.operations SET state='committed',result_schema_version=request_schema,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1601' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.cancel_scheduled_job(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_job uuid, expected_job_version bigint, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;before_job crest.jobs;j crest.jobs;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;reservation crest.schedule_reservations;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;part crest.allocation_plan_parts;prior_part crest.allocation_plan_parts;event crest.job_events;family uuid;source uuid;reason text;observed jsonb;source_row crest.scope_allocations;bound_version crest.entitlement_versions;source_audits jsonb:='[]'::jsonb;job_audit uuid;original jsonb;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema=2 AND (SELECT encode(sha256(convert_to(string_agg(catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname,E'\n' ORDER BY (catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace catalog_n JOIN pg_class catalog_c ON catalog_c.relnamespace=catalog_n.oid JOIN pg_attribute catalog_a ON catalog_a.attrelid=catalog_c.oid WHERE catalog_n.nspname='crest' AND catalog_c.relkind IN('r','p') AND catalog_a.attnum>0 AND NOT catalog_a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDED_BOOKING_SCHEMA_REVIEW_REQUIRED';END IF;
 IF (request_schema IS NULL OR request_schema NOT IN(1,2)) OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-(ARRAY['reason','customerCommunication']||(CASE WHEN request_schema=2 THEN ARRAY['allocationPlans'] ELSE ARRAY[]::text[] END))<>'{}'::jsonb OR NOT body ?& (ARRAY['reason','customerCommunication']||(CASE WHEN request_schema=2 THEN ARRAY['allocationPlans'] ELSE ARRAY[]::text[] END)) OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.valid_booking_communication(body->'customerCommunication',clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 IF request_schema=2 THEN
  IF octet_length(body::text)>1048576 OR jsonb_typeof(body->'allocationPlans') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocationPlans')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
  FOR observed IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
   IF jsonb_typeof(observed) IS DISTINCT FROM 'object' OR NOT(observed?&ARRAY['sourceAllocationId','entitlementVersionId','expectedPlanId','expectedSequence']) OR observed-ARRAY['sourceAllocationId','entitlementVersionId','expectedPlanId','expectedSequence']<>'{}'::jsonb
    OR NOT crest_private.booking_uuid(observed->'sourceAllocationId') OR NOT crest_private.booking_uuid(observed->'entitlementVersionId') OR NOT crest_private.booking_uuid(observed->'expectedPlanId') OR jsonb_typeof(observed->'expectedSequence') IS DISTINCT FROM 'string' OR(observed->>'expectedSequence')!~'^[1-9][0-9]{0,18}$' OR(observed->>'expectedSequence')::numeric>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
  END LOOP;
  IF(SELECT count(DISTINCT value->>'sourceAllocationId') FROM jsonb_array_elements(body->'allocationPlans'))<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',request_schema,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.cancel',request_schema,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
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
   IF request_schema=1 AND EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current JOIN crest.allocation_plan_versions observed_plan ON observed_plan.business_id=current.business_id AND observed_plan.id=current.plan_id WHERE current.business_id=requested_business AND current.job_id=before_job.id AND observed_plan.entitlement_version_id IS NOT NULL) THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   IF request_schema=2 AND((SELECT count(DISTINCT source_allocation_id) FROM crest.current_scope_allocation_parts WHERE business_id=requested_business AND job_id=before_job.id)<>jsonb_array_length(body->'allocationPlans')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(body->'allocationPlans') v WHERE NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current WHERE current.business_id=requested_business AND current.job_id=before_job.id AND current.source_allocation_id=(v->>'sourceAllocationId')::uuid AND current.entitlement_version_id=(v->>'entitlementVersionId')::uuid AND current.plan_id=(v->>'expectedPlanId')::uuid AND current.plan_sequence::text=v->>'expectedSequence')))
   THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
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
    SELECT * INTO source_row FROM crest.scope_allocations WHERE business_id=requested_business AND id=source;
    SELECT * INTO bound_version FROM crest.entitlement_versions WHERE business_id=requested_business AND id=coalesce(previous.entitlement_version_id,source_row.entitlement_version_id);
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,source,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation,CASE WHEN request_schema=2 THEN bound_version.id ELSE NULL END,CASE WHEN request_schema=2 THEN 'active' ELSE NULL END) RETURNING * INTO p;
    source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id)
     VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=j.id THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;
     source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   original:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,'scheduled','cancelled',j.updated_at,body->>'reason',jsonb_build_object('request',original,'historyPredecessorId',latest.id),expected_actor,requested_operation) RETURNING * INTO event;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',source_audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=request_schema,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1602' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE kind text;
BEGIN
 IF current_user='crest_quote_owner' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') THEN
  SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND (schema_version=1 OR schema_version=2 AND command_type IN('operations.job.book','operations.job.cancel')) AND state='pending' AND origin='manual' AND import_row_id IS NULL;
  IF kind IS DISTINCT FROM 'quote.amendment.accept' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND (schema_version=1 OR schema_version=2 AND command_type IN('operations.job.book','operations.job.cancel')) AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations') OR kind='operations.job.reschedule' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_booking_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE stamp timestamptz:=clock_timestamp();actor uuid;operation uuid;kind text;
BEGIN
 actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 IF actor IS NULL OR operation IS NULL OR NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM operation OR NEW.origin<>'manual' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND (schema_version=1 OR schema_version=2 AND command_type IN('operations.job.book','operations.job.cancel')) AND origin='manual' AND import_row_id IS NULL;
 IF kind='quote.amendment.accept' AND NOT(TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF kind IS NULL OR kind NOT IN('operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ACTOR_REQUIRED';END IF;NEW.created_at:=stamp;
  IF TG_TABLE_NAME='jobs' THEN IF kind<>'operations.job.book' OR NEW.version<>1 OR NEW.updated_by<>actor OR NEW.state<>'scheduled' OR NEW.first_work_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.completion_outcome IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;NEW.updated_at:=stamp;END IF;
 ELSE
  IF TG_TABLE_NAME<>'jobs' OR ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.operator_actor_id,NEW.created_at,NEW.created_by,NEW.origin) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.operator_actor_id,OLD.created_at,OLD.created_by,OLD.origin) OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR OLD.state<>'scheduled' OR OLD.first_work_at IS NOT NULL OR ROW(NEW.first_work_at,NEW.completed_at,NEW.completion_outcome) IS DISTINCT FROM ROW(OLD.first_work_at,OLD.completed_at,OLD.completion_outcome) OR NOT(kind='operations.job.reschedule' AND NEW.state='scheduled' OR kind='operations.job.cancel' AND NEW.state='cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;
  NEW.updated_at:=stamp;
  IF kind='operations.job.cancel' AND ROW(NEW.fulfillment_mode,NEW.mode_version_id,NEW.work_address_id,NEW.work_location_snapshot) IS DISTINCT FROM ROW(OLD.fulfillment_mode,OLD.mode_version_id,OLD.work_address_id,OLD.work_location_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SOURCE_RETAINED';END IF;
 END IF;
 RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_row_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE b uuid;entity uuid;actor uuid;operation uuid;revision bigint;verb text;before_row jsonb:='null'::jsonb;after_row jsonb:='null'::jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME<>'schedule_reservations' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_HISTORY_RETAINED';END IF;
  b:=OLD.business_id;entity:=OLD.id;actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;revision:=2;verb:='release';
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;
 ELSE
  b:=NEW.business_id;entity:=NEW.id;operation:=NEW.operation_id;verb:=CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'revise' END;
  IF TG_TABLE_NAME='jobs' THEN actor:=NEW.updated_by;revision:=NEW.version;ELSE actor:=NEW.created_by;revision:=1;END IF;
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO after_row USING NEW;
  IF TG_OP='UPDATE' THEN EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=b AND operation_id=operation AND actor_id=actor AND command_type='quote.amendment.accept' AND schema_version=1) THEN verb:='accept';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=b AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=entity AND a.entity_version=revision AND a.action=verb AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row) AND a.origin='manual' AND a.import_row_id IS NULL AND o.state='committed' AND (o.schema_version=1 OR o.schema_version=2 AND o.command_type IN('operations.job.book','operations.job.cancel')) AND o.result_schema_version=o.schema_version AND o.origin='manual' AND o.import_row_id IS NULL AND (o.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') OR o.command_type='quote.amendment.accept' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) AND(TG_OP<>'DELETE' OR o.command_type IN('operations.job.reschedule','operations.job.cancel')))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_AUDIT_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE p crest.allocation_plan_versions;s crest.scope_allocations;e crest.scope_entitlements;kind text;bound_version crest.entitlement_versions;bound_gross numeric;bound_discount numeric;part_count bigint;gross numeric;discount numeric;amount numeric;
BEGIN
 IF TG_TABLE_NAME='allocation_plan_versions' THEN SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.id;
 ELSE SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.plan_id;END IF;
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=p.business_id AND id=s.entitlement_id;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=p.business_id AND operation_id=p.operation_id AND actor_id=p.created_by;
 SELECT count(*),coalesce(sum(gross_inclusive_cents::numeric),0),coalesce(sum(discount_inclusive_cents::numeric),0),coalesce(sum(amount_cents::numeric),0) INTO part_count,gross,discount,amount FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id;
 bound_gross:=s.gross_inclusive_cents;bound_discount:=s.discount_inclusive_cents;
 IF p.entitlement_version_id IS NOT NULL THEN SELECT * INTO bound_version FROM crest.entitlement_versions WHERE business_id=p.business_id AND id=p.entitlement_version_id;bound_gross:=(bound_version.scope_snapshot->>'grossCents')::numeric;bound_discount:=(bound_version.scope_snapshot->>'lineDiscountCents')::numeric+(bound_version.scope_snapshot->>'allocatedDiscountCents')::numeric;END IF;
 IF kind='quote.amendment.accept' THEN
  IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR p.entitlement_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM crest.entitlement_versions v JOIN crest.quote_family_commercial_state active ON active.business_id=v.business_id AND active.family_id=v.family_id AND active.current_agreement_id=v.agreement_id WHERE v.business_id=p.business_id AND v.id=p.entitlement_version_id AND v.entitlement_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_BINDING_REQUIRED';END IF;
  IF crest_private.amendment_accept_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR kind IS NULL OR kind NOT IN('operations.job.book','operations.job.cancel') OR part_count=0 OR bound_gross IS NULL OR bound_discount IS NULL OR gross<>bound_gross OR discount<>bound_discount OR amount<>coalesce(bound_version.authorized_cents,s.amount_cents)
  OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state c WHERE c.business_id=p.business_id AND c.family_id=e.agreement_family_id AND c.current_agreement_id=coalesce(bound_version.agreement_id,s.agreement_id))
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(a.operation_id<>p.operation_id OR a.created_by<>p.created_by))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_TOTAL_REQUIRED';END IF;
 IF kind='operations.job.book' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.allocation_state='assigned' AND j.operation_id=p.operation_id AND j.state='scheduled')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_NEW_SCOPE_REQUIRED';END IF;
 -- Cancellation changes state, not the previously explicit money or scope.
 IF kind='operations.job.cancel' AND(p.replaces_id IS NULL
  OR EXISTS(SELECT 1 FROM(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.replaces_id) prior_part FULL JOIN(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id) next ON next.stable_partition_id=prior_part.stable_partition_id
    WHERE prior_part.id IS NULL OR next.id IS NULL OR ROW(next.job_id,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
       OR next.allocation_state IS DISTINCT FROM prior_part.allocation_state AND NOT(prior_part.allocation_state='assigned' AND next.allocation_state='cancelled' AND EXISTS(SELECT 1 FROM crest.jobs j WHERE j.business_id=prior_part.business_id AND j.id=prior_part.job_id AND j.state='cancelled' AND j.operation_id=p.operation_id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SCOPE_RETAINED';END IF;
 -- Stable partition identity cannot migrate into another entitlement's source.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.allocation_plan_parts other ON other.business_id=a.business_id AND other.stable_partition_id=a.stable_partition_id JOIN crest.allocation_plan_versions previous ON previous.business_id=other.business_id AND previous.id=other.plan_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND previous.source_allocation_id<>p.source_allocation_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.scope_allocations original ON original.business_id=a.business_id AND original.stable_partition_id=a.stable_partition_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND original.id<>p.source_allocation_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PARTITION_IDENTITY_REQUIRED';END IF;
 -- A zero-dollar source/partition cannot disappear merely because the total
 -- remains zero. Preserve its original identity through explicit allocations.
 IF p.replaces_id IS NULL AND s.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=s.stable_partition_id)
  OR p.replaces_id IS NOT NULL AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=prior_part.stable_partition_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ZERO_IDENTITY_REQUIRED';END IF;
 -- Every assigned partition has the accepted customer's actual job and vehicle.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.agreements agreement ON agreement.business_id=s.business_id AND agreement.id=s.agreement_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(j.customer_id<>agreement.customer_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id AND v.vehicle_id=e.vehicle_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_BINDING_REQUIRED';END IF;
 -- Existing assigned work stays intact when booking another visit; completed
 -- scope and active physical work cannot be moved by any booking command.
 IF p.replaces_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts prior_part JOIN crest.jobs j ON j.business_id=prior_part.business_id AND j.id=prior_part.job_id
  LEFT JOIN crest.allocation_plan_parts next ON next.business_id=prior_part.business_id AND next.plan_id=p.id AND next.stable_partition_id=prior_part.stable_partition_id
  WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND(
   prior_part.allocation_state='completed' OR j.state IN('en_route','in_progress','paused') OR prior_part.allocation_state='assigned' AND j.state='scheduled' AND kind='operations.job.book'
  ) AND ROW(next.job_id,next.allocation_state,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ASSIGNED_SCOPE_RETAINED';END IF;
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a LEFT JOIN crest.allocation_plan_parts prior_part ON prior_part.business_id=a.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.stable_partition_id=a.stable_partition_id LEFT JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(
  a.allocation_state='completed' AND(prior_part.id IS NULL OR prior_part.allocation_state<>'completed' OR ROW(a.job_id,a.gross_inclusive_cents,a.discount_inclusive_cents,a.amount_cents,a.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description))
  OR a.allocation_state='assigned' AND(prior_part.id IS NULL OR prior_part.job_id IS DISTINCT FROM a.job_id OR prior_part.allocation_state IS DISTINCT FROM 'assigned') AND(kind<>'operations.job.book' OR j.operation_id<>p.operation_id OR j.state<>'scheduled')
  OR a.allocation_state='cancelled' AND(prior_part.id IS NULL OR prior_part.allocation_state IS DISTINCT FROM 'cancelled') AND(kind<>'operations.job.cancel' OR j.operation_id<>p.operation_id OR j.state<>'cancelled')
 )) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_STATE_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_private.booked_job_operation_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;original jsonb;body jsonb;mode crest.fulfillment_mode_versions;source_audit crest_private.audit_events;stored jsonb;table_name text;digest text;counted bigint;expected_count bigint;input_plan jsonb;written_plan crest.allocation_plan_versions;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.book';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR r->>'businessId' IS DISTINCT FROM business::text OR r->>'version' IS DISTINCT FROM '1' OR r->>'appointmentSequence' IS DISTINCT FROM '1' OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=1 AND action='create';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';body:=original->'payload';
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR original->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR journal.delta->'before' IS DISTINCT FROM 'null'::jsonb OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR journal.delta->'after'->>'customer_id' IS DISTINCT FROM body->>'customerId' OR journal.delta->'after'->>'operator_actor_id' IS DISTINCT FROM body->>'operatorId' OR journal.delta->'after'->>'fulfillment_mode' IS DISTINCT FROM body->>'fulfillmentMode' OR journal.delta->'after'->'work_location_snapshot' IS DISTINCT FROM body->'workLocation' OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',o.schema_version,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedModeSequence',original->>'expectedModeSequence','payload',body)::text,'UTF8')),'hex');
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
 IF o.schema_version=2 THEN
  IF(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor)<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
   SELECT * INTO written_plan FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor AND source_allocation_id=(input_plan->>'sourceAllocationId')::uuid;
   IF written_plan.id IS NULL OR written_plan.entitlement_version_id::text IS DISTINCT FROM input_plan->>'entitlementVersionId' OR written_plan.authorization_state IS DISTINCT FROM 'active' OR written_plan.sequence::numeric IS DISTINCT FROM(input_plan->>'expectedSequence')::numeric+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
   IF(SELECT jsonb_agg(jsonb_build_object('partitionId',stable_partition_id,'jobId',job_id,'state',allocation_state,'grossInclusiveCents',gross_inclusive_cents::text,'discountInclusiveCents',discount_inclusive_cents::text,'amountCents',amount_cents::text,'scopeDescription',scope_description) ORDER BY stable_partition_id) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=written_plan.id) IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY(value->>'partitionId')::uuid) FROM jsonb_array_elements(input_plan->'parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_private.cancelled_job_operation_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;predecessor crest.appointments;original jsonb;source_audit crest_private.audit_events;stored jsonb;table_name text;expected_count bigint;input_plan jsonb;written_plan crest.allocation_plan_versions;counted bigint;prior_appointment uuid;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.cancel';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR r->>'businessId' IS DISTINCT FROM business::text OR jsonb_typeof(r->'version') IS DISTINCT FROM 'string' OR(r->>'version')!~'^[1-9][0-9]{0,18}$' OR(r->>'version')::numeric>9223372036854775807 OR jsonb_typeof(r->'appointmentSequence') IS DISTINCT FROM 'string' OR(r->>'appointmentSequence')!~'^[1-9][0-9]{0,18}$' OR(r->>'appointmentSequence')::numeric>9223372036854775807 OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=(r->>'version')::bigint AND action='revise';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'version')::bigint AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'appointmentSequence')::bigint AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';prior_appointment:=(journal.delta->'before'->>'current_appointment_id')::uuid;
 SELECT * INTO predecessor FROM crest.appointments WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND id=(event.evidence->>'historyPredecessorId')::uuid;
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR(original->>'expectedJobVersion')::numeric+1 IS DISTINCT FROM(r->>'version')::numeric
  OR journal.delta->'before'->>'state' IS DISTINCT FROM 'scheduled' OR journal.delta->'after'->>'state' IS DISTINCT FROM 'cancelled' OR journal.delta->'before'->>'version' IS DISTINCT FROM original->>'expectedJobVersion' OR journal.delta->'after'->>'version' IS DISTINCT FROM r->>'version' OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR predecessor.id IS NULL OR a.replaces_id IS DISTINCT FROM predecessor.id OR a.sequence<>predecessor.sequence+1 OR a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL OR a.reason IS DISTINCT FROM original->'payload'->>'reason' OR event.reason IS DISTINCT FROM a.reason OR event.from_state<>'scheduled' OR event.to_state<>'cancelled'
  OR crest_private.valid_booking_communication(original->'payload'->'customerCommunication',event.created_at) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid AND state='cancelled' AND version=(r->>'version')::bigint AND current_appointment_id=a.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',o.schema_version,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedJobVersion',original->>'expectedJobVersion','payload',original->'payload')::text,'UTF8')),'hex');IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
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
 IF o.schema_version=2 THEN
  IF(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor)<>jsonb_array_length(original->'payload'->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  FOR input_plan IN SELECT value FROM jsonb_array_elements(original->'payload'->'allocationPlans') LOOP
   SELECT * INTO written_plan FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor AND source_allocation_id=(input_plan->>'sourceAllocationId')::uuid;
   IF written_plan.id IS NULL OR written_plan.entitlement_version_id::text IS DISTINCT FROM input_plan->>'entitlementVersionId' OR written_plan.authorization_state IS DISTINCT FROM 'active' OR written_plan.sequence::numeric IS DISTINCT FROM(input_plan->>'expectedSequence')::numeric+1 OR written_plan.replaces_id::text IS DISTINCT FROM input_plan->>'expectedPlanId' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;

  END LOOP;
 END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.operation_retirement_result(business uuid, actor uuid, original jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE o crest_private.operations;a record;decision jsonb;r jsonb;expected_delta jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=(original->'reference'->>'operationId')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF o.command_type<>'operation.retire' THEN
  IF o.command_type IS DISTINCT FROM original->>'commandType' OR NOT(o.schema_version=(CASE WHEN o.command_type='quote.amendment.create' THEN 3 ELSE 1 END) OR o.command_type IN('operations.job.book','operations.job.cancel') AND o.schema_version=2) OR o.state<>'committed' OR o.recovery_epoch::text IS DISTINCT FROM original->'reference'->>'recoveryEpoch' THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  -- Observation only. The caller must use the existing typed original lookup
  -- to validate receipt/source identity before clearing any pending reference.
  RETURN jsonb_build_object('schemaVersion',1,'state','original_recorded','original',original);
 END IF;
 decision:=o.result;r:=decision->'retirement';
 IF o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR jsonb_typeof(decision) IS DISTINCT FROM 'object' OR NOT(decision?&ARRAY['schemaVersion','state','original','retirement']) OR decision-ARRAY['schemaVersion','state','original','retirement']<>'{}'::jsonb OR decision->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR decision->>'state' IS DISTINCT FROM 'retired' OR decision->'original' IS DISTINCT FROM original OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']) OR r-ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']<>'{}'::jsonb OR r->>'operationRowId' IS DISTINCT FROM o.id::text OR r->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string' OR NOT crest_private.original_operation_uuid(r->'auditEventId') OR o.payload_hash IS DISTINCT FROM crest_private.operation_retirement_digest(actor,o.recovery_epoch,original,r->>'reason') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 expected_delta:=jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',o.id,'original',original,'recoveryEpoch',o.recovery_epoch,'reason',r->>'reason'));
 SELECT id,reason,recorded_at,delta,payload,hash_input,event_hash INTO a FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id AND entity_kind='operations' AND entity_id=o.id AND entity_version=1 AND action='retire';
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id)<>1 OR a.id::text IS DISTINCT FROM r->>'auditEventId' OR a.reason IS DISTINCT FROM r->>'reason' OR a.delta IS DISTINCT FROM expected_delta OR r->>'recordedAt' IS DISTINCT FROM to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') OR a.hash_input IS DISTINCT FROM a.payload::text OR a.event_hash IS DISTINCT FROM encode(sha256(convert_to(a.hash_input,'UTF8')),'hex') OR a.recorded_at<o.created_at OR a.recorded_at>o.committed_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 RETURN decision;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_mode_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_mode_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_fulfillment_mode_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE prior jsonb:='null'::jsonb;
BEGIN
 IF NEW.sequence>1 THEN SELECT crest_private.fulfillment_mode_projection(v) INTO prior FROM crest.fulfillment_mode_versions v WHERE business_id=NEW.business_id AND sequence=NEW.replaces_sequence;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='fulfillment_modes' AND a.entity_id=NEW.business_id AND a.entity_version=NEW.sequence AND a.action=CASE WHEN NEW.sequence=1 THEN 'initialize' ELSE 'revise' END AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',crest_private.fulfillment_mode_projection(NEW::crest.fulfillment_mode_versions)) AND o.state='committed' AND(o.schema_version=1 OR o.schema_version=2 AND o.command_type='operations.job.book') AND o.origin=NEW.origin AND o.import_row_id IS NULL AND(NEW.sequence=1 AND o.command_type IN('operations.fulfillment_modes.initialize','operations.job.book') OR NEW.sequence>1 AND o.command_type='operations.fulfillment_modes.save'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_mode_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.validate_booking_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE actor uuid;operation uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 IF TG_OP='DELETE' THEN
  actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
  IF NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=OLD.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND(schema_version=1 OR schema_version=2 AND command_type='operations.job.cancel') AND command_type IN('operations.job.reschedule','operations.job.cancel') AND origin='manual' AND import_row_id IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RELEASE_CONTEXT_REQUIRED';END IF;
  PERFORM crest_private.lock_booking_operator(OLD.business_id,OLD.operator_actor_id);RETURN OLD;
 END IF;
 PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
RESET ROLE;
