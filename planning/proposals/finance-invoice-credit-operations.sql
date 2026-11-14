-- Held P07 original credit operation lookup and explicitly reviewed absent retirement.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY invoice_credit_retirement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_credit');
CREATE POLICY invoice_credit_retirement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_credit'
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY invoice_credit_retirement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_credit' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_credit' AND state='committed');
CREATE POLICY invoice_credit_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.invoice.retire_credit' AND o.state='committed'));
CREATE POLICY invoice_credit_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='invoice_credits' AND action='credit' AND entity_version=1);
CREATE FUNCTION crest_commands.lookup_fictional_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_credit uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; audit_delta jsonb; source_receipt jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_credit IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash,p.id AS invoice_credit_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.invoice_credits p ON p.business_id=o.business_id AND p.operation_id=o.operation_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.invoice.credit','finance.invoice.retire_credit') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.invoice.retire_credit' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'invoiceCreditId') IS DISTINCT FROM (original_epoch::text,original_credit::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.reason=saved.result->>'reason';
  IF saved.invoice_credit_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF (saved.recovery_epoch,saved.invoice_credit_id) IS DISTINCT FROM (original_epoch,original_credit) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT crest_private.fictional_invoice_credit_receipt(c,e,r) INTO source_receipt
 FROM crest.invoice_credits c
 JOIN crest.receivable_items r ON r.business_id=c.business_id AND r.id=c.receivable_id
 JOIN crest.financial_events e ON e.business_id=c.business_id AND e.invoice_credit_id=c.id AND e.template='P07'
 WHERE c.business_id=requested_business AND c.id=original_credit AND c.operation_id=original_operation AND c.created_by=expected_actor;
 SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
 WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
  AND a.entity_kind='invoice_credits' AND a.entity_id=original_credit AND a.action='credit'
  AND a.entity_version=1 AND a.reason=source_receipt->>'reason';
 IF source_receipt IS NULL OR saved.result IS DISTINCT FROM source_receipt
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',source_receipt) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_SOURCE_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',source_receipt);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY invoice_credit_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.invoice.retire_credit' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_credit uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'invoiceCreditId',original_credit,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.invoice.retire_credit',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.retire_fictional_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_invoice_credit_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; selected date; today date; original crest.invoices; issued crest.financial_events; r crest.receivable_items;
 balance numeric:=0; period_open boolean; items jsonb;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL
  OR (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 today:=(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date;
 selected:=coalesce(reviewed_on,today);
 IF selected>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO original FROM crest.invoices i WHERE i.business_id=requested_business AND i.id=requested_invoice
  AND i.customer_id=requested_customer;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT * INTO STRICT issued FROM crest.financial_events e WHERE e.business_id=requested_business AND e.invoice_id=original.id;
 IF selected<issued.effective_on THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_CREDIT_DATE_REQUIRED';END IF;
 SELECT * INTO r FROM crest.receivable_items item WHERE item.business_id=requested_business AND item.invoice_id=original.id;
 IF FOUND THEN
  SELECT min(remaining) INTO balance FROM (
   SELECT r.original_cents+coalesce(sum(d.signed_cents) FILTER(WHERE d.effective_on<=selected),0) AS remaining
   FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
   UNION ALL
   SELECT r.original_cents+dated.running FROM (
    SELECT d.effective_on,sum(d.signed_cents) OVER(ORDER BY d.effective_on,d.commit_sequence,d.event_sequence) AS running
    FROM crest_private.receivable_posted_deltas(requested_business,r.id) d
   ) dated WHERE dated.effective_on>selected
  ) capacity;
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods a
  LEFT JOIN LATERAL (SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=a.business_id AND h.period_id=a.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE a.business_id=requested_business AND a.time_zone=auth->>'timezone'
   AND selected BETWEEN a.starts_on AND a.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO period_open;

 SELECT coalesce(jsonb_agg(item.body ORDER BY item.position),'[]'::jsonb) INTO items
 FROM (
  SELECT i.position,jsonb_build_object('invoiceItemId',i.id,'description',i.description,
   'inclusiveCents',i.total_cents::text,'netCents',i.net_cents::text,'taxCents',i.tax_cents::text,
   'discountCents',i.discount_net_cents::text,
   'availableRange',CASE WHEN next_range.first_cent<=i.total_cents THEN
    jsonb_build_object('firstCent',next_range.first_cent::text,'lastCent',i.total_cents::text) END,
   'maximumStandaloneCents',capacity.maximum_cents::text,'returnsMappingId',basis.returns_mapping_id) AS body
  FROM crest.invoice_items i
  CROSS JOIN LATERAL (
   SELECT coalesce(max(c.last_cent),0)::numeric+1 AS first_cent FROM crest.invoice_credits c
   WHERE c.business_id=i.business_id AND c.invoice_item_id=i.id
  ) next_range
  CROSS JOIN LATERAL (
   SELECT greatest(0,least(balance,i.total_cents-next_range.first_cent+1)) AS maximum_cents
  ) capacity
  LEFT JOIN LATERAL crest_private.fictional_invoice_credit_components(i,
   CASE WHEN capacity.maximum_cents>0 THEN next_range.first_cent::bigint END,
   CASE WHEN capacity.maximum_cents>0 THEN (next_range.first_cent+capacity.maximum_cents-1)::bigint END) component ON true
  LEFT JOIN LATERAL crest_private.fictional_invoice_credit_basis(i,issued,r,selected,component.tax_cents,component.discount_cents) basis
   ON component.tax_cents IS NOT NULL AND r.id IS NOT NULL
  WHERE i.business_id=requested_business AND i.invoice_id=original.id
  ORDER BY i.position LIMIT 181
 ) item;
 IF jsonb_array_length(items)>180 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='INVOICE_CREDIT_OPTIONS_LIMIT';END IF;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'invoiceId',original.id,'receivableId',r.id,'issuedOn',to_char(issued.effective_on,'YYYY-MM-DD'),
  'effectiveOn',to_char(selected,'YYYY-MM-DD'),'openPeriod',period_open,'availableBalanceCents',balance::text,'lines',items);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 TO crest_finance_preview;
