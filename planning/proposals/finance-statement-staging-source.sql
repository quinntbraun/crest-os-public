-- Closed private capture of normalized statement evidence. Original file bytes are outside this slice.
CREATE ROLE crest_statement_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_statement_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands TO crest_statement_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.statement_imports,crest.statement_import_rows TO crest_statement_export_owner;
CREATE POLICY statement_import_source ON crest.statement_imports FOR SELECT TO crest_statement_export_owner
 USING (business_id=nullif(current_setting('crest.statement_export_business_id',true),'')::uuid);
CREATE POLICY statement_row_source ON crest.statement_import_rows FOR SELECT TO crest_statement_export_owner
 USING (business_id=nullif(current_setting('crest.statement_export_business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.statement_staging_source_snapshot(requested_business uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE capture jsonb; batches jsonb; row_total integer;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='STATEMENT_STAGING_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_STAGING_SOURCE_BUSINESS_REQUIRED';
 END IF;
 PERFORM set_config('crest.statement_export_business_id',requested_business::text,true);
 SELECT count(*) INTO row_total FROM (SELECT 1 FROM crest.statement_import_rows WHERE business_id=requested_business LIMIT 10001) r;
 IF row_total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_STAGING_SOURCE_LIMIT';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'businessId',s.business_id,'accountId',s.account_id,
  'channelVersionId',s.channel_version_id,'startsOn',to_char(s.starts_on,'YYYY-MM-DD'),'endsOn',to_char(s.ends_on,'YYYY-MM-DD'),
  'openingCents',s.opening_cents::text,'closingCents',s.closing_cents::text,'fileSha256',s.file_sha256,
  'dateConvention',s.date_convention,'completenessEvidence',s.completeness_evidence,'rowCount',s.row_count,
  'signedRowsCents',s.signed_rows_cents::text,'rowsSha256',s.rows_sha256,'statementDifferenceCents',s.statement_difference_cents::text,
  'operationId',s.operation_id,'recordedBy',s.created_by,'recordedAt',to_char(s.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rows',children.original_text) ORDER BY s.id),'[]') INTO batches
 FROM (SELECT * FROM crest.statement_imports WHERE business_id=requested_business ORDER BY id LIMIT 201) s
 CROSS JOIN LATERAL(
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'statementOn',to_char(r.statement_on,'YYYY-MM-DD'),
   'signedCents',r.signed_cents::text) ORDER BY r.id),'[]'::jsonb)::text AS original_text
  FROM crest.statement_import_rows r WHERE (r.business_id,r.statement_id)=(s.business_id,s.id)
 ) children;
 capture:=jsonb_build_object('schemaVersion',1,'scope','statement_staging_source','businessId',requested_business,'batches',batches);
 IF jsonb_array_length(batches)>200 OR octet_length(capture::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_STAGING_SOURCE_LIMIT';
 END IF;
 RETURN capture;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_statement_export_owner;
ALTER FUNCTION crest_commands.statement_staging_source_snapshot(uuid) OWNER TO crest_statement_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_statement_export_owner;
REVOKE ALL ON FUNCTION crest_commands.statement_staging_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.statement_staging_source_snapshot(uuid) TO crest_export;
