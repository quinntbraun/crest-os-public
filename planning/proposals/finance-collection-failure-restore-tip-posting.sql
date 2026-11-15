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
