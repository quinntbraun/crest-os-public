-- Held v13 source projection. Receipt anchors and tip dimensions are
-- additive to older source projections. All reads remain caller-scoped.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(receipt_tip_event_id) ON crest.customer_fund_lots TO crest_receipt_export_owner;
GRANT SELECT(tip_realization_id) ON crest.financial_events,crest.journal_lines TO crest_receipt_export_owner;
CREATE POLICY receipt_tip_anchor_source_export ON crest.customer_fund_lots FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND receipt_tip_event_id IS NOT NULL);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_receipt_export_owner;
SET LOCAL ROLE crest_receipt_export_owner;
CREATE FUNCTION crest_commands.direct_receipt_tip_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE token text; anchors jsonb; entries jsonb;
BEGIN
 token:=crest_private.receipt_source_token(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO anchors FROM (
  SELECT l.id,l.business_id,l.unapplication_id,l.origin_id,l.parent_partition_id,l.customer_id,l.account_id,l.mapping_id,
   l.original_cents::text,l.receipt_event_id,l.receipt_tip_event_id
  FROM crest.customer_fund_lots l
  WHERE l.business_id=requested_business AND l.receipt_tip_event_id IS NOT NULL ORDER BY l.id LIMIT 1001
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO entries FROM (
  SELECT l.id,j.event_id,l.tip_realization_id
  FROM crest.financial_events e
  JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
  JOIN crest.journal_lines l ON (l.business_id,l.entry_id,l.tip_realization_id)=(j.business_id,j.id,e.tip_realization_id)
  WHERE e.business_id=requested_business AND e.tip_realization_id IS NOT NULL ORDER BY l.id LIMIT 2001
 ) x;
 IF jsonb_array_length(anchors)>1000 OR jsonb_array_length(entries)>2000 OR octet_length(anchors::text)+octet_length(entries::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='DIRECT_RECEIPT_TIP_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',token,'anchors',anchors,'lines',entries);
END $snapshot$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_receipt_export_owner;
REVOKE ALL ON FUNCTION crest_commands.direct_receipt_tip_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.direct_receipt_tip_source_snapshot(uuid) TO crest_export;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.unapplication_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['fund_application_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group='customer_fund_lots' THEN expected_fields:=expected_fields||ARRAY['receipt_event_id:uuid','receipt_tip_event_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
RESET ROLE;
