-- Held Drop-Off photo authority. Apply after the custody policy candidate.
-- The isolated validator's connection alone can submit verified metadata.
CREATE ROLE crest_custody_photo_dispatch NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA crest_commands TO crest_custody_photo_dispatch;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT,INSERT ON crest.custody_photo_attempts,crest.custody_photo_originals TO crest_booking_owner;
CREATE POLICY custody_photo_attempt_owner_read ON crest.custody_photo_attempts FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY custody_photo_attempt_owner_insert ON crest.custody_photo_attempts FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY custody_photo_original_owner_read ON crest.custody_photo_originals FOR SELECT TO crest_booking_owner
 USING(EXISTS(SELECT 1 FROM crest.custody_photo_attempts a WHERE a.business_id=custody_photo_originals.business_id
  AND a.id=custody_photo_originals.photo_id));
CREATE POLICY custody_photo_original_owner_insert ON crest.custody_photo_originals FOR INSERT TO crest_booking_owner
 WITH CHECK(EXISTS(SELECT 1 FROM crest.custody_photo_attempts a WHERE a.business_id=custody_photo_originals.business_id
  AND a.id=custody_photo_originals.photo_id));

CREATE POLICY custody_photo_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish'));
CREATE POLICY custody_photo_operation_insert ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish')
 AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_photo_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish') AND state='committed');
CREATE POLICY custody_photo_audit_insert ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND entity_kind='custody_photos' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;

-- Serialize against job changes and the exact handoff, in the same order as
-- save_dropoff_handoff. No operation can attach a photo to a closed slot.
CREATE FUNCTION crest_private.lock_dropoff_photo_slot(
 business uuid, actor uuid, booked_vehicle uuid, custody_case uuid, handoff integer
) RETURNS crest.job_vehicles LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $slot$
DECLARE booked crest.job_vehicles; job crest.jobs; current_case crest.custody_cases;
BEGIN
 SELECT v.* INTO booked FROM crest.job_vehicles v WHERE v.business_id=business AND v.id=booked_vehicle;
 SELECT j.* INTO job FROM crest.jobs j WHERE j.business_id=business AND j.id=booked.job_id FOR SHARE;
 IF job.id IS NULL OR job.operator_actor_id IS DISTINCT FROM actor OR job.fulfillment_mode<>'dropoff'
  OR (handoff=1 AND job.state<>'scheduled') OR (handoff=2 AND job.state NOT IN('completed','cancelled')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_SLOT_UNAVAILABLE';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.dropoff/1:'||business::text||':'||booked_vehicle::text,0));
 SELECT c.* INTO current_case FROM crest.custody_cases c WHERE c.business_id=business AND c.job_vehicle_id=booked_vehicle;
 IF (handoff=1 AND current_case.id IS NOT NULL)
  OR (handoff=2 AND (current_case.id IS DISTINCT FROM custody_case OR current_case.state<>'held'))
  OR NOT EXISTS(SELECT 1 FROM crest.custody_authorization_configs a WHERE a.business_id=business
    AND (CASE WHEN handoff=1 THEN a.mode_version_id=job.mode_version_id ELSE a.id=current_case.authorization_config_id END)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_SLOT_UNAVAILABLE';
 END IF;
 RETURN booked;
END $slot$;

CREATE FUNCTION crest_private.record_dropoff_photo_change(
 a crest.custody_photo_attempts, o crest.custody_photo_originals
) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $audit$
DECLARE publication boolean:=o.photo_id IS NOT NULL;
 original uuid:=CASE WHEN publication THEN a.dispatch_id ELSE a.id END;
 snapshot jsonb:=jsonb_build_object('photoId',a.id,'jobId',a.job_id,'jobVehicleId',a.job_vehicle_id,
  'caseId',a.case_id,'handoffVersion',a.handoff_version,'declaredType',a.declared_type,'byteSize',a.byte_size);
 after_row jsonb;
BEGIN
 after_row:=CASE WHEN publication THEN snapshot||jsonb_build_object('sha256',o.sha256,
  'previewSha256',o.preview_sha256,'validationVersion',o.validation_version) ELSE snapshot END;
 PERFORM set_config('crest.operation_id',original::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,
  payload_hash,created_by,origin)
 VALUES(a.business_id,original,a.actor_id,CASE WHEN publication THEN 'operations.custody.photo.publish'
  ELSE 'operations.custody.photo.reserve' END,1,a.recovery_epoch,
  encode(sha256(convert_to(after_row::text,'UTF8')),'hex'),a.actor_id,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(a.business_id,original,a.actor_id,a.actor_id,'custody_photos',a.id,CASE WHEN publication THEN 2 ELSE 1 END,
  CASE WHEN publication THEN 'publish' ELSE 'reserve' END,jsonb_build_object('schemaVersion',1,'before',
  CASE WHEN publication THEN snapshot ELSE 'null'::jsonb END,'after',after_row),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,
  result=jsonb_build_object('schemaVersion',1,'photoId',a.id,'status',CASE WHEN publication THEN 'verified' ELSE 'reserved' END)
 WHERE business_id=a.business_id AND operation_id=original;
END $audit$;

CREATE FUNCTION crest_commands.reserve_dropoff_photo(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, photo uuid, booked_vehicle uuid, custody_case uuid, handoff integer,
 content_type text, size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE authority jsonb; a crest.custody_photo_attempts; v crest.job_vehicles; stamp timestamptz;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF photo IS NULL OR booked_vehicle IS NULL OR custody_case IS NULL OR handoff IS NULL OR handoff NOT IN(1,2)
  OR content_type IS NULL OR content_type NOT IN('image/jpeg','image/png','image/heic')
  OR size IS NULL OR size NOT BETWEEN 1 AND 26214400 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_PHOTO_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.owner/1:'||requested_business::text||':'||expected_actor::text,0));
 SELECT * INTO a FROM crest.custody_photo_attempts WHERE business_id=requested_business AND id=photo;
 IF a.id IS NOT NULL THEN
  IF (a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch,a.declared_type,a.byte_size)
   IS DISTINCT FROM (booked_vehicle,custody_case,handoff,expected_epoch,content_type,size) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_RESERVATION_CHANGED';
  END IF;
 ELSE
  v:=crest_private.lock_dropoff_photo_slot(requested_business,expected_actor,booked_vehicle,custody_case,handoff);
  stamp:=clock_timestamp();
  -- V1 is single owner. Count across that owner's sessions so a second
  -- device cannot multiply the documented upload allowance.
  IF (SELECT count(*) FROM crest.custody_photo_attempts s WHERE s.business_id=requested_business
    AND s.actor_id=expected_actor AND s.reserved_at>stamp-interval '1 hour')>=100
   OR (SELECT count(*) FROM crest.custody_photo_attempts s WHERE s.business_id=requested_business
    AND s.actor_id=expected_actor AND s.reserved_at>stamp-interval '10 minutes'
    AND NOT EXISTS(SELECT 1 FROM crest.custody_photo_originals o WHERE (o.business_id,o.photo_id)=(s.business_id,s.id)))>=3 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_LIMIT_REACHED';
  END IF;
  INSERT INTO crest.custody_photo_attempts(id,business_id,job_id,job_vehicle_id,vehicle_id,case_id,handoff_version,
   actor_id,recovery_epoch,dispatch_id,declared_type,byte_size,reserved_at)
  VALUES(photo,requested_business,v.job_id,v.id,v.vehicle_id,custody_case,handoff,expected_actor,expected_epoch,
   gen_random_uuid(),content_type,size,stamp) RETURNING * INTO a;
  PERFORM crest_private.record_dropoff_photo_change(a,NULL::crest.custody_photo_originals);
 END IF;
 PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,a.id);
 RETURN to_jsonb(a);
END $reserve$;

CREATE FUNCTION crest_commands.read_dropoff_photo(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, photo uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT jsonb_build_object('reservation',to_jsonb(a),'original',to_jsonb(o),'linked',EXISTS(
   SELECT 1 FROM crest.custody_events e WHERE e.business_id=a.business_id AND e.condition_photo_id=a.id))
 INTO result FROM crest.custody_photo_attempts a
 JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id AND j.operator_actor_id=expected_actor
 LEFT JOIN crest.custody_photo_originals o ON o.business_id=a.business_id AND o.photo_id=a.id
 WHERE a.business_id=requested_business AND a.id=photo AND a.actor_id=expected_actor;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.check_dropoff_photo_upload(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, expected_epoch uuid, photo uuid
) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $upload$
DECLARE authority jsonb; a crest.custody_photo_attempts; seconds integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT * INTO a FROM crest.custody_photo_attempts WHERE business_id=requested_business AND id=photo AND recovery_epoch=expected_epoch;
 IF a.id IS NULL OR EXISTS(SELECT 1 FROM crest.custody_photo_originals WHERE business_id=requested_business AND photo_id=photo) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_NOT_PENDING';
 END IF;
 PERFORM crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version);
 seconds:=floor(extract(epoch FROM a.reserved_at+interval '10 minutes'-clock_timestamp()))::integer;
 IF seconds<1 OR seconds>600 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_EXPIRED'; END IF;
 RETURN seconds;
END $upload$;

CREATE FUNCTION crest_commands.publish_dropoff_photo(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, photo uuid, candidate jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $publish$
DECLARE authority jsonb; a crest.custody_photo_attempts; o crest.custody_photo_originals;
 keys constant text[]:=ARRAY['detected_type','byte_size','sha256','validation_version','width','height',
  'display_width','display_height','bit_depth','preview_sha256','preview_byte_size','preview_width','preview_height'];
 incoming crest.custody_photo_originals;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF photo IS NULL OR jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR NOT candidate ?& keys
  OR candidate-keys<>'{}'::jsonb OR octet_length(candidate::text)>4096 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_PHOTO_INPUT_REQUIRED';
 END IF;
 incoming:=jsonb_populate_record(NULL::crest.custody_photo_originals,candidate);
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT * INTO a FROM crest.custody_photo_attempts WHERE business_id=requested_business AND id=photo AND recovery_epoch=expected_epoch;
 IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_RESERVATION_REQUIRED'; END IF;
 -- Publication of a photo ID is single-use, even with concurrent dispatchers.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.publish/1:'||photo::text,0));
 SELECT * INTO o FROM crest.custody_photo_originals WHERE business_id=requested_business AND photo_id=photo;
 IF o.photo_id IS NOT NULL THEN
  IF to_jsonb(o)-ARRAY['business_id','photo_id','verified_at'] IS DISTINCT FROM
     to_jsonb(incoming)-ARRAY['business_id','photo_id','verified_at'] THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_ORIGINAL_CHANGED';
  END IF;
 ELSE
  PERFORM crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version);
  IF clock_timestamp()>=a.reserved_at+interval '10 minutes' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_EXPIRED';
  END IF;
  incoming.business_id:=a.business_id; incoming.photo_id:=a.id; incoming.verified_at:=clock_timestamp();
  INSERT INTO crest.custody_photo_originals SELECT incoming.* RETURNING * INTO o;
  PERFORM crest_private.record_dropoff_photo_change(a,o);
 END IF;
 PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,a.dispatch_id);
 RETURN to_jsonb(o);
END $publish$;

REVOKE ALL ON FUNCTION
 crest_private.lock_dropoff_photo_slot(uuid,uuid,uuid,uuid,integer),
 crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals),
 crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer),
 crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;
ALTER FUNCTION crest_private.lock_dropoff_photo_slot(uuid,uuid,uuid,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer)
 OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION
 crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer),
 crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_web;
GRANT EXECUTE ON FUNCTION
 crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)
 TO crest_custody_photo_dispatch;
