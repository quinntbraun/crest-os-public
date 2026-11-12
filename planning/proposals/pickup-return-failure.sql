-- Held BR08 follow-up after pickup-custody-release.sql.
-- A failed handoff closes only the arrival's eligibility for this vehicle.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.pickup_return_failures(
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 return_leg_version_id uuid NOT NULL,
 job_version bigint NOT NULL CHECK(job_version BETWEEN 1 AND 9223372036854775806),
 reason text NOT NULL CHECK(length(reason)>=1 AND length(reason)<=1000 AND btrim(reason)=reason),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL CHECK(operation_id=id),
 UNIQUE(business_id,collection_id,return_leg_version_id),
 FOREIGN KEY(business_id,collection_id) REFERENCES crest_private.pickup_custody_collections(business_id,id),
 FOREIGN KEY(business_id,return_leg_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest_private.pickup_return_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_return_failures FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_return_failure BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_return_failures
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_return_failures TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_return_failures TO crest_booking_integrity_owner;
CREATE POLICY pickup_failure_read ON crest_private.pickup_return_failures FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_failure_write ON crest_private.pickup_return_failures FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_failure_integrity ON crest_private.pickup_return_failures FOR SELECT TO crest_booking_integrity_owner USING(true);

ALTER POLICY pickup_release_operation_read ON crest_private.operations USING(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return')
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
ALTER POLICY pickup_release_operation_create ON crest_private.operations WITH CHECK(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return')
 AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
ALTER POLICY pickup_release_operation_finish ON crest_private.operations USING(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return') AND state='pending'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
) WITH CHECK(
 command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return') AND state='committed'
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
ALTER POLICY pickup_release_operation_integrity ON crest_private.operations
 USING(command_type IN('operations.pickup_custody.release','operations.pickup_custody.fail_return'));
ALTER POLICY pickup_release_audit_write ON crest_private.audit_events WITH CHECK(
 entity_kind IN('pickup_custody_releases','pickup_return_failures') AND origin='manual' AND import_row_id IS NULL
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id);
ALTER POLICY pickup_release_audit_read ON crest_private.audit_events USING(
 entity_kind IN('pickup_custody_releases','pickup_return_failures')
 AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
ALTER POLICY pickup_release_audit_integrity ON crest_private.audit_events
 USING(entity_kind IN('pickup_custody_releases','pickup_return_failures'));

CREATE FUNCTION crest_private.pickup_return_failure_image(failure crest_private.pickup_return_failures)
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $image$
 SELECT to_jsonb(failure)||jsonb_build_object('job_version',failure.job_version::text,
  'recorded_at',to_char(failure.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$image$;

CREATE FUNCTION crest_private.pickup_return_failure_original(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; failed crest_private.pickup_return_failures; collected crest_private.pickup_custody_collections;
 audit record; arrived timestamptz; image jsonb; request jsonb; receipt jsonb;
BEGIN
 SELECT o.state,o.schema_version,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch,o.created_at INTO saved
 FROM crest_private.operations o WHERE (o.business_id,o.actor_id,o.operation_id)=(business,actor,operation)
  AND o.command_type='operations.pickup_custody.fail_return';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved'); END IF;
 SELECT * INTO STRICT failed FROM crest_private.pickup_return_failures f
 WHERE (f.business_id,f.operation_id,f.created_by)=(business,operation,actor);
 SELECT * INTO STRICT collected FROM crest_private.pickup_custody_collections c
 WHERE (c.business_id,c.id)=(business,failed.collection_id);
 SELECT a.id,a.actor_id,a.created_by,a.entity_id,a.entity_version,a.action,a.effective_at,a.delta,a.origin,a.import_row_id,a.reason
 INTO STRICT audit FROM crest_private.audit_events a
 WHERE (a.business_id,a.operation_id,a.entity_kind)=(business,operation,'pickup_return_failures');
 arrived:=crest_private.pickup_return_arrival(business,actor,collected.job_id,collected.job_vehicle_id,failed.return_leg_version_id);
 image:=crest_private.pickup_return_failure_image(failed);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.fail_return','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,'jobId',collected.job_id,
  'expectedJobVersion',failed.job_version::text,'collectionId',collected.id,'returnLegVersionId',failed.return_leg_version_id,
  'body',jsonb_build_object('reason',failed.reason));
 receipt:=jsonb_build_object('failure',image,'auditId',audit.id);
 IF saved.schema_version<>1 OR saved.result_schema_version<>1
  OR saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR arrived IS NULL OR failed.recorded_at<greatest(arrived,saved.created_at,collected.effective_at)
  OR crest_private.booking_text_required(to_jsonb(failed.reason),1000) IS NOT TRUE
  OR collected.created_by<>actor OR audit.actor_id<>actor OR audit.created_by<>actor OR audit.entity_id<>failed.id OR audit.entity_version<>1
  OR audit.action<>'create' OR audit.effective_at IS DISTINCT FROM failed.recorded_at OR audit.origin<>'manual'
  OR audit.import_row_id IS NOT NULL OR audit.reason IS DISTINCT FROM failed.reason
  OR audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',image)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt,'request',request);
END $original$;

CREATE FUNCTION crest_private.check_pickup_return_failure() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE actor uuid:=(to_jsonb(NEW)->>CASE TG_TABLE_NAME WHEN 'operations' THEN 'actor_id' ELSE 'created_by' END)::uuid;
BEGIN
 IF crest_private.pickup_return_failure_original(NEW.business_id,actor,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_ORIGINAL_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_commands.fail_pickup_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,
 requested_collection uuid,requested_return_leg uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $failure$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; existing record; job crest.jobs;
 collected crest_private.pickup_custody_collections; failed crest_private.pickup_return_failures;
 audit_id uuid; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_collection IS NULL
  OR requested_operation=requested_collection OR requested_return_leg IS NULL
  OR expected_job_version IS NULL OR expected_job_version NOT BETWEEN 1 AND 9223372036854775806
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-'reason'<>'{}'::jsonb
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_FAILURE_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.fail_return','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_job_version::text,'collectionId',requested_collection,'returnLegVersionId',requested_return_leg,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.fail_return',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
   WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.pickup_custody.fail_return'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   SELECT * INTO job FROM crest.jobs j WHERE (j.business_id,j.id)=(requested_business,requested_job) FOR SHARE;
   IF NOT FOUND OR job.operator_actor_id<>expected_actor OR job.fulfillment_mode<>'pickup_return' OR job.state NOT IN('completed','cancelled')
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='job'; END IF;
   IF job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='job_version'; END IF;
   SELECT * INTO collected FROM crest_private.pickup_custody_collections c
   WHERE (c.business_id,c.job_id,c.id,c.created_by)=(requested_business,requested_job,requested_collection,expected_actor);
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='custody'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||collected.job_vehicle_id::text,0));
   IF EXISTS(SELECT FROM crest_private.pickup_custody_releases r WHERE (r.business_id,r.collection_id)=(requested_business,collected.id))
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='released'; END IF;
   IF NOT EXISTS(SELECT FROM crest_private.vehicle_custody_claims c
    WHERE (c.business_id,c.vehicle_id,c.pickup_collection_id)=(requested_business,collected.vehicle_id,collected.id))
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='custody'; END IF;
   IF crest_private.pickup_return_arrival(requested_business,expected_actor,requested_job,collected.job_vehicle_id,requested_return_leg) IS NULL
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='arrival'; END IF;
   IF EXISTS(SELECT FROM crest_private.pickup_return_failures f WHERE (f.business_id,f.collection_id,f.return_leg_version_id)
    =(requested_business,collected.id,requested_return_leg))
   THEN RAISE EXCEPTION USING ERRCODE='P1952',MESSAGE='failed'; END IF;
   INSERT INTO crest_private.pickup_return_failures(id,business_id,collection_id,return_leg_version_id,job_version,reason,created_by,operation_id)
   VALUES(requested_operation,requested_business,collected.id,requested_return_leg,expected_job_version,body->>'reason',expected_actor,requested_operation)
   RETURNING * INTO failed;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,
    reason,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_return_failures',failed.id,1,'create',
    failed.reason,failed.recorded_at,jsonb_build_object('schemaVersion',1,'before','null'::jsonb,
     'after',crest_private.pickup_return_failure_image(failed)),'manual') RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,
    'request',request,'receipt',jsonb_build_object('failure',crest_private.pickup_return_failure_image(failed),'auditId',audit_id))
   WHERE (business_id,operation_id)=(requested_business,requested_operation);
  END IF;
  result:=crest_private.pickup_return_failure_original(requested_business,expected_actor,requested_operation)-'request';
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1952' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $failure$;

CREATE FUNCTION crest_commands.lookup_pickup_return_failure_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.fail_return'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_RETURN_FAILURE_REFERENCE_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_return_failure_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR reference IS DISTINCT FROM (saved->'request')-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_REFERENCE_REQUIRED'; END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed',
  'receipt',jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.fail_return',
   'businessId',requested_business,'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'collectionId','sourceRecordId',receipt->'failure'->'id','sourceVersion','1',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_private.pickup_return_failure_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_return_failure() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.fail_pickup_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_return_failure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_return_failure_image(crest_private.pickup_return_failures),
 crest_private.pickup_return_failure_original(uuid,uuid,uuid),crest_private.check_pickup_return_failure(),
 crest_commands.fail_pickup_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb),
 crest_commands.lookup_pickup_return_failure_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_failure_image(crest_private.pickup_return_failures) TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_return_failure_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.fail_pickup_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 TO crest_web;

CREATE CONSTRAINT TRIGGER verify_pickup_return_failure AFTER INSERT ON crest_private.pickup_return_failures
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_return_failure();
CREATE CONSTRAINT TRIGGER verify_pickup_return_failure_operation AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.fail_return' AND NEW.state='committed')
 EXECUTE FUNCTION crest_private.check_pickup_return_failure();

-- The current arrival filter is shared by departure eligibility and the trip
-- reader. The original arrival remains authoritative in historical proofs.
DO $eligibility$
DECLARE routine record; source text; marker text; replacement text;
BEGIN
 FOR routine IN SELECT * FROM (VALUES
  ('crest_private.pickup_arrived_vehicles(uuid,uuid,text)',
   $old$AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'$old$,
   $new$AND operation.command_type='operations.pickup_trip.record' AND operation.state='committed'
  AND (travel_purpose<>'return_to_customer' OR NOT EXISTS(
   SELECT FROM crest_private.pickup_return_failures f
   JOIN crest_private.pickup_custody_collections c ON (c.business_id,c.id)=(f.business_id,f.collection_id)
   WHERE f.business_id=leg.business_id AND f.return_leg_version_id=leg.id AND c.job_vehicle_id=target.id::uuid))$new$),
  ('crest_commands.release_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)',
   $old$   SELECT p.* INTO STRICT policy FROM crest_private.pickup_custody_policies p$old$,
   $new$   IF EXISTS(SELECT FROM crest_private.pickup_return_failures f
    WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,collected.id,requested_return_leg))
   THEN RAISE EXCEPTION USING ERRCODE='P1951',MESSAGE='arrival'; END IF;
   SELECT p.* INTO STRICT policy FROM crest_private.pickup_custody_policies p$new$),
  ('crest_commands.reserve_pickup_return_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)',
   $old$ SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;$old$,
   $new$ PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||booked_vehicle::text,0));
 IF EXISTS(SELECT FROM crest_private.pickup_return_failures f
  WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,collected_id,arrival))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_PHOTO_SLOT_UNAVAILABLE'; END IF;
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;$new$)
 ) AS changes(signature,marker,replacement)
 LOOP
  SELECT pg_get_functiondef(to_regprocedure(routine.signature)) INTO STRICT source;
  IF source IS NULL OR length(source)-length(replace(source,routine.marker,''))<>length(routine.marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
  EXECUTE replace(source,routine.marker,routine.replacement);
 END LOOP;

 source:=pg_get_functiondef('crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)'::regprocedure);
 FOR marker,replacement IN SELECT * FROM (VALUES
  ($old$return_arrival crest.travel_legs; return_at timestamptz;$old$,
   $new$return_arrival crest.travel_legs; return_at timestamptz; failure_id uuid; failure jsonb;$new$),
  ($old$  SELECT id INTO release_id FROM crest_private.pickup_custody_releases r$old$,
   $new$  SELECT f.id INTO failure_id FROM crest_private.pickup_return_failures f
  WHERE (f.business_id,f.collection_id)=(requested_business,saved.id) ORDER BY f.recorded_at DESC,f.id DESC LIMIT 1;
  IF failure_id IS NOT NULL THEN
   failure:=crest_private.pickup_return_failure_original(requested_business,expected_actor,failure_id);
   IF failure->>'state' IS DISTINCT FROM 'committed'
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_RETURN_FAILURE_ORIGINAL_REQUIRED'; END IF;
   failure:=failure->'receipt'->'failure';
  END IF;
  SELECT id INTO release_id FROM crest_private.pickup_custody_releases r$new$),
  ($old$    ORDER BY leg.arrived_at DESC,leg.id DESC LIMIT 1;$old$,
   $new$     AND NOT EXISTS(SELECT FROM crest_private.pickup_return_failures f
      WHERE (f.business_id,f.collection_id,f.return_leg_version_id)=(requested_business,saved.id,leg.id))
    ORDER BY leg.arrived_at DESC,leg.id DESC LIMIT 1;$new$),
  ($old$     status:='ready_to_release';
    END IF;$old$,
   $new$     status:='ready_to_release';
    ELSIF failure IS NOT NULL THEN
     status:='return_failed';
    END IF;$new$),
  ($old$'arrivedAt',to_char(return_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ELSE '{}'::jsonb END;$old$,
   $new$'arrivedAt',to_char(return_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) ELSE '{}'::jsonb END
  ||CASE WHEN failure IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('returnFailure',failure) END;$new$)
 ) AS changes(marker,replacement)
 LOOP
  IF length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
  source:=replace(source,marker,replacement);
 END LOOP;
 EXECUTE source;

 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 marker:=$old$IF kind='operations.pickup_custody.release' THEN$old$;
 replacement:=$new$IF kind IN('operations.pickup_custody.release','operations.pickup_custody.fail_return') THEN$new$;
 IF length(source)-length(replace(source,marker,''))<>length(marker)
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,replacement);

 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 marker:=$old$ IF original->>'commandType'='operations.pickup_custody.release' THEN$old$;
 replacement:=$new$ IF original->>'commandType'='operations.pickup_custody.fail_return' THEN
  RETURN crest_commands.lookup_pickup_return_failure_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
 IF original->>'commandType'='operations.pickup_custody.release' THEN$new$;
 IF length(source)-length(replace(source,marker,''))<>length(marker)
 THEN RAISE EXCEPTION 'CREST_PICKUP_RETURN_FAILURE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,replacement);
END $eligibility$;
