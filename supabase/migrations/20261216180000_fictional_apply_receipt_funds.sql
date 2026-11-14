-- Extend the established P04 command to original P03 lots. Existing P05 receipts stay byte-exact.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.customer_fund_lot_origin(l crest.customer_fund_lots)
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
   AND o.customer_id=l.customer_id AND p.last_cent-p.first_cent+1=l.original_cents;
$origin$;
REVOKE ALL ON FUNCTION crest_private.customer_fund_lot_origin(crest.customer_fund_lots) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.customer_fund_lot_origin(crest.customer_fund_lots) TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE OR REPLACE FUNCTION crest_private.fictional_fund_application_receipt(a crest.customer_fund_applications,l crest.customer_fund_lots,
 e crest.financial_events,r crest.receivable_items)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',CASE WHEN l.receipt_event_id IS NULL THEN 1 ELSE 2 END,'businessId',a.business_id,'fundApplicationId',a.id,'operationId',a.operation_id,
  'eventId',e.id,'fundLotId',l.id,'unapplicationId',l.unapplication_id,'fundingOriginId',l.origin_id,
  'parentPartitionId',l.parent_partition_id,'customerId',l.customer_id,'receivableId',r.id,'invoiceId',r.invoice_id,
  'arAccountId',r.account_id,'fundsAccountId',l.account_id,'mappingId',l.mapping_id,
  'effectiveOn',to_char(e.effective_on,'YYYY-MM-DD'),'firstCent',a.first_cent::text,'lastCent',a.last_cent::text,
  'cents',(a.last_cent-a.first_cent+1)::text,'reason',a.reason)
 || CASE WHEN l.receipt_event_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('receiptEventId',l.receipt_event_id) END;
$snapshot$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
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
 IF e.template<>'P04' OR e.event_sequence<>1 OR held.template NOT IN('P03','P05') OR issued.template NOT IN('P01','P02')
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
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

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
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FUND_APPLICATION_LOT_REQUIRED';END IF;
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
  CROSS JOIN LATERAL crest_private.customer_fund_lot_origin(l) source_lot
  JOIN crest.financial_events e ON e.business_id=l.business_id AND e.id=source_lot.event_id
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
     ORDER BY gap.first_cent),'[]'::jsonb) AS available_ranges
   FROM (
    SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
    FROM (
     SELECT lag(boundary.last_cent,1,source_lot.first_cent::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
      boundary.first_cent AS next_start
     FROM (
      SELECT a.first_cent::numeric,a.last_cent::numeric FROM crest.fund_lot_range_consumptions a
       WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id
      UNION ALL SELECT source_lot.last_cent::numeric+1,NULL::numeric
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
