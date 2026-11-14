SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_excess_return_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; lots jsonb; channels jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR actual_on IS NULL OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='EXCESS_RETURN_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EXCESS_RETURN_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);

 SELECT coalesce(jsonb_agg(jsonb_build_object('fundLotId',available.id,'originalPaymentId',available.payment_id,
  'receivedOn',to_char(available.received_on,'YYYY-MM-DD'),'availableRanges',available.ranges)
  ORDER BY available.received_on,available.id),'[]'::jsonb) INTO lots
 FROM (
  SELECT lot.id,source.payment_id,source.effective_on AS received_on,gaps.ranges
  FROM crest.customer_fund_lots lot
  JOIN crest.financial_events source ON source.business_id=lot.business_id AND source.id=lot.receipt_event_id
  JOIN crest.funding_partitions partition ON partition.business_id=lot.business_id AND partition.id=lot.parent_partition_id
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
    ORDER BY gap.first_cent),'[]'::jsonb) AS ranges
   FROM (
    SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
    FROM (
     SELECT lag(boundary.last_cent,1,partition.first_cent::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
      boundary.first_cent AS next_start
     FROM (
      SELECT used.first_cent::numeric,used.last_cent::numeric
      FROM crest.fund_lot_range_consumptions used WHERE used.business_id=lot.business_id AND used.fund_lot_id=lot.id
      UNION ALL SELECT partition.last_cent::numeric+1,NULL::numeric
     ) boundary
    ) spans WHERE spans.previous_end+1<spans.next_start ORDER BY spans.previous_end LIMIT 181
   ) gap
  ) gaps
  WHERE lot.business_id=requested_business AND lot.customer_id=requested_customer AND lot.unapplication_id IS NULL
   AND source.template='P03' AND source.effective_on<=actual_on AND jsonb_array_length(gaps.ranges)>0
  ORDER BY source.effective_on,lot.id LIMIT 181
 ) available;

 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,
  'label',v.label,'kind',v.kind) ORDER BY v.label,v.id),'[]'::jsonb) INTO channels
 FROM (
  SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,actual_on,zone)
  ORDER BY c.label,c.id LIMIT 181
 ) v;
 IF jsonb_array_length(lots)>180 OR jsonb_array_length(channels)>180 OR EXISTS(
  SELECT FROM jsonb_array_elements(lots) entry WHERE jsonb_array_length(entry->'availableRanges')>180
 ) THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='EXCESS_RETURN_OPTIONS_LIMIT';
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=period.business_id AND h.period_id=period.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND actual_on BETWEEN period.starts_on AND period.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'lots',lots,'channels',channels);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_excess_return_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_excess_return_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_excess_return_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) TO crest_finance_preview;
