-- Registered fictional reinstatement of confirmed original tips after incoming payment recovery. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-restore-tip.sql
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

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-restore-tip.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-restore-tip-posting.sql
SET LOCAL ROLE crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.collection_settlement_receipt(s crest.collection_failure_settlements,
 f crest.collection_failures,e crest.financial_events,m crest.money_movements,v crest.money_channel_versions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
 SELECT jsonb_build_object('schemaVersion',CASE WHEN EXISTS(SELECT FROM crest.collection_failure_settlement_components c WHERE (c.business_id,c.settlement_id)=(s.business_id,s.id) AND c.original_tip_realization_id IS NOT NULL) THEN 3 ELSE 2 END,'businessId',s.business_id,'operationId',s.operation_id,'settlementId',s.id,
  'eventId',e.id,'failureId',f.id,'originalPaymentId',f.payment_id,'originalEventId',f.original_event_id,'customerId',s.customer_id,
  'moneyAccountId',s.money_account_id,'moneyChannelId',v.channel_id,'moneyChannelVersion',v.version::text,
  'moneyMovementId',m.id,'evidenceId',s.evidence_id,'actualOn',to_char(s.actual_on,'YYYY-MM-DD'),'cents',s.cents::text,
  'confirmation',s.confirmation,'reason',s.reason,'components',(
   SELECT jsonb_agg(jsonb_build_object('settlementComponentId',c.id,'failureComponentId',c.failure_component_id,
    'parentPartitionId',c.parent_partition_id,'firstCent',c.first_cent::text,'lastCent',c.last_cent::text,
    'cents',(c.last_cent-c.first_cent+1)::text,'disposition',CASE WHEN c.original_tip_realization_id IS NOT NULL THEN 'tip' WHEN c.receivable_id IS NULL THEN 'funds' ELSE 'receivable' END,
    'receivableId',c.receivable_id,'fundLotId',l.id)
    || CASE WHEN c.original_tip_realization_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('tip',jsonb_build_object(
     'tipRealizationId',t.id,'originalTipRealizationId',c.original_tip_realization_id,'netCents',t.net_cents::text,
     'taxCents',t.tax_cents::text,'intentEvidence',t.customer_intent_evidence)) END ORDER BY c.first_cent,c.last_cent,c.failure_component_id)
   FROM crest.collection_failure_settlement_components c LEFT JOIN crest.customer_fund_lots l
    ON (l.business_id,l.collection_failure_settlement_component_id)=(c.business_id,c.id)
   LEFT JOIN crest.tip_realizations t ON (t.business_id,t.restored_settlement_component_id)=(c.business_id,c.id)
   WHERE (c.business_id,c.settlement_id)=(s.business_id,s.id)));
$receipt$;

RESET ROLE;

CREATE OR REPLACE FUNCTION crest_private.verify_collection_failure_settlement(business uuid,event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; s crest.collection_failure_settlements; f crest.collection_failures; prior crest.financial_events;
 m crest.money_movements; v crest.money_channel_versions; proof crest.external_money_evidence; audit_receipt jsonb;
 c crest.collection_failure_settlement_components; l crest.customer_fund_lots; j crest.journal_lines; source record;
 fresh_tip crest.tip_realizations; prior_tip crest.tip_realizations; prior_tip_id uuid; split record; group_seq bigint; journal uuid; exact_cents numeric:=0; line_count integer:=0; amount bigint; ar record;
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
  IF c.original_tip_realization_id IS NULL THEN
   SELECT * INTO STRICT j FROM crest.journal_lines line
   WHERE (line.business_id,line.entry_id,line.collection_failure_settlement_component_id)=(business,journal,c.id);
  END IF;
  amount:=c.last_cent-c.first_cent+1;
  exact_cents:=exact_cents+amount;
  line_count:=line_count+CASE WHEN c.original_tip_realization_id IS NULL THEN 1 ELSE 0 END;
  IF (source.failure_id,source.parent_partition_id,source.customer_id) IS DISTINCT FROM (s.failure_id,c.parent_partition_id,s.customer_id)
   OR c.first_cent<source.root_first OR c.last_cent>source.root_last OR (c.original_tip_realization_id IS NULL AND (j.debit_cents,j.credit_cents) IS DISTINCT FROM (0::bigint,amount))
   OR NOT EXISTS(SELECT FROM crest.collection_failure_recredit_claims a
    WHERE (a.business_id,a.settlement_component_id,a.failure_component_id,a.first_cent,a.last_cent)
     =(business,c.id,c.failure_component_id,c.first_cent,c.last_cent))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
  IF c.original_tip_realization_id IS NOT NULL THEN
   SELECT tip_realization_id INTO STRICT prior_tip_id FROM crest.collection_failure_components WHERE (business_id,id)=(business,c.failure_component_id);
   SELECT * INTO STRICT prior_tip FROM crest.tip_realizations WHERE (business_id,id)=(business,prior_tip_id);
   SELECT * INTO STRICT fresh_tip FROM crest.tip_realizations WHERE (business_id,restored_settlement_component_id)=(business,c.id);
   SELECT * INTO STRICT split FROM crest_private.tip_range_components(prior_tip,c.first_cent-prior_tip.first_cent+1,c.last_cent-prior_tip.first_cent+1);
   IF c.original_tip_realization_id<>prior_tip.id
    OR (fresh_tip.first_cent,fresh_tip.last_cent,fresh_tip.net_cents,fresh_tip.tax_cents,fresh_tip.fund_lot_id)
     IS DISTINCT FROM (c.first_cent,c.last_cent,split.net_cents,split.tax_cents,prior_tip.fund_lot_id)
    OR (fresh_tip.jurisdiction,fresh_tip.tax_profile_id,fresh_tip.revenue_mapping_id,fresh_tip.revenue_account_id,
       fresh_tip.tax_mapping_id,fresh_tip.tax_account_id,fresh_tip.operation_id,fresh_tip.created_by,fresh_tip.reason)
     IS DISTINCT FROM (prior_tip.jurisdiction,prior_tip.tax_profile_id,prior_tip.revenue_mapping_id,prior_tip.revenue_account_id,
       prior_tip.tax_mapping_id,prior_tip.tax_account_id,s.operation_id,s.created_by,s.reason)
    OR EXISTS(SELECT FROM crest.customer_fund_lots lot WHERE (lot.business_id,lot.collection_failure_settlement_component_id)=(business,c.id))
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_TIP_REQUIRED';END IF;
   line_count:=line_count+(fresh_tip.net_cents>0)::integer+(fresh_tip.tax_cents>0)::integer;
   IF (fresh_tip.net_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines line
     WHERE (line.business_id,line.entry_id,line.collection_failure_settlement_component_id,line.purpose,
       line.account_id,line.fixed_mapping_id,line.credit_cents)=(business,journal,c.id,'collection_settlement_tip_revenue',
        fresh_tip.revenue_account_id,fresh_tip.revenue_mapping_id,fresh_tip.net_cents)))
    OR (fresh_tip.tax_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines line
     WHERE (line.business_id,line.entry_id,line.collection_failure_settlement_component_id,line.purpose,line.account_id,line.credit_cents)=
       (business,journal,c.id,'collection_settlement_tip_tax',fresh_tip.tax_account_id,fresh_tip.tax_cents)))
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_JOURNAL_REQUIRED';END IF;
  ELSIF c.receivable_id IS NULL THEN
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
 IF exact_cents<>s.cents OR line_count NOT BETWEEN 1 AND 360
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
   AND o.command_type='finance.collection_failure.recredit' AND o.state='committed' AND o.result_schema_version=(audit_receipt->>'schemaVersion')::integer AND o.result=audit_receipt
   AND a.entity_kind='collection_failure_settlements' AND a.action='recredit' AND a.entity_id=s.id AND a.entity_version=1
   AND a.reason=s.reason AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',audit_receipt)
   AND e.time_zone=period.time_zone AND e.effective_on BETWEEN period.starts_on AND period.through_on
   AND e.period_generation%2=0 AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
    WHERE (h.business_id,h.period_id)=(period.business_id,period.id)),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
END $verify$;

CREATE OR REPLACE FUNCTION crest_commands.record_fictional_collection_failure_recredit(
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
 first_offset bigint; last_offset bigint; source_tip_id uuid; source_tip crest.tip_realizations; fresh_tip crest.tip_realizations; split record;
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
   OR x.value-ARRAY['failureComponentId','firstCent','lastCent','disposition','intentEvidence']<>'{}'::jsonb
   OR (x.value->>'disposition'='tip') IS DISTINCT FROM (x.value?'intentEvidence')
   OR x.value?'intentEvidence' AND (char_length(x.value->>'intentEvidence') NOT BETWEEN 1 AND 1000
    OR x.value->>'intentEvidence'<>btrim(x.value->>'intentEvidence') OR x.value->>'intentEvidence'~'[[:cntrl:]]')
   OR EXISTS(SELECT FROM jsonb_each(x.value) field WHERE jsonb_typeof(field.value)<>'string')
   OR x.value->>'failureComponentId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR x.value->>'firstCent'!~'^[1-9][0-9]{0,18}$' OR x.value->>'lastCent'!~'^[1-9][0-9]{0,18}$'
   OR x.value->>'disposition' NOT IN('funds','receivable','tip'))
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
  source_tip_id:=NULL;
  IF selected->>'disposition'='tip' THEN
   SELECT failed.tip_realization_id INTO source_tip_id FROM crest.collection_failure_components failed
    WHERE (failed.business_id,failed.id)=(requested_business,(selected->>'failureComponentId')::uuid);
   IF source_tip_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_TIP_REQUIRED';END IF;
   SELECT * INTO STRICT source_tip FROM crest.tip_realizations WHERE (business_id,id)=(requested_business,source_tip_id);
   SELECT * INTO STRICT split FROM crest_private.tip_range_components(source_tip,
    first_offset-source_tip.first_cent+1,last_offset-source_tip.first_cent+1);
  END IF;
  INSERT INTO crest.collection_failure_settlement_components(business_id,settlement_id,failure_id,failure_component_id,parent_partition_id,
   first_cent,last_cent,receivable_id,original_tip_realization_id)
  VALUES(requested_business,s.id,f.id,(selected->>'failureComponentId')::uuid,source.parent_partition_id,first_offset,last_offset,
   CASE WHEN selected->>'disposition'='receivable' THEN source.original_receivable_id END,source_tip_id) RETURNING * INTO c;
  IF source_tip_id IS NOT NULL THEN
   INSERT INTO crest.tip_realizations(id,business_id,restored_settlement_component_id,fund_lot_id,first_cent,last_cent,net_cents,tax_cents,
    jurisdiction,tax_profile_id,revenue_mapping_id,revenue_account_id,tax_mapping_id,tax_account_id,customer_intent_evidence,reason,operation_id,created_by)
   VALUES(gen_random_uuid(),requested_business,c.id,source_tip.fund_lot_id,c.first_cent,c.last_cent,split.net_cents,split.tax_cents,source_tip.jurisdiction,
    source_tip.tax_profile_id,source_tip.revenue_mapping_id,source_tip.revenue_account_id,source_tip.tax_mapping_id,source_tip.tax_account_id,
    selected->>'intentEvidence',review_reason,requested_operation,expected_actor) RETURNING * INTO fresh_tip;
   IF fresh_tip.net_cents>0 THEN
    INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_settlement_id,collection_failure_settlement_component_id,
     account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
    VALUES(requested_business,journal,s.id,c.id,fresh_tip.revenue_account_id,fresh_tip.revenue_mapping_id,'collection_settlement_tip_revenue',0,fresh_tip.net_cents);
   END IF;
   IF fresh_tip.tax_cents>0 THEN
    INSERT INTO crest.journal_lines(business_id,entry_id,collection_failure_settlement_id,collection_failure_settlement_component_id,
     account_id,purpose,debit_cents,credit_cents)
    VALUES(requested_business,journal,s.id,c.id,fresh_tip.tax_account_id,'collection_settlement_tip_tax',0,fresh_tip.tax_cents);
   END IF;
  ELSIF c.receivable_id IS NULL THEN
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
 UPDATE crest_private.operations SET state='committed',result_schema_version=(receipt->>'schemaVersion')::integer,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-restore-tip-posting.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-restore-tip-lineage.sql
RESET ROLE;

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_tip_realization_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid; source_template text;
BEGIN
 IF NEW.restored_settlement_component_id IS NOT NULL THEN
  SELECT e.event_id INTO event_id FROM crest_private.tip_generation_posting(NEW) e;
  IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_TIP_REQUIRED';END IF;
  PERFORM crest_private.verify_finance_event_posting(NEW.business_id,event_id);
  RETURN NULL;
 END IF;
 SELECT e.id,e.template INTO event_id,source_template FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.tip_realization_id=NEW.id;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_SOURCE_REQUIRED';END IF;
 IF source_template='P03' THEN
  PERFORM crest_private.verify_direct_receipt(NEW.business_id,event_id);
 ELSE
  PERFORM crest_private.verify_fictional_tip_realization(NEW.business_id,event_id);
 END IF;
 RETURN NULL;
END $verify$;

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_tip_return(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; s crest.tip_returns; t crest.tip_realizations; l crest.customer_fund_lots;
 original crest.financial_events; v crest.money_channel_versions; m crest.money_movements; evidence crest.external_money_evidence;
 journal uuid; receipt jsonb; amounts record;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT s FROM crest.tip_returns WHERE business_id=requested_business AND id=e.tip_return_id;
 SELECT * INTO STRICT t FROM crest.tip_realizations WHERE business_id=requested_business AND id=s.tip_realization_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id;
 SELECT original_posting.* INTO STRICT original FROM crest_private.tip_generation_posting(t) source JOIN crest.financial_events original_posting ON (original_posting.business_id,original_posting.id)=(requested_business,source.event_id);
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT * INTO STRICT m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT evidence FROM crest.external_money_evidence WHERE business_id=requested_business AND id=s.evidence_id;
 SELECT sum(x.last_cent-x.first_cent+1) AS cents,sum(component.net_cents) AS net,sum(component.tax_cents) AS tax,
  count(*) AS ranges,count(component.net_cents) AS valid_ranges INTO amounts
 FROM crest.tip_realization_range_consumptions x
 LEFT JOIN LATERAL crest_private.tip_range_components(t,x.first_cent,x.last_cent) component ON true
 WHERE x.business_id=requested_business AND x.tip_return_id=s.id;
 receipt:=crest_private.fictional_tip_return_receipt(s,t,original,l,e,m,v);
 IF e.template<>'P10' OR e.event_sequence<>1 OR original.template NOT IN('P03','P06','P11') OR original.event_sequence<>1
  OR e.effective_on<>s.actual_on OR e.effective_on<original.effective_on OR e.posted_at<s.created_at
  OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR (amounts.cents,amounts.net,amounts.tax) IS DISTINCT FROM (s.cents::numeric,s.net_cents::numeric,s.tax_cents::numeric)
  OR amounts.ranges NOT BETWEEN 1 AND 180 OR amounts.valid_ranges<>amounts.ranges
  OR s.channel_version_id IS DISTINCT FROM crest_private.direct_receipt_channel(requested_business,v.channel_id,s.actual_on,e.time_zone)
  OR (v.account_id,m.account_id,m.evidence_id,m.signed_cents) IS DISTINCT FROM (s.account_id,s.account_id,s.evidence_id,-s.cents)
  OR (evidence.external_account_id,evidence.provider_namespace,evidence.confirmed_on,evidence.signed_cents,evidence.currency)
   IS DISTINCT FROM (s.account_id,v.provider_namespace,s.actual_on,-s.cents,'USD'::text)
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest.atomic_finance_groups prior ON prior.business_id=original.business_id AND prior.id=original.group_id
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest_private.audit_events audit ON audit.business_id=o.business_id AND audit.operation_id=o.operation_id AND audit.actor_id=o.actor_id
   JOIN crest.accounting_periods period ON period.business_id=e.business_id AND period.id=e.period_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=s.operation_id AND g.created_by=s.created_by
    AND g.commit_sequence>prior.commit_sequence AND g.recovery_epoch=o.recovery_epoch
    AND o.command_type='finance.refund.record_tip' AND o.state='committed' AND o.result=receipt
    AND audit.entity_kind='tip_returns' AND audit.entity_id=s.id AND audit.entity_version=1 AND audit.action='record_return'
    AND audit.reason=s.reason AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
    AND e.time_zone=period.time_zone AND e.effective_on BETWEEN period.starts_on AND period.through_on AND e.period_generation%2=0
    AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
     WHERE h.business_id=period.business_id AND h.period_id=period.id),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_SOURCE_REQUIRED';END IF;

 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR (SELECT count(*) FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal)<>1+(s.net_cents>0)::int+(s.tax_cents>0)::int
  OR (s.net_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
    AND x.purpose='tip_return_revenue' AND x.tip_return_id=s.id AND x.account_id=t.revenue_account_id
    AND x.fixed_mapping_id=t.revenue_mapping_id AND x.debit_cents=s.net_cents))
  OR (s.tax_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
    AND x.purpose='tip_return_tax' AND x.tip_return_id=s.id AND x.account_id=t.tax_account_id AND x.debit_cents=s.tax_cents))
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
    AND x.purpose='tip_return_money' AND x.tip_return_id=s.id AND x.account_id=s.account_id
    AND x.money_movement_id=m.id AND x.credit_cents=s.cents)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE x.business_id=e.business_id AND x.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_JOURNAL_REQUIRED';END IF;
END $verify$;

CREATE OR REPLACE FUNCTION crest_commands.record_fictional_tip_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_return uuid,requested_tip uuid,requested_customer uuid,
 requested_channel uuid,expected_channel_version bigint,actual_on date,
 confirmation text,review_reason text,external_identity jsonb,verified_cents bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; claimed uuid;
 t crest.tip_realizations; l crest.customer_fund_lots; original crest.financial_events; v crest.money_channel_versions;
 s crest.tip_returns; e crest.financial_events; m crest.money_movements; period record;
 group_id uuid; journal_id uuid; evidence_id uuid; receipt jsonb; amounts record;
BEGIN
 IF requested_operation IS NULL OR requested_return IS NULL OR requested_tip IS NULL OR requested_customer IS NULL
  OR requested_channel IS NULL OR expected_channel_version IS NULL OR expected_channel_version<=0
  OR actual_on IS NULL OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
  OR verified_cents IS NULL OR verified_cents<1
  OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000 OR confirmation<>btrim(confirmation) OR confirmation~'[[:cntrl:]]'
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]'
  OR jsonb_typeof(external_identity) IS DISTINCT FROM 'object' OR octet_length(external_identity::text)>8192
  OR NOT external_identity?&ARRAY['namespace','id','rawReference'] OR external_identity-ARRAY['namespace','id','rawReference']<>'{}'::jsonb
  OR jsonb_typeof(external_identity->'namespace') IS DISTINCT FROM 'string'
  OR jsonb_typeof(external_identity->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(external_identity->'rawReference') IS DISTINCT FROM 'string'
  OR external_identity->>'namespace'!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
  OR char_length(external_identity->>'id') NOT BETWEEN 1 AND 200 OR external_identity->>'id'<>btrim(external_identity->>'id')
  OR external_identity->>'id'~'[[:cntrl:]]' OR char_length(external_identity->>'rawReference') NOT BETWEEN 1 AND 1000
  OR external_identity->>'rawReference'<>btrim(external_identity->>'rawReference') OR external_identity->>'rawReference'~'[[:cntrl:]]'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_RETURN_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.refund.record_tip',1,requested_business,expected_actor,expected_epoch,
  requested_return,requested_tip,requested_customer,requested_channel,expected_channel_version,actual_on,
  confirmation,review_reason,external_identity,verified_cents::text)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.refund.record_tip',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.refund.record_tip' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);

 SELECT * INTO t FROM crest.tip_realizations WHERE business_id=requested_business AND id=requested_tip;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_ORIGINAL_REQUIRED';END IF;
 SELECT * INTO l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id AND customer_id=requested_customer;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_ORIGINAL_REQUIRED';END IF;
 SELECT original_posting.* INTO original FROM crest_private.tip_generation_posting(t) source JOIN crest.financial_events original_posting ON (original_posting.business_id,original_posting.id)=(requested_business,source.event_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_ORIGINAL_REQUIRED';END IF;
 IF actual_on<original.effective_on OR actual_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_DATE_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.tip_returns x WHERE x.business_id=requested_business AND x.id=requested_return) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='TIP_RETURN_ALREADY_RECORDED';
 END IF;

 -- Consume the lowest eligible relative offsets on the original tip selected by the owner.
 -- Prefix differences retain the original realization's frozen tax, including after gaps.
 WITH spans AS (
  SELECT lag(boundary.last_cent,1,0::numeric) OVER(ORDER BY boundary.first_cent)+1 AS first_cent,
   boundary.first_cent-1 AS last_cent
  FROM (
   SELECT x.first_cent::numeric,x.last_cent::numeric FROM crest.tip_realization_range_consumptions x
   WHERE x.business_id=requested_business AND x.tip_realization_id=t.id
   UNION ALL SELECT t.inclusive_cents::numeric+1,NULL::numeric
  ) boundary
 ), available AS (
  SELECT first_cent,last_cent,coalesce(sum(last_cent-first_cent+1) OVER(
   ORDER BY first_cent ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS used
  FROM spans WHERE last_cent>=first_cent
 ), bounded AS (
  SELECT first_cent::bigint AS first_cent,least(last_cent,first_cent+verified_cents-used-1)::bigint AS last_cent
  FROM available WHERE used<verified_cents ORDER BY first_cent LIMIT 181
 )
 SELECT jsonb_agg(jsonb_build_object('first_cent',x.first_cent,'last_cent',x.last_cent) ORDER BY x.first_cent) AS selected,
  sum(x.last_cent-x.first_cent+1) AS cents,sum(c.net_cents) AS net,sum(c.tax_cents) AS tax,count(*) AS ranges
 INTO amounts
 FROM bounded x CROSS JOIN LATERAL crest_private.tip_range_components(t,x.first_cent,x.last_cent) c;
 IF amounts.cents IS DISTINCT FROM verified_cents::numeric OR amounts.ranges NOT BETWEEN 1 AND 180 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_AMOUNT_UNAVAILABLE';
 END IF;
 SELECT * INTO v FROM crest.money_channel_versions candidate WHERE candidate.business_id=requested_business
  AND candidate.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,auth->>'timezone');
 IF NOT FOUND OR v.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_VERIFIED_CHANNEL_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,auth->>'timezone');
 IF EXISTS(SELECT FROM crest.external_money_evidence ev WHERE ev.business_id=requested_business
  AND ev.provider_namespace=v.provider_namespace AND ev.external_account_id=v.account_id
  AND ev.id_namespace=external_identity->>'namespace' AND ev.external_id=external_identity->>'id')
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='TIP_RETURN_EXTERNAL_ID_ALREADY_RECORDED';END IF;

 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,v.provider_namespace,v.account_id,external_identity->>'namespace',external_identity->>'id',
  external_identity->>'rawReference','exact_case_v1',actual_on,-verified_cents,'USD') RETURNING id INTO evidence_id;
 INSERT INTO crest.tip_returns(id,business_id,tip_realization_id,channel_version_id,account_id,evidence_id,
  actual_on,cents,net_cents,tax_cents,confirmation,reason,operation_id,created_by)
 VALUES(requested_return,requested_business,t.id,v.id,v.account_id,evidence_id,actual_on,verified_cents,amounts.net,amounts.tax,
  confirmation,review_reason,requested_operation,expected_actor) RETURNING * INTO s;
 INSERT INTO crest.tip_realization_range_consumptions(business_id,tip_realization_id,tip_return_id,first_cent,last_cent)
 SELECT requested_business,t.id,s.id,x.first_cent,x.last_cent FROM jsonb_to_recordset(amounts.selected) AS x(first_cent bigint,last_cent bigint);
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,tip_return_id,period_id,period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,s.id,period.period_id,period.generation,actual_on,auth->>'timezone','P10',1) RETURNING * INTO e;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,e.id,v.account_id,evidence_id,-s.cents) RETURNING * INTO m;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 IF s.net_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,tip_return_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,s.id,t.revenue_account_id,t.revenue_mapping_id,'tip_return_revenue',s.net_cents,0);
 END IF;
 IF s.tax_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,tip_return_id,account_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,s.id,t.tax_account_id,'tip_return_tax',s.tax_cents,0);
 END IF;
 INSERT INTO crest.journal_lines(business_id,entry_id,tip_return_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,s.id,v.account_id,m.id,'tip_return_money',0,s.cents);
 receipt:=crest_private.fictional_tip_return_receipt(s,t,original,l,e,m,v);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'tip_returns',s.id,1,'record_return',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE OR REPLACE FUNCTION crest_commands.read_fictional_tip_return_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; tips jsonb; channels jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR actual_on IS NULL OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_RETURN_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);

 SELECT coalesce(jsonb_agg(jsonb_build_object('tipRealizationId',available.id,'originalTipEventId',available.event_id,
  'realizedOn',to_char(available.effective_on,'YYYY-MM-DD'),'originalCents',available.inclusive_cents::text,
  'availableCents',available.remaining::text) ORDER BY available.effective_on,available.id),'[]'::jsonb) INTO tips
 FROM (
  SELECT tip.id,event.event_id,event.effective_on,tip.inclusive_cents,remaining.cents AS remaining
  FROM crest.tip_realizations tip
  JOIN crest.customer_fund_lots lot ON lot.business_id=tip.business_id AND lot.id=tip.fund_lot_id
  CROSS JOIN LATERAL crest_private.tip_generation_posting(tip) event
  CROSS JOIN LATERAL (
   SELECT tip.inclusive_cents-coalesce(sum(used.last_cent-used.first_cent+1),0) AS cents
   FROM crest.tip_realization_range_consumptions used WHERE used.business_id=tip.business_id AND used.tip_realization_id=tip.id
  ) remaining
  WHERE tip.business_id=requested_business AND lot.customer_id=requested_customer AND event.effective_on<=actual_on
   AND remaining.cents>0
  ORDER BY event.effective_on,tip.id LIMIT 181
 ) available;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,
  'label',v.label,'kind',v.kind) ORDER BY v.label,v.id),'[]'::jsonb) INTO channels
 FROM (
  SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,actual_on,zone)
  ORDER BY c.label,c.id LIMIT 181
 ) v;
 IF jsonb_array_length(tips)>180 OR jsonb_array_length(channels)>180 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='TIP_RETURN_OPTIONS_LIMIT';
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=period.business_id AND h.period_id=period.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND actual_on BETWEEN period.starts_on AND period.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'tips',tips,'channels',channels);
END $options$;

CREATE OR REPLACE FUNCTION crest_private.collection_failure_component_source(
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
 SELECT e.event_id,t.first_cent+(requested_first-1),t.first_cent+(requested_last-1),NULL::uuid,NULL::uuid,
  slices.net_cents,slices.tax_cents,t.revenue_account_id,t.revenue_mapping_id,t.tax_account_id
 FROM root
 JOIN crest.customer_fund_lots l ON (l.business_id,l.origin_id,l.customer_id)=(requested_business,root.id,root.customer_id)
 JOIN crest.tip_realizations t ON (t.business_id,t.fund_lot_id)=(l.business_id,l.id)
 CROSS JOIN LATERAL crest_private.tip_generation_posting(t) e
 CROSS JOIN LATERAL crest_private.tip_range_components(t,requested_first,requested_last) slices
 WHERE component_kind='tip' AND t.id=requested_source;
$source$;

CREATE OR REPLACE FUNCTION crest_commands.read_fictional_collection_failure_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_payment uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE context jsonb; zone text; payment crest.payments; original_label text;
 source_event uuid; root_id uuid; components jsonb; channels jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_payment IS NULL OR reviewed_on IS NULL
  OR reviewed_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=context->>'timezone';
 IF reviewed_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT p.* INTO payment FROM crest.payments p WHERE p.business_id=requested_business
  AND p.customer_id=requested_customer AND p.id=requested_payment;
 IF payment.id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_ORIGINAL_REQUIRED';
 END IF;
 IF payment.actual_on>reviewed_on THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_DATE_REQUIRED';
 END IF;
 SELECT v.label INTO STRICT original_label FROM crest.money_channel_versions v
  WHERE v.business_id=requested_business AND v.id=payment.channel_version_id;
 SELECT e.id INTO STRICT source_event FROM crest.financial_events e
  WHERE e.business_id=requested_business AND e.template='P03' AND e.payment_id=payment.id;
 SELECT root.id INTO STRICT root_id FROM crest.funding_origins root
  WHERE root.business_id=requested_business AND root.payment_id=payment.id AND root.customer_id=requested_customer;

 WITH lots AS (
  SELECT lot.id,coalesce(u.first_cent,p.first_cent) AS first_cent,coalesce(u.last_cent,p.last_cent) AS last_cent
  FROM crest.customer_fund_lots lot
  JOIN crest.funding_partitions p ON p.business_id=lot.business_id AND p.id=lot.parent_partition_id AND p.origin_id=root_id
  LEFT JOIN crest.allocation_unapplications u ON u.business_id=lot.business_id AND u.id=lot.unapplication_id
  LEFT JOIN crest.financial_events released ON released.business_id=lot.business_id AND released.unapplication_id=u.id
  WHERE lot.business_id=requested_business AND lot.origin_id=root_id AND lot.customer_id=requested_customer
   AND (u.id IS NULL OR released.effective_on<=reviewed_on)
 ), eligible AS (
  SELECT 'allocation' AS kind,a.id AS source_id,'Applied to '||i.invoice_number AS label,p.first_cent,p.last_cent
  FROM crest.allocation_events a
  JOIN crest.funding_partitions p ON p.business_id=a.business_id AND p.id=a.partition_id AND p.origin_id=root_id
  JOIN crest.receivable_items r ON r.business_id=a.business_id AND r.id=a.receivable_id AND r.customer_id=requested_customer
  JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
  WHERE a.business_id=requested_business AND a.event_id=source_event
  UNION ALL
  SELECT 'application',a.id,'Applied to '||i.invoice_number,a.first_cent,a.last_cent
  FROM lots lot
  JOIN crest.customer_fund_applications a ON a.business_id=requested_business AND a.fund_lot_id=lot.id
  JOIN crest.financial_events applied ON applied.business_id=a.business_id AND applied.fund_application_id=a.id
   AND applied.template='P04' AND applied.effective_on<=reviewed_on
  JOIN crest.receivable_items r ON r.business_id=a.business_id AND r.id=a.receivable_id AND r.customer_id=requested_customer
  JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
  UNION ALL
  SELECT 'funds',lot.id,'Customer funds held',lot.first_cent,lot.last_cent FROM lots lot
  WHERE NOT EXISTS(SELECT FROM crest.customer_fund_lots anchor
   WHERE (anchor.business_id,anchor.id)=(requested_business,lot.id) AND anchor.receipt_tip_event_id IS NOT NULL)
  UNION ALL
  SELECT 'tip',tip.id,'Tip recorded '||to_char(realized.effective_on,'YYYY-MM-DD'),1,tip.inclusive_cents
  FROM lots lot
  JOIN crest.tip_realizations tip ON tip.business_id=requested_business AND tip.fund_lot_id=lot.id
  JOIN LATERAL crest_private.tip_generation_posting(tip) realized ON realized.effective_on<=reviewed_on
 ), used AS (
  SELECT 'allocation' AS kind,u.allocation_id AS source_id,u.first_cent,u.last_cent
  FROM crest.allocation_unapplications u WHERE u.business_id=requested_business
   AND u.allocation_id IN (SELECT source_id FROM eligible WHERE kind='allocation')
  UNION ALL
  SELECT CASE WHEN c.allocation_id IS NOT NULL THEN 'allocation' ELSE 'application' END,
   coalesce(c.allocation_id,c.fund_application_id),c.first_cent,c.last_cent
  FROM crest.collection_failure_components c WHERE c.business_id=requested_business AND c.payment_id=requested_payment
   AND (c.allocation_id IS NOT NULL OR c.fund_application_id IS NOT NULL)
  UNION ALL
  SELECT 'funds',c.fund_lot_id,c.first_cent,c.last_cent FROM crest.fund_lot_range_consumptions c
   WHERE c.business_id=requested_business AND c.fund_lot_id IN (SELECT id FROM lots)
  UNION ALL
  SELECT 'tip',c.tip_realization_id,c.first_cent,c.last_cent FROM crest.tip_realization_range_consumptions c
   WHERE c.business_id=requested_business AND c.tip_realization_id IN (SELECT source_id FROM eligible WHERE kind='tip')
 ), used_by_component AS (
  SELECT kind,source_id,range_agg(numrange(first_cent::numeric,last_cent::numeric+1,'[)')) AS spans
  FROM used GROUP BY kind,source_id
 ), ready AS (
  SELECT item.*,gaps.ranges
  FROM eligible item LEFT JOIN used_by_component old USING(kind,source_id)
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',lower(gap)::text,'lastCent',(upper(gap)-1)::text)
    ORDER BY lower(gap)),'[]'::jsonb) AS ranges
   FROM (SELECT span AS gap FROM unnest(nummultirange(numrange(item.first_cent::numeric,item.last_cent::numeric+1,'[)'))
     -coalesce(old.spans,'{}'::nummultirange)) AS span ORDER BY lower(span) LIMIT 181) bounded
  ) gaps
  WHERE jsonb_array_length(gaps.ranges)>0
  ORDER BY item.kind,item.source_id LIMIT 181
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'sourceId',source_id,'label',label,'availableRanges',ranges)
  ORDER BY kind,source_id),'[]'::jsonb) INTO components FROM ready;

 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,
  'label',v.label,'kind',v.kind) ORDER BY v.label,v.id),'[]'::jsonb) INTO channels
 FROM (
  SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,reviewed_on,zone)
  ORDER BY c.label,c.id LIMIT 181
 ) v;
 IF jsonb_array_length(components)>180 OR jsonb_array_length(channels)>180 OR EXISTS(
  SELECT FROM jsonb_array_elements(components) item WHERE jsonb_array_length(item->'availableRanges')>180
 ) THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_FAILURE_OPTIONS_LIMIT';
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=period.business_id AND h.period_id=period.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND reviewed_on BETWEEN period.starts_on AND period.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,'originalPaymentId',requested_payment,
  'effectiveOn',to_char(reviewed_on,'YYYY-MM-DD'),'receivedOn',to_char(payment.actual_on,'YYYY-MM-DD'),'originalCents',payment.gross_cents::text,
  'originalAccountLabel',original_label,'openPeriod',open_period,'components',components,'channels',channels);
END $options$;

CREATE OR REPLACE FUNCTION crest_commands.record_fictional_collection_failure(
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
  IF adjustment_kind<>'settled_failure' AND input.kind='tip' AND EXISTS(
   SELECT FROM crest.tip_realizations t WHERE (t.business_id,t.id)=(requested_business,input.id)
    AND t.restored_settlement_component_id IS NOT NULL)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_FAILURE_RANGE_UNAVAILABLE';END IF;
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

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_collection_failure(requested_business uuid,requested_event uuid)
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
   AND ((x.restored_tip_generation_id IS NOT NULL AND s.kind<>'settled_failure')
    OR parent.id IS NULL OR parent.effective_on>e.effective_on OR prior.commit_sequence>=posted.commit_sequence
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

CREATE OR REPLACE FUNCTION crest_commands.lookup_fictional_tip_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_return uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE operation crest_private.operations; s crest.tip_returns; e crest.financial_events; original crest.financial_events;
 t crest.tip_realizations; l crest.customer_fund_lots; m crest.money_movements; v crest.money_channel_versions;
 receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_return IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_RETURN_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO operation FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.refund.record_tip','finance.refund.retire_tip') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF operation.command_type='finance.refund.retire_tip' THEN
  IF (operation.result->>'originalEpoch',operation.result->>'tipReturnId') IS DISTINCT FROM
   (original_epoch::text,original_return::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
   AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='operations' AND entity_id=operation.id
   AND action='retire' AND entity_version=1;
  IF operation.result->>'reviewEpoch' IS DISTINCT FROM operation.recovery_epoch::text
   OR audit_reason IS DISTINCT FROM operation.result->>'reason'
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',operation.result)
   OR operation.payload_hash IS DISTINCT FROM encode(sha256(convert_to((operation.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_RETIREMENT_AUDIT_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',operation.result);
 END IF;
 SELECT * INTO STRICT s FROM crest.tip_returns WHERE business_id=requested_business AND operation_id=original_operation;
 IF (operation.recovery_epoch,s.id) IS DISTINCT FROM (original_epoch,original_return) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND tip_return_id=s.id;
 SELECT * INTO STRICT t FROM crest.tip_realizations WHERE business_id=requested_business AND id=s.tip_realization_id;
 SELECT original_posting.* INTO STRICT original FROM crest_private.tip_generation_posting(t) source JOIN crest.financial_events original_posting ON (original_posting.business_id,original_posting.id)=(requested_business,source.event_id);
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id;
 SELECT * INTO STRICT m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
  AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='tip_returns' AND entity_id=s.id
  AND action='record_return' AND entity_version=1;
 receipt:=crest_private.fictional_tip_return_receipt(s,t,original,l,e,m,v);
 IF operation.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM s.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;

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
   UNION ALL
   SELECT t.tax_account_id,sum(t.tax_cents::numeric)
   FROM crest.tip_realizations t JOIN LATERAL crest_private.tip_generation_posting(t) posted ON posted.effective_on<=through_on
   WHERE t.business_id=requested_business AND t.restored_settlement_component_id IS NOT NULL AND t.tax_cents>0 GROUP BY t.tax_account_id
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

RESET ROLE;

CREATE OR REPLACE FUNCTION crest_private.retain_fund_range_consumption() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retain$
DECLARE application uuid; tip uuid;
BEGIN
 IF TG_TABLE_NAME='customer_fund_applications' THEN
  application:=NEW.id;
 ELSE
  IF NEW.restored_settlement_component_id IS NOT NULL THEN RETURN NULL;END IF;
  tip:=NEW.id;
 END IF;
 INSERT INTO crest.fund_lot_range_consumptions(business_id,fund_lot_id,first_cent,last_cent,fund_application_id,tip_realization_id)
 VALUES(NEW.business_id,NEW.fund_lot_id,NEW.first_cent,NEW.last_cent,application,tip);
 RETURN NULL;
EXCEPTION WHEN exclusion_violation THEN
 IF application IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_RANGE_UNAVAILABLE';
 END IF;
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_RANGE_UNAVAILABLE';
END $retain$;

CREATE OR REPLACE FUNCTION crest_commands.read_fictional_collection_failure_recredit_options(
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
  'tipReinstatement',(SELECT jsonb_build_object('originalTipRealizationId',t.id,'originalNetCents',t.net_cents::text,
   'originalTaxCents',t.tax_cents::text,'taxProfileId',t.tax_profile_id)
   FROM crest.collection_failure_components failed_tip JOIN crest.tip_realizations t ON (t.business_id,t.id)=(failed_tip.business_id,failed_tip.tip_realization_id)
   WHERE (failed_tip.business_id,failed_tip.id)=(requested_business,s.component_id)),
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

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-restore-tip-lineage.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-restore-tip-report.sql
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_journal_v15(
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
  crest_private.fictional_journal_body_v14(requested_business,selected,requested_account,after_line,page_limit)||jsonb_build_object('schemaVersion',15) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_journal_v15(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_journal_v15(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-restore-tip-report.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-restore-tip-source.sql
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
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HELD_TIP_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

-- Retain old export scopes and add an explicit delta for restored generations and original-link columns.
ALTER POLICY held_tip_source_export_read ON crest.tip_realizations
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND restored_settlement_component_id IS NULL);
GRANT SELECT(restored_settlement_component_id) ON crest.tip_realizations TO crest_refund_transfer_export_owner;
GRANT SELECT(id,business_id,fund_lot_id,first_cent,last_cent,inclusive_cents,net_cents,tax_cents,jurisdiction,tax_profile_id,
 revenue_mapping_id,revenue_account_id,tax_mapping_id,tax_account_id,customer_intent_evidence,reason,operation_id,created_by,created_at)
 ON crest.tip_realizations TO crest_refund_transfer_export_owner;
GRANT SELECT(original_tip_realization_id) ON crest.collection_failure_settlement_components TO crest_refund_transfer_export_owner;
GRANT SELECT(id,business_id,restored_tip_generation_id) ON crest.collection_failure_components TO crest_refund_transfer_export_owner;
CREATE POLICY restored_tip_source_export ON crest.tip_realizations FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND restored_settlement_component_id IS NOT NULL);
CREATE POLICY restored_tip_failure_source_export ON crest.collection_failure_components FOR SELECT TO crest_refund_transfer_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND restored_tip_generation_id IS NOT NULL);
DO $shape$
DECLARE source record; relation oid;
BEGIN
 FOR source IN SELECT * FROM (VALUES
  ('tip_realizations',ARRAY['id','business_id','fund_lot_id','first_cent','last_cent','inclusive_cents','net_cents','tax_cents','jurisdiction',
   'tax_profile_id','revenue_mapping_id','revenue_account_id','tax_mapping_id','tax_account_id','customer_intent_evidence','reason',
   'operation_id','created_by','created_at','restored_settlement_component_id']),
  ('collection_failure_components',ARRAY['id','business_id','collection_failure_id','payment_id','allocation_id','fund_application_id',
   'fund_lot_id','tip_realization_id','first_cent','last_cent','root_first_cent','root_last_cent','net_cents','tax_cents','restored_tip_generation_id']),
  ('collection_failure_settlement_components',ARRAY['id','business_id','settlement_id','failure_id','failure_component_id',
   'parent_partition_id','first_cent','last_cent','receivable_id','original_tip_realization_id'])
 ) v(table_name,fields) LOOP
  SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='crest' AND c.relname=source.table_name AND c.relkind='r'
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
  IF relation IS NULL OR source.fields IS DISTINCT FROM (SELECT array_agg(attname::text ORDER BY attnum)
   FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped)
   OR has_any_column_privilege('crest_export',relation,'SELECT,INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='COLLECTION_RESTORED_TIP_SOURCE_REVIEW_REQUIRED';END IF;
 END LOOP;
END $shape$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_refund_transfer_export_owner;
SET LOCAL ROLE crest_refund_transfer_export_owner;
CREATE FUNCTION crest_commands.collection_failure_restored_tip_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $read$
DECLARE history jsonb; generations jsonb; settlements jsonb; failures jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='COLLECTION_RESTORED_TIP_SOURCE_SNAPSHOT_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 SELECT coalesce(jsonb_agg(to_jsonb(tip) ORDER BY tip.id),'[]'::jsonb) INTO generations FROM (
  SELECT t.id,t.business_id,t.fund_lot_id,t.first_cent::text,t.last_cent::text,t.inclusive_cents::text,t.net_cents::text,t.tax_cents::text,
   t.jurisdiction,t.tax_profile_id,t.revenue_mapping_id,t.revenue_account_id,t.tax_mapping_id,t.tax_account_id,
   t.customer_intent_evidence,t.reason,t.operation_id,t.created_by,
   to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,t.restored_settlement_component_id
  FROM crest.tip_realizations t WHERE t.business_id=requested_business AND t.restored_settlement_component_id IS NOT NULL
  ORDER BY t.id LIMIT 1001
 ) tip;
 SELECT coalesce(jsonb_agg(to_jsonb(child) ORDER BY child.id),'[]'::jsonb) INTO settlements FROM (
  SELECT c.id,c.original_tip_realization_id FROM crest.collection_failure_settlement_components c
  WHERE c.business_id=requested_business AND c.original_tip_realization_id IS NOT NULL ORDER BY c.id LIMIT 1001
 ) child;
 SELECT coalesce(jsonb_agg(to_jsonb(component) ORDER BY component.id),'[]'::jsonb) INTO failures FROM (
  SELECT c.id,c.restored_tip_generation_id FROM crest.collection_failure_components c
  WHERE c.business_id=requested_business AND c.restored_tip_generation_id IS NOT NULL ORDER BY c.id LIMIT 1001
 ) component;
 IF jsonb_array_length(generations)+jsonb_array_length(settlements)+jsonb_array_length(failures)>1000
  OR octet_length(generations::text)+octet_length(settlements::text)+octet_length(failures::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RESTORED_TIP_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'historySnapshotToken',history->>'snapshotToken',
  'generations',generations,'settlements',settlements,'failures',failures);
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_refund_transfer_export_owner;
REVOKE ALL ON FUNCTION crest_commands.collection_failure_restored_tip_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.collection_failure_restored_tip_source_snapshot(uuid) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-collection-failure-restore-tip-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-collection-failure-restore-tip-export-access.sql
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-collection-failure-restore-tip-export-access.sql
