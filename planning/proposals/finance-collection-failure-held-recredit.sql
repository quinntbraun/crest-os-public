-- Held actual recredit into customer funds after an identified settled incoming failure.
-- Original root, failed range, and original ledger stay immutable.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.collection_failure_recredits (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 failure_id uuid NOT NULL,
 failure_component_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 money_account_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 actual_on date NOT NULL CHECK(actual_on>=DATE '1900-01-01' AND actual_on<=DATE '9999-12-31'),
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000
  AND confirmation=btrim(confirmation) AND confirmation!~'[[:cntrl:]]'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000
  AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,evidence_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,failure_id,failure_component_id) REFERENCES crest.collection_failure_components(business_id,collection_failure_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,money_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,failure_component_id extensions.gist_uuid_ops WITH =,
  numrange(first_cent::numeric,last_cent::numeric,'[]') WITH &&)
);
ALTER TABLE crest.collection_failure_recredits ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.collection_failure_recredits FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.collection_failure_recredits TO crest_finance_integrity_owner;
GRANT SELECT,INSERT ON crest.collection_failure_recredits TO crest_finance_account_owner;
CREATE POLICY collection_failure_recredit_integrity ON crest.collection_failure_recredits
 FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY collection_failure_recredit_read ON crest.collection_failure_recredits
 FOR SELECT TO crest_finance_account_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE TRIGGER collection_failure_recredit_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.collection_failure_recredits
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

ALTER TABLE crest.financial_events ADD COLUMN collection_failure_recredit_id uuid;
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,collection_failure_recredit_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,collection_failure_recredit_id)
 REFERENCES crest.collection_failure_recredits(business_id,id);
ALTER TABLE crest.financial_events DROP CONSTRAINT financial_events_template_version_check;
ALTER TABLE crest.financial_events ADD CONSTRAINT financial_events_template_version_check CHECK(
 (template_version=1 AND num_nonnulls(refund_transfer_adjustment_id,collection_failure_recredit_id)=0)
 OR (template_version=2 AND refund_transfer_adjustment_id IS NOT NULL AND collection_failure_recredit_id IS NULL AND template IN('P08','P09','P10'))
 OR (template_version=2 AND template='P11' AND collection_failure_recredit_id IS NOT NULL AND refund_transfer_adjustment_id IS NULL));
ALTER TABLE crest.journal_lines ADD COLUMN collection_failure_recredit_id uuid;
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,collection_failure_recredit_id,purpose);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,collection_failure_recredit_id)
 REFERENCES crest.collection_failure_recredits(business_id,id);

ALTER TABLE crest.customer_fund_lots ADD COLUMN collection_failure_recredit_event_id uuid;
ALTER TABLE crest.customer_fund_lots DROP CONSTRAINT fund_lot_one_source;
ALTER TABLE crest.customer_fund_lots ADD CONSTRAINT fund_lot_one_source CHECK(
 num_nonnulls(unapplication_id,receipt_event_id,receipt_tip_event_id,collection_failure_recredit_event_id)=1);
ALTER TABLE crest.customer_fund_lots ADD UNIQUE(business_id,collection_failure_recredit_event_id);
ALTER TABLE crest.customer_fund_lots ADD FOREIGN KEY(business_id,collection_failure_recredit_event_id)
 REFERENCES crest.financial_events(business_id,id);

CREATE POLICY collection_failure_recredit_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.collection_failure.recredit_held','finance.collection_failure.retire_held_recredit'));
CREATE POLICY collection_failure_recredit_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id
  AND command_type IN('finance.collection_failure.recredit_held','finance.collection_failure.retire_held_recredit')
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY collection_failure_recredit_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.collection_failure.recredit_held','finance.collection_failure.retire_held_recredit') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.collection_failure.recredit_held','finance.collection_failure.retire_held_recredit') AND state='committed');
CREATE POLICY collection_failure_recredit_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.collection_failure.recredit_held');
CREATE POLICY collection_failure_recredit_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='collection_failure_recredits');
CREATE POLICY collection_failure_recredit_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND EXISTS(
   SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id
    AND o.actor_id=audit_events.actor_id AND o.state='committed' AND (
     o.command_type='finance.collection_failure.recredit_held' AND audit_events.entity_kind='collection_failure_recredits'
     OR o.command_type='finance.collection_failure.retire_held_recredit' AND audit_events.entity_kind='operations' AND o.id=audit_events.entity_id)));
CREATE POLICY collection_failure_recredit_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id AND entity_version=1
  AND origin='manual' AND import_row_id IS NULL AND EXISTS(
   SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id
    AND o.actor_id=audit_events.actor_id AND o.state='pending' AND (
     o.command_type='finance.collection_failure.recredit_held' AND audit_events.entity_kind='collection_failure_recredits' AND audit_events.action='recredit'
     OR o.command_type='finance.collection_failure.retire_held_recredit' AND audit_events.entity_kind='operations' AND audit_events.action='retire'
      AND o.id=audit_events.entity_id)));

DO $writer$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['collection_failure_recredits','external_money_evidence','money_movements','financial_events',
  'atomic_finance_groups','journal_entries','journal_lines','customer_fund_lots'] LOOP
  EXECUTE format('CREATE POLICY collection_failure_recredit_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.command_type=''finance.collection_failure.recredit_held'' AND o.state=''pending''))',relation);
 END LOOP;
END $writer$;

ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK((collection_failure_recredit_id IS NULL AND (
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
   invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,zero_effect_reason)=0)
);

ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK((collection_failure_recredit_id IS NULL AND (
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
    AND money_movement_id IS NULL AND debit_cents=0 AND credit_cents>0)))
);

CREATE FUNCTION crest_private.collection_failure_held_recredit_receipt(r crest.collection_failure_recredits,
 f crest.collection_failures,c crest.collection_failure_components,l crest.customer_fund_lots,e crest.financial_events,
 m crest.money_movements,v crest.money_channel_versions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',r.business_id,'operationId',r.operation_id,'recreditId',r.id,
  'eventId',e.id,'failureId',f.id,'failureComponentId',c.id,'originalPaymentId',f.payment_id,'originalEventId',f.original_event_id,
  'customerId',r.customer_id,'fundingOriginId',l.origin_id,'previousFundLotId',c.fund_lot_id,'fundLotId',l.id,
  'fundsAccountId',l.account_id,'fundsMappingId',l.mapping_id,'moneyAccountId',r.money_account_id,
  'moneyChannelId',v.channel_id,'moneyChannelVersion',v.version::text,'moneyMovementId',m.id,'evidenceId',r.evidence_id,
  'actualOn',to_char(r.actual_on,'YYYY-MM-DD'),'firstCent',r.first_cent::text,'lastCent',r.last_cent::text,
  'cents',(r.last_cent-r.first_cent+1)::text,'confirmation',r.confirmation,'reason',r.reason);
$receipt$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_held_recredit_receipt(crest.collection_failure_recredits,
 crest.collection_failures,crest.collection_failure_components,crest.customer_fund_lots,crest.financial_events,
 crest.money_movements,crest.money_channel_versions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_held_recredit_receipt(crest.collection_failure_recredits,
 crest.collection_failures,crest.collection_failure_components,crest.customer_fund_lots,crest.financial_events,
 crest.money_movements,crest.money_channel_versions) TO crest_finance_account_owner,crest_finance_integrity_owner;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_collection_failure_held_recredit(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; r crest.collection_failure_recredits; f crest.collection_failures;
 c crest.collection_failure_components; base_lot crest.customer_fund_lots; l crest.customer_fund_lots;
 m crest.money_movements; v crest.money_channel_versions; proof crest.external_money_evidence;
 prior crest.financial_events; amount bigint; journal uuid; receipt jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE (business_id,id)=(requested_business,requested_event);
 SELECT * INTO STRICT r FROM crest.collection_failure_recredits WHERE (business_id,id)=(e.business_id,e.collection_failure_recredit_id);
 SELECT * INTO STRICT f FROM crest.collection_failures WHERE (business_id,id)=(r.business_id,r.failure_id);
 SELECT * INTO STRICT c FROM crest.collection_failure_components WHERE (business_id,id)=(r.business_id,r.failure_component_id);
 SELECT * INTO STRICT base_lot FROM crest.customer_fund_lots WHERE (business_id,id)=(r.business_id,c.fund_lot_id);
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE (business_id,collection_failure_recredit_event_id)=(e.business_id,e.id);
 SELECT * INTO STRICT prior FROM crest.financial_events WHERE (business_id,collection_failure_id)=(f.business_id,f.id);
 SELECT * INTO STRICT m FROM crest.money_movements WHERE (business_id,event_id)=(e.business_id,e.id);
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE (business_id,id)=(r.business_id,r.channel_version_id);
 SELECT * INTO STRICT proof FROM crest.external_money_evidence WHERE (business_id,id)=(r.business_id,r.evidence_id);
 amount:=r.last_cent-r.first_cent+1;
 IF e.template<>'P11' OR e.template_version<>2 OR e.event_sequence<>1 OR f.kind<>'settled_failure'
  OR base_lot.collection_failure_recredit_event_id IS NOT NULL
  OR r.first_cent<c.root_first_cent OR r.last_cent>c.root_last_cent OR e.effective_on<>r.actual_on
  OR r.actual_on<f.effective_on OR e.posted_at<r.created_at OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR (l.origin_id,l.parent_partition_id,l.customer_id,l.original_cents) IS DISTINCT FROM
     (base_lot.origin_id,base_lot.parent_partition_id,r.customer_id,amount)
  OR base_lot.customer_id<>r.customer_id
  OR NOT EXISTS(SELECT FROM crest.funding_origins o WHERE (o.business_id,o.id,o.payment_id,o.customer_id)=
    (r.business_id,l.origin_id,f.payment_id,r.customer_id))
  OR l.mapping_id IS DISTINCT FROM crest_private.unapplication_funds_mapping(r.business_id,r.actual_on)
  OR NOT EXISTS(SELECT FROM crest.account_mapping_versions a WHERE (a.business_id,a.id,a.account_id)=(l.business_id,l.mapping_id,l.account_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 IF v.id IS DISTINCT FROM crest_private.direct_receipt_channel(r.business_id,v.channel_id,r.actual_on,e.time_zone)
  OR (v.account_id,m.account_id,m.evidence_id,m.signed_cents) IS DISTINCT FROM (r.money_account_id,r.money_account_id,r.evidence_id,amount)
  OR (proof.external_account_id,proof.provider_namespace,proof.confirmed_on,proof.signed_cents,proof.currency)
   IS DISTINCT FROM (r.money_account_id,v.provider_namespace,r.actual_on,amount,'USD'::text)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_EVIDENCE_REQUIRED';END IF;
 receipt:=crest_private.collection_failure_held_recredit_receipt(r,f,c,l,e,m,v);
 IF NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
  JOIN crest.atomic_finance_groups pg ON (pg.business_id,pg.id)=(prior.business_id,prior.group_id)
  JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
  JOIN crest_private.audit_events a ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  JOIN crest.accounting_periods period ON (period.business_id,period.id)=(e.business_id,e.period_id)
  WHERE (g.business_id,g.id,g.operation_id,g.created_by)=(e.business_id,e.group_id,r.operation_id,r.created_by)
   AND g.commit_sequence>pg.commit_sequence AND g.recovery_epoch=o.recovery_epoch
   AND o.command_type='finance.collection_failure.recredit_held' AND o.state='committed' AND o.result_schema_version=1 AND o.result=receipt
   AND a.entity_kind='collection_failure_recredits' AND a.entity_id=r.id AND a.entity_version=1 AND a.action='recredit'
   AND a.reason=r.reason AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
   AND e.time_zone=period.time_zone AND e.effective_on BETWEEN period.starts_on AND period.through_on
   AND e.period_generation%2=0 AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
    WHERE (h.business_id,h.period_id)=(period.business_id,period.id)),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 SELECT id INTO journal FROM crest.journal_entries WHERE (business_id,event_id,entry_sequence)=(e.business_id,e.id,1);
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE (j.business_id,j.event_id)=(e.business_id,e.id))<>1
  OR (SELECT count(*) FROM crest.journal_lines j WHERE (j.business_id,j.entry_id)=(e.business_id,journal))<>2
  OR NOT EXISTS(SELECT FROM crest.journal_lines j WHERE (j.business_id,j.entry_id,j.collection_failure_recredit_id,
    j.purpose,j.account_id,j.money_movement_id,j.debit_cents,j.credit_cents)=(e.business_id,journal,r.id,
     'collection_recredit_money',r.money_account_id,m.id,amount,0))
  OR NOT EXISTS(SELECT FROM crest.journal_lines j WHERE (j.business_id,j.entry_id,j.collection_failure_recredit_id,
    j.purpose,j.account_id,j.fund_lot_id,j.fixed_mapping_id,j.debit_cents,j.credit_cents)=(e.business_id,journal,r.id,
     'collection_recredit_funds',l.account_id,l.id,l.mapping_id,0,amount))
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements q WHERE (q.business_id,q.event_id)=(e.business_id,e.id))
  OR EXISTS(SELECT FROM crest.allocation_events q WHERE (q.business_id,q.event_id)=(e.business_id,e.id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_JOURNAL_REQUIRED';END IF;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_collection_failure_held_recredit(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION crest_private.verify_collection_failure_recredit_source_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid;
BEGIN
 SELECT id INTO event_id FROM crest.financial_events WHERE (business_id,collection_failure_recredit_id)=(NEW.business_id,NEW.id);
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_collection_failure_held_recredit(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_collection_failure_recredit_source_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_collection_failure_recredit_source_row() TO crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED';END IF;
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
CREATE CONSTRAINT TRIGGER collection_failure_recredit_complete AFTER INSERT ON crest.collection_failure_recredits
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_collection_failure_recredit_source_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_collection_failure_recredit_source_row() FROM crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_fictional_collection_failure_held_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_recredit uuid,requested_failure uuid,requested_customer uuid,
 requested_component uuid,requested_channel uuid,expected_channel_version bigint,actual_on date,
 requested_first bigint,requested_last bigint,verified_cents bigint,confirmation text,review_reason text,external_identity jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; claimed uuid; previous record; e crest.financial_events; r crest.collection_failure_recredits;
 f crest.collection_failures; c crest.collection_failure_components; base_lot crest.customer_fund_lots; l crest.customer_fund_lots;
 m crest.money_movements; v crest.money_channel_versions; period record; mapping uuid; funds_account uuid;
 group_id uuid; journal uuid; proof_id uuid; receipt jsonb;
BEGIN
 IF num_nonnulls(requested_operation,requested_recredit,requested_failure,requested_customer,requested_component,requested_channel,
  expected_channel_version,actual_on,requested_first,requested_last,verified_cents,confirmation,review_reason)<>13
  OR expected_channel_version<1 OR actual_on<DATE '1900-01-01' OR actual_on>DATE '9999-12-31'
  OR requested_first<1 OR requested_last<requested_first OR verified_cents<1
  OR EXISTS(SELECT FROM unnest(ARRAY[confirmation,review_reason]) s(value) WHERE char_length(s.value) NOT BETWEEN 1 AND 1000
    OR s.value<>btrim(s.value) OR s.value~'[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 IF requested_last-requested_first+1<>verified_cents THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_AMOUNT_REQUIRED';END IF;
 IF NOT crest_private.refund_transfer_external_identity(external_identity) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_EVIDENCE_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.collection_failure.recredit_held',1,requested_business,
  expected_actor,expected_epoch,requested_recredit,requested_failure,requested_customer,requested_component,requested_channel,
  expected_channel_version::text,to_char(actual_on,'YYYY-MM-DD'),requested_first::text,requested_last::text,verified_cents::text,
  confirmation,review_reason,external_identity)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.collection_failure.recredit_held',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO previous FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.collection_failure.recredit_held' AND o.state='committed';
  IF NOT FOUND OR (previous.payload_hash,previous.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',previous.result);
 END IF;
 PERFORM id FROM crest_private.finance_controls WHERE business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT failure.* INTO f FROM crest.collection_failures failure JOIN crest.payments p ON (p.business_id,p.id)=(failure.business_id,failure.payment_id)
 WHERE (failure.business_id,failure.id,failure.kind,p.customer_id)=(requested_business,requested_failure,'settled_failure',requested_customer);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_FAILURE_REQUIRED';END IF;
 SELECT source.* INTO c FROM crest.collection_failure_components source JOIN crest.customer_fund_lots source_lot
  ON (source_lot.business_id,source_lot.id)=(source.business_id,source.fund_lot_id)
 WHERE (source.business_id,source.collection_failure_id,source.id,source_lot.customer_id)=(requested_business,f.id,requested_component,requested_customer)
  AND source_lot.collection_failure_recredit_event_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_FAILURE_REQUIRED';END IF;
 SELECT * INTO STRICT base_lot FROM crest.customer_fund_lots WHERE (business_id,id)=(requested_business,c.fund_lot_id);
 IF actual_on<f.effective_on OR actual_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_DATE_REQUIRED';END IF;
 IF requested_first<c.root_first_cent OR requested_last>c.root_last_cent OR EXISTS(SELECT FROM crest.collection_failure_recredits x
  WHERE (x.business_id,x.failure_component_id)=(requested_business,c.id) AND x.first_cent<=requested_last AND x.last_cent>=requested_first)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_RANGE_UNAVAILABLE';END IF;
 IF EXISTS(SELECT FROM crest.collection_failure_recredits x WHERE (x.business_id,x.id)=(requested_business,requested_recredit)) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='COLLECTION_RECREDIT_ALREADY_RECORDED';END IF;
 SELECT * INTO v FROM crest.money_channel_versions q WHERE q.business_id=requested_business
  AND q.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,auth->>'timezone');
 IF NOT FOUND OR v.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_VERIFIED_CHANNEL_REQUIRED';END IF;
 mapping:=crest_private.unapplication_funds_mapping(requested_business,actual_on);
 SELECT mapped.account_id INTO funds_account FROM crest.account_mapping_versions mapped WHERE (mapped.business_id,mapped.id)=(requested_business,mapping);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_FUNDS_MAPPING_REQUIRED';END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,auth->>'timezone');
 IF EXISTS(SELECT FROM crest.external_money_evidence x WHERE x.business_id=requested_business AND x.provider_namespace=v.provider_namespace
  AND x.external_account_id=v.account_id AND (x.id_namespace,x.external_id)=(external_identity->>'namespace',external_identity->>'id'))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='COLLECTION_RECREDIT_EXTERNAL_ID_ALREADY_RECORDED';END IF;
 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,v.provider_namespace,v.account_id,external_identity->>'namespace',external_identity->>'id',
  external_identity->>'rawReference','exact_case_v1',actual_on,verified_cents,'USD') RETURNING id INTO proof_id;
 INSERT INTO crest.collection_failure_recredits(id,business_id,failure_id,failure_component_id,customer_id,channel_version_id,money_account_id,
  evidence_id,actual_on,first_cent,last_cent,confirmation,reason,operation_id,created_by)
 VALUES(requested_recredit,requested_business,f.id,c.id,requested_customer,v.id,v.account_id,proof_id,actual_on,requested_first,requested_last,
  confirmation,review_reason,requested_operation,expected_actor) RETURNING * INTO r;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,collection_failure_recredit_id,period_id,
  period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,r.id,period.period_id,period.generation,actual_on,auth->>'timezone','P11',2) RETURNING * INTO e;
 INSERT INTO crest.customer_fund_lots(business_id,collection_failure_recredit_event_id,origin_id,parent_partition_id,
  customer_id,account_id,mapping_id,original_cents)
 VALUES(requested_business,e.id,base_lot.origin_id,base_lot.parent_partition_id,requested_customer,funds_account,mapping,verified_cents)
 RETURNING * INTO l;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,e.id,v.account_id,proof_id,verified_cents) RETURNING * INTO m;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal;
 INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_recredit_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal,r.id,v.account_id,m.id,'collection_recredit_money',verified_cents,0);
 INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_recredit_id,account_id,fund_lot_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal,r.id,l.account_id,l.id,l.mapping_id,'collection_recredit_funds',0,verified_cents);
 receipt:=crest_private.collection_failure_held_recredit_receipt(r,f,c,l,e,m,v);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'collection_failure_recredits',r.id,1,'recredit',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,bigint,bigint,text,text,jsonb) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,bigint,bigint,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,bigint,bigint,text,text,jsonb) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.lookup_fictional_collection_failure_held_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_recredit uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE operation crest_private.operations; s crest.collection_failure_recredits; f crest.collection_failures; c crest.collection_failure_components; e crest.financial_events; l crest.customer_fund_lots; m crest.money_movements; v crest.money_channel_versions;
 receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_recredit IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO operation FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.collection_failure.recredit_held','finance.collection_failure.retire_held_recredit') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF operation.command_type='finance.collection_failure.retire_held_recredit' THEN
  IF (operation.result->>'originalEpoch',operation.result->>'recreditId') IS DISTINCT FROM
   (original_epoch::text,original_recredit::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
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
 SELECT * INTO STRICT s FROM crest.collection_failure_recredits WHERE business_id=requested_business AND operation_id=original_operation;
 IF (operation.recovery_epoch,s.id) IS DISTINCT FROM (original_epoch,original_recredit) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND collection_failure_recredit_id=s.id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND collection_failure_recredit_event_id=e.id;
 SELECT * INTO m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
  AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='collection_failure_recredits' AND entity_id=s.id
  AND action='recredit' AND entity_version=1;
 SELECT * INTO STRICT f FROM crest.collection_failures WHERE (business_id,id)=(requested_business,s.failure_id);
 SELECT * INTO STRICT c FROM crest.collection_failure_components WHERE (business_id,id)=(requested_business,s.failure_component_id);
 receipt:=crest_private.collection_failure_held_recredit_receipt(s,f,c,l,e,m,v);
 IF operation.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM s.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_collection_failure_held_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_epoch uuid,original_operation uuid,original_recredit uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_collection_failure_held_recredit($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'recreditId',original_recredit,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.collection_failure.retire_held_recredit',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_collection_failure_held_recredit($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12);
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
ALTER FUNCTION crest_commands.lookup_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.lookup_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.lookup_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_collection_failure_held_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.collection_failure_held_recredit_available(requested_business uuid,requested_customer uuid,requested_failure uuid)
RETURNS TABLE(failure_id uuid,payment_id uuid,failed_on date,failure_cents bigint,component_id uuid,previous_lot_id uuid,ranges nummultirange)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $available$
 SELECT f.id,f.payment_id,f.effective_on,f.cents,c.id,l.id,
  nummultirange(numrange(c.root_first_cent::numeric,c.root_last_cent::numeric+1,'[)'))
   - coalesce((SELECT range_agg(numrange(x.first_cent::numeric,x.last_cent::numeric+1,'[)'))
    FROM crest.collection_failure_recredits x WHERE (x.business_id,x.failure_component_id)=(c.business_id,c.id)),'{}'::nummultirange)
 FROM crest.collection_failures f
 JOIN crest.payments p ON (p.business_id,p.id)=(f.business_id,f.payment_id)
 JOIN crest.collection_failure_components c ON (c.business_id,c.collection_failure_id)=(f.business_id,f.id)
 JOIN crest.customer_fund_lots l ON (l.business_id,l.id)=(c.business_id,c.fund_lot_id)
 WHERE (f.business_id,f.kind,p.customer_id,l.customer_id)=(requested_business,'settled_failure',requested_customer,requested_customer)
  AND l.collection_failure_recredit_event_id IS NULL AND (requested_failure IS NULL OR f.id=requested_failure);
$available$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_held_recredit_available(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_held_recredit_available(uuid,uuid,uuid) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.list_fictional_collection_failure_held_recredits(
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
   FROM crest_private.collection_failure_held_recredit_available(requested_business,requested_customer,NULL) s
   CROSS JOIN LATERAL unnest(s.ranges) r(value)
   GROUP BY s.failure_id,s.payment_id,s.failed_on,s.failure_cents ORDER BY s.failed_on DESC,s.failure_id LIMIT 51
  ) a;
 more:=jsonb_array_length(results)>50;
 IF more THEN results:=results-50;END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'hasMore',more,'failures',results);
END $read$;

CREATE FUNCTION crest_commands.read_fictional_collection_failure_held_recredit_options(
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
 SELECT coalesce(jsonb_agg(jsonb_build_object('failureComponentId',s.component_id,'previousFundLotId',s.previous_lot_id,
  'availableRanges',ranges.value) ORDER BY s.component_id),'[]'::jsonb) INTO components
 FROM crest_private.collection_failure_held_recredit_available(requested_business,requested_customer,requested_failure) s
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
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_fictional_collection_failure_held_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_collection_failure_held_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_collection_failure_held_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.read_fictional_collection_failure_held_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_collection_failure_held_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.read_fictional_collection_failure_held_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) TO crest_finance_preview;
