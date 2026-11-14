-- Held P05 exact operation lookup and explicitly reviewed absent retirement.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY unapplication_retirement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication');
CREATE POLICY unapplication_retirement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication'
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY unapplication_retirement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.allocation.retire_unapplication' AND state='committed');
CREATE POLICY unapplication_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.allocation.retire_unapplication' AND o.state='committed'));
CREATE FUNCTION crest_commands.lookup_fictional_allocation_unapplication(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_unapplication uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_unapplication IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash,p.id AS unapplication_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.allocation_unapplications p ON p.business_id=o.business_id AND p.operation_id=o.operation_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.allocation.unapply','finance.allocation.retire_unapplication') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.allocation.retire_unapplication' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'unapplicationId') IS DISTINCT FROM (original_epoch::text,original_unapplication::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.reason=saved.result->>'reason';
  IF saved.unapplication_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF (saved.recovery_epoch,saved.unapplication_id) IS DISTINCT FROM (original_epoch,original_unapplication) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY unapplication_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.allocation.retire_unapplication' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_allocation_unapplication(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_unapplication uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_allocation_unapplication($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'unapplicationId',original_unapplication,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.allocation.retire_unapplication',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_allocation_unapplication($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.retire_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_allocation_unapplication(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_allocation_unapplication_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_allocation uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; selected date; today date; source record; ranges jsonb; mapping uuid; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_allocation IS NULL OR
  (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 today:=(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date;
 selected:=coalesce(reviewed_on,today);
 IF selected>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT a.id,e.effective_on,e.payment_id,r.id AS receivable_id,i.invoice_number,
  p.first_cent,p.last_cent INTO source
 FROM crest.allocation_events a
 JOIN crest.financial_events e ON e.business_id=a.business_id AND e.id=a.event_id AND e.template='P03'
 JOIN crest.receivable_items r ON r.business_id=a.business_id AND r.id=a.receivable_id
 JOIN crest.invoices i ON i.business_id=r.business_id AND i.id=r.invoice_id
 JOIN crest.funding_partitions p ON p.business_id=a.business_id AND p.id=a.partition_id
 JOIN crest.funding_origins f ON f.business_id=p.business_id AND f.id=p.origin_id
 WHERE a.business_id=requested_business AND a.id=requested_allocation AND r.customer_id=requested_customer
  AND f.customer_id=requested_customer;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF selected<source.effective_on THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='UNAPPLICATION_DATE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
  ORDER BY gap.first_cent),'[]'::jsonb) INTO ranges
 FROM (
  SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
  FROM (
   SELECT lag(boundary.last_cent,1,source.first_cent::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
    boundary.first_cent AS next_start
   FROM (
    SELECT u.first_cent::numeric,u.last_cent::numeric FROM crest.allocation_unapplications u
    WHERE u.business_id=requested_business AND u.allocation_id=source.id
    UNION ALL SELECT source.last_cent::numeric+1,NULL::numeric
   ) boundary
  ) spans WHERE spans.previous_end+1<spans.next_start ORDER BY spans.previous_end LIMIT 181
 ) gap;
 IF jsonb_array_length(ranges)>180 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='UNAPPLICATION_OPTIONS_LIMIT';END IF;
 mapping:=crest_private.unapplication_funds_mapping(requested_business,selected);
 SELECT EXISTS(SELECT FROM crest.accounting_periods a
  LEFT JOIN LATERAL (SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=a.business_id AND h.period_id=a.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE a.business_id=requested_business AND a.time_zone=auth->>'timezone'
   AND selected>=a.starts_on AND selected<=a.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'allocationId',source.id,'paymentId',source.payment_id,'receivableId',source.receivable_id,'invoiceNumber',source.invoice_number,
  'paidOn',to_char(source.effective_on,'YYYY-MM-DD'),'effectiveOn',to_char(selected,'YYYY-MM-DD'),'fundsMappingId',mapping,
  'openPeriod',open_period,'availableRanges',ranges);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_allocation_unapplication_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_allocation_unapplication_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_allocation_unapplication_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.list_fictional_invoice_payment_allocations(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE rows jsonb;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNAPPLICATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.receivable_items r WHERE r.business_id=requested_business
   AND r.customer_id=requested_customer AND r.invoice_id=requested_invoice) THEN
  RETURN jsonb_build_object('state','absent');
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('allocationId',r.id,'paymentId',r.payment_id,
  'paidOn',to_char(r.effective_on,'YYYY-MM-DD'),'appliedCents',r.cents::text,'availableCents',r.available::text)
  ORDER BY r.effective_on DESC,r.id),'[]'::jsonb) INTO rows
 FROM (
  SELECT a.id,e.payment_id,e.effective_on,a.cents,a.cents-coalesce((SELECT sum(u.last_cent-u.first_cent+1)
   FROM crest.allocation_unapplications u WHERE u.business_id=a.business_id AND u.allocation_id=a.id),0) AS available
  FROM crest.receivable_items item
  JOIN crest.allocation_events a ON a.business_id=item.business_id AND a.receivable_id=item.id
  JOIN crest.financial_events e ON e.business_id=a.business_id AND e.id=a.event_id AND e.template='P03'
  WHERE item.business_id=requested_business AND item.customer_id=requested_customer AND item.invoice_id=requested_invoice
  ORDER BY e.effective_on DESC,a.id LIMIT 181
 ) r;
 IF jsonb_array_length(rows)>180 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='UNAPPLICATION_OPTIONS_LIMIT';END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,
  'customerId',requested_customer,'invoiceId',requested_invoice,'allocations',rows);
END $list$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_fictional_invoice_payment_allocations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_invoice_payment_allocations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_invoice_payment_allocations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_finance_preview;
