-- Held authority for a sensitive original handoff, applied after photo commands.
-- This records an authorized response, never a completed browser download.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY custody_original_access_operation ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access');
CREATE POLICY custody_original_access_claim ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_original_access_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access' AND state='committed');
CREATE POLICY custody_original_access_audit_return ON crest_private.audit_events FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND entity_kind='custody_photo_accesses');
CREATE POLICY custody_original_access_audit ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND entity_kind='custody_photo_accesses' AND entity_id=operation_id AND entity_version=1
 AND action='authorized_handoff' AND origin='manual' AND import_row_id IS NULL
 AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
  AND o.actor_id=audit_events.actor_id AND o.operation_id=audit_events.operation_id
  AND o.command_type='operations.custody.photo.access' AND o.state='pending'));
RESET ROLE;

CREATE FUNCTION crest_commands.record_dropoff_original_access(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, booked_vehicle uuid, photo uuid, expected_sha256 text, expected_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $access$
DECLARE current_record jsonb; handoff_id uuid; custody_case uuid; operation uuid:=gen_random_uuid(); audit_id uuid;
 evidence jsonb; receipt jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF booked_vehicle IS NULL OR photo IS NULL OR expected_sha256 IS NULL OR expected_sha256 !~ '^[a-f0-9]{64}$'
  OR expected_size IS NULL OR expected_size NOT BETWEEN 1 AND 26214400 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_PHOTO_INPUT_REQUIRED';
 END IF;
 -- Take the existing write fence before the shared read locks. The audit and
 -- the verified handoff must both be current before the server releases bytes.
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 current_record:=crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,photo);
 IF current_record->'linked' IS DISTINCT FROM 'true'::jsonb
  OR current_record->'reservation'->>'job_vehicle_id' IS DISTINCT FROM booked_vehicle::text
  OR current_record->'original'->>'sha256' IS DISTINCT FROM expected_sha256
  OR current_record->'original'->'byte_size' IS DISTINCT FROM to_jsonb(expected_size) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_UNAVAILABLE';
 END IF;
 custody_case:=(current_record->'reservation'->>'case_id')::uuid;
 SELECT e.id INTO handoff_id FROM crest.custody_events e JOIN crest.custody_cases c
  ON c.business_id=e.business_id AND c.id=e.case_id
 WHERE e.business_id=requested_business AND e.condition_photo_id=photo AND e.case_id=custody_case
  AND e.version=(current_record->'reservation'->>'handoff_version')::integer
  AND c.job_vehicle_id=booked_vehicle AND c.job_id=(current_record->'reservation'->>'job_id')::uuid;
 IF handoff_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_UNAVAILABLE';END IF;
 evidence:=jsonb_build_object('photoId',photo,'jobVehicleId',booked_vehicle,'caseId',custody_case,
  'handoffEventId',handoff_id,'sha256',expected_sha256,'byteSize',expected_size,
  'contentType',current_record->'original'->>'detected_type');
 PERFORM set_config('crest.operation_id',operation::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'operations.custody.photo.access',1,expected_epoch,
  encode(sha256(convert_to(evidence::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'custody_photo_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',evidence),'manual') RETURNING id INTO audit_id;
 receipt:=jsonb_build_object('schemaVersion',1,'operationId',operation,'auditEventId',audit_id,'scope',evidence);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation;
 PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,operation);
 IF crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,photo) IS DISTINCT FROM current_record THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_UNAVAILABLE';
 END IF;
 RETURN receipt;
END $access$;
ALTER FUNCTION crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)
 TO crest_web;
