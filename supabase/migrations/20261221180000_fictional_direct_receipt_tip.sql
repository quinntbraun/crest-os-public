-- Registered fictional direct receipt tips. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-direct-receipt-tip.sql
-- Held P03 explicit direct tip. The base payment, allocations, tip, optional
-- held remainder and ledger use one atomic receipt and one original root.
-- The typed tip anchor pins the 2000 mapping for future refund recovery.
-- It is not a spendable balance and has no 2000 posting at receipt time.
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.customer_fund_lots ADD COLUMN receipt_tip_event_id uuid;
ALTER TABLE crest.customer_fund_lots DROP CONSTRAINT fund_lot_one_source;
ALTER TABLE crest.customer_fund_lots ADD CONSTRAINT fund_lot_one_source
 CHECK(num_nonnulls(unapplication_id,receipt_event_id,receipt_tip_event_id)=1);
ALTER TABLE crest.customer_fund_lots ADD UNIQUE(business_id,receipt_tip_event_id);
ALTER TABLE crest.customer_fund_lots ADD FOREIGN KEY(business_id,receipt_tip_event_id) REFERENCES crest.financial_events(business_id,id);
CREATE POLICY direct_receipt_tip_anchor_insert ON crest.customer_fund_lots FOR INSERT TO crest_finance_account_owner
 WITH CHECK(receipt_tip_event_id IS NOT NULL
   AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=customer_fund_lots.business_id
    AND o.operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
    AND o.actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND o.command_type='finance.receipt.record' AND o.state='pending'));
CREATE POLICY direct_receipt_tip_insert ON crest.tip_realizations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=tip_realizations.business_id
   AND o.operation_id=tip_realizations.operation_id AND o.actor_id=tip_realizations.created_by
   AND o.command_type='finance.receipt.record' AND o.state='pending'));

-- The normal tip row owns the existing full-range claim. Its anchor points
-- forward to that same P03 event, so the lot-first insert order is validated
-- before commit with a deferred tenant-scoped FK.
ALTER TABLE crest.financial_events DROP CONSTRAINT financial_events_business_id_tip_realization_id_fkey;
ALTER TABLE crest.financial_events ADD FOREIGN KEY(business_id,tip_realization_id)
 REFERENCES crest.tip_realizations(business_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(
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
   excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,zero_effect_reason)=0)
);
RESET ROLE;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.fictional_tip_posting_basis(business uuid,funds_account uuid,funds_mapping uuid,scope_jurisdiction text,on_date date)
RETURNS TABLE(profile_id uuid,treatment text,rate numeric,revenue_mapping_id uuid,revenue_account_id uuid,tax_mapping_id uuid,tax_account_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $basis$
 SELECT p.id,p.treatment,p.rate,m.id,m.account_id,(tax.value->>'mappingId')::uuid,(tax.value->>'accountId')::uuid
 FROM (SELECT * FROM crest.tax_profiles p WHERE p.business_id=business AND p.jurisdiction=scope_jurisdiction
  AND p.applicability='tip' AND p.service_id IS NULL AND p.effective_from<=on_date ORDER BY p.effective_from DESC LIMIT 1) p
 JOIN LATERAL (SELECT * FROM crest.account_mapping_versions v WHERE v.business_id=business AND v.purpose='tips_revenue'
  AND v.effective_from<=on_date ORDER BY v.effective_from DESC LIMIT 1) m ON true
 JOIN crest.accounts revenue ON revenue.business_id=m.business_id AND revenue.id=m.account_id
 JOIN crest.accounts funds ON funds.business_id=business AND funds.id=funds_account
 JOIN crest.account_mapping_versions held ON held.business_id=business AND held.id=funds_mapping AND held.account_id=funds.id
 LEFT JOIN LATERAL(SELECT crest_private.resolve_invoice_tax_payable_mapping(business,scope_jurisdiction,on_date) AS value
  WHERE p.treatment='inclusive_single') tax ON true
 WHERE p.synthetic AND p.verification_evidence IS NOT NULL AND p.treatment IN('non_taxable','inclusive_single')
  AND crest_private.fixed_finance_mapping_matches('tips_revenue',revenue)
  AND held.purpose='customer_funds' AND crest_private.fixed_finance_mapping_matches('customer_funds',funds)
  AND (SELECT v.active FROM crest.account_versions v WHERE v.business_id=business AND v.account_id=funds.id
   ORDER BY v.version DESC LIMIT 1) IS TRUE
  AND (SELECT v.active FROM crest.account_versions v WHERE v.business_id=business AND v.account_id=revenue.id
   ORDER BY v.version DESC LIMIT 1) IS TRUE
  AND (p.treatment='non_taxable' OR tax.value IS NOT NULL);
$basis$;
REVOKE ALL ON FUNCTION crest_private.fictional_tip_posting_basis(uuid,uuid,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_tip_posting_basis(uuid,uuid,uuid,text,date)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.fictional_tip_posting_basis(l crest.customer_fund_lots,scope_jurisdiction text,on_date date)
RETURNS TABLE(profile_id uuid,treatment text,rate numeric,revenue_mapping_id uuid,revenue_account_id uuid,tax_mapping_id uuid,tax_account_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $basis$
 SELECT * FROM crest_private.fictional_tip_posting_basis(l.business_id,l.account_id,l.mapping_id,scope_jurisdiction,on_date);
$basis$;

CREATE FUNCTION crest_private.direct_receipt_tip_snapshot(t crest.tip_realizations,l crest.customer_fund_lots)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $tip$
 SELECT jsonb_build_object('tipRealizationId',t.id,'fundingPartitionId',l.parent_partition_id,
  'firstCent',t.first_cent::text,'lastCent',t.last_cent::text,'inclusiveCents',t.inclusive_cents::text,
  'netCents',t.net_cents::text,'taxCents',t.tax_cents::text,'jurisdiction',t.jurisdiction,
  'taxProfileId',t.tax_profile_id,'revenueMappingId',t.revenue_mapping_id,'taxMappingId',t.tax_mapping_id,
  'confirmation',t.customer_intent_evidence);
$tip$;
REVOKE ALL ON FUNCTION crest_private.direct_receipt_tip_snapshot(crest.tip_realizations,crest.customer_fund_lots) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.direct_receipt_tip_snapshot(crest.tip_realizations,crest.customer_fund_lots)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.record_direct_fictional_receipt_with_tip(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_payment uuid,requested_customer uuid,requested_channel uuid,
 expected_channel_version bigint,actual_on date,gross_cents bigint,confirmation text,distinct_reason text,external_identity jsonb,
 applications jsonb,requested_funds_mapping uuid,requested_tip jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
DECLARE
 auth jsonb; digest text; saved record; channel crest.money_channel_versions; period record; allocation record;
 receivable crest.receivable_items; group_id uuid; event_id uuid; journal_id uuid; origin_id uuid; partition_id uuid;
 application_id uuid; evidence_id uuid; movement_id uuid; claimed uuid; position integer:=0; used bigint:=0;
 outstanding numeric; allocated numeric; held_cents bigint; funds_account uuid; lot_id uuid;
 tip_cents bigint:=0; tip_id uuid; tip_lot crest.customer_fund_lots; saved_tip crest.tip_realizations; basis record; charge jsonb; digest_fields jsonb; receipt jsonb; output_applications jsonb:='[]'::jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_payment IS NULL OR requested_customer IS NULL OR requested_channel IS NULL
  OR expected_channel_version IS NULL OR expected_channel_version<1
  OR actual_on IS NULL OR actual_on<DATE '0001-01-01' OR actual_on>DATE '9999-12-31'
  OR gross_cents IS NULL OR gross_cents<=0 OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000
  OR confirmation<>btrim(confirmation) OR confirmation~'[[:cntrl:]]'
  OR (distinct_reason IS NOT NULL AND (char_length(distinct_reason) NOT BETWEEN 1 AND 1000
    OR distinct_reason<>btrim(distinct_reason) OR distinct_reason~'[[:cntrl:]]'))
  OR jsonb_typeof(applications) IS DISTINCT FROM 'object' OR octet_length(applications::text)>20000
  OR (external_identity IS NOT NULL AND (jsonb_typeof(external_identity) IS DISTINCT FROM 'object'
    OR NOT external_identity?&ARRAY['namespace','id','rawReference']
    OR external_identity-ARRAY['namespace','id','rawReference']<>'{}'::jsonb
    OR jsonb_typeof(external_identity->'namespace') IS DISTINCT FROM 'string'
    OR jsonb_typeof(external_identity->'id') IS DISTINCT FROM 'string'
    OR jsonb_typeof(external_identity->'rawReference') IS DISTINCT FROM 'string'
    OR external_identity->>'namespace'!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
    OR char_length(external_identity->>'id') NOT BETWEEN 1 AND 200
    OR external_identity->>'id'<>btrim(external_identity->>'id') OR external_identity->>'id'~'[[:cntrl:]]'
    OR char_length(external_identity->>'rawReference') NOT BETWEEN 1 AND 1000)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM jsonb_each(applications)) NOT BETWEEN 0 AND 180
  OR EXISTS(SELECT FROM jsonb_each(applications) a
   WHERE a.key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(a.value) IS DISTINCT FROM 'string' OR a.value#>>'{}'!~'^[1-9][0-9]{0,18}$')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_INPUT_REQUIRED';END IF;
 IF requested_tip IS NOT NULL THEN
  IF jsonb_typeof(requested_tip) IS DISTINCT FROM 'object' OR octet_length(requested_tip::text)>8192 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_TIP_INPUT_REQUIRED';END IF;
  IF NOT requested_tip?&ARRAY['tipRealizationId','cents','jurisdiction','taxProfileId','revenueMappingId','taxMappingId','confirmation']
   OR requested_tip-ARRAY['tipRealizationId','cents','jurisdiction','taxProfileId','revenueMappingId','taxMappingId','confirmation']<>'{}'::jsonb
   OR EXISTS(SELECT FROM unnest(ARRAY['tipRealizationId','taxProfileId','revenueMappingId','taxMappingId']) f(name)
    WHERE NOT (f.name='taxMappingId' AND requested_tip->f.name='null'::jsonb)
     AND (jsonb_typeof(requested_tip->f.name) IS DISTINCT FROM 'string'
      OR requested_tip->>f.name!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
   OR jsonb_typeof(requested_tip->'cents') IS DISTINCT FROM 'string' OR requested_tip->>'cents'!~'^[1-9][0-9]{0,18}$'
   OR jsonb_typeof(requested_tip->'jurisdiction') IS DISTINCT FROM 'string'
   OR char_length(requested_tip->>'jurisdiction') NOT BETWEEN 1 AND 200
   OR requested_tip->>'jurisdiction'<>btrim(requested_tip->>'jurisdiction') OR requested_tip->>'jurisdiction'~'[[:cntrl:]]'
   OR jsonb_typeof(requested_tip->'confirmation') IS DISTINCT FROM 'string'
   OR char_length(requested_tip->>'confirmation') NOT BETWEEN 1 AND 1000
   OR requested_tip->>'confirmation'<>btrim(requested_tip->>'confirmation') OR requested_tip->>'confirmation'~'[[:cntrl:]]'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_TIP_INPUT_REQUIRED';END IF;
  IF (requested_tip->>'cents')::numeric>gross_cents THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_TIP_AMOUNT_REQUIRED';END IF;
  tip_cents:=(requested_tip->>'cents')::bigint;
  tip_id:=(requested_tip->>'tipRealizationId')::uuid;
 END IF;
 SELECT coalesce(sum((a.value#>>'{}')::numeric),0) INTO allocated FROM jsonb_each(applications) a;
 IF allocated+tip_cents>gross_cents OR (allocated<gross_cents OR tip_cents>0)<>(requested_funds_mapping IS NOT NULL)
  OR (SELECT count(*) FROM jsonb_each(applications))+(tip_cents>0)::int+(allocated+tip_cents<gross_cents)::int>180
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FULL_ALLOCATION_REQUIRED';END IF;
 held_cents:=gross_cents-allocated-tip_cents;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest_fields:=jsonb_build_array('finance.receipt.record',1,requested_business,expected_actor,
  expected_epoch,requested_payment,requested_customer,requested_channel,expected_channel_version,actual_on,gross_cents::text,
  confirmation,distinct_reason,external_identity,applications);
 IF requested_tip IS NOT NULL THEN
  digest_fields:=jsonb_set(digest_fields,'{1}','3'::jsonb)||jsonb_build_array(requested_funds_mapping,requested_tip);
 ELSIF requested_funds_mapping IS NOT NULL THEN
  digest_fields:=jsonb_set(digest_fields,'{1}','2'::jsonb)||jsonb_build_array(requested_funds_mapping);
 END IF;
 digest:=encode(sha256(convert_to(digest_fields::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.receipt.record',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.receipt.record' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF actual_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DATE_REQUIRED';
 END IF;
 SELECT * INTO channel FROM crest.money_channel_versions v WHERE v.business_id=requested_business
  AND v.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,auth->>'timezone');
 IF NOT FOUND OR channel.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_VERIFIED_CHANNEL_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,auth->>'timezone');
 IF requested_funds_mapping IS NOT NULL THEN
  SELECT m.account_id INTO funds_account FROM crest.account_mapping_versions m
  WHERE (m.business_id,m.id)=(requested_business,requested_funds_mapping)
    AND m.id=crest_private.unapplication_funds_mapping(requested_business,actual_on);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED';END IF;
 END IF;

 IF requested_tip IS NOT NULL THEN
  SELECT * INTO basis FROM crest_private.fictional_tip_posting_basis(requested_business,funds_account,requested_funds_mapping,
   requested_tip->>'jurisdiction',actual_on);
  IF NOT FOUND OR (basis.profile_id,basis.revenue_mapping_id,basis.tax_mapping_id) IS DISTINCT FROM (
   (requested_tip->>'taxProfileId')::uuid,(requested_tip->>'revenueMappingId')::uuid,(requested_tip->>'taxMappingId')::uuid)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_TIP_BASIS_REQUIRED';END IF;
  IF EXISTS(SELECT FROM crest.tip_realizations t WHERE t.business_id=requested_business AND t.id=tip_id) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='TIP_REALIZATION_ALREADY_RECORDED';END IF;
  charge:=crest_private.finance_tax_charge(tip_cents,0,coalesce(basis.rate,0));
 END IF;

 IF EXISTS(SELECT FROM crest.payments p WHERE p.business_id=requested_business AND p.id=requested_payment) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='DIRECT_RECEIPT_ALREADY_RECORDED';
 END IF;
 IF external_identity IS NOT NULL AND EXISTS(SELECT FROM crest.external_money_evidence ev
  WHERE ev.business_id=requested_business AND ev.provider_namespace=channel.provider_namespace
   AND ev.external_account_id=channel.account_id AND ev.id_namespace=external_identity->>'namespace'
   AND ev.external_id=external_identity->>'id') THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='DIRECT_RECEIPT_EXTERNAL_ID_ALREADY_RECORDED';
 END IF;
 -- An ID on only one side cannot establish that two similar payments differ.
 IF distinct_reason IS NULL AND EXISTS(SELECT FROM crest.payments p
   JOIN crest.money_channel_versions v ON v.business_id=p.business_id AND v.id=p.channel_version_id
   JOIN crest.financial_events e ON e.business_id=p.business_id AND e.payment_id=p.id
   JOIN crest.money_movements m ON m.business_id=e.business_id AND m.event_id=e.id
   WHERE p.business_id=requested_business AND p.customer_id=requested_customer
    AND p.gross_cents=record_direct_fictional_receipt_with_tip.gross_cents
    AND p.actual_on BETWEEN record_direct_fictional_receipt_with_tip.actual_on-1 AND record_direct_fictional_receipt_with_tip.actual_on+1
    AND v.kind=channel.kind AND (external_identity IS NULL OR m.evidence_id IS NULL))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DUPLICATE_REVIEW_REQUIRED';END IF;

 FOR allocation IN SELECT a.key::uuid AS receivable_id,(a.value#>>'{}')::bigint AS cents FROM jsonb_each(applications) a ORDER BY a.key LOOP
  SELECT r.* INTO receivable FROM crest.receivable_items r JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
   WHERE r.business_id=requested_business AND r.id=allocation.receivable_id AND r.customer_id=requested_customer
    AND i.issued_on<=record_direct_fictional_receipt_with_tip.actual_on;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_RECEIVABLE_REQUIRED';END IF;
  SELECT min(remaining) INTO outstanding FROM (
   SELECT receivable.original_cents+coalesce(sum(d.signed_cents)
    FILTER(WHERE d.effective_on<=record_direct_fictional_receipt_with_tip.actual_on),0) AS remaining
   FROM crest_private.receivable_posted_deltas(requested_business,receivable.id) d
   UNION ALL
   SELECT receivable.original_cents+dated.running FROM (
    SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
    FROM crest_private.receivable_posted_deltas(requested_business,receivable.id) d
   ) dated WHERE dated.effective_on>record_direct_fictional_receipt_with_tip.actual_on
  ) capacity;
  IF allocation.cents>outstanding THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_ALLOCATION_EXCEEDS_BALANCE';
  END IF;
 END LOOP;

 INSERT INTO crest.payments(id,business_id,customer_id,channel_version_id,account_id,actual_on,gross_cents,confirmation,distinct_reason,operation_id,created_by)
 VALUES(requested_payment,requested_business,requested_customer,channel.id,channel.account_id,actual_on,gross_cents,
  confirmation,distinct_reason,requested_operation,expected_actor);
 IF external_identity IS NOT NULL THEN
  INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
   normalization_rule,confirmed_on,signed_cents,currency)
  VALUES(requested_business,channel.provider_namespace,channel.account_id,external_identity->>'namespace',external_identity->>'id',
   external_identity->>'rawReference','exact_case_v1',actual_on,gross_cents,'USD') RETURNING id INTO evidence_id;
 END IF;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,payment_id,tip_realization_id,period_id,period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,requested_payment,tip_id,period.period_id,period.generation,actual_on,auth->>'timezone','P03',1)
 RETURNING id INTO event_id;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,event_id,channel.account_id,evidence_id,gross_cents) RETURNING id INTO movement_id;
 INSERT INTO crest.funding_origins(business_id,payment_id,customer_id,cents,currency)
 VALUES(requested_business,requested_payment,requested_customer,gross_cents,'USD') RETURNING id INTO origin_id;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,channel.account_id,movement_id,'receipt_money',gross_cents,0);
 FOR allocation IN SELECT a.key::uuid AS receivable_id,(a.value#>>'{}')::bigint AS cents FROM jsonb_each(applications) a ORDER BY a.key LOOP
  position:=position+1;
  INSERT INTO crest.funding_partitions(business_id,origin_id,position,first_cent,last_cent)
  VALUES(requested_business,origin_id,position,used+1,used+allocation.cents) RETURNING id INTO partition_id;
  used:=used+allocation.cents;
  INSERT INTO crest.allocation_events(business_id,event_id,partition_id,receivable_id,cents)
  VALUES(requested_business,event_id,partition_id,allocation.receivable_id,allocation.cents) RETURNING id INTO application_id;
  INSERT INTO crest.journal_lines(business_id,entry_id,receivable_id,account_id,allocation_event_id,purpose,debit_cents,credit_cents)
  SELECT requested_business,journal_id,r.id,r.account_id,application_id,'receipt_ar',0,allocation.cents
  FROM crest.receivable_items r WHERE r.business_id=requested_business AND r.id=allocation.receivable_id;
  output_applications:=output_applications||jsonb_build_object('id',application_id,'receivableId',allocation.receivable_id,
   'fundingPartitionId',partition_id,'cents',allocation.cents::text);
 END LOOP;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'paymentId',requested_payment,'eventId',event_id,
  'customerId',requested_customer,'channelVersionId',channel.id,'accountId',channel.account_id,'actualOn',to_char(actual_on,'YYYY-MM-DD'),
  'grossCents',gross_cents::text,'fundingOriginId',origin_id,'moneyMovementId',movement_id,'externalEvidenceId',evidence_id,
  'applications',output_applications);
 IF tip_cents>0 THEN
  position:=position+1;
  INSERT INTO crest.funding_partitions(business_id,origin_id,position,first_cent,last_cent)
  VALUES(requested_business,origin_id,position,used+1,used+tip_cents) RETURNING id INTO partition_id;
  INSERT INTO crest.customer_fund_lots(business_id,receipt_tip_event_id,origin_id,parent_partition_id,customer_id,account_id,mapping_id,original_cents)
  VALUES(requested_business,event_id,origin_id,partition_id,requested_customer,funds_account,requested_funds_mapping,tip_cents)
  RETURNING * INTO tip_lot;
  INSERT INTO crest.tip_realizations(id,business_id,fund_lot_id,first_cent,last_cent,net_cents,tax_cents,jurisdiction,tax_profile_id,
   revenue_mapping_id,revenue_account_id,tax_mapping_id,tax_account_id,customer_intent_evidence,reason,operation_id,created_by)
  VALUES(tip_id,requested_business,tip_lot.id,used+1,used+tip_cents,(charge->>'netCents')::bigint,(charge->>'taxCents')::bigint,
   requested_tip->>'jurisdiction',basis.profile_id,basis.revenue_mapping_id,basis.revenue_account_id,basis.tax_mapping_id,basis.tax_account_id,
   requested_tip->>'confirmation',confirmation,requested_operation,expected_actor) RETURNING * INTO saved_tip;
  used:=used+tip_cents;
  IF saved_tip.net_cents>0 THEN
   INSERT INTO crest.journal_lines(business_id,entry_id,account_id,fixed_mapping_id,tip_realization_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,journal_id,saved_tip.revenue_account_id,saved_tip.revenue_mapping_id,tip_id,'tip_revenue',0,saved_tip.net_cents);
  END IF;
  IF saved_tip.tax_cents>0 THEN
   INSERT INTO crest.journal_lines(business_id,entry_id,account_id,tip_realization_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,journal_id,saved_tip.tax_account_id,tip_id,'tip_tax',0,saved_tip.tax_cents);
  END IF;
 END IF;
 IF held_cents>0 THEN
  INSERT INTO crest.funding_partitions(business_id,origin_id,position,first_cent,last_cent)
  VALUES(requested_business,origin_id,position+1,used+1,gross_cents) RETURNING id INTO partition_id;
  INSERT INTO crest.customer_fund_lots(business_id,receipt_event_id,origin_id,parent_partition_id,customer_id,account_id,mapping_id,original_cents)
  VALUES(requested_business,event_id,origin_id,partition_id,requested_customer,funds_account,requested_funds_mapping,held_cents) RETURNING id INTO lot_id;
  INSERT INTO crest.journal_lines(business_id,entry_id,account_id,fixed_mapping_id,fund_lot_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,funds_account,requested_funds_mapping,lot_id,'receipt_funds',0,held_cents);
  receipt:=receipt||jsonb_build_object('schemaVersion',2,'heldFunds',jsonb_build_object(
   'lotId',lot_id,'fundingPartitionId',partition_id,'mappingId',requested_funds_mapping,'cents',held_cents::text));
 END IF;
 IF tip_cents>0 THEN
  receipt:=receipt||jsonb_build_object('schemaVersion',3,'heldFunds',receipt->'heldFunds',
    'tip',crest_private.direct_receipt_tip_snapshot(saved_tip,tip_lot));
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'payments',requested_payment,1,'record',confirmation,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=(receipt->>'schemaVersion')::integer,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $record$;

CREATE OR REPLACE FUNCTION crest_commands.record_direct_fictional_receipt_with_funds(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_payment uuid,requested_customer uuid,requested_channel uuid,
 expected_channel_version bigint,actual_on date,gross_cents bigint,confirmation text,distinct_reason text,external_identity jsonb,
 applications jsonb,requested_funds_mapping uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
BEGIN
 RETURN crest_commands.record_direct_fictional_receipt_with_tip($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NULL);
END $record$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_direct_fictional_receipt_with_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,
 uuid,bigint,date,bigint,text,text,jsonb,jsonb,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_direct_fictional_receipt_with_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,
 uuid,bigint,date,bigint,text,text,jsonb,jsonb,uuid,jsonb) TO crest_finance_preview;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; p crest.payments; root crest.funding_origins;
 movement crest.money_movements; money crest.external_money_evidence; journal uuid; channel crest.money_channel_versions;
 operation_result jsonb; expected_receipt jsonb; expected_applications jsonb; held crest.customer_fund_lots; tip_lot crest.customer_fund_lots; tip crest.tip_realizations;
 basis record; charge jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND id=requested_event;
 SELECT * INTO STRICT p FROM crest.payments WHERE business_id=requested_business AND id=e.payment_id;
 SELECT * INTO root FROM crest.funding_origins WHERE business_id=requested_business AND payment_id=p.id;
 SELECT * INTO movement FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO channel FROM crest.money_channel_versions WHERE business_id=requested_business AND id=p.channel_version_id;
 IF movement.evidence_id IS NOT NULL THEN
  SELECT * INTO money FROM crest.external_money_evidence WHERE business_id=requested_business AND id=movement.evidence_id;
 END IF;
 SELECT id INTO journal FROM crest.journal_entries WHERE business_id=requested_business AND event_id=e.id AND entry_sequence=1;
 IF (e.template,e.event_sequence,e.effective_on) IS DISTINCT FROM ('P03'::text,1,p.actual_on)
  OR e.posted_at<p.created_at OR p.actual_on>(e.posted_at AT TIME ZONE e.time_zone)::date
  OR NOT EXISTS(SELECT FROM crest.atomic_finance_groups g
   JOIN crest_private.operations o ON o.business_id=g.business_id AND o.operation_id=g.operation_id AND o.actor_id=g.created_by
   JOIN crest.accounting_periods ap ON ap.business_id=e.business_id AND ap.id=e.period_id
   JOIN crest_private.audit_events a ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE g.business_id=e.business_id AND g.id=e.group_id AND g.operation_id=p.operation_id AND g.created_by=p.created_by
    AND g.recovery_epoch=o.recovery_epoch AND o.command_type='finance.receipt.record' AND o.state='committed'
    AND a.entity_kind='payments' AND a.entity_id=p.id AND a.entity_version=1 AND a.action='record'
    AND a.reason=p.confirmation AND a.delta->'after'=o.result AND o.result->>'paymentId'=p.id::text
    AND o.result->>'eventId'=e.id::text AND o.result->>'grossCents'=p.gross_cents::text
    AND e.time_zone=ap.time_zone AND p.actual_on>=ap.starts_on AND p.actual_on<=ap.through_on
    AND e.period_generation=coalesce((SELECT max(l.generation) FROM crest.accounting_period_locks l
     WHERE l.business_id=ap.business_id AND l.period_id=ap.id),0))
  OR root.id IS NULL OR (root.customer_id,root.cents) IS DISTINCT FROM (p.customer_id,p.gross_cents)
  OR movement.id IS NULL OR (movement.account_id,movement.signed_cents) IS DISTINCT FROM (p.account_id,p.gross_cents)
  OR channel.id IS NULL OR channel.account_id<>p.account_id
  OR channel.id IS DISTINCT FROM crest_private.direct_receipt_channel(requested_business,channel.channel_id,p.actual_on,e.time_zone)
  OR movement.evidence_id IS NOT NULL AND (money.provider_namespace,money.external_account_id,money.confirmed_on,money.signed_cents)
   IS DISTINCT FROM (channel.provider_namespace,p.account_id,p.actual_on,p.gross_cents)
  OR p.distinct_reason IS NULL AND EXISTS(SELECT FROM crest.payments earlier
   JOIN crest.money_channel_versions channel_before ON channel_before.business_id=earlier.business_id AND channel_before.id=earlier.channel_version_id
   JOIN crest.financial_events e_before ON e_before.business_id=earlier.business_id AND e_before.payment_id=earlier.id
   JOIN crest.atomic_finance_groups group_before ON group_before.business_id=e_before.business_id AND group_before.id=e_before.group_id
   JOIN crest.atomic_finance_groups current_group ON current_group.business_id=e.business_id AND current_group.id=e.group_id
   JOIN crest.money_movements movement_before ON movement_before.business_id=e_before.business_id AND movement_before.event_id=e_before.id
   WHERE earlier.business_id=p.business_id AND earlier.customer_id=p.customer_id AND earlier.gross_cents=p.gross_cents
    AND earlier.actual_on BETWEEN p.actual_on-1 AND p.actual_on+1 AND channel_before.kind=channel.kind
    AND group_before.commit_sequence<current_group.commit_sequence
    AND (movement.evidence_id IS NULL OR movement_before.evidence_id IS NULL))
  OR journal IS NULL OR EXISTS(SELECT FROM crest.journal_entries j WHERE j.business_id=e.business_id AND j.event_id=e.id AND j.entry_sequence<>1)
  OR EXISTS(SELECT FROM crest.invoice_tax_payable_movements t WHERE t.business_id=e.business_id AND t.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED'; END IF;

 SELECT * INTO held FROM crest.customer_fund_lots WHERE business_id=e.business_id AND receipt_event_id=e.id;
 SELECT * INTO tip_lot FROM crest.customer_fund_lots WHERE business_id=e.business_id AND receipt_tip_event_id=e.id;
 IF (e.tip_realization_id IS NULL)<>(tip_lot.id IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_TIP_SOURCE_REQUIRED';
 END IF;
 IF tip_lot.id IS NOT NULL THEN
  SELECT * INTO STRICT tip FROM crest.tip_realizations WHERE (business_id,id)=(e.business_id,e.tip_realization_id);
  SELECT * INTO basis FROM crest_private.fictional_tip_posting_basis(tip_lot,tip.jurisdiction,e.effective_on);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_TIP_BASIS_REQUIRED';END IF;
  charge:=crest_private.finance_tax_charge(tip.inclusive_cents,0,coalesce(basis.rate,0));
  IF (tip.fund_lot_id,tip.operation_id,tip.created_by,tip.reason) IS DISTINCT FROM (tip_lot.id,p.operation_id,p.created_by,p.confirmation)
   OR tip.created_at<e.posted_at
   OR (tip_lot.origin_id,tip_lot.customer_id,tip_lot.original_cents) IS DISTINCT FROM (root.id,p.customer_id,tip.inclusive_cents)
   OR tip_lot.mapping_id IS DISTINCT FROM crest_private.unapplication_funds_mapping(e.business_id,e.effective_on)
   OR (tip.tax_profile_id,tip.revenue_mapping_id,tip.revenue_account_id,tip.tax_mapping_id,tip.tax_account_id,tip.net_cents,tip.tax_cents)
    IS DISTINCT FROM (basis.profile_id,basis.revenue_mapping_id,basis.revenue_account_id,basis.tax_mapping_id,basis.tax_account_id,
     (charge->>'netCents')::bigint,(charge->>'taxCents')::bigint)
   OR NOT EXISTS(SELECT FROM crest.funding_partitions x WHERE (x.business_id,x.id,x.origin_id,x.first_cent,x.last_cent)
    =(e.business_id,tip_lot.parent_partition_id,root.id,tip.first_cent,tip.last_cent))
   OR NOT EXISTS(SELECT FROM crest.fund_lot_range_consumptions x WHERE (x.business_id,x.fund_lot_id,x.tip_realization_id,x.first_cent,x.last_cent)
    =(e.business_id,tip_lot.id,tip.id,tip.first_cent,tip.last_cent))
   OR (tip.net_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE (x.business_id,x.entry_id,x.purpose,x.tip_realization_id,
    x.account_id,x.fixed_mapping_id,x.credit_cents)=(e.business_id,journal,'tip_revenue',tip.id,tip.revenue_account_id,tip.revenue_mapping_id,tip.net_cents)))
   OR (tip.tax_cents>0 AND NOT EXISTS(SELECT FROM crest.journal_lines x WHERE (x.business_id,x.entry_id,x.purpose,x.tip_realization_id,
    x.account_id,x.credit_cents)=(e.business_id,journal,'tip_tax',tip.id,tip.tax_account_id,tip.tax_cents)))
   OR EXISTS(SELECT FROM crest.journal_lines x WHERE (x.business_id,x.entry_id,x.fund_lot_id)=(e.business_id,journal,tip_lot.id))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_TIP_SOURCE_REQUIRED';END IF;
 END IF;
 IF held.id IS NOT NULL AND ((held.origin_id,held.customer_id) IS DISTINCT FROM (root.id,p.customer_id)
  OR held.mapping_id IS DISTINCT FROM crest_private.unapplication_funds_mapping(e.business_id,e.effective_on)
  OR NOT EXISTS(SELECT FROM crest.account_mapping_versions m WHERE (m.business_id,m.id,m.account_id)=(e.business_id,held.mapping_id,held.account_id))
  OR NOT EXISTS(SELECT FROM crest.journal_lines x WHERE (x.business_id,x.entry_id,x.fund_lot_id,x.account_id,x.fixed_mapping_id,x.credit_cents)
   =(e.business_id,journal,held.id,held.account_id,held.mapping_id,held.original_cents) AND x.purpose='receipt_funds'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_FUNDS_MAPPING_REQUIRED';END IF;
 IF NOT EXISTS(SELECT FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id)
  OR EXISTS(SELECT FROM (
    SELECT x.*,lag(x.last_cent::numeric,1,0::numeric) OVER(ORDER BY x.position) AS prior,
     row_number() OVER(ORDER BY x.position) AS ordinal
    FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id
   ) x LEFT JOIN crest.allocation_events a ON a.business_id=x.business_id AND a.partition_id=x.id
   LEFT JOIN crest.receivable_items r ON r.business_id=a.business_id AND r.id=a.receivable_id
   LEFT JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
   LEFT JOIN crest.financial_events invoice_event ON invoice_event.business_id=i.business_id AND invoice_event.invoice_id=i.id
   LEFT JOIN crest.atomic_finance_groups original_group ON original_group.business_id=invoice_event.business_id
    AND original_group.id=invoice_event.group_id
   LEFT JOIN crest.atomic_finance_groups receipt_group ON receipt_group.business_id=e.business_id AND receipt_group.id=e.group_id
   LEFT JOIN crest.journal_lines line ON line.business_id=a.business_id AND line.allocation_event_id=a.id
   WHERE x.position<>x.ordinal OR x.first_cent::numeric<>x.prior+1 OR x.last_cent>root.cents
    OR CASE WHEN x.id=held.parent_partition_id THEN a.id IS NOT NULL OR x.last_cent<>root.cents
       OR held.original_cents<>x.last_cent-x.first_cent+1
      WHEN x.id=tip_lot.parent_partition_id THEN a.id IS NOT NULL
       OR x.last_cent<>root.cents-coalesce(held.original_cents,0)
      ELSE (a.event_id,a.cents,r.customer_id) IS DISTINCT FROM (e.id,x.last_cent-x.first_cent+1,p.customer_id)
    OR i.issued_on>p.actual_on OR original_group.id IS NULL OR receipt_group.id IS NULL
    OR original_group.commit_sequence>=receipt_group.commit_sequence
    OR (line.entry_id,line.account_id,line.receivable_id,line.credit_cents) IS DISTINCT FROM (journal,r.account_id,r.id,a.cents)
    OR NOT crest_private.receivable_has_nonnegative_history(r.business_id,r.id,r.original_cents) END)
  OR (SELECT max(x.last_cent) FROM crest.funding_partitions x WHERE x.business_id=e.business_id AND x.origin_id=root.id)<>root.cents
  OR EXISTS(SELECT FROM crest.allocation_events a JOIN crest.funding_partitions x
    ON x.business_id=a.business_id AND x.id=a.partition_id WHERE a.business_id=e.business_id AND a.event_id=e.id AND x.origin_id<>root.id)
  OR NOT EXISTS(SELECT FROM crest.journal_lines line WHERE line.business_id=e.business_id AND line.entry_id=journal
    AND line.money_movement_id=movement.id AND line.account_id=movement.account_id AND line.debit_cents=movement.signed_cents)
  OR (SELECT count(*) FROM crest.journal_lines line WHERE line.business_id=e.business_id AND line.entry_id=journal)
   <>1+(held.id IS NOT NULL)::int+coalesce((tip.net_cents>0)::int,0)+coalesce((tip.tax_cents>0)::int,0)+(SELECT count(*) FROM crest.allocation_events a WHERE a.business_id=e.business_id AND a.event_id=e.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_APPLICATION_EFFECT_REQUIRED';END IF;
 SELECT o.result INTO STRICT operation_result FROM crest_private.operations o
 WHERE o.business_id=p.business_id AND o.operation_id=p.operation_id AND o.actor_id=p.created_by;
 SELECT jsonb_agg(jsonb_build_object('id',a.id,'receivableId',a.receivable_id,
  'fundingPartitionId',x.id,'cents',a.cents::text) ORDER BY x.position) INTO expected_applications
 FROM crest.allocation_events a JOIN crest.funding_partitions x ON x.business_id=a.business_id AND x.id=a.partition_id
 WHERE a.business_id=e.business_id AND a.event_id=e.id;
 expected_receipt:=jsonb_build_object('schemaVersion',1,'businessId',p.business_id,'paymentId',p.id,'eventId',e.id,
  'customerId',p.customer_id,'channelVersionId',p.channel_version_id,'accountId',p.account_id,'actualOn',to_char(p.actual_on,'YYYY-MM-DD'),
  'grossCents',p.gross_cents::text,'fundingOriginId',root.id,'moneyMovementId',movement.id,'externalEvidenceId',movement.evidence_id,
  'applications',coalesce(expected_applications,'[]'::jsonb));
 IF held.id IS NOT NULL THEN
  IF NOT EXISTS(SELECT FROM crest.funding_partitions x WHERE (x.business_id,x.id,x.origin_id)=(e.business_id,held.parent_partition_id,root.id))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_APPLICATION_EFFECT_REQUIRED';END IF;
  expected_receipt:=expected_receipt||jsonb_build_object('schemaVersion',2,'heldFunds',jsonb_build_object(
   'lotId',held.id,'fundingPartitionId',held.parent_partition_id,'mappingId',held.mapping_id,'cents',held.original_cents::text));
 END IF;
 IF tip_lot.id IS NOT NULL THEN
  expected_receipt:=expected_receipt||jsonb_build_object('schemaVersion',3,'heldFunds',expected_receipt->'heldFunds',
   'tip',crest_private.direct_receipt_tip_snapshot(tip,tip_lot));
 END IF;
 IF operation_result IS DISTINCT FROM expected_receipt THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_SOURCE_REQUIRED';
 END IF;
END $verify$;

CREATE OR REPLACE FUNCTION crest_private.verify_direct_receipt_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source_event uuid;
BEGIN
 CASE TG_TABLE_NAME
  WHEN 'payments' THEN SELECT id INTO source_event FROM crest.financial_events WHERE business_id=NEW.business_id AND payment_id=NEW.id;
  WHEN 'external_money_evidence' THEN SELECT event_id INTO source_event FROM crest.money_movements WHERE business_id=NEW.business_id AND evidence_id=NEW.id;
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

CREATE OR REPLACE FUNCTION crest_private.verify_fictional_unapplication_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE source uuid; event_id uuid;
BEGIN
 IF TG_TABLE_NAME='allocation_unapplications' THEN
  source:=NEW.id;
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

RESET ROLE;
-- END REVIEWED planning/proposals/finance-direct-receipt-tip.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-direct-receipt-tip-lineage.sql
-- The P03 tip uses the original tip ranges and existing consumption exclusions.
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.verify_fictional_tip_realization_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE event_id uuid; source_template text;
BEGIN
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
 IF e.template<>'P10' OR e.event_sequence<>1 OR original.template NOT IN('P03','P06') OR original.event_sequence<>1
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
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
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
 SELECT * INTO original FROM crest.financial_events WHERE business_id=requested_business AND tip_realization_id=t.id AND template IN('P03','P06');
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
  SELECT tip.id,event.id AS event_id,event.effective_on,tip.inclusive_cents,remaining.cents AS remaining
  FROM crest.tip_realizations tip
  JOIN crest.customer_fund_lots lot ON lot.business_id=tip.business_id AND lot.id=tip.fund_lot_id
  JOIN crest.financial_events event ON event.business_id=tip.business_id AND event.tip_realization_id=tip.id AND event.template IN('P03','P06')
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
  JOIN crest.financial_events realized ON realized.business_id=tip.business_id AND realized.tip_realization_id=tip.id
   AND realized.template IN('P03','P06') AND realized.effective_on<=reviewed_on
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
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
SET LOCAL ROLE crest_schema_owner;
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
 SELECT e.id,t.first_cent+(requested_first-1),t.first_cent+(requested_last-1),NULL::uuid,NULL::uuid,
  slices.net_cents,slices.tax_cents,t.revenue_account_id,t.revenue_mapping_id,t.tax_account_id
 FROM root
 JOIN crest.customer_fund_lots l ON (l.business_id,l.origin_id,l.customer_id)=(requested_business,root.id,root.customer_id)
 JOIN crest.tip_realizations t ON (t.business_id,t.fund_lot_id)=(l.business_id,l.id)
 JOIN crest.financial_events e ON (e.business_id,e.tip_realization_id)=(t.business_id,t.id) AND e.template IN('P03','P06')
 CROSS JOIN LATERAL crest_private.original_tip_return_components(t.inclusive_cents,t.net_cents,requested_first,requested_last) slices
 WHERE component_kind='tip' AND t.id=requested_source;
$source$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE OR REPLACE FUNCTION crest_commands.apply_fictional_customer_funds(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_application uuid,requested_fund_lot uuid,requested_receivable uuid,
 requested_customer uuid,reviewed_on date,requested_first_cent bigint,requested_last_cent bigint,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; l crest.customer_fund_lots; source_lot record;
 held crest.financial_events; issued crest.financial_events; r crest.receivable_items; a crest.customer_fund_applications;
 e crest.financial_events; period record; claimed uuid; group_id uuid; journal_id uuid; cents bigint; outstanding numeric; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_application IS NULL OR requested_fund_lot IS NULL OR requested_receivable IS NULL
  OR requested_customer IS NULL OR reviewed_on IS NULL OR reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31'
  OR requested_first_cent IS NULL OR requested_last_cent IS NULL OR requested_first_cent<1 OR requested_last_cent<requested_first_cent
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason)
  OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FUND_APPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.funds.apply',1,requested_business,expected_actor,expected_epoch,
  requested_application,requested_fund_lot,requested_receivable,requested_customer,reviewed_on,requested_first_cent::text,
  requested_last_cent::text,review_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.funds.apply',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.funds.apply' AND o.state='committed';
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
 IF NOT FOUND OR l.receipt_tip_event_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_LOT_REQUIRED';END IF;
 SELECT * INTO r FROM crest.receivable_items WHERE business_id=requested_business AND id=requested_receivable AND customer_id=requested_customer;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_RECEIVABLE_REQUIRED';END IF;
 IF NOT crest_private.fund_application_controls_active(l,r) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_CONTROL_ACCOUNTS_REQUIRED';
 END IF;
 SELECT * INTO STRICT source_lot FROM crest_private.customer_fund_lot_origin(l);
 SELECT * INTO STRICT held FROM crest.financial_events WHERE business_id=requested_business AND id=source_lot.event_id;
 SELECT * INTO STRICT issued FROM crest.financial_events WHERE business_id=requested_business AND invoice_id=r.invoice_id;
 IF reviewed_on<greatest(held.effective_on,issued.effective_on) OR reviewed_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_DATE_REQUIRED';
 END IF;
 IF requested_first_cent<source_lot.first_cent OR requested_last_cent>source_lot.last_cent OR EXISTS(
   SELECT FROM crest.fund_lot_range_consumptions taken WHERE taken.business_id=requested_business AND taken.fund_lot_id=l.id
    AND numrange(taken.first_cent::numeric,taken.last_cent::numeric,'[]') &&
     numrange(requested_first_cent::numeric,requested_last_cent::numeric,'[]')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_RANGE_UNAVAILABLE';
 END IF;
 IF EXISTS(SELECT FROM crest.customer_fund_applications x WHERE x.business_id=requested_business AND x.id=requested_application) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='FUND_APPLICATION_ALREADY_RECORDED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,reviewed_on,auth->>'timezone');
 cents:=requested_last_cent-requested_first_cent+1;
 SELECT min(remaining) INTO outstanding FROM (
  SELECT r.original_cents+coalesce(sum(d.signed_cents) FILTER(WHERE d.effective_on<=reviewed_on),0) AS remaining
  FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
  UNION ALL
  SELECT r.original_cents+dated.running FROM (
   SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
   FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
  ) dated WHERE dated.effective_on>reviewed_on
 ) capacity;
 IF cents>outstanding THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_EXCEEDS_BALANCE';END IF;

 INSERT INTO crest.customer_fund_applications(id,business_id,fund_lot_id,receivable_id,first_cent,last_cent,reason,operation_id,created_by)
 VALUES(requested_application,requested_business,l.id,r.id,requested_first_cent,requested_last_cent,review_reason,requested_operation,expected_actor)
 RETURNING * INTO a;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,fund_application_id,period_id,period_generation,effective_on,time_zone,
  template,template_version)
 VALUES(requested_business,group_id,1,a.id,period.period_id,period.generation,reviewed_on,auth->>'timezone','P04',1) RETURNING * INTO e;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,fund_application_id,fund_lot_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,a.id,l.id,l.account_id,l.mapping_id,'apply_funds',cents,0);
 INSERT INTO crest.journal_lines(business_id,entry_id,fund_application_id,receivable_id,account_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,a.id,r.id,r.account_id,'apply_ar',0,cents);
 receipt:=crest_private.fictional_fund_application_receipt(a,l,e,r);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'customer_fund_applications',a.id,1,'apply',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=(receipt->>'schemaVersion')::integer,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-direct-receipt-tip-lineage.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-direct-receipt-tip-options.sql
-- Owner reviews the dated authority before recording a direct tip.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(archived_at) ON crest.customers TO crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,actual_on date,requested_jurisdiction text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; open_period boolean; funds_mapping uuid; funds_account uuid; jurisdictions jsonb; selected jsonb;
BEGIN
 IF requested_customer IS NULL OR actual_on IS NULL OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
  OR requested_jurisdiction IS NOT NULL AND (char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
   OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='DIRECT_RECEIPT_TIP_INPUT_REQUIRED';END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DIRECT_RECEIPT_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.customers c WHERE (c.business_id,c.id)=(requested_business,requested_customer) AND c.archived_at IS NULL)
 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h WHERE (h.business_id,h.period_id)=(period.business_id,period.id)
   ORDER BY h.generation DESC LIMIT 1) latest ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND actual_on BETWEEN period.starts_on AND period.through_on AND latest.state IS DISTINCT FROM 'locked') INTO open_period;
 funds_mapping:=crest_private.unapplication_funds_mapping(requested_business,actual_on);
 SELECT m.account_id INTO funds_account FROM crest.account_mapping_versions m WHERE (m.business_id,m.id)=(requested_business,funds_mapping);
 SELECT coalesce(jsonb_agg(x.jurisdiction ORDER BY x.jurisdiction COLLATE "C"),'[]'::jsonb) INTO jurisdictions
 FROM (SELECT scope.jurisdiction FROM (
  SELECT DISTINCT p.jurisdiction FROM crest.tax_profiles p WHERE p.business_id=requested_business AND p.applicability='tip'
   AND p.service_id IS NULL AND p.effective_from<=actual_on
 ) scope WHERE EXISTS(SELECT FROM crest_private.fictional_tip_posting_basis(requested_business,funds_account,funds_mapping,scope.jurisdiction,actual_on))
 ORDER BY scope.jurisdiction COLLATE "C" LIMIT 181) x;
 IF jsonb_array_length(jurisdictions)>180 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='DIRECT_RECEIPT_TIP_OPTIONS_LIMIT';END IF;
 IF requested_jurisdiction IS NOT NULL THEN
  SELECT jsonb_build_object('jurisdiction',requested_jurisdiction,'treatment',basis.treatment,'rate',basis.rate::text,
   'taxProfileId',basis.profile_id,'revenueMappingId',basis.revenue_mapping_id,'taxMappingId',basis.tax_mapping_id)
  INTO selected FROM crest_private.fictional_tip_posting_basis(requested_business,funds_account,funds_mapping,requested_jurisdiction,actual_on) basis;
 END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'fundsMappingId',funds_mapping,
  'jurisdictions',jurisdictions,'selected',selected);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_direct_fictional_receipt_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date,text)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-direct-receipt-tip-options.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-direct-receipt-tip-report-control.sql
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.fictional_journal_body_v8(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
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
   e.effective_on,e.event_sequence,e.template,e.invoice_id,e.payment_id,e.posted_expense_id,e.unapplication_id,e.fund_application_id,CASE WHEN e.template='P03' THEN l.tip_realization_id ELSE e.tip_realization_id END AS tip_realization_id,e.invoice_credit_id,e.service_refund_id,e.excess_return_id,e.tip_return_id,l.fund_lot_id,g.commit_sequence,g.operation_id,
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
RESET ROLE;

-- An explicit P03 tip anchor has a full range claim and no ordinary funds
-- journal lines. A later returned refund may legitimately create only the
-- separately reconciled refund-due liability against that anchor.
SET LOCAL ROLE crest_schema_owner;
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
  AND (e.template_version NOT IN(1,2) OR e.template NOT IN('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'))) THEN
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
   JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id OR e.id=l.receipt_tip_event_id)
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
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_journal_v11(
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
  crest_private.fictional_journal_body_v10(requested_business,selected,requested_account,after_line,page_limit)||jsonb_build_object('schemaVersion',11) INTO result;
 RETURN result;
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_journal_v11(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_journal_v11(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-direct-receipt-tip-report-control.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-direct-receipt-tip-source.sql
-- Held v13 source projection. Receipt anchors and tip dimensions are
-- additive to older source projections. All reads remain caller-scoped.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(receipt_tip_event_id) ON crest.customer_fund_lots TO crest_receipt_export_owner;
GRANT SELECT(tip_realization_id) ON crest.financial_events,crest.journal_lines TO crest_receipt_export_owner;
CREATE POLICY receipt_tip_anchor_source_export ON crest.customer_fund_lots FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND receipt_tip_event_id IS NOT NULL);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_receipt_export_owner;
SET LOCAL ROLE crest_receipt_export_owner;
CREATE FUNCTION crest_commands.direct_receipt_tip_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE token text; anchors jsonb; entries jsonb;
BEGIN
 token:=crest_private.receipt_source_token(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO anchors FROM (
  SELECT l.id,l.business_id,l.unapplication_id,l.origin_id,l.parent_partition_id,l.customer_id,l.account_id,l.mapping_id,
   l.original_cents::text,l.receipt_event_id,l.receipt_tip_event_id
  FROM crest.customer_fund_lots l
  WHERE l.business_id=requested_business AND l.receipt_tip_event_id IS NOT NULL ORDER BY l.id LIMIT 1001
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) INTO entries FROM (
  SELECT l.id,j.event_id,l.tip_realization_id
  FROM crest.financial_events e
  JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
  JOIN crest.journal_lines l ON (l.business_id,l.entry_id,l.tip_realization_id)=(j.business_id,j.id,e.tip_realization_id)
  WHERE e.business_id=requested_business AND e.tip_realization_id IS NOT NULL ORDER BY l.id LIMIT 2001
 ) x;
 IF jsonb_array_length(anchors)>1000 OR jsonb_array_length(entries)>2000 OR octet_length(anchors::text)+octet_length(entries::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='DIRECT_RECEIPT_TIP_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',token,'anchors',anchors,'lines',entries);
END $snapshot$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_receipt_export_owner;
REVOKE ALL ON FUNCTION crest_commands.direct_receipt_tip_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.direct_receipt_tip_source_snapshot(uuid) TO crest_export;
SET LOCAL ROLE crest_schema_owner;
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
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-direct-receipt-tip-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-direct-receipt-tip-export-access.sql
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-direct-receipt-tip-export-access.sql
