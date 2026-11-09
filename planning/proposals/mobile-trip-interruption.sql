-- Unregistered BR06/BR07/BR09 construction. One atomic en-route interruption:
-- retain the actual stopped trip and either cancel or confirm a replacement.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.mileage_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_private.interrupted_job_result(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'883b4149d624796464f80dcf03d20dd5ec94aee462571da962d2e3f3ead63ae6'),
   ('crest_private.check_amendment_allocation_binding()','crest_booking_integrity_owner',true,'5c5a9119e072ab8faa2d4092d5627ccae6df8568c0738565e6a2881c83a72a15'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'9cfdbe04d5fc296c66719f7587cdca86c9910685c680424257da1e1b597bf349'),
   ('crest_private.check_booking_job_source()','crest_booking_integrity_owner',true,'5ff80ed99a520c9f51bbcb2744f25feaa2770d28b0195a292c0cb94a442abe7c'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'61d69370164ba5c83806b2b8f471b68797070e150f70e6b63ae25a7f9af0fa64'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'e50a92eb0e0713c9ffcc0387d3d5b18384dfc17f62106b139fef6eb3d9cb6f7e'),
   ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'760e50cbfd114af1018fdd1f8af8a2c2960abeeb39703afa7204f2c421a440d2'),
   ('crest_private.check_quote_amendment_accept_operation()','crest_booking_integrity_owner',true,'04e500297f016bee15406831c107655b4760c458b5915305ad7bc846aed3d06b'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'a3e53b0bb2d7ee91fb93a4c0f957962bda50176f1acd852b8132a979705b8b2a'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'73b3f0d38cfb65245ec8b2382025cd4948cb3e91b7e8903e16f77e725bddad04'),
   ('crest_private.validate_booking_reservation()','crest_booking_integrity_owner',true,'95556ce1f71ced7a22d3192ea524258eb43afcce4b8cf63f4c436e180b3fa27d')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INTERRUPTION_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY interruption_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.interrupt');
CREATE POLICY interruption_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.interrupt' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY interruption_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.interrupt') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.interrupt' AND schema_version=1);
CREATE POLICY interruption_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.job.interrupt' AND schema_version=1);
CREATE FUNCTION crest_private.valid_interrupt_body(body jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE trip jsonb;stop jsonb;slot jsonb;review jsonb;entry jsonb;key text;previous text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['action','reason','trip','expectedAppointmentId','expectedModeSequence','appointment','conflictReview','customerCommunication','scope']<>'{}'::jsonb OR NOT body ?& ARRAY['action','reason','trip','expectedAppointmentId','expectedModeSequence','appointment','conflictReview','customerCommunication','scope'] OR octet_length(body::text)>1048576 OR body->>'action' IS NULL OR body->>'action' NOT IN('cancel','reschedule') OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.booking_uuid(body->'expectedAppointmentId') IS NOT TRUE OR jsonb_typeof(body->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'scope') NOT BETWEEN 1 AND 1000 THEN RETURN false;END IF;
 trip:=body->'trip';stop:=trip->'actualStop';
 IF jsonb_typeof(trip) IS DISTINCT FROM 'object' OR trip-ARRAY['legId','expectedLegVersionId','actualStop']<>'{}'::jsonb OR NOT trip ?& ARRAY['legId','expectedLegVersionId','actualStop'] OR crest_private.booking_uuid(trip->'legId') IS NOT TRUE OR crest_private.booking_uuid(trip->'expectedLegVersionId') IS NOT TRUE
  OR jsonb_typeof(stop) IS DISTINCT FROM 'object' OR stop-ARRAY['schemaVersion','kind','locationText','instructions']<>'{}'::jsonb OR NOT stop ?& ARRAY['schemaVersion','kind','locationText','instructions'] OR stop->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR stop->>'kind' IS DISTINCT FROM 'manual' OR crest_private.booking_text_required(stop->'locationText',2000) IS NOT TRUE OR NOT coalesce(stop->'instructions'='null'::jsonb OR crest_private.booking_text_required(stop->'instructions',2000),false) THEN RETURN false;END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId']<>'{}'::jsonb OR NOT entry ?& ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId'] OR crest_private.booking_uuid(entry->'sourceAllocationId') IS NOT TRUE OR crest_private.booking_uuid(entry->'expectedPlanId') IS NOT TRUE OR crest_private.booking_uuid(entry->'entitlementVersionId') IS NOT TRUE OR jsonb_typeof(entry->'expectedSequence') IS DISTINCT FROM 'string' OR(entry->>'expectedSequence')!~'^[1-9][0-9]{0,18}$' OR(entry->>'expectedSequence')::numeric>=9223372036854775807 OR previous IS NOT NULL AND previous>=entry->>'sourceAllocationId' THEN RETURN false;END IF;previous:=entry->>'sourceAllocationId';
 END LOOP;
 IF body->>'action'='cancel' THEN RETURN body->'expectedModeSequence'='null'::jsonb AND body->'appointment'='null'::jsonb AND body->'conflictReview'='null'::jsonb AND crest_private.valid_booking_communication(body->'customerCommunication',recorded);END IF;
 slot:=body->'appointment';review:=body->'conflictReview';
 IF jsonb_typeof(body->'expectedModeSequence') IS DISTINCT FROM 'string' OR(body->>'expectedModeSequence')!~'^[1-9][0-9]{0,18}$' OR(body->>'expectedModeSequence')::numeric>9223372036854775807 OR body->'customerCommunication'<>'null'::jsonb
  OR jsonb_typeof(slot) IS DISTINCT FROM 'object' OR slot-ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','contact_snapshot','customer_confirmation','unknown_travel_reviewed']<>'{}'::jsonb OR NOT slot ?& ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','contact_snapshot','customer_confirmation','unknown_travel_reviewed'] OR crest_private.valid_booking_contact(slot->'contact_snapshot') IS NOT TRUE OR crest_private.valid_booking_confirmation(slot->'customer_confirmation',recorded) IS NOT TRUE OR jsonb_typeof(slot->'unknown_travel_reviewed') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(review) IS DISTINCT FROM 'object' OR review-ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason']<>'{}'::jsonb OR NOT review ?& ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason'] OR jsonb_typeof(review->'expectedAppointmentIds') IS DISTINCT FROM 'array' OR jsonb_array_length(review->'expectedAppointmentIds')>1000 OR jsonb_typeof(review->'expectedUnknownTravel') IS DISTINCT FROM 'boolean' OR NOT coalesce(review->'overrideReason'='null'::jsonb OR crest_private.booking_text_required(review->'overrideReason',1000),false) THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['start_at','end_at','timezone','local_start','local_end'] LOOP IF jsonb_typeof(slot->key) IS DISTINCT FROM 'string' THEN RETURN false;END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['start_offset_minutes','end_offset_minutes'] LOOP IF jsonb_typeof(slot->key) IS DISTINCT FROM 'number' OR(slot->>key)!~'^-?(0|[1-9][0-9]{0,3})$' THEN RETURN false;END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['travel_before_seconds','travel_after_seconds'] LOOP IF slot->key<>'null'::jsonb AND(jsonb_typeof(slot->key) IS DISTINCT FROM 'number' OR(slot->>key)!~'^(0|[1-9][0-9]{0,9})$' OR(slot->>key)::numeric>2147483647) THEN RETURN false;END IF;END LOOP;
 previous:=NULL;FOR entry IN SELECT value FROM jsonb_array_elements(review->'expectedAppointmentIds') LOOP IF crest_private.booking_uuid(entry) IS NOT TRUE OR previous IS NOT NULL AND previous>=entry#>>'{}' THEN RETURN false;END IF;previous:=entry#>>'{}';END LOOP;
 RETURN true;
END $valid$;
REVOKE ALL ON FUNCTION crest_private.valid_interrupt_body(jsonb,timestamptz) FROM PUBLIC;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.valid_interrupt_body(jsonb,timestamptz),crest_private.valid_booking_communication(jsonb,timestamptz),crest_private.valid_booking_confirmation(jsonb,timestamptz),crest_private.valid_booking_contact(jsonb),crest_private.valid_appointment_hold_payload(jsonb) TO crest_booking_owner,crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.interruption_scope_valid(business uuid,job uuid,scope jsonb,current_required boolean) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $scope$
DECLARE entry jsonb;p crest.allocation_plan_versions;s crest.scope_allocations;v crest.entitlement_versions;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements(scope) LOOP
  SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND id=(entry->>'expectedPlanId')::uuid AND source_allocation_id=(entry->>'sourceAllocationId')::uuid;
  SELECT * INTO s FROM crest.scope_allocations WHERE business_id=business AND id=p.source_allocation_id;
  SELECT * INTO v FROM crest.entitlement_versions WHERE business_id=business AND id=coalesce(p.entitlement_version_id,s.entitlement_version_id);
  IF p.id IS NULL OR s.id IS NULL OR v.id IS NULL OR p.sequence::text IS DISTINCT FROM entry->>'expectedSequence' OR v.id::text IS DISTINCT FROM entry->>'entitlementVersionId'
   OR NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id AND job_id=job AND allocation_state='assigned')
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id AND job_id=job AND allocation_state<>'assigned')
   OR current_required AND(EXISTS(SELECT 1 FROM crest.allocation_plan_versions WHERE business_id=business AND source_allocation_id=s.id AND sequence>p.sequence) OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state control WHERE control.business_id=business AND control.family_id=v.family_id AND control.current_agreement_id=v.agreement_id)) THEN RETURN false;END IF;
 END LOOP;
 RETURN NOT current_required OR (SELECT count(DISTINCT source_allocation_id) FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job)=jsonb_array_length(scope);
END $scope$;
CREATE FUNCTION crest_private.interruption_resources_valid(j crest.jobs,slot jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $resources$
DECLARE vehicle crest.vehicles;chosen crest.job_vehicles;
BEGIN
 PERFORM 1 FROM crest.customers WHERE business_id=j.business_id AND id=j.customer_id AND archived_at IS NULL FOR SHARE;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM crest.memberships WHERE business_id=j.business_id AND actor_id=j.operator_actor_id AND active FOR SHARE;IF NOT FOUND THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest.job_vehicles WHERE business_id=j.business_id AND job_id=j.id) OR crest_private.valid_booking_location(j.work_location_snapshot,j.business_id,j.customer_id,true) IS NOT TRUE THEN RETURN false;END IF;
 FOR chosen IN SELECT * FROM crest.job_vehicles WHERE business_id=j.business_id AND job_id=j.id ORDER BY vehicle_id LOOP
  SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=j.business_id AND id=chosen.vehicle_id FOR SHARE;
  IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL OR chosen.customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.customer_vehicles WHERE business_id=j.business_id AND id=chosen.customer_vehicle_id AND customer_id=j.customer_id AND vehicle_id=chosen.vehicle_id AND valid_to IS NULL) THEN RETURN false;END IF;
 END LOOP;
 RETURN crest_private.valid_appointment_hold_payload(jsonb_build_object('customer_id',j.customer_id,'lead_id',NULL,'label','Interrupted Mobile replacement time','state','proposed','start_at',slot->'start_at','end_at',slot->'end_at','timezone',slot->'timezone','local_start',slot->'local_start','local_end',slot->'local_end','start_offset_minutes',slot->'start_offset_minutes','end_offset_minutes',slot->'end_offset_minutes','notes',NULL,'reason',NULL));
END $resources$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.interruption_scope_valid(uuid,uuid,jsonb,boolean) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.interruption_resources_valid(crest.jobs,jsonb) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.interruption_scope_valid(uuid,uuid,jsonb,boolean),crest_private.interruption_resources_valid(crest.jobs,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.interruption_scope_valid(uuid,uuid,jsonb,boolean),crest_private.interruption_resources_valid(crest.jobs,jsonb) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.interrupt_mobile_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;j crest.jobs;before_job crest.jobs;old_leg crest.travel_legs;l crest.travel_legs;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;mode crest.fulfillment_mode_versions;reservation crest.schedule_reservations;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;event crest.job_events;family uuid;conflicting uuid;observed jsonb;previous crest.allocation_plan_versions;p crest.allocation_plan_versions;part crest.allocation_plan_parts;prior_part crest.allocation_plan_parts;slot jsonb;review jsonb;slot_review jsonb;blocked tstzrange;actual_conflicts jsonb;audits jsonb;receipt jsonb;result jsonb;stamp timestamptz;conflict text;draft jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR crest_private.valid_interrupt_body(body,clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INTERRUPTION_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.interrupt','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.interrupt',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.interrupt' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.interrupted_job_result(requested_business,expected_actor,requested_operation);
  ELSE
   IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||at.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||at.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute at ON at.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND at.attnum>0 AND NOT at.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INTERRUPTION_SCHEMA_REVIEW_REQUIRED';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF before_job.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='version';END IF;
   IF before_job.state<>'en_route' OR before_job.fulfillment_mode<>'mobile' OR before_job.first_work_at IS NOT NULL OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=requested_business AND job_id=requested_job) OR EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=requested_business AND job_id=requested_job) THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='state';END IF;
   IF crest_private.interruption_scope_valid(requested_business,requested_job,body->'scope',true) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='allocation';END IF;
   SELECT * INTO old_leg FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=(body->'trip'->>'legId')::uuid;
   IF old_leg.id IS NULL OR old_leg.id::text IS DISTINCT FROM body->'trip'->>'expectedLegVersionId' OR old_leg.job_context_id<>requested_job OR old_leg.operator_actor_id<>before_job.operator_actor_id OR old_leg.purpose<>'mobile_work_site' OR old_leg.state<>'open' THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='travel';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=requested_job;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=requested_job ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR old_appointment.confirmation_state<>'confirmed' OR latest.id::text IS DISTINCT FROM body->>'expectedAppointmentId' OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='appointment';END IF;
   slot:=body->'appointment';review:=body->'conflictReview';
   IF body->>'action'='reschedule' THEN
    SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
    IF mode.id IS NULL OR NOT mode.mobile_enabled OR mode.sequence::text IS DISTINCT FROM body->>'expectedModeSequence' THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='mode';END IF;
    IF crest_private.interruption_resources_valid(before_job,slot) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='resources';END IF;
   END IF;
   stamp:=clock_timestamp();
   INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,eta_at,eta_source,eta_calculated_at,notes,change_kind,reason,created_by,operation_id)
   VALUES(requested_business,old_leg.logical_id,old_leg.sequence+1,old_leg.id,old_leg.operator_actor_id,old_leg.driven_vehicle_id,old_leg.job_context_id,old_leg.purpose,old_leg.origin_snapshot,body->'trip'->'actualStop',old_leg.departed_at,stamp,'cancelled',old_leg.eta_at,old_leg.eta_source,old_leg.eta_calculated_at,old_leg.notes,'cancel',body->>'reason',expected_actor,requested_operation) RETURNING * INTO l;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',l.logical_id,l.sequence,'cancel',l.reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(old_leg),'after',crest_private.field_travel_projection(l)),'manual');
   IF body->>'action'='cancel' THEN
    INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
    VALUES(requested_business,requested_job,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   ELSE
    INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
    VALUES(requested_business,requested_job,latest.sequence+1,latest.id,(slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz,slot->>'timezone',(slot->>'local_start')::timestamp,(slot->>'local_end')::timestamp,(slot->>'start_offset_minutes')::integer,(slot->>'end_offset_minutes')::integer,(slot->>'travel_before_seconds')::integer,(slot->>'travel_after_seconds')::integer,'confirmed',slot->'customer_confirmation',slot->'contact_snapshot',(slot->>'unknown_travel_reviewed')::boolean,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   END IF;
   PERFORM crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=requested_job RETURNING * INTO reservation;
   IF reservation.id IS NULL OR reservation.appointment_id<>old_appointment.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;
   PERFORM crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL);
   IF body->>'action'='reschedule' THEN
    blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');slot_review:=crest_private.booking_slot_review(requested_business,before_job.operator_actor_id,requested_job,blocked,a.travel_before_seconds,a.travel_after_seconds);
    SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO actual_conflicts FROM jsonb_array_elements(slot_review->'conflictingAppointmentIds');
    IF actual_conflicts IS DISTINCT FROM review->'expectedAppointmentIds' OR slot_review->'unknownTravel' IS DISTINCT FROM review->'expectedUnknownTravel' OR(slot_review->>'unknownTravel')::boolean AND NOT a.unknown_travel_reviewed THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='review';END IF;
    IF actual_conflicts<>'[]'::jsonb THEN
     IF review->'overrideReason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='review';END IF;
     INSERT INTO crest.schedule_overrides(business_id,job_id,appointment_id,reason,created_by,operation_id) VALUES(requested_business,requested_job,a.id,review->>'overrideReason',expected_actor,requested_operation) RETURNING * INTO override_row;PERFORM crest_private.append_booking_audit('schedule_overrides',override_row.id,1,'create',NULL,crest_private.schedule_overrides_projection(override_row));
     FOR conflicting IN SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(actual_conflicts) LOOP INSERT INTO crest.schedule_override_conflicts(business_id,override_id,conflicting_appointment_id,created_by,operation_id) VALUES(requested_business,override_row.id,conflicting,expected_actor,requested_operation) RETURNING * INTO conflict_row;PERFORM crest_private.append_booking_audit('schedule_override_conflicts',conflict_row.id,1,'create',NULL,crest_private.schedule_override_conflicts_projection(conflict_row));END LOOP;
    END IF;
    INSERT INTO crest.schedule_reservations(business_id,job_id,appointment_id,operator_actor_id,blocked_interval,unknown_travel,override_id,created_by,operation_id) VALUES(requested_business,requested_job,a.id,before_job.operator_actor_id,blocked,(slot_review->>'unknownTravel')::boolean,override_row.id,expected_actor,requested_operation) RETURNING * INTO reservation;PERFORM crest_private.append_booking_audit('schedule_reservations',reservation.id,1,'create',NULL,crest_private.schedule_reservations_projection(reservation));
   ELSE
    FOR observed IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
     SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND id=(observed->>'expectedPlanId')::uuid;
     INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,previous.source_allocation_id,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation,previous.entitlement_version_id,previous.authorization_state) RETURNING * INTO p;PERFORM crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p));
     FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
      INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=requested_job THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;PERFORM crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part));
     END LOOP;
    END LOOP;
   END IF;
   UPDATE crest.jobs SET state=CASE WHEN body->>'action'='cancel' THEN 'cancelled' ELSE 'scheduled' END,current_appointment_id=a.id,mode_version_id=CASE WHEN body->>'action'='reschedule' THEN mode.id ELSE before_job.mode_version_id END,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));
   draft:=CASE WHEN body->>'action'='reschedule' THEN crest_private.schedule_confirmation_draft(requested_business,j.id,a.id) ELSE 'null'::jsonb END;
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,'en_route',j.state,j.updated_at,body->>'reason',jsonb_build_object('schemaVersion',1,'request',request,'closedLegVersionId',l.id,'historyPredecessorId',latest.id,'slotReview',slot_review,'confirmationDraft',draft),expected_actor,requested_operation) RETURNING * INTO event;PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.interrupt','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'action',body->>'action','state',j.state,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'legId',l.logical_id,'closedLegVersionId',l.id,'effectiveAt',to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmationDraft',draft,'sourceAuditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_private.check_interrupted_job_graph(requested_business,requested_job,requested_operation);result:=crest_private.interrupted_job_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1921' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $command$;

CREATE FUNCTION crest_private.interrupted_job_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;l crest.travel_legs;old_leg crest.travel_legs;a crest.appointments;old_appointment crest.appointments;latest crest.appointments;before_job jsonb;after_job jsonb;request jsonb;body jsonb;audits jsonb;receipt jsonb;source_audit record;stored jsonb;plan_entry jsonb;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;actual_parts jsonb;expected_parts jsonb;expected_count bigint;counted bigint:=0;blocked jsonb;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.interrupt';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 request:=e.evidence->'request';body:=request->'body';
 SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=(e.evidence->>'closedLegVersionId')::uuid AND operation_id=operation AND created_by=actor;
 SELECT * INTO old_leg FROM crest.travel_legs WHERE business_id=business AND id=l.replaces_id;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(after_job->>'current_appointment_id')::uuid AND operation_id=operation AND created_by=actor;
 SELECT * INTO latest FROM crest.appointments WHERE business_id=business AND id=a.replaces_id;
 SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=business AND id=(before_job->>'current_appointment_id')::uuid AND job_id=e.job_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.interrupt','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'action',body->>'action','state',after_job->>'state','appointmentId',a.id,'appointmentSequence',a.sequence::text,'legId',l.logical_id,'closedLegVersionId',l.id,'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmationDraft',e.evidence->'confirmationDraft','sourceAuditIds',audits);
 IF e.id IS NULL OR l.id IS NULL OR old_leg.id IS NULL OR a.id IS NULL OR latest.id IS NULL OR old_appointment.id IS NULL OR before_job IS NULL OR after_job IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM receipt OR crest_private.valid_interrupt_body(body,e.created_at) IS NOT TRUE
  OR e.evidence-ARRAY['schemaVersion','request','closedLegVersionId','historyPredecessorId','slotReview','confirmationDraft']<>'{}'::jsonb OR NOT e.evidence ?& ARRAY['schemaVersion','request','closedLegVersionId','historyPredecessorId','slotReview','confirmationDraft'] OR e.evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR request IS DISTINCT FROM jsonb_build_object('commandType','operations.job.interrupt','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'expectedJobVersion',(e.sequence-1)::text,'body',body) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR e.from_state<>'en_route' OR e.to_state IS DISTINCT FROM(CASE WHEN body->>'action'='cancel' THEN 'cancelled' ELSE 'scheduled' END) OR before_job->>'state'<>'en_route' OR after_job->>'state' IS DISTINCT FROM e.to_state OR before_job->>'fulfillment_mode'<>'mobile' OR after_job->>'fulfillment_mode'<>'mobile'
  OR before_job->'first_work_at'<>'null'::jsonb OR after_job->'first_work_at'<>'null'::jsonb OR after_job->'completed_at'<>'null'::jsonb OR after_job->'completion_outcome'<>'null'::jsonb OR(before_job->>'version')::bigint+1<>e.sequence OR after_job->>'version' IS DISTINCT FROM e.sequence::text OR after_job->>'updated_by' IS DISTINCT FROM actor::text OR after_job->>'operation_id' IS DISTINCT FROM operation::text
  OR before_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id'] IS DISTINCT FROM after_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id']
  OR e.reason IS DISTINCT FROM body->>'reason' OR l.reason IS DISTINCT FROM e.reason OR a.reason IS DISTINCT FROM e.reason OR e.effective_at IS DISTINCT FROM l.arrived_at OR(after_job->>'updated_at')::timestamptz IS DISTINCT FROM l.arrived_at OR(before_job->>'updated_at')::timestamptz>l.arrived_at OR e.effective_at>e.created_at
  OR old_leg.logical_id::text IS DISTINCT FROM body->'trip'->>'legId' OR old_leg.id::text IS DISTINCT FROM body->'trip'->>'expectedLegVersionId' OR old_leg.state<>'open' OR l.state<>'cancelled' OR l.change_kind<>'cancel' OR l.sequence<>old_leg.sequence+1 OR l.job_context_id<>e.job_id OR l.operator_actor_id::text IS DISTINCT FROM before_job->>'operator_actor_id' OR l.purpose<>'mobile_work_site' OR l.destination_snapshot IS DISTINCT FROM body->'trip'->'actualStop'
  OR ROW(l.logical_id,l.operator_actor_id,l.driven_vehicle_id,l.job_context_id,l.purpose,l.origin_snapshot,l.departed_at,l.eta_at,l.eta_source,l.eta_calculated_at,l.notes) IS DISTINCT FROM ROW(old_leg.logical_id,old_leg.operator_actor_id,old_leg.driven_vehicle_id,old_leg.job_context_id,old_leg.purpose,old_leg.origin_snapshot,old_leg.departed_at,old_leg.eta_at,old_leg.eta_source,old_leg.eta_calculated_at,old_leg.notes)
  OR a.job_id<>e.job_id OR a.sequence<>latest.sequence+1 OR latest.id::text IS DISTINCT FROM body->>'expectedAppointmentId' OR e.evidence->>'historyPredecessorId' IS DISTINCT FROM latest.id::text OR old_appointment.confirmation_state<>'confirmed'
  OR (SELECT count(*) FROM crest.job_events WHERE business_id=business AND operation_id=operation)<>1 OR (SELECT count(*) FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)<>1 OR (SELECT count(*) FROM crest.appointments WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)
  OR crest_private.interruption_scope_valid(business,e.job_id,body->'scope',false) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_RESULT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='jobs' AND prior.entity_id=e.job_id AND prior.entity_version=e.sequence-1 AND prior.delta->'after'=before_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_HISTORY_REQUIRED';END IF;
 IF body->>'action'='cancel' THEN
  IF a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL OR e.evidence->'confirmationDraft'<>'null'::jsonb OR e.evidence->'slotReview'<>'null'::jsonb OR after_job->'mode_version_id' IS DISTINCT FROM before_job->'mode_version_id'
   OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,old_appointment.contact_snapshot)
   OR(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(body->'scope') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CANCELLATION_REQUIRED';END IF;
  FOR plan_entry IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
   SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=business AND id=(plan_entry->>'expectedPlanId')::uuid;
   SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND source_allocation_id=previous.source_allocation_id;
   IF p.id IS NULL OR p.replaces_id<>previous.id OR p.sequence<>previous.sequence+1 OR p.entitlement_version_id IS DISTINCT FROM previous.entitlement_version_id OR p.authorization_state IS DISTINCT FROM previous.authorization_state THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SCOPE_REQUIRED';END IF;
   SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',CASE WHEN job_id=e.job_id THEN 'cancelled' ELSE allocation_state END,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO expected_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=previous.id;
   SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',allocation_state,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO actual_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id;
   IF actual_parts IS DISTINCT FROM expected_parts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SCOPE_REQUIRED';END IF;PERFORM crest_private.check_completed_scope_floor(business,p.source_allocation_id,p.id);
  END LOOP;
 ELSE
  IF a.confirmation_state<>'confirmed' OR a.customer_confirmation IS DISTINCT FROM body->'appointment'->'customer_confirmation' OR a.contact_snapshot IS DISTINCT FROM body->'appointment'->'contact_snapshot' OR a.unknown_travel_reviewed IS DISTINCT FROM(body->'appointment'->>'unknown_travel_reviewed')::boolean
   OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds) IS DISTINCT FROM ROW((body->'appointment'->>'start_at')::timestamptz,(body->'appointment'->>'end_at')::timestamptz,body->'appointment'->>'timezone',(body->'appointment'->>'local_start')::timestamp,(body->'appointment'->>'local_end')::timestamp,(body->'appointment'->>'start_offset_minutes')::integer,(body->'appointment'->>'end_offset_minutes')::integer,(body->'appointment'->>'travel_before_seconds')::integer,(body->'appointment'->>'travel_after_seconds')::integer)
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=business AND operation_id=operation)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CONFIRMATION_REQUIRED';END IF;
 END IF;
 expected_count:=jsonb_array_length(audits);
 FOR source_audit IN SELECT id,entity_kind,entity_id,entity_version,action,delta,origin,import_row_id,created_by FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor LOOP
  counted:=counted+1;stored:=NULL;
  IF source_audit.origin<>'manual' OR source_audit.import_row_id IS NOT NULL OR source_audit.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
  IF source_audit.entity_kind='jobs' THEN IF source_audit.entity_id<>e.job_id OR source_audit.entity_version<>e.sequence OR source_audit.action<>'revise' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_job,'after',after_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='travel_legs' THEN IF source_audit.entity_id<>l.logical_id OR source_audit.entity_version<>l.sequence OR source_audit.action<>'cancel' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(old_leg),'after',crest_private.field_travel_projection(l)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='schedule_reservations' THEN
   IF source_audit.action='release' THEN
    IF source_audit.entity_version<>2 OR source_audit.delta->'after'<>'null'::jsonb OR source_audit.delta->'before'->>'id' IS DISTINCT FROM source_audit.entity_id::text OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM e.job_id::text OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM old_appointment.id::text
     OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='schedule_reservations' AND prior.entity_id=source_audit.entity_id AND prior.action='create' AND prior.delta->'after'=source_audit.delta->'before') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;CONTINUE;
   END IF;
   stored:=source_audit.delta->'after';blocked:=jsonb_build_object('start_at',to_char((a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char((a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lower_inclusive',true,'upper_inclusive',false);
   IF body->>'action'<>'reschedule' OR stored->>'id' IS DISTINCT FROM source_audit.entity_id::text OR stored->>'job_id' IS DISTINCT FROM e.job_id::text OR stored->>'appointment_id' IS DISTINCT FROM a.id::text OR stored->'blocked_interval' IS DISTINCT FROM blocked OR stored->'unknown_travel' IS DISTINCT FROM body->'conflictReview'->'expectedUnknownTravel' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;
  ELSIF source_audit.entity_kind IN('appointments','job_events','allocation_plan_versions','allocation_plan_parts','schedule_overrides','schedule_override_conflicts') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',source_audit.entity_kind,source_audit.entity_kind) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.entity_version<>1 OR source_audit.action<>'create' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
 END LOOP;
 IF counted<>expected_count OR(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='schedule_reservations' AND action='release')<>1 OR(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='schedule_reservations' AND action='create')<>(CASE WHEN body->>'action'='reschedule' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;

CREATE FUNCTION crest_private.check_interrupted_job_graph(business uuid,job uuid,operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;a crest.appointments;l crest.travel_legs;mode crest.fulfillment_mode_versions;body jsonb;saved jsonb;after_job jsonb;review jsonb;blocked tstzrange;conflicts jsonb;override_row crest.schedule_overrides;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM operation OR e.operation_id IS DISTINCT FROM operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_GRAPH_REQUIRED';END IF;
 saved:=crest_private.interrupted_job_result(business,j.updated_by,operation);body:=e.evidence->'request'->'body';
 SELECT delta->'after' INTO after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=j.current_appointment_id;SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=(saved->'receipt'->>'closedLegVersionId')::uuid;
 IF saved->>'state' IS DISTINCT FROM 'committed' OR crest_private.jobs_projection(j) IS DISTINCT FROM after_job OR a.id IS NULL OR l.id IS NULL OR a.sequence IS DISTINCT FROM(SELECT max(sequence) FROM crest.appointments WHERE business_id=business AND job_id=job)
  OR NOT EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND id=l.id) OR EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND job_context_id=job AND state='open')
  OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=business AND job_id=job)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_GRAPH_REQUIRED';END IF;
 IF body->>'action'='cancel' THEN
  IF j.state<>'cancelled' OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job) OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state<>'cancelled') OR EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CANCELLATION_REQUIRED';END IF;
 ELSE
  SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=business ORDER BY sequence DESC LIMIT 1;
  IF j.state<>'scheduled' OR mode.id IS DISTINCT FROM j.mode_version_id OR NOT mode.mobile_enabled OR mode.sequence::text IS DISTINCT FROM body->>'expectedModeSequence' OR crest_private.interruption_resources_valid(j,body->'appointment') IS NOT TRUE OR crest_private.interruption_scope_valid(business,job,body->'scope',true) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CONFIRMATION_REQUIRED';END IF;
  blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');review:=crest_private.booking_slot_review(business,j.operator_actor_id,job,blocked,a.travel_before_seconds,a.travel_after_seconds);
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO conflicts FROM jsonb_array_elements(review->'conflictingAppointmentIds');
  IF review IS DISTINCT FROM e.evidence->'slotReview' OR conflicts IS DISTINCT FROM body->'conflictReview'->'expectedAppointmentIds' OR review->'unknownTravel' IS DISTINCT FROM body->'conflictReview'->'expectedUnknownTravel' OR(review->>'unknownTravel')::boolean AND NOT a.unknown_travel_reviewed
   OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job AND appointment_id=a.id AND operator_actor_id=j.operator_actor_id AND blocked_interval=blocked AND unknown_travel=(review->>'unknownTravel')::boolean AND operation_id=operation)
   OR e.evidence->'confirmationDraft' IS DISTINCT FROM crest_private.schedule_confirmation_draft(business,job,a.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;
  IF conflicts='[]'::jsonb THEN IF EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job AND override_id IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_OVERRIDE_REQUIRED';END IF;
  ELSE
   SELECT * INTO override_row FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation AND job_id=job AND appointment_id=a.id;
   IF override_row.id IS NULL OR override_row.reason IS DISTINCT FROM body->'conflictReview'->>'overrideReason' OR(SELECT count(*) FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation)<>1 OR(SELECT count(*) FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(conflicts)
    OR(SELECT coalesce(jsonb_agg(conflicting_appointment_id ORDER BY conflicting_appointment_id),'[]'::jsonb) FROM crest.schedule_override_conflicts WHERE business_id=business AND override_id=override_row.id AND operation_id=operation) IS DISTINCT FROM conflicts OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job AND override_id=override_row.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_OVERRIDE_REQUIRED';END IF;
  END IF;
 END IF;
END $graph$;
CREATE FUNCTION crest_private.check_interrupted_job_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NEW.command_type<>'operations.job.interrupt' THEN RETURN NULL;END IF;
 IF crest_private.interrupted_job_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_RESULT_REQUIRED';END IF;RETURN NULL;
END $check$;
CREATE FUNCTION crest_commands.lookup_interrupted_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INTERRUPTION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.interrupted_job_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.interrupted_job_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_interrupted_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_interrupted_job_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.interrupted_job_result(uuid,uuid,uuid),crest_private.check_interrupted_job_graph(uuid,uuid,uuid),crest_private.check_interrupted_job_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.interrupted_job_result(uuid,uuid,uuid),crest_private.check_interrupted_job_graph(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_interrupted_job_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER interruption_original AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_interrupted_job_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_interrupted_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_interrupted_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_interrupted_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

-- Only reviewed fixed predecessor branches are extended. Existing ordinary
-- scheduling/cancellation/field/completion paths keep their original checks.
DO $extend$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.complete''',
  'IF NOT coalesce(kind=''operations.job.interrupt'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''DELETE'' AND TG_TABLE_NAME=''schedule_reservations'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME IN(''appointments'',''job_events'',''schedule_reservations'',''schedule_overrides'',''schedule_override_conflicts'',''allocation_plan_versions'',''allocation_plan_parts'')) OR kind=''operations.job.complete''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'''operations.job.field'',''operations.job.complete'')','''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'')');
 updated:=replace(updated,'IF kind=''operations.job.complete'' THEN',$branch$
 IF kind='operations.job.interrupt' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' THEN
   IF OLD.state<>'en_route' OR OLD.fulfillment_mode<>'mobile' OR OLD.first_work_at IS NOT NULL OR NEW.state NOT IN('scheduled','cancelled') OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor
    OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id']
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_GRAPH_REQUIRED';END IF;
   SELECT arrived_at INTO stamp FROM crest.travel_legs WHERE business_id=NEW.business_id AND operation_id=operation AND job_context_id=NEW.id AND state='cancelled' AND change_kind='cancel';
   IF stamp IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_TRAVEL_REQUIRED';END IF;NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts') AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SOURCE_REQUIRED';END IF;
 END IF;
 IF kind='operations.job.complete' THEN$branch$);
 IF updated=definition OR position('CREST_INTERRUPTION_TRAVEL_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'')','o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')');
 updated:=replace(updated,'o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'')','o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.complete'' THEN','IF kind=''operations.job.interrupt'' THEN PERFORM crest_private.check_interrupted_job_graph(business,job,source_operation);RETURN;END IF; IF kind=''operations.job.complete'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.complete'' THEN','IF kind=''operations.job.interrupt'' THEN PERFORM crest_private.check_interrupted_job_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF; IF kind=''operations.job.complete'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'')','kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'',''operations.job.interrupt'')');
 updated:=replace(updated,'IF kind=''operations.job.complete'' THEN',$branch$
 IF kind='operations.job.interrupt' THEN
  SELECT job_id INTO completion_job FROM crest.job_events WHERE business_id=p.business_id AND operation_id=p.operation_id;
  IF completion_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SCOPE_REQUIRED';END IF;
  PERFORM crest_private.check_interrupted_job_graph(p.business_id,completion_job,p.operation_id);RETURN NULL;
 END IF;
 IF kind='operations.job.complete' THEN$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 updated:=replace(definition,'''operations.time.correct'',''operations.job.complete'')','''operations.time.correct'',''operations.job.complete'',''operations.job.interrupt'')');
 updated:=replace(updated,'IF command=''operations.job.complete'' AND',$branch$
 IF command='operations.job.interrupt' THEN
  IF TG_TABLE_NAME<>'travel_legs' OR NEW.change_kind<>'cancel' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INTERRUPTION_TRAVEL_REQUIRED';END IF;
  PERFORM 1 FROM crest.jobs WHERE business_id=NEW.business_id AND id=NEW.job_context_id AND operator_actor_id=NEW.operator_actor_id AND state='en_route' AND fulfillment_mode='mobile' AND first_work_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_TRAVEL_REQUIRED';END IF;
 END IF;
 IF command='operations.job.complete' AND$branch$);
 IF updated=definition OR position('CREST_INTERRUPTION_TRAVEL_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.validate_booking_reservation()'::regprocedure);
 updated:=replace(definition,'command_type IN(''operations.job.reschedule'',''operations.job.cancel'')','command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_amendment_allocation_binding()'::regprocedure);
 updated:=replace(definition,'o.command_type=''operations.job.complete'' AND o.schema_version=1','o.command_type IN(''operations.job.complete'',''operations.job.interrupt'') AND o.schema_version=1');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_quote_amendment_accept_operation()'::regprocedure);
 updated:=replace(definition,'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'')','old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;
RESET ROLE;
