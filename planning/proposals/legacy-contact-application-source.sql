-- Held private source for identity and import reconciliation evidence.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.legacy_contact_external_identities,crest.legacy_contact_applications,crest.legacy_contact_application_rows
 TO crest_legacy_contact_export_owner;
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['legacy_contact_external_identities','legacy_contact_applications','legacy_contact_application_rows'] LOOP
  EXECUTE format('CREATE POLICY legacy_application_source_read ON crest.%I FOR SELECT TO crest_legacy_contact_export_owner
   USING(business_id=nullif(current_setting(''crest.legacy_export_business_id'',true),'''')::uuid)',relation);
 END LOOP;
END
$policies$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_application_source_page(
 requested_business uuid,source_kind text,after_batch uuid,after_row integer,
 after_namespace text,after_kind text,after_id text,page_size integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR source_kind IS NULL
  OR source_kind NOT IN ('identity','application','outcome')
  OR (source_kind='identity' AND (after_batch IS NOT NULL OR after_row IS NOT NULL
   OR (after_namespace IS NULL)<>(after_kind IS NULL) OR (after_namespace IS NULL)<>(after_id IS NULL)
   OR after_namespace!~'^[a-z][a-z0-9_-]{1,63}$' OR after_kind NOT IN ('customer','vehicle')
   OR char_length(after_id) NOT BETWEEN 1 AND 200 OR after_id~'[[:cntrl:]]'))
  OR (source_kind<>'identity' AND (after_namespace IS NOT NULL OR after_kind IS NOT NULL OR after_id IS NOT NULL))
  OR (source_kind='application' AND after_row IS NOT NULL)
  OR (source_kind='outcome' AND ((after_batch IS NULL)<>(after_row IS NULL) OR after_row NOT BETWEEN 2 AND 100001)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
 IF source_kind='identity' THEN
  WITH candidates AS MATERIALIZED (
   SELECT i.* FROM crest.legacy_contact_external_identities i WHERE i.business_id=requested_business
    AND (after_namespace IS NULL OR (i.source_namespace,i.entity_kind,i.external_id)>(after_namespace COLLATE "C",after_kind,after_id COLLATE "C"))
   ORDER BY i.source_namespace,i.entity_kind,i.external_id LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY source_namespace,entity_kind,external_id LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY source_namespace,entity_kind,external_id),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 ELSIF source_kind='application' THEN
  WITH candidates AS MATERIALIZED (
   SELECT a.* FROM crest.legacy_contact_applications a WHERE a.business_id=requested_business
    AND (after_batch IS NULL OR a.batch_id>after_batch) ORDER BY a.batch_id LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY batch_id LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY batch_id),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 ELSE
  WITH candidates AS MATERIALIZED (
   SELECT r.* FROM crest.legacy_contact_application_rows r WHERE r.business_id=requested_business
    AND (after_batch IS NULL OR (r.batch_id,r.source_row)>(after_batch,after_row))
   ORDER BY r.batch_id,r.source_row LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY batch_id,source_row LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page)||jsonb_build_object(
   'customer_version',customer_version::text,'vehicle_version',vehicle_version::text) ORDER BY batch_id,source_row),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 END IF;
 RETURN result||jsonb_build_object('schemaVersion',1,'businessId',requested_business,'kind',source_kind);
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_application_source_page(uuid,text,uuid,integer,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_application_source_page(uuid,text,uuid,integer,text,text,text,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;
