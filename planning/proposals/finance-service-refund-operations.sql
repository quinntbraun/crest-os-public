-- Retain exact original and explicitly retired service-refund attempts.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY service_refund_retirement_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_service');
CREATE POLICY service_refund_retirement_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_service' AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY service_refund_retirement_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_service' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.refund.retire_service' AND state='committed');
CREATE POLICY service_refund_original_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND
  (entity_kind='service_credit_refunds' AND action='record_refund' OR entity_kind='operations' AND action='retire')
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.state='committed'
   AND (audit_events.entity_kind='service_credit_refunds' AND o.command_type='finance.refund.record_service'
    OR audit_events.entity_kind='operations' AND o.id=audit_events.entity_id AND o.command_type='finance.refund.retire_service')));
CREATE POLICY service_refund_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.refund.retire_service' AND o.state='pending'));

CREATE FUNCTION crest_commands.list_fictional_service_refund_credits(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE credits jsonb;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SERVICE_REFUND_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('pairedCreditId',row.credit,'creditedOn',to_char(row.credited_on,'YYYY-MM-DD'),
  'releasedCents',row.original_cents::text,'availableCents',row.available::text)
  ORDER BY row.credited_on,row.credit),'[]'::jsonb) INTO credits
 FROM (
  SELECT c.id AS credit,e.effective_on AS credited_on,l.original_cents,
   l.original_cents-coalesce((SELECT sum((taken.last_cent::numeric-taken.first_cent)+1)
    FROM crest.fund_lot_range_consumptions taken WHERE taken.business_id=l.business_id AND taken.fund_lot_id=l.id),0) AS available
  FROM crest.paired_invoice_credit_releases pair
  JOIN crest.invoice_credits c ON c.business_id=pair.business_id AND c.id=pair.invoice_credit_id
  JOIN crest.receivable_items r ON r.business_id=c.business_id AND r.id=c.receivable_id
  JOIN crest.customer_fund_lots l ON l.business_id=pair.business_id AND l.unapplication_id=pair.unapplication_id
  JOIN crest.financial_events e ON e.business_id=pair.business_id AND e.invoice_credit_id=pair.invoice_credit_id
  WHERE pair.business_id=requested_business AND r.invoice_id=requested_invoice AND l.customer_id=requested_customer
  ORDER BY e.effective_on,c.id LIMIT 181
 ) row;
 IF jsonb_array_length(credits)>180 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SERVICE_REFUND_OPTIONS_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'invoiceId',requested_invoice,
  'customerId',requested_customer,'credits',credits);
END $list$;

CREATE FUNCTION crest_commands.read_fictional_service_refund_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_credit uuid,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; today date; lot uuid; issued date; range_start bigint; range_end bigint;
 ranges jsonb; channels jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_credit IS NULL OR actual_on IS NULL
  OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SERVICE_REFUND_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 today:=(statement_timestamp() AT TIME ZONE zone)::date;
 IF actual_on>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SERVICE_REFUND_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT l.id,e.effective_on,u.first_cent,u.last_cent INTO lot,issued,range_start,range_end
 FROM crest.paired_invoice_credit_releases pair
 JOIN crest.customer_fund_lots l ON l.business_id=pair.business_id AND l.unapplication_id=pair.unapplication_id
 JOIN crest.allocation_unapplications u ON u.business_id=l.business_id AND u.id=l.unapplication_id
 JOIN crest.financial_events e ON e.business_id=pair.business_id AND e.invoice_credit_id=pair.invoice_credit_id
 WHERE pair.business_id=requested_business AND pair.invoice_credit_id=requested_credit AND l.customer_id=requested_customer;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF actual_on<issued THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SERVICE_REFUND_DATE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
  ORDER BY gap.first_cent),'[]'::jsonb) INTO ranges
 FROM (
  SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
  FROM (
   SELECT lag(boundary.last_cent,1,range_start::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
    boundary.first_cent AS next_start
   FROM (
    SELECT taken.first_cent::numeric,taken.last_cent::numeric
    FROM crest.fund_lot_range_consumptions taken WHERE taken.business_id=requested_business AND taken.fund_lot_id=lot
    UNION ALL SELECT range_end::numeric+1,NULL::numeric
   ) boundary
  ) spans WHERE spans.previous_end+1<spans.next_start ORDER BY spans.previous_end LIMIT 181
 ) gap;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,
  'label',v.label,'kind',v.kind) ORDER BY v.label,v.id),'[]'::jsonb) INTO channels
 FROM (
  SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,actual_on,zone)
  ORDER BY c.label,c.id LIMIT 181
 ) v;
 IF jsonb_array_length(ranges)>180 OR jsonb_array_length(channels)>180 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SERVICE_REFUND_OPTIONS_LIMIT';
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=period.business_id AND h.period_id=period.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND actual_on BETWEEN period.starts_on AND period.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,
  'customerId',requested_customer,'pairedCreditId',requested_credit,'fundLotId',lot,
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'availableRanges',ranges,'channels',channels);
END $options$;

CREATE FUNCTION crest_commands.lookup_fictional_service_refund(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_refund uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE original crest_private.operations; refund crest.service_credit_refunds; refund_event crest.financial_events;
 pair crest.paired_invoice_credit_releases; lot crest.customer_fund_lots; movement crest.money_movements;
 channel crest.money_channel_versions; receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_refund IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SERVICE_REFUND_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO original FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.refund.record_service','finance.refund.retire_service') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF original.command_type='finance.refund.retire_service' THEN
  IF (original.result->>'originalEpoch',original.result->>'serviceRefundId') IS DISTINCT FROM
   (original_epoch::text,original_refund::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=original_operation
   AND actor_id=expected_actor AND entity_kind='operations' AND entity_id=original.id AND action='retire' AND entity_version=1;
  IF original.result->>'reviewEpoch' IS DISTINCT FROM original.recovery_epoch::text
   OR audit_reason IS DISTINCT FROM original.result->>'reason'
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',original.result)
   OR original.payload_hash IS DISTINCT FROM encode(sha256(convert_to((original.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SERVICE_REFUND_RETIREMENT_AUDIT_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',original.result);
 END IF;
 SELECT * INTO STRICT refund FROM crest.service_credit_refunds WHERE business_id=requested_business AND operation_id=original_operation;
 IF (original.recovery_epoch,refund.id) IS DISTINCT FROM (original_epoch,original_refund) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT refund_event FROM crest.financial_events WHERE business_id=requested_business AND service_refund_id=refund.id;
 SELECT * INTO STRICT pair FROM crest.paired_invoice_credit_releases WHERE business_id=requested_business AND id=refund.pair_id;
 SELECT * INTO STRICT lot FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=refund.fund_lot_id;
 SELECT * INTO STRICT movement FROM crest.money_movements WHERE business_id=requested_business AND event_id=refund_event.id;
 SELECT * INTO STRICT channel FROM crest.money_channel_versions WHERE business_id=requested_business AND id=refund.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND entity_kind='service_credit_refunds' AND entity_id=refund.id AND action='record_refund' AND entity_version=1;
 receipt:=crest_private.fictional_service_refund_receipt(refund,pair,lot,refund_event,movement,channel);
 IF original.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM refund.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SERVICE_REFUND_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_service_refund(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_refund uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SERVICE_REFUND_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_service_refund($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'serviceRefundId',original_refund,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.refund.retire_service',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_service_refund($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.list_fictional_service_refund_credits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_service_refund_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_service_refund(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_service_refund(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_service_refund_credits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.read_fictional_service_refund_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date),
 crest_commands.lookup_fictional_service_refund(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_service_refund(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_service_refund_credits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.read_fictional_service_refund_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date),
 crest_commands.lookup_fictional_service_refund(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_service_refund(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;
