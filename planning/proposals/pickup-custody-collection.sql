-- Held BR08 collection over the verified pickup trip commands. One immutable
-- handoff per booked vehicle. The shared claim excludes simultaneous custody
-- under either service mode. A claim is never released by job cancellation.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.pickup_custody_policies (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 mode_version_id uuid NOT NULL,
 acknowledgement_text text CHECK (char_length(acknowledgement_text)<=2000 AND btrim(acknowledgement_text,E' \t\r\n')<>''),
 condition_photo_required boolean NOT NULL,
 UNIQUE (business_id,id), UNIQUE (business_id,mode_version_id),
 FOREIGN KEY (business_id,mode_version_id) REFERENCES crest.fulfillment_mode_versions(business_id,id)
);
CREATE TABLE crest_private.pickup_custody_collections (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 pickup_leg_version_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 effective_at timestamptz NOT NULL CHECK (isfinite(effective_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(recorded_at) AND effective_at<=recorded_at),
 person_snapshot jsonb NOT NULL CHECK (jsonb_typeof(person_snapshot)='object'),
 location_snapshot jsonb NOT NULL CHECK (jsonb_typeof(location_snapshot)='object'),
 notes text,
 missing_photo_reason text NOT NULL,
 acknowledgement_confirmed boolean CHECK (acknowledgement_confirmed IS TRUE OR acknowledgement_confirmed IS NULL),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 CHECK (id=operation_id),
 UNIQUE (business_id,id), UNIQUE (business_id,job_vehicle_id), UNIQUE (business_id,operation_id),
 FOREIGN KEY (business_id,job_vehicle_id,job_id,vehicle_id) REFERENCES crest.job_vehicles(business_id,id,job_id,vehicle_id),
 FOREIGN KEY (business_id,pickup_leg_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY (business_id,policy_id) REFERENCES crest_private.pickup_custody_policies(business_id,id),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest_private.vehicle_custody_claims (
 business_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 dropoff_case_id uuid,
 pickup_collection_id uuid,
 CONSTRAINT custody_cross_mode_vehicle_held PRIMARY KEY (business_id,vehicle_id),
 CHECK ((dropoff_case_id IS NULL)<>(pickup_collection_id IS NULL)),
 FOREIGN KEY (business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),
 FOREIGN KEY (business_id,dropoff_case_id) REFERENCES crest.custody_cases(business_id,id),
 FOREIGN KEY (business_id,pickup_collection_id) REFERENCES crest_private.pickup_custody_collections(business_id,id)
);

ALTER TABLE crest_private.pickup_custody_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_collections FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.vehicle_custody_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.vehicle_custody_claims FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_policy BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_custody_policies
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
CREATE TRIGGER retain_pickup_collection BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_custody_collections
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();

GRANT SELECT ON crest_private.pickup_custody_policies,crest_private.pickup_custody_collections TO crest_booking_owner,crest_booking_integrity_owner;
GRANT INSERT ON crest_private.pickup_custody_collections TO crest_booking_owner;
GRANT SELECT,INSERT,DELETE ON crest_private.vehicle_custody_claims TO crest_booking_integrity_owner;
GRANT SELECT(business_id,vehicle_id,pickup_collection_id) ON crest_private.vehicle_custody_claims TO crest_booking_owner;
CREATE POLICY pickup_policy_read ON crest_private.pickup_custody_policies FOR SELECT TO crest_booking_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY pickup_collection_read ON crest_private.pickup_custody_collections FOR SELECT TO crest_booking_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_collection_insert ON crest_private.pickup_custody_collections FOR INSERT TO crest_booking_owner WITH CHECK (
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_policy_integrity ON crest_private.pickup_custody_policies FOR SELECT TO crest_booking_integrity_owner USING (true);
CREATE POLICY pickup_collection_integrity ON crest_private.pickup_custody_collections FOR SELECT TO crest_booking_integrity_owner USING (true);
CREATE POLICY custody_claim_read ON crest_private.vehicle_custody_claims FOR SELECT TO crest_booking_integrity_owner USING (true);
CREATE POLICY custody_claim_business_scope ON crest_private.vehicle_custody_claims FOR SELECT TO crest_booking_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_claim_insert ON crest_private.vehicle_custody_claims FOR INSERT TO crest_booking_integrity_owner WITH CHECK (true);
CREATE POLICY custody_claim_release ON crest_private.vehicle_custody_claims FOR DELETE TO crest_booking_integrity_owner USING (true);

CREATE POLICY pickup_collect_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING (
 command_type='operations.pickup_custody.collect' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_collect_operation_insert ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK (
 command_type='operations.pickup_custody.collect' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY pickup_collect_operation_commit ON crest_private.operations FOR UPDATE TO crest_booking_owner USING (
 command_type='operations.pickup_custody.collect' AND state='pending' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
) WITH CHECK (
 command_type='operations.pickup_custody.collect' AND state='committed' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_collect_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING (command_type='operations.pickup_custody.collect');
CREATE POLICY pickup_collect_audit_insert ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK (
 entity_kind='pickup_custody_collections' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND created_by=actor_id AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY pickup_collect_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING (
 entity_kind='pickup_custody_collections' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_collect_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING (entity_kind='pickup_custody_collections');

CREATE FUNCTION crest_private.project_vehicle_custody_claim() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
BEGIN
 IF TG_TABLE_NAME='pickup_custody_collections' THEN
  INSERT INTO crest_private.vehicle_custody_claims(business_id,vehicle_id,pickup_collection_id)
  VALUES(NEW.business_id,NEW.vehicle_id,NEW.id);
 ELSIF TG_OP='INSERT' THEN
  INSERT INTO crest_private.vehicle_custody_claims(business_id,vehicle_id,dropoff_case_id)
  VALUES(NEW.business_id,NEW.vehicle_id,NEW.id);
 ELSE
  DELETE FROM crest_private.vehicle_custody_claims
  WHERE business_id=OLD.business_id AND vehicle_id=OLD.vehicle_id AND dropoff_case_id=OLD.id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_DROPOFF_CUSTODY_CLAIM_MISSING'; END IF;
 END IF;
 RETURN NEW;
END $claim$;

CREATE FUNCTION crest_private.valid_pickup_collection_body(body jsonb,recorded timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(jsonb_typeof(body)='object'
  AND body ?& ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed']
  AND body-ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed']='{}'::jsonb
  AND octet_length(body::text)<=16384
  AND crest_private.valid_support_instant(body->'effectiveAt',recorded)
  AND jsonb_typeof(body->'person')='object' AND (body->'person')-ARRAY['schemaVersion','displayName']='{}'::jsonb
  AND body->'person'->'schemaVersion'='1'::jsonb AND crest_private.booking_text_required(body->'person'->'displayName',200)
  AND crest_private.valid_support_location(body->'location')
  AND (body->'notes'='null'::jsonb OR crest_private.booking_text_required(body->'notes',1000))
  AND crest_private.booking_text_required(body->'missingPhotoReason',1000)
  AND body->'acknowledgementConfirmed' IN ('null'::jsonb,'true'::jsonb),false)
$valid$;

CREATE FUNCTION crest_private.pickup_collection_projection(c crest_private.pickup_custody_collections) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(c)||jsonb_build_object(
  'effective_at',to_char(c.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

CREATE FUNCTION crest_private.pickup_collection_arrival(business uuid,actor uuid,job uuid,target uuid,leg uuid) RETURNS timestamptz
 LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $arrival$
DECLARE arrived crest.travel_legs; verified jsonb;
BEGIN
 SELECT l.* INTO arrived FROM crest.travel_legs l
 WHERE l.business_id=business AND l.id=leg AND l.job_context_id=job AND l.operator_actor_id=actor
  AND l.purpose='pickup' AND l.change_kind='arrive' AND l.state='closed';
 IF NOT FOUND THEN RETURN NULL; END IF;
 verified:=crest_private.pickup_trip_original(business,actor,arrived.operation_id);
 IF verified->>'state' IS DISTINCT FROM 'committed' OR verified->'receipt'->'leg'->>'id' IS DISTINCT FROM leg::text
  OR NOT coalesce((verified->'receipt'->'jobVehicleIds') ? target::text,false)
 THEN RETURN NULL; END IF;
 RETURN arrived.arrived_at;
END $arrival$;

CREATE FUNCTION crest_private.pickup_collection_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; collection crest_private.pickup_custody_collections; policy crest_private.pickup_custody_policies;
 audit record; request jsonb; body jsonb; receipt jsonb; projected jsonb; arrived timestamptz;
BEGIN
 SELECT o.state,o.schema_version,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch INTO saved
 FROM crest_private.operations o WHERE o.business_id=business AND o.actor_id=actor
  AND o.operation_id=operation AND o.command_type='operations.pickup_custody.collect';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved'); END IF;
 SELECT * INTO STRICT collection FROM crest_private.pickup_custody_collections
 WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies WHERE business_id=business AND id=collection.policy_id;
 SELECT a.id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action,a.effective_at,a.delta,a.origin,a.import_row_id,a.created_by,a.reason INTO STRICT audit
 FROM crest_private.audit_events a WHERE a.business_id=business AND a.operation_id=operation AND a.entity_kind='pickup_custody_collections';
 request:=saved.result->'request';
 projected:=crest_private.pickup_collection_projection(collection);
 body:=jsonb_build_object('effectiveAt',projected->'effective_at','person',collection.person_snapshot,'location',collection.location_snapshot,
  'notes',collection.notes,'missingPhotoReason',collection.missing_photo_reason,'acknowledgementConfirmed',collection.acknowledgement_confirmed);
 receipt:=jsonb_build_object('collection',projected,'auditId',audit.id);
 arrived:=crest_private.pickup_collection_arrival(business,actor,collection.job_id,collection.job_vehicle_id,collection.pickup_leg_version_id);
 IF saved.schema_version<>1 OR saved.result_schema_version<>1 OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
  OR request IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.collect',
   'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,'jobId',collection.job_id,
   'expectedJobVersion',request->>'expectedJobVersion','jobVehicleId',collection.job_vehicle_id,'pickupLegVersionId',collection.pickup_leg_version_id,
   'policyId',collection.policy_id,'body',body)
  OR coalesce(request->>'expectedJobVersion','')!~'^[1-9][0-9]{0,18}$'
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR crest_private.valid_pickup_collection_body(body,collection.recorded_at) IS NOT TRUE
  OR arrived IS NULL OR collection.effective_at<arrived OR policy.condition_photo_required
  OR collection.acknowledgement_confirmed IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
  OR audit.actor_id<>actor OR audit.created_by<>actor OR audit.entity_id<>collection.id OR audit.entity_version<>1
  OR audit.action<>'create' OR audit.effective_at<>collection.effective_at OR audit.origin<>'manual' OR audit.import_row_id IS NOT NULL OR audit.reason IS NOT NULL
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',projected)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt,'request',request);
END $original$;

CREATE FUNCTION crest_private.pickup_policy_for_job(requested_business uuid,requested_job uuid) RETURNS uuid
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $policy$
 SELECT p.id FROM crest.jobs j JOIN crest_private.pickup_custody_policies p
  ON p.business_id=j.business_id AND p.mode_version_id=j.mode_version_id
 WHERE j.business_id=requested_business AND j.id=requested_job AND j.fulfillment_mode='pickup_return'
$policy$;

CREATE FUNCTION crest_private.check_pickup_collection() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE business uuid:=NEW.business_id; operation uuid:=NEW.operation_id; actor uuid; collection crest_private.pickup_custody_collections;
 expected_version text;
BEGIN
 actor:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'operations' THEN 'actor_id' ELSE 'created_by' END)::uuid;
 IF crest_private.pickup_collection_original(business,actor,operation)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
 SELECT * INTO STRICT collection FROM crest_private.pickup_custody_collections
 WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT o.result->'request'->>'expectedJobVersion' INTO STRICT expected_version
 FROM crest_private.operations o WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor;
 IF NOT EXISTS(SELECT FROM crest.jobs j JOIN crest.fulfillment_mode_versions m ON m.business_id=j.business_id AND m.id=j.mode_version_id
  WHERE j.business_id=business AND j.id=collection.job_id AND j.operator_actor_id=actor AND j.fulfillment_mode='pickup_return'
   AND j.state='scheduled' AND j.version::text=expected_version AND m.pickup_return_enabled
   AND crest_private.pickup_policy_for_job(business,collection.job_id)=collection.policy_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_JOB_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=business
  AND c.vehicle_id=collection.vehicle_id AND c.pickup_collection_id=collection.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_CLAIM_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_commands.collect_pickup_vehicle(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,
 requested_job_vehicle uuid,requested_pickup_leg_version uuid,requested_policy uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $collect$
DECLARE context jsonb; request jsonb; digest text; claim uuid; existing record; booked crest.job_vehicles; job crest.jobs;
 policy crest_private.pickup_custody_policies; collected crest_private.pickup_custody_collections; arrived timestamptz; effective timestamptz;
 audit_id uuid; receipt jsonb; result jsonb; violation text; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_job_vehicle IS NULL
  OR requested_pickup_leg_version IS NULL OR requested_policy IS NULL OR expected_job_version IS NULL OR expected_job_version<1
  OR expected_job_version=9223372036854775807
  OR crest_private.valid_pickup_collection_body(body,clock_timestamp()) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_COLLECTION_INPUT_REQUIRED'; END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.collect','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_job_version::text,'jobVehicleId',requested_job_vehicle,'pickupLegVersionId',requested_pickup_leg_version,
  'policyId',requested_policy,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.collect',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
   WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.pickup_custody.collect'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   SELECT * INTO job FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job FOR SHARE;
   IF NOT FOUND OR job.operator_actor_id<>expected_actor OR job.fulfillment_mode<>'pickup_return' OR job.state<>'scheduled'
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='job'; END IF;
   IF job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='job_version'; END IF;
   SELECT * INTO booked FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.id=requested_job_vehicle AND v.job_id=requested_job;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='vehicle'; END IF;
   SELECT p.* INTO policy FROM crest_private.pickup_custody_policies p
   JOIN crest.fulfillment_mode_versions m ON m.business_id=p.business_id AND m.id=job.mode_version_id
   WHERE p.business_id=requested_business AND p.id=requested_policy AND m.pickup_return_enabled
    AND p.id=crest_private.pickup_policy_for_job(requested_business,requested_job);
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='policy'; END IF;
   IF policy.condition_photo_required THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='photo'; END IF;
   IF (body->>'acknowledgementConfirmed')::boolean IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='acknowledgement'; END IF;
   arrived:=crest_private.pickup_collection_arrival(requested_business,expected_actor,requested_job,requested_job_vehicle,requested_pickup_leg_version);
   effective:=(body->>'effectiveAt')::timestamptz;
   IF arrived IS NULL OR effective<arrived THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='arrival'; END IF;
   INSERT INTO crest_private.pickup_custody_collections(id,business_id,job_id,job_vehicle_id,vehicle_id,pickup_leg_version_id,policy_id,
    effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,acknowledgement_confirmed,created_by,operation_id)
   VALUES(requested_operation,requested_business,requested_job,requested_job_vehicle,booked.vehicle_id,requested_pickup_leg_version,requested_policy,
    effective,body->'person',body->'location',body->>'notes',body->>'missingPhotoReason',(body->>'acknowledgementConfirmed')::boolean,expected_actor,requested_operation)
   RETURNING * INTO collected;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_custody_collections',collected.id,1,'create',effective,
    jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.pickup_collection_projection(collected)),'manual')
   RETURNING id INTO audit_id;
   receipt:=jsonb_build_object('collection',crest_private.pickup_collection_projection(collected),'auditId',audit_id);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.pickup_collection_original(requested_business,expected_actor,requested_operation)-'request';
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1943' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violation=CONSTRAINT_NAME;
  IF violation='custody_cross_mode_vehicle_held' THEN RETURN jsonb_build_object('state','conflict','reason','vehicle_held'); END IF;
  IF violation='pickup_custody_collections_business_id_job_vehicle_id_key'
  THEN RETURN jsonb_build_object('state','conflict','reason','collected'); END IF;
  RAISE;
 END;
END $collect$;
RESET ROLE;

-- Backfill and install these triggers in one coordinator transaction.
INSERT INTO crest_private.vehicle_custody_claims(business_id,vehicle_id,dropoff_case_id)
 SELECT business_id,vehicle_id,id FROM crest.custody_cases WHERE state='held';

GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.project_vehicle_custody_claim() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_collection_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_collection() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_policy_for_job(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_policy_for_job(uuid,uuid) TO crest_booking_owner,crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.project_vehicle_custody_claim(),crest_private.pickup_collection_original(uuid,uuid,uuid),
 crest_private.check_pickup_collection(),crest_private.valid_pickup_collection_body(jsonb,timestamptz),
 crest_private.pickup_collection_projection(crest_private.pickup_custody_collections),crest_private.pickup_collection_arrival(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_pickup_collection_body(jsonb,timestamptz),
 crest_private.pickup_collection_projection(crest_private.pickup_custody_collections),crest_private.pickup_collection_arrival(uuid,uuid,uuid,uuid,uuid)
 TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_collection_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_trip_original(uuid,uuid,uuid) TO crest_booking_integrity_owner;

CREATE TRIGGER dropoff_project_vehicle_claim AFTER INSERT OR UPDATE ON crest.custody_cases
 FOR EACH ROW EXECUTE FUNCTION crest_private.project_vehicle_custody_claim();
CREATE TRIGGER pickup_project_vehicle_claim AFTER INSERT ON crest_private.pickup_custody_collections
 FOR EACH ROW EXECUTE FUNCTION crest_private.project_vehicle_custody_claim();
CREATE CONSTRAINT TRIGGER verify_pickup_collection_row AFTER INSERT ON crest_private.pickup_custody_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_collection();
CREATE CONSTRAINT TRIGGER verify_pickup_collection_operation AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.collect')
 EXECUTE FUNCTION crest_private.check_pickup_collection();

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb) TO crest_web;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_pickup_collection(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_job_vehicle uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; job crest.jobs; policy crest_private.pickup_custody_policies; saved crest_private.pickup_custody_collections; vehicle uuid;
 arrival crest.travel_legs; arrived timestamptz; verified jsonb; status text; result jsonb;
BEGIN
 IF requested_job IS NULL OR requested_job_vehicle IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_COLLECTION_READ_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id','',true);
 SELECT j.* INTO job FROM crest.jobs j JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id
 WHERE j.business_id=requested_business AND j.id=requested_job AND v.id=requested_job_vehicle
  AND j.fulfillment_mode='pickup_return' AND j.operator_actor_id=expected_actor;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT v.vehicle_id INTO STRICT vehicle FROM crest.job_vehicles v WHERE v.business_id=requested_business
  AND v.job_id=requested_job AND v.id=requested_job_vehicle;
 SELECT * INTO saved FROM crest_private.pickup_custody_collections
 WHERE business_id=requested_business AND job_id=requested_job AND job_vehicle_id=requested_job_vehicle;
 IF FOUND THEN
  SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies WHERE business_id=requested_business AND id=saved.policy_id;
  verified:=crest_private.pickup_collection_original(requested_business,expected_actor,saved.operation_id);
  IF verified->>'state' IS DISTINCT FROM 'committed'
   OR NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business
    AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  status:=CASE WHEN job.state='cancelled' THEN 'return_required' ELSE 'held' END;
 ELSE
  SELECT * INTO policy FROM crest_private.pickup_custody_policies
  WHERE business_id=requested_business AND id=crest_private.pickup_policy_for_job(requested_business,requested_job);
  SELECT l.* INTO arrival FROM crest.travel_legs l JOIN crest_private.operations o
   ON o.business_id=l.business_id AND o.operation_id=l.operation_id AND o.actor_id=l.created_by
  WHERE l.business_id=requested_business AND l.job_context_id=requested_job AND l.operator_actor_id=expected_actor
   AND l.purpose='pickup' AND l.change_kind='arrive' AND l.state='closed' AND o.command_type='operations.pickup_trip.record'
   AND (o.result->'receipt'->'jobVehicleIds') ? requested_job_vehicle::text
  ORDER BY l.arrived_at DESC,l.id DESC LIMIT 1;
  IF arrival.id IS NOT NULL THEN
   arrived:=crest_private.pickup_collection_arrival(requested_business,expected_actor,requested_job,requested_job_vehicle,arrival.id);
   IF arrived IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  END IF;
  status:=CASE WHEN job.state<>'scheduled' THEN 'closed' WHEN arrived IS NULL THEN 'awaiting_arrival'
   WHEN policy.id IS NULL THEN 'requires_policy' WHEN policy.condition_photo_required THEN 'photo_required'
   WHEN EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business AND c.vehicle_id=vehicle)
    THEN 'vehicle_held' ELSE 'ready' END;
 END IF;
 result:=jsonb_build_object('schemaVersion',1,'state',status,'businessId',requested_business,'jobId',requested_job,
  'jobVehicleId',requested_job_vehicle,'jobVersion',job.version::text,
  'policy',CASE WHEN policy.id IS NOT NULL THEN jsonb_build_object('id',policy.id,'conditionPhotoRequired',policy.condition_photo_required,
    'acknowledgementText',policy.acknowledgement_text) END,
  'arrival',CASE WHEN arrived IS NOT NULL THEN jsonb_build_object('versionId',arrival.id,
    'arrivedAt',to_char(arrived AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END,
  'collection',verified->'receipt'->'collection');
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_web;

DO $conflict$
DECLARE definition text; marker constant text:='violated_constraint=''custody_one_held_case_per_vehicle''';
BEGIN
 definition:=pg_get_functiondef('crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)'::regprocedure);
 IF (length(definition)-length(replace(definition,marker,'')))<>length(marker)
 THEN RAISE EXCEPTION 'CREST_DROPOFF_CLAIM_EXTENSION_REQUIRED'; END IF;
 EXECUTE replace(definition,marker,'violated_constraint IN (''custody_one_held_case_per_vehicle'',''custody_cross_mode_vehicle_held'')');
END $conflict$;
