-- Isolated supplier-payables source snapshot. Original bytes are held by
-- private object storage. The snapshot retains their exact verification manifest.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,business_id,bill_id,bill_revision,document_reference,recovery_epoch,media_type,byte_size,dispatch_id,operation_id,created_by,reserved_at) ON crest.supplier_bill_original_intents TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_bill_original_intents FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,bill_id,bill_revision,document_reference,file_sha256,byte_size,media_type,object_key,verified_at,candidate,operation_id,created_by) ON crest.supplier_bill_originals TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_bill_originals FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,bill_id,bill_revision,original_id,payable_account_id,payable_mapping_id,gross_cents,review,duplicate_payable_ids,distinct_reason,operation_id,created_by,recorded_at) ON crest.supplier_payables TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_payables FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,payable_id,operation_id,created_by,channel_version_id,evidence_id,actual_on,paid_cents,remaining_before_cents,confirmation,recorded_at) ON crest.supplier_payable_settlements TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_payable_settlements FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,commit_sequence,recovery_epoch,created_by,operation_id,created_at) ON crest.atomic_finance_groups TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.atomic_finance_groups FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,group_id,event_sequence,invoice_id,period_id,period_generation,reopened_generation,effective_on,time_zone,template,template_version,zero_effect_reason,posted_at,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,supplier_payable_id,supplier_payable_settlement_id) ON crest.financial_events TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.financial_events FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,event_id,entry_sequence) ON crest.journal_entries TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.journal_entries FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,tax_payable_movement_id,purpose,debit_cents,credit_cents,money_movement_id,allocation_event_id,unapplication_id,fund_lot_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,collection_failure_settlement_component_id,supplier_payable_id,supplier_payable_settlement_id) ON crest.journal_lines TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.journal_lines FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,event_id,account_id,evidence_id,signed_cents) ON crest.money_movements TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.money_movements FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,normalization_rule,confirmed_on,signed_cents,currency) ON crest.external_money_evidence TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.external_money_evidence FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);

CREATE FUNCTION crest_commands.supplier_payable_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
 SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source jsonb; prior_scope text:=current_setting('crest.supplier_payable_export_business_id',true);
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='SUPPLIER_PAYABLE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_INPUT_REQUIRED'; END IF;
 PERFORM set_config('crest.supplier_payable_export_business_id',requested_business::text,true);
 source:=jsonb_build_object(
  'supplier_bill_original_intents',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'bill_id',t.bill_id::text,'bill_revision',t.bill_revision::text,
   'document_reference',t.document_reference::text,'recovery_epoch',t.recovery_epoch::text,'media_type',t.media_type::text,'byte_size',t.byte_size::text,
   'dispatch_id',t.dispatch_id::text,'operation_id',t.operation_id::text,'created_by',t.created_by::text,'reserved_at',t.reserved_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,bill_id,bill_revision,document_reference,recovery_epoch,media_type,byte_size,dispatch_id,operation_id,created_by,reserved_at
   FROM crest.supplier_bill_original_intents t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'supplier_bill_originals',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'bill_id',t.bill_id::text,'bill_revision',t.bill_revision::text,
   'document_reference',t.document_reference::text,'file_sha256',t.file_sha256::text,'byte_size',t.byte_size::text,'media_type',t.media_type::text,
   'object_key',t.object_key::text,'verified_at',t.verified_at::text,'candidate',t.candidate,'operation_id',t.operation_id::text,
   'created_by',t.created_by::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,bill_id,bill_revision,document_reference,file_sha256,byte_size,media_type,object_key,verified_at,candidate,operation_id,created_by
   FROM crest.supplier_bill_originals t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'supplier_payables',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'bill_id',t.bill_id::text,'bill_revision',t.bill_revision::text,
   'original_id',t.original_id::text,'payable_account_id',t.payable_account_id::text,'payable_mapping_id',t.payable_mapping_id::text,'gross_cents',t.gross_cents::text,
   'review',t.review,'duplicate_payable_ids',t.duplicate_payable_ids,'distinct_reason',t.distinct_reason::text,'operation_id',t.operation_id::text,
   'created_by',t.created_by::text,'recorded_at',t.recorded_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,bill_id,bill_revision,original_id,payable_account_id,payable_mapping_id,gross_cents,review,duplicate_payable_ids,distinct_reason,operation_id,created_by,recorded_at
   FROM crest.supplier_payables t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'supplier_payable_settlements',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'payable_id',t.payable_id::text,'operation_id',t.operation_id::text,
   'created_by',t.created_by::text,'channel_version_id',t.channel_version_id::text,'evidence_id',t.evidence_id::text,'actual_on',t.actual_on::text,
   'paid_cents',t.paid_cents::text,'remaining_before_cents',t.remaining_before_cents::text,'confirmation',t.confirmation::text,'recorded_at',t.recorded_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,payable_id,operation_id,created_by,channel_version_id,evidence_id,actual_on,paid_cents,remaining_before_cents,confirmation,recorded_at
   FROM crest.supplier_payable_settlements t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'atomic_finance_groups',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'commit_sequence',t.commit_sequence::text,'recovery_epoch',t.recovery_epoch::text,
   'created_by',t.created_by::text,'operation_id',t.operation_id::text,'created_at',t.created_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,commit_sequence,recovery_epoch,created_by,operation_id,created_at
   FROM crest.atomic_finance_groups t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.financial_events e WHERE (e.business_id,e.group_id)=(t.business_id,t.id) AND e.template IN ('P14','P15'))
   ORDER BY t.id LIMIT 10001) t),
  'financial_events',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'group_id',t.group_id::text,'event_sequence',t.event_sequence::text,
   'invoice_id',t.invoice_id::text,'period_id',t.period_id::text,'period_generation',t.period_generation::text,'reopened_generation',t.reopened_generation::text,
   'effective_on',t.effective_on::text,'time_zone',t.time_zone::text,'template',t.template::text,'template_version',t.template_version::text,
   'zero_effect_reason',t.zero_effect_reason::text,'posted_at',t.posted_at::text,'payment_id',t.payment_id::text,'posted_expense_id',t.posted_expense_id::text,
   'unapplication_id',t.unapplication_id::text,'fund_application_id',t.fund_application_id::text,'tip_realization_id',t.tip_realization_id::text,'invoice_credit_id',t.invoice_credit_id::text,
   'service_refund_id',t.service_refund_id::text,'excess_return_id',t.excess_return_id::text,'tip_return_id',t.tip_return_id::text,'collection_failure_id',t.collection_failure_id::text,
   'refund_transfer_adjustment_id',t.refund_transfer_adjustment_id::text,'collection_failure_recredit_id',t.collection_failure_recredit_id::text,'collection_failure_settlement_id',t.collection_failure_settlement_id::text,'supplier_payable_id',t.supplier_payable_id::text,
   'supplier_payable_settlement_id',t.supplier_payable_settlement_id::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,group_id,event_sequence,invoice_id,period_id,period_generation,reopened_generation,effective_on,time_zone,template,template_version,zero_effect_reason,posted_at,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,supplier_payable_id,supplier_payable_settlement_id
   FROM crest.financial_events t WHERE t.business_id=requested_business AND t.template IN ('P14','P15')
   ORDER BY t.id LIMIT 10001) t),
  'journal_entries',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'event_id',t.event_id::text,'entry_sequence',t.entry_sequence::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,event_id,entry_sequence
   FROM crest.journal_entries t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.financial_events e WHERE (e.business_id,e.id)=(t.business_id,t.event_id) AND e.template IN ('P14','P15'))
   ORDER BY t.id LIMIT 10001) t),
  'journal_lines',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'entry_id',t.entry_id::text,'invoice_item_id',t.invoice_item_id::text,
   'receivable_id',t.receivable_id::text,'account_id',t.account_id::text,'fixed_mapping_id',t.fixed_mapping_id::text,'tax_payable_movement_id',t.tax_payable_movement_id::text,
   'purpose',t.purpose::text,'debit_cents',t.debit_cents::text,'credit_cents',t.credit_cents::text,'money_movement_id',t.money_movement_id::text,
   'allocation_event_id',t.allocation_event_id::text,'unapplication_id',t.unapplication_id::text,'fund_lot_id',t.fund_lot_id::text,'fund_application_id',t.fund_application_id::text,
   'tip_realization_id',t.tip_realization_id::text,'invoice_credit_id',t.invoice_credit_id::text,'service_refund_id',t.service_refund_id::text,'excess_return_id',t.excess_return_id::text,
   'tip_return_id',t.tip_return_id::text,'collection_failure_id',t.collection_failure_id::text,'collection_failure_component_id',t.collection_failure_component_id::text,'refund_transfer_adjustment_id',t.refund_transfer_adjustment_id::text,
   'collection_failure_recredit_id',t.collection_failure_recredit_id::text,'collection_failure_settlement_id',t.collection_failure_settlement_id::text,'collection_failure_settlement_component_id',t.collection_failure_settlement_component_id::text,'supplier_payable_id',t.supplier_payable_id::text,
   'supplier_payable_settlement_id',t.supplier_payable_settlement_id::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,tax_payable_movement_id,purpose,debit_cents,credit_cents,money_movement_id,allocation_event_id,unapplication_id,fund_lot_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,collection_failure_settlement_component_id,supplier_payable_id,supplier_payable_settlement_id
   FROM crest.journal_lines t WHERE t.business_id=requested_business AND num_nonnulls(t.supplier_payable_id,t.supplier_payable_settlement_id)=1
   ORDER BY t.id LIMIT 10001) t),
  'money_movements',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'event_id',t.event_id::text,'account_id',t.account_id::text,
   'evidence_id',t.evidence_id::text,'signed_cents',t.signed_cents::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,event_id,account_id,evidence_id,signed_cents
   FROM crest.money_movements t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.financial_events e WHERE (e.business_id,e.id)=(t.business_id,t.event_id) AND e.template='P15')
   ORDER BY t.id LIMIT 10001) t),
  'external_money_evidence',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'provider_namespace',t.provider_namespace::text,'external_account_id',t.external_account_id::text,
   'id_namespace',t.id_namespace::text,'external_id',t.external_id::text,'raw_reference',t.raw_reference::text,'normalization_rule',t.normalization_rule::text,
   'confirmed_on',t.confirmed_on::text,'signed_cents',t.signed_cents::text,'currency',t.currency::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,normalization_rule,confirmed_on,signed_cents,currency
   FROM crest.external_money_evidence t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.supplier_payable_settlements s WHERE (s.business_id,s.evidence_id)=(t.business_id,t.id))
   ORDER BY t.id LIMIT 10001) t)
 );
 IF (SELECT sum(jsonb_array_length(rows)) FROM jsonb_each(source) AS group_rows(name,rows))>10000
  OR octet_length(source::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SUPPLIER_PAYABLE_SOURCE_LIMIT'; END IF;
 PERFORM set_config('crest.supplier_payable_export_business_id',coalesce(prior_scope,''),true);
 RETURN jsonb_build_object('schemaVersion',1,'scope','supplier_payable_source','businessId',requested_business,'tables',source);
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_paid_expense_export_owner;
ALTER FUNCTION crest_commands.supplier_payable_source_snapshot(uuid) OWNER TO crest_paid_expense_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_paid_expense_export_owner;
REVOKE ALL ON FUNCTION crest_commands.supplier_payable_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.supplier_payable_source_snapshot(uuid) TO crest_export;

-- The old projections still omit supplier rows and retain their original column shape.
-- Schema checks admit only these two reviewed links on the shared ledger tables.
SET LOCAL ROLE crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
  WHEN 'financial_events' THEN expected_fields||ARRAY['payment_id:uuid','posted_expense_id:uuid','unapplication_id:uuid','fund_application_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['money_movement_id:uuid','allocation_event_id:uuid','unapplication_id:uuid','fund_lot_id:uuid','fund_application_id:uuid']
  ELSE expected_fields END;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
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
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.receipt_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
 WHEN 'financial_events' THEN expected_fields||ARRAY['posted_expense_id:uuid','unapplication_id:uuid','fund_application_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_lot_id:uuid','fund_application_id:uuid']
  ELSE expected_fields END;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
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
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.posted_expense_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
 WHEN 'financial_events' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_application_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_lot_id:uuid','fund_application_id:uuid']
  ELSE expected_fields END;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
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
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

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
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.fund_application_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
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
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FUND_APPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.invoice_credit_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
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
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.held_tip_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines','fund_lot_range_consumptions') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines','fund_lot_range_consumptions') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group='fund_lot_range_consumptions' THEN expected_fields:=expected_fields||ARRAY['collection_failure_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HELD_TIP_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
RESET ROLE;

-- The authorized download receipt binds the same v23 profile as the archive.
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.record_posted_finance_export_access(credential_hash bytea,expected_session uuid,expected_actor uuid,
 expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,source_version integer,app_release text,observed_at text,manifest_digest text,archive_digest text,archive_bytes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $handoff$
DECLARE operation uuid:=gen_random_uuid(); event uuid; scope jsonb; receipt jsonb; recorded timestamptz; observed timestamptz;
BEGIN
 IF expected_epoch IS NULL OR source_version IS NULL OR source_version NOT BETWEEN 89 AND 999
   OR app_release IS NULL OR app_release!~'^[a-f0-9]{40}$' OR observed_at IS NULL
   OR observed_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00:00$'
   OR manifest_digest IS NULL OR manifest_digest!~'^[a-f0-9]{64}$' OR archive_digest IS NULL OR archive_digest!~'^[a-f0-9]{64}$'
   OR archive_bytes IS NULL OR archive_bytes NOT BETWEEN 1 AND 8388608 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 observed:=observed_at::timestamptz;
 IF NOT isfinite(observed) OR observed>clock_timestamp() OR observed<=clock_timestamp()-interval '2 minutes' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
   set_config('crest.operation_id',operation::text,true);
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=109 THEN 'crest.posted-finance-source.v23' WHEN source_version>=108 THEN 'crest.posted-finance-source.v22' WHEN source_version>=107 THEN 'crest.posted-finance-source.v21' WHEN source_version>=105 THEN 'crest.posted-finance-source.v20' WHEN source_version>=103 THEN 'crest.posted-finance-source.v19' WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
   'appReleaseId',app_release,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,
   'observedAt',observed_at,'manifestSha256',manifest_digest,'archiveSha256',archive_digest,'archiveBytes',archive_bytes);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'finance.export_access',1,expected_epoch,
  encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'finance_export_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,recorded;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,
  'recordedAt',to_char(recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch,operation);
 RETURN receipt;
END $handoff$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
