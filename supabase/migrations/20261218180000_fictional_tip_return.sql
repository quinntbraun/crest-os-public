-- Registered fictional P10. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-storage.sql
-- P10 storage under construction. The posting transaction owns source eligibility,
-- exact journal verification and the authoritative operation receipt.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.original_tip_return_components(
 original_inclusive bigint, original_net bigint, first_cent bigint, last_cent bigint
) RETURNS TABLE(net_cents bigint,tax_cents bigint)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $components$
 SELECT net,last_cent-first_cent+1-net FROM (
  SELECT (div(2*original_net::numeric*last_cent+original_inclusive,2*original_inclusive::numeric)
         -div(2*original_net::numeric*(first_cent-1)+original_inclusive,2*original_inclusive::numeric))::bigint AS net
  WHERE original_inclusive>0 AND original_net BETWEEN 0 AND original_inclusive
   AND first_cent>0 AND last_cent BETWEEN first_cent AND original_inclusive
 ) component;
$components$;
REVOKE ALL ON FUNCTION crest_private.original_tip_return_components(bigint,bigint,bigint,bigint) FROM PUBLIC;

CREATE TABLE crest.tip_returns (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 tip_realization_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 account_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 actual_on date NOT NULL CHECK(actual_on BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'),
 cents bigint NOT NULL CHECK(cents>0),
 net_cents bigint NOT NULL CHECK(net_cents>=0),
 tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000 AND confirmation=btrim(confirmation)
  AND confirmation!~'[[:cntrl:]]'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id,tip_realization_id),
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,evidence_id),
 FOREIGN KEY(business_id,tip_realization_id) REFERENCES crest.tip_realizations(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(net_cents::numeric+tax_cents=cents)
);

-- These offsets are relative to the original realized tip. P06 already consumed
-- the parent held-funds lot, so that lot is never charged again by this return.
CREATE TABLE crest.tip_realization_range_consumptions (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 tip_realization_id uuid NOT NULL,
 tip_return_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 PRIMARY KEY(business_id,tip_realization_id,first_cent),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,tip_return_id,tip_realization_id) REFERENCES crest.tip_returns(business_id,id,tip_realization_id),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,tip_realization_id extensions.gist_uuid_ops WITH =,
  numrange(first_cent::numeric,last_cent::numeric,'[]') WITH &&)
);
ALTER TABLE crest.tip_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_returns FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_realization_range_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_realization_range_consumptions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON crest.tip_returns,crest.tip_realization_range_consumptions FROM PUBLIC;
CREATE TRIGGER tip_return_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tip_returns
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER tip_consumption_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tip_realization_range_consumptions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-tip-return-storage.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-posting.sql
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.financial_events ADD COLUMN tip_return_id uuid;
ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(((((
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
  fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,zero_effect_reason)=0));
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,tip_return_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,tip_return_id) REFERENCES crest.tip_returns(business_id,id);
ALTER TABLE crest.journal_lines ADD COLUMN tip_return_id uuid;
ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(((((
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
 )));
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,tip_return_id,purpose);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,tip_return_id) REFERENCES crest.tip_returns(business_id,id);

GRANT SELECT ON crest.tip_returns,crest.tip_realization_range_consumptions TO crest_finance_integrity_owner;
GRANT SELECT,INSERT ON crest.tip_returns,crest.tip_realization_range_consumptions TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.original_tip_return_components(bigint,bigint,bigint,bigint)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
CREATE POLICY tip_return_integrity ON crest.tip_returns FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY tip_return_range_integrity ON crest.tip_realization_range_consumptions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY tip_return_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.refund.record_tip');
CREATE POLICY tip_return_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='tip_returns');
CREATE POLICY tip_return_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='finance.refund.record_tip');
CREATE POLICY tip_return_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id
  AND command_type='finance.refund.record_tip' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY tip_return_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='finance.refund.record_tip' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='finance.refund.record_tip' AND state='committed');
CREATE POLICY tip_return_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=actor_id
  AND entity_kind='tip_returns' AND action='record_return' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL);
DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['tip_returns','tip_realization_range_consumptions'] LOOP
  EXECUTE format('CREATE POLICY tip_return_read ON crest.%I FOR SELECT TO crest_finance_account_owner
    USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source);
 END LOOP;
 FOREACH source IN ARRAY ARRAY['tip_returns','tip_realization_range_consumptions','external_money_evidence','money_movements',
  'financial_events','atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY tip_return_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.command_type=''finance.refund.record_tip'' AND o.state=''pending''))',source);
 END LOOP;
END $writer$;

CREATE FUNCTION crest_private.fictional_tip_return_receipt(s crest.tip_returns,t crest.tip_realizations,
 original crest.financial_events,l crest.customer_fund_lots,e crest.financial_events,m crest.money_movements,v crest.money_channel_versions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',s.business_id,'tipReturnId',s.id,'operationId',s.operation_id,
  'eventId',e.id,'tipRealizationId',t.id,'originalTipEventId',original.id,'fundLotId',l.id,'fundingOriginId',l.origin_id,
  'customerId',l.customer_id,'revenueAccountId',t.revenue_account_id,'revenueMappingId',t.revenue_mapping_id,
  'taxAccountId',t.tax_account_id,'taxMappingId',t.tax_mapping_id,'taxProfileId',t.tax_profile_id,
  'moneyAccountId',s.account_id,'moneyMovementId',m.id,'moneyChannelId',v.channel_id,'moneyChannelVersion',v.version::text,
  'evidenceId',s.evidence_id,'actualOn',to_char(s.actual_on,'YYYY-MM-DD'),'cents',s.cents::text,'netCents',s.net_cents::text,
  'taxCents',s.tax_cents::text,'confirmation',s.confirmation,'reason',s.reason,'ranges',(
   SELECT jsonb_agg(jsonb_build_object('firstCent',x.first_cent::text,'lastCent',x.last_cent::text) ORDER BY x.first_cent)
   FROM crest.tip_realization_range_consumptions x WHERE x.business_id=s.business_id AND x.tip_return_id=s.id));
$receipt$;
REVOKE ALL ON FUNCTION crest_private.fictional_tip_return_receipt(crest.tip_returns,crest.tip_realizations,crest.financial_events,
 crest.customer_fund_lots,crest.financial_events,crest.money_movements,crest.money_channel_versions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_tip_return_receipt(crest.tip_returns,crest.tip_realizations,crest.financial_events,
 crest.customer_fund_lots,crest.financial_events,crest.money_movements,crest.money_channel_versions)
 TO crest_finance_integrity_owner,crest_finance_account_owner;

CREATE FUNCTION crest_private.verify_fictional_tip_return(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; s crest.tip_returns; t crest.tip_realizations; l crest.customer_fund_lots;
 original crest.financial_events; v crest.money_channel_versions; m crest.money_movements; evidence crest.external_money_evidence;
 journal uuid; receipt jsonb; amounts record;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT s FROM crest.tip_returns WHERE business_id=requested_business AND id=e.tip_return_id;
 SELECT * INTO STRICT t FROM crest.tip_realizations WHERE business_id=requested_business AND id=s.tip_realization_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id;
 SELECT * INTO STRICT original FROM crest.financial_events WHERE business_id=requested_business AND tip_realization_id=t.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT * INTO STRICT m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT evidence FROM crest.external_money_evidence WHERE business_id=requested_business AND id=s.evidence_id;
 SELECT sum(x.last_cent-x.first_cent+1) AS cents,sum(component.net_cents) AS net,sum(component.tax_cents) AS tax,
  count(*) AS ranges,count(component.net_cents) AS valid_ranges INTO amounts
 FROM crest.tip_realization_range_consumptions x
 LEFT JOIN LATERAL crest_private.original_tip_return_components(t.inclusive_cents,t.net_cents,x.first_cent,x.last_cent) component ON true
 WHERE x.business_id=requested_business AND x.tip_return_id=s.id;
 receipt:=crest_private.fictional_tip_return_receipt(s,t,original,l,e,m,v);
 IF e.template<>'P10' OR e.event_sequence<>1 OR original.template<>'P06' OR original.event_sequence<>1
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

CREATE FUNCTION crest_private.verify_fictional_tip_return_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid;
BEGIN
 SELECT e.id INTO event_id FROM crest.financial_events e WHERE e.business_id=NEW.business_id
  AND e.tip_return_id=(CASE TG_TABLE_NAME WHEN 'tip_returns' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'tip_return_id' END)::uuid;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_fictional_tip_return(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;
RESET ROLE;

ALTER FUNCTION crest_private.verify_fictional_tip_return(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_fictional_tip_return_row() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_fictional_tip_return(uuid,uuid),crest_private.verify_fictional_tip_return_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_fictional_tip_return_row() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER tip_return_complete AFTER INSERT ON crest.tip_returns
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_tip_return_row();
CREATE CONSTRAINT TRIGGER tip_return_range_complete AFTER INSERT ON crest.tip_realization_range_consumptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_tip_return_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_fictional_tip_return_row() FROM crest_schema_owner;

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
  WHEN 'P12' THEN PERFORM crest_private.verify_same_day_expense(saved.business_id,saved.id);
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-tip-return-posting.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-command.sql
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_fictional_tip_return(
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
 SELECT * INTO original FROM crest.financial_events WHERE business_id=requested_business AND tip_realization_id=t.id AND template='P06';
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
 FROM bounded x CROSS JOIN LATERAL crest_private.original_tip_return_components(t.inclusive_cents,t.net_cents,x.first_cent,x.last_cent) c;
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
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,text,text,jsonb,bigint) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,text,text,jsonb,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,text,text,jsonb,bigint) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY tip_return_original_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='tip_returns' AND action='record_return'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.refund.record_tip' AND o.state='committed'));

CREATE FUNCTION crest_commands.lookup_fictional_tip_return(
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
 SELECT * INTO STRICT original FROM crest.financial_events WHERE business_id=requested_business AND tip_realization_id=s.tip_realization_id;
 SELECT * INTO STRICT t FROM crest.tip_realizations WHERE business_id=requested_business AND id=s.tip_realization_id;
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
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-tip-return-command.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-retirement.sql
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY tip_return_retirement_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_tip');
CREATE POLICY tip_return_retirement_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_tip' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY tip_return_retirement_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_tip' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_tip' AND state='committed');
CREATE POLICY tip_return_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.refund.retire_tip' AND o.state='committed'));
CREATE POLICY tip_return_retirement_audit_insert ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.refund.retire_tip' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_tip_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_return uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_RETURN_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_tip_return($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'tipReturnId',original_return,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.refund.retire_tip',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_tip_return($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.retire_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-tip-return-retirement.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-options.sql
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_tip_return_options(
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
  SELECT tip.id,event.id AS event_id,event.effective_on,tip.inclusive_cents,remaining.cents AS remaining
  FROM crest.tip_realizations tip
  JOIN crest.customer_fund_lots lot ON lot.business_id=tip.business_id AND lot.id=tip.fund_lot_id
  JOIN crest.financial_events event ON event.business_id=tip.business_id AND event.tip_realization_id=tip.id AND event.template='P06'
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
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_tip_return_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_tip_return_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_tip_return_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-tip-return-options.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-report.sql
-- Held P10 report coverage, retaining the older trial balance and journal contracts.
-- Aging and held-funds response shapes are unchanged. Their underlying controls include P10.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.fictional_posted_report_context_v8(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND e.template NOT IN('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P12')) THEN
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
 IF EXISTS(
  WITH lots AS (
   SELECT l.id,l.account_id,l.original_cents::numeric-coalesce((
    SELECT sum(a.last_cent::numeric-a.first_cent+1) FROM crest.fund_lot_range_consumptions a
    JOIN crest.financial_events applied ON applied.business_id=a.business_id
     AND ((a.fund_application_id IS NOT NULL AND applied.fund_application_id=a.fund_application_id)
      OR (a.tip_realization_id IS NOT NULL AND applied.tip_realization_id=a.tip_realization_id)
      OR (a.service_refund_id IS NOT NULL AND applied.service_refund_id=a.service_refund_id)
      OR (a.excess_return_id IS NOT NULL AND applied.excess_return_id=a.excess_return_id))
    WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id AND applied.effective_on<=through_on
   ),0) AS available FROM crest.customer_fund_lots l
   JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id)
   WHERE l.business_id=requested_business AND e.effective_on<=through_on
  ), journal AS (
   SELECT l.fund_lot_id,l.account_id,sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND e.effective_on<=through_on AND l.fund_lot_id IS NOT NULL
   GROUP BY l.fund_lot_id,l.account_id
  )
  SELECT FROM lots a FULL JOIN journal j ON j.fund_lot_id=a.id AND j.account_id=a.account_id
  WHERE a.id IS NULL OR j.fund_lot_id IS NULL OR a.available<0 OR a.available IS DISTINCT FROM j.cents
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
 RETURN jsonb_build_object('schemaVersion',8,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P12')),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true,'taxPayableTie',true));
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_posted_report_context_v8(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_posted_report_context_v8(uuid,date,text) TO crest_finance_account_owner;

CREATE FUNCTION crest_private.fictional_journal_body_v8(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE anchor record; body jsonb;
BEGIN
 IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_PAGE_REQUIRED';
 END IF;
 IF requested_account IS NOT NULL AND NOT EXISTS(
  SELECT FROM crest.accounts a WHERE a.business_id=requested_business AND a.id=requested_account) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_ACCOUNT_REQUIRED';
 END IF;
 SELECT e.effective_on,g.commit_sequence,e.event_sequence,j.entry_sequence,l.id INTO anchor
 FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
 JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
 JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
 WHERE l.business_id=requested_business AND l.id=after_line AND e.effective_on<=through_on
  AND (requested_account IS NULL OR l.account_id=requested_account);
 IF after_line IS NOT NULL AND NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_PAGE_REQUIRED';
 END IF;
 WITH eligible AS (
  SELECT l.id,l.account_id,l.debit_cents,l.credit_cents,l.purpose,j.id AS entry_id,j.entry_sequence,e.id AS event_id,
   e.effective_on,e.event_sequence,e.template,e.invoice_id,e.payment_id,e.posted_expense_id,e.unapplication_id,e.fund_application_id,e.tip_realization_id,e.invoice_credit_id,e.service_refund_id,e.excess_return_id,e.tip_return_id,l.fund_lot_id,g.commit_sequence,g.operation_id,
   sum(l.debit_cents::numeric-l.credit_cents::numeric) OVER(PARTITION BY l.account_id ORDER BY
    e.effective_on,g.commit_sequence,e.event_sequence,j.entry_sequence,l.id ROWS UNBOUNDED PRECEDING) AS running
  FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
  JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
  JOIN crest.atomic_finance_groups g ON g.business_id=e.business_id AND g.id=e.group_id
  WHERE l.business_id=requested_business AND e.effective_on<=through_on
   AND (requested_account IS NULL OR l.account_id=requested_account)
 ), candidates AS MATERIALIZED (
  SELECT r.*,a.code,v.name FROM eligible r JOIN crest.accounts a ON a.business_id=requested_business AND a.id=r.account_id
  JOIN LATERAL(SELECT av.name FROM crest.account_versions av WHERE av.business_id=a.business_id AND av.account_id=a.id
   ORDER BY av.version DESC LIMIT 1) v ON true
  WHERE after_line IS NULL OR (r.effective_on,r.commit_sequence,r.event_sequence,r.entry_sequence,r.id)>
   (anchor.effective_on,anchor.commit_sequence,anchor.event_sequence,anchor.entry_sequence,anchor.id)
  ORDER BY r.effective_on,r.commit_sequence,r.event_sequence,r.entry_sequence,r.id LIMIT page_limit+1
 ), page AS MATERIALIZED (
  SELECT * FROM candidates ORDER BY effective_on,commit_sequence,event_sequence,entry_sequence,id LIMIT page_limit
 )
 SELECT jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('lineId',p.id,'eventId',p.event_id,'entryId',p.entry_id,
  'effectiveOn',to_char(p.effective_on,'YYYY-MM-DD'),'commitSequence',p.commit_sequence::text,'eventSequence',p.event_sequence::text,
  'entrySequence',p.entry_sequence::text,'template',p.template,'purpose',p.purpose,'accountId',p.account_id,'code',p.code,'name',p.name,
  'debitCents',p.debit_cents::text,'creditCents',p.credit_cents::text,'runningBalanceCents',p.running::text,
  'invoiceId',p.invoice_id,'paymentId',p.payment_id,'postedExpenseId',p.posted_expense_id,'unapplicationId',p.unapplication_id,'fundApplicationId',p.fund_application_id,'tipRealizationId',p.tip_realization_id,'invoiceCreditId',p.invoice_credit_id,'serviceRefundId',p.service_refund_id,'excessReturnId',p.excess_return_id,'tipReturnId',p.tip_return_id,'fundLotId',p.fund_lot_id,'operationId',p.operation_id)
  ORDER BY p.effective_on,p.commit_sequence,p.event_sequence,p.entry_sequence,p.id),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_limit FROM candidates),
  'nextAfterLineId',CASE WHEN (SELECT count(*)>page_limit FROM candidates) THEN
   (SELECT id FROM page ORDER BY effective_on DESC,commit_sequence DESC,event_sequence DESC,entry_sequence DESC,id DESC LIMIT 1) END)
 INTO body FROM page p;
 RETURN body;
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_journal_body_v8(uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_journal_body_v8(uuid,date,uuid,uuid,integer) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.read_fictional_trial_balance_v8(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context_v8(requested_business,selected,zone)||
  crest_private.fictional_trial_balance_body(requested_business,selected) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_journal_v8(
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
 SELECT crest_private.fictional_posted_report_context_v8(requested_business,selected,zone)||
  crest_private.fictional_journal_body_v8(requested_business,selected,requested_account,after_line,page_limit) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_trial_balance_v8(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_journal_v8(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_trial_balance_v8(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date),crest_commands.read_fictional_journal_v8(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_trial_balance_v8(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date),crest_commands.read_fictional_journal_v8(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
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
  SELECT crest_private.fictional_posted_report_context_v8(requested_business,selected,zone) AS context
 ), ledger AS MATERIALIZED (
  SELECT j.fund_lot_id,sum(j.credit_cents::numeric-j.debit_cents::numeric) AS cents
  FROM crest.journal_lines j
  JOIN crest.accounts a ON (a.business_id,a.id)=(j.business_id,j.account_id)
  JOIN crest.journal_entries entry ON (entry.business_id,entry.id)=(j.business_id,j.entry_id)
  JOIN crest.financial_events e ON (e.business_id,e.id)=(entry.business_id,entry.event_id)
  WHERE j.business_id=requested_business AND a.code='2000' AND e.effective_on<=selected
  GROUP BY j.fund_lot_id
 ), lots AS MATERIALIZED (
  SELECT l.id,l.origin_id,l.customer_id,c.display_name,e.effective_on,d.cents
  FROM ledger d
  JOIN crest.customer_fund_lots l ON (l.business_id,l.id)=(requested_business,d.fund_lot_id)
  JOIN crest.customers c ON (c.business_id,c.id)=(l.business_id,l.customer_id)
  JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id)
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

CREATE OR REPLACE FUNCTION crest_commands.read_fictional_receivable_aging(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $aging$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 -- Validate all posted controls and derive balances in the same SQL snapshot.
 WITH verified AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context_v8(requested_business,selected,zone) AS context
 ), outstanding AS MATERIALIZED (
  SELECT r.id, i.id AS invoice_id, i.invoice_number, i.issued_on, r.due_on,
   r.customer_id,i.customer_snapshot->>'displayName' AS customer_name,
   r.original_cents::numeric+coalesce(d.change_cents,0) AS cents,
   greatest(selected-r.due_on,0) AS overdue
  FROM crest.receivable_items r
  JOIN crest.invoices i ON (i.business_id,i.id,i.customer_id)=(r.business_id,r.invoice_id,r.customer_id)
  JOIN crest.financial_events issue ON (issue.business_id,issue.invoice_id)=(i.business_id,i.id)
  LEFT JOIN LATERAL (
   SELECT sum(signed_cents) AS change_cents FROM crest_private.receivable_posted_deltas(r.business_id,r.id)
   WHERE effective_on<=selected
  ) d ON true
  WHERE r.business_id=requested_business AND issue.effective_on<=selected
 ), open_items AS MATERIALIZED (
  SELECT * FROM outstanding WHERE cents>0
 ), first_page AS (
  SELECT * FROM open_items ORDER BY due_on,id LIMIT 100
 ), totals AS (
  SELECT count(*)::text AS count,coalesce(sum(cents),0)::text AS total,
   coalesce(sum(cents) FILTER(WHERE overdue=0),0)::text AS current_amount,
   coalesce(sum(cents) FILTER(WHERE overdue BETWEEN 1 AND 30),0)::text AS days_1_30,
   coalesce(sum(cents) FILTER(WHERE overdue BETWEEN 31 AND 60),0)::text AS days_31_60,
   coalesce(sum(cents) FILTER(WHERE overdue BETWEEN 61 AND 90),0)::text AS days_61_90,
   coalesce(sum(cents) FILTER(WHERE overdue>90),0)::text AS days_91_plus
  FROM open_items
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'throughOn',v.context->>'throughOn',
   'observedAt',v.context->>'observedAt','timeZone',zone,'currency','USD',
   'scope','posted-invoices','itemCount',t.count,'totalCents',t.total,
   'buckets',jsonb_build_object('current',t.current_amount,'days1To30',t.days_1_30,'days31To60',t.days_31_60,
    'days61To90',t.days_61_90,'days91Plus',t.days_91_plus),
   'rows',coalesce((
    SELECT jsonb_agg(jsonb_build_object('receivableId',p.id,'invoiceId',p.invoice_id,'invoiceNumber',p.invoice_number,
     'customerId',p.customer_id,'customerName',p.customer_name,'issuedOn',to_char(p.issued_on,'YYYY-MM-DD'),
     'dueOn',to_char(p.due_on,'YYYY-MM-DD'),'outstandingCents',p.cents::text,'daysOverdue',p.overdue)
     ORDER BY p.due_on,p.id) FROM first_page p
   ),'[]'::jsonb))
 INTO result FROM verified v CROSS JOIN totals t;
 RETURN result;
END $aging$;

RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-tip-return-report.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-tip-return-source.sql
-- Held P10 source export. Older profiles retain their exact column projections.
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
 IF requested_group='customer_fund_lots' THEN expected_fields:=expected_fields||ARRAY['receipt_event_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
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
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

-- Keep the previous columns in the older export projections.
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
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HELD_TIP_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

RESET ROLE;

CREATE ROLE crest_tip_return_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_tip_return_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_tip_return_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid) TO crest_tip_return_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.tip_return_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('tip_returns',ARRAY['id','business_id','tip_realization_id','channel_version_id','account_id','evidence_id','actual_on','cents',
  'net_cents','tax_cents','confirmation','reason','operation_id','created_by','created_at']),
 ('tip_realization_range_consumptions',ARRAY['id','business_id','tip_realization_id','tip_return_id','first_cent','last_cent']),
 ('financial_events',ARRAY['id','business_id','group_id','event_sequence','invoice_id','period_id','period_generation',
  'reopened_generation','effective_on','time_zone','template','template_version','zero_effect_reason','posted_at',
  'payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id']),
 ('atomic_finance_groups',ARRAY['id','business_id','commit_sequence','recovery_epoch','created_by','operation_id','created_at']),
 ('journal_entries',ARRAY['id','business_id','event_id','entry_sequence']),
 ('journal_lines',ARRAY['id','business_id','entry_id','invoice_item_id','receivable_id','account_id','fixed_mapping_id',
  'tax_payable_movement_id','purpose','debit_cents','credit_cents','money_movement_id','allocation_event_id','unapplication_id',
  'fund_lot_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id','excess_return_id','tip_return_id']),
 ('money_movements',ARRAY['id','business_id','event_id','account_id','evidence_id','signed_cents']),
 ('external_money_evidence',ARRAY['id','business_id','provider_namespace','external_account_id','id_namespace','external_id',
  'raw_reference','normalization_rule','confirmed_on','signed_cents','currency']);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.tip_return_source_dictionary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.tip_return_source_dictionary() TO crest_tip_return_export_owner;

DO $grants$
DECLARE source record; relation oid; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.tip_return_source_dictionary() LOOP
  SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='crest' AND c.relname=source.group_name AND c.relkind='r'
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
  IF relation IS NULL OR source.fields IS DISTINCT FROM (SELECT array_agg(attname::text ORDER BY attnum)
   FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped)
   OR has_any_column_privilege('crest_export',relation,'SELECT,INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='TIP_RETURN_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
  SELECT string_agg(format('%I',name),',') INTO columns FROM unnest(source.fields) AS name;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_tip_return_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;

CREATE POLICY tip_return_source_export ON crest.tip_returns FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY tip_return_source_export ON crest.tip_realization_range_consumptions FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY tip_return_source_export ON crest.financial_events FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND template='P10');
CREATE POLICY tip_return_source_export ON crest.atomic_finance_groups FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=atomic_finance_groups.business_id AND e.group_id=atomic_finance_groups.id));
CREATE POLICY tip_return_source_export ON crest.journal_entries FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=journal_entries.business_id AND e.id=journal_entries.event_id));
CREATE POLICY tip_return_source_export ON crest.journal_lines FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.journal_entries j WHERE j.business_id=journal_lines.business_id AND j.id=journal_lines.entry_id));
CREATE POLICY tip_return_source_export ON crest.money_movements FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=money_movements.business_id AND e.id=money_movements.event_id));
CREATE POLICY tip_return_source_export ON crest.external_money_evidence FOR SELECT TO crest_tip_return_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.money_movements m WHERE m.business_id=external_money_evidence.business_id AND m.evidence_id=external_money_evidence.id));

CREATE FUNCTION crest_commands.tip_return_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source record; history jsonb; rows jsonb:='{}'::jsonb; items jsonb; projection text; row_count integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='TIP_RETURN_SOURCE_SNAPSHOT_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.tip_return_source_dictionary() LOOP
  SELECT string_agg(format('%L,%s',name,
   CASE WHEN name IN('created_at','posted_at') THEN
    format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
  INTO projection FROM unnest(source.fields) WITH ORDINALITY AS f(name,position);
  EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY id),''[]''::jsonb) FROM (
   SELECT t.id,jsonb_build_object(%s) AS value FROM crest.%I t WHERE t.business_id=$1 ORDER BY t.id LIMIT 1001
   ) scoped',projection,source.group_name) INTO items USING requested_business;
  row_count:=row_count+jsonb_array_length(items);
  IF row_count>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='TIP_RETURN_SOURCE_LIMIT';END IF;
  rows:=rows||jsonb_build_object(source.group_name,items);
 END LOOP;
 IF octet_length(rows::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='TIP_RETURN_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'historySnapshotToken',history->>'snapshotToken','rows',rows);
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_tip_return_export_owner;
ALTER FUNCTION crest_commands.tip_return_source_snapshot(uuid) OWNER TO crest_tip_return_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_tip_return_export_owner;
REVOKE ALL ON FUNCTION crest_commands.tip_return_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.tip_return_source_snapshot(uuid) TO crest_export;

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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-tip-return-source.sql
