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
