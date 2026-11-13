-- Held P06 customer-confirmed tip, consuming one exact existing P05 fund range.
-- Apply after registered schema 82. This command records a fictional
-- reclassification only. Tip exemptions require their own applicable evidence.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.tip_realizations (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 fund_lot_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 inclusive_cents bigint GENERATED ALWAYS AS (last_cent-first_cent+1) STORED,
 net_cents bigint NOT NULL CHECK(net_cents>=0),
 tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 jurisdiction text NOT NULL,
 tax_profile_id uuid NOT NULL,
 revenue_mapping_id uuid NOT NULL,
 revenue_account_id uuid NOT NULL,
 tax_mapping_id uuid,
 tax_account_id uuid,
 customer_intent_evidence text NOT NULL CHECK(char_length(customer_intent_evidence)>=1 AND char_length(customer_intent_evidence)<=1000
  AND customer_intent_evidence=btrim(customer_intent_evidence) AND customer_intent_evidence!~'[[:cntrl:]]'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,fund_lot_id) REFERENCES crest.customer_fund_lots(business_id,id),
 FOREIGN KEY(business_id,tax_profile_id) REFERENCES crest.tax_profiles(business_id,id),
 FOREIGN KEY(business_id,revenue_mapping_id) REFERENCES crest.account_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,revenue_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,tax_mapping_id) REFERENCES crest.tax_payable_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,tax_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(net_cents::numeric+tax_cents=inclusive_cents),
 CHECK((tax_mapping_id IS NULL)=(tax_account_id IS NULL)),
 CHECK(tax_cents=0 OR tax_mapping_id IS NOT NULL)
);
-- One exclusion domain for all currently supported uses of a held lot. P04
-- data are backfilled without updating original applications, events or journals.
CREATE TABLE crest.fund_lot_range_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 fund_lot_id uuid NOT NULL,
 first_cent bigint NOT NULL CHECK(first_cent>0),
 last_cent bigint NOT NULL CHECK(last_cent>=first_cent),
 fund_application_id uuid,
 tip_realization_id uuid,
 UNIQUE(business_id,id),
 UNIQUE(business_id,fund_application_id),
 UNIQUE(business_id,tip_realization_id),
 FOREIGN KEY(business_id,fund_lot_id) REFERENCES crest.customer_fund_lots(business_id,id),
 FOREIGN KEY(business_id,fund_application_id) REFERENCES crest.customer_fund_applications(business_id,id),
 FOREIGN KEY(business_id,tip_realization_id) REFERENCES crest.tip_realizations(business_id,id),
 CHECK(num_nonnulls(fund_application_id,tip_realization_id)=1),
 EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,fund_lot_id extensions.gist_uuid_ops WITH =,
  numrange(first_cent::numeric,last_cent::numeric,'[]') WITH &&)
);
RESET ROLE;
INSERT INTO crest.fund_lot_range_consumptions(business_id,fund_lot_id,first_cent,last_cent,fund_application_id)
 SELECT business_id,fund_lot_id,first_cent,last_cent,id FROM crest.customer_fund_applications;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.tip_realizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tip_realizations FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.fund_lot_range_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.fund_lot_range_consumptions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.tip_realizations,crest.fund_lot_range_consumptions TO crest_finance_integrity_owner;
GRANT SELECT ON crest.tip_realizations,crest.fund_lot_range_consumptions TO crest_finance_account_owner;
GRANT INSERT ON crest.tip_realizations TO crest_finance_account_owner;
GRANT INSERT ON crest.fund_lot_range_consumptions TO crest_finance_integrity_owner;
CREATE POLICY tip_realization_integrity ON crest.tip_realizations FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY tip_realization_read ON crest.tip_realizations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY fund_range_integrity ON crest.fund_lot_range_consumptions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY fund_range_read ON crest.fund_lot_range_consumptions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY fund_range_append ON crest.fund_lot_range_consumptions FOR INSERT TO crest_finance_integrity_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE TRIGGER tip_realization_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tip_realizations
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER fund_range_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.fund_lot_range_consumptions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE FUNCTION crest_private.retain_fund_range_consumption() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retain$
DECLARE application uuid; tip uuid;
BEGIN
 IF TG_TABLE_NAME='customer_fund_applications' THEN
  application:=NEW.id;
 ELSE
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
RESET ROLE;
ALTER FUNCTION crest_private.retain_fund_range_consumption() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.retain_fund_range_consumption() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.retain_fund_range_consumption() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER fund_application_claim_range AFTER INSERT ON crest.customer_fund_applications
 FOR EACH ROW EXECUTE FUNCTION crest_private.retain_fund_range_consumption();
CREATE TRIGGER tip_realization_claim_range AFTER INSERT ON crest.tip_realizations
 FOR EACH ROW EXECUTE FUNCTION crest_private.retain_fund_range_consumption();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.retain_fund_range_consumption() FROM crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.financial_events ADD COLUMN tip_realization_id uuid;
ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(((((
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
  AND payment_id IS NULL AND posted_expense_id IS NULL AND unapplication_id IS NULL AND zero_effect_reason IS NULL));
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,tip_realization_id);
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,tip_realization_id) REFERENCES crest.tip_realizations(business_id,id);
ALTER TABLE crest.journal_lines ADD COLUMN tip_realization_id uuid;
ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(((((
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
  AND money_movement_id IS NULL AND allocation_event_id IS NULL AND unapplication_id IS NULL AND fund_application_id IS NULL));
ALTER TABLE crest.journal_lines ADD UNIQUE(business_id,tip_realization_id,purpose);
ALTER TABLE crest.journal_lines ADD FOREIGN KEY(business_id,tip_realization_id) REFERENCES crest.tip_realizations(business_id,id);

CREATE POLICY tip_realization_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.tip.realize');
CREATE POLICY tip_realization_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='tip_realizations');
CREATE POLICY tip_realization_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tip.realize');
CREATE POLICY tip_realization_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tip.realize' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY tip_realization_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tip.realize' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tip.realize' AND state='committed');
CREATE POLICY tip_realization_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='tip_realizations' AND action='realize' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL);
DO $writer$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['tip_realizations','financial_events','atomic_finance_groups','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY tip_realization_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.tip.realize'' AND o.state=''pending''))',source);
 END LOOP;
END $writer$;

CREATE FUNCTION crest_private.fictional_tip_posting_basis(l crest.customer_fund_lots,scope_jurisdiction text,on_date date)
RETURNS TABLE(profile_id uuid,treatment text,rate numeric,revenue_mapping_id uuid,revenue_account_id uuid,tax_mapping_id uuid,tax_account_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $basis$
 SELECT p.id,p.treatment,p.rate,m.id,m.account_id,(tax.value->>'mappingId')::uuid,(tax.value->>'accountId')::uuid
 FROM (SELECT * FROM crest.tax_profiles p WHERE p.business_id=l.business_id AND p.jurisdiction=scope_jurisdiction
  AND p.applicability='tip' AND p.service_id IS NULL AND p.effective_from<=on_date ORDER BY p.effective_from DESC LIMIT 1) p
 JOIN LATERAL (SELECT * FROM crest.account_mapping_versions v WHERE v.business_id=l.business_id AND v.purpose='tips_revenue'
  AND v.effective_from<=on_date ORDER BY v.effective_from DESC LIMIT 1) m ON true
 JOIN crest.accounts revenue ON revenue.business_id=m.business_id AND revenue.id=m.account_id
 JOIN crest.accounts funds ON funds.business_id=l.business_id AND funds.id=l.account_id
 JOIN crest.account_mapping_versions held ON held.business_id=l.business_id AND held.id=l.mapping_id AND held.account_id=funds.id
 LEFT JOIN LATERAL(SELECT crest_private.resolve_invoice_tax_payable_mapping(l.business_id,scope_jurisdiction,on_date) AS value
  WHERE p.treatment='inclusive_single') tax ON true
 WHERE p.synthetic AND p.verification_evidence IS NOT NULL AND p.treatment IN('non_taxable','inclusive_single')
  AND crest_private.fixed_finance_mapping_matches('tips_revenue',revenue)
  AND held.purpose='customer_funds' AND crest_private.fixed_finance_mapping_matches('customer_funds',funds)
  AND (SELECT v.active FROM crest.account_versions v WHERE v.business_id=l.business_id AND v.account_id=funds.id
   ORDER BY v.version DESC LIMIT 1) IS TRUE
  AND (SELECT v.active FROM crest.account_versions v WHERE v.business_id=l.business_id AND v.account_id=revenue.id
   ORDER BY v.version DESC LIMIT 1) IS TRUE
  AND (p.treatment='non_taxable' OR tax.value IS NOT NULL);
$basis$;
CREATE FUNCTION crest_private.fictional_tip_realization_receipt(t crest.tip_realizations,l crest.customer_fund_lots,e crest.financial_events)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',t.business_id,'tipRealizationId',t.id,'operationId',t.operation_id,
  'eventId',e.id,'fundLotId',l.id,'unapplicationId',l.unapplication_id,'fundingOriginId',l.origin_id,
  'parentPartitionId',l.parent_partition_id,'customerId',l.customer_id,'fundsAccountId',l.account_id,'fundsMappingId',l.mapping_id,
  'revenueAccountId',t.revenue_account_id,'revenueMappingId',t.revenue_mapping_id,'taxAccountId',t.tax_account_id,
  'taxMappingId',t.tax_mapping_id,'taxProfileId',t.tax_profile_id,'jurisdiction',t.jurisdiction,
  'effectiveOn',to_char(e.effective_on,'YYYY-MM-DD'),'firstCent',t.first_cent::text,'lastCent',t.last_cent::text,
  'inclusiveCents',t.inclusive_cents::text,'netCents',t.net_cents::text,'taxCents',t.tax_cents::text,
  'customerIntentEvidence',t.customer_intent_evidence,'reason',t.reason);
$receipt$;
REVOKE ALL ON FUNCTION crest_private.fictional_tip_posting_basis(crest.customer_fund_lots,text,date),
 crest_private.fictional_tip_realization_receipt(crest.tip_realizations,crest.customer_fund_lots,crest.financial_events) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_tip_posting_basis(crest.customer_fund_lots,text,date),
 crest_private.fictional_tip_realization_receipt(crest.tip_realizations,crest.customer_fund_lots,crest.financial_events)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.verify_fictional_tip_realization(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; t crest.tip_realizations; l crest.customer_fund_lots; u crest.allocation_unapplications;
 held crest.financial_events; basis record; charge jsonb; journal uuid; receipt jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT t FROM crest.tip_realizations WHERE business_id=requested_business AND id=e.tip_realization_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=requested_business AND id=l.unapplication_id;
 SELECT * INTO STRICT held FROM crest.financial_events WHERE business_id=requested_business AND unapplication_id=u.id;
 SELECT * INTO basis FROM crest_private.fictional_tip_posting_basis(l,t.jurisdiction,e.effective_on);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_BASIS_REQUIRED';END IF;
 charge:=crest_private.finance_tax_charge(t.inclusive_cents,0,coalesce(basis.rate,0));
 receipt:=crest_private.fictional_tip_realization_receipt(t,l,e);
 IF e.template<>'P06' OR e.event_sequence<>1 OR held.template<>'P05'
  OR e.effective_on<held.effective_on OR e.posted_at<t.created_at
  OR e.effective_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR t.first_cent<u.first_cent OR t.last_cent>u.last_cent
  OR (t.tax_profile_id,t.revenue_mapping_id,t.revenue_account_id,t.tax_mapping_id,t.tax_account_id,t.net_cents,t.tax_cents) IS DISTINCT FROM
   (basis.profile_id,basis.revenue_mapping_id,basis.revenue_account_id,basis.tax_mapping_id,basis.tax_account_id,
    (charge->>'netCents')::bigint,(charge->>'taxCents')::bigint)
  OR NOT EXISTS(SELECT FROM crest.fund_lot_range_consumptions range_row WHERE range_row.business_id=t.business_id
   AND (range_row.tip_realization_id,range_row.fund_lot_id,range_row.first_cent,range_row.last_cent)=(t.id,l.id,t.first_cent,t.last_cent))
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest.atomic_finance_groups prior ON prior.business_id=held.business_id AND prior.id=held.group_id
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest_private.audit_events audit ON audit.business_id=o.business_id AND audit.operation_id=o.operation_id AND audit.actor_id=o.actor_id
   JOIN crest.accounting_periods p ON p.business_id=e.business_id AND p.id=e.period_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=t.operation_id AND g.created_by=t.created_by
    AND g.commit_sequence>prior.commit_sequence AND g.recovery_epoch=o.recovery_epoch
    AND o.command_type='finance.tip.realize' AND o.state='committed' AND o.result=receipt
    AND audit.entity_kind='tip_realizations' AND audit.entity_id=t.id AND audit.entity_version=1 AND audit.action='realize'
    AND audit.reason=t.reason AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
    AND e.time_zone=p.time_zone AND e.effective_on BETWEEN p.starts_on AND p.through_on AND e.period_generation%2=0
    AND e.period_generation=coalesce((SELECT max(h.generation) FROM crest.accounting_period_locks h
     WHERE h.business_id=p.business_id AND h.period_id=p.id),0))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_SOURCE_REQUIRED';END IF;

 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF journal IS NULL OR (SELECT count(*) FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id)<>1
  OR (SELECT count(*) FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal)<>1+(t.net_cents>0)::int+(t.tax_cents>0)::int
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='tip_funds' AND x.fund_lot_id=l.id AND x.account_id=l.account_id AND x.fixed_mapping_id=l.mapping_id
   AND x.debit_cents=t.inclusive_cents AND x.tip_realization_id=t.id)
  OR (t.net_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='tip_revenue' AND x.account_id=t.revenue_account_id AND x.fixed_mapping_id=t.revenue_mapping_id
   AND x.credit_cents=t.net_cents AND x.tip_realization_id=t.id))
  OR (t.tax_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE x.business_id=e.business_id AND x.entry_id=journal
   AND x.purpose='tip_tax' AND x.account_id=t.tax_account_id AND x.credit_cents=t.tax_cents AND x.tip_realization_id=t.id))
  OR EXISTS(SELECT FROM crest.money_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements x WHERE x.business_id=e.business_id AND x.event_id=e.id)
  OR EXISTS(SELECT FROM crest.allocation_events x WHERE x.business_id=e.business_id AND x.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_JOURNAL_REQUIRED';END IF;
END $verify$;
CREATE FUNCTION crest_private.verify_fictional_tip_realization_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid;
BEGIN
 SELECT e.id INTO event_id FROM crest.financial_events e WHERE e.business_id=NEW.business_id AND e.tip_realization_id=NEW.id;
 IF event_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_SOURCE_REQUIRED';END IF;
 PERFORM crest_private.verify_fictional_tip_realization(NEW.business_id,event_id);
 RETURN NULL;
END $verify$;
RESET ROLE;
ALTER FUNCTION crest_private.verify_fictional_tip_realization(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_fictional_tip_realization_row() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_fictional_tip_realization(uuid,uuid),crest_private.verify_fictional_tip_realization_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_fictional_tip_realization_row() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER tip_realization_complete AFTER INSERT ON crest.tip_realizations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_tip_realization_row();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.verify_fictional_tip_realization_row() FROM crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
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
  WHEN 'P12' THEN PERFORM crest_private.verify_same_day_expense(saved.business_id,saved.id);
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.realize_fictional_held_tip(
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
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_LOT_REQUIRED';END IF;
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
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.realize_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text,uuid,uuid,uuid,text,text) OWNER TO crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.realize_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.realize_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,uuid,date,bigint,bigint,text,uuid,uuid,uuid,text,text) TO crest_finance_preview;

-- The original P04 posting still claims its range via the database trigger.
-- Its review reader now excludes P06-spent ranges too.
SET LOCAL ROLE crest_finance_account_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_fictional_customer_funds_application_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; selected date; today date; invoice_date date; r crest.receivable_items;
 outstanding numeric; lots jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL OR
  (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FUND_APPLICATION_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 today:=(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date;
 selected:=coalesce(reviewed_on,today);
 IF selected>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO r FROM crest.receivable_items item WHERE item.business_id=requested_business
  AND item.invoice_id=requested_invoice AND item.customer_id=requested_customer;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT e.effective_on INTO STRICT invoice_date FROM crest.financial_events e
  WHERE e.business_id=requested_business AND e.invoice_id=requested_invoice;
 IF selected<invoice_date THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_DATE_REQUIRED';END IF;
 SELECT min(remaining) INTO outstanding FROM (
  SELECT r.original_cents+coalesce(sum(d.signed_cents) FILTER(WHERE d.effective_on<=selected),0) AS remaining
  FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
  UNION ALL
  SELECT r.original_cents+dated.running FROM (
   SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
   FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
  ) dated WHERE dated.effective_on>selected
 ) capacity;
 SELECT coalesce(jsonb_agg(jsonb_build_object('fundLotId',available.id,'heldOn',to_char(available.effective_on,'YYYY-MM-DD'),
   'availableRanges',available.ranges) ORDER BY available.effective_on,available.id),'[]'::jsonb) INTO lots
 FROM (
  SELECT l.id,e.effective_on,ranges.available_ranges AS ranges
  FROM crest.customer_fund_lots l
  JOIN crest.allocation_unapplications u ON u.business_id=l.business_id AND u.id=l.unapplication_id
  JOIN crest.financial_events e ON e.business_id=u.business_id AND e.unapplication_id=u.id AND e.template='P05'
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
     ORDER BY gap.first_cent),'[]'::jsonb) AS available_ranges
   FROM (
    SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
    FROM (
     SELECT lag(boundary.last_cent,1,u.first_cent::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
      boundary.first_cent AS next_start
     FROM (
      SELECT a.first_cent::numeric,a.last_cent::numeric FROM crest.fund_lot_range_consumptions a
       WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id
      UNION ALL SELECT u.last_cent::numeric+1,NULL::numeric
     ) boundary
    ) spans WHERE spans.previous_end+1<spans.next_start ORDER BY spans.previous_end LIMIT 181
   ) gap
  ) ranges
  WHERE l.business_id=requested_business AND l.customer_id=requested_customer AND e.effective_on<=selected
   AND crest_private.fund_application_controls_active(l,r) AND jsonb_array_length(ranges.available_ranges)>0
  ORDER BY e.effective_on,l.id LIMIT 181
 ) available;
 IF jsonb_array_length(lots)>180 OR EXISTS(SELECT FROM jsonb_array_elements(lots) lot
   WHERE jsonb_array_length(lot->'availableRanges')>180)
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='FUND_APPLICATION_OPTIONS_LIMIT';END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods a
  LEFT JOIN LATERAL (SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=a.business_id AND h.period_id=a.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE a.business_id=requested_business AND a.time_zone=auth->>'timezone'
   AND selected>=a.starts_on AND selected<=a.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'invoiceId',requested_invoice,'receivableId',r.id,'effectiveOn',to_char(selected,'YYYY-MM-DD'),
  'availableBalanceCents',greatest(outstanding,0)::text,'openPeriod',open_period,'lots',lots);
END $options$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;

-- Preserve original CSV projections while checking the complete physical schema.
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
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FUND_APPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

-- A report explicitly covering P06 keeps per-lot available balances tied
-- to the journal. Older versions refuse dates that include P06.
CREATE FUNCTION crest_private.fictional_posted_report_context_v4(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND e.template NOT IN('P01','P02','P03','P04','P05','P06','P12')) THEN
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
      OR (a.tip_realization_id IS NOT NULL AND applied.tip_realization_id=a.tip_realization_id))
    WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id AND applied.effective_on<=through_on
   ),0) AS available FROM crest.customer_fund_lots l
   JOIN crest.financial_events e ON e.business_id=l.business_id AND e.unapplication_id=l.unapplication_id
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
 RETURN jsonb_build_object('schemaVersion',4,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P04','P05','P06','P12')),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true,'taxPayableTie',true));
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_posted_report_context_v4(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_posted_report_context_v4(uuid,date,text) TO crest_finance_account_owner;

CREATE FUNCTION crest_private.fictional_journal_body_v4(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
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
   e.effective_on,e.event_sequence,e.template,e.invoice_id,e.payment_id,e.posted_expense_id,e.unapplication_id,e.fund_application_id,e.tip_realization_id,l.fund_lot_id,g.commit_sequence,g.operation_id,
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
  'invoiceId',p.invoice_id,'paymentId',p.payment_id,'postedExpenseId',p.posted_expense_id,'unapplicationId',p.unapplication_id,'fundApplicationId',p.fund_application_id,'tipRealizationId',p.tip_realization_id,'fundLotId',p.fund_lot_id,'operationId',p.operation_id)
  ORDER BY p.effective_on,p.commit_sequence,p.event_sequence,p.entry_sequence,p.id),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_limit FROM candidates),
  'nextAfterLineId',CASE WHEN (SELECT count(*)>page_limit FROM candidates) THEN
   (SELECT id FROM page ORDER BY effective_on DESC,commit_sequence DESC,event_sequence DESC,entry_sequence DESC,id DESC LIMIT 1) END)
 INTO body FROM page p;
 RETURN body;
END $report$;
REVOKE ALL ON FUNCTION crest_private.fictional_journal_body_v4(uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_journal_body_v4(uuid,date,uuid,uuid,integer) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.read_fictional_trial_balance_v4(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context_v4(requested_business,selected,zone)||
  crest_private.fictional_trial_balance_body(requested_business,selected) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_journal_v4(
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
 SELECT crest_private.fictional_posted_report_context_v4(requested_business,selected,zone)||
  crest_private.fictional_journal_body_v4(requested_business,selected,requested_account,after_line,page_limit) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_trial_balance_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_journal_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_trial_balance_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date),crest_commands.read_fictional_journal_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_trial_balance_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date),crest_commands.read_fictional_journal_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;
