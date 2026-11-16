-- Held P11: owner-selected surviving components of one direct receipt.
-- No replacement receipt, recovery/recredit, charge concession, fee or suspense posting.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.collection_failures (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 payment_id uuid NOT NULL,
 original_event_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('recording_error','settled_failure')),
 channel_version_id uuid NOT NULL,
 money_account_id uuid NOT NULL,
 evidence_id uuid,
 effective_on date NOT NULL CHECK(effective_on BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
 cents bigint NOT NULL CHECK(cents>0),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000
  AND confirmation=btrim(confirmation) AND confirmation!~'[[:cntrl:]]'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,id,payment_id),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,evidence_id),
 FOREIGN KEY(business_id,payment_id) REFERENCES crest.payments(business_id,id),
 FOREIGN KEY(business_id,original_event_id) REFERENCES crest.financial_events(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,money_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((kind='settled_failure')=(evidence_id IS NOT NULL))
);
CREATE TABLE crest.collection_failure_components (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 collection_failure_id uuid NOT NULL,
 payment_id uuid NOT NULL,
 allocation_id uuid,
 fund_application_id uuid,
 fund_lot_id uuid,
 tip_realization_id uuid,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 root_first_cent bigint NOT NULL CHECK(root_first_cent>0),
 root_last_cent bigint NOT NULL CHECK(root_last_cent>=root_first_cent),
 net_cents bigint NOT NULL CHECK(net_cents>=0),
 tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,collection_failure_id,id),
 FOREIGN KEY(business_id,collection_failure_id,payment_id) REFERENCES crest.collection_failures(business_id,id,payment_id),
 FOREIGN KEY(business_id,allocation_id) REFERENCES crest.allocation_events(business_id,id),
 FOREIGN KEY(business_id,fund_application_id) REFERENCES crest.customer_fund_applications(business_id,id),
 FOREIGN KEY(business_id,fund_lot_id) REFERENCES crest.customer_fund_lots(business_id,id),
 FOREIGN KEY(business_id,tip_realization_id) REFERENCES crest.tip_realizations(business_id,id),
 CHECK(num_nonnulls(allocation_id,fund_application_id,fund_lot_id,tip_realization_id)=1),
 CHECK(last_cent-first_cent=root_last_cent-root_first_cent),
 CHECK(net_cents::numeric+tax_cents=last_cent-first_cent+1 AND (tax_cents=0 OR tip_realization_id IS NOT NULL)),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,payment_id extensions.gist_uuid_ops WITH =,
  numrange(root_first_cent::numeric,root_last_cent::numeric,'[]') WITH &&)
);

ALTER TABLE crest.fund_lot_range_consumptions ADD COLUMN collection_failure_component_id uuid;
ALTER TABLE crest.fund_lot_range_consumptions DROP CONSTRAINT fund_lot_range_consumption_kind;
ALTER TABLE crest.fund_lot_range_consumptions ADD CONSTRAINT fund_lot_range_consumption_kind
 CHECK(num_nonnulls(fund_application_id,tip_realization_id,service_refund_id,excess_return_id,collection_failure_component_id)=1);
ALTER TABLE crest.fund_lot_range_consumptions ADD UNIQUE(business_id,collection_failure_component_id);
ALTER TABLE crest.fund_lot_range_consumptions ADD FOREIGN KEY(business_id,collection_failure_component_id)
 REFERENCES crest.collection_failure_components(business_id,id);

-- Tip returns and collection failures spend the same realized-tip offsets.
ALTER TABLE crest.tip_realization_range_consumptions ALTER COLUMN tip_return_id DROP NOT NULL;
ALTER TABLE crest.tip_realization_range_consumptions ADD COLUMN collection_failure_component_id uuid;
ALTER TABLE crest.tip_realization_range_consumptions ADD CONSTRAINT tip_realization_consumption_kind
 CHECK(num_nonnulls(tip_return_id,collection_failure_component_id)=1);
ALTER TABLE crest.tip_realization_range_consumptions ADD UNIQUE(business_id,collection_failure_component_id);
ALTER TABLE crest.tip_realization_range_consumptions ADD FOREIGN KEY(business_id,collection_failure_component_id)
 REFERENCES crest.collection_failure_components(business_id,id);
-- The existing P10 deferred trigger verifies only P10. P11 verifies its
-- range through its own mandatory component and posting checks below.
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.verify_fictional_tip_return_row() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
DROP TRIGGER tip_return_range_complete ON crest.tip_realization_range_consumptions;
CREATE CONSTRAINT TRIGGER tip_return_range_complete AFTER INSERT ON crest.tip_realization_range_consumptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.tip_return_id IS NOT NULL) EXECUTE FUNCTION crest_private.verify_fictional_tip_return_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_fictional_tip_return_row() FROM crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
ALTER POLICY tip_return_source_export ON crest.tip_realization_range_consumptions
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND tip_return_id IS NOT NULL);

ALTER TABLE crest.financial_events ADD COLUMN collection_failure_id uuid;
ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(((
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
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,zero_effect_reason)=0));
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,collection_failure_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,collection_failure_id) REFERENCES crest.collection_failures(business_id,id);
ALTER TABLE crest.journal_lines ADD COLUMN collection_failure_id uuid, ADD COLUMN collection_failure_component_id uuid;
ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(((
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
 )));
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,collection_failure_component_id,purpose);
CREATE UNIQUE INDEX collection_failure_money_line ON crest.journal_lines(business_id,collection_failure_id) WHERE purpose='collection_failure_money';
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,collection_failure_id) REFERENCES crest.collection_failures(business_id,id);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,collection_failure_id,collection_failure_component_id)
 REFERENCES crest.collection_failure_components(business_id,collection_failure_id,id);

ALTER TABLE crest.collection_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.collection_failures FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.collection_failure_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.collection_failure_components FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.collection_failures,crest.collection_failure_components TO crest_finance_integrity_owner;
GRANT SELECT,INSERT ON crest.collection_failures,crest.collection_failure_components TO crest_finance_account_owner;
CREATE POLICY collection_failure_integrity ON crest.collection_failures FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY collection_failure_component_integrity ON crest.collection_failure_components FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE TRIGGER collection_failure_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.collection_failures
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER collection_failure_component_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.collection_failure_components
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE POLICY collection_failure_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.collection.adjust');
CREATE POLICY collection_failure_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='collection_failures');
CREATE POLICY collection_failure_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='finance.collection.adjust');
CREATE POLICY collection_failure_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id
  AND command_type='finance.collection.adjust' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY collection_failure_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='finance.collection.adjust' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='finance.collection.adjust' AND state='committed');
CREATE POLICY collection_failure_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id
  AND entity_kind='collection_failures' AND action='adjust_collection' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL);
DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['collection_failures','collection_failure_components'] LOOP
  EXECUTE format('CREATE POLICY collection_failure_read ON crest.%I FOR SELECT TO crest_finance_account_owner
    USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source);
 END LOOP;
 FOREACH source IN ARRAY ARRAY['collection_failures','collection_failure_components','external_money_evidence','money_movements',
  'financial_events','atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY collection_failure_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.command_type=''finance.collection.adjust'' AND o.state=''pending''))',source);
 END LOOP;
END $writer$;


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
 WHERE x.business_id=requested_business AND coalesce(a.receivable_id,f.receivable_id)=requested_receivable;
$deltas$;

-- Resolve a selected descendant independently from the supplied payment.
-- Tip ranges use offsets within that realization; every other branch uses
-- original receipt-root offsets. The normalized root coordinates never overlap.
CREATE FUNCTION crest_private.collection_failure_component_source(
 requested_business uuid, requested_payment uuid, component_kind text, requested_source uuid,
 requested_first bigint, requested_last bigint
) RETURNS TABLE(source_event_id uuid, root_first bigint, root_last bigint, receivable_id uuid, fund_lot_id uuid,
 net_cents bigint,tax_cents bigint, debit_account_id uuid, debit_mapping_id uuid, tax_account_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $source$
 WITH root AS (
  SELECT o.id,o.customer_id,e.id AS receipt_event
  FROM crest.funding_origins o JOIN crest.financial_events e ON (e.business_id,e.payment_id)=(o.business_id,o.payment_id)
  WHERE o.business_id=requested_business AND o.payment_id=requested_payment AND e.template='P03'
 )
 SELECT root.receipt_event,requested_first,requested_last,r.id,NULL::uuid,requested_last-requested_first+1,0::bigint,r.account_id,NULL::uuid,NULL::uuid
 FROM root
 JOIN crest.funding_partitions p ON (p.business_id,p.origin_id)=(requested_business,root.id)
 JOIN crest.allocation_events a ON (a.business_id,a.partition_id,a.event_id)=(p.business_id,p.id,root.receipt_event)
 JOIN crest.receivable_items r ON (r.business_id,r.id,r.customer_id)=(a.business_id,a.receivable_id,root.customer_id)
 WHERE component_kind='allocation' AND a.id=requested_source AND requested_first>=p.first_cent AND requested_last<=p.last_cent
 AND NOT EXISTS(SELECT FROM crest.allocation_unapplications u WHERE (u.business_id,u.allocation_id)=(a.business_id,a.id)
  AND u.first_cent<=requested_last AND u.last_cent>=requested_first)
 UNION ALL
 SELECT e.id,requested_first,requested_last,r.id,NULL::uuid,requested_last-requested_first+1,0::bigint,r.account_id,NULL::uuid,NULL::uuid
 FROM root
 JOIN crest.customer_fund_lots l ON (l.business_id,l.origin_id,l.customer_id)=(requested_business,root.id,root.customer_id)
 JOIN crest.customer_fund_applications a ON (a.business_id,a.fund_lot_id)=(l.business_id,l.id)
 JOIN crest.financial_events e ON (e.business_id,e.fund_application_id)=(a.business_id,a.id) AND e.template='P04'
 JOIN crest.receivable_items r ON (r.business_id,r.id,r.customer_id)=(a.business_id,a.receivable_id,root.customer_id)
 WHERE component_kind='application' AND a.id=requested_source AND requested_first>=a.first_cent AND requested_last<=a.last_cent
 UNION ALL
 SELECT bounds.event_id,requested_first,requested_last,NULL::uuid,l.id,requested_last-requested_first+1,0::bigint,l.account_id,l.mapping_id,NULL::uuid
 FROM root
 JOIN crest.customer_fund_lots l ON (l.business_id,l.origin_id,l.customer_id)=(requested_business,root.id,root.customer_id)
 CROSS JOIN LATERAL crest_private.customer_fund_lot_origin(l) bounds
 WHERE component_kind='funds' AND l.id=requested_source AND requested_first>=bounds.first_cent AND requested_last<=bounds.last_cent
 UNION ALL
 SELECT e.id,t.first_cent+(requested_first-1),t.first_cent+(requested_last-1),NULL::uuid,NULL::uuid,
  slices.net_cents,slices.tax_cents,t.revenue_account_id,t.revenue_mapping_id,t.tax_account_id
 FROM root
 JOIN crest.customer_fund_lots l ON (l.business_id,l.origin_id,l.customer_id)=(requested_business,root.id,root.customer_id)
 JOIN crest.tip_realizations t ON (t.business_id,t.fund_lot_id)=(l.business_id,l.id)
 JOIN crest.financial_events e ON (e.business_id,e.tip_realization_id)=(t.business_id,t.id) AND e.template='P06'
 CROSS JOIN LATERAL crest_private.original_tip_return_components(t.inclusive_cents,t.net_cents,requested_first,requested_last) slices
 WHERE component_kind='tip' AND t.id=requested_source;
$source$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_component_source(uuid,uuid,text,uuid,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_component_source(uuid,uuid,text,uuid,bigint,bigint)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.collection_failure_component_kind(x crest.collection_failure_components) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $kind$
 SELECT CASE WHEN x.allocation_id IS NOT NULL THEN 'allocation' WHEN x.fund_application_id IS NOT NULL THEN 'application'
  WHEN x.fund_lot_id IS NOT NULL THEN 'funds' ELSE 'tip' END;
$kind$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_component_kind(crest.collection_failure_components) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_component_kind(crest.collection_failure_components)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.fictional_collection_failure_receipt(s crest.collection_failures,p crest.payments,
 e crest.financial_events,m crest.money_movements,v crest.money_channel_versions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',s.business_id,'collectionFailureId',s.id,'operationId',s.operation_id,
  'eventId',e.id,'originalPaymentId',p.id,'customerId',p.customer_id,'kind',s.kind,'moneyAccountId',s.money_account_id,
  'moneyChannelId',v.channel_id,'moneyChannelVersion',v.version::text,'moneyMovementId',m.id,'evidenceId',s.evidence_id,
  'effectiveOn',to_char(s.effective_on,'YYYY-MM-DD'),'cents',s.cents::text,'confirmation',s.confirmation,'reason',s.reason,'components',(
   SELECT jsonb_agg(jsonb_build_object('componentId',x.id,'kind',crest_private.collection_failure_component_kind(x),
    'sourceId',coalesce(x.allocation_id,x.fund_application_id,x.fund_lot_id,x.tip_realization_id),
    'firstCent',x.first_cent::text,'lastCent',x.last_cent::text,'rootFirstCent',x.root_first_cent::text,
    'rootLastCent',x.root_last_cent::text,'netCents',x.net_cents::text,'taxCents',x.tax_cents::text) ORDER BY x.root_first_cent)
   FROM crest.collection_failure_components x WHERE x.business_id=s.business_id AND x.collection_failure_id=s.id));
$receipt$;
REVOKE ALL ON FUNCTION crest_private.fictional_collection_failure_receipt(crest.collection_failures,crest.payments,
 crest.financial_events,crest.money_movements,crest.money_channel_versions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_collection_failure_receipt(crest.collection_failures,crest.payments,
 crest.financial_events,crest.money_movements,crest.money_channel_versions) TO crest_finance_account_owner,crest_finance_integrity_owner;

-- P05 may otherwise reopen an already failed original allocation. Both normal
-- commands serialize through finance_controls. This trigger also independently
-- rejects an overlapping append at the database boundary.
CREATE FUNCTION crest_private.reject_failed_allocation_unapplication() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
BEGIN
 IF EXISTS(SELECT FROM crest.collection_failure_components x WHERE x.business_id=NEW.business_id AND x.allocation_id=NEW.allocation_id
  AND x.first_cent<=NEW.last_cent AND x.last_cent>=NEW.first_cent)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RANGE_UNAVAILABLE';END IF;
 RETURN NULL;
END $claim$;

CREATE FUNCTION crest_private.collection_failure_debits(requested_business uuid,requested_failure uuid)
RETURNS TABLE(component_id uuid,purpose text,account_id uuid,fixed_mapping_id uuid,receivable_id uuid,fund_lot_id uuid,cents bigint)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $debits$
 SELECT x.id,CASE kind.value WHEN 'tip' THEN 'collection_failure_tip_revenue' WHEN 'funds' THEN 'collection_failure_funds'
  ELSE 'collection_failure_ar' END,source.debit_account_id,source.debit_mapping_id,source.receivable_id,source.fund_lot_id,source.net_cents
 FROM crest.collection_failure_components x
 CROSS JOIN LATERAL (SELECT crest_private.collection_failure_component_kind(x) AS value) kind
 CROSS JOIN LATERAL crest_private.collection_failure_component_source(x.business_id,x.payment_id,kind.value,
  coalesce(x.allocation_id,x.fund_application_id,x.fund_lot_id,x.tip_realization_id),x.first_cent,x.last_cent) source
 WHERE x.business_id=requested_business AND x.collection_failure_id=requested_failure AND source.net_cents>0
 UNION ALL
 SELECT x.id,'collection_failure_tip_tax',source.tax_account_id,NULL,NULL,NULL,source.tax_cents
 FROM crest.collection_failure_components x
 CROSS JOIN LATERAL crest_private.collection_failure_component_source(x.business_id,x.payment_id,'tip',
  x.tip_realization_id,x.first_cent,x.last_cent) source
 WHERE x.business_id=requested_business AND x.collection_failure_id=requested_failure AND source.tax_cents>0;
$debits$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_debits(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_debits(uuid,uuid) TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.retain_collection_failure_ranges() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retain$
BEGIN
 IF NEW.fund_lot_id IS NOT NULL THEN
  INSERT INTO crest.fund_lot_range_consumptions(business_id,fund_lot_id,first_cent,last_cent,collection_failure_component_id)
  VALUES(NEW.business_id,NEW.fund_lot_id,NEW.first_cent,NEW.last_cent,NEW.id);
 ELSIF NEW.tip_realization_id IS NOT NULL THEN
  INSERT INTO crest.tip_realization_range_consumptions(business_id,tip_realization_id,first_cent,last_cent,collection_failure_component_id)
  VALUES(NEW.business_id,NEW.tip_realization_id,NEW.first_cent,NEW.last_cent,NEW.id);
 END IF;
 RETURN NULL;
EXCEPTION WHEN exclusion_violation OR unique_violation THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RANGE_UNAVAILABLE';
END $retain$;

CREATE FUNCTION crest_private.verify_fictional_collection_failure(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; s crest.collection_failures; p crest.payments; original crest.financial_events;
 v crest.money_channel_versions; m crest.money_movements; evidence crest.external_money_evidence; journal uuid; receipt jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT s FROM crest.collection_failures WHERE business_id=requested_business AND id=e.collection_failure_id;
 SELECT * INTO STRICT p FROM crest.payments WHERE business_id=requested_business AND id=s.payment_id;
 SELECT * INTO STRICT original FROM crest.financial_events WHERE business_id=requested_business AND payment_id=p.id AND template='P03';
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT * INTO m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 IF s.kind='settled_failure' THEN
  SELECT * INTO STRICT evidence FROM crest.external_money_evidence WHERE business_id=requested_business AND id=s.evidence_id;
  IF s.channel_version_id IS DISTINCT FROM crest_private.direct_receipt_channel(requested_business,v.channel_id,s.effective_on,e.time_zone)
   OR (v.account_id,m.account_id,m.evidence_id,m.signed_cents) IS DISTINCT FROM (s.money_account_id,s.money_account_id,s.evidence_id,-s.cents)
   OR (evidence.external_account_id,evidence.provider_namespace,evidence.confirmed_on,evidence.signed_cents,evidence.currency)
    IS DISTINCT FROM (s.money_account_id,v.provider_namespace,s.effective_on,-s.cents,'USD'::text)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_EVIDENCE_REQUIRED';END IF;
 ELSIF m.id IS NOT NULL OR (s.channel_version_id,s.money_account_id) IS DISTINCT FROM (p.channel_version_id,p.account_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_ORIGINAL_ACCOUNT_REQUIRED';
 END IF;
 receipt:=crest_private.fictional_collection_failure_receipt(s,p,e,m,v);
 IF e.template<>'P11' OR e.event_sequence<>1 OR s.original_event_id<>original.id
  OR e.effective_on<>s.effective_on OR e.effective_on<original.effective_on
  OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date OR e.posted_at<s.created_at
  OR NOT EXISTS(SELECT FROM crest.collection_failure_components x
   WHERE (x.business_id,x.collection_failure_id)=(s.business_id,s.id)
   HAVING count(*) BETWEEN 1 AND 180 AND sum(x.net_cents::numeric+x.tax_cents)=s.cents)
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest.atomic_finance_groups prior ON (prior.business_id,prior.id)=(original.business_id,original.group_id)
   JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
   JOIN crest_private.audit_events audit ON (audit.business_id,audit.operation_id,audit.actor_id)=(o.business_id,o.operation_id,o.actor_id)
   JOIN crest.accounting_periods period ON (period.business_id,period.id)=(e.business_id,e.period_id)
   WHERE (g.business_id,g.id,g.operation_id,g.created_by)=(e.business_id,e.group_id,s.operation_id,s.created_by)
    AND g.commit_sequence>prior.commit_sequence AND g.recovery_epoch=o.recovery_epoch
    AND o.command_type='finance.collection.adjust' AND o.state='committed' AND o.result=receipt
    AND audit.entity_kind='collection_failures' AND audit.entity_id=s.id AND audit.entity_version=1 AND audit.action='adjust_collection'
    AND audit.reason=s.reason AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
    AND e.time_zone=period.time_zone AND e.effective_on BETWEEN period.starts_on AND period.through_on AND e.period_generation%2=0
    AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
     WHERE h.business_id=period.business_id AND h.period_id=period.id),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_SOURCE_REQUIRED';END IF;
 IF EXISTS(
  SELECT FROM crest.collection_failure_components x
  LEFT JOIN LATERAL crest_private.collection_failure_component_source(x.business_id,x.payment_id,
   crest_private.collection_failure_component_kind(x),coalesce(x.allocation_id,x.fund_application_id,x.fund_lot_id,x.tip_realization_id),
   x.first_cent,x.last_cent) source ON true
  LEFT JOIN crest.financial_events parent ON (parent.business_id,parent.id)=(x.business_id,source.source_event_id)
  LEFT JOIN crest.atomic_finance_groups prior ON (prior.business_id,prior.id)=(parent.business_id,parent.group_id)
  JOIN crest.atomic_finance_groups posted ON (posted.business_id,posted.id)=(e.business_id,e.group_id)
  LEFT JOIN crest.receivable_items r ON (r.business_id,r.id)=(x.business_id,source.receivable_id)
  WHERE (x.business_id,x.collection_failure_id)=(s.business_id,s.id)
   AND (parent.id IS NULL OR parent.effective_on>e.effective_on OR prior.commit_sequence>=posted.commit_sequence
    OR (source.root_first,source.root_last,source.net_cents,source.tax_cents)
       IS DISTINCT FROM (x.root_first_cent,x.root_last_cent,x.net_cents,x.tax_cents)
    OR (r.id IS NOT NULL AND NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents))
    OR (x.fund_lot_id IS NOT NULL AND NOT EXISTS(SELECT FROM crest.fund_lot_range_consumptions used
     WHERE used.business_id=x.business_id AND (used.collection_failure_component_id,used.fund_lot_id,used.first_cent,used.last_cent)
      =(x.id,x.fund_lot_id,x.first_cent,x.last_cent)))
    OR (x.tip_realization_id IS NOT NULL AND NOT EXISTS(SELECT FROM crest.tip_realization_range_consumptions used
     WHERE used.business_id=x.business_id AND (used.collection_failure_component_id,used.tip_realization_id,used.first_cent,used.last_cent)
      =(x.id,x.tip_realization_id,x.first_cent,x.last_cent))))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RANGE_UNAVAILABLE';END IF;

 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR NOT EXISTS(SELECT FROM crest.journal_lines l WHERE (l.business_id,l.entry_id,l.collection_failure_id,l.purpose,l.account_id,l.credit_cents)
   =(s.business_id,journal,s.id,'collection_failure_money',s.money_account_id,s.cents)
   AND l.money_movement_id IS NOT DISTINCT FROM m.id)
  OR (SELECT count(*) FROM crest.journal_lines l WHERE l.business_id=s.business_id AND l.entry_id=journal)
     <>1+(SELECT count(*) FROM crest_private.collection_failure_debits(s.business_id,s.id))
  OR EXISTS(SELECT FROM crest_private.collection_failure_debits(s.business_id,s.id) x WHERE NOT EXISTS(
   SELECT FROM crest.journal_lines l WHERE (l.business_id,l.entry_id,l.collection_failure_id,l.collection_failure_component_id,
    l.purpose,l.account_id,l.debit_cents)=(s.business_id,journal,s.id,x.component_id,x.purpose,x.account_id,x.cents)
   AND (l.fixed_mapping_id,l.receivable_id,l.fund_lot_id) IS NOT DISTINCT FROM (x.fixed_mapping_id,x.receivable_id,x.fund_lot_id)))
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE x.business_id=e.business_id AND x.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_JOURNAL_REQUIRED';END IF;
END $verify$;

CREATE FUNCTION crest_private.verify_collection_failure_source_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid; failure_id uuid;
BEGIN
 failure_id:=(CASE TG_TABLE_NAME WHEN 'collection_failures' THEN to_jsonb(NEW)->>'id'
  WHEN 'collection_failure_components' THEN to_jsonb(NEW)->>'collection_failure_id'
  ELSE (SELECT c.collection_failure_id::text FROM crest.collection_failure_components c
   WHERE (c.business_id,c.id)=(NEW.business_id,(to_jsonb(NEW)->>'collection_failure_component_id')::uuid)) END)::uuid;
 SELECT id INTO event_id FROM crest.financial_events WHERE business_id=NEW.business_id AND collection_failure_id=failure_id;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_fictional_collection_failure(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;

RESET ROLE;
GRANT INSERT ON crest.tip_realization_range_consumptions TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY collection_failure_tip_range_append ON crest.tip_realization_range_consumptions FOR INSERT TO crest_finance_integrity_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND collection_failure_component_id IS NOT NULL AND tip_return_id IS NULL);
RESET ROLE;
ALTER FUNCTION crest_private.retain_collection_failure_ranges() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.reject_failed_allocation_unapplication() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_fictional_collection_failure(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_collection_failure_source_row() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.retain_collection_failure_ranges(),crest_private.reject_failed_allocation_unapplication(),
 crest_private.verify_fictional_collection_failure(uuid,uuid),crest_private.verify_collection_failure_source_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.retain_collection_failure_ranges(),crest_private.reject_failed_allocation_unapplication(),
 crest_private.verify_collection_failure_source_row() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER collection_failure_claim_range AFTER INSERT ON crest.collection_failure_components
 FOR EACH ROW EXECUTE FUNCTION crest_private.retain_collection_failure_ranges();
CREATE CONSTRAINT TRIGGER reject_failed_allocation_release AFTER INSERT ON crest.allocation_unapplications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.reject_failed_allocation_unapplication();
CREATE CONSTRAINT TRIGGER collection_failure_complete AFTER INSERT ON crest.collection_failures
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_collection_failure_source_row();
CREATE CONSTRAINT TRIGGER collection_failure_component_complete AFTER INSERT ON crest.collection_failure_components
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_collection_failure_source_row();
CREATE CONSTRAINT TRIGGER collection_failure_fund_range_complete AFTER INSERT ON crest.fund_lot_range_consumptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.collection_failure_component_id IS NOT NULL)
 EXECUTE FUNCTION crest_private.verify_collection_failure_source_row();
CREATE CONSTRAINT TRIGGER collection_failure_tip_range_complete AFTER INSERT ON crest.tip_realization_range_consumptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.collection_failure_component_id IS NOT NULL)
 EXECUTE FUNCTION crest_private.verify_collection_failure_source_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.retain_collection_failure_ranges(),crest_private.reject_failed_allocation_unapplication(),
 crest_private.verify_collection_failure_source_row() FROM crest_schema_owner;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED';END IF;
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
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_fictional_collection_failure(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_failure uuid,requested_payment uuid,requested_customer uuid,
 adjustment_kind text,requested_channel uuid,expected_channel_version bigint,adjustment_on date,verified_cents bigint,
 confirmation text,review_reason text,external_identity jsonb,components jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; claimed uuid; input record; source record;
 p crest.payments; original crest.financial_events; v crest.money_channel_versions; period record; s crest.collection_failures;
 e crest.financial_events; m crest.money_movements; group_id uuid; journal_id uuid; evidence_id uuid; receipt jsonb;
 selected_total numeric:=0; normalized_components jsonb; first_cent bigint; last_cent bigint;
BEGIN
 IF requested_operation IS NULL OR requested_failure IS NULL OR requested_payment IS NULL OR requested_customer IS NULL
  OR adjustment_kind IS NULL OR adjustment_kind NOT IN('recording_error','settled_failure')
  OR adjustment_on IS NULL OR adjustment_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
  OR verified_cents IS NULL OR verified_cents<=0
  OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000 OR confirmation<>btrim(confirmation) OR confirmation~'[[:cntrl:]]'
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]'
  OR jsonb_typeof(components) IS DISTINCT FROM 'array' OR octet_length(components::text)>65536
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';END IF;
 IF jsonb_array_length(components) NOT BETWEEN 1 AND 180 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';END IF;
 IF adjustment_kind='recording_error' AND num_nonnulls(requested_channel,expected_channel_version,external_identity)<>0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_ORIGINAL_ACCOUNT_REQUIRED';
 END IF;
 IF adjustment_kind='settled_failure' AND jsonb_typeof(external_identity) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_EVIDENCE_REQUIRED';END IF;
 IF adjustment_kind='settled_failure' AND (requested_channel IS NULL OR expected_channel_version IS NULL OR expected_channel_version<=0
  OR octet_length(external_identity::text)>8192
  OR NOT external_identity?&ARRAY['namespace','id','rawReference'] OR external_identity-ARRAY['namespace','id','rawReference']<>'{}'::jsonb
  OR jsonb_typeof(external_identity->'namespace') IS DISTINCT FROM 'string'
  OR jsonb_typeof(external_identity->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(external_identity->'rawReference') IS DISTINCT FROM 'string'
  OR external_identity->>'namespace'!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
  OR char_length(external_identity->>'id') NOT BETWEEN 1 AND 200 OR external_identity->>'id'<>btrim(external_identity->>'id')
  OR external_identity->>'id'~'[[:cntrl:]]' OR char_length(external_identity->>'rawReference') NOT BETWEEN 1 AND 1000
  OR external_identity->>'rawReference'<>btrim(external_identity->>'rawReference') OR external_identity->>'rawReference'~'[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_EVIDENCE_REQUIRED';END IF;

 IF EXISTS(SELECT FROM jsonb_array_elements(components) x(value) WHERE jsonb_typeof(x.value)<>'object') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(components) x(value)
  WHERE NOT x.value?&ARRAY['kind','sourceId','firstCent','lastCent']
  OR x.value-ARRAY['kind','sourceId','firstCent','lastCent']<>'{}'::jsonb
  OR x.value->>'kind' NOT IN('allocation','application','funds','tip')
  OR jsonb_typeof(x.value->'sourceId') IS DISTINCT FROM 'string'
  OR x.value->>'sourceId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR jsonb_typeof(x.value->'firstCent') IS DISTINCT FROM 'string' OR jsonb_typeof(x.value->'lastCent') IS DISTINCT FROM 'string'
  OR x.value->>'firstCent'!~'^[1-9][0-9]{0,18}$' OR x.value->>'lastCent'!~'^[1-9][0-9]{0,18}$')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(components) x(value)
  WHERE (x.value->>'kind') IS NULL OR (x.value->>'firstCent')::numeric>(x.value->>'lastCent')::numeric
   OR (x.value->>'lastCent')::numeric>9223372036854775807)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';END IF;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 SELECT jsonb_agg(x.value ORDER BY x.value->>'kind',(x.value->>'sourceId')::uuid,
  (x.value->>'firstCent')::bigint,(x.value->>'lastCent')::bigint)
 INTO normalized_components FROM jsonb_array_elements(components) x(value);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.collection.adjust',1,requested_business,expected_actor,expected_epoch,
  requested_failure,requested_payment,requested_customer,adjustment_kind,requested_channel,expected_channel_version,adjustment_on,
  verified_cents::text,confirmation,review_reason,external_identity,normalized_components)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.collection.adjust',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.collection.adjust' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO p FROM crest.payments WHERE business_id=requested_business AND id=requested_payment AND customer_id=requested_customer;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_ORIGINAL_REQUIRED';END IF;
 SELECT * INTO STRICT original FROM crest.financial_events WHERE business_id=requested_business AND payment_id=p.id AND template='P03';
 IF adjustment_on<original.effective_on OR adjustment_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_DATE_REQUIRED';END IF;
 IF verified_cents>p.gross_cents THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_AMOUNT_UNAVAILABLE';END IF;
 IF EXISTS(SELECT FROM crest.collection_failures x WHERE x.business_id=requested_business AND x.id=requested_failure) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='COLLECTION_FAILURE_ALREADY_RECORDED';END IF;

 IF adjustment_kind='settled_failure' THEN
  SELECT * INTO v FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,requested_channel,adjustment_on,auth->>'timezone');
  IF NOT FOUND OR v.version<>expected_channel_version THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_VERIFIED_CHANNEL_REQUIRED';END IF;
  IF EXISTS(SELECT FROM crest.external_money_evidence ev WHERE ev.business_id=requested_business
   AND ev.provider_namespace=v.provider_namespace AND ev.external_account_id=v.account_id
   AND ev.id_namespace=external_identity->>'namespace' AND ev.external_id=external_identity->>'id')
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='COLLECTION_FAILURE_EXTERNAL_ID_ALREADY_RECORDED';END IF;
  INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
   normalization_rule,confirmed_on,signed_cents,currency)
  VALUES(requested_business,v.provider_namespace,v.account_id,external_identity->>'namespace',external_identity->>'id',
   external_identity->>'rawReference','exact_case_v1',adjustment_on,-verified_cents,'USD') RETURNING id INTO evidence_id;
 ELSE
  SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=p.channel_version_id;
 END IF;

 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,adjustment_on,auth->>'timezone');
 INSERT INTO crest.collection_failures(id,business_id,payment_id,original_event_id,kind,channel_version_id,money_account_id,evidence_id,
  effective_on,cents,confirmation,reason,operation_id,created_by)
 VALUES(requested_failure,requested_business,p.id,original.id,adjustment_kind,v.id,v.account_id,evidence_id,adjustment_on,
  verified_cents,confirmation,review_reason,requested_operation,expected_actor) RETURNING * INTO s;
 FOR input IN SELECT x.value->>'kind' AS kind,(x.value->>'sourceId')::uuid AS id,
  (x.value->>'firstCent')::bigint AS lo,(x.value->>'lastCent')::bigint AS hi
  FROM jsonb_array_elements(normalized_components) x(value) LOOP
  first_cent:=input.lo;last_cent:=input.hi;
  SELECT * INTO source FROM crest_private.collection_failure_component_source(requested_business,p.id,input.kind,input.id,first_cent,last_cent);
  IF NOT FOUND OR NOT EXISTS(SELECT FROM crest.financial_events parent
   WHERE parent.business_id=requested_business AND parent.id=source.source_event_id AND parent.effective_on<=adjustment_on)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RANGE_UNAVAILABLE';END IF;
  selected_total:=selected_total+source.net_cents::numeric+source.tax_cents;
  BEGIN
   INSERT INTO crest.collection_failure_components(business_id,collection_failure_id,payment_id,allocation_id,fund_application_id,
    fund_lot_id,tip_realization_id,first_cent,last_cent,root_first_cent,root_last_cent,net_cents,tax_cents)
   VALUES(requested_business,s.id,p.id,CASE WHEN input.kind='allocation' THEN input.id END,
    CASE WHEN input.kind='application' THEN input.id END,CASE WHEN input.kind='funds' THEN input.id END,
    CASE WHEN input.kind='tip' THEN input.id END,first_cent,last_cent,source.root_first,source.root_last,source.net_cents,source.tax_cents);
  EXCEPTION WHEN exclusion_violation THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RANGE_UNAVAILABLE';
  END;
 END LOOP;
 IF selected_total<>verified_cents THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_AMOUNT_UNAVAILABLE';END IF;

 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,collection_failure_id,period_id,period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,s.id,period.period_id,period.generation,adjustment_on,auth->>'timezone','P11',1) RETURNING * INTO e;
 IF s.evidence_id IS NOT NULL THEN
  INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
  VALUES(requested_business,e.id,s.money_account_id,s.evidence_id,-s.cents) RETURNING * INTO m;
 END IF;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,s.id,s.money_account_id,m.id,'collection_failure_money',0,s.cents);
 INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_id,collection_failure_component_id,account_id,
  fixed_mapping_id,receivable_id,fund_lot_id,purpose,debit_cents,credit_cents)
 SELECT requested_business,journal_id,s.id,x.component_id,x.account_id,x.fixed_mapping_id,x.receivable_id,x.fund_lot_id,x.purpose,x.cents,0
 FROM crest_private.collection_failure_debits(requested_business,s.id) x;
 receipt:=crest_private.fictional_collection_failure_receipt(s,p,e,m,v);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'collection_failures',s.id,1,'adjust_collection',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,text,uuid,bigint,date,bigint,text,text,jsonb,jsonb) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,text,uuid,bigint,date,bigint,text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,text,uuid,bigint,date,bigint,text,text,jsonb,jsonb) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY collection_failure_original_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='collection_failures' AND action='adjust_collection'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.collection.adjust' AND o.state='committed'));

CREATE FUNCTION crest_commands.lookup_fictional_collection_failure(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_failure uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE operation crest_private.operations; s crest.collection_failures; e crest.financial_events; p crest.payments; m crest.money_movements; v crest.money_channel_versions;
 receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_failure IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO operation FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.collection.adjust','finance.collection.retire') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF operation.command_type='finance.collection.retire' THEN
  IF (operation.result->>'originalEpoch',operation.result->>'collectionFailureId') IS DISTINCT FROM
   (original_epoch::text,original_failure::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
   AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='operations' AND entity_id=operation.id
   AND action='retire' AND entity_version=1;
  IF operation.result->>'reviewEpoch' IS DISTINCT FROM operation.recovery_epoch::text
   OR audit_reason IS DISTINCT FROM operation.result->>'reason'
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',operation.result)
   OR operation.payload_hash IS DISTINCT FROM encode(sha256(convert_to((operation.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RETIREMENT_AUDIT_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',operation.result);
 END IF;
 SELECT * INTO STRICT s FROM crest.collection_failures WHERE business_id=requested_business AND operation_id=original_operation;
 IF (operation.recovery_epoch,s.id) IS DISTINCT FROM (original_epoch,original_failure) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND collection_failure_id=s.id;
 SELECT * INTO STRICT p FROM crest.payments WHERE business_id=requested_business AND id=s.payment_id;
 SELECT * INTO m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
  AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='collection_failures' AND entity_id=s.id
  AND action='adjust_collection' AND entity_version=1;
 receipt:=crest_private.fictional_collection_failure_receipt(s,p,e,m,v);
 IF operation.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM s.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY collection_failure_retirement_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.collection.retire');
CREATE POLICY collection_failure_retirement_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.collection.retire' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY collection_failure_retirement_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.collection.retire' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.collection.retire' AND state='committed');
CREATE POLICY collection_failure_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.collection.retire' AND o.state='committed'));
CREATE POLICY collection_failure_retirement_audit_insert ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.collection.retire' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_collection_failure(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_failure uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_collection_failure($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'collectionFailureId',original_failure,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.collection.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_collection_failure($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.retire_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_collection_failure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;
