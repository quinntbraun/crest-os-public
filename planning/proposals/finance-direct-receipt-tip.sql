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
