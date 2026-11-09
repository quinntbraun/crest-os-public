-- Unregistered BR09/DATABASE §1 construction. Actual/estimated mileage and
-- explicit job attribution over real immutable trips; never financial posting.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.completed_job_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_private.check_completed_scope_floor(uuid,uuid,uuid)') IS NULL
  OR to_regclass('crest.mileage_evidence') IS NOT NULL
  OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>53
  OR EXISTS(SELECT 1 FROM(VALUES('travel_legs'),('jobs'),('memberships')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass('crest.'||e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MILEAGE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.mileage_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),leg_id uuid NOT NULL,leg_version_id uuid NOT NULL,operator_actor_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,source text NOT NULL CHECK(source IN('odometer','manual_actual','route_estimate')),
 movement_kind text NOT NULL CHECK(movement_kind IN('business_rig','customer_vehicle','personal','unclassified')),
 actual_miles numeric(14,4) CHECK(actual_miles>=0),estimate_miles numeric(14,4) CHECK(estimate_miles>=0),estimate_source text,
 odometer_start numeric(14,4) CHECK(odometer_start>=0),odometer_end numeric(14,4) CHECK(odometer_end>=odometer_start),
 allocation_state text NOT NULL CHECK(allocation_state IN('unallocated','draft','allocated')),notes text,reason text,
 confirmed_at timestamptz CHECK(isfinite(confirmed_at)),confirmed_by uuid,
 CHECK((actual_miles IS NULL)=(confirmed_at IS NULL) AND(actual_miles IS NULL)=(confirmed_by IS NULL)),
 CHECK((estimate_miles IS NULL)=(estimate_source IS NULL)),CHECK((odometer_start IS NULL)=(odometer_end IS NULL)),
 CHECK(source='route_estimate' AND actual_miles IS NULL AND estimate_miles IS NOT NULL AND odometer_start IS NULL OR source='manual_actual' AND actual_miles IS NOT NULL OR source='odometer' AND actual_miles IS NOT NULL AND odometer_start IS NOT NULL AND actual_miles=odometer_end-odometer_start),
 CHECK(sequence=1 AND replaces_id IS NULL OR sequence>1 AND replaces_id IS NOT NULL AND reason IS NOT NULL),
 CHECK(notes IS NULL OR char_length(notes)<=2000),CHECK(reason IS NULL OR char_length(reason)>=1 AND char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>''),CHECK(estimate_source IS NULL OR char_length(estimate_source)>=1 AND char_length(estimate_source)<=1000 AND btrim(estimate_source,E' \t\n\r')<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,id,leg_id),UNIQUE(business_id,leg_id,sequence),UNIQUE(business_id,replaces_id),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,leg_version_id,leg_id,operator_actor_id) REFERENCES crest.travel_legs(business_id,id,logical_id,operator_actor_id),
 FOREIGN KEY(business_id,replaces_id,leg_id) REFERENCES crest.mileage_evidence(business_id,id,leg_id),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,confirmed_by) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.leg_job_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),evidence_id uuid NOT NULL,leg_id uuid NOT NULL,job_id uuid NOT NULL,
 fraction numeric(12,8) NOT NULL CHECK(fraction>=0 AND fraction<=1),reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,evidence_id,job_id),FOREIGN KEY(business_id,evidence_id,leg_id) REFERENCES crest.mileage_evidence(business_id,id,leg_id),FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX mileage_leg_version_parent ON crest.mileage_evidence(business_id,leg_version_id);
CREATE INDEX mileage_operator_parent ON crest.mileage_evidence(business_id,operator_actor_id);
CREATE INDEX mileage_actor_parent ON crest.mileage_evidence(business_id,created_by);
CREATE INDEX mileage_confirmed_actor_parent ON crest.mileage_evidence(business_id,confirmed_by);
CREATE INDEX mileage_job_parent ON crest.leg_job_allocations(business_id,job_id);
CREATE INDEX mileage_allocation_operation ON crest.leg_job_allocations(business_id,operation_id);
CREATE INDEX mileage_allocation_actor ON crest.leg_job_allocations(business_id,created_by);
CREATE VIEW crest.current_mileage_evidence WITH(security_invoker=true,security_barrier=true) AS
 SELECT e.*,CASE WHEN l.id IS DISTINCT FROM e.leg_version_id THEN 'needs_review' WHEN e.actual_miles IS NOT NULL THEN 'confirmed_actual' ELSE 'estimated' END AS distance_status
 FROM crest.mileage_evidence e JOIN crest.current_travel_legs l ON l.business_id=e.business_id AND l.logical_id=e.leg_id
 WHERE NOT EXISTS(SELECT 1 FROM crest.mileage_evidence later WHERE later.business_id=e.business_id AND later.replaces_id=e.id);
DO $tables$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['mileage_evidence','leg_job_allocations'] LOOP
 EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);EXECUTE format('GRANT SELECT ON crest.%I TO crest_booking_integrity_owner',name);
 EXECUTE format('CREATE POLICY mileage_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
 EXECUTE format('CREATE POLICY mileage_create ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid AND origin=''manual'')',name);
 EXECUTE format('CREATE POLICY mileage_integrity_read ON crest.%I FOR SELECT TO crest_booking_integrity_owner USING(true)',name);
 EXECUTE format('CREATE TRIGGER mileage_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source()',name);
END LOOP;END $tables$;
GRANT USAGE ON TYPE crest.mileage_evidence,crest.leg_job_allocations TO crest_booking_owner,crest_booking_integrity_owner;
GRANT SELECT ON crest.current_mileage_evidence TO crest_booking_owner,crest_booking_integrity_owner;
CREATE POLICY mileage_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mileage.record');
CREATE POLICY mileage_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.mileage.record' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mileage_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mileage.record') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mileage.record' AND schema_version=1);
CREATE POLICY mileage_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.mileage.record');
CREATE POLICY mileage_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND entity_kind IN('mileage_evidence','leg_job_allocations'));
CREATE POLICY mileage_audit_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('mileage_evidence','leg_job_allocations') AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mileage_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(entity_kind IN('mileage_evidence','leg_job_allocations'));
CREATE UNIQUE INDEX mileage_source_audit ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN('mileage_evidence','leg_job_allocations');

CREATE FUNCTION crest_private.valid_mileage_body(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE key text;part jsonb;total numeric:=0;previous text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['source','movementKind','actualMiles','estimateMiles','estimateSource','odometerStart','odometerEnd','notes','reason','allocationState','allocations']<>'{}'::jsonb OR NOT body ?& ARRAY['source','movementKind','actualMiles','estimateMiles','estimateSource','odometerStart','odometerEnd','notes','reason','allocationState','allocations'] OR octet_length(body::text)>1048576
  OR body->>'source' IS NULL OR body->>'source' NOT IN('odometer','manual_actual','route_estimate') OR body->>'movementKind' IS NULL OR body->>'movementKind' NOT IN('business_rig','customer_vehicle','personal','unclassified') OR body->>'allocationState' IS NULL OR body->>'allocationState' NOT IN('unallocated','draft','allocated') OR jsonb_typeof(body->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocations')>1000 THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['actualMiles','estimateMiles','odometerStart','odometerEnd'] LOOP IF body->key<>'null'::jsonb AND(jsonb_typeof(body->key) IS DISTINCT FROM 'string' OR(body->>key)!~'^(0|[1-9][0-9]{0,9})\.[0-9]{4}$') THEN RETURN false;END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['estimateSource','notes','reason'] LOOP IF body->key<>'null'::jsonb AND(jsonb_typeof(body->key) IS DISTINCT FROM 'string' OR char_length(body->>key) NOT BETWEEN 1 AND CASE key WHEN 'notes' THEN 2000 ELSE 1000 END OR btrim(body->>key,E' \t\n\r')='' OR translate(body->>key,E'\t\n\r','')~'[[:cntrl:]]') THEN RETURN false;END IF;END LOOP;
 IF(body->'estimateMiles'='null'::jsonb) IS DISTINCT FROM(body->'estimateSource'='null'::jsonb) OR(body->'odometerStart'='null'::jsonb) IS DISTINCT FROM(body->'odometerEnd'='null'::jsonb) OR(body->>'odometerEnd')::numeric<(body->>'odometerStart')::numeric THEN RETURN false;END IF;
 IF body->>'source'='odometer' THEN IF body->'odometerStart'='null'::jsonb OR body->'actualMiles'='null'::jsonb OR(body->>'actualMiles')::numeric IS DISTINCT FROM(body->>'odometerEnd')::numeric-(body->>'odometerStart')::numeric THEN RETURN false;END IF;
 ELSIF body->>'source'='manual_actual' THEN IF body->'actualMiles'='null'::jsonb THEN RETURN false;END IF;
 ELSE IF body->'actualMiles'<>'null'::jsonb OR body->'estimateMiles'='null'::jsonb OR body->'odometerStart'<>'null'::jsonb THEN RETURN false;END IF;END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(body->'allocations') LOOP
  IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR part-ARRAY['jobId','fraction']<>'{}'::jsonb OR NOT part ?& ARRAY['jobId','fraction'] OR crest_private.booking_uuid(part->'jobId') IS NOT TRUE OR jsonb_typeof(part->'fraction') IS DISTINCT FROM 'string' OR(part->>'fraction')!~'^[01]\.[0-9]{8}$' OR(part->>'fraction')::numeric>1 OR previous IS NOT NULL AND previous>=part->>'jobId' THEN RETURN false;END IF;
  total:=total+(part->>'fraction')::numeric;previous:=part->>'jobId';
 END LOOP;
 RETURN total<=1 AND CASE body->>'allocationState' WHEN 'unallocated' THEN jsonb_array_length(body->'allocations')=0 WHEN 'draft' THEN jsonb_array_length(body->'allocations')>0 ELSE jsonb_array_length(body->'allocations')>0 AND total=1 END;
END $body$;
CREATE FUNCTION crest_private.mileage_projection(kind text,row_value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $projection$
DECLARE key text;
BEGIN
 IF kind NOT IN('mileage_evidence','leg_job_allocations') THEN RAISE EXCEPTION 'CREST_MILEAGE_SOURCE_REQUIRED';END IF;
 row_value:=row_value||jsonb_build_object('created_at',to_char((row_value->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF kind='mileage_evidence' THEN
  FOREACH key IN ARRAY ARRAY['sequence','actual_miles','estimate_miles','odometer_start','odometer_end'] LOOP row_value:=row_value||jsonb_build_object(key,row_value->>key);END LOOP;
  row_value:=row_value||jsonb_build_object('confirmed_at',CASE WHEN row_value->>'confirmed_at' IS NULL THEN NULL ELSE to_char((row_value->>'confirmed_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
 ELSE row_value:=row_value||jsonb_build_object('fraction',row_value->>'fraction');END IF;RETURN row_value;
END $projection$;
CREATE FUNCTION crest_private.mileage_body(e crest.mileage_evidence) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $body$
 SELECT jsonb_build_object('source',e.source,'movementKind',e.movement_kind,'actualMiles',e.actual_miles::text,'estimateMiles',e.estimate_miles::text,'estimateSource',e.estimate_source,'odometerStart',e.odometer_start::text,'odometerEnd',e.odometer_end::text,'notes',e.notes,'reason',e.reason,'allocationState',e.allocation_state,'allocations',(SELECT coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'fraction',fraction::text) ORDER BY job_id),'[]'::jsonb) FROM crest.leg_job_allocations WHERE business_id=e.business_id AND evidence_id=e.id))
$body$;
CREATE FUNCTION crest_private.stamp_mileage_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
DECLARE e crest.mileage_evidence;l crest.travel_legs;stamp timestamptz:=clock_timestamp();
BEGIN
 IF NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.created_by IS DISTINCT FROM nullif(current_setting('crest.actor_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM nullif(current_setting('crest.operation_id',true),'')::uuid OR NEW.origin<>'manual'
  OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND command_type='operations.mileage.record' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MILEAGE_CONTEXT_REQUIRED';END IF;
 IF TG_TABLE_NAME='mileage_evidence' THEN
  SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=NEW.business_id AND logical_id=NEW.leg_id;
  IF l.id IS NULL OR l.id<>NEW.leg_version_id OR l.operator_actor_id<>NEW.operator_actor_id OR NEW.actual_miles IS NOT NULL AND l.state='open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_LEG_REQUIRED';END IF;
  PERFORM crest_private.lock_booking_operator(NEW.business_id,l.operator_actor_id);
  SELECT * INTO e FROM crest.mileage_evidence WHERE business_id=NEW.business_id AND leg_id=NEW.leg_id ORDER BY sequence DESC LIMIT 1;
  IF e.id IS NULL AND(NEW.sequence<>1 OR NEW.replaces_id IS NOT NULL) OR e.id IS NOT NULL AND(NEW.sequence<>e.sequence+1 OR NEW.replaces_id IS DISTINCT FROM e.id OR NEW.reason IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_PREDECESSOR_REQUIRED';END IF;
  NEW.confirmed_at:=CASE WHEN NEW.actual_miles IS NOT NULL THEN stamp ELSE NULL END;NEW.confirmed_by:=CASE WHEN NEW.actual_miles IS NOT NULL THEN NEW.created_by ELSE NULL END;
 ELSE
  SELECT * INTO e FROM crest.mileage_evidence WHERE business_id=NEW.business_id AND id=NEW.evidence_id;
  IF e.id IS NULL OR e.operation_id<>NEW.operation_id OR e.created_by<>NEW.created_by OR e.leg_id<>NEW.leg_id OR NEW.reason IS DISTINCT FROM e.reason THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_ALLOCATION_REQUIRED';END IF;
 END IF;
 NEW.created_at:=stamp;RETURN NEW;
END $stamp$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.stamp_mileage_source() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.valid_mileage_body(jsonb),crest_private.mileage_projection(text,jsonb),crest_private.mileage_body(crest.mileage_evidence),crest_private.stamp_mileage_source() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.stamp_mileage_source() TO crest_schema_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_mileage_body(jsonb),crest_private.mileage_projection(text,jsonb),crest_private.mileage_body(crest.mileage_evidence) TO crest_booking_owner,crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER mileage_stamp BEFORE INSERT ON crest.mileage_evidence FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_mileage_source();
CREATE TRIGGER mileage_stamp BEFORE INSERT ON crest.leg_job_allocations FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_mileage_source();
CREATE FUNCTION crest_private.mileage_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.mileage_evidence;previous crest.mileage_evidence;l crest.travel_legs;body jsonb;request jsonb;receipt jsonb;audits jsonb;alloc_ids jsonb;part crest.leg_job_allocations;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.mileage.record';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.mileage_evidence WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT * INTO previous FROM crest.mileage_evidence WHERE business_id=business AND id=e.replaces_id;
 SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=e.leg_version_id;
 body:=crest_private.mileage_body(e);request:=jsonb_build_object('commandType','operations.mileage.record','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'legId',e.leg_id,'legVersionId',e.leg_version_id,'expectedVersion',(e.sequence-1)::text,'body',body);
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO alloc_ids FROM crest.leg_job_allocations WHERE business_id=business AND operation_id=operation;
 receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.mileage.record','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'legId',e.leg_id,'legVersionId',e.leg_version_id,'evidenceId',e.id,'evidenceSequence',e.sequence::text,'source',e.source,'actualMiles',e.actual_miles::text,'estimateMiles',e.estimate_miles::text,'allocationState',e.allocation_state,'allocationIds',alloc_ids,'auditIds',audits);
 IF e.id IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM receipt OR crest_private.valid_mileage_body(body) IS NOT TRUE OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR l.id IS NULL OR l.logical_id<>e.leg_id OR l.operator_actor_id<>e.operator_actor_id OR e.actual_miles IS NOT NULL AND(l.state='open' OR e.confirmed_by IS DISTINCT FROM actor OR e.confirmed_at IS DISTINCT FROM e.created_at) OR e.actual_miles IS NULL AND(e.confirmed_by IS NOT NULL OR e.confirmed_at IS NOT NULL)
  OR e.sequence=1 AND e.replaces_id IS NOT NULL OR e.sequence>1 AND(previous.id IS NULL OR previous.leg_id<>e.leg_id OR previous.sequence+1<>e.sequence OR e.reason IS NULL)
  OR jsonb_array_length(audits)<>1+jsonb_array_length(alloc_ids)
  OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='mileage_evidence' AND entity_id=e.leg_id AND entity_version=e.sequence AND action=(CASE e.sequence WHEN 1 THEN 'create' ELSE 'correct' END) AND reason IS NOT DISTINCT FROM e.reason AND delta=jsonb_build_object('schemaVersion',1,'before',CASE WHEN previous.id IS NULL THEN 'null'::jsonb ELSE crest_private.mileage_projection('mileage_evidence',to_jsonb(previous)) END,'after',crest_private.mileage_projection('mileage_evidence',to_jsonb(e))))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_RESULT_REQUIRED';END IF;
 FOR part IN SELECT * FROM crest.leg_job_allocations WHERE business_id=business AND operation_id=operation LOOP
  IF part.evidence_id<>e.id OR part.leg_id<>e.leg_id OR part.created_by<>actor OR part.reason IS DISTINCT FROM e.reason OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='leg_job_allocations' AND entity_id=part.id AND entity_version=1 AND action='create' AND reason IS NOT DISTINCT FROM e.reason AND delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.mileage_projection('leg_job_allocations',to_jsonb(part)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_RESULT_REQUIRED';END IF;
 END LOOP;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
CREATE FUNCTION crest_private.check_mileage_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE actor uuid;
BEGIN
 IF TG_TABLE_NAME='operations' THEN IF NEW.command_type<>'operations.mileage.record' THEN RETURN NULL;END IF;actor:=NEW.actor_id;ELSE actor:=NEW.created_by;END IF;
 IF crest_private.mileage_result(NEW.business_id,actor,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_RESULT_REQUIRED';END IF;RETURN NULL;
END $check$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.mileage_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_mileage_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.mileage_result(uuid,uuid,uuid),crest_private.check_mileage_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_mileage_result() TO crest_schema_owner;
GRANT EXECUTE ON FUNCTION crest_private.mileage_result(uuid,uuid,uuid) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER mileage_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_mileage_result();
CREATE CONSTRAINT TRIGGER mileage_result AFTER INSERT ON crest.mileage_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_mileage_result();
CREATE CONSTRAINT TRIGGER mileage_result AFTER INSERT ON crest.leg_job_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_mileage_result();

CREATE FUNCTION crest_commands.record_mileage(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_leg uuid,expected_leg_version uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;l crest.travel_legs;previous crest.mileage_evidence;e crest.mileage_evidence;a crest.leg_job_allocations;part jsonb;family uuid;audits jsonb;receipt jsonb;result jsonb;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_leg IS NULL OR expected_leg_version IS NULL OR expected_version IS NULL OR expected_version<0 OR expected_version>=9223372036854775807 OR crest_private.valid_mileage_body(body) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.mileage.record','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'legId',requested_leg,'legVersionId',expected_leg_version,'expectedVersion',expected_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.mileage.record',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.mileage.record' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.mileage_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   IF l.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='leg';END IF;
   FOR family IN SELECT DISTINCT family_id FROM crest.job_encounters WHERE business_id=requested_business AND(job_id=l.job_context_id OR job_id IN(SELECT(value->>'jobId')::uuid FROM jsonb_array_elements(body->'allocations'))) ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   PERFORM crest_private.lock_booking_operator(requested_business,l.operator_actor_id);
   -- Immutable sources need SELECT only. The canonical operator lock protects
   -- latest-version observations; never grant UPDATE merely to lock a read.
   SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   IF l.id IS DISTINCT FROM expected_leg_version THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='leg_version';END IF;
   IF l.state='open' AND body->'actualMiles'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='open_leg';END IF;
   SELECT * INTO previous FROM crest.mileage_evidence WHERE business_id=requested_business AND leg_id=requested_leg ORDER BY sequence DESC LIMIT 1;
   IF coalesce(previous.sequence,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='version';END IF;
   IF previous.id IS NOT NULL AND body->'reason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_CORRECTION_REASON_REQUIRED';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'allocations') p WHERE NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=(p->>'jobId')::uuid)) THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='job';END IF;
   INSERT INTO crest.mileage_evidence(business_id,leg_id,leg_version_id,operator_actor_id,sequence,replaces_id,source,movement_kind,actual_miles,estimate_miles,estimate_source,odometer_start,odometer_end,allocation_state,notes,reason,created_by,operation_id) VALUES(requested_business,l.logical_id,l.id,l.operator_actor_id,expected_version+1,previous.id,body->>'source',body->>'movementKind',(body->>'actualMiles')::numeric,(body->>'estimateMiles')::numeric,body->>'estimateSource',(body->>'odometerStart')::numeric,(body->>'odometerEnd')::numeric,body->>'allocationState',body->>'notes',body->>'reason',expected_actor,requested_operation) RETURNING * INTO e;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'mileage_evidence',e.leg_id,e.sequence,CASE e.sequence WHEN 1 THEN 'create' ELSE 'correct' END,e.reason,jsonb_build_object('schemaVersion',1,'before',CASE WHEN previous.id IS NULL THEN 'null'::jsonb ELSE crest_private.mileage_projection('mileage_evidence',to_jsonb(previous)) END,'after',crest_private.mileage_projection('mileage_evidence',to_jsonb(e))),'manual');
   FOR part IN SELECT value FROM jsonb_array_elements(body->'allocations') LOOP
    INSERT INTO crest.leg_job_allocations(business_id,evidence_id,leg_id,job_id,fraction,reason,created_by,operation_id) VALUES(requested_business,e.id,e.leg_id,(part->>'jobId')::uuid,(part->>'fraction')::numeric,e.reason,expected_actor,requested_operation) RETURNING * INTO a;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'leg_job_allocations',a.id,1,'create',e.reason,jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.mileage_projection('leg_job_allocations',to_jsonb(a))),'manual');
   END LOOP;
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.mileage.record','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'legId',e.leg_id,'legVersionId',e.leg_version_id,'evidenceId',e.id,'evidenceSequence',e.sequence::text,'source',e.source,'actualMiles',e.actual_miles::text,'estimateMiles',e.estimate_miles::text,'allocationState',e.allocation_state,'allocationIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM crest.leg_job_allocations WHERE business_id=requested_business AND evidence_id=e.id),'auditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   result:=crest_private.mileage_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1911' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $command$;
CREATE FUNCTION crest_commands.lookup_mileage_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.mileage_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.record_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_mileage_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_mileage_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_mileage_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(recorded_at) ON crest_private.audit_events TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.mileage_history_page(business uuid,leg uuid,after_version bigint,through_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE latest bigint;boundary bigint;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND logical_id=leg) THEN RETURN jsonb_build_object('state','not_found');END IF;
 SELECT coalesce(max(sequence),0) INTO latest FROM crest.mileage_evidence WHERE business_id=business AND leg_id=leg;boundary:=coalesce(through_version,latest);
 IF boundary>latest OR after_version>boundary THEN RETURN jsonb_build_object('state','conflict','reason','history_boundary');END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.mileage_evidence WHERE business_id=business AND leg_id=leg AND sequence>after_version AND sequence<=boundary ORDER BY sequence LIMIT page_limit),
 more AS(SELECT EXISTS(SELECT 1 FROM crest.mileage_evidence WHERE business_id=business AND leg_id=leg AND sequence>coalesce((SELECT max(sequence) FROM page),after_version) AND sequence<=boundary) value)
 SELECT jsonb_build_object('schemaVersion',1,'state','loaded','businessId',business,'legId',leg,'throughVersion',boundary::text,'afterVersion',after_version::text,'observedLegVersionId',(SELECT id FROM crest.current_travel_legs WHERE business_id=business AND logical_id=leg),
  'evidence',coalesce((SELECT jsonb_agg(crest_private.mileage_projection('mileage_evidence',to_jsonb(p)) ORDER BY p.sequence) FROM page p),'[]'::jsonb),
  'allocations',coalesce((SELECT jsonb_agg(crest_private.mileage_projection('leg_job_allocations',to_jsonb(a)) ORDER BY a.id) FROM crest.leg_job_allocations a JOIN page p ON p.business_id=a.business_id AND p.id=a.evidence_id),'[]'::jsonb),
  'audits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'business_id',a.business_id,'operation_id',a.operation_id,'actor_id',a.actor_id,'entity_kind',a.entity_kind,'entity_id',a.entity_id,'entity_version',a.entity_version::text,'action',a.action,'reason',a.reason,'delta',a.delta,'recorded_at',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'origin',a.origin) ORDER BY a.id) FROM crest_private.audit_events a JOIN page p ON p.business_id=a.business_id AND p.operation_id=a.operation_id WHERE a.entity_kind IN('mileage_evidence','leg_job_allocations')),'[]'::jsonb),
  'hasMore',(SELECT value FROM more),'nextAfterVersion',CASE WHEN(SELECT value FROM more) THEN(SELECT max(sequence)::text FROM page) ELSE NULL END) INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_MILEAGE_HISTORY_PAGE_TOO_LARGE';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.mileage_history_page(uuid,uuid,bigint,bigint,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.mileage_history_page(uuid,uuid,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.mileage_history_page(uuid,uuid,bigint,bigint,integer) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_mileage_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_leg uuid,after_version bigint,through_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_leg IS NULL OR after_version IS NULL OR after_version<0 OR through_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_HISTORY_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.mileage_history_page(requested_business,requested_leg,after_version,through_version,page_limit);
END $history$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_mileage_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_mileage_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_mileage_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) TO crest_web;
