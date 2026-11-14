-- Registered fictional grouped recovery after incoming failure. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-grouped-recredit.sql
-- Held grouped recovery of original settled collection ranges. One verified deposit per operation.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.collection_failure_settlements (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 money_account_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 actual_on date NOT NULL,
 cents bigint NOT NULL CHECK(cents>0),
 confirmation text NOT NULL CHECK(length(confirmation)>=1 AND length(confirmation)<=1000),
 reason text NOT NULL CHECK(length(reason)>=1 AND length(reason)<=1000),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(business_id,id),
 UNIQUE(business_id,id,failure_id),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,evidence_id),
 FOREIGN KEY(business_id,failure_id) REFERENCES crest.collection_failures(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,money_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.collection_failure_settlement_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 settlement_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 failure_component_id uuid NOT NULL,
 parent_partition_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 receivable_id uuid,
 UNIQUE(business_id,id),
 UNIQUE(business_id,settlement_id,id),
 FOREIGN KEY(business_id,settlement_id,failure_id) REFERENCES crest.collection_failure_settlements(business_id,id,failure_id),
 FOREIGN KEY(business_id,failure_id,failure_component_id) REFERENCES crest.collection_failure_components(business_id,collection_failure_id,id),
 FOREIGN KEY(business_id,parent_partition_id) REFERENCES crest.funding_partitions(business_id,id),
 FOREIGN KEY(business_id,receivable_id) REFERENCES crest.receivable_items(business_id,id)
);
CREATE TABLE crest.collection_failure_recredit_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 failure_component_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 legacy_recredit_id uuid,
 settlement_component_id uuid,
 CHECK(num_nonnulls(legacy_recredit_id,settlement_component_id)=1),
 UNIQUE(business_id,legacy_recredit_id),
 UNIQUE(business_id,settlement_component_id),
 FOREIGN KEY(business_id,failure_component_id) REFERENCES crest.collection_failure_components(business_id,id),
 FOREIGN KEY(business_id,legacy_recredit_id) REFERENCES crest.collection_failure_recredits(business_id,id),
 FOREIGN KEY(business_id,settlement_component_id) REFERENCES crest.collection_failure_settlement_components(business_id,id),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,failure_component_id extensions.gist_uuid_ops WITH =,
  numrange(first_cent::numeric,last_cent::numeric,'[]') WITH &&)
);
RESET ROLE;
INSERT INTO crest.collection_failure_recredit_claims(business_id,failure_component_id,first_cent,last_cent,legacy_recredit_id)
 SELECT business_id,failure_component_id,first_cent,last_cent,id FROM crest.collection_failure_recredits;
SET LOCAL ROLE crest_schema_owner;
DO $retention$
DECLARE target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['collection_failure_settlements','collection_failure_settlement_components','collection_failure_recredit_claims'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',target);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',target);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',target);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_finance_account_owner',target);
  EXECUTE format('CREATE POLICY collection_settlement_verify ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',target);
  EXECUTE format('CREATE POLICY collection_settlement_read ON crest.%I FOR SELECT TO crest_finance_account_owner
   USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',target);
  EXECUTE format('CREATE TRIGGER collection_settlement_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
   FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',target);
 END LOOP;
END $retention$;
ALTER TABLE crest.financial_events ADD COLUMN collection_failure_settlement_id uuid;
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,collection_failure_settlement_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,collection_failure_settlement_id) REFERENCES crest.collection_failure_settlements(business_id,id);
ALTER TABLE crest.financial_events DROP CONSTRAINT financial_events_template_version_check;
ALTER TABLE crest.financial_events ADD CONSTRAINT financial_events_template_version_check CHECK(
 (template_version=1 AND num_nonnulls(refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id)=0)
 OR (template_version=2 AND refund_transfer_adjustment_id IS NOT NULL AND collection_failure_recredit_id IS NULL
  AND collection_failure_settlement_id IS NULL AND template IN('P08','P09','P10'))
 OR (template_version=2 AND template='P11' AND collection_failure_recredit_id IS NOT NULL
  AND collection_failure_settlement_id IS NULL AND refund_transfer_adjustment_id IS NULL)
 OR (template_version=3 AND template='P11' AND collection_failure_settlement_id IS NOT NULL
  AND collection_failure_recredit_id IS NULL AND refund_transfer_adjustment_id IS NULL));
ALTER TABLE crest.journal_lines ADD COLUMN collection_failure_settlement_id uuid;
ALTER TABLE crest.journal_lines ADD COLUMN collection_failure_settlement_component_id uuid;
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,collection_failure_settlement_id) REFERENCES crest.collection_failure_settlements(business_id,id);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,collection_failure_settlement_id,collection_failure_settlement_component_id)
 REFERENCES crest.collection_failure_settlement_components(business_id,settlement_id,id);
CREATE UNIQUE INDEX collection_settlement_one_deposit ON crest.journal_lines(business_id,collection_failure_settlement_id)
 WHERE purpose='collection_settlement_money';
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,collection_failure_settlement_component_id,purpose);
ALTER TABLE crest.customer_fund_lots ADD COLUMN collection_failure_settlement_component_id uuid;
ALTER TABLE crest.customer_fund_lots ADD UNIQUE(business_id,collection_failure_settlement_component_id);
ALTER TABLE crest.customer_fund_lots ADD FOREIGN KEY(business_id,collection_failure_settlement_component_id)
 REFERENCES crest.collection_failure_settlement_components(business_id,id);
ALTER TABLE crest.customer_fund_lots DROP CONSTRAINT fund_lot_one_source;
ALTER TABLE crest.customer_fund_lots ADD CONSTRAINT fund_lot_one_source CHECK(
 num_nonnulls(unapplication_id,receipt_event_id,receipt_tip_event_id,collection_failure_recredit_event_id,collection_failure_settlement_component_id)=1);

ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK((collection_failure_settlement_id IS NULL AND ((collection_failure_recredit_id IS NULL AND (
 (
 (refund_transfer_adjustment_id IS NULL AND (((
((((
((((((((
 (template IN('P01','P02') AND invoice_id IS NOT NULL AND payment_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL)
 OR (template='P03' AND payment_id IS NOT NULL AND invoice_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL
  AND zero_effect_reason IS NULL)
 OR (template='P12' AND posted_expense_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND unapplication_id IS NULL
  AND zero_effect_reason IS NULL)
 OR (template='P05' AND unapplication_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND posted_expense_id IS NULL
  AND zero_effect_reason IS NULL)) AND fund_application_id IS NULL)
 OR (template='P04' AND fund_application_id IS NOT NULL
  AND invoice_id IS NULL AND payment_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL AND zero_effect_reason IS NULL)) AND tip_realization_id IS NULL)
 OR (template='P06' AND tip_realization_id IS NOT NULL AND fund_application_id IS NULL AND invoice_id IS NULL
  AND payment_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL AND zero_effect_reason IS NULL)) AND invoice_credit_id IS NULL)
 OR (template='P07' AND invoice_credit_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL
  AND posted_expense_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND zero_effect_reason IS NULL)) AND service_refund_id IS NULL)
 OR (template='P08' AND service_refund_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND posted_expense_id IS NULL
  AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND invoice_credit_id IS NULL AND zero_effect_reason IS NULL)) AND excess_return_id IS NULL)
 OR (template='P09' AND excess_return_id IS NOT NULL AND invoice_id IS NULL AND payment_id IS NULL AND posted_expense_id IS NULL
  AND unapplication_id IS NULL AND fund_application_id IS NULL AND tip_realization_id IS NULL AND invoice_credit_id IS NULL
  AND service_refund_id IS NULL AND zero_effect_reason IS NULL)) AND tip_return_id IS NULL)
 OR (template='P10' AND tip_return_id IS NOT NULL AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,zero_effect_reason)=0)) AND collection_failure_id IS NULL)
 OR (template='P11' AND collection_failure_id IS NOT NULL AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,zero_effect_reason)=0)))
 OR (refund_transfer_adjustment_id IS NOT NULL AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,zero_effect_reason)=0)
) OR (template='P03' AND template_version=1 AND payment_id IS NOT NULL AND tip_realization_id IS NOT NULL
  AND num_nonnulls(invoice_id,posted_expense_id,unapplication_id,fund_application_id,invoice_credit_id,service_refund_id,
   excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,zero_effect_reason)=0)))
 OR (collection_failure_recredit_id IS NOT NULL AND template='P11' AND template_version=2
  AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,
   invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,zero_effect_reason)=0)))
 OR (collection_failure_settlement_id IS NOT NULL AND template='P11' AND template_version=3
 AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,
 invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,
 collection_failure_recredit_id,zero_effect_reason)=0)
);

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
   OR (purpose='collection_settlement_funds' AND receivable_id IS NULL AND fund_lot_id IS NOT NULL AND fixed_mapping_id IS NOT NULL)))))
);


CREATE POLICY collection_settlement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.collection_failure.recredit','finance.collection_failure.retire_recredit'));
CREATE POLICY collection_settlement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id
  AND command_type IN('finance.collection_failure.recredit','finance.collection_failure.retire_recredit')
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY collection_settlement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.collection_failure.recredit','finance.collection_failure.retire_recredit') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.collection_failure.recredit','finance.collection_failure.retire_recredit') AND state='committed');
CREATE POLICY collection_settlement_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.collection_failure.recredit');
CREATE POLICY collection_settlement_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='collection_failure_settlements');
CREATE POLICY collection_settlement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND EXISTS(
   SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id
    AND o.actor_id=audit_events.actor_id AND o.state='committed' AND (
     o.command_type='finance.collection_failure.recredit' AND audit_events.entity_kind='collection_failure_settlements'
     OR o.command_type='finance.collection_failure.retire_recredit' AND audit_events.entity_kind='operations' AND o.id=audit_events.entity_id)));
CREATE POLICY collection_settlement_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id AND entity_version=1
  AND origin='manual' AND import_row_id IS NULL AND EXISTS(
   SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id
    AND o.actor_id=audit_events.actor_id AND o.state='pending' AND (
     o.command_type='finance.collection_failure.recredit' AND audit_events.entity_kind='collection_failure_settlements' AND audit_events.action='recredit'
     OR o.command_type='finance.collection_failure.retire_recredit' AND audit_events.entity_kind='operations' AND audit_events.action='retire'
      AND o.id=audit_events.entity_id)));
DO $writer$
DECLARE target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['collection_failure_settlements','collection_failure_settlement_components','external_money_evidence',
  'money_movements','financial_events','atomic_finance_groups','journal_entries','journal_lines','customer_fund_lots'] LOOP
  EXECUTE format('CREATE POLICY collection_settlement_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.command_type=''finance.collection_failure.recredit'' AND o.state=''pending''))',target);
 END LOOP;
END $writer$;

-- The security-definer trigger can only append claims corresponding to inserted immutable children.
GRANT INSERT ON crest.collection_failure_recredit_claims TO crest_finance_integrity_owner;
CREATE POLICY collection_settlement_claim_append ON crest.collection_failure_recredit_claims
 FOR INSERT TO crest_finance_integrity_owner WITH CHECK(true);
CREATE FUNCTION crest_private.retain_collection_failure_recredit_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
BEGIN
 IF TG_TABLE_NAME='collection_failure_recredits' THEN
  INSERT INTO crest.collection_failure_recredit_claims(business_id,failure_component_id,first_cent,last_cent,legacy_recredit_id)
  VALUES(NEW.business_id,NEW.failure_component_id,NEW.first_cent,NEW.last_cent,NEW.id);
 ELSE
  INSERT INTO crest.collection_failure_recredit_claims(business_id,failure_component_id,first_cent,last_cent,settlement_component_id)
  VALUES(NEW.business_id,NEW.failure_component_id,NEW.first_cent,NEW.last_cent,NEW.id);
 END IF;
 RETURN NULL;
EXCEPTION WHEN exclusion_violation OR unique_violation THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_RANGE_UNAVAILABLE';
END $claim$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.retain_collection_failure_recredit_claim() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.retain_collection_failure_recredit_claim() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.retain_collection_failure_recredit_claim() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER collection_legacy_recredit_claim AFTER INSERT ON crest.collection_failure_recredits
 FOR EACH ROW EXECUTE FUNCTION crest_private.retain_collection_failure_recredit_claim();
CREATE TRIGGER collection_settlement_component_claim AFTER INSERT ON crest.collection_failure_settlement_components
 FOR EACH ROW EXECUTE FUNCTION crest_private.retain_collection_failure_recredit_claim();

-- Determine the original partition and exact invoice independent of user input.
REVOKE EXECUTE ON FUNCTION crest_private.retain_collection_failure_recredit_claim() FROM crest_schema_owner;
CREATE FUNCTION crest_private.collection_settlement_component_basis(business uuid,component uuid)
RETURNS TABLE(failure_id uuid,root_first bigint,root_last bigint,origin_id uuid,parent_partition_id uuid,customer_id uuid,
 original_receivable_id uuid,ar_account_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $source$
 SELECT f.id,c.root_first_cent,c.root_last_cent,root.id,part.id,root.customer_id,r.id,r.account_id
 FROM crest.collection_failure_components c
 JOIN crest.collection_failures f ON (f.business_id,f.id)=(c.business_id,c.collection_failure_id) AND f.kind='settled_failure'
 JOIN crest.funding_origins root ON (root.business_id,root.payment_id)=(f.business_id,f.payment_id)
 LEFT JOIN crest.allocation_events a ON (a.business_id,a.id)=(c.business_id,c.allocation_id)
 LEFT JOIN crest.customer_fund_applications application ON (application.business_id,application.id)=(c.business_id,c.fund_application_id)
 LEFT JOIN crest.tip_realizations tip ON (tip.business_id,tip.id)=(c.business_id,c.tip_realization_id)
 LEFT JOIN crest.customer_fund_lots lot ON (lot.business_id,lot.id)=(c.business_id,coalesce(c.fund_lot_id,application.fund_lot_id,tip.fund_lot_id))
 JOIN crest.funding_partitions part ON (part.business_id,part.id,part.origin_id)=(root.business_id,coalesce(a.partition_id,lot.parent_partition_id),root.id)
 LEFT JOIN crest.receivable_items r ON (r.business_id,r.id,r.customer_id)=
  (root.business_id,coalesce(a.receivable_id,application.receivable_id),root.customer_id)
 WHERE c.business_id=business AND c.id=component
  AND (coalesce(a.receivable_id,application.receivable_id) IS NULL OR r.id IS NOT NULL)
  AND (lot.id IS NULL OR (lot.origin_id,lot.customer_id)=(root.id,root.customer_id));
$source$;
REVOKE ALL ON FUNCTION crest_private.collection_settlement_component_basis(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_settlement_component_basis(uuid,uuid) TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE OR REPLACE FUNCTION crest_private.receivable_posted_deltas(requested_business uuid,requested_receivable uuid)
RETURNS TABLE(effective_on date,commit_sequence bigint,event_sequence integer,signed_cents numeric)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $deltas$
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,-a.cents::numeric
 FROM crest.allocation_events a JOIN crest.financial_events e ON e.business_id=a.business_id AND e.id=a.event_id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE a.business_id=requested_business AND a.receivable_id=requested_receivable
 UNION ALL
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,u.last_cent::numeric-u.first_cent+1
 FROM crest.allocation_unapplications u JOIN crest.allocation_events a ON a.business_id=u.business_id AND a.id=u.allocation_id
 JOIN crest.financial_events e ON e.business_id=u.business_id AND e.unapplication_id=u.id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE u.business_id=requested_business AND a.receivable_id=requested_receivable
 UNION ALL
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,-(a.last_cent::numeric-a.first_cent+1)
 FROM crest.customer_fund_applications a
 JOIN crest.financial_events e ON e.business_id=a.business_id AND e.fund_application_id=a.id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE a.business_id=requested_business AND a.receivable_id=requested_receivable
 UNION ALL
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,-c.inclusive_cents::numeric
 FROM crest.invoice_credits c
 JOIN crest.financial_events e ON e.business_id=c.business_id AND e.invoice_credit_id=c.id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE c.business_id=requested_business AND c.receivable_id=requested_receivable
 UNION ALL
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,x.net_cents::numeric
 FROM crest.collection_failure_components x JOIN crest.financial_events e
  ON (e.business_id,e.collection_failure_id)=(x.business_id,x.collection_failure_id) AND e.template='P11'
 JOIN crest.atomic_finance_groups g ON (g.business_id,g.id)=(e.business_id,e.group_id)
 LEFT JOIN crest.allocation_events a ON (a.business_id,a.id)=(x.business_id,x.allocation_id)
 LEFT JOIN crest.customer_fund_applications f ON (f.business_id,f.id)=(x.business_id,x.fund_application_id)
 WHERE x.business_id=requested_business AND coalesce(a.receivable_id,f.receivable_id)=requested_receivable
 UNION ALL
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,-sum(c.last_cent::numeric-c.first_cent+1)
 FROM crest.collection_failure_settlement_components c
 JOIN crest.financial_events e ON (e.business_id,e.collection_failure_settlement_id)=(c.business_id,c.settlement_id)
 JOIN crest.atomic_finance_groups g ON (g.business_id,g.id)=(e.business_id,e.group_id)
 WHERE c.business_id=requested_business AND c.receivable_id=requested_receivable
 GROUP BY e.id,g.id;
$deltas$;

CREATE FUNCTION crest_private.collection_settlement_receivable_capacity(
 business uuid,item uuid,on_date date,before_sequence bigint
) RETURNS numeric LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $capacity$
 WITH movements AS MATERIALIZED (
  SELECT * FROM crest_private.receivable_posted_deltas(business,item) d WHERE d.commit_sequence<before_sequence
 ), dated AS (
  SELECT effective_on,sum(signed_cents) OVER(ORDER BY effective_on,commit_sequence,event_sequence) AS running FROM movements
 )
 SELECT greatest(0,min(balance)) FROM (
  SELECT r.original_cents+coalesce((SELECT sum(signed_cents) FROM movements WHERE effective_on<=on_date),0) AS balance
  FROM crest.receivable_items r WHERE (r.business_id,r.id)=(business,item)
  UNION ALL
  SELECT r.original_cents+d.running FROM crest.receivable_items r CROSS JOIN dated d
  WHERE (r.business_id,r.id)=(business,item) AND d.effective_on>on_date
 ) b;
$capacity$;
REVOKE ALL ON FUNCTION crest_private.collection_settlement_receivable_capacity(uuid,uuid,date,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_settlement_receivable_capacity(uuid,uuid,date,bigint)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.collection_settlement_receipt(s crest.collection_failure_settlements,
 f crest.collection_failures,e crest.financial_events,m crest.money_movements,v crest.money_channel_versions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
 SELECT jsonb_build_object('schemaVersion',2,'businessId',s.business_id,'operationId',s.operation_id,'settlementId',s.id,
  'eventId',e.id,'failureId',f.id,'originalPaymentId',f.payment_id,'originalEventId',f.original_event_id,'customerId',s.customer_id,
  'moneyAccountId',s.money_account_id,'moneyChannelId',v.channel_id,'moneyChannelVersion',v.version::text,
  'moneyMovementId',m.id,'evidenceId',s.evidence_id,'actualOn',to_char(s.actual_on,'YYYY-MM-DD'),'cents',s.cents::text,
  'confirmation',s.confirmation,'reason',s.reason,'components',(
   SELECT jsonb_agg(jsonb_build_object('settlementComponentId',c.id,'failureComponentId',c.failure_component_id,
    'parentPartitionId',c.parent_partition_id,'firstCent',c.first_cent::text,'lastCent',c.last_cent::text,
    'cents',(c.last_cent-c.first_cent+1)::text,'disposition',CASE WHEN c.receivable_id IS NULL THEN 'funds' ELSE 'receivable' END,
    'receivableId',c.receivable_id,'fundLotId',l.id) ORDER BY c.first_cent,c.last_cent,c.failure_component_id)
   FROM crest.collection_failure_settlement_components c LEFT JOIN crest.customer_fund_lots l
    ON (l.business_id,l.collection_failure_settlement_component_id)=(c.business_id,c.id)
   WHERE (c.business_id,c.settlement_id)=(s.business_id,s.id)));
$receipt$;
REVOKE ALL ON FUNCTION crest_private.collection_settlement_receipt(crest.collection_failure_settlements,
 crest.collection_failures,crest.financial_events,crest.money_movements,crest.money_channel_versions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_settlement_receipt(crest.collection_failure_settlements,
 crest.collection_failures,crest.financial_events,crest.money_movements,crest.money_channel_versions)
 TO crest_finance_account_owner,crest_finance_integrity_owner;


RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_collection_failure_settlement(business uuid,event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; s crest.collection_failure_settlements; f crest.collection_failures; prior crest.financial_events;
 m crest.money_movements; v crest.money_channel_versions; proof crest.external_money_evidence; audit_receipt jsonb;
 c crest.collection_failure_settlement_components; l crest.customer_fund_lots; j crest.journal_lines; source record;
 group_seq bigint; journal uuid; exact_cents numeric:=0; line_count integer:=0; amount bigint; ar record;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE (business_id,id)=(business,event);
 SELECT * INTO STRICT s FROM crest.collection_failure_settlements WHERE (business_id,id)=(business,e.collection_failure_settlement_id);
 SELECT * INTO STRICT f FROM crest.collection_failures WHERE (business_id,id)=(business,s.failure_id);
 SELECT * INTO STRICT prior FROM crest.financial_events WHERE (business_id,collection_failure_id)=(business,f.id);
 SELECT * INTO STRICT m FROM crest.money_movements WHERE (business_id,event_id)=(business,event);
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE (business_id,id)=(business,s.channel_version_id);
 SELECT * INTO STRICT proof FROM crest.external_money_evidence WHERE (business_id,id)=(business,s.evidence_id);
 SELECT id INTO STRICT journal FROM crest.journal_entries WHERE (business_id,event_id,entry_sequence)=(business,event,1);
 SELECT commit_sequence INTO STRICT group_seq FROM crest.atomic_finance_groups WHERE (business_id,id)=(business,e.group_id);
 IF e.template<>'P11' OR e.template_version<>3 OR e.event_sequence<>1 OR f.kind<>'settled_failure'
  OR e.effective_on<>s.actual_on OR s.actual_on<f.effective_on
  OR e.posted_at<s.created_at OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR NOT EXISTS(SELECT FROM crest.payments p WHERE (p.business_id,p.id,p.customer_id)=(business,f.payment_id,s.customer_id))
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements t WHERE (t.business_id,t.event_id)=(business,event))
  OR EXISTS(SELECT FROM crest.allocation_events a WHERE (a.business_id,a.event_id)=(business,event))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 IF v.id IS DISTINCT FROM crest_private.direct_receipt_channel(business,v.channel_id,s.actual_on,e.time_zone)
  OR (v.account_id,m.account_id,m.evidence_id,m.signed_cents) IS DISTINCT FROM (s.money_account_id,s.money_account_id,s.evidence_id,s.cents)
  OR (proof.external_account_id,proof.provider_namespace,proof.confirmed_on,proof.signed_cents,proof.currency)
   IS DISTINCT FROM (s.money_account_id,v.provider_namespace,s.actual_on,s.cents,'USD'::text)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_EVIDENCE_REQUIRED';END IF;
 FOR c IN SELECT * FROM crest.collection_failure_settlement_components child WHERE (child.business_id,child.settlement_id)=(business,s.id) LOOP
  SELECT * INTO STRICT source FROM crest_private.collection_settlement_component_basis(business,c.failure_component_id);
  SELECT * INTO STRICT j FROM crest.journal_lines line
  WHERE (line.business_id,line.entry_id,line.collection_failure_settlement_component_id)=(business,journal,c.id);
  amount:=c.last_cent-c.first_cent+1;
  exact_cents:=exact_cents+amount;
  line_count:=line_count+1;
  IF (source.failure_id,source.parent_partition_id,source.customer_id) IS DISTINCT FROM (s.failure_id,c.parent_partition_id,s.customer_id)
   OR c.first_cent<source.root_first OR c.last_cent>source.root_last OR (j.debit_cents,j.credit_cents) IS DISTINCT FROM (0::bigint,amount)
   OR NOT EXISTS(SELECT FROM crest.collection_failure_recredit_claims a
    WHERE (a.business_id,a.settlement_component_id,a.failure_component_id,a.first_cent,a.last_cent)
     =(business,c.id,c.failure_component_id,c.first_cent,c.last_cent))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
  IF c.receivable_id IS NULL THEN
   SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE (business_id,collection_failure_settlement_component_id)=(business,c.id);
   IF (l.origin_id,l.parent_partition_id,l.customer_id,l.original_cents) IS DISTINCT FROM
     (source.origin_id,c.parent_partition_id,s.customer_id,amount)
    OR l.mapping_id IS DISTINCT FROM crest_private.unapplication_funds_mapping(business,s.actual_on)
    OR NOT EXISTS(SELECT FROM crest.account_mapping_versions a WHERE (a.business_id,a.id,a.account_id)=(business,l.mapping_id,l.account_id))
    OR (j.purpose,j.account_id,j.fund_lot_id,j.fixed_mapping_id) IS DISTINCT FROM ('collection_settlement_funds'::text,l.account_id,l.id,l.mapping_id)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_JOURNAL_REQUIRED';END IF;
  ELSIF c.receivable_id IS DISTINCT FROM source.original_receivable_id
   OR (j.purpose,j.account_id,j.receivable_id) IS DISTINCT FROM ('collection_settlement_ar'::text,source.ar_account_id,c.receivable_id)
   OR EXISTS(SELECT FROM crest.customer_fund_lots lot WHERE (lot.business_id,lot.collection_failure_settlement_component_id)=(business,c.id))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_JOURNAL_REQUIRED';END IF;
 END LOOP;
 FOR ar IN SELECT basis.original_receivable_id AS item,
   coalesce(sum(child.last_cent::numeric-child.first_cent+1) FILTER(WHERE child.receivable_id IS NOT NULL),0) AS ar_cents,
   coalesce(sum(child.last_cent::numeric-child.first_cent+1) FILTER(WHERE child.receivable_id IS NULL),0) AS held_cents
  FROM crest.collection_failure_settlement_components child
  CROSS JOIN LATERAL crest_private.collection_settlement_component_basis(business,child.failure_component_id) basis
  WHERE (child.business_id,child.settlement_id)=(business,s.id) AND basis.original_receivable_id IS NOT NULL
  GROUP BY basis.original_receivable_id LOOP
  IF ar.ar_cents>crest_private.collection_settlement_receivable_capacity(business,ar.item,s.actual_on,group_seq)
   OR ar.held_cents>0 AND ar.ar_cents<crest_private.collection_settlement_receivable_capacity(business,ar.item,s.actual_on,group_seq)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_RECEIVABLE_REQUIRED';END IF;
 END LOOP;
 IF exact_cents<>s.cents OR line_count NOT BETWEEN 1 AND 180
  OR (SELECT count(*) FROM crest.journal_entries x WHERE (x.business_id,x.event_id)=(business,event))<>1
  OR (SELECT count(*) FROM crest.journal_lines x WHERE (x.business_id,x.entry_id)=(business,journal))<>line_count+1
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE (x.business_id,x.entry_id,x.collection_failure_settlement_id,
    x.purpose,x.account_id,x.money_movement_id,x.debit_cents,x.credit_cents)=
   (business,journal,s.id,'collection_settlement_money',m.account_id,m.id,s.cents,0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_JOURNAL_REQUIRED';END IF;
 audit_receipt:=crest_private.collection_settlement_receipt(s,f,e,m,v);
 IF NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
  JOIN crest.atomic_finance_groups pg ON (pg.business_id,pg.id)=(prior.business_id,prior.group_id)
  JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
  JOIN crest_private.audit_events a ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  JOIN crest.accounting_periods period ON (period.business_id,period.id)=(e.business_id,e.period_id)
  WHERE (g.business_id,g.id,g.operation_id,g.created_by)=(business,e.group_id,s.operation_id,s.created_by)
   AND g.commit_sequence>pg.commit_sequence AND g.recovery_epoch=o.recovery_epoch
   AND o.command_type='finance.collection_failure.recredit' AND o.state='committed' AND o.result_schema_version=2 AND o.result=audit_receipt
   AND a.entity_kind='collection_failure_settlements' AND a.action='recredit' AND a.entity_id=s.id AND a.entity_version=1
   AND a.reason=s.reason AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',audit_receipt)
   AND e.time_zone=period.time_zone AND e.effective_on BETWEEN period.starts_on AND period.through_on
   AND e.period_generation%2=0 AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
    WHERE (h.business_id,h.period_id)=(period.business_id,period.id)),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_collection_failure_settlement(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION crest_private.verify_collection_settlement_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE linked uuid;
BEGIN
 SELECT id INTO linked FROM crest.financial_events
 WHERE (business_id,collection_failure_settlement_id)=(NEW.business_id,
  CASE WHEN TG_TABLE_NAME='collection_failure_settlements' THEN NEW.id ELSE (to_jsonb(NEW)->>'settlement_id')::uuid END);
 IF linked IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_collection_failure_settlement(NEW.business_id,linked);
 RETURN NULL;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_collection_settlement_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_collection_settlement_row() TO crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED';END IF;
 IF saved.collection_failure_settlement_id IS NOT NULL THEN
  PERFORM crest_private.verify_collection_failure_settlement(saved.business_id,saved.id);
  RETURN;
 END IF;
 IF saved.collection_failure_recredit_id IS NOT NULL THEN
  PERFORM crest_private.verify_collection_failure_held_recredit(saved.business_id,saved.id);
  RETURN;
 END IF;
 IF saved.refund_transfer_adjustment_id IS NOT NULL THEN
  PERFORM crest_private.verify_fictional_refund_transfer_adjustment(saved.business_id,saved.id);
  RETURN;
 END IF;
 CASE saved.template
  WHEN 'P01','P02' THEN PERFORM crest_private.verify_invoice_posting(saved.business_id,saved.invoice_id);
  WHEN 'P03' THEN PERFORM crest_private.verify_direct_receipt(saved.business_id,saved.id);
  WHEN 'P04' THEN PERFORM crest_private.verify_fictional_fund_application(saved.business_id,saved.id);
  WHEN 'P05' THEN PERFORM crest_private.verify_fictional_unapplication(saved.business_id,saved.id);
  WHEN 'P06' THEN PERFORM crest_private.verify_fictional_tip_realization(saved.business_id,saved.id);
  WHEN 'P07' THEN PERFORM crest_private.verify_fictional_invoice_credit(saved.business_id,saved.id);
  WHEN 'P08' THEN PERFORM crest_private.verify_fictional_service_refund(saved.business_id,saved.id);
  WHEN 'P09' THEN PERFORM crest_private.verify_fictional_excess_return(saved.business_id,saved.id);
  WHEN 'P10' THEN PERFORM crest_private.verify_fictional_tip_return(saved.business_id,saved.id);
  WHEN 'P11' THEN PERFORM crest_private.verify_fictional_collection_failure(saved.business_id,saved.id);
  WHEN 'P12' THEN PERFORM crest_private.verify_same_day_expense(saved.business_id,saved.id);
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_unapplication_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source uuid; event_id uuid;
BEGIN
 IF TG_TABLE_NAME='allocation_unapplications' THEN
  source:=NEW.id;
 ELSIF NEW.collection_failure_settlement_component_id IS NOT NULL THEN
  SELECT e.id INTO event_id FROM crest.collection_failure_settlement_components c JOIN crest.financial_events e
   ON (e.business_id,e.collection_failure_settlement_id)=(c.business_id,c.settlement_id)
  WHERE (c.business_id,c.id)=(NEW.business_id,NEW.collection_failure_settlement_component_id);
  PERFORM crest_private.verify_collection_failure_settlement(NEW.business_id,event_id);
  RETURN NULL;
 ELSIF NEW.collection_failure_recredit_event_id IS NOT NULL THEN
  PERFORM crest_private.verify_collection_failure_held_recredit(NEW.business_id,NEW.collection_failure_recredit_event_id);
  RETURN NULL;
 ELSIF NEW.receipt_event_id IS NOT NULL OR NEW.receipt_tip_event_id IS NOT NULL THEN
  PERFORM crest_private.verify_direct_receipt(NEW.business_id,coalesce(NEW.receipt_event_id,NEW.receipt_tip_event_id));
  RETURN NULL;
 ELSE
  source:=NEW.unapplication_id;
 END IF;
 SELECT e.id INTO event_id FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.unapplication_id=source;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_fictional_unapplication(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;

RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER collection_settlement_complete AFTER INSERT ON crest.collection_failure_settlements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_collection_settlement_row();
CREATE CONSTRAINT TRIGGER collection_settlement_children_complete AFTER INSERT ON crest.collection_failure_settlement_components
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_collection_settlement_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_collection_settlement_row() FROM crest_schema_owner;


SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_fictional_collection_failure_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_settlement uuid,requested_failure uuid,requested_customer uuid,
 requested_channel uuid,expected_channel_version bigint,actual_on date,verified_cents bigint,confirmation text,
 review_reason text,external_identity jsonb,requested_ranges jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; claimed uuid; previous record; e crest.financial_events; s crest.collection_failure_settlements;
 f crest.collection_failures; c crest.collection_failure_settlement_components; l crest.customer_fund_lots; m crest.money_movements;
 v crest.money_channel_versions; period record; mapping uuid; funds_account uuid; source record;
 group_id uuid; journal uuid; proof_id uuid; receipt jsonb; canonical jsonb; selected jsonb; total numeric; amount bigint;
 first_offset bigint; last_offset bigint;
BEGIN
 IF num_nonnulls(requested_operation,requested_settlement,requested_failure,requested_customer,requested_channel,
  expected_channel_version,actual_on,verified_cents,confirmation,review_reason)<>10
  OR expected_channel_version<1 OR actual_on<DATE '1900-01-01' OR actual_on>DATE '9999-12-31' OR verified_cents<1
  OR EXISTS(SELECT FROM unnest(ARRAY[confirmation,review_reason]) x(value) WHERE char_length(x.value) NOT BETWEEN 1 AND 1000
   OR x.value<>btrim(x.value) OR x.value~'[[:cntrl:]]') OR jsonb_typeof(requested_ranges) IS DISTINCT FROM 'array'
  OR octet_length(requested_ranges::text)>65536
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 IF NOT crest_private.refund_transfer_external_identity(external_identity) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_EVIDENCE_REQUIRED';END IF;
 IF jsonb_array_length(requested_ranges) NOT BETWEEN 1 AND 180 OR EXISTS(SELECT FROM jsonb_array_elements(requested_ranges) x(value)
  WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(requested_ranges) x(value)
  WHERE NOT x.value?&ARRAY['failureComponentId','firstCent','lastCent','disposition']
   OR x.value-ARRAY['failureComponentId','firstCent','lastCent','disposition']<>'{}'::jsonb
   OR EXISTS(SELECT FROM jsonb_each(x.value) field WHERE jsonb_typeof(field.value)<>'string')
   OR x.value->>'failureComponentId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR x.value->>'firstCent'!~'^[1-9][0-9]{0,18}$' OR x.value->>'lastCent'!~'^[1-9][0-9]{0,18}$'
   OR x.value->>'disposition' NOT IN('funds','receivable'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(requested_ranges) x(value)
  WHERE (x.value->>'firstCent')::numeric>(x.value->>'lastCent')::numeric OR (x.value->>'lastCent')::numeric>9223372036854775807)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 SELECT jsonb_agg(value ORDER BY lo,hi,value->>'failureComponentId'),sum(hi-lo+1) INTO canonical,total FROM (
  SELECT x.value,(x.value->>'firstCent')::numeric AS lo,(x.value->>'lastCent')::numeric AS hi
  FROM jsonb_array_elements(requested_ranges) x(value)
 ) sorted;
 IF total<>verified_cents THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_AMOUNT_REQUIRED';END IF;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.collection_failure.recredit',1,requested_business,expected_actor,expected_epoch,
  requested_settlement,requested_failure,requested_customer,requested_channel,expected_channel_version::text,to_char(actual_on,'YYYY-MM-DD'),
  verified_cents::text,confirmation,review_reason,external_identity,canonical)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.collection_failure.recredit',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO previous FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.collection_failure.recredit' AND o.state='committed';
  IF NOT FOUND OR (previous.payload_hash,previous.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',previous.result);
 END IF;

 PERFORM q.id FROM crest_private.finance_controls q WHERE q.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT failure.* INTO f FROM crest.collection_failures failure JOIN crest.payments p ON (p.business_id,p.id)=(failure.business_id,failure.payment_id)
 WHERE (failure.business_id,failure.id,failure.kind,p.customer_id)=(requested_business,requested_failure,'settled_failure',requested_customer);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_FAILURE_REQUIRED';END IF;
 IF actual_on<f.effective_on OR actual_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_DATE_REQUIRED';END IF;
 IF EXISTS(SELECT FROM crest.collection_failure_settlements q WHERE (q.business_id,q.id)=(requested_business,requested_settlement))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='COLLECTION_RECREDIT_ALREADY_RECORDED';END IF;
 SELECT * INTO v FROM crest.money_channel_versions q WHERE q.business_id=requested_business
  AND q.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,auth->>'timezone');
 IF NOT FOUND OR v.version<>expected_channel_version
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_VERIFIED_CHANNEL_REQUIRED';END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,auth->>'timezone');
 IF EXISTS(SELECT FROM crest.external_money_evidence ev WHERE ev.business_id=requested_business AND ev.provider_namespace=v.provider_namespace
  AND ev.external_account_id=v.account_id AND (ev.id_namespace,ev.external_id)=(external_identity->>'namespace',external_identity->>'id'))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='COLLECTION_RECREDIT_EXTERNAL_ID_ALREADY_RECORDED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(canonical) x(value) WHERE x.value->>'disposition'='funds') THEN
  mapping:=crest_private.unapplication_funds_mapping(requested_business,actual_on);
  SELECT q.account_id INTO funds_account FROM crest.account_mapping_versions q WHERE (q.business_id,q.id)=(requested_business,mapping);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_FUNDS_MAPPING_REQUIRED';END IF;
 END IF;
 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,v.provider_namespace,v.account_id,external_identity->>'namespace',external_identity->>'id',
  external_identity->>'rawReference','exact_case_v1',actual_on,verified_cents,'USD') RETURNING id INTO proof_id;
 INSERT INTO crest.collection_failure_settlements(id,business_id,failure_id,customer_id,channel_version_id,money_account_id,evidence_id,
  actual_on,cents,confirmation,reason,operation_id,created_by)
 VALUES(requested_settlement,requested_business,f.id,requested_customer,v.id,v.account_id,proof_id,actual_on,verified_cents,
  confirmation,review_reason,requested_operation,expected_actor) RETURNING * INTO s;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,collection_failure_settlement_id,period_id,period_generation,
  effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,s.id,period.period_id,period.generation,actual_on,auth->>'timezone','P11',3) RETURNING * INTO e;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,e.id,v.account_id,proof_id,verified_cents) RETURNING * INTO m;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal;
 INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_settlement_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal,s.id,v.account_id,m.id,'collection_settlement_money',verified_cents,0);
 FOR selected IN SELECT value FROM jsonb_array_elements(canonical) LOOP
  SELECT * INTO source FROM crest_private.collection_settlement_component_basis(requested_business,(selected->>'failureComponentId')::uuid);
  IF NOT FOUND OR (source.failure_id,source.customer_id) IS DISTINCT FROM (f.id,requested_customer) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_FAILURE_REQUIRED';END IF;
  first_offset:=(selected->>'firstCent')::bigint;
  last_offset:=(selected->>'lastCent')::bigint;
  amount:=last_offset-first_offset+1;
  IF first_offset<source.root_first OR last_offset>source.root_last THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_RANGE_UNAVAILABLE';END IF;
  IF selected->>'disposition'='receivable' AND source.original_receivable_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_RECEIVABLE_REQUIRED';END IF;
  INSERT INTO crest.collection_failure_settlement_components(business_id,settlement_id,failure_id,failure_component_id,parent_partition_id,
   first_cent,last_cent,receivable_id)
  VALUES(requested_business,s.id,f.id,(selected->>'failureComponentId')::uuid,source.parent_partition_id,first_offset,last_offset,
   CASE WHEN selected->>'disposition'='receivable' THEN source.original_receivable_id END) RETURNING * INTO c;
  IF c.receivable_id IS NULL THEN
   INSERT INTO crest.customer_fund_lots(business_id,collection_failure_settlement_component_id,origin_id,parent_partition_id,
    customer_id,account_id,mapping_id,original_cents)
   VALUES(requested_business,c.id,source.origin_id,c.parent_partition_id,requested_customer,funds_account,mapping,amount)
   RETURNING * INTO l;
   INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_settlement_id,collection_failure_settlement_component_id,
    account_id,fund_lot_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,journal,s.id,c.id,l.account_id,l.id,l.mapping_id,'collection_settlement_funds',0,amount);
  ELSE
   INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_settlement_id,collection_failure_settlement_component_id,
    account_id,receivable_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,journal,s.id,c.id,source.ar_account_id,c.receivable_id,'collection_settlement_ar',0,amount);
  END IF;
 END LOOP;
 receipt:=crest_private.collection_settlement_receipt(s,f,e,m,v);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'collection_failure_settlements',s.id,1,'recredit',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=2,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,text,text,jsonb,jsonb) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-grouped-recredit.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-operations.sql
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.lookup_fictional_collection_failure_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_settlement uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE operation crest_private.operations; s crest.collection_failure_settlements; f crest.collection_failures; e crest.financial_events; m crest.money_movements; v crest.money_channel_versions;
 receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_settlement IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO operation FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.collection_failure.recredit','finance.collection_failure.retire_recredit') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF operation.command_type='finance.collection_failure.retire_recredit' THEN
  IF (operation.result->>'originalEpoch',operation.result->>'settlementId') IS DISTINCT FROM
   (original_epoch::text,original_settlement::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
   AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='operations' AND entity_id=operation.id
   AND action='retire' AND entity_version=1;
  IF operation.result->>'reviewEpoch' IS DISTINCT FROM operation.recovery_epoch::text
   OR audit_reason IS DISTINCT FROM operation.result->>'reason'
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',operation.result)
   OR operation.payload_hash IS DISTINCT FROM encode(sha256(convert_to((operation.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',operation.result);
 END IF;
 SELECT * INTO STRICT s FROM crest.collection_failure_settlements WHERE business_id=requested_business AND operation_id=original_operation;
 IF (operation.recovery_epoch,s.id) IS DISTINCT FROM (original_epoch,original_settlement) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND collection_failure_settlement_id=s.id;
 SELECT * INTO m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
  AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='collection_failure_settlements' AND entity_id=s.id
  AND action='recredit' AND entity_version=1;
 SELECT * INTO STRICT f FROM crest.collection_failures WHERE (business_id,id)=(requested_business,s.failure_id);
 receipt:=crest_private.collection_settlement_receipt(s,f,e,m,v);
 IF operation.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM s.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_collection_failure_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_epoch uuid,original_operation uuid,original_settlement uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_collection_failure_recredit($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'settlementId',original_settlement,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.collection_failure.retire_recredit',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_collection_failure_recredit($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12);
  IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,original_operation,expected_actor,expected_actor,'operations',claim,1,'retire',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=original_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,original_operation);
 RETURN jsonb_build_object('state','retired','receipt',receipt);
END $retire$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.lookup_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.lookup_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.collection_failure_grouped_available(requested_business uuid,requested_customer uuid,requested_failure uuid)
RETURNS TABLE(failure_id uuid,payment_id uuid,failed_on date,failure_cents bigint,component_id uuid,source_kind text,
 original_receivable_id uuid,ranges nummultirange)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $available$
 SELECT f.id,f.payment_id,f.effective_on,f.cents,c.id,crest_private.collection_failure_component_kind(c),basis.original_receivable_id,
  nummultirange(numrange(c.root_first_cent::numeric,c.root_last_cent::numeric+1,'[)'))
   - coalesce((SELECT range_agg(numrange(x.first_cent::numeric,x.last_cent::numeric+1,'[)'))
    FROM crest.collection_failure_recredit_claims x WHERE (x.business_id,x.failure_component_id)=(c.business_id,c.id)),'{}'::nummultirange)
 FROM crest.collection_failures f
 JOIN crest.payments p ON (p.business_id,p.id)=(f.business_id,f.payment_id)
 JOIN crest.collection_failure_components c ON (c.business_id,c.collection_failure_id)=(f.business_id,f.id)
 CROSS JOIN LATERAL crest_private.collection_settlement_component_basis(c.business_id,c.id) basis
 WHERE (f.business_id,f.kind,p.customer_id,basis.customer_id)=(requested_business,'settled_failure',requested_customer,requested_customer)
  AND (requested_failure IS NULL OR f.id=requested_failure);
$available$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_grouped_available(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_grouped_available(uuid,uuid,uuid) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.list_fictional_collection_failure_recredits(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_customer uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE results jsonb; more boolean;
BEGIN
 IF requested_customer IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.customers c WHERE (c.business_id,c.id)=(requested_business,requested_customer))
 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('failureId',a.failure_id,'originalPaymentId',a.payment_id,
  'failedOn',to_char(a.failed_on,'YYYY-MM-DD'),'cents',a.failure_cents::text,'availableCents',a.available::text)
  ORDER BY a.failed_on DESC,a.failure_id),'[]'::jsonb) INTO results FROM (
   SELECT s.failure_id,s.payment_id,s.failed_on,s.failure_cents,sum(upper(r.value)-lower(r.value)) AS available
   FROM crest_private.collection_failure_grouped_available(requested_business,requested_customer,NULL) s
   CROSS JOIN LATERAL unnest(s.ranges) r(value)
   GROUP BY s.failure_id,s.payment_id,s.failed_on,s.failure_cents ORDER BY s.failed_on DESC,s.failure_id LIMIT 51
  ) a;
 more:=jsonb_array_length(results)>50;
 IF more THEN results:=results-50;END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'hasMore',more,'failures',results);
END $read$;

CREATE FUNCTION crest_commands.read_fictional_collection_failure_recredit_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_failure uuid,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; f crest.collection_failures; components jsonb; channels jsonb; funds_mapping jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_failure IS NULL OR actual_on IS NULL
  OR actual_on<DATE '1900-01-01' OR actual_on>DATE '9999-12-31'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT failure.* INTO f FROM crest.collection_failures failure JOIN crest.payments p
  ON (p.business_id,p.id)=(failure.business_id,failure.payment_id)
 WHERE (failure.business_id,failure.id,failure.kind,p.customer_id)=(requested_business,requested_failure,'settled_failure',requested_customer);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF actual_on<f.effective_on THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_DATE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('failureComponentId',s.component_id,'sourceKind',s.source_kind,'originalReceivableId',s.original_receivable_id,
  'originalInvoiceNumber',(SELECT invoice.invoice_number FROM crest.receivable_items item JOIN crest.invoices invoice
   ON (invoice.business_id,invoice.id)=(item.business_id,item.invoice_id) WHERE (item.business_id,item.id,item.customer_id)=
    (requested_business,s.original_receivable_id,requested_customer)),
  'receivableCapacityCents',CASE WHEN s.original_receivable_id IS NOT NULL THEN
   crest_private.collection_settlement_receivable_capacity(requested_business,s.original_receivable_id,actual_on,9223372036854775807)::text END,
  'availableRanges',ranges.value) ORDER BY s.component_id),'[]'::jsonb) INTO components
 FROM crest_private.collection_failure_grouped_available(requested_business,requested_customer,requested_failure) s
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('firstCent',lower(r.value)::text,'lastCent',(upper(r.value)-1)::text)
  ORDER BY lower(r.value)) AS value FROM (SELECT value FROM unnest(s.ranges) r(value) ORDER BY lower(value) LIMIT 181) r) ranges
 WHERE ranges.value IS NOT NULL;
 IF jsonb_array_length(components)=0 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,'label',v.label,'kind',v.kind)
  ORDER BY v.label,v.id),'[]'::jsonb) INTO channels FROM (
   SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,actual_on,zone) ORDER BY c.label,c.id LIMIT 181
  ) v;
 IF jsonb_array_length(components)>180 OR jsonb_array_length(channels)>180 OR EXISTS(SELECT FROM jsonb_array_elements(components) item
  WHERE jsonb_array_length(item->'availableRanges')>180)
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RECREDIT_OPTIONS_LIMIT';END IF;
 SELECT jsonb_build_object('mappingId',mapping.id,'accountId',mapping.account_id,'label',account.name) INTO funds_mapping
 FROM crest.account_mapping_versions mapping
 JOIN LATERAL (SELECT v.name FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(mapping.business_id,mapping.account_id)
  ORDER BY v.version DESC LIMIT 1) account ON true
 WHERE mapping.business_id=requested_business AND mapping.id=crest_private.unapplication_funds_mapping(requested_business,actual_on);
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT state FROM crest.accounting_period_locks h WHERE h.business_id=period.business_id AND h.period_id=period.id
   ORDER BY generation DESC LIMIT 1) active_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
  AND actual_on BETWEEN period.starts_on AND period.through_on AND active_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'failureId',f.id,'originalPaymentId',f.payment_id,'failedOn',to_char(f.effective_on,'YYYY-MM-DD'),
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'fundsMapping',funds_mapping,'components',components,'channels',channels);
END $options$;

CREATE OR REPLACE FUNCTION crest_private.collection_failure_held_recredit_available(requested_business uuid,requested_customer uuid,requested_failure uuid)
RETURNS TABLE(failure_id uuid,payment_id uuid,failed_on date,failure_cents bigint,component_id uuid,previous_lot_id uuid,ranges nummultirange)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $available$
 SELECT f.id,f.payment_id,f.effective_on,f.cents,c.id,l.id,
  nummultirange(numrange(c.root_first_cent::numeric,c.root_last_cent::numeric+1,'[)'))
   - coalesce((SELECT range_agg(numrange(x.first_cent::numeric,x.last_cent::numeric+1,'[)'))
    FROM crest.collection_failure_recredit_claims x WHERE (x.business_id,x.failure_component_id)=(c.business_id,c.id)),'{}'::nummultirange)
 FROM crest.collection_failures f
 JOIN crest.payments p ON (p.business_id,p.id)=(f.business_id,f.payment_id)
 JOIN crest.collection_failure_components c ON (c.business_id,c.collection_failure_id)=(f.business_id,f.id)
 JOIN crest.customer_fund_lots l ON (l.business_id,l.id)=(c.business_id,c.fund_lot_id)
 WHERE (f.business_id,f.kind,p.customer_id,l.customer_id)=(requested_business,'settled_failure',requested_customer,requested_customer)
  AND l.collection_failure_recredit_event_id IS NULL AND (requested_failure IS NULL OR f.id=requested_failure);
$available$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_fictional_collection_failure_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_collection_failure_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_collection_failure_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.read_fictional_collection_failure_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_collection_failure_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.read_fictional_collection_failure_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-operations.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-consumption.sql
-- Let invoicing consume grouped recovered lots with exact original range boundaries.

SET LOCAL ROLE crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.customer_fund_lot_origin(l crest.customer_fund_lots)
RETURNS TABLE(event_id uuid,first_cent bigint,last_cent bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $origin$
 SELECT e.id,u.first_cent,u.last_cent FROM crest.allocation_unapplications u
 JOIN crest.financial_events e ON (e.business_id,e.unapplication_id)=(u.business_id,u.id) AND e.template='P05'
 WHERE (u.business_id,u.id)=(l.business_id,l.unapplication_id)
 UNION ALL
 SELECT e.id,p.first_cent,p.last_cent FROM crest.financial_events e
 JOIN crest.funding_origins o ON (o.business_id,o.payment_id,o.id)=(e.business_id,e.payment_id,l.origin_id)
 JOIN crest.funding_partitions p ON (p.business_id,p.origin_id,p.id)=(o.business_id,o.id,l.parent_partition_id)
 WHERE (e.business_id,e.id)=(l.business_id,l.receipt_event_id) AND e.template='P03'
   AND o.customer_id=l.customer_id AND p.last_cent-p.first_cent+1=l.original_cents
 UNION ALL
 SELECT e.id,r.first_cent,r.last_cent
 FROM crest.financial_events e
 JOIN crest.collection_failure_recredits r ON (r.business_id,r.id)=(e.business_id,e.collection_failure_recredit_id)
 JOIN crest.collection_failures f ON (f.business_id,f.id)=(r.business_id,r.failure_id)
 JOIN crest.funding_origins o ON (o.business_id,o.id,o.payment_id,o.customer_id)=(f.business_id,l.origin_id,f.payment_id,l.customer_id)
 WHERE (e.business_id,e.id)=(l.business_id,l.collection_failure_recredit_event_id) AND e.template='P11'
   AND r.last_cent-r.first_cent+1=l.original_cents
 UNION ALL
 SELECT e.id,c.first_cent,c.last_cent
 FROM crest.collection_failure_settlement_components c
 JOIN crest.collection_failure_settlements s ON (s.business_id,s.id)=(c.business_id,c.settlement_id)
 JOIN crest.financial_events e ON (e.business_id,e.collection_failure_settlement_id)=(s.business_id,s.id) AND e.template='P11'
 JOIN crest.collection_failures f ON (f.business_id,f.id)=(s.business_id,s.failure_id)
 JOIN crest.funding_origins o ON (o.business_id,o.id,o.payment_id,o.customer_id)=(f.business_id,l.origin_id,f.payment_id,l.customer_id)
 WHERE (c.business_id,c.id,c.parent_partition_id)=(l.business_id,l.collection_failure_settlement_component_id,l.parent_partition_id)
  AND c.receivable_id IS NULL AND c.last_cent-c.first_cent+1=l.original_cents;
$origin$;

CREATE OR REPLACE FUNCTION crest_private.fictional_fund_application_receipt(a crest.customer_fund_applications,l crest.customer_fund_lots,
 e crest.financial_events,r crest.receivable_items)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',CASE WHEN l.collection_failure_settlement_component_id IS NOT NULL THEN 4 WHEN l.collection_failure_recredit_event_id IS NOT NULL THEN 3 WHEN l.receipt_event_id IS NOT NULL THEN 2 ELSE 1 END,'businessId',a.business_id,'fundApplicationId',a.id,'operationId',a.operation_id,
  'eventId',e.id,'fundLotId',l.id,'unapplicationId',l.unapplication_id,'fundingOriginId',l.origin_id,
  'parentPartitionId',l.parent_partition_id,'customerId',l.customer_id,'receivableId',r.id,'invoiceId',r.invoice_id,
  'arAccountId',r.account_id,'fundsAccountId',l.account_id,'mappingId',l.mapping_id,
  'effectiveOn',to_char(e.effective_on,'YYYY-MM-DD'),'firstCent',a.first_cent::text,'lastCent',a.last_cent::text,
  'cents',(a.last_cent-a.first_cent+1)::text,'reason',a.reason)
 || CASE WHEN l.collection_failure_settlement_component_id IS NOT NULL THEN jsonb_build_object(
   'collectionFailureSettlementEventId',(SELECT event_id FROM crest_private.customer_fund_lot_origin(l)),
   'collectionFailureSettlementComponentId',l.collection_failure_settlement_component_id)
   WHEN l.collection_failure_recredit_event_id IS NOT NULL THEN jsonb_build_object('collectionFailureRecreditEventId',l.collection_failure_recredit_event_id)
   WHEN l.receipt_event_id IS NOT NULL THEN jsonb_build_object('receiptEventId',l.receipt_event_id) ELSE '{}'::jsonb END;
$snapshot$;

RESET ROLE;

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_fund_application(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; a crest.customer_fund_applications; l crest.customer_fund_lots; source_lot record;
 r crest.receivable_items; held crest.financial_events; issued crest.financial_events; journal uuid; receipt jsonb; cents bigint;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT a FROM crest.customer_fund_applications WHERE business_id=requested_business AND id=e.fund_application_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=a.fund_lot_id;
 SELECT * INTO STRICT source_lot FROM crest_private.customer_fund_lot_origin(l);
 SELECT * INTO STRICT held FROM crest.financial_events WHERE business_id=requested_business AND id=source_lot.event_id;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=a.receivable_id;
 SELECT * INTO STRICT issued FROM crest.financial_events WHERE business_id=requested_business AND invoice_id=r.invoice_id;
 cents:=a.last_cent-a.first_cent+1;
 receipt:=crest_private.fictional_fund_application_receipt(a,l,e,r);
 IF e.template<>'P04' OR e.event_sequence<>1 OR (NOT (held.template IN('P03','P05') OR
  held.template='P11' AND (held.collection_failure_recredit_id IS NOT NULL AND l.collection_failure_recredit_event_id=held.id OR held.collection_failure_settlement_id IS NOT NULL AND l.collection_failure_settlement_component_id IS NOT NULL))) OR issued.template NOT IN('P01','P02')
  OR r.customer_id<>l.customer_id OR NOT crest_private.fund_application_controls_active(l,r)
  OR e.effective_on<greatest(held.effective_on,issued.effective_on) OR e.posted_at<a.created_at
  OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR a.first_cent<source_lot.first_cent OR a.last_cent>source_lot.last_cent
  OR NOT EXISTS(SELECT FROM crest.fund_lot_range_consumptions c WHERE c.business_id=a.business_id
   AND (c.fund_application_id,c.fund_lot_id,c.first_cent,c.last_cent)=(a.id,l.id,a.first_cent,a.last_cent))
  OR NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents)
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest.atomic_finance_groups prior ON prior.business_id=held.business_id AND prior.id=held.group_id
   JOIN crest.atomic_finance_groups original ON original.business_id=issued.business_id AND original.id=issued.group_id
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest_private.audit_events audit ON audit.business_id=o.business_id AND audit.operation_id=o.operation_id AND audit.actor_id=o.actor_id
   JOIN crest.accounting_periods p ON p.business_id=e.business_id AND p.id=e.period_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=a.operation_id AND g.created_by=a.created_by
    AND g.commit_sequence>greatest(prior.commit_sequence,original.commit_sequence) AND g.recovery_epoch=o.recovery_epoch
    AND o.command_type='finance.funds.apply' AND o.state='committed' AND o.result=receipt
    AND audit.entity_kind='customer_fund_applications' AND audit.entity_id=a.id AND audit.entity_version=1 AND audit.action='apply'
    AND audit.reason=a.reason AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
    AND e.time_zone=p.time_zone AND e.effective_on BETWEEN p.starts_on AND p.through_on
    AND e.period_generation%2=0
    AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
     WHERE h.business_id=p.business_id AND h.period_id=p.id),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_SOURCE_REQUIRED';END IF;

 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR (SELECT count(*) FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal)<>2
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='apply_funds' AND x.fund_lot_id=l.id AND x.account_id=l.account_id AND x.fixed_mapping_id=l.mapping_id
   AND x.debit_cents=cents AND x.fund_application_id=a.id)
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='apply_ar' AND x.receivable_id=r.id AND x.account_id=r.account_id AND x.credit_cents=cents AND x.fund_application_id=a.id)
  OR EXISTS(SELECT FROM crest.money_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE x.business_id=e.business_id AND x.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_JOURNAL_REQUIRED';END IF;
END $verify$;

CREATE OR REPLACE FUNCTION crest_commands.realize_fictional_held_tip(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_tip uuid,requested_fund_lot uuid,requested_customer uuid,
 reviewed_on date,requested_first_cent bigint,requested_last_cent bigint,requested_jurisdiction text,
 expected_tax_profile uuid,expected_revenue_mapping uuid,expected_tax_mapping uuid,intent_evidence text,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; l crest.customer_fund_lots; u crest.allocation_unapplications;
 held crest.financial_events; t crest.tip_realizations; e crest.financial_events; basis record; period record;
 claimed uuid; group_id uuid; journal_id uuid; charge jsonb; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_tip IS NULL OR requested_fund_lot IS NULL OR requested_customer IS NULL
  OR reviewed_on IS NULL OR reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31'
  OR requested_first_cent IS NULL OR requested_last_cent IS NULL OR requested_first_cent<1 OR requested_last_cent<requested_first_cent
  OR requested_jurisdiction IS NULL OR char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
  OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]'
  OR expected_tax_profile IS NULL OR expected_revenue_mapping IS NULL
  OR intent_evidence IS NULL OR char_length(intent_evidence) NOT BETWEEN 1 AND 1000 OR intent_evidence<>btrim(intent_evidence)
  OR intent_evidence~'[[:cntrl:]]' OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_REALIZATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.tip.realize',1,requested_business,expected_actor,expected_epoch,
  requested_tip,requested_fund_lot,requested_customer,reviewed_on,requested_first_cent::text,requested_last_cent::text,
  requested_jurisdiction,expected_tax_profile,expected_revenue_mapping,expected_tax_mapping,intent_evidence,review_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.tip.realize',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.tip.realize' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=requested_fund_lot AND customer_id=requested_customer;
 IF NOT FOUND OR num_nonnulls(l.collection_failure_recredit_event_id,l.collection_failure_settlement_component_id)>0 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_LOT_REQUIRED';END IF;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=requested_business AND id=l.unapplication_id;
 SELECT * INTO STRICT held FROM crest.financial_events WHERE business_id=requested_business AND unapplication_id=u.id;
 IF reviewed_on<held.effective_on OR reviewed_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_DATE_REQUIRED';
 END IF;
 IF requested_first_cent<u.first_cent OR requested_last_cent>u.last_cent OR EXISTS(
  SELECT FROM crest.fund_lot_range_consumptions taken WHERE taken.business_id=requested_business AND taken.fund_lot_id=l.id
   AND numrange(taken.first_cent::numeric,taken.last_cent::numeric,'[]') &&
    numrange(requested_first_cent::numeric,requested_last_cent::numeric,'[]'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_RANGE_UNAVAILABLE';END IF;
 IF EXISTS(SELECT FROM crest.tip_realizations x WHERE x.business_id=requested_business AND x.id=requested_tip) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='TIP_REALIZATION_ALREADY_RECORDED';
 END IF;
 SELECT * INTO basis FROM crest_private.fictional_tip_posting_basis(l,requested_jurisdiction,reviewed_on);
 IF NOT FOUND OR (basis.profile_id,basis.revenue_mapping_id,basis.tax_mapping_id)
  IS DISTINCT FROM (expected_tax_profile,expected_revenue_mapping,expected_tax_mapping) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_BASIS_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,reviewed_on,auth->>'timezone');
 charge:=crest_private.finance_tax_charge(requested_last_cent-requested_first_cent+1,0,coalesce(basis.rate,0));

 INSERT INTO crest.tip_realizations(id,business_id,fund_lot_id,first_cent,last_cent,net_cents,tax_cents,jurisdiction,
  tax_profile_id,revenue_mapping_id,revenue_account_id,tax_mapping_id,tax_account_id,customer_intent_evidence,reason,operation_id,created_by)
 VALUES(requested_tip,requested_business,l.id,requested_first_cent,requested_last_cent,(charge->>'netCents')::bigint,
  (charge->>'taxCents')::bigint,requested_jurisdiction,basis.profile_id,basis.revenue_mapping_id,basis.revenue_account_id,
  basis.tax_mapping_id,basis.tax_account_id,intent_evidence,review_reason,requested_operation,expected_actor) RETURNING * INTO t;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,tip_realization_id,period_id,period_generation,effective_on,time_zone,
  template,template_version)
 VALUES(requested_business,group_id,1,t.id,period.period_id,period.generation,reviewed_on,auth->>'timezone','P06',1) RETURNING * INTO e;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,tip_realization_id,fund_lot_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,t.id,l.id,l.account_id,l.mapping_id,'tip_funds',t.inclusive_cents,0);
 IF t.net_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,tip_realization_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,t.id,t.revenue_account_id,t.revenue_mapping_id,'tip_revenue',0,t.net_cents);
 END IF;
 IF t.tax_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,tip_realization_id,account_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,t.id,t.tax_account_id,'tip_tax',0,t.tax_cents);
 END IF;
 receipt:=crest_private.fictional_tip_realization_receipt(t,l,e);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'tip_realizations',t.id,1,'realize',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE OR REPLACE FUNCTION crest_private.fictional_posted_report_context_v10(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND (e.template_version NOT IN(1,2,3) OR e.template NOT IN('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED';
 END IF;
 IF EXISTS(
  SELECT FROM crest.financial_events e LEFT JOIN crest.journal_entries j
   ON j.business_id=e.business_id AND j.event_id=e.id
  LEFT JOIN LATERAL(SELECT count(*) AS n,sum(l.debit_cents::numeric) AS debit,sum(l.credit_cents::numeric) AS credit
   FROM crest.journal_lines l WHERE l.business_id=e.business_id AND l.entry_id=j.id) amounts ON true
  WHERE e.business_id=requested_business AND e.effective_on<=through_on
   AND ((e.zero_effect_reason IS NULL AND (j.id IS NULL OR amounts.n<2 OR amounts.debit IS DISTINCT FROM amounts.credit))
    OR (e.zero_effect_reason IS NOT NULL AND j.id IS NOT NULL))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_LEDGER_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH booked AS (
   SELECT r.id,r.account_id,r.original_cents::numeric+coalesce((
    SELECT sum(d.signed_cents) FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d WHERE d.effective_on<=through_on
   ),0) AS outstanding
   FROM crest.receivable_items r JOIN crest.financial_events issue ON issue.business_id=r.business_id AND issue.invoice_id=r.invoice_id
   WHERE r.business_id=requested_business AND issue.effective_on<=through_on
  ), ledger AS (
   SELECT l.receivable_id,l.account_id,sum(l.debit_cents::numeric-l.credit_cents::numeric) AS balance
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND l.receivable_id IS NOT NULL AND e.effective_on<=through_on
   GROUP BY l.receivable_id,l.account_id
  )
  SELECT FROM booked b FULL JOIN ledger l ON l.receivable_id=b.id AND l.account_id=b.account_id
  WHERE b.id IS NULL OR l.receivable_id IS NULL OR b.outstanding<0 OR b.outstanding IS DISTINCT FROM l.balance
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_RECEIVABLE_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH source AS (
   SELECT m.id,m.event_id,m.account_id,m.signed_cents FROM crest.money_movements m
   JOIN crest.financial_events e ON e.business_id=m.business_id AND e.id=m.event_id
   WHERE m.business_id=requested_business AND e.effective_on<=through_on
  ), ledger AS (
   SELECT l.money_movement_id,j.event_id,l.account_id,(l.debit_cents::numeric-l.credit_cents::numeric) AS net
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND l.money_movement_id IS NOT NULL AND e.effective_on<=through_on
  )
  SELECT FROM source s FULL JOIN ledger l ON l.money_movement_id=s.id AND l.event_id=s.event_id AND l.account_id=s.account_id
  WHERE s.id IS NULL OR l.money_movement_id IS NULL OR s.signed_cents IS DISTINCT FROM l.net
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_MONEY_CONTROL_FAILED';END IF;
 -- A no-movement correction adjusts the recorded account. It must match the
 -- retained source and ties independently of the verified external-movement rows.
 IF EXISTS(
  WITH corrections AS (
   SELECT e.id AS event_id,s.money_account_id AS account_id,-s.cents::numeric AS cents
   FROM crest.collection_failures s
   JOIN crest.financial_events e ON (e.business_id,e.collection_failure_id)=(s.business_id,s.id)
   WHERE s.business_id=requested_business AND s.kind='recording_error' AND e.effective_on<=through_on
  ), ledger AS (
   SELECT e.id AS event_id,l.account_id,(l.debit_cents::numeric-l.credit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id)
   JOIN crest.financial_events e ON (e.business_id,e.id)=(j.business_id,j.event_id)
   WHERE l.business_id=requested_business AND l.purpose='collection_failure_money'
    AND l.money_movement_id IS NULL AND e.effective_on<=through_on
  )
  SELECT FROM corrections c FULL JOIN ledger l ON (l.event_id,l.account_id)=(c.event_id,c.account_id)
  WHERE c.event_id IS NULL OR l.event_id IS NULL OR c.cents IS DISTINCT FROM l.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_MONEY_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH ordinary_lots AS (
   SELECT l.id,l.account_id,l.original_cents::numeric-coalesce((
    SELECT sum(a.last_cent::numeric-a.first_cent+1) FROM crest.fund_lot_range_consumptions a
    JOIN crest.financial_events applied ON applied.business_id=a.business_id
     AND ((a.fund_application_id IS NOT NULL AND applied.fund_application_id=a.fund_application_id)
      OR (a.tip_realization_id IS NOT NULL AND applied.tip_realization_id=a.tip_realization_id)
      OR (a.service_refund_id IS NOT NULL AND applied.service_refund_id=a.service_refund_id)
      OR (a.excess_return_id IS NOT NULL AND applied.excess_return_id=a.excess_return_id)
      OR (a.collection_failure_component_id IS NOT NULL AND EXISTS(
       SELECT FROM crest.collection_failure_components c
       WHERE (c.business_id,c.id,c.collection_failure_id)=(a.business_id,a.collection_failure_component_id,applied.collection_failure_id))))
    WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id AND applied.effective_on<=through_on
   ),0) AS available FROM crest.customer_fund_lots l
   JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id OR e.id=l.receipt_tip_event_id OR e.id=l.collection_failure_recredit_event_id OR EXISTS(SELECT FROM crest.collection_failure_settlement_components cc
    WHERE (cc.business_id,cc.id,cc.settlement_id)=(l.business_id,l.collection_failure_settlement_component_id,e.collection_failure_settlement_id)))
   WHERE l.business_id=requested_business AND e.effective_on<=through_on
  ), refund_due AS (
   SELECT q.fund_lot_id,q.account_id,sum(q.remaining_cents) AS cents
   FROM crest_private.fictional_refund_due_amounts(requested_business,through_on) q
   GROUP BY q.fund_lot_id,q.account_id
  ), journal AS (
   SELECT l.fund_lot_id,l.account_id,
    coalesce(sum(l.credit_cents::numeric-l.debit_cents::numeric) FILTER(WHERE l.refund_transfer_adjustment_id IS NULL),0) AS ordinary,
    coalesce(sum(l.credit_cents::numeric-l.debit_cents::numeric) FILTER(WHERE l.refund_transfer_adjustment_id IS NOT NULL),0) AS refund_due
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND e.effective_on<=through_on AND l.fund_lot_id IS NOT NULL
   GROUP BY l.fund_lot_id,l.account_id
  )
  SELECT FROM ordinary_lots a FULL JOIN journal j ON (j.fund_lot_id,j.account_id)=(a.id,a.account_id)
  FULL JOIN refund_due d ON (d.fund_lot_id,d.account_id)=
   (coalesce(a.id,j.fund_lot_id),coalesce(a.account_id,j.account_id))
  WHERE a.id IS NULL OR a.available<0 OR a.available IS DISTINCT FROM coalesce(j.ordinary,0)
   OR coalesce(d.cents,0)<0 OR coalesce(d.cents,0) IS DISTINCT FROM coalesce(j.refund_due,0)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH booked AS (
   SELECT m.account_id,sum(m.cents::numeric) AS cents
   FROM crest.invoice_tax_payable_movements m JOIN crest.financial_events e ON e.business_id=m.business_id AND e.id=m.event_id
   WHERE m.business_id=requested_business AND e.effective_on<=through_on GROUP BY m.account_id
   UNION ALL
   SELECT t.tax_account_id,sum(t.tax_cents::numeric)
   FROM crest.tip_realizations t JOIN crest.financial_events e ON e.business_id=t.business_id AND e.tip_realization_id=t.id
   WHERE t.business_id=requested_business AND t.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT t.tax_account_id,-sum(r.tax_cents::numeric)
   FROM crest.tip_returns r JOIN crest.tip_realizations t ON (t.business_id,t.id)=(r.business_id,r.tip_realization_id)
   JOIN crest.financial_events e ON (e.business_id,e.tip_return_id)=(r.business_id,r.id) AND e.template='P10'
   WHERE r.business_id=requested_business AND r.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT t.tax_account_id,-sum(c.tax_cents::numeric)
   FROM crest.collection_failure_components c
   JOIN crest.tip_realizations t ON (t.business_id,t.id)=(c.business_id,c.tip_realization_id)
   JOIN crest.financial_events e ON (e.business_id,e.collection_failure_id)=(c.business_id,c.collection_failure_id)
   WHERE c.business_id=requested_business AND c.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT c.tax_account_id,-sum(c.tax_cents::numeric)
   FROM crest.invoice_credits c JOIN crest.financial_events e ON e.business_id=c.business_id AND e.invoice_credit_id=c.id
   WHERE c.business_id=requested_business AND c.tax_cents>0 AND e.effective_on<=through_on GROUP BY c.tax_account_id
  ), source AS (
   SELECT account_id,sum(cents) AS cents FROM booked GROUP BY account_id
  ), ledger AS (
   SELECT l.account_id,sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   JOIN crest.accounts a ON a.business_id=l.business_id AND a.id=l.account_id
   WHERE l.business_id=requested_business AND a.control_kind='tax_payable' AND e.effective_on<=through_on
   GROUP BY l.account_id
  )
  SELECT FROM source s FULL JOIN ledger l ON l.account_id=s.account_id
  WHERE s.account_id IS NULL OR l.account_id IS NULL OR s.cents IS DISTINCT FROM l.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_TAX_CONTROL_FAILED';END IF;
 RETURN jsonb_build_object('schemaVersion',10,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'refundDue',crest_private.fictional_refund_due_body(requested_business,through_on),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12')),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true,'taxPayableTie',true));
END $report$;

CREATE OR REPLACE FUNCTION crest_commands.read_fictional_customer_funds(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $funds$
DECLARE auth jsonb; zone text; selected date; result jsonb; ties boolean;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH verified AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context_v10(requested_business,selected,zone) AS context
 ), ledger AS MATERIALIZED (
  SELECT j.fund_lot_id,sum(j.credit_cents::numeric-j.debit_cents::numeric) AS cents
  FROM crest.journal_lines j
  JOIN crest.accounts a ON (a.business_id,a.id)=(j.business_id,j.account_id)
  JOIN crest.journal_entries entry ON (entry.business_id,entry.id)=(j.business_id,j.entry_id)
  JOIN crest.financial_events e ON (e.business_id,e.id)=(entry.business_id,entry.event_id)
  WHERE j.business_id=requested_business AND a.code='2000' AND e.effective_on<=selected
   AND j.refund_transfer_adjustment_id IS NULL
  GROUP BY j.fund_lot_id
 ), lots AS MATERIALIZED (
  SELECT l.id,l.origin_id,l.customer_id,c.display_name,e.effective_on,d.cents
  FROM ledger d
  JOIN crest.customer_fund_lots l ON (l.business_id,l.id)=(requested_business,d.fund_lot_id)
  JOIN crest.customers c ON (c.business_id,c.id)=(l.business_id,l.customer_id)
  JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id OR e.id=l.collection_failure_recredit_event_id OR EXISTS(SELECT FROM crest.collection_failure_settlement_components cc
    WHERE (cc.business_id,cc.id,cc.settlement_id)=(l.business_id,l.collection_failure_settlement_component_id,e.collection_failure_settlement_id)))
  WHERE d.cents>0 AND e.effective_on<=selected
 ), totals AS (
  SELECT count(*)::text AS count,coalesce(sum(cents),0) AS cents FROM lots
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'throughOn',v.context->>'throughOn',
   'observedAt',v.context->>'observedAt','timeZone',zone,'currency','USD',
   'lotCount',t.count,'totalCents',t.cents::text,'rows',coalesce((
    SELECT jsonb_agg(jsonb_build_object('lotId',p.id,'originId',p.origin_id,'customerId',p.customer_id,
     'customerName',p.display_name,'heldOn',to_char(p.effective_on,'YYYY-MM-DD'),'heldCents',p.cents::text)
     ORDER BY p.effective_on,p.id)
    FROM (SELECT * FROM lots ORDER BY effective_on,id LIMIT 100) p
   ),'[]'::jsonb)),
   t.cents=(SELECT coalesce(sum(cents),0) FROM ledger)
    AND NOT EXISTS(SELECT FROM ledger WHERE fund_lot_id IS NULL OR cents<0)
 INTO result,ties FROM verified v CROSS JOIN totals t;
 IF ties IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED';
 END IF;
 RETURN result;
END $funds$;

RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-consumption.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-report.sql
-- Held v13 journal preserves the verified P11 recovery's source dimensions.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.fictional_journal_body_v14(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE body jsonb; rows jsonb;
BEGIN
 body:=crest_private.fictional_journal_body_v13(requested_business,through_on,requested_account,after_line,page_limit);
 SELECT coalesce(jsonb_agg(j.row||jsonb_build_object('collectionFailureSettlementId',r.id,'collectionFailureSettlementComponentId',c.id,'settledFailureId',r.failure_id,
   'settledFailureComponentId',c.failure_component_id,'settledPaymentId',f.payment_id) ORDER BY j.position),'[]'::jsonb)
 INTO rows FROM jsonb_array_elements(body->'rows') WITH ORDINALITY j(row,position)
 JOIN crest.journal_lines line ON (line.business_id,line.id)=(requested_business,(j.row->>'lineId')::uuid)
 LEFT JOIN crest.collection_failure_settlements r ON (r.business_id,r.id)=(line.business_id,line.collection_failure_settlement_id)
 LEFT JOIN crest.collection_failure_settlement_components c ON (c.business_id,c.id)=(line.business_id,line.collection_failure_settlement_component_id)
 LEFT JOIN crest.collection_failures f ON (f.business_id,f.id)=(r.business_id,r.failure_id);
 IF jsonb_array_length(rows)<>jsonb_array_length(body->'rows') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_LEDGER_CONTROL_FAILED';
 END IF;
 RETURN jsonb_set(body,'{rows}',rows);
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_journal_body_v14(uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_journal_body_v14(uuid,date,uuid,uuid,integer) TO crest_finance_account_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_journal_v14(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date,
 requested_account uuid,after_line uuid,page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context_v10(requested_business,selected,zone)||
  crest_private.fictional_journal_body_v14(requested_business,selected,requested_account,after_line,page_limit)||jsonb_build_object('schemaVersion',14) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_journal_v14(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_journal_v14(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-report.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-source.sql
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
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HELD_TIP_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE FUNCTION crest_private.collection_failure_grouped_recredit_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('collection_failure_settlements',ARRAY['id','business_id','failure_id','customer_id','channel_version_id','money_account_id',
  'evidence_id','actual_on','cents','confirmation','reason','operation_id','created_by','created_at']),
 ('collection_failure_settlement_components',ARRAY['id','business_id','settlement_id','failure_id','failure_component_id',
  'parent_partition_id','first_cent','last_cent','receivable_id']),
 ('collection_failure_recredit_claims',ARRAY['id','business_id','failure_component_id','first_cent','last_cent','legacy_recredit_id','settlement_component_id']),
 ('customer_fund_lots',ARRAY['id','business_id','unapplication_id','origin_id','parent_partition_id','customer_id',
  'account_id','mapping_id','original_cents','receipt_event_id','receipt_tip_event_id','collection_failure_recredit_event_id','collection_failure_settlement_component_id']),
 ('financial_events',ARRAY['id','business_id','group_id','event_sequence','invoice_id','period_id','period_generation',
  'reopened_generation','effective_on','time_zone','template','template_version','zero_effect_reason','posted_at',
  'payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id',
  'collection_failure_id','refund_transfer_adjustment_id','collection_failure_recredit_id','collection_failure_settlement_id']),
 ('atomic_finance_groups',ARRAY['id','business_id','commit_sequence','recovery_epoch','created_by','operation_id','created_at']),
 ('journal_entries',ARRAY['id','business_id','event_id','entry_sequence']),
 ('journal_lines',ARRAY['id','business_id','entry_id','invoice_item_id','receivable_id','account_id','fixed_mapping_id',
  'tax_payable_movement_id','purpose','debit_cents','credit_cents','money_movement_id','allocation_event_id','unapplication_id',
  'fund_lot_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id',
  'collection_failure_id','collection_failure_component_id','refund_transfer_adjustment_id','collection_failure_recredit_id','collection_failure_settlement_id','collection_failure_settlement_component_id']),
 ('money_movements',ARRAY['id','business_id','event_id','account_id','evidence_id','signed_cents']),
 ('external_money_evidence',ARRAY['id','business_id','provider_namespace','external_account_id','id_namespace','external_id',
  'raw_reference','normalization_rule','confirmed_on','signed_cents','currency']);
$dictionary$;

REVOKE ALL ON FUNCTION crest_private.collection_failure_grouped_recredit_source_dictionary() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION crest_private.collection_failure_grouped_recredit_source_dictionary() TO crest_refund_transfer_export_owner;

DO $grants$
DECLARE source record; relation oid; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.collection_failure_grouped_recredit_source_dictionary() LOOP
  SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='crest' AND c.relname=source.group_name AND c.relkind='r'
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
  IF relation IS NULL OR source.fields IS DISTINCT FROM (SELECT array_agg(attname::text ORDER BY attnum)
   FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped)
   OR has_any_column_privilege('crest_export',relation,'SELECT,INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='COLLECTION_RECREDIT_SOURCE_REVIEW_REQUIRED';END IF;
  SELECT string_agg(format('%I',name),',') INTO columns FROM unnest(source.fields) AS name;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_refund_transfer_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;

CREATE POLICY collection_grouped_export ON crest.collection_failure_settlements FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY collection_grouped_export ON crest.collection_failure_settlement_components FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY collection_grouped_export ON crest.collection_failure_recredit_claims FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY collection_grouped_export ON crest.customer_fund_lots FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND collection_failure_settlement_component_id IS NOT NULL
  AND current_setting('crest.collection_failure_grouped_source',true)='on');
CREATE POLICY collection_grouped_export ON crest.financial_events FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND collection_failure_settlement_id IS NOT NULL
  AND current_setting('crest.collection_failure_grouped_source',true)='on');
CREATE FUNCTION crest_commands.collection_failure_grouped_recredit_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source record; history jsonb; rows jsonb:='{}'::jsonb; items jsonb; projection text; filter text; row_count integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='COLLECTION_RECREDIT_SOURCE_SNAPSHOT_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true),
  set_config('crest.collection_failure_grouped_source','on',true),set_config('crest.refund_transfer_fee_source','',true);
 FOR source IN SELECT * FROM crest_private.collection_failure_grouped_recredit_source_dictionary() LOOP
  SELECT string_agg(format('%L,%s',name,
   CASE WHEN name IN('created_at','posted_at') THEN
    format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
  INTO projection FROM unnest(source.fields) WITH ORDINALITY AS f(name,position);
  filter:=CASE source.group_name
   WHEN 'financial_events' THEN ' AND t.collection_failure_settlement_id IS NOT NULL'
   WHEN 'atomic_finance_groups' THEN ' AND EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=t.business_id AND e.group_id=t.id AND e.collection_failure_settlement_id IS NOT NULL)'
   WHEN 'journal_entries' THEN ' AND EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=t.business_id AND e.id=t.event_id AND e.collection_failure_settlement_id IS NOT NULL)'
   WHEN 'journal_lines' THEN ' AND t.collection_failure_settlement_id IS NOT NULL'
   WHEN 'money_movements' THEN ' AND EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=t.business_id AND e.id=t.event_id AND e.collection_failure_settlement_id IS NOT NULL)'
   WHEN 'external_money_evidence' THEN ' AND EXISTS(SELECT FROM crest.collection_failure_settlements r WHERE r.business_id=t.business_id AND r.evidence_id=t.id)'
   WHEN 'customer_fund_lots' THEN ' AND t.collection_failure_settlement_component_id IS NOT NULL'
   ELSE '' END;
  EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY id),''[]''::jsonb) FROM (
   SELECT t.id,jsonb_build_object(%s) AS value FROM crest.%I t WHERE t.business_id=$1%s ORDER BY t.id LIMIT 1001
   ) scoped',projection,source.group_name,filter) INTO items USING requested_business;
  row_count:=row_count+jsonb_array_length(items);
  IF row_count>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RECREDIT_SOURCE_LIMIT';END IF;
  rows:=rows||jsonb_build_object(source.group_name,items);
 END LOOP;
 PERFORM set_config('crest.collection_failure_grouped_source','',true);
 IF octet_length(rows::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RECREDIT_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'historySnapshotToken',history->>'snapshotToken','rows',rows);
END $snapshot$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_refund_transfer_export_owner;
ALTER FUNCTION crest_commands.collection_failure_grouped_recredit_source_snapshot(uuid) OWNER TO crest_refund_transfer_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_refund_transfer_export_owner;
REVOKE ALL ON FUNCTION crest_commands.collection_failure_grouped_recredit_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.collection_failure_grouped_recredit_source_snapshot(uuid) TO crest_export;

CREATE OR REPLACE FUNCTION crest_commands.collection_failure_recredit_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source record; history jsonb; rows jsonb:='{}'::jsonb; items jsonb; projection text; filter text; row_count integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='COLLECTION_RECREDIT_SOURCE_SNAPSHOT_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true),
  set_config('crest.collection_failure_recredit_source','on',true),set_config('crest.refund_transfer_fee_source','',true);
 FOR source IN SELECT * FROM crest_private.collection_failure_recredit_source_dictionary() LOOP
  SELECT string_agg(format('%L,%s',name,
   CASE WHEN name IN('created_at','posted_at') THEN
    format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
  INTO projection FROM unnest(source.fields) WITH ORDINALITY AS f(name,position);
  filter:=CASE source.group_name
   WHEN 'financial_events' THEN ' AND t.collection_failure_recredit_id IS NOT NULL'
   WHEN 'atomic_finance_groups' THEN ' AND EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=t.business_id AND e.group_id=t.id AND e.collection_failure_recredit_id IS NOT NULL)'
   WHEN 'journal_entries' THEN ' AND EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=t.business_id AND e.id=t.event_id AND e.collection_failure_recredit_id IS NOT NULL)'
   WHEN 'journal_lines' THEN ' AND t.collection_failure_recredit_id IS NOT NULL'
   WHEN 'money_movements' THEN ' AND EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=t.business_id AND e.id=t.event_id AND e.collection_failure_recredit_id IS NOT NULL)'
   WHEN 'external_money_evidence' THEN ' AND EXISTS(SELECT FROM crest.collection_failure_recredits r WHERE r.business_id=t.business_id AND r.evidence_id=t.id)'
   WHEN 'customer_fund_lots' THEN ' AND t.collection_failure_recredit_event_id IS NOT NULL'
   ELSE '' END;
  EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY id),''[]''::jsonb) FROM (
   SELECT t.id,jsonb_build_object(%s) AS value FROM crest.%I t WHERE t.business_id=$1%s ORDER BY t.id LIMIT 1001
   ) scoped',projection,source.group_name,filter) INTO items USING requested_business;
  row_count:=row_count+jsonb_array_length(items);
  IF row_count>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RECREDIT_SOURCE_LIMIT';END IF;
  rows:=rows||jsonb_build_object(source.group_name,items);
 END LOOP;
 PERFORM set_config('crest.collection_failure_recredit_source','',true);
 IF octet_length(rows::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RECREDIT_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'historySnapshotToken',history->>'snapshotToken','rows',rows);
END $snapshot$;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-export-access.sql
-- Keep the audited download provenance aligned with the source profile.
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-grouped-recredit-export-access.sql
