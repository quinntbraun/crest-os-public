-- BR07/BR09: explicit support trips, independent of work/custody/finance.
-- Held construction over registered53 plus the reviewed field proposals.
-- No registered migration, owner activation or complete export/recovery claim.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.unfulfilled_job_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_private.support_trip_result(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'baa7e8ad3f6b2e1a8087391b691c1a33d16cd32caf9489a5a2f7da437c320233'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'416267706a70e59b2e7ecec29c5feafbb3dfc0092033b0a6d18d6f52e747395d'),
   ('crest_private.field_check_projection()','crest_booking_integrity_owner',true,'cc140fdbafbbc44d75a8ba22c262e3567d31697d6d849e468b06e3d748bb54ab'),
   ('crest_private.field_check_source_audit()','crest_booking_integrity_owner',true,'3ef64b7f5372eb9a567521d626f13c0611400cb778e69640e82005f4a310977a'),
   ('crest_private.field_project_source()','crest_booking_integrity_owner',true,'e44469795a08c9961b241118761ca1cf0f8f9f2f06d6ca6960fb1d7c4d314320'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'ec29bdbaf71de87c49e5d4e1ecc1804486775517a93634173cc8c2eeb0e25acd'),
   ('crest_private.field_travel_projection(crest.travel_legs)','crest_booking_integrity_owner',false,'2335d1a4f81e8c0042ab757314dfe758d98bbced80a07850d9c62a67ccc3985d'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'762fd122ccdb954a9f48278cf9081687d91838bb66bb00f77304b5d2cdf31bd4')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.operator_controls'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SUPPORT_SOURCE_REQUIRED';END IF;
END $review$;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY support_trip_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct'));
CREATE POLICY support_trip_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY support_trip_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct'));
CREATE POLICY support_trip_integrity_read ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type IN('operations.support_trip.record','operations.support_trip.correct') AND schema_version=1);
GRANT SELECT(created_at) ON crest_private.operations TO crest_booking_integrity_owner;

CREATE FUNCTION crest_private.valid_support_location(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(jsonb_typeof(value)='object' AND value-ARRAY['schemaVersion','kind','locationText','instructions']='{}'::jsonb AND value ?& ARRAY['schemaVersion','kind','locationText','instructions'] AND value->'schemaVersion'='1'::jsonb AND value->>'kind'='manual' AND crest_private.booking_text_required(value->'locationText',2000) AND (value->'instructions'='null'::jsonb OR crest_private.booking_text_required(value->'instructions',2000)),false)
$valid$;
CREATE FUNCTION crest_private.valid_support_instant(value jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE instant timestamptz;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN false;END IF;
 instant:=(value#>>'{}')::timestamptz;
 RETURN isfinite(instant) AND instant<=recorded AND to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=value#>>'{}';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $valid$;
CREATE FUNCTION crest_private.valid_support_trip_body(body jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE action text;trip jsonb;keys text[];
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['action','reason','trip']<>'{}'::jsonb OR NOT body ?& ARRAY['action','reason','trip'] OR octet_length(body::text)>32768 THEN RETURN false;END IF;
 action:=body->>'action';trip:=body->'trip';
 IF action IS NULL OR action NOT IN('depart','arrive','cancel','record','correct') OR NOT coalesce(body->'reason'='null'::jsonb OR crest_private.booking_text_required(body->'reason',1000),false) OR action IN('cancel','record','correct') AND body->'reason'='null'::jsonb THEN RETURN false;END IF;
 IF action='arrive' THEN RETURN trip='null'::jsonb;END IF;
 IF action='cancel' THEN RETURN jsonb_typeof(trip)='object' AND trip-ARRAY['actualStop']='{}'::jsonb AND trip ? 'actualStop' AND crest_private.valid_support_location(trip->'actualStop');END IF;
 keys:=ARRAY['drivenVehicleId','jobId','purpose','origin','destination','notes'];IF action IN('record','correct') THEN keys:=keys||ARRAY['departedAt','arrivedAt','state'];END IF;
 IF jsonb_typeof(trip) IS DISTINCT FROM 'object' OR trip-keys<>'{}'::jsonb OR NOT trip ?& keys OR crest_private.booking_uuid(trip->'drivenVehicleId') IS NOT TRUE OR NOT coalesce(trip->'jobId'='null'::jsonb OR crest_private.booking_uuid(trip->'jobId'),false) OR trip->>'purpose' IS NULL OR trip->>'purpose' NOT IN('supply','between_jobs','return_to_base','other') OR crest_private.valid_support_location(trip->'origin') IS NOT TRUE OR crest_private.valid_support_location(trip->'destination') IS NOT TRUE OR NOT coalesce(trip->'notes'='null'::jsonb OR crest_private.booking_text_required(trip->'notes',2000),false) THEN RETURN false;END IF;
 IF action='depart' THEN RETURN true;END IF;
 IF trip->>'state' IS NULL OR trip->>'state' NOT IN('open','closed','cancelled') OR crest_private.valid_support_instant(trip->'departedAt',recorded) IS NOT TRUE THEN RETURN false;END IF;
 RETURN CASE WHEN trip->>'state'='open' THEN trip->'arrivedAt'='null'::jsonb ELSE crest_private.valid_support_instant(trip->'arrivedAt',recorded) AND (trip->>'arrivedAt')::timestamptz>=(trip->>'departedAt')::timestamptz END;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $valid$;
RESET ROLE;
REVOKE ALL ON FUNCTION crest_private.valid_support_location(jsonb),crest_private.valid_support_instant(jsonb,timestamptz),crest_private.valid_support_trip_body(jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_support_location(jsonb),crest_private.valid_support_instant(jsonb,timestamptz),crest_private.valid_support_trip_body(jsonb,timestamptz) TO crest_booking_owner,crest_booking_integrity_owner;

-- Narrowly map the two new command kinds into the unchanged source invariant.
-- Work intervals and mobile/custody legs cannot use this command.
DO $extend$ DECLARE definition text;updated text;marker text;BEGIN
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 marker:=' IF command IS NULL OR command NOT IN(''operations.job.field''';
 updated:=replace(definition,marker,$mapping$
 IF command IN('operations.support_trip.record','operations.support_trip.correct') THEN
  IF TG_TABLE_NAME<>'travel_legs' OR NEW.purpose NOT IN('supply','between_jobs','return_to_base','other') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SUPPORT_TRIP_ONLY';END IF;
  command:=CASE command WHEN 'operations.support_trip.correct' THEN 'operations.time.correct' ELSE 'operations.travel.record' END;
 END IF;
$mapping$||marker);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_SOURCE_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;

-- Reuse the existing immutable operator lock row for a first-ever trip.
-- This permits only its audited INSERT, never a job or financial mutation.
DO $operator$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.cancel_unfulfilled''','IF NOT coalesce(kind IN(''operations.support_trip.record'',''operations.support_trip.correct'') AND TG_OP=''INSERT'' AND TG_TABLE_NAME=''operator_controls'' OR kind=''operations.job.cancel_unfulfilled''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_OPERATOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,' IF kind IS NULL OR kind NOT IN(',$branch$
 IF kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
  IF TG_OP<>'INSERT' OR TG_TABLE_NAME<>'operator_controls' OR NEW.created_by<>actor OR NEW.operator_actor_id<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_OPERATOR_REQUIRED';END IF;
  NEW.created_at:=stamp;RETURN NEW;
 END IF;
$branch$||' IF kind IS NULL OR kind NOT IN(');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_OPERATOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'AND ((o.command_type IN(','AND ((o.command_type IN(''operations.support_trip.record'',''operations.support_trip.correct'') AND TG_OP=''INSERT'' AND TG_TABLE_NAME=''operator_controls'' OR o.command_type IN(');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_OPERATOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $operator$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.support_trip_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;l crest.travel_legs;old crest.travel_legs;control crest.operator_controls;a record;request jsonb;body jsonb;trip jsonb;action text;receipt jsonb;audits jsonb;before_row jsonb:='null'::jsonb;
BEGIN
 SELECT state,command_type,schema_version,result_schema_version,result,payload_hash,recovery_epoch,created_at INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('operations.support_trip.record','operations.support_trip.correct');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND operation_id=operation AND created_by=actor;
 IF l.replaces_id IS NOT NULL THEN SELECT * INTO old FROM crest.travel_legs WHERE business_id=business AND id=l.replaces_id;before_row:=crest_private.field_travel_projection(old);END IF;
 SELECT ev.id,ev.entity_kind,ev.entity_id,ev.entity_version,ev.action,ev.reason,ev.delta,ev.origin,ev.import_row_id,ev.created_by INTO a FROM crest_private.audit_events ev WHERE ev.business_id=business AND ev.operation_id=operation AND ev.actor_id=actor AND ev.entity_kind='travel_legs';
 SELECT * INTO control FROM crest.operator_controls WHERE business_id=business AND operator_actor_id=actor;
 SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 request:=o.result->'request';body:=request->'body';trip:=body->'trip';action:=body->>'action';
 receipt:=jsonb_build_object('schemaVersion',1,'commandType',o.command_type,'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'legId',l.logical_id,'legVersionId',l.id,'legSequence',l.sequence::text,'legState',l.state,'leg',crest_private.field_travel_projection(l),'operatorControlId',control.id,'mileageReviewRequired',true,'sourceAuditIds',audits);
 IF l.id IS NULL OR a.id IS NULL OR control.id IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) OR crest_private.valid_support_trip_body(body,l.created_at) IS NOT TRUE
  OR request IS DISTINCT FROM jsonb_build_object('commandType',o.command_type,'schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'legId',l.logical_id,'expectedLegVersionId',l.replaces_id,'body',body) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR o.command_type IS DISTINCT FROM(CASE WHEN action IN('record','correct') THEN 'operations.support_trip.correct' ELSE 'operations.support_trip.record' END)
  OR l.operator_actor_id<>actor OR l.purpose NOT IN('supply','between_jobs','return_to_base','other') OR l.reason IS DISTINCT FROM body->>'reason' OR l.eta_at IS NOT NULL OR l.eta_source IS NOT NULL OR l.eta_calculated_at IS NOT NULL
  OR l.change_kind IS DISTINCT FROM(CASE action WHEN 'depart' THEN 'depart' WHEN 'arrive' THEN 'arrive' WHEN 'cancel' THEN 'cancel' WHEN 'record' THEN 'record' ELSE 'correct' END)
  OR (SELECT count(*) FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)
  OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation)<>1+(CASE WHEN control.operation_id=operation THEN 1 ELSE 0 END)
  OR a.entity_kind<>'travel_legs' OR a.entity_id<>l.logical_id OR a.entity_version<>l.sequence OR a.action IS DISTINCT FROM(CASE WHEN l.sequence=1 THEN 'create' ELSE l.change_kind END) OR a.reason IS DISTINCT FROM l.reason OR a.origin<>'manual' OR a.import_row_id IS NOT NULL OR a.created_by<>actor
  OR a.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.field_travel_projection(l))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_RESULT_REQUIRED';END IF;
 IF control.operation_id=operation AND NOT EXISTS(SELECT 1 FROM crest_private.audit_events ev WHERE ev.business_id=business AND ev.operation_id=operation AND ev.actor_id=actor AND ev.created_by=actor AND ev.entity_kind='operator_controls' AND ev.entity_id=control.id AND ev.entity_version=1 AND ev.action='create' AND ev.reason IS NULL AND ev.origin='manual' AND ev.import_row_id IS NULL AND ev.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.operator_controls_projection(control))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_OPERATOR_REQUIRED';END IF;
 IF action IN('depart','record') THEN
  IF l.sequence<>1 OR l.replaces_id IS NOT NULL OR l.logical_id<>l.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_PREDECESSOR_REQUIRED';END IF;
 ELSE
  IF old.id IS NULL OR old.purpose NOT IN('supply','between_jobs','return_to_base','other') OR old.logical_id<>l.logical_id OR old.operator_actor_id<>actor OR l.sequence<>old.sequence+1 OR old.arrived_at IS NOT NULL AND l.arrived_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_PREDECESSOR_REQUIRED';END IF;
 END IF;
 IF action IN('depart','record','correct') THEN
  IF l.driven_vehicle_id::text IS DISTINCT FROM trip->>'drivenVehicleId' OR l.job_context_id::text IS DISTINCT FROM trip->>'jobId' OR l.purpose IS DISTINCT FROM trip->>'purpose' OR l.origin_snapshot IS DISTINCT FROM trip->'origin' OR l.destination_snapshot IS DISTINCT FROM trip->'destination' OR l.notes IS DISTINCT FROM trip->>'notes' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_BODY_REQUIRED';END IF;
 END IF;
 IF action IN('record','correct') THEN
  IF l.departed_at IS DISTINCT FROM(trip->>'departedAt')::timestamptz OR l.arrived_at IS DISTINCT FROM(trip->>'arrivedAt')::timestamptz OR l.state IS DISTINCT FROM trip->>'state' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_TIME_REQUIRED';END IF;
 ELSIF action='depart' THEN
  IF l.state<>'open' OR l.departed_at<o.created_at OR l.departed_at>l.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_TIME_REQUIRED';END IF;
 ELSE
  IF old.state<>'open' OR ROW(l.driven_vehicle_id,l.job_context_id,l.purpose,l.origin_snapshot,l.departed_at,l.notes) IS DISTINCT FROM ROW(old.driven_vehicle_id,old.job_context_id,old.purpose,old.origin_snapshot,old.departed_at,old.notes) OR l.arrived_at<o.created_at OR l.arrived_at>l.created_at
   OR action='arrive' AND(l.state<>'closed' OR l.destination_snapshot IS DISTINCT FROM old.destination_snapshot) OR action='cancel' AND(l.state<>'cancelled' OR l.destination_snapshot IS DISTINCT FROM trip->'actualStop') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_TIME_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.support_trip_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.support_trip_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.support_trip_result(uuid,uuid,uuid) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_support_trip(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_leg uuid,expected_leg_version uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;old crest.travel_legs;l crest.travel_legs;control crest.operator_controls;trip jsonb;action text;kind text;family uuid;requested_job uuid;stamp timestamptz;before_row jsonb:='null'::jsonb;audit_id uuid;audits jsonb;receipt jsonb;result jsonb;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_leg IS NULL OR crest_private.valid_support_trip_body(body,clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_INPUT_REQUIRED';END IF;
 action:=body->>'action';trip:=body->'trip';kind:=CASE WHEN action IN('record','correct') THEN 'operations.support_trip.correct' ELSE 'operations.support_trip.record' END;
 IF (action IN('depart','record')) IS DISTINCT FROM(expected_leg_version IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType',kind,'schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'legId',requested_leg,'expectedLegVersionId',expected_leg_version,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,kind,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>kind OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.support_trip_result(requested_business,expected_actor,requested_operation);
  ELSE
   IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||at.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||at.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute at ON at.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND at.attnum>0 AND NOT at.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SUPPORT_SCHEMA_REVIEW_REQUIRED';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO old FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   requested_job:=(trip->>'jobId')::uuid;
   FOR family IN SELECT DISTINCT e.family_id FROM crest.job_encounters e WHERE e.business_id=requested_business AND(e.job_id=requested_job OR e.job_id=old.job_context_id) ORDER BY e.family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   INSERT INTO crest.operator_controls(business_id,operator_actor_id,created_by,operation_id) VALUES(requested_business,expected_actor,expected_actor,requested_operation) ON CONFLICT(business_id,operator_actor_id) DO NOTHING RETURNING * INTO control;
   IF control.id IS NOT NULL THEN PERFORM crest_private.append_booking_audit('operator_controls',control.id,1,'create',NULL,crest_private.operator_controls_projection(control));END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,expected_actor);
   SELECT * INTO control FROM crest.operator_controls WHERE business_id=requested_business AND operator_actor_id=expected_actor;
   SELECT * INTO old FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   IF expected_leg_version IS NULL AND old.id IS NOT NULL OR expected_leg_version IS NOT NULL AND(old.id IS NULL OR old.id<>expected_leg_version) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='version';END IF;
   IF old.id IS NOT NULL AND(old.operator_actor_id<>expected_actor OR old.purpose NOT IN('supply','between_jobs','return_to_base','other') OR old.sequence>=9223372036854775807) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='leg';END IF;
   IF action IN('arrive','cancel') AND old.state<>'open' OR action='correct' AND old.arrived_at IS NOT NULL AND trip->>'state'='open' THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='state';END IF;
   IF (action='depart' OR action IN('record','correct') AND trip->>'state'='open') AND EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=requested_business AND operator_actor_id=expected_actor AND state='open' AND logical_id<>requested_leg) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='occupancy';END IF;
   IF action IN('depart','record','correct') THEN
    IF NOT EXISTS(SELECT 1 FROM crest.vehicles WHERE business_id=requested_business AND id=(trip->>'drivenVehicleId')::uuid AND(archived_at IS NULL OR old.id IS NOT NULL AND id=old.driven_vehicle_id)) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='vehicle';END IF;
    IF requested_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job AND operator_actor_id=expected_actor) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='job';END IF;
   END IF;
   stamp:=clock_timestamp();
   IF action IN('depart','record','correct') THEN
    INSERT INTO crest.travel_legs(id,business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,notes,change_kind,reason,created_by,operation_id)
    VALUES(CASE WHEN old.id IS NULL THEN requested_leg ELSE gen_random_uuid() END,requested_business,requested_leg,coalesce(old.sequence,0)+1,old.id,expected_actor,(trip->>'drivenVehicleId')::uuid,requested_job,trip->>'purpose',trip->'origin',trip->'destination',CASE WHEN action='depart' THEN stamp ELSE(trip->>'departedAt')::timestamptz END,CASE WHEN action='depart' THEN NULL ELSE(trip->>'arrivedAt')::timestamptz END,CASE WHEN action='depart' THEN 'open' ELSE trip->>'state' END,trip->>'notes',CASE WHEN action='depart' THEN 'depart' WHEN action='record' THEN 'record' ELSE 'correct' END,body->>'reason',expected_actor,requested_operation) RETURNING * INTO l;
   ELSE
    INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,notes,change_kind,reason,created_by,operation_id)
    VALUES(requested_business,requested_leg,old.sequence+1,old.id,old.operator_actor_id,old.driven_vehicle_id,old.job_context_id,old.purpose,old.origin_snapshot,CASE WHEN action='cancel' THEN trip->'actualStop' ELSE old.destination_snapshot END,old.departed_at,stamp,CASE WHEN action='cancel' THEN 'cancelled' ELSE 'closed' END,old.notes,action,body->>'reason',expected_actor,requested_operation) RETURNING * INTO l;
   END IF;
   IF old.id IS NOT NULL THEN before_row:=crest_private.field_travel_projection(old);END IF;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',l.logical_id,l.sequence,CASE WHEN l.sequence=1 THEN 'create' ELSE l.change_kind END,l.reason,jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.field_travel_projection(l)),'manual') RETURNING id INTO audit_id;
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType',kind,'businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'legId',l.logical_id,'legVersionId',l.id,'legSequence',l.sequence::text,'legState',l.state,'leg',crest_private.field_travel_projection(l),'operatorControlId',control.id,'mileageReviewRequired',true,'sourceAuditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) WHERE business_id=requested_business AND operation_id=requested_operation;
   result:=crest_private.support_trip_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1941' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
  WHEN exclusion_violation THEN RETURN jsonb_build_object('state','conflict','reason','occupancy');
 END;
END $command$;
CREATE FUNCTION crest_commands.lookup_support_trip_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.support_trip_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_private.check_support_trip_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NEW.command_type IN('operations.support_trip.record','operations.support_trip.correct') AND crest_private.support_trip_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_RESULT_REQUIRED';END IF;RETURN NULL;
END $check$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_support_trip_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_support_trip_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_support_trip_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER support_trip_original AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_support_trip_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_support_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,jsonb),crest_commands.lookup_support_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,jsonb),crest_commands.lookup_support_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
