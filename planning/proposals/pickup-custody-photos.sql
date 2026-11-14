-- Shared private photo transport with an immutable pickup-specific reservation.
-- The case identifier on a pickup attempt is the planned collection operation.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.pickup_photo_slots (
 business_id uuid NOT NULL,
 photo_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 collection_id uuid NOT NULL,
 arrival_version_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 job_version bigint NOT NULL CHECK(job_version>0 AND job_version<9223372036854775807),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 PRIMARY KEY(business_id,photo_id),
 FOREIGN KEY(business_id,photo_id) REFERENCES crest.custody_photo_attempts(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(business_id,job_id,actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),
 FOREIGN KEY(business_id,arrival_version_id) REFERENCES crest.travel_legs(business_id,id),
 FOREIGN KEY(business_id,policy_id) REFERENCES crest_private.pickup_custody_policies(business_id,id)
);
ALTER TABLE crest_private.pickup_photo_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_photo_slots FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_photo_slot BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_photo_slots
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_photo_slots TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_photo_slots TO crest_booking_integrity_owner;
CREATE POLICY pickup_photo_slot_read ON crest_private.pickup_photo_slots FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_photo_slot_append ON crest_private.pickup_photo_slots FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_photo_slot_integrity ON crest_private.pickup_photo_slots FOR SELECT TO crest_booking_integrity_owner USING(true);

ALTER TABLE crest_private.pickup_custody_collections
 ALTER COLUMN missing_photo_reason DROP NOT NULL,
 ADD COLUMN condition_photo_id uuid,
 ADD FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest.custody_photo_originals(business_id,photo_id),
 ADD FOREIGN KEY(business_id,condition_photo_id) REFERENCES crest_private.pickup_photo_slots(business_id,photo_id),
 ADD UNIQUE(business_id,condition_photo_id),
 ADD CHECK((condition_photo_id IS NULL)<>(missing_photo_reason IS NULL));

CREATE FUNCTION crest_private.lock_custody_photo_slot(
 business uuid,actor uuid,booked_vehicle uuid,custody_case uuid,handoff integer,photo uuid
) RETURNS crest.job_vehicles LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $slot$
DECLARE slot crest_private.pickup_photo_slots; booked crest.job_vehicles; job crest.jobs;
BEGIN
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=business AND s.photo_id=photo AND s.actor_id=actor;
 IF NOT FOUND THEN RETURN crest_private.lock_dropoff_photo_slot(business,actor,booked_vehicle,custody_case,handoff); END IF;
 SELECT v.* INTO booked FROM crest.job_vehicles v WHERE v.business_id=business AND v.id=booked_vehicle;
 SELECT j.* INTO job FROM crest.jobs j WHERE j.business_id=business AND j.id=booked.job_id FOR SHARE;
 IF job.id IS NULL OR job.operator_actor_id IS DISTINCT FROM actor OR job.fulfillment_mode<>'pickup_return' OR job.state<>'scheduled'
  OR (slot.job_id,slot.job_vehicle_id,slot.collection_id,slot.job_version) IS DISTINCT FROM (job.id,booked_vehicle,custody_case,job.version)
  OR handoff IS DISTINCT FROM 1 OR slot.policy_id IS DISTINCT FROM crest_private.pickup_policy_for_job(business,job.id)
  OR crest_private.pickup_collection_arrival(business,actor,job.id,booked_vehicle,slot.arrival_version_id) IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||business::text||':'||booked_vehicle::text,0));
 IF EXISTS(SELECT FROM crest_private.pickup_custody_collections c WHERE c.business_id=business AND c.job_vehicle_id=booked_vehicle)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'; END IF;
 RETURN booked;
END $slot$;

CREATE FUNCTION crest_private.verified_pickup_photo(
 business uuid,actor uuid,photo uuid,collection uuid,job uuid,booked_vehicle uuid,arrival uuid,policy uuid,
 version bigint,epoch uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $photo$
 SELECT EXISTS(SELECT FROM crest_private.pickup_photo_slots s
  JOIN crest.custody_photo_attempts a ON (a.business_id,a.id)=(s.business_id,s.photo_id)
  JOIN crest.custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)
  WHERE (s.business_id,s.actor_id,s.photo_id,s.collection_id,s.job_id,s.job_vehicle_id,s.arrival_version_id,
   s.policy_id,s.job_version,s.recovery_epoch)=(business,actor,photo,collection,job,booked_vehicle,arrival,policy,version,epoch)
   AND (a.actor_id,a.job_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
       =(actor,job,booked_vehicle,collection,1,epoch) AND o.verified_at>=a.reserved_at)
$photo$;

CREATE FUNCTION crest_commands.reserve_pickup_photo(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 photo uuid,booked_vehicle uuid,collection uuid,arrival uuid,policy uuid,expected_job_version bigint,content_type text,size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE authority jsonb; slot crest_private.pickup_photo_slots; requested_job uuid;
BEGIN
 IF photo IS NULL OR booked_vehicle IS NULL OR collection IS NULL OR photo=collection OR arrival IS NULL OR policy IS NULL
  OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version=9223372036854775807
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_PHOTO_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 -- Take the same owner lock as reserve_dropoff_photo, before either identity can be claimed.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.owner/1:'||requested_business::text||':'||expected_actor::text,0));
 SELECT job_id INTO requested_job FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.id=booked_vehicle;
 SELECT * INTO slot FROM crest_private.pickup_photo_slots s WHERE s.business_id=requested_business AND s.photo_id=photo;
 IF slot.photo_id IS NOT NULL THEN
  IF (slot.job_vehicle_id,slot.collection_id,slot.arrival_version_id,slot.policy_id,slot.job_version,slot.recovery_epoch)
   IS DISTINCT FROM (booked_vehicle,collection,arrival,policy,expected_job_version,expected_epoch)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_RESERVATION_CHANGED'; END IF;
 ELSE
  IF requested_job IS NULL OR EXISTS(SELECT FROM crest.custody_photo_attempts a WHERE a.business_id=requested_business AND a.id=photo)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_SLOT_UNAVAILABLE'; END IF;
  INSERT INTO crest_private.pickup_photo_slots(business_id,photo_id,job_id,job_vehicle_id,collection_id,arrival_version_id,policy_id,
   job_version,actor_id,recovery_epoch)
  VALUES(requested_business,photo,requested_job,booked_vehicle,collection,arrival,policy,expected_job_version,expected_actor,expected_epoch);
 END IF;
 RETURN crest_commands.reserve_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,$9,photo,booked_vehicle,collection,1,content_type,size);
END $reserve$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_booking_owner,crest_booking_integrity_owner;
ALTER FUNCTION crest_private.lock_custody_photo_slot(uuid,uuid,uuid,uuid,integer,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.verified_pickup_photo(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.reserve_pickup_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_booking_owner,crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.lock_custody_photo_slot(uuid,uuid,uuid,uuid,integer,uuid),
 crest_private.verified_pickup_photo(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid),
 crest_commands.reserve_pickup_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_private.verified_pickup_photo(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_pickup_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)
 TO crest_web;

CREATE OR REPLACE FUNCTION crest_private.valid_pickup_collection_body(body jsonb,recorded timestamptz) RETURNS boolean
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(jsonb_typeof(body)='object'
  AND body ?& ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed']
  AND body-ARRAY['effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed','conditionPhotoId']='{}'::jsonb
  AND octet_length(body::text)<=16384
  AND crest_private.valid_support_instant(body->'effectiveAt',recorded)
  AND jsonb_typeof(body->'person')='object' AND (body->'person')-ARRAY['schemaVersion','displayName']='{}'::jsonb
  AND body->'person'->'schemaVersion'='1'::jsonb AND crest_private.booking_text_required(body->'person'->'displayName',200)
  AND crest_private.valid_support_location(body->'location')
  AND (body->'notes'='null'::jsonb OR crest_private.booking_text_required(body->'notes',1000))
  AND (CASE WHEN body ? 'conditionPhotoId' THEN body->'missingPhotoReason'='null'::jsonb
        AND crest_private.original_operation_uuid(body->'conditionPhotoId') IS TRUE
       ELSE crest_private.booking_text_required(body->'missingPhotoReason',1000) END)
  AND body->'acknowledgementConfirmed' IN ('null'::jsonb,'true'::jsonb),false)
$valid$;

CREATE OR REPLACE FUNCTION crest_private.pickup_collection_projection(c crest_private.pickup_custody_collections) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN c.condition_photo_id IS NULL THEN to_jsonb(c)-'condition_photo_id' ELSE to_jsonb(c) END)
  ||jsonb_build_object('effective_at',to_char(c.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'recorded_at',to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

DO $transport$
DECLARE source text; name text; routine text; marker text; replacement text;
BEGIN
 FOR name,routine,marker,replacement IN SELECT * FROM (VALUES
  ('reserve','crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer)',
   'crest_private.lock_dropoff_photo_slot(requested_business,expected_actor,booked_vehicle,custody_case,handoff)',
   'crest_private.lock_custody_photo_slot(requested_business,expected_actor,booked_vehicle,custody_case,handoff,photo)'),
  ('upload','crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)',
   'crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version)',
   'crest_private.lock_custody_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.id)'),
  ('publish','crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)',
   'crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version)',
   'crest_private.lock_custody_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.id)'),
  ('read','crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)',
   'SELECT 1 FROM crest.custody_events e WHERE e.business_id=a.business_id AND e.condition_photo_id=a.id))',
   $link$SELECT 1 FROM crest.custody_events e WHERE e.business_id=a.business_id AND e.condition_photo_id=a.id
    UNION ALL SELECT 1 FROM crest_private.pickup_custody_collections c
      WHERE c.business_id=a.business_id AND c.id=a.case_id AND c.job_id=a.job_id AND c.job_vehicle_id=a.job_vehicle_id
       AND c.condition_photo_id=a.id))$link$),
  ('original access','crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)',
   ' IF handoff_id IS NULL THEN RAISE EXCEPTION',
   $access$ IF handoff_id IS NULL THEN
  SELECT c.id INTO handoff_id FROM crest_private.pickup_custody_collections c
  WHERE c.business_id=requested_business AND c.id=custody_case AND c.condition_photo_id=photo
   AND c.job_vehicle_id=booked_vehicle AND c.job_id=(current_record->'reservation'->>'job_id')::uuid;
 END IF;
 IF handoff_id IS NULL THEN RAISE EXCEPTION$access$),
  ('reservation audit','crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals)',
   ' after_row:=CASE WHEN publication THEN snapshot',
   $audit$ snapshot:=snapshot||coalesce((SELECT jsonb_build_object('pickup',jsonb_build_object('arrivalVersionId',s.arrival_version_id,
   'policyId',s.policy_id,'jobVersion',s.job_version::text)) FROM crest_private.pickup_photo_slots s
   WHERE s.business_id=a.business_id AND s.photo_id=a.id),'{}'::jsonb);
 after_row:=CASE WHEN publication THEN snapshot$audit$)
 ) AS commands(name,routine,marker,replacement)
 LOOP
  source:=pg_get_functiondef(to_regprocedure(routine));
  IF source IS NULL OR length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_PHOTO_TRANSPORT_REVIEW_REQUIRED: %',name; END IF;
  EXECUTE replace(source,marker,replacement);
 END LOOP;
END $transport$;

DO $collection$
DECLARE source text; routine text; marker text; replacement text; current_routine text;
BEGIN
 FOR routine,marker,replacement IN SELECT * FROM (VALUES
  ('crest_private.pickup_collection_original(uuid,uuid,uuid)',
   ' receipt:=jsonb_build_object(''collection'',projected',
   $body$ IF collection.condition_photo_id IS NOT NULL THEN
  body:=body||jsonb_build_object('conditionPhotoId',collection.condition_photo_id);
 END IF;
 receipt:=jsonb_build_object('collection',projected$body$),
  ('crest_private.pickup_collection_original(uuid,uuid,uuid)',
   'OR arrived IS NULL OR collection.effective_at<arrived OR policy.condition_photo_required',
   $body$OR arrived IS NULL OR collection.effective_at<arrived
  OR (policy.condition_photo_required AND collection.condition_photo_id IS NULL)
  OR (collection.condition_photo_id IS NOT NULL AND NOT crest_private.verified_pickup_photo(
   business,actor,collection.condition_photo_id,collection.id,collection.job_id,collection.job_vehicle_id,
   collection.pickup_leg_version_id,collection.policy_id,(request->>'expectedJobVersion')::bigint,saved.recovery_epoch))$body$),
  ('crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
   '   IF policy.condition_photo_required THEN RAISE EXCEPTION USING ERRCODE=''P1943'',MESSAGE=''photo''; END IF;',
   $body$   PERFORM pg_advisory_xact_lock(hashtextextended('crest.pickup.custody/1:'||requested_business::text||':'||requested_job_vehicle::text,0));
   IF (policy.condition_photo_required AND NOT body ? 'conditionPhotoId') OR (body ? 'conditionPhotoId'
    AND NOT crest_private.verified_pickup_photo(requested_business,expected_actor,(body->>'conditionPhotoId')::uuid,
     requested_operation,requested_job,requested_job_vehicle,requested_pickup_leg_version,requested_policy,expected_job_version,expected_epoch))
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='photo'; END IF;$body$),
  ('crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
   'effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,acknowledgement_confirmed,created_by,operation_id)',
   'effective_at,person_snapshot,location_snapshot,notes,missing_photo_reason,condition_photo_id,acknowledgement_confirmed,created_by,operation_id)'),
  ('crest_commands.collect_pickup_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)',
   'body->>''missingPhotoReason'',(body->>''acknowledgementConfirmed'')::boolean',
   'body->>''missingPhotoReason'',(body->>''conditionPhotoId'')::uuid,(body->>''acknowledgementConfirmed'')::boolean'),
  ('crest_commands.read_pickup_collection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)',
   $state$WHEN policy.id IS NULL THEN 'requires_policy' WHEN policy.condition_photo_required THEN 'photo_required'
   WHEN EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business AND c.vehicle_id=vehicle)
    THEN 'vehicle_held' ELSE 'ready' END;$state$,
   $state$WHEN policy.id IS NULL THEN 'requires_policy'
   WHEN EXISTS(SELECT FROM crest_private.vehicle_custody_claims c WHERE c.business_id=requested_business AND c.vehicle_id=vehicle)
    THEN 'vehicle_held' WHEN policy.condition_photo_required THEN 'photo_required' ELSE 'ready' END;$state$)
 ) AS changes(routine,marker,replacement)
 LOOP
  IF current_routine IS DISTINCT FROM routine THEN
   IF current_routine IS NOT NULL THEN EXECUTE source; END IF;
   source:=pg_get_functiondef(to_regprocedure(routine));current_routine:=routine;
  END IF;
  IF source IS NULL OR length(source)-length(replace(source,marker,''))<>length(marker)
  THEN RAISE EXCEPTION 'CREST_PICKUP_PHOTO_COLLECTION_REVIEW_REQUIRED: %',routine; END IF;
  source:=replace(source,marker,replacement);
 END LOOP;
 IF current_routine IS NOT NULL THEN EXECUTE source; END IF;
END $collection$;

-- The same closed verifier used by collection receipts also parses the photo id.
GRANT EXECUTE ON FUNCTION crest_private.original_operation_uuid(jsonb) TO crest_booking_integrity_owner;

CREATE FUNCTION crest_private.check_pickup_photo_reservation() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.custody_photo_attempts a
  WHERE (a.business_id,a.id,a.actor_id,a.job_id,a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
   =(NEW.business_id,NEW.photo_id,NEW.actor_id,NEW.job_id,NEW.job_vehicle_id,NEW.collection_id,1,NEW.recovery_epoch))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_PHOTO_RESERVATION_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_photo_reservation() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_pickup_photo_reservation() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER verify_pickup_photo_reservation AFTER INSERT ON crest_private.pickup_photo_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_photo_reservation();
