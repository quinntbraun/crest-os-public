-- Held portability source for the retained request and its public outcome.
-- Worker lease identifiers, retry scheduling and security epochs stay in the
-- encrypted database recovery profile. A portable row is evidence, not work
-- that a receiving database should put into an operating queue.
GRANT USAGE ON SCHEMA crest_private TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id,operation_id,batch_id,evidence_sha256,requested_by,requested_at,outcome,completed_at,attempt_count)
 ON crest_private.legacy_contact_apply_requests TO crest_legacy_contact_export_owner;
CREATE POLICY legacy_apply_request_export ON crest_private.legacy_contact_apply_requests
 FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_request_source_page(
 requested_business uuid,after_operation uuid,page_size integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
 WITH candidates AS MATERIALIZED (
  SELECT r.business_id,r.operation_id,r.batch_id,r.evidence_sha256,r.requested_by,r.requested_at,
   coalesce(r.outcome,'queued') AS status,r.completed_at,r.attempt_count
  FROM crest_private.legacy_contact_apply_requests r
  WHERE r.business_id=requested_business AND (after_operation IS NULL OR r.operation_id>after_operation)
  ORDER BY r.operation_id LIMIT page_size+1
 ), page AS (
  SELECT * FROM candidates ORDER BY operation_id LIMIT page_size
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY operation_id),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 RETURN result;
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_request_source_page(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_request_source_page(uuid,uuid,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;
