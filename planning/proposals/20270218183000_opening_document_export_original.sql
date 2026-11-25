-- HELD142: exact opening-original metadata for the frozen export membership check.
-- Existing jobs continue to use the original function and cannot acquire new files.
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_business_source_owner;
SET LOCAL ROLE crest_business_source_owner;
CREATE FUNCTION crest_private.current_source_export_original_v2(business uuid,kind text,attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $original$
DECLARE i crest.opening_document_intents;o crest.opening_document_originals;extension text;
BEGIN
 IF business IS NULL OR attachment IS NULL OR kind IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 IF kind<>'supplier_document' THEN RETURN crest_private.current_source_export_original(business,kind,attachment);END IF;
 PERFORM set_config('crest.business_source_business',business::text,true);
 SELECT * INTO i FROM crest.opening_document_intents WHERE business_id=business AND id=attachment;
 IF NOT FOUND THEN RETURN crest_private.current_source_export_original(business,kind,attachment);END IF;
 SELECT * INTO o FROM crest.opening_document_originals WHERE business_id=business AND id=attachment;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_FILE_UNAVAILABLE';END IF;
 IF o.candidate#>>'{source,sha256}' IS DISTINCT FROM i.expected_sha256
 OR o.candidate#>>'{original,sha256}' IS DISTINCT FROM i.expected_sha256
 OR o.candidate#>>'{source,detectedType}' IS DISTINCT FROM i.media_type
 OR o.candidate#>>'{source,byteSize}' IS DISTINCT FROM i.byte_size::text
 OR o.candidate#>>'{original,byteSize}' IS DISTINCT FROM i.byte_size::text
 OR o.candidate#>>'{original,key}' IS DISTINCT FROM 'originals/'||business::text||'/'||attachment::text
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ORIGINAL_FILE_REVIEW_REQUIRED';END IF;
 extension:=CASE i.media_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/heic' THEN 'heic' WHEN 'application/pdf' THEN 'pdf' END;
 IF extension IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ORIGINAL_FILE_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('file',jsonb_build_object('kind',kind,'attachmentId',attachment,'objectId',attachment,
  'path','attachments/'||attachment::text||'/'||attachment::text||'.'||extension,'mediaType',i.media_type,'byteSize',i.byte_size,
  'sha256',i.expected_sha256,'recordedAt',to_char(o.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  'object',jsonb_build_object('domain','supplier_document','key','originals/'||business::text||'/'||attachment::text));
END $original$;
REVOKE ALL ON FUNCTION crest_private.current_source_export_original_v2(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.current_source_export_original_v2(uuid,text,uuid) TO crest_command_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_business_source_owner;
