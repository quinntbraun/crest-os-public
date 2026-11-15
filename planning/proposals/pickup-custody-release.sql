-- Held BR08 pickup return handoff. A trip arrival leaves custody open.
-- The immutable handoff is the only pickup operation that releases its claim.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest_private.pickup_custody_collections
 ADD CONSTRAINT pickup_collection_release_identity UNIQUE(business_id,id,job_id,job_vehicle_id,vehicle_id,policy_id);

ALTER TABLE crest_private.pickup_photo_slots
 ADD COLUMN return_collection_id uuid,
 ADD FOREIGN KEY(business_id,return_collection_id) REFERENCES crest_private.pickup_custody_collections(business_id,id),
 ADD CHECK(return_collection_id IS NULL OR return_collection_id<>collection_id);

CREATE TABLE crest_private.pickup_custody_releases(
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 return_leg_version_id uuid NOT NULL,
 job_version bigint NOT NULL CHECK (job_version BETWEEN 1 AND 9223372036854775806),
 effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at) AND effective_at<=recorded_at),
 person_snapshot jsonb NOT NULL CHECK(jsonb_typeof(person_snapshot)='object'),
 location_snapshot jsonb NOT NULL CHECK(jsonb_typeof(location_snapshot)='object'),
 notes text,
 missing_photo_reason text,
 condition_photo_id uuid,
 acknowledgement_confirmed boolean CHECK(acknowledgement_confirmed IS TRUE OR acknowledgement_confirmed IS NULL),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL CHECK(operation_id=id),
 UNIQUE(business_id,collection_id), UNIQUE(business_id,condition_photo_id),
 CHECK((condition_photo_id IS NULL)<>(missing_photo_reason IS NULL)),
 FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest_private.pickup_photo_slots(business_id,photo_id),
 FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest.custody_photo_originals(business_id,photo_id),
 FOREIGN KEY(business_id,collection_id,job_id,job_vehicle_id,vehicle_id,policy_id)
  REFERENCES crest_private.pickup_custody_collections(business_id,id,job_id,job_vehicle_id,vehicle_id,policy_id),
 FOREIGN KEY(business_id,return_leg_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

ALTER TABLE crest_private.pickup_custody_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_custody_releases FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_release BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_custody_releases
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_custody_releases TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_custody_releases TO crest_booking_integrity_owner;
CREATE POLICY pickup_release_read ON crest_private.pickup_custody_releases FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_release_create ON crest_private.pickup_custody_releases FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_release_integrity ON crest_private.pickup_custody_releases FOR SELECT TO crest_booking_integrity_owner USING(true);

CREATE POLICY pickup_release_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(
 command_type='operations.pickup_custody.release'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_release_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(
 command_type='operations.pickup_custody.release' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY pickup_release_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(
 command_type='operations.pickup_custody.release' AND state='pending'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
) WITH CHECK(
 command_type='operations.pickup_custody.release' AND state='committed'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_release_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.pickup_custody.release');
CREATE POLICY pickup_release_audit_write ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(
 entity_kind='pickup_custody_releases' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
CREATE POLICY pickup_release_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(
 entity_kind='pickup_custody_releases' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_release_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='pickup_custody_releases');

CREATE FUNCTION crest_private.pickup_return_arrival(business uuid,actor uuid,job uuid,target uuid,leg_version uuid)
 RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $arrival$
DECLARE arrival crest.travel_legs; saved jsonb;
BEGIN
 SELECT * INTO arrival FROM crest.travel_legs leg
 WHERE leg.business_id=business AND leg.id=leg_version AND leg.job_context_id=job AND leg.operator_actor_id=actor
  AND leg.purpose='return_to_customer' AND leg.state='closed' AND leg.change_kind='arrive';
 IF NOT FOUND THEN RETURN NULL; END IF;
 saved:=crest_private.pickup_trip_original(business,actor,arrival.operation_id);
 IF saved->>'state' IS DISTINCT FROM 'committed' OR saved->'receipt'->'leg'->>'id' IS DISTINCT FROM leg_version::text
  OR NOT coalesce((saved->'receipt'->'jobVehicleIds') ? target::text,false)
 THEN RETURN NULL; END IF;
 RETURN arrival.arrived_at;
END $arrival$;

CREATE FUNCTION crest_private.pickup_release_projection(released crest_private.pickup_custody_releases)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN released.condition_photo_id IS NULL THEN to_jsonb(released)-'condition_photo_id' ELSE to_jsonb(released) END)
  ||jsonb_build_object('job_version',released.job_version::text,
  'effective_at',to_char(released.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(released.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

CREATE FUNCTION crest_private.verified_pickup_return_photo(
 business uuid,actor uuid,photo uuid,release_id uuid,collected_id uuid,arrival uuid,version bigint,epoch uuid,recorded timestamptz
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $photo$
 SELECT EXISTS(SELECT FROM crest_private.pickup_photo_slots s
  JOIN crest_private.pickup_custody_collections c ON (c.business_id,c.id)=(s.business_id,s.return_collection_id)
  JOIN crest.custody_photo_attempts a ON (a.business_id,a.id)=(s.business_id,s.photo_id)
  JOIN crest.custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)
  WHERE (s.business_id,s.actor_id,s.photo_id,s.collection_id,s.return_collection_id,s.arrival_version_id,
   s.job_version,s.recovery_epoch)=(business,actor,photo,release_id,collected_id,arrival,version,epoch)
   AND (s.job_id,s.job_vehicle_id,s.policy_id)=(c.job_id,c.job_vehicle_id,c.policy_id)
   AND (a.actor_id,a.job_id,a.job_vehicle_id,a.vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
       =(actor,c.job_id,c.job_vehicle_id,c.vehicle_id,release_id,2,epoch)
   AND o.verified_at BETWEEN a.reserved_at AND recorded)
$photo$;

CREATE FUNCTION crest_private.pickup_release_original(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; released crest_private.pickup_custody_releases; collected crest_private.pickup_custody_collections;
 policy crest_private.pickup_custody_policies; audit record; image jsonb; request jsonb; body jsonb; receipt jsonb; arrived timestamptz;
BEGIN
 SELECT o.state,o.schema_version,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch,o.created_at INTO saved
 FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.pickup_custody.release';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved'); END IF;
 SELECT * INTO STRICT released FROM crest_private.pickup_custody_releases r
 WHERE r.business_id=business AND r.operation_id=operation AND r.created_by=actor;
 SELECT * INTO STRICT collected FROM crest_private.pickup_custody_collections c
 WHERE c.business_id=business AND c.id=released.collection_id;
 SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies p WHERE p.business_id=business AND p.id=released.policy_id;
 SELECT a.id,a.actor_id,a.created_by,a.entity_id,a.entity_version,a.action,a.effective_at,a.delta,a.origin,a.import_row_id,a.reason
 INTO STRICT audit FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.operation_id=operation AND a.entity_kind='pickup_custody_releases';
 image:=crest_private.pickup_release_projection(released);
 body:=jsonb_build_object('effectiveAt',image->'effective_at','person',released.person_snapshot,'location',released.location_snapshot,
  'notes',released.notes,'missingPhotoReason',released.missing_photo_reason,'acknowledgementConfirmed',released.acknowledgement_confirmed)
  ||CASE WHEN released.condition_photo_id IS NOT NULL THEN jsonb_build_object('conditionPhotoId',released.condition_photo_id) ELSE '{}'::jsonb END;
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.release','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,'jobId',released.job_id,
  'expectedJobVersion',released.job_version::text,'collectionId',released.collection_id,
  'returnLegVersionId',released.return_leg_version_id,'body',body);
 receipt:=jsonb_build_object('release',image,'auditId',audit.id);
 arrived:=crest_private.pickup_return_arrival(business,actor,released.job_id,released.job_vehicle_id,released.return_leg_version_id);
 IF saved.schema_version<>1 OR saved.result_schema_version<>1
  OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR released.recorded_at<saved.created_at OR released.effective_at<collected.effective_at
  OR crest_private.valid_pickup_collection_body(body,released.recorded_at) IS NOT TRUE
  OR arrived IS NULL OR released.effective_at<arrived OR policy.condition_photo_required AND released.condition_photo_id IS NULL
  OR released.condition_photo_id IS NOT NULL AND NOT crest_private.verified_pickup_return_photo(business,actor,released.condition_photo_id,
   released.id,released.collection_id,released.return_leg_version_id,released.job_version,saved.recovery_epoch,released.recorded_at)
  OR released.acknowledgement_confirmed IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
  OR audit.actor_id<>actor OR audit.created_by<>actor OR audit.entity_id<>released.id OR audit.entity_version<>1
  OR audit.action<>'create' OR audit.effective_at<>released.effective_at OR audit.origin<>'manual'
  OR audit.import_row_id IS NOT NULL OR audit.reason IS NOT NULL
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',image)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt,'request',request);
END $original$;

CREATE FUNCTION crest_private.project_pickup_release() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $project$
BEGIN
 DELETE FROM crest_private.vehicle_custody_claims claim
 WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(NEW.business_id,NEW.vehicle_id,NEW.collection_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_CLAIM_REQUIRED'; END IF;
 RETURN NEW;
END $project$;

CREATE FUNCTION crest_private.check_pickup_release() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE business uuid:=NEW.business_id; operation uuid:=NEW.operation_id; actor uuid;
 released crest_private.pickup_custody_releases;
BEGIN
 actor:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'operations' THEN 'actor_id' ELSE 'created_by' END)::uuid;
 IF crest_private.pickup_release_original(business,actor,operation)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ORIGINAL_REQUIRED'; END IF;
 SELECT * INTO STRICT released FROM crest_private.pickup_custody_releases r
 WHERE r.business_id=business AND r.operation_id=operation AND r.created_by=actor;
 IF NOT EXISTS(SELECT FROM crest.jobs job JOIN crest.fulfillment_mode_versions mode
  ON (mode.business_id,mode.id)=(job.business_id,job.mode_version_id)
  WHERE job.business_id=business AND job.id=released.job_id AND job.operator_actor_id=actor
   AND job.fulfillment_mode='pickup_return' AND mode.pickup_return_enabled AND job.version=released.job_version
   AND job.state IN('completed','cancelled') AND released.policy_id=crest_private.pickup_policy_for_job(business,job.id))
 OR EXISTS(SELECT FROM crest_private.vehicle_custody_claims claim
  WHERE (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(business,released.vehicle_id,released.collection_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_JOB_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_commands.release_pickup_vehicle(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,
 requested_collection uuid,requested_return_leg uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $release$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; existing record; job crest.jobs;
 collected crest_private.pickup_custody_collections; policy crest_private.pickup_custody_policies;
 released crest_private.pickup_custody_releases; effective timestamptz; arrived timestamptz; audit_id uuid; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_collection IS NULL
  OR requested_return_leg IS NULL OR expected_job_version IS NULL OR expected_job_version NOT BETWEEN 1 AND 9223372036854775806
  OR crest_private.valid_pickup_collection_body(body,clock_timestamp()) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RELEASE_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.release','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_job_version::text,'collectionId',requested_collection,'returnLegVersionId',requested_return_leg,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.release',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
   WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.pickup_custody.release'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   SELECT * INTO job FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job FOR SHARE;
   IF NOT FOUND OR job.operator_actor_id<>expected_actor OR job.fulfillment_mode<>'pickup_return' OR job.state NOT IN('completed','cancelled')
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='job'; END IF;
   IF job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='job_version'; END IF;
   SELECT * INTO collected FROM crest_private.pickup_custody_collections c
   WHERE c.business_id=requested_business AND c.job_id=requested_job AND c.id=requested_collection;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='custody'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||collected.job_vehicle_id::text,0));
   IF EXISTS(SELECT FROM crest_private.pickup_custody_releases r WHERE r.business_id=requested_business AND r.collection_id=collected.id)
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='released'; END IF;
   IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c
    WHERE (c.business_id,c.vehicle_id,c.pickup_collection_id)=(requested_business,collected.vehicle_id,collected.id))
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='custody'; END IF;
   SELECT p.* INTO STRICT policy FROM crest_private.pickup_custody_policies p
   WHERE p.business_id=requested_business AND p.id=collected.policy_id;
   IF policy.condition_photo_required AND NOT body ? 'conditionPhotoId'
    OR body ? 'conditionPhotoId' AND NOT crest_private.verified_pickup_return_photo(requested_business,expected_actor,
     (body->>'conditionPhotoId')::uuid,requested_operation,collected.id,requested_return_leg,expected_job_version,expected_epoch,clock_timestamp())
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='photo'; END IF;
   IF (body->>'acknowledgementConfirmed')::boolean IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NOT NULL THEN true END)
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='acknowledgement'; END IF;
   arrived:=crest_private.pickup_return_arrival(requested_business,expected_actor,requested_job,collected.job_vehicle_id,requested_return_leg);
   effective:=(body->>'effectiveAt')::timestamptz;
   IF arrived IS NULL OR effective<arrived OR effective<collected.effective_at
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='arrival'; END IF;
   INSERT INTO crest_private.pickup_custody_releases(id,business_id,collection_id,job_id,job_vehicle_id,vehicle_id,policy_id,
    return_leg_version_id,job_version,effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,condition_photo_id,
    acknowledgement_confirmed,created_by,operation_id)
   VALUES(requested_operation,requested_business,collected.id,requested_job,collected.job_vehicle_id,collected.vehicle_id,collected.policy_id,
    requested_return_leg,expected_job_version,effective,body->'person',body->'location',body->>'notes',body->>'missingPhotoReason',
    (body->>'conditionPhotoId')::uuid,(body->>'acknowledgementConfirmed')::boolean,expected_actor,requested_operation) RETURNING * INTO released;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_custody_releases',released.id,1,'create',effective,
    jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.pickup_release_projection(released)),'manual')
   RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',
     jsonb_build_object('release',crest_private.pickup_release_projection(released),'auditId',audit_id))
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.pickup_release_original(requested_business,expected_actor,requested_operation)-'request';
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1951' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $release$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_private.verified_pickup_return_photo(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,timestamptz) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_release_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.project_pickup_release() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_release() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_return_arrival(uuid,uuid,uuid,uuid,uuid),
 crest_private.pickup_release_projection(crest_private.pickup_custody_releases),
 crest_private.verified_pickup_return_photo(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,timestamptz),
 crest_private.pickup_release_original(uuid,uuid,uuid),crest_private.project_pickup_release(),crest_private.check_pickup_release(),
 crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_arrival(uuid,uuid,uuid,uuid,uuid),
 crest_private.pickup_release_projection(crest_private.pickup_custody_releases) TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_release_original(uuid,uuid,uuid),
 crest_private.verified_pickup_return_photo(uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,timestamptz) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 TO crest_web;

CREATE TRIGGER pickup_release_project_claim AFTER INSERT ON crest_private.pickup_custody_releases
 FOR EACH ROW EXECUTE FUNCTION crest_private.project_pickup_release();
CREATE CONSTRAINT TRIGGER verify_pickup_release_row AFTER INSERT ON crest_private.pickup_custody_releases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_release();
CREATE CONSTRAINT TRIGGER verify_pickup_release_operation AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.release')
 EXECUTE FUNCTION crest_private.check_pickup_release();

-- Keep the original collection readable after custody ends. The read route
-- already authenticates this job and the exact booked vehicle.
DO $read_release$
DECLARE source text; marker text; replacement text;
BEGIN
 source:=pg_get_functiondef('crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)'::regprocedure);
 FOR marker,replacement IN SELECT * FROM (VALUES
  ($before$verified jsonb; status text; result jsonb;$before$,
   $after$verified jsonb; status text; result jsonb; released jsonb; release_id uuid; return_arrival crest.travel_legs; return_at timestamptz;$after$),
  ($before$  IF verified->>'state' IS DISTINCT FROM 'committed'
   OR NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business
    AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  status:=CASE job.state WHEN 'cancelled' THEN 'return_required' WHEN 'completed' THEN 'awaiting_return' ELSE 'held' END;$before$,
   $after$  IF verified->>'state' IS DISTINCT FROM 'committed'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
  SELECT id INTO release_id FROM crest_private.pickup_custody_releases r
  WHERE r.business_id=requested_business AND r.collection_id=saved.id;
  IF release_id IS NOT NULL THEN
   released:=crest_private.pickup_release_original(requested_business,expected_actor,release_id);
   IF released->>'state' IS DISTINCT FROM 'committed' OR EXISTS(SELECT FROM crest_private.vehicle_custody_claims c
    WHERE c.business_id=requested_business AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ORIGINAL_REQUIRED'; END IF;
   status:='released';
  ELSE
   IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business
    AND c.vehicle_id=vehicle AND c.pickup_collection_id=saved.id)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_COLLECTION_ORIGINAL_REQUIRED'; END IF;
   status:=CASE job.state WHEN 'cancelled' THEN 'return_required' WHEN 'completed' THEN 'awaiting_return' ELSE 'held' END;
   IF status IN('awaiting_return','return_required') THEN
    SELECT leg.* INTO return_arrival FROM crest.travel_legs leg JOIN crest_private.operations op
     ON (op.business_id,op.operation_id,op.actor_id)=(leg.business_id,leg.operation_id,leg.created_by)
    WHERE leg.business_id=requested_business AND leg.job_context_id=requested_job AND leg.operator_actor_id=expected_actor
     AND leg.purpose='return_to_customer' AND leg.state='closed' AND leg.change_kind='arrive'
     AND op.command_type='operations.pickup_trip.record' AND (op.result->'receipt'->'jobVehicleIds') ? requested_job_vehicle::text
    ORDER BY leg.arrived_at DESC,leg.id DESC LIMIT 1;
    IF FOUND THEN
     return_at:=crest_private.pickup_return_arrival(requested_business,expected_actor,requested_job,requested_job_vehicle,return_arrival.id);
     IF return_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_ARRIVAL_REQUIRED'; END IF;
     status:='ready_to_release';
    END IF;
   END IF;
  END IF;$after$),
  ($before$ 'collection',verified->'receipt'->'collection');$before$,
   $after$ 'collection',verified->'receipt'->'collection')
  ||CASE status WHEN 'released' THEN jsonb_build_object('release',released->'receipt'->'release')
   WHEN 'ready_to_release' THEN jsonb_build_object('returnArrival',jsonb_build_object('versionId',return_arrival.id,
    'arrivedAt',to_char(return_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ELSE '{}'::jsonb END;$after$)
 ) AS edits(marker,replacement)
 LOOP
  IF length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RELEASE_READ_REVIEW_REQUIRED'; END IF;
  source:=replace(source,marker,replacement);
 END LOOP;
 EXECUTE source;
END $read_release$;

-- Reservation, relay and publication use the existing condition-photo pipeline.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.reserve_pickup_return_photo(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 photo uuid,booked_vehicle uuid,release_id uuid,collected_id uuid,arrival uuid,expected_job_version bigint,content_type text,size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE authority jsonb; slot crest_private.pickup_photo_slots; collected crest_private.pickup_custody_collections;
BEGIN
 IF photo IS NULL OR booked_vehicle IS NULL OR release_id IS NULL OR collected_id IS NULL OR arrival IS NULL
  OR photo IN (release_id,collected_id) OR release_id=collected_id
  OR expected_job_version IS NULL OR expected_job_version NOT BETWEEN 1 AND 9223372036854775806
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_PHOTO_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.owner/1:'||requested_business::text||':'||expected_actor::text,0));
 SELECT * INTO collected FROM crest_private.pickup_custody_collections c
 WHERE c.business_id=requested_business AND c.id=collected_id AND c.job_vehicle_id=booked_vehicle;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;
 IF FOUND THEN
  IF (slot.job_id,slot.job_vehicle_id,slot.collection_id,slot.return_collection_id,slot.arrival_version_id,slot.policy_id,slot.job_version,slot.recovery_epoch)
   IS DISTINCT FROM (collected.job_id,booked_vehicle,release_id,collected_id,arrival,collected.policy_id,expected_job_version,expected_epoch)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_RESERVATION_CHANGED'; END IF;
 ELSE
  IF EXISTS(SELECT FROM crest.custody_photo_attempts a WHERE a.business_id=requested_business AND a.id=photo)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
  INSERT INTO crest_private.pickup_photo_slots(business_id,photo_id,job_id,job_vehicle_id,collection_id,
   return_collection_id,arrival_version_id,policy_id,job_version,actor_id,recovery_epoch)
  VALUES(requested_business,photo,collected.job_id,booked_vehicle,release_id,collected_id,arrival,collected.policy_id,
   expected_job_version,expected_actor,expected_epoch);
 END IF;
 RETURN crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,photo,booked_vehicle,release_id,2,content_type,size);
END $reserve$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 TO crest_web;

DO $return_photo$
DECLARE entry record; source text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_private.lock_custody_photo_slot(uuid,uuid,uuid,uuid,integer,uuid)',
   $old$ IF job.id IS NULL OR job.operator_actor_id$old$,
   $new$ IF slot.return_collection_id IS NOT NULL THEN
  IF job.id IS NULL OR job.operator_actor_id IS DISTINCT FROM actor OR job.fulfillment_mode<>'pickup_return'
   OR job.state NOT IN('completed','cancelled') OR handoff IS DISTINCT FROM 2
   OR (slot.job_id,slot.job_vehicle_id,slot.collection_id,slot.job_version) IS DISTINCT FROM (job.id,booked_vehicle,custody_case,job.version)
   OR slot.policy_id IS DISTINCT FROM crest_private.pickup_policy_for_job(business,job.id)
   OR crest_private.pickup_return_arrival(business,actor,job.id,booked_vehicle,slot.arrival_version_id) IS NULL
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||business::text||':'||booked_vehicle::text,0));
  IF NOT EXISTS(SELECT FROM crest_private.pickup_custody_collections c
   JOIN crest_private.vehicle_custody_claims claim
     ON (claim.business_id,claim.vehicle_id,claim.pickup_collection_id)=(c.business_id,c.vehicle_id,c.id)
   WHERE (c.business_id,c.id,c.job_id,c.job_vehicle_id,c.policy_id)=(business,slot.return_collection_id,job.id,booked_vehicle,slot.policy_id))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
  RETURN booked;
 END IF;
 IF job.id IS NULL OR job.operator_actor_id$new$),
  ('crest_private.check_pickup_photo_reservation()',
   $old$NEW.collection_id,1,NEW.recovery_epoch)$old$,
   $new$NEW.collection_id,CASE WHEN NEW.return_collection_id IS NULL THEN 1 ELSE 2 END,NEW.recovery_epoch)$new$),
  ('crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
   $old$       AND c.condition_photo_id=a.id))$old$,
   $new$       AND c.condition_photo_id=a.id
    UNION ALL SELECT 1 FROM crest_private.pickup_custody_releases r
      WHERE (r.business_id,r.id,r.job_id,r.job_vehicle_id,r.condition_photo_id)=(a.business_id,a.case_id,a.job_id,a.job_vehicle_id,a.id)
       AND a.handoff_version=2))$new$),
  ('crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)',
   $old$ IF handoff_id IS NULL THEN RAISE EXCEPTION$old$,
   $new$ IF handoff_id IS NULL AND current_record->'reservation'->>'handoff_version'='2' THEN
  SELECT r.id INTO handoff_id FROM crest_private.pickup_custody_releases r
  WHERE r.business_id=requested_business AND r.id=custody_case AND r.condition_photo_id=photo
   AND r.job_vehicle_id=booked_vehicle AND r.job_id=(current_record->'reservation'->>'job_id')::uuid;
 END IF;
 IF handoff_id IS NULL THEN RAISE EXCEPTION$new$),
  ('crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals)',
   $old$'policyId',s.policy_id,'jobVersion',s.job_version::text)) FROM crest_private.pickup_photo_slots s$old$,
   $new$'policyId',s.policy_id,'jobVersion',s.job_version::text)
   ||CASE WHEN s.return_collection_id IS NOT NULL THEN jsonb_build_object('returnCollectionId',s.return_collection_id) ELSE '{}'::jsonb END)
   FROM crest_private.pickup_photo_slots s$new$)
 ) edits(routine,marker,replacement) LOOP
  source:=pg_get_functiondef(to_regprocedure(entry.routine));
  IF source IS NULL OR length(source)-length(replace(source,entry.marker,''))<>length(entry.marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_PHOTO_REVIEW_REQUIRED: %',entry.routine; END IF;
  EXECUTE replace(source,entry.marker,entry.replacement);
 END LOOP;
END $return_photo$;

-- A lost response can recover the verified handoff with opaque identifiers.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_pickup_release_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.release'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RELEASE_REFERENCE_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_release_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR reference IS DISTINCT FROM (saved->'request')-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RELEASE_REFERENCE_REQUIRED'; END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed',
  'receipt',jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.release',
   'businessId',requested_business,'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'collectionId','sourceRecordId',receipt->'release'->'id','sourceVersion','1',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_release_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_pickup_release_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF length(source)-length(replace(source,marker,''))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.release' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_RELEASE_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.pickup_custody.release' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','collectionId','returnLegVersionId'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb
   OR jsonb_typeof(r->'expectedJobVersion') IS DISTINCT FROM 'string'
   OR (r->>'expectedJobVersion')!~'^[1-9][0-9]{0,18}$'
  THEN RETURN false; END IF;
  RETURN coalesce((r->>'expectedJobVersion')::numeric<9223372036854775807
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobId') IS TRUE
   AND crest_private.original_operation_uuid(r->'collectionId') IS TRUE
   AND crest_private.original_operation_uuid(r->'returnLegVersionId') IS TRUE,false);
 END IF;
$case$);
END $reference$;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF length(source)-length(replace(source,marker,''))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.release' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_RELEASE_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.pickup_custody.release' THEN
  RETURN crest_commands.lookup_pickup_release_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
