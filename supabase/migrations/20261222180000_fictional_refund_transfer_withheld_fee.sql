-- Registered fictional provider-withheld refund fees. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-refund-transfer-withheld-fee.sql
-- Held fictional provider-withheld fee on a returned outgoing refund (ACCOUNTING 4.2, 24.3).
-- Apply after registered97 in the coordinator's transaction. This initiates no money movement.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.refund_transfer_embedded_fees (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 adjustment_id uuid NOT NULL,
 mapping_id uuid NOT NULL,
 fee_account_id uuid NOT NULL,
 net_cents bigint NOT NULL CHECK(net_cents>0),
 cents bigint NOT NULL CHECK(cents>0),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000
  AND confirmation=btrim(confirmation) AND confirmation!~'[[:cntrl:]]'),
 component_evidence_id uuid,
 UNIQUE(business_id,adjustment_id),
 UNIQUE(business_id,component_evidence_id),
 FOREIGN KEY(business_id,adjustment_id) REFERENCES crest.refund_transfer_adjustments(business_id,id),
 FOREIGN KEY(business_id,mapping_id) REFERENCES crest.account_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,fee_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,component_evidence_id) REFERENCES crest.external_money_evidence(business_id,id)
);
ALTER TABLE crest.refund_transfer_embedded_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.refund_transfer_embedded_fees FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.refund_transfer_embedded_fees TO crest_finance_integrity_owner;
GRANT SELECT,INSERT ON crest.refund_transfer_embedded_fees TO crest_finance_account_owner;
CREATE POLICY refund_transfer_fee_integrity ON crest.refund_transfer_embedded_fees
 FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY refund_transfer_fee_read ON crest.refund_transfer_embedded_fees
 FOR SELECT TO crest_finance_account_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY refund_transfer_fee_insert ON crest.refund_transfer_embedded_fees FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.refund_transfer_adjustments a
  JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.created_by
  WHERE a.business_id=refund_transfer_embedded_fees.business_id AND a.id=refund_transfer_embedded_fees.adjustment_id
   AND a.kind='recredit' AND o.state='pending' AND o.command_type='finance.refund.adjust_transfer'));
CREATE TRIGGER refund_transfer_fee_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.refund_transfer_embedded_fees
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.refund_transfer_fee_mapping(requested_business uuid,actual_on date)
RETURNS TABLE(mapping_id uuid,account_id uuid,label text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $mapping$
 SELECT chosen.id,account.id,active_account.name
 FROM (SELECT m.id,m.account_id FROM crest.account_mapping_versions m
  WHERE m.business_id=requested_business AND m.purpose='fee' AND m.effective_from<=actual_on
  ORDER BY m.effective_from DESC LIMIT 1) chosen
 JOIN crest.accounts account ON (account.business_id,account.id)=(requested_business,chosen.account_id)
 JOIN LATERAL(SELECT v.active,v.name FROM crest.account_versions v
  WHERE (v.business_id,v.account_id)=(account.business_id,account.id)
  ORDER BY v.version DESC LIMIT 1) active_account ON active_account.active
 WHERE crest_private.fixed_finance_mapping_matches('fee',account);
$mapping$;
REVOKE ALL ON FUNCTION crest_private.refund_transfer_fee_mapping(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.refund_transfer_fee_mapping(uuid,date) TO crest_finance_account_owner;

ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(
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
      AND fund_lot_id IS NULL AND debit_cents>0 AND credit_cents=0)))
);

CREATE OR REPLACE FUNCTION crest_private.fictional_refund_transfer_receipt(a crest.refund_transfer_adjustments,
 e crest.financial_events,m crest.money_movements,v crest.money_channel_versions,l crest.customer_fund_lots)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',a.business_id,'refundTransferAdjustmentId',a.id,
  'operationId',a.operation_id,'eventId',e.id,'originalEventId',a.original_event_id,'priorEventId',a.prior_event_id,
  'originalTemplate',e.template,'obligationType',CASE e.template WHEN 'P08' THEN 'service' WHEN 'P09' THEN 'excess' ELSE 'tip_return_due' END,
  'kind',a.kind,'fundLotId',l.id,'fundingOriginId',l.origin_id,'customerId',l.customer_id,'fundsAccountId',l.account_id,'fundsMappingId',l.mapping_id,
  'moneyAccountId',a.account_id,'moneyChannelId',v.channel_id,'moneyChannelVersion',v.version::text,'moneyMovementId',m.id,
  'evidenceId',a.evidence_id,'actualOn',to_char(a.actual_on,'YYYY-MM-DD'),'cents',a.cents::text,
  'confirmation',a.confirmation,'reason',a.reason,'ranges',(
   SELECT jsonb_agg(jsonb_build_object('firstCent',r.first_cent::text,'lastCent',r.last_cent::text) ORDER BY r.first_cent)
   FROM crest.refund_transfer_adjustment_ranges r WHERE (r.business_id,r.adjustment_id)=(a.business_id,a.id)))
 || coalesce((SELECT jsonb_build_object('schemaVersion',2,'embeddedFee',jsonb_build_object(
  'cents',f.cents::text,'netCents',f.net_cents::text,'mappingId',f.mapping_id,'accountId',f.fee_account_id,
  'evidenceId',coalesce(f.component_evidence_id,a.evidence_id),'confirmation',f.confirmation))
  FROM crest.refund_transfer_embedded_fees f WHERE (f.business_id,f.adjustment_id)=(a.business_id,a.id)), '{}'::jsonb);
$receipt$;
RESET ROLE;
GRANT SELECT(result_schema_version) ON crest_private.operations TO crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_fictional_refund_transfer_adjustment(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; p crest.financial_events; a crest.refund_transfer_adjustments; l crest.customer_fund_lots;
 m crest.money_movements; v crest.money_channel_versions; proof crest.external_money_evidence; source record;
 amount bigint; net_amount bigint; journal uuid; receipt jsonb;
 fee crest.refund_transfer_embedded_fees; component crest.external_money_evidence;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE (business_id,id)=(requested_business,requested_event);
 SELECT * INTO STRICT a FROM crest.refund_transfer_adjustments WHERE (business_id,id)=(e.business_id,e.refund_transfer_adjustment_id);
 SELECT * INTO STRICT p FROM crest.financial_events WHERE (business_id,id)=(e.business_id,a.prior_event_id);
 SELECT * INTO STRICT source FROM crest_private.refund_transfer_source(e.business_id,p.id,a.kind);
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE (business_id,id)=(e.business_id,a.fund_lot_id);
 SELECT * INTO STRICT m FROM crest.money_movements WHERE (business_id,event_id)=(e.business_id,e.id);
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE (business_id,id)=(e.business_id,a.channel_version_id);
 SELECT * INTO STRICT proof FROM crest.external_money_evidence WHERE (business_id,id)=(e.business_id,a.evidence_id);
 amount:=CASE a.kind WHEN 'recredit' THEN a.cents ELSE -a.cents END;
 SELECT * INTO fee FROM crest.refund_transfer_embedded_fees WHERE (business_id,adjustment_id)=(a.business_id,a.id);
 net_amount:=coalesce(fee.net_cents,amount);
 IF fee.adjustment_id IS NOT NULL THEN
  IF a.kind<>'recredit' OR fee.net_cents::numeric+fee.cents<>a.cents
   OR NOT EXISTS(SELECT FROM crest.account_mapping_versions mapping
    JOIN crest.accounts account ON (account.business_id,account.id)=(mapping.business_id,mapping.account_id)
    WHERE (mapping.business_id,mapping.id,mapping.account_id)=(a.business_id,fee.mapping_id,fee.fee_account_id)
     AND mapping.purpose='fee' AND mapping.effective_from<=a.actual_on AND mapping.created_at<=a.created_at
     AND crest_private.fixed_finance_mapping_matches('fee',account)
     AND NOT EXISTS(SELECT FROM crest.account_mapping_versions next
      WHERE (next.business_id,next.purpose)=(mapping.business_id,mapping.purpose)
       AND next.effective_from>mapping.effective_from AND next.effective_from<=a.actual_on AND next.created_at<=a.created_at))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_FEE_SOURCE_REQUIRED';END IF;
  IF fee.component_evidence_id IS NOT NULL THEN
   SELECT * INTO STRICT component FROM crest.external_money_evidence
   WHERE (business_id,id)=(a.business_id,fee.component_evidence_id);
   IF component.id=a.evidence_id OR (component.external_account_id,component.provider_namespace,component.confirmed_on,component.signed_cents,component.currency)
     IS DISTINCT FROM (a.account_id,v.provider_namespace,a.actual_on,-fee.cents,'USD'::text)
    OR EXISTS(SELECT FROM crest.money_movements child_movement WHERE (child_movement.business_id,child_movement.evidence_id)=(a.business_id,component.id))
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED';END IF;
  END IF;
 END IF;
 IF e.template_version<>2 OR e.event_sequence<>1 OR e.effective_on<>a.actual_on OR e.effective_on<p.effective_on
  OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date OR e.posted_at<a.created_at
  OR (a.original_event_id,a.fund_lot_id,e.template) IS DISTINCT FROM (source.original_event_id,source.fund_lot_id,source.template)
  OR NOT EXISTS(SELECT FROM crest.refund_transfer_adjustment_ranges r WHERE (r.business_id,r.adjustment_id)=(a.business_id,a.id)
   HAVING count(*) BETWEEN 1 AND 180 AND sum(r.last_cent::numeric-r.first_cent+1)=a.cents
    AND bool_and(numrange(r.first_cent::numeric,r.last_cent::numeric+1,'[)') <@ any(source.available)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_RANGE_UNAVAILABLE';END IF;
 IF v.id IS DISTINCT FROM crest_private.direct_receipt_channel(e.business_id,v.channel_id,a.actual_on,e.time_zone)
  OR (v.account_id,m.account_id,m.evidence_id,m.signed_cents) IS DISTINCT FROM (a.account_id,a.account_id,a.evidence_id,net_amount)
  OR (proof.external_account_id,proof.provider_namespace,proof.confirmed_on,proof.signed_cents,proof.currency)
    IS DISTINCT FROM (a.account_id,v.provider_namespace,a.actual_on,net_amount,'USD'::text)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_EVIDENCE_REQUIRED';END IF;
 receipt:=crest_private.fictional_refund_transfer_receipt(a,e,m,v,l);
 IF NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
  JOIN crest.atomic_finance_groups prior ON (prior.business_id,prior.id)=(p.business_id,p.group_id)
  JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
  JOIN crest_private.audit_events audit ON (audit.business_id,audit.operation_id,audit.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  JOIN crest.accounting_periods period ON (period.business_id,period.id)=(e.business_id,e.period_id)
  WHERE (g.business_id,g.id,g.operation_id,g.created_by)=(e.business_id,e.group_id,a.operation_id,a.created_by)
   AND g.commit_sequence>prior.commit_sequence AND g.recovery_epoch=o.recovery_epoch
   AND o.command_type='finance.refund.adjust_transfer' AND o.state='committed' AND o.result=receipt
   AND o.result_schema_version=(receipt->>'schemaVersion')::integer
   AND audit.entity_kind='refund_transfer_adjustments' AND audit.entity_id=a.id AND audit.entity_version=1
   AND audit.action='adjust_refund_transfer' AND audit.reason=a.reason
   AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
   AND e.time_zone=period.time_zone AND e.effective_on BETWEEN period.starts_on AND period.through_on
   AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
    WHERE (h.business_id,h.period_id)=(period.business_id,period.id)),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_SOURCE_REQUIRED';END IF;
 SELECT id INTO journal FROM crest.journal_entries WHERE (business_id,event_id,entry_sequence)=(e.business_id,e.id,1);
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE (j.business_id,j.event_id)=(e.business_id,e.id))<>1
  OR (SELECT count(*) FROM crest.journal_lines j WHERE (j.business_id,j.entry_id)=(e.business_id,journal))<>(CASE WHEN fee.adjustment_id IS NULL THEN 2 ELSE 3 END)
  OR NOT EXISTS(SELECT FROM crest.journal_lines j WHERE (j.business_id,j.entry_id,j.refund_transfer_adjustment_id,j.purpose,
    j.account_id,j.money_movement_id,j.debit_cents,j.credit_cents)=(e.business_id,journal,a.id,'refund_transfer_money',
    a.account_id,m.id,greatest(net_amount,0),greatest(-net_amount,0)))
  OR NOT EXISTS(SELECT FROM crest.journal_lines j WHERE (j.business_id,j.entry_id,j.refund_transfer_adjustment_id,j.purpose,
    j.account_id,j.fund_lot_id,j.fixed_mapping_id,j.debit_cents,j.credit_cents)=(e.business_id,journal,a.id,'refund_transfer_funds',
    source.funds_account_id,l.id,source.funds_mapping_id,greatest(-amount,0),greatest(amount,0)))
  OR (fee.adjustment_id IS NOT NULL AND NOT EXISTS(SELECT FROM crest.journal_lines j
   WHERE (j.business_id,j.entry_id,j.refund_transfer_adjustment_id,j.purpose,j.account_id,j.fixed_mapping_id,j.debit_cents,j.credit_cents)
    =(e.business_id,journal,a.id,'refund_transfer_fee',fee.fee_account_id,fee.mapping_id,fee.cents,0)))
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE (x.business_id,x.event_id)=(e.business_id,e.id))
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE (x.business_id,x.event_id)=(e.business_id,e.id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_JOURNAL_REQUIRED';END IF;
END $verify$;
CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source_event uuid;
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'payments' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.id;
  WHEN 'external_money_evidence' THEN
   SELECT event_id INTO source_event FROM crest.money_movements WHERE business_id=NEW.business_id AND evidence_id=NEW.id;
   IF source_event IS NULL THEN
    SELECT e.id INTO source_event FROM crest.refund_transfer_embedded_fees f
    JOIN crest.financial_events e ON (e.business_id,e.refund_transfer_adjustment_id)=(f.business_id,f.adjustment_id)
    WHERE (f.business_id,f.component_evidence_id)=(NEW.business_id,NEW.id);
   ELSIF EXISTS(SELECT FROM crest.refund_transfer_embedded_fees f WHERE (f.business_id,f.component_evidence_id)=(NEW.business_id,NEW.id)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED';
   END IF;
  WHEN 'money_movements' THEN
   IF EXISTS(SELECT FROM crest.refund_transfer_embedded_fees f WHERE (f.business_id,f.component_evidence_id)=(NEW.business_id,NEW.evidence_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED';
   END IF;
   source_event:=NEW.event_id;
  WHEN 'funding_origins' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.payment_id;
  WHEN 'funding_partitions' THEN
   SELECT e.id INTO source_event FROM crest.funding_origins root JOIN crest.financial_events e
    ON (e.business_id,e.payment_id)=(root.business_id,root.payment_id)
   WHERE (root.business_id,root.id)=(NEW.business_id,NEW.origin_id);
  WHEN 'allocation_events' THEN
   SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND id=NEW.event_id AND template='P03';
  ELSE source_event:=NEW.event_id;
 END CASE;
 IF source_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_finance_event_posting(NEW.business_id,source_event);
 RETURN NULL;
END $verify$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.verify_refund_transfer_adjustment_source() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER refund_transfer_fee_complete AFTER INSERT ON crest.refund_transfer_embedded_fees
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_refund_transfer_adjustment_source();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_refund_transfer_adjustment_source() FROM crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;

-- Both the settlement and optional fee component use the same provider evidence key format.
CREATE FUNCTION crest_private.refund_transfer_external_identity(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $identity$
 SELECT coalesce(jsonb_typeof(value)='object' AND value?&ARRAY['namespace','id','rawReference']
  AND value-ARRAY['namespace','id','rawReference']='{}'::jsonb AND jsonb_typeof(value->'namespace')='string'
  AND jsonb_typeof(value->'id')='string' AND jsonb_typeof(value->'rawReference')='string'
  AND value->>'namespace'~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
  AND char_length(value->>'id') BETWEEN 1 AND 200 AND value->>'id'=btrim(value->>'id')
  AND value->>'id'!~'[[:cntrl:]]' AND char_length(value->>'rawReference') BETWEEN 1 AND 1000
  AND value->>'rawReference'=btrim(value->>'rawReference') AND value->>'rawReference'!~'[[:cntrl:]]',false);
$identity$;
REVOKE ALL ON FUNCTION crest_private.refund_transfer_external_identity(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.refund_transfer_external_identity(jsonb) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.record_fictional_refund_transfer_adjustment_with_fee(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_adjustment uuid,prior_event uuid,requested_customer uuid,
 adjustment_kind text,requested_channel uuid,expected_channel_version bigint,actual_date date,verified_cents bigint,
 confirmation text,review_reason text,external_identity jsonb,requested_ranges jsonb,requested_fee jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; claimed uuid; source record; prior crest.financial_events;
 a crest.refund_transfer_adjustments; e crest.financial_events; l crest.customer_fund_lots; v crest.money_channel_versions;
 m crest.money_movements; period record; group_id uuid; journal_id uuid; proof_id uuid; receipt jsonb;
 requested numrange[]; canon jsonb; total numeric; amount bigint; request_value jsonb;
 fee_cents bigint; net_amount bigint; fee_mapping uuid; fee_account uuid; fee_proof uuid;
 fee_identity jsonb; fee_confirmation text;
BEGIN
 IF requested_operation IS NULL OR requested_adjustment IS NULL OR prior_event IS NULL OR requested_customer IS NULL
  OR adjustment_kind IS NULL OR adjustment_kind NOT IN('recredit','retry') OR requested_channel IS NULL
  OR expected_channel_version IS NULL OR expected_channel_version<=0 OR actual_date IS NULL
  OR actual_date NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' OR verified_cents IS NULL OR verified_cents<=0
  OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000 OR confirmation<>btrim(confirmation) OR confirmation~'[[:cntrl:]]'
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]'
  OR jsonb_typeof(requested_ranges) IS DISTINCT FROM 'array' OR octet_length(requested_ranges::text)>65536
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_INPUT_REQUIRED';END IF;
 IF NOT crest_private.refund_transfer_external_identity(external_identity) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_EVIDENCE_REQUIRED';END IF;
 IF requested_fee IS NOT NULL THEN
  IF adjustment_kind<>'recredit' OR jsonb_typeof(requested_fee) IS DISTINCT FROM 'object'
   OR NOT requested_fee?&ARRAY['netCents','cents','mappingId','confirmation','externalIdentity']
   OR requested_fee-ARRAY['netCents','cents','mappingId','confirmation','externalIdentity']<>'{}'::jsonb
   OR jsonb_typeof(requested_fee->'netCents') IS DISTINCT FROM 'string'
   OR jsonb_typeof(requested_fee->'cents') IS DISTINCT FROM 'string'
   OR jsonb_typeof(requested_fee->'mappingId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(requested_fee->'confirmation') IS DISTINCT FROM 'string'
   OR requested_fee->>'netCents'!~'^[1-9][0-9]{0,18}$' OR requested_fee->>'cents'!~'^[1-9][0-9]{0,18}$'
   OR requested_fee->>'mappingId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR char_length(requested_fee->>'confirmation') NOT BETWEEN 1 AND 1000
   OR requested_fee->>'confirmation'<>btrim(requested_fee->>'confirmation') OR requested_fee->>'confirmation'~'[[:cntrl:]]'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_FEE_INPUT_REQUIRED';END IF;
  IF (requested_fee->>'netCents')::numeric+(requested_fee->>'cents')::numeric<>verified_cents THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_FEE_AMOUNT_REQUIRED';END IF;
  fee_cents:=(requested_fee->>'cents')::bigint;
  net_amount:=(requested_fee->>'netCents')::bigint;
  fee_mapping:=(requested_fee->>'mappingId')::uuid;
  fee_confirmation:=requested_fee->>'confirmation';
  IF requested_fee->'externalIdentity'<>'null'::jsonb THEN
   fee_identity:=requested_fee->'externalIdentity';
   IF NOT crest_private.refund_transfer_external_identity(fee_identity) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED';END IF;
   IF (fee_identity->>'namespace',fee_identity->>'id')=(external_identity->>'namespace',external_identity->>'id') THEN
    IF fee_identity<>external_identity THEN
     RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED';END IF;
    fee_identity:=NULL;
    requested_fee:=jsonb_set(requested_fee,'{externalIdentity}','null'::jsonb);
   END IF;
  END IF;
 END IF;
 IF jsonb_array_length(requested_ranges) NOT BETWEEN 1 AND 180
  OR EXISTS(SELECT FROM jsonb_array_elements(requested_ranges) x(value) WHERE jsonb_typeof(x.value)<>'object') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(requested_ranges) x(value)
  WHERE NOT x.value?&ARRAY['firstCent','lastCent'] OR x.value-ARRAY['firstCent','lastCent']<>'{}'::jsonb
  OR jsonb_typeof(x.value->'firstCent') IS DISTINCT FROM 'string' OR jsonb_typeof(x.value->'lastCent') IS DISTINCT FROM 'string'
  OR x.value->>'firstCent'!~'^[1-9][0-9]{0,18}$' OR x.value->>'lastCent'!~'^[1-9][0-9]{0,18}$')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(requested_ranges) x(value)
  WHERE (x.value->>'firstCent')::numeric>(x.value->>'lastCent')::numeric OR (x.value->>'lastCent')::numeric>9223372036854775807)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_INPUT_REQUIRED';END IF;
 SELECT array_agg(numrange(lo,hi+1,'[)') ORDER BY lo,hi),jsonb_agg(value ORDER BY lo,hi),sum(hi-lo+1)
 INTO requested,canon,total FROM (
  SELECT (x.value->>'firstCent')::numeric AS lo,(x.value->>'lastCent')::numeric AS hi,x.value
  FROM jsonb_array_elements(requested_ranges) x(value)
 ) ranges;
 IF total<>verified_cents THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_AMOUNT_REQUIRED';END IF;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 request_value:=jsonb_build_array('finance.refund.adjust_transfer',CASE WHEN requested_fee IS NULL THEN 1 ELSE 2 END,
  requested_business,expected_actor,expected_epoch,
  requested_adjustment,prior_event,requested_customer,adjustment_kind,requested_channel,expected_channel_version,actual_date,
  verified_cents::text,confirmation,review_reason,external_identity,canon);
 IF requested_fee IS NOT NULL THEN request_value:=request_value||jsonb_build_array(requested_fee);END IF;
 digest:=encode(sha256(convert_to(request_value::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.refund.adjust_transfer',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.refund.adjust_transfer' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO source FROM crest_private.refund_transfer_source(requested_business,prior_event,adjustment_kind) x
 WHERE x.customer_id=requested_customer;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_PRIOR_REQUIRED';END IF;
 SELECT * INTO STRICT prior FROM crest.financial_events WHERE (business_id,id)=(requested_business,prior_event);
 IF actual_date<prior.effective_on OR actual_date>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_DATE_REQUIRED';END IF;
 IF EXISTS(SELECT FROM unnest(requested) r WHERE NOT (r <@ any(source.available))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_RANGE_UNAVAILABLE';END IF;
 IF EXISTS(SELECT FROM crest.refund_transfer_adjustments q WHERE q.business_id=requested_business AND q.id=requested_adjustment) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='REFUND_TRANSFER_ALREADY_RECORDED';END IF;
 SELECT * INTO v FROM crest.money_channel_versions c WHERE c.business_id=requested_business
  AND c.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_date,auth->>'timezone');
 IF NOT FOUND OR v.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_VERIFIED_CHANNEL_REQUIRED';END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_date,auth->>'timezone');
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE (business_id,id)=(requested_business,source.fund_lot_id);
 amount:=CASE adjustment_kind WHEN 'recredit' THEN verified_cents ELSE -verified_cents END;
 net_amount:=coalesce(net_amount,amount);
 IF requested_fee IS NOT NULL THEN
  SELECT f.account_id INTO fee_account FROM crest_private.refund_transfer_fee_mapping(requested_business,actual_date) f
  WHERE f.mapping_id=fee_mapping;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_FEE_MAPPING_REQUIRED';END IF;
 END IF;
 IF EXISTS(SELECT FROM crest.external_money_evidence ev WHERE ev.business_id=requested_business
  AND ev.provider_namespace=v.provider_namespace AND ev.external_account_id=v.account_id
  AND ((ev.id_namespace,ev.external_id)=(external_identity->>'namespace',external_identity->>'id')
    OR (ev.id_namespace,ev.external_id)=(fee_identity->>'namespace',fee_identity->>'id')))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='REFUND_TRANSFER_EXTERNAL_ID_ALREADY_RECORDED';END IF;
 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,v.provider_namespace,v.account_id,external_identity->>'namespace',external_identity->>'id',
  external_identity->>'rawReference','exact_case_v1',actual_date,net_amount,'USD') RETURNING id INTO proof_id;
 -- A distinct provider-supplied component key is reserved inside the same envelope. It has no movement.
 IF fee_identity IS NOT NULL THEN
  INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
   normalization_rule,confirmed_on,signed_cents,currency)
  VALUES(requested_business,v.provider_namespace,v.account_id,fee_identity->>'namespace',fee_identity->>'id',
   fee_identity->>'rawReference','exact_case_v1',actual_date,-fee_cents,'USD') RETURNING id INTO fee_proof;
 END IF;
 INSERT INTO crest.refund_transfer_adjustments(id,business_id,kind,prior_event_id,original_event_id,fund_lot_id,channel_version_id,
  account_id,evidence_id,actual_on,cents,confirmation,reason,operation_id,created_by)
 VALUES(requested_adjustment,requested_business,adjustment_kind,prior_event,source.original_event_id,l.id,v.id,v.account_id,
  proof_id,actual_date,verified_cents,confirmation,review_reason,requested_operation,expected_actor) RETURNING * INTO a;
 IF requested_fee IS NOT NULL THEN
  INSERT INTO crest.refund_transfer_embedded_fees(business_id,adjustment_id,mapping_id,fee_account_id,
   net_cents,cents,confirmation,component_evidence_id)
  VALUES(a.business_id,a.id,fee_mapping,fee_account,net_amount,fee_cents,fee_confirmation,fee_proof);
 END IF;
 BEGIN
  INSERT INTO crest.refund_transfer_adjustment_ranges(business_id,adjustment_id,prior_event_id,first_cent,last_cent)
  SELECT a.business_id,a.id,a.prior_event_id,lower(r)::bigint,(upper(r)-1)::bigint FROM unnest(requested) r;
 EXCEPTION WHEN exclusion_violation THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_RANGE_UNAVAILABLE';
 END;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,refund_transfer_adjustment_id,period_id,period_generation,
  effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,a.id,period.period_id,period.generation,actual_date,auth->>'timezone',source.template,2) RETURNING * INTO e;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,e.id,a.account_id,a.evidence_id,net_amount) RETURNING * INTO m;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence)
 VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,refund_transfer_adjustment_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,a.id,a.account_id,m.id,'refund_transfer_money',greatest(net_amount,0),greatest(-net_amount,0));
 INSERT INTO crest.journal_lines(business_id,entry_id,refund_transfer_adjustment_id,account_id,fixed_mapping_id,fund_lot_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,a.id,l.account_id,l.mapping_id,l.id,'refund_transfer_funds',greatest(-amount,0),greatest(amount,0));
 IF requested_fee IS NOT NULL THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,refund_transfer_adjustment_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
  VALUES(a.business_id,journal_id,a.id,fee_account,fee_mapping,'refund_transfer_fee',fee_cents,0);
 END IF;
 receipt:=crest_private.fictional_refund_transfer_receipt(a,e,m,v,l);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'refund_transfer_adjustments',a.id,1,'adjust_refund_transfer',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=(receipt->>'schemaVersion')::integer,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.read_fictional_refund_transfer_fee_option(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,prior_event uuid,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE context jsonb; mapping jsonb;
BEGIN
 IF requested_customer IS NULL OR prior_event IS NULL OR actual_on IS NULL
  OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_FEE_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF actual_on>(statement_timestamp() AT TIME ZONE (context->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest_private.refund_transfer_source(requested_business,prior_event,'recredit') source
  JOIN crest.financial_events e ON (e.business_id,e.id)=(requested_business,prior_event)
  WHERE source.customer_id=requested_customer AND e.effective_on<=actual_on
   AND NOT isempty((SELECT range_agg(r) FROM unnest(source.available) r)
    - coalesce((SELECT range_agg(numrange(used.first_cent::numeric,used.last_cent::numeric+1,'[)'))
      FROM crest.refund_transfer_adjustment_ranges used
      WHERE (used.business_id,used.prior_event_id)=(requested_business,prior_event)),'{}'::nummultirange)))
 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT jsonb_build_object('mappingId',m.mapping_id,'accountId',m.account_id,'label',m.label) INTO mapping
 FROM crest_private.refund_transfer_fee_mapping(requested_business,actual_on) m;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'priorEventId',prior_event,'actualOn',to_char(actual_on,'YYYY-MM-DD'),'feeMapping',mapping);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_fictional_refund_transfer_adjustment_with_fee(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,text,uuid,bigint,date,bigint,text,text,jsonb,jsonb,jsonb) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_refund_transfer_fee_option(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_fictional_refund_transfer_adjustment_with_fee(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,text,uuid,bigint,date,bigint,text,text,jsonb,jsonb,jsonb),
 crest_commands.read_fictional_refund_transfer_fee_option(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_fictional_refund_transfer_adjustment_with_fee(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,text,uuid,bigint,date,bigint,text,text,jsonb,jsonb,jsonb),
 crest_commands.read_fictional_refund_transfer_fee_option(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) TO crest_finance_preview;

CREATE OR REPLACE FUNCTION crest_commands.record_fictional_refund_transfer_adjustment(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_adjustment uuid,prior_event uuid,requested_customer uuid,
 adjustment_kind text,requested_channel uuid,expected_channel_version bigint,actual_date date,verified_cents bigint,
 confirmation text,review_reason text,external_identity jsonb,requested_ranges jsonb
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
 SELECT crest_commands.record_fictional_refund_transfer_adjustment_with_fee(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NULL::jsonb);
$save$;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-refund-transfer-withheld-fee.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-refund-transfer-withheld-fee-report.sql
-- Read the registered balanced journal, including the typed embedded fee leg.
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_journal_v12(
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
  crest_private.fictional_journal_body_v10(requested_business,selected,requested_account,after_line,page_limit)||jsonb_build_object('schemaVersion',12) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_journal_v12(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_journal_v12(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-refund-transfer-withheld-fee-report.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-refund-transfer-withheld-fee-source.sql
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

RESET ROLE;
-- END REVIEWED planning/proposals/finance-refund-transfer-withheld-fee-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-refund-transfer-withheld-fee-export-access.sql
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-refund-transfer-withheld-fee-export-access.sql
