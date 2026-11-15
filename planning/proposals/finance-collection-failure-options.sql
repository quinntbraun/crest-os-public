SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_collection_failure_options(
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
  UNION ALL
  SELECT 'tip',tip.id,'Tip recorded '||to_char(realized.effective_on,'YYYY-MM-DD'),1,tip.inclusive_cents
  FROM lots lot
  JOIN crest.tip_realizations tip ON tip.business_id=requested_business AND tip.fund_lot_id=lot.id
  JOIN crest.financial_events realized ON realized.business_id=tip.business_id AND realized.tip_realization_id=tip.id
   AND realized.template='P06' AND realized.effective_on<=reviewed_on
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
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_collection_failure_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_collection_failure_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_collection_failure_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.list_fictional_collection_failure_payments(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $payments$
DECLARE payments jsonb;
BEGIN
 IF requested_customer IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_FAILURE_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('paymentId',p.id,'receivedOn',to_char(p.actual_on,'YYYY-MM-DD'),
  'cents',p.gross_cents::text,'channelLabel',p.label) ORDER BY p.actual_on DESC,p.created_at DESC,p.id),'[]'::jsonb)
 INTO payments FROM (
  SELECT p.id,p.actual_on,p.created_at,p.gross_cents,v.label
  FROM crest.payments p JOIN crest.money_channel_versions v ON v.business_id=p.business_id AND v.id=p.channel_version_id
  WHERE p.business_id=requested_business AND p.customer_id=requested_customer
  ORDER BY p.actual_on DESC,p.created_at DESC,p.id LIMIT 51
 ) p;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'hasMore',jsonb_array_length(payments)>50,'payments',CASE WHEN jsonb_array_length(payments)>50 THEN payments-50 ELSE payments END);
END $payments$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_fictional_collection_failure_payments(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_collection_failure_payments(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_collection_failure_payments(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_finance_preview;
