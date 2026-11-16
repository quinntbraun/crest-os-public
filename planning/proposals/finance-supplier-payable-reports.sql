-- Held report coverage for P14 and P15. Apply after the supplier payable proposals.
-- Legacy readers keep their prior wire format and fail closed if the ledger gains
-- a template outside their coverage. All controls run within the reporting snapshot.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.verify_supplier_payables_report(requested_business uuid,through_on date)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
BEGIN
 IF EXISTS(
  WITH source AS (
   SELECT p.id AS source_id,p.id AS payable_id,p.payable_account_id AS account_id,
    (p.review->>'incurredOn')::date AS effective_on,p.gross_cents::numeric AS cents
   FROM crest.supplier_payables p
   WHERE p.business_id=requested_business AND (p.review->>'incurredOn')::date<=through_on
   UNION ALL
   SELECT s.id,s.payable_id,p.payable_account_id,s.actual_on,-s.paid_cents::numeric
   FROM crest.supplier_payable_settlements s
   JOIN crest.supplier_payables p ON (p.business_id,p.id)=(s.business_id,s.payable_id)
   WHERE s.business_id=requested_business AND s.actual_on<=through_on
  ), ledger AS (
   SELECT coalesce(e.supplier_payable_id,e.supplier_payable_settlement_id) AS source_id,
    coalesce(e.supplier_payable_id,s.payable_id) AS payable_id,l.account_id,e.effective_on,
    sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents,count(*) AS line_count
   FROM crest.financial_events e JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
   JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
   JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
   LEFT JOIN crest.supplier_payable_settlements s ON (s.business_id,s.id)=(e.business_id,e.supplier_payable_settlement_id)
   WHERE e.business_id=requested_business AND e.effective_on<=through_on AND a.control_kind='payable'
   GROUP BY 1,2,3,4
  ), remaining AS (
   SELECT payable_id,sum(cents) AS cents FROM source GROUP BY payable_id
  )
  SELECT FROM source s FULL JOIN ledger l
   ON (l.source_id,l.payable_id,l.account_id,l.effective_on,l.cents)=(s.source_id,s.payable_id,s.account_id,s.effective_on,s.cents)
  WHERE s.source_id IS NULL OR l.source_id IS NULL OR l.line_count<>1
  UNION ALL
  SELECT FROM remaining WHERE cents<0
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_SUPPLIER_PAYABLE_CONTROL_FAILED'; END IF;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_payables_report(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_payables_report(uuid,date) TO crest_finance_account_owner;

CREATE FUNCTION crest_private.fictional_posted_report_context(requested_business uuid,through_on date,zone text,include_supplier_payables boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND (NOT (
   (e.template_version IN(1,2,3) AND e.template IN('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'))
   OR (include_supplier_payables AND e.template_version=1 AND e.template IN('P14','P15'))))) THEN
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
 IF include_supplier_payables THEN
  PERFORM crest_private.verify_supplier_payables_report(requested_business,through_on);
 END IF;
 RETURN jsonb_build_object('schemaVersion',CASE WHEN include_supplier_payables THEN 11 ELSE 10 END,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'refundDue',crest_private.fictional_refund_due_body(requested_business,through_on),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12')||
    CASE WHEN include_supplier_payables THEN jsonb_build_array('P14','P15') ELSE '[]'::jsonb END),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true,'taxPayableTie',true)||
   CASE WHEN include_supplier_payables THEN jsonb_build_object('supplierPayablesTie',true) ELSE '{}'::jsonb END);
END $report$;

REVOKE ALL ON FUNCTION crest_private.fictional_posted_report_context(uuid,date,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_posted_report_context(uuid,date,text,boolean) TO crest_finance_account_owner;

CREATE OR REPLACE FUNCTION crest_private.fictional_posted_report_context_v10(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $legacy$
 SELECT crest_private.fictional_posted_report_context(requested_business,through_on,zone,false)
$legacy$;

CREATE FUNCTION crest_private.fictional_journal_body_v16(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE body jsonb; rows jsonb;
BEGIN
 body:=crest_private.fictional_journal_body_v14(requested_business,through_on,requested_account,after_line,page_limit);
 SELECT coalesce(jsonb_agg(j.row||jsonb_build_object(
  'supplierPayableId',p.id,'supplierBillId',p.bill_id,'supplierSettlementId',s.id,
  'supplierMoneyMovementId',CASE WHEN s.id IS NOT NULL THEN l.money_movement_id END) ORDER BY j.position),'[]'::jsonb)
 INTO rows FROM jsonb_array_elements(body->'rows') WITH ORDINALITY j(row,position)
 JOIN crest.journal_lines l ON (l.business_id,l.id)=(requested_business,(j.row->>'lineId')::uuid)
 LEFT JOIN crest.supplier_payable_settlements s ON (s.business_id,s.id)=(l.business_id,l.supplier_payable_settlement_id)
 LEFT JOIN crest.supplier_payables p ON (p.business_id,p.id)=(l.business_id,coalesce(l.supplier_payable_id,s.payable_id));
 IF jsonb_array_length(rows)<>jsonb_array_length(body->'rows') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_LEDGER_CONTROL_FAILED';
 END IF;
 RETURN jsonb_set(body,'{rows}',rows);
END $body$;
REVOKE ALL ON FUNCTION crest_private.fictional_journal_body_v16(uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_journal_body_v16(uuid,date,uuid,uuid,integer) TO crest_finance_account_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;

CREATE FUNCTION crest_commands.read_fictional_trial_balance_v11(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context(requested_business,selected,zone,true)||
  crest_private.fictional_trial_balance_body(requested_business,selected) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_journal_v16(
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
 SELECT crest_private.fictional_posted_report_context(requested_business,selected,zone,true)||
  crest_private.fictional_journal_body_v16(requested_business,selected,requested_account,after_line,page_limit)||jsonb_build_object('schemaVersion',16) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_recorded_income_statement_v2(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, from_on date, through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE authority jsonb; zone text; result jsonb;
BEGIN
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=authority->>'timezone';
 IF from_on IS NULL OR through_on IS NULL OR from_on<DATE '1900-01-01'
    OR through_on<from_on OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH context AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context(requested_business,through_on,zone,true) AS value
 ), movements AS (
  SELECT l.account_id,sum(l.debit_cents::numeric) AS debit,sum(l.credit_cents::numeric) AS credit
  FROM crest.financial_events e
  JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
  JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
  WHERE e.business_id=requested_business AND e.effective_on BETWEEN from_on AND through_on
  GROUP BY l.account_id
 ), accounts AS (
  SELECT a.id,a.code,a.account_type,v.name,v.active,m.debit,m.credit
  FROM movements m JOIN crest.accounts a ON a.business_id=requested_business AND a.id=m.account_id
  JOIN LATERAL (
   SELECT name,active FROM crest.account_versions v
   WHERE v.business_id=a.business_id AND v.account_id=a.id ORDER BY version DESC LIMIT 1
  ) v ON true
  WHERE a.account_type IN ('revenue','contra_revenue','expense')
 ), lines AS (
  SELECT *,credit-debit AS income,CASE
   WHEN account_type='revenue' AND code='4000' THEN 'service_revenue'
   WHEN account_type='revenue' AND code='4100' THEN 'tips_revenue'
   WHEN account_type='revenue' THEN 'other_income'
   WHEN account_type='contra_revenue' AND code='4900' THEN 'discounts'
   WHEN account_type='contra_revenue' AND code='4910' THEN 'returns'
   WHEN account_type='contra_revenue' THEN 'other_contra_revenue'
   ELSE 'expense'
  END AS section FROM accounts
 )
 SELECT jsonb_build_object(
  'schemaVersion',2,'businessId',requested_business,'currency','USD',
  'timeZone',zone,'observedAt',context.value->'observedAt',
  'fromOn',to_char(from_on,'YYYY-MM-DD'),'throughOn',context.value->'throughOn',
  'coverageStart',context.value->'coverageStart','coverage',context.value->'coverage',
  'controls',context.value->'controls',
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'section',section,'accountId',id,'code',code,'name',name,'active',active,
   'debitCents',debit::text,'creditCents',credit::text,'incomeCents',income::text
  ) ORDER BY section COLLATE "C",code COLLATE "C",id) FROM lines),'[]'::jsonb),
  'netIncomeCents',(SELECT coalesce(sum(income),0)::text FROM lines)
 ) INTO result FROM context;
 IF jsonb_array_length(result->'rows')>5000 THEN
  RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='FINANCE_REPORT_ACCOUNT_LIMIT';
 END IF;
 RETURN result;
END $report$;

CREATE FUNCTION crest_commands.read_fictional_statement_match_review_v2(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_statement uuid, requested_from date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET datestyle='ISO, YMD' AS $review$
DECLARE authority jsonb; retained crest.statement_imports; result jsonb; from_on date; zone text;
BEGIN
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=authority->>'timezone';
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO retained FROM crest.statement_imports
 WHERE business_id=requested_business AND id=requested_statement;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='STATEMENT_MATCH_SOURCE_REQUIRED';
 END IF;
 from_on:=coalesce(requested_from,retained.starts_on);
 IF from_on<DATE '0001-01-01' OR from_on>retained.ends_on
    OR retained.ends_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='STATEMENT_MATCH_DATE_REQUIRED';
 END IF;
 WITH ledger AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context(requested_business,retained.ends_on,zone,true) AS checked
 ), movements AS MATERIALIZED (
  SELECT m.id,e.effective_on,m.signed_cents
  FROM crest.money_movements m JOIN crest.financial_events e ON (e.business_id,e.id)=(m.business_id,m.event_id)
  WHERE m.business_id=requested_business AND m.account_id=retained.account_id
    AND e.effective_on BETWEEN from_on AND retained.ends_on
  ORDER BY e.effective_on,m.id LIMIT 1001
 ), rows AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'statementOn',r.statement_on,'signedCents',r.signed_cents::text)
   ORDER BY r.statement_on,r.id),'[]'::jsonb) AS rows
  FROM crest.statement_import_rows r WHERE r.business_id=requested_business AND r.statement_id=requested_statement
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'statementId',retained.id,
  'accountId',retained.account_id,'startsOn',retained.starts_on,'endsOn',retained.ends_on,'movementFromOn',from_on,
  'observedAt',ledger.checked->'observedAt','statementDifferenceCents',retained.statement_difference_cents::text,
  'rows',rows.rows,'movements',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'accountId',retained.account_id,
   'effectiveOn',m.effective_on,'signedCents',m.signed_cents::text,'previouslyMatchedCents','0') ORDER BY m.effective_on,m.id),'[]'::jsonb)
   FROM movements m)) INTO result FROM ledger CROSS JOIN rows;
 IF jsonb_array_length(result->'rows')<>retained.row_count OR jsonb_array_length(result->'movements')>1000 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_MATCH_SOURCE_LIMIT';
 END IF;
 RETURN result;
END $review$;

REVOKE ALL ON FUNCTION crest_commands.read_fictional_trial_balance_v11(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_trial_balance_v11(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_journal_v16(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_journal_v16(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_recorded_income_statement_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_recorded_income_statement_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_statement_match_review_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_statement_match_review_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) TO crest_finance_preview;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
