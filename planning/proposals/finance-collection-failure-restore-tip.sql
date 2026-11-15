-- A confirmed original tip is reinstated as a new consumption generation on the same root.
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.collection_failure_settlement_components ADD COLUMN original_tip_realization_id uuid;
ALTER TABLE crest.collection_failure_settlement_components ADD FOREIGN KEY(business_id,original_tip_realization_id)
 REFERENCES crest.tip_realizations(business_id,id);
ALTER TABLE crest.collection_failure_settlement_components ADD CHECK(num_nonnulls(receivable_id,original_tip_realization_id)<=1);
ALTER TABLE crest.tip_realizations ADD COLUMN restored_settlement_component_id uuid;
ALTER TABLE crest.tip_realizations ADD UNIQUE(business_id,restored_settlement_component_id);
ALTER TABLE crest.tip_realizations ADD FOREIGN KEY(business_id,restored_settlement_component_id)
 REFERENCES crest.collection_failure_settlement_components(business_id,id);
ALTER TABLE crest.tip_realizations DROP CONSTRAINT tip_realizations_business_id_operation_id_key;
CREATE UNIQUE INDEX original_tip_operation_unique ON crest.tip_realizations(business_id,operation_id)
 WHERE restored_settlement_component_id IS NULL;
CREATE POLICY grouped_tip_restoration_insert ON crest.tip_realizations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(restored_settlement_component_id IS NOT NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=tip_realizations.business_id
   AND o.operation_id=tip_realizations.operation_id AND o.actor_id=tip_realizations.created_by
   AND o.command_type='finance.collection_failure.recredit' AND o.state='pending'));

-- The original payment-root exclusion remains one domain. Only a proven restored tip can occupy a separate domain.
ALTER TABLE crest.collection_failure_components ADD COLUMN restored_tip_generation_id uuid;
ALTER TABLE crest.collection_failure_components ADD FOREIGN KEY(business_id,restored_tip_generation_id)
 REFERENCES crest.tip_realizations(business_id,id);
DO $exclusion$
DECLARE previous text;
BEGIN
 SELECT conname INTO STRICT previous FROM pg_constraint
 WHERE conrelid='crest.collection_failure_components'::regclass AND contype='x';
 EXECUTE format('ALTER TABLE crest.collection_failure_components DROP CONSTRAINT %I',previous);
END $exclusion$;
ALTER TABLE crest.collection_failure_components ADD CONSTRAINT collection_failure_generation_no_overlap EXCLUDE USING gist(
 business_id extensions.gist_uuid_ops WITH =,payment_id extensions.gist_uuid_ops WITH =,
 coalesce(restored_tip_generation_id,'00000000-0000-0000-0000-000000000000'::uuid) extensions.gist_uuid_ops WITH =,
 numrange(root_first_cent::numeric,root_last_cent::numeric,'[]') WITH &&);
ALTER TABLE crest.collection_failure_components ADD CHECK(restored_tip_generation_id IS NULL OR
 (restored_tip_generation_id=tip_realization_id AND restored_tip_generation_id<>'00000000-0000-0000-0000-000000000000'::uuid));
CREATE FUNCTION crest_private.collection_failure_tip_generation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $generation$
BEGIN
 NEW.restored_tip_generation_id:=NULL;
 IF NEW.tip_realization_id IS NOT NULL AND EXISTS(SELECT FROM crest.tip_realizations t
  WHERE (t.business_id,t.id)=(NEW.business_id,NEW.tip_realization_id) AND t.restored_settlement_component_id IS NOT NULL) THEN
  NEW.restored_tip_generation_id:=NEW.tip_realization_id;
 END IF;
 RETURN NEW;
END $generation$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.collection_failure_tip_generation() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.collection_failure_tip_generation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_tip_generation() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER collection_failure_tip_generation BEFORE INSERT ON crest.collection_failure_components
 FOR EACH ROW EXECUTE FUNCTION crest_private.collection_failure_tip_generation();

-- Every restored descendant stores root coordinates; amounts always use the first original tip's frozen prefix.
CREATE FUNCTION crest_private.tip_range_components(t crest.tip_realizations,first_cent bigint,last_cent bigint)
RETURNS TABLE(net_cents bigint,tax_cents bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $amount$
 WITH RECURSIVE generations AS (
  SELECT t AS row_value,0 AS depth
  UNION ALL
  SELECT earlier, generations.depth+1 FROM generations
  JOIN crest.collection_failure_settlement_components c ON (c.business_id,c.id)=
   ((generations.row_value).business_id,(generations.row_value).restored_settlement_component_id)
  JOIN crest.tip_realizations earlier ON (earlier.business_id,earlier.id)=(c.business_id,c.original_tip_realization_id)
  WHERE generations.depth<180
 )
 SELECT component.net_cents,component.tax_cents FROM generations g
 CROSS JOIN LATERAL crest_private.original_tip_return_components((g.row_value).inclusive_cents,(g.row_value).net_cents,
  (t.first_cent-(g.row_value).first_cent)+first_cent,(t.first_cent-(g.row_value).first_cent)+last_cent) component
 WHERE (g.row_value).restored_settlement_component_id IS NULL AND first_cent>0 AND last_cent>=first_cent AND last_cent<=t.inclusive_cents;
$amount$;
REVOKE ALL ON FUNCTION crest_private.tip_range_components(crest.tip_realizations,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.tip_range_components(crest.tip_realizations,bigint,bigint)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.tip_generation_posting(t crest.tip_realizations)
RETURNS TABLE(event_id uuid,effective_on date)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
 SELECT e.id,e.effective_on FROM crest.financial_events e
 WHERE (e.business_id,e.tip_realization_id)=(t.business_id,t.id) AND e.template IN('P03','P06')
 UNION ALL
 SELECT e.id,e.effective_on FROM crest.collection_failure_settlement_components c
 JOIN crest.financial_events e ON (e.business_id,e.collection_failure_settlement_id)=(c.business_id,c.settlement_id)
 WHERE (c.business_id,c.id)=(t.business_id,t.restored_settlement_component_id) AND e.template='P11' AND e.template_version=3;
$posting$;
REVOKE ALL ON FUNCTION crest_private.tip_generation_posting(crest.tip_realizations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.tip_generation_posting(crest.tip_realizations)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK((num_nonnulls(collection_failure_settlement_id,collection_failure_settlement_component_id)=0 AND ((collection_failure_recredit_id IS NULL AND (
 (refund_transfer_adjustment_id IS NULL AND (((
((((
(((((((((
 (purpose IN('ar','discount','service_revenue','tax_payable') AND invoice_item_id IS NOT NULL AND money_movement_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL
  AND (purpose='ar')=(receivable_id IS NOT NULL) AND (purpose='tax_payable')=(fixed_mapping_id IS NULL))
 OR (purpose='receipt_money' AND money_movement_id IS NOT NULL AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL
  AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='receipt_ar' AND allocation_event_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND fixed_mapping_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='expense_cost' AND fixed_mapping_id IS NOT NULL AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL
  AND receivable_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='expense_money' AND money_movement_id IS NOT NULL AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL
  AND receivable_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL AND unapplication_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='unapply_ar' AND unapplication_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents>0 AND credit_cents=0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL AND fund_lot_id IS NULL)
 OR (purpose='unapply_funds' AND unapplication_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL)) AND fund_application_id IS NULL)
 OR (purpose='apply_funds' AND fund_application_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND money_movement_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL)
 OR (purpose='apply_ar' AND fund_application_id IS NOT NULL AND receivable_id IS NOT NULL AND debit_cents=0 AND credit_cents>0
  AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND fixed_mapping_id IS NULL
  AND unapplication_id IS NULL AND fund_lot_id IS NULL)) AND tip_realization_id IS NULL)
 OR (purpose='tip_funds' AND tip_realization_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND tax_payable_movement_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL)
 OR (purpose='tip_revenue' AND tip_realization_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND tax_payable_movement_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL)
 OR (purpose='tip_tax' AND tip_realization_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND tax_payable_movement_id IS NULL
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL)) AND invoice_credit_id IS NULL)
 OR (purpose IN('credit_returns','credit_discount') AND invoice_credit_id IS NOT NULL AND receivable_id IS NULL AND fixed_mapping_id IS NOT NULL
  AND (purpose='credit_returns')=(debit_cents>0) AND (purpose='credit_discount')=(credit_cents>0) AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_lot_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='credit_ar' AND invoice_credit_id IS NOT NULL AND receivable_id IS NOT NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_lot_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='credit_tax' AND invoice_credit_id IS NOT NULL AND receivable_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents>0 AND credit_cents=0 AND invoice_item_id IS NULL AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_lot_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND tax_payable_movement_id IS NULL)) AND service_refund_id IS NULL)
 OR (purpose='refund_funds' AND service_refund_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND money_movement_id IS NULL AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_application_id IS NULL AND tip_realization_id IS NULL AND invoice_credit_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='refund_money' AND service_refund_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND money_movement_id IS NOT NULL AND invoice_item_id IS NULL AND receivable_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL
  AND fund_application_id IS NULL AND tip_realization_id IS NULL AND invoice_credit_id IS NULL AND tax_payable_movement_id IS NULL))
 OR (purpose='receipt_funds' AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents=0 AND credit_cents>0 AND invoice_item_id IS NULL AND receivable_id IS NULL AND money_movement_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL
  AND invoice_credit_id IS NULL AND service_refund_id IS NULL AND tax_payable_movement_id IS NULL)) AND excess_return_id IS NULL)
 OR (purpose='excess_return_funds' AND excess_return_id IS NOT NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
  AND debit_cents>0 AND credit_cents=0 AND money_movement_id IS NULL AND invoice_item_id IS NULL AND receivable_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL
  AND invoice_credit_id IS NULL AND service_refund_id IS NULL AND tax_payable_movement_id IS NULL)
 OR (purpose='excess_return_money' AND excess_return_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL
  AND debit_cents=0 AND credit_cents>0 AND money_movement_id IS NOT NULL AND invoice_item_id IS NULL AND receivable_id IS NULL
  AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL
  AND invoice_credit_id IS NULL AND service_refund_id IS NULL AND tax_payable_movement_id IS NULL)) AND tip_return_id IS NULL)
 OR (tip_return_id IS NOT NULL AND num_nonnulls(invoice_item_id,receivable_id,allocation_event_id,unapplication_id,fund_lot_id,
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tax_payable_movement_id)=0 AND (
  (purpose='tip_return_revenue' AND debit_cents>0 AND credit_cents=0 AND fixed_mapping_id IS NOT NULL AND money_movement_id IS NULL)
  OR (purpose='tip_return_tax' AND debit_cents>0 AND credit_cents=0 AND fixed_mapping_id IS NULL AND money_movement_id IS NULL)
  OR (purpose='tip_return_money' AND debit_cents=0 AND credit_cents>0 AND fixed_mapping_id IS NULL AND money_movement_id IS NOT NULL)
 ))) AND collection_failure_id IS NULL AND collection_failure_component_id IS NULL)
 OR (collection_failure_id IS NOT NULL AND num_nonnulls(invoice_item_id,allocation_event_id,unapplication_id,
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,tax_payable_movement_id)=0 AND (
  (purpose='collection_failure_money' AND credit_cents>0 AND debit_cents=0 AND collection_failure_component_id IS NULL
   AND num_nonnulls(receivable_id,fund_lot_id,fixed_mapping_id)=0)
  OR (collection_failure_component_id IS NOT NULL AND debit_cents>0 AND credit_cents=0 AND money_movement_id IS NULL AND (
   (purpose='collection_failure_ar' AND receivable_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL)
   OR (purpose='collection_failure_funds' AND receivable_id IS NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL)
   OR (purpose='collection_failure_tip_revenue' AND receivable_id IS NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NOT NULL)
   OR (purpose='collection_failure_tip_tax' AND num_nonnulls(receivable_id,fund_lot_id,fixed_mapping_id)=0)
  ))
 ))))
 OR (refund_transfer_adjustment_id IS NOT NULL
  AND num_nonnulls(invoice_item_id,receivable_id,tax_payable_movement_id,allocation_event_id,unapplication_id,fund_application_id,
   tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id)=0
  AND ((purpose='refund_transfer_money' AND money_movement_id IS NOT NULL AND num_nonnulls(fixed_mapping_id,fund_lot_id)=0)
    OR (purpose='refund_transfer_funds' AND money_movement_id IS NULL AND fixed_mapping_id IS NOT NULL AND fund_lot_id IS NOT NULL)
    OR (purpose='refund_transfer_fee' AND money_movement_id IS NULL AND fixed_mapping_id IS NOT NULL
      AND fund_lot_id IS NULL AND debit_cents>0 AND credit_cents=0)))))
 OR (collection_failure_recredit_id IS NOT NULL
  AND num_nonnulls(invoice_item_id,receivable_id,tax_payable_movement_id,allocation_event_id,unapplication_id,fund_application_id,
   tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,
   collection_failure_component_id,refund_transfer_adjustment_id)=0
  AND ((purpose='collection_recredit_money' AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL
    AND money_movement_id IS NOT NULL AND debit_cents>0 AND credit_cents=0)
   OR (purpose='collection_recredit_funds' AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
    AND money_movement_id IS NULL AND debit_cents=0 AND credit_cents>0)))))
 OR (collection_failure_settlement_id IS NOT NULL
 AND num_nonnulls(invoice_item_id,tax_payable_movement_id,allocation_event_id,unapplication_id,fund_application_id,tip_realization_id,
  invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id,
  refund_transfer_adjustment_id,collection_failure_recredit_id)=0 AND (
  (purpose='collection_settlement_money' AND collection_failure_settlement_component_id IS NULL AND money_movement_id IS NOT NULL
   AND num_nonnulls(receivable_id,fund_lot_id,fixed_mapping_id)=0 AND debit_cents>0 AND credit_cents=0)
  OR (collection_failure_settlement_component_id IS NOT NULL AND money_movement_id IS NULL AND debit_cents=0 AND credit_cents>0 AND (
   (purpose='collection_settlement_ar' AND receivable_id IS NOT NULL AND fund_lot_id IS NULL AND fixed_mapping_id IS NULL)
   OR (purpose='collection_settlement_funds' AND receivable_id IS NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL)
   OR (purpose='collection_settlement_tip_revenue' AND num_nonnulls(receivable_id,fund_lot_id)=0 AND fixed_mapping_id IS NOT NULL)
   OR (purpose='collection_settlement_tip_tax' AND num_nonnulls(receivable_id,fund_lot_id,fixed_mapping_id)=0)))))
);
