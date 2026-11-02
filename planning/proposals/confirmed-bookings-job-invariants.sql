-- Unregistered job graph checks. Statement construction protection is retained.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.lock_booking_family(uuid,uuid)') IS NULL OR to_regclass('crest.current_scope_allocation_parts') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_JOB_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.addresses TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.addresses FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT UPDATE(id) ON crest.customers,crest.vehicles,crest.addresses,crest.memberships TO crest_booking_integrity_owner;
CREATE POLICY booking_lock ON crest.customers FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_lock ON crest.vehicles FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_lock ON crest.addresses FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_lock ON crest.memberships FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.quote_review_note_valid(jsonb),crest_private.valid_appointment_hold_payload(jsonb),crest_private.customer_projection(crest.customers),crest_private.vehicle_projection(crest.vehicles),crest_private.address_projection(crest.addresses) TO crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.booking_text_required(v jsonb,max_length integer) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $text$
 SELECT coalesce(jsonb_typeof(v)='string' AND char_length(v#>>'{}')<=max_length AND crest_private.quote_review_note_valid(v),false)
$text$;
CREATE FUNCTION crest_private.valid_booking_contact(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $contact$
DECLARE base text[];
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF v->>'kind'='no_contact' THEN RETURN v-ARRAY['kind','reason']='{}'::jsonb AND v ?& ARRAY['kind','reason'] AND crest_private.booking_text_required(v->'reason',1000);END IF;
 IF v-ARRAY['kind','value']<>'{}'::jsonb OR NOT v ?& ARRAY['kind','value'] OR NOT crest_private.booking_text_required(v->'value',512) THEN RETURN false;END IF;
 IF v->>'kind'='email' THEN RETURN(v->>'value')~'^[^[:space:]@]+@[^[:space:]@]+$';END IF;
 IF v->>'kind'<>'phone' OR v->>'kind' IS NULL THEN RETURN false;END IF;
 base:=regexp_match(v->>'value','^([+]?[0-9(). -]+?)([ ]*(?:ext[.]?|x|#)[ ]*[0-9]+)?$','i');
 RETURN base IS NOT NULL AND length(regexp_replace(base[1],'[^0-9]','','g'))>=7 AND length(regexp_replace(base[1],'[^0-9]','','g'))<=15;
END $contact$;
CREATE FUNCTION crest_private.valid_booking_confirmation(v jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirmation$
DECLARE effective timestamptz;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['channel','effectiveAt','evidenceNote']<>'{}'::jsonb OR NOT v ?& ARRAY['channel','effectiveAt','evidenceNote'] OR jsonb_typeof(v->'channel') IS DISTINCT FROM 'string' OR v->>'channel' NOT IN('text','phone','email','in_person') OR NOT crest_private.booking_text_required(v->'evidenceNote',2000) OR jsonb_typeof(v->'effectiveAt') IS DISTINCT FROM 'string' OR(v->>'effectiveAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{6}Z$' OR(v->>'effectiveAt')<'0001-' THEN RETURN false;END IF;
 effective:=(v->>'effectiveAt')::timestamptz;
 RETURN recorded IS NOT NULL AND isfinite(recorded) AND isfinite(effective) AND effective<=recorded AND to_char(effective AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=v->>'effectiveAt';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN RETURN false;
END $confirmation$;
CREATE FUNCTION crest_private.valid_booking_location(v jsonb,business uuid,customer uuid,fresh boolean) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $location$
DECLARE a crest.addresses;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RETURN false;END IF;
 IF v->>'kind'='manual' THEN
  RETURN v-ARRAY['schemaVersion','kind','locationText','instructions']='{}'::jsonb AND v ?& ARRAY['schemaVersion','kind','locationText','instructions'] AND crest_private.booking_text_required(v->'locationText',2000) AND(v->'instructions'='null'::jsonb OR crest_private.booking_text_required(v->'instructions',2000));
 END IF;
 IF v->>'kind' IS DISTINCT FROM 'customer_address' OR v-ARRAY['schemaVersion','kind','addressId','addressVersion','snapshot']<>'{}'::jsonb OR NOT v ?& ARRAY['schemaVersion','kind','addressId','addressVersion','snapshot'] OR jsonb_typeof(v->'addressId') IS DISTINCT FROM 'string' OR(v->>'addressId')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR jsonb_typeof(v->'addressVersion') IS DISTINCT FROM 'string' OR(v->>'addressVersion')!~'^[1-9][0-9]{0,18}$' OR jsonb_typeof(v->'snapshot') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF NOT fresh THEN RETURN v->'snapshot'->>'id'=v->>'addressId' AND v->'snapshot'->>'business_id'=business::text AND v->'snapshot'->>'customer_id'=customer::text AND v->'snapshot'->>'version'=v->>'addressVersion';END IF;
 SELECT * INTO a FROM crest.addresses WHERE business_id=business AND customer_id=customer AND id=(v->>'addressId')::uuid FOR SHARE;
 RETURN a.id IS NOT NULL AND a.archived_at IS NULL AND a.version::text=v->>'addressVersion' AND crest_private.address_projection(a)=v->'snapshot'
  AND(crest_private.booking_text_required(to_jsonb(a.exact_location_text),2000) OR crest_private.booking_text_required(to_jsonb(a.line1),512) AND crest_private.booking_text_required(to_jsonb(a.city),200));
END $location$;
CREATE FUNCTION crest_private.validate_booking_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reservation$
DECLARE actor uuid;operation uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 IF TG_OP='DELETE' THEN
  actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
  IF NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=OLD.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND schema_version=1 AND command_type IN('operations.job.reschedule','operations.job.cancel') AND origin='manual' AND import_row_id IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RELEASE_CONTEXT_REQUIRED';END IF;
  PERFORM crest_private.lock_booking_operator(OLD.business_id,OLD.operator_actor_id);RETURN OLD;
 END IF;
 PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);RETURN NEW;
END $reservation$;
CREATE TRIGGER booking_validate_reservation BEFORE INSERT OR DELETE ON crest.schedule_reservations FOR EACH ROW EXECUTE FUNCTION crest_private.validate_booking_reservation();
CREATE FUNCTION crest_private.booking_slot_review(p_business uuid,p_operator uuid,p_job uuid,p_blocked tstzrange,p_before integer,p_after integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE conflicts uuid[];has_unknown boolean;
BEGIN
 IF p_business IS NULL OR p_operator IS NULL OR p_blocked IS NULL OR isempty(p_blocked) OR lower_inf(p_blocked) OR upper_inf(p_blocked) OR NOT isfinite(lower(p_blocked)) OR NOT isfinite(upper(p_blocked)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_REVIEW_INPUT_REQUIRED';END IF;
 SELECT coalesce(array_agg(r.appointment_id ORDER BY r.appointment_id),ARRAY[]::uuid[]) INTO conflicts FROM crest.schedule_reservations r WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND r.blocked_interval&&p_blocked;
 has_unknown:=p_before IS NULL OR p_after IS NULL;
 has_unknown:=has_unknown OR EXISTS(SELECT 1 FROM(
  (SELECT other.travel_after_seconds IS NULL AS is_unknown FROM crest.schedule_reservations r JOIN crest.appointments other ON other.business_id=r.business_id AND other.id=r.appointment_id WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND upper(r.blocked_interval)<=lower(p_blocked) ORDER BY upper(r.blocked_interval) DESC LIMIT 1)
  UNION ALL
  (SELECT other.travel_before_seconds IS NULL AS is_unknown FROM crest.schedule_reservations r JOIN crest.appointments other ON other.business_id=r.business_id AND other.id=r.appointment_id WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND lower(r.blocked_interval)>=upper(p_blocked) ORDER BY lower(r.blocked_interval) LIMIT 1)
  UNION ALL
  SELECT other.travel_before_seconds IS NULL OR other.travel_after_seconds IS NULL AS is_unknown FROM crest.schedule_reservations r JOIN crest.appointments other ON other.business_id=r.business_id AND other.id=r.appointment_id WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND r.blocked_interval&&p_blocked
 ) neighbours WHERE is_unknown);
 RETURN jsonb_build_object('conflictingAppointmentIds',conflicts,'unknownTravel',has_unknown);
END $review$;
CREATE FUNCTION crest_private.check_booking_job_graph(business uuid,job uuid,source_operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $job$
DECLARE j crest.jobs;a crest.appointments;latest crest.appointments;m crest.fulfillment_mode_versions;c crest.customers;v crest.job_vehicles;vehicle crest.vehicles;event crest.job_events;reservation crest.schedule_reservations;kind text;fresh boolean;family uuid;conflicts uuid[];recorded_conflicts uuid[];unknown_travel boolean;expected_range tstzrange;latest_event bigint;before_state text;review_snapshot jsonb;schedule_action text;preserve_slot boolean;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;
 IF j.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_JOB_REQUIRED';END IF;
 IF j.operation_id IS DISTINCT FROM source_operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CURRENT_MUTATION_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=business AND operation_id=source_operation;
 -- New commands acquire these same locks before writing. Repeating them here
 -- also keeps the deferred check and its commit in the same protected interval.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||business::text,0));
 FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=business AND job_id=job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(business,family);END LOOP;
 PERFORM crest_private.lock_booking_operator(business,j.operator_actor_id);
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=j.current_appointment_id AND job_id=j.id;
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=j.id AND sequence=j.version;
 SELECT * INTO latest FROM crest.appointments WHERE business_id=business AND job_id=j.id ORDER BY sequence DESC LIMIT 1;
 schedule_action:=event.evidence->'request'->'payload'->>'action';preserve_slot:=kind='operations.job.reschedule' AND schedule_action IN('propose','withdraw');fresh:=kind='operations.job.book' OR kind='operations.job.reschedule' AND schedule_action IN('propose','confirm');
 SELECT max(sequence) INTO latest_event FROM crest.job_events WHERE business_id=business AND job_id=j.id;
 SELECT delta->'before'->>'state' INTO before_state FROM crest_private.audit_events WHERE business_id=business AND operation_id=j.operation_id AND entity_kind='jobs' AND entity_id=j.id AND entity_version=j.version;
 IF a.id IS NULL OR event.id IS NULL OR latest_event<>j.version OR event.operation_id<>j.operation_id OR event.created_by<>j.updated_by OR event.from_state IS DISTINCT FROM before_state OR event.to_state<>j.state OR event.effective_at>event.created_at
  OR NOT coalesce(preserve_slot,false) AND a.id IS DISTINCT FROM latest.id
  OR NOT EXISTS(SELECT 1 FROM crest.job_vehicles WHERE business_id=business AND job_id=j.id)
  OR NOT EXISTS(SELECT 1 FROM crest.job_encounters WHERE business_id=business AND job_id=j.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_GRAPH_REQUIRED';END IF;
 IF crest_private.valid_booking_contact(a.contact_snapshot) IS NOT TRUE
  OR crest_private.valid_booking_location(j.work_location_snapshot,business,j.customer_id,fresh AND kind='operations.job.book') IS NOT TRUE
  OR j.work_address_id IS DISTINCT FROM(CASE WHEN j.work_location_snapshot->>'kind'='customer_address' THEN(j.work_location_snapshot->>'addressId')::uuid ELSE NULL END)
  OR crest_private.valid_appointment_hold_payload(jsonb_build_object('customer_id',j.customer_id,'lead_id',NULL,'label','Booking time grammar','state','proposed','start_at',to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char(a.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',a.timezone,'local_start',to_char(a.local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),'local_end',to_char(a.local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),'start_offset_minutes',a.start_offset_minutes,'end_offset_minutes',a.end_offset_minutes,'notes',NULL,'reason',NULL)) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_EVIDENCE_REQUIRED';END IF;
 -- The call above reuses only the existing UTC/local/offset data grammar. It
 -- does not create a proposal or substitute a proposal for a confirmed job.
 IF EXISTS(SELECT 1 FROM crest.job_encounters e JOIN crest.job_encounters other ON other.business_id=e.business_id AND other.family_id=e.family_id WHERE e.business_id=business AND e.job_id=j.id AND other.encounter_id<>e.encounter_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ENCOUNTER_IDENTITY_REQUIRED';END IF;
 IF fresh THEN
  SELECT * INTO c FROM crest.customers WHERE business_id=business AND id=j.customer_id FOR SHARE;
  IF c.id IS NULL OR c.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CUSTOMER_REQUIRED';END IF;
  PERFORM 1 FROM crest.memberships WHERE business_id=business AND actor_id=j.operator_actor_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATOR_REQUIRED';END IF;
  SELECT * INTO m FROM crest.fulfillment_mode_versions WHERE business_id=business ORDER BY sequence DESC LIMIT 1;
  IF (kind='operations.job.book' OR schedule_action='confirm') AND m.id IS DISTINCT FROM j.mode_version_id OR NOT(CASE j.fulfillment_mode WHEN 'mobile' THEN m.mobile_enabled WHEN 'dropoff' THEN m.dropoff_enabled WHEN 'pickup_return' THEN m.pickup_return_enabled ELSE false END)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_MODE_REQUIRED';END IF;
 END IF;
 FOR v IN SELECT * FROM crest.job_vehicles WHERE business_id=business AND job_id=j.id ORDER BY vehicle_id LOOP
  IF fresh THEN
   SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=business AND id=v.vehicle_id FOR SHARE;
   IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_VEHICLE_REQUIRED';END IF;
   IF v.operation_id=source_operation AND(v.vehicle_snapshot IS DISTINCT FROM crest_private.vehicle_projection(vehicle) OR v.customer_snapshot IS DISTINCT FROM crest_private.customer_projection(c)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SNAPSHOT_REQUIRED';END IF;
   IF v.customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.customer_vehicles link WHERE link.business_id=business AND link.id=v.customer_vehicle_id AND link.customer_id=j.customer_id AND link.vehicle_id=v.vehicle_id AND link.valid_to IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_VEHICLE_LINK_REQUIRED';END IF;
  END IF;
  IF j.fulfillment_mode='pickup_return' AND(crest_private.valid_booking_location(v.pickup_location_snapshot,business,j.customer_id,fresh AND kind='operations.job.book') IS NOT TRUE OR crest_private.valid_booking_location(v.return_location_snapshot,business,j.customer_id,fresh AND kind='operations.job.book') IS NOT TRUE)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_TRANSPORT_LOCATION_REQUIRED';END IF;
  IF v.pickup_address_id IS DISTINCT FROM(CASE WHEN v.pickup_location_snapshot->>'kind'='customer_address' THEN(v.pickup_location_snapshot->>'addressId')::uuid ELSE NULL END) OR v.return_address_id IS DISTINCT FROM(CASE WHEN v.return_location_snapshot->>'kind'='customer_address' THEN(v.return_location_snapshot->>'addressId')::uuid ELSE NULL END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_TRANSPORT_LOCATION_REQUIRED';END IF;
 END LOOP;
 IF j.state='cancelled' THEN
  IF a.confirmation_state<>'cancelled' OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=j.id)
   OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=j.id AND allocation_state<>'cancelled')
   OR crest_private.booking_text_required(to_jsonb(a.reason),1000) IS NOT TRUE OR crest_private.booking_text_required(to_jsonb(event.reason),1000) IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLATION_REQUIRED';END IF;RETURN;
 END IF;
 IF j.state<>'scheduled' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_FIELD_IMPLEMENTATION_REQUIRED';END IF;
 IF a.confirmation_state<>'confirmed' OR crest_private.valid_booking_confirmation(a.customer_confirmation,a.created_at) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=j.id AND allocation_state='assigned')
  OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=j.id AND allocation_state<>'assigned')
  OR fresh AND EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts p JOIN crest.scope_entitlements e ON e.business_id=p.business_id AND e.id=p.entitlement_id JOIN crest.quote_family_commercial_state active ON active.business_id=e.business_id AND active.family_id=e.agreement_family_id WHERE p.business_id=business AND p.job_id=j.id AND p.agreement_id IS DISTINCT FROM active.current_agreement_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFIRMED_SCOPE_REQUIRED';END IF;
 SELECT * INTO reservation FROM crest.schedule_reservations WHERE business_id=business AND job_id=j.id;
 expected_range:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');
 IF reservation.id IS NULL OR reservation.appointment_id<>a.id OR reservation.operator_actor_id<>j.operator_actor_id OR reservation.blocked_interval IS DISTINCT FROM expected_range
  OR NOT isfinite(lower(expected_range)) OR NOT isfinite(upper(expected_range)) OR lower(expected_range)<'0001-01-01T00:00:00Z'::timestamptz OR upper(expected_range)>='10000-01-01T00:00:00Z'::timestamptz
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESERVATION_REQUIRED';END IF;
 IF coalesce(preserve_slot,false) THEN
  -- A suggestion does not move the current confirmed pointer or reserve the
  -- proposed time. The old slot retains its original operation/audit evidence;
  -- later overrides by other jobs do not rewrite its historical conflict set.
  IF latest.id=a.id OR latest.operation_id<>source_operation OR latest.created_by<>j.updated_by OR latest.customer_confirmation IS NOT NULL OR latest.confirmation_state IS DISTINCT FROM(CASE schedule_action WHEN 'propose' THEN 'proposed' ELSE 'withdrawn' END)
   OR latest.reason IS DISTINCT FROM event.reason OR crest_private.booking_text_required(to_jsonb(latest.reason),1000) IS NOT TRUE
   OR crest_private.valid_booking_contact(latest.contact_snapshot) IS NOT TRUE
   OR crest_private.valid_appointment_hold_payload(jsonb_build_object('customer_id',j.customer_id,'lead_id',NULL,'label','Reschedule time grammar','state','proposed','start_at',to_char(latest.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char(latest.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',latest.timezone,'local_start',to_char(latest.local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),'local_end',to_char(latest.local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),'start_offset_minutes',latest.start_offset_minutes,'end_offset_minutes',latest.end_offset_minutes,'notes',NULL,'reason',NULL)) IS NOT TRUE
   OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND appointment_id=latest.id)
   OR EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=source_operation AND entity_kind IN('schedule_reservations','allocation_plan_versions','allocation_plan_parts','schedule_overrides','schedule_override_conflicts'))
   OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events journal WHERE journal.business_id=business AND journal.operation_id=source_operation AND journal.entity_kind='jobs' AND journal.entity_id=j.id AND journal.entity_version=j.version AND(journal.delta->'before')-ARRAY['version','updated_at','updated_by','operation_id']=(journal.delta->'after')-ARRAY['version','updated_at','updated_by','operation_id'])
   OR reservation.operation_id<>a.operation_id OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events journal JOIN crest_private.operations original ON original.business_id=journal.business_id AND original.operation_id=journal.operation_id AND original.actor_id=journal.actor_id WHERE journal.business_id=business AND journal.operation_id=reservation.operation_id AND journal.entity_kind='schedule_reservations' AND journal.entity_id=reservation.id AND journal.entity_version=1 AND journal.action='create' AND journal.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.schedule_reservations_projection(reservation)) AND original.state='committed')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_PROPOSAL_SOURCE_REQUIRED';END IF;RETURN;
 END IF;
 review_snapshot:=crest_private.booking_slot_review(business,j.operator_actor_id,j.id,expected_range,a.travel_before_seconds,a.travel_after_seconds);
 SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO conflicts FROM jsonb_array_elements(review_snapshot->'conflictingAppointmentIds');unknown_travel:=(review_snapshot->>'unknownTravel')::boolean;
 IF reservation.unknown_travel IS DISTINCT FROM unknown_travel OR unknown_travel AND NOT a.unknown_travel_reviewed THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_TRAVEL_REVIEW_REQUIRED';END IF;
 IF cardinality(conflicts)=0 THEN
  IF reservation.override_id IS NOT NULL OR EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND appointment_id=a.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFLICT_EVIDENCE_REQUIRED';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM crest.schedule_overrides o WHERE o.business_id=business AND o.id=reservation.override_id AND o.appointment_id=a.id AND o.job_id=j.id AND crest_private.booking_text_required(to_jsonb(o.reason),1000)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFLICT_REVIEW_REQUIRED';END IF;
  SELECT coalesce(array_agg(conflicting_appointment_id ORDER BY conflicting_appointment_id),ARRAY[]::uuid[]) INTO recorded_conflicts FROM crest.schedule_override_conflicts WHERE business_id=business AND override_id=reservation.override_id;
  IF recorded_conflicts IS DISTINCT FROM conflicts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFLICT_EVIDENCE_REQUIRED';END IF;
 END IF;
END $job$;
CREATE FUNCTION crest_private.check_booking_job_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $source$
DECLARE target uuid;operation uuid;
BEGIN
 IF TG_TABLE_NAME='jobs' THEN target:=NEW.id;operation:=NEW.operation_id;
 ELSIF TG_OP='DELETE' THEN target:=OLD.job_id;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 ELSIF TG_TABLE_NAME='schedule_override_conflicts' THEN
  SELECT job_id INTO target FROM crest.schedule_overrides WHERE business_id=NEW.business_id AND id=NEW.override_id AND operation_id=NEW.operation_id;operation:=NEW.operation_id;
 ELSE target:=NEW.job_id;operation:=NEW.operation_id;END IF;
 PERFORM crest_private.check_booking_job_graph(CASE WHEN TG_OP='DELETE' THEN OLD.business_id ELSE NEW.business_id END,target,operation);RETURN NULL;
END $source$;
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT OR UPDATE ON crest.jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.job_vehicles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.job_encounters DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.appointments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT OR DELETE ON crest.schedule_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.schedule_overrides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.schedule_override_conflicts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.job_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.booking_text_required(jsonb,integer) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.valid_booking_contact(jsonb) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.valid_booking_confirmation(jsonb,timestamptz) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.valid_booking_location(jsonb,uuid,uuid,boolean) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.validate_booking_reservation() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_job_source() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.booking_text_required(jsonb,integer),crest_private.valid_booking_contact(jsonb),crest_private.valid_booking_confirmation(jsonb,timestamptz),crest_private.valid_booking_location(jsonb,uuid,uuid,boolean),crest_private.validate_booking_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_private.check_booking_job_graph(uuid,uuid,uuid),crest_private.check_booking_job_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer) FROM PUBLIC;
