-- Held original-file handoff proposal. Register only after native verification.
-- Uses existing source-reader privileges and the existing immutable export
-- access operation/audit trail. No new table, role, membership or financial rule.
RESET ROLE;
DO $review$ BEGIN
 IF to_regprocedure('crest_private.current_source_export_original(uuid,text,uuid)') IS NOT NULL
 OR to_regprocedure('crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid)') IS NOT NULL
 OR to_regprocedure('crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_ACCESS_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.current_source_export_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') AND proowner='crest_command_owner'::regrole AND prosecdef AND provolatile='v')
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_business_source_owner' AND NOT(rolcanlogin OR rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_business_source_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_ACCESS_DEPENDENCY_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.current_source_export_original(business uuid,kind text,attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $$
DECLARE r record;extension text;original_key text;
BEGIN
 IF business IS NULL OR attachment IS NULL OR kind IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 PERFORM set_config('crest.business_source_business',business::text,true);
 IF kind='expense_receipt' THEN
  SELECT receipt_id AS attachment_id,receipt_id AS object_id,reservation->>'declaredType' AS media_type,
   (candidate->'original'->>'byteSize')::integer AS byte_size,candidate->'original'->>'sha256' AS sha256,
   candidate->'original'->>'key' AS object_key,recorded_at
  INTO r FROM crest.expense_receipt_revisions
  WHERE business_id=business AND receipt_id=attachment AND revision=2 AND candidate IS NOT NULL;
 ELSIF kind='condition_photo' THEN
  SELECT o.photo_id AS attachment_id,a.dispatch_id AS object_id,o.detected_type AS media_type,
   o.byte_size,o.sha256,'originals/'||business::text||'/'||a.dispatch_id::text AS object_key,o.verified_at AS recorded_at
  INTO r FROM crest.custody_photo_originals o JOIN crest.custody_photo_attempts a ON a.business_id=o.business_id AND a.id=o.photo_id
  WHERE o.business_id=business AND o.photo_id=attachment;
 ELSIF kind='supplier_document' THEN
  SELECT id AS attachment_id,id AS object_id,media_type,byte_size,file_sha256 AS sha256,object_key,verified_at AS recorded_at
  INTO r FROM crest.supplier_bill_originals WHERE business_id=business AND id=attachment;
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_FILE_UNAVAILABLE';END IF;
 extension:=CASE r.media_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/heic' THEN 'heic' WHEN 'application/pdf' THEN 'pdf' ELSE NULL END;
 original_key:='originals/'||business::text||'/'||r.object_id::text;
 IF extension IS NULL OR r.byte_size IS NULL OR r.byte_size NOT BETWEEN 1 AND 26214400 OR r.sha256 IS NULL OR r.sha256!~'^[a-f0-9]{64}$'
 OR r.object_key IS DISTINCT FROM original_key OR r.recorded_at IS NULL OR NOT isfinite(r.recorded_at)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ORIGINAL_FILE_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('file',jsonb_build_object('kind',kind,'attachmentId',attachment,'objectId',r.object_id,
  'path','attachments/'||attachment::text||'/'||r.object_id::text||'.'||extension,'mediaType',r.media_type,'byteSize',r.byte_size,
  'sha256',r.sha256,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  'object',jsonb_build_object('domain',kind,'key',original_key));
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_business_source_owner;
ALTER FUNCTION crest_private.current_source_export_original(uuid,text,uuid) OWNER TO crest_business_source_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_private.current_source_export_original(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.current_source_export_original(uuid,text,uuid) TO crest_command_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_source_export_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;original jsonb;original_index jsonb;matches jsonb;
BEGIN
 IF requested_attachment IS NULL OR requested_kind IS NULL OR requested_kind NOT IN('expense_receipt','supplier_document','condition_photo') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 IF context->'header'->>'profile' IS DISTINCT FROM 'crest.current-business-source-bundle.v1'
 OR (context->'header'->>'sourceSchemaVersion')::integer<>136
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT request_text::jsonb->'plan'->'originals' INTO original_index FROM crest_private.export_job_snapshots WHERE business_id=requested_business AND export_job_id=requested_job AND generation_id=requested_generation;
 IF NOT FOUND OR original_index->>'profile' IS DISTINCT FROM 'crest.source-export-original-index.v1' OR jsonb_typeof(original_index->'files') IS DISTINCT FROM 'array'
 OR coalesce(original_index->>'inventorySha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO matches FROM jsonb_array_elements(original_index->'files') WHERE value->>'kind'=requested_kind AND value->>'attachmentId'=requested_attachment::text;
 IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_OUTSIDE_SNAPSHOT';END IF;
 original:=crest_private.current_source_export_original(requested_business,requested_kind,requested_attachment);
 IF original->'file' IS DISTINCT FROM matches->0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 IF crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) IS DISTINCT FROM context
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 RETURN jsonb_build_object('profile','crest.source-export-original-permit.v1','header',context->'header','authority',context->'authority','indexSha256',original_index->'inventorySha256','file',original->'file','object',original->'object');
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_source_export_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_source_export_original_access(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid,expected_record text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE current_record jsonb;scope jsonb;operation uuid:=gen_random_uuid();event uuid;stamp timestamptz;receipt jsonb;
BEGIN
 IF expected_record IS NULL OR octet_length(expected_record)>16384 OR NOT(expected_record IS JSON OBJECT WITH UNIQUE KEYS)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_EXPORT_INPUT_REQUIRED';END IF;
 current_record:=crest_commands.read_source_export_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
 IF current_record IS DISTINCT FROM expected_record::jsonb THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 scope:=jsonb_build_object('profile','crest.source-export-original-scope.v1','header',current_record->'header','indexSha256',current_record->'indexSha256','file',current_record->'file','currentActorId',expected_actor,'recoveryEpoch',current_record->'authority'->'recoveryEpoch');
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',operation::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'export.download_access',1,(current_record->'authority'->>'recoveryEpoch')::uuid,encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'export_accesses',operation,1,'authorized_handoff',jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,stamp;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,(current_record->'authority'->>'recoveryEpoch')::uuid,operation);
 IF crest_commands.read_source_export_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) IS DISTINCT FROM current_record
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 RETURN receipt;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_source_export_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,uuid,text) TO crest_web;
