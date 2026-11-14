-- Source v14 projects typed embedded fee rows and their optional subordinate evidence.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,business_id,adjustment_id,mapping_id,fee_account_id,net_cents,cents,confirmation,component_evidence_id)
 ON crest.refund_transfer_embedded_fees TO crest_refund_transfer_export_owner;
CREATE POLICY refund_transfer_fee_export ON crest.refund_transfer_embedded_fees
 FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_refund_transfer_export_owner;
SET LOCAL ROLE crest_refund_transfer_export_owner;
CREATE FUNCTION crest_commands.refund_transfer_fee_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE history jsonb; fees jsonb; components jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='REFUND_TRANSFER_FEE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true),set_config('crest.refund_transfer_fee_source','on',true);
 SELECT coalesce(jsonb_agg(to_jsonb(fee) ORDER BY fee.id),'[]'::jsonb) INTO fees FROM (
  SELECT f.id,f.business_id,f.adjustment_id,f.mapping_id,f.fee_account_id,f.net_cents::text,f.cents::text,f.confirmation,f.component_evidence_id
  FROM crest.refund_transfer_embedded_fees f WHERE f.business_id=requested_business ORDER BY f.id LIMIT 1001
 ) fee;
 SELECT coalesce(jsonb_agg(to_jsonb(component) ORDER BY component.id),'[]'::jsonb) INTO components FROM (
  SELECT e.id,e.business_id,e.provider_namespace,e.external_account_id,e.id_namespace,e.external_id,e.raw_reference,e.normalization_rule,
   e.confirmed_on::text,e.signed_cents::text,e.currency
  FROM crest.refund_transfer_embedded_fees fee
  JOIN crest.external_money_evidence e ON e.business_id=fee.business_id AND e.id=fee.component_evidence_id
  WHERE fee.business_id=requested_business ORDER BY e.id LIMIT 1001
 ) component;
 PERFORM set_config('crest.refund_transfer_fee_source','',true);
 IF jsonb_array_length(fees)>1000 OR jsonb_array_length(components)>1000
  OR octet_length(fees::text)+octet_length(components::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='REFUND_TRANSFER_FEE_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'historySnapshotToken',history->>'snapshotToken',
  'fees',fees,'components',components);
END $snapshot$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_refund_transfer_export_owner;
REVOKE ALL ON FUNCTION crest_commands.refund_transfer_fee_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.refund_transfer_fee_source_snapshot(uuid) TO crest_export;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY refund_transfer_fee_component_export ON crest.external_money_evidence
 FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.refund_transfer_embedded_fees f WHERE f.business_id=external_money_evidence.business_id
   AND f.component_evidence_id=external_money_evidence.id
 ) AND current_setting('crest.refund_transfer_fee_source',true)='on');
RESET ROLE;
