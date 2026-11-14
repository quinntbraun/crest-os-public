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
