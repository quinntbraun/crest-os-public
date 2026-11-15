SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_refund_transfer_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,adjustment_kind text,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE context jsonb; zone text; refunds jsonb; channels jsonb; open_period boolean; more boolean;
BEGIN
 IF requested_customer IS NULL OR adjustment_kind IS NULL OR adjustment_kind NOT IN('recredit','retry') OR actual_on IS NULL
  OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='REFUND_TRANSFER_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=context->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REFUND_TRANSFER_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH candidate AS (
  SELECT event.id,event.effective_on,source.original_event_id,source.template,gaps.ranges,prior_channel.label
  FROM crest.customer_fund_lots lot
  JOIN crest.financial_events event ON event.business_id=lot.business_id AND event.effective_on<=actual_on
  LEFT JOIN crest.service_credit_refunds service ON (service.business_id,service.id)=(event.business_id,event.service_refund_id)
  LEFT JOIN crest.excess_receipt_returns excess ON (excess.business_id,excess.id)=(event.business_id,event.excess_return_id)
  LEFT JOIN crest.tip_returns tip_return ON (tip_return.business_id,tip_return.id)=(event.business_id,event.tip_return_id)
  LEFT JOIN crest.tip_realizations tip ON (tip.business_id,tip.id)=(tip_return.business_id,tip_return.tip_realization_id)
  LEFT JOIN crest.refund_transfer_adjustments adjustment
    ON (adjustment.business_id,adjustment.id)=(event.business_id,event.refund_transfer_adjustment_id)
  JOIN crest.money_channel_versions prior_channel ON prior_channel.business_id=event.business_id
   AND prior_channel.id=coalesce(service.channel_version_id,excess.channel_version_id,tip_return.channel_version_id,adjustment.channel_version_id)
  CROSS JOIN LATERAL crest_private.refund_transfer_source(requested_business,event.id,adjustment_kind) source
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',lower(gap)::text,'lastCent',(upper(gap)-1)::text)
    ORDER BY lower(gap)),'[]'::jsonb) AS ranges
   FROM (
    SELECT span AS gap FROM unnest(
     (SELECT range_agg(original) FROM unnest(source.available) original)
     - coalesce((SELECT range_agg(numrange(r.first_cent::numeric,r.last_cent::numeric+1,'[)'))
       FROM crest.refund_transfer_adjustment_ranges r WHERE r.business_id=requested_business AND r.prior_event_id=event.id),
       '{}'::nummultirange)
    ) span ORDER BY lower(span) LIMIT 181
   ) bounded
  ) gaps
  WHERE lot.business_id=requested_business AND lot.customer_id=requested_customer
   AND lot.id=coalesce(service.fund_lot_id,excess.fund_lot_id,tip.fund_lot_id,adjustment.fund_lot_id)
   AND source.customer_id=requested_customer AND jsonb_array_length(gaps.ranges)>0
   AND (event.template_version=1 AND adjustment_kind='recredit' AND event.template IN('P08','P09','P10')
    OR event.template_version=2 AND (adjustment.kind,adjustment_kind) IN(('recredit','retry'),('retry','recredit')))
  ORDER BY event.effective_on DESC,event.id LIMIT 51
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('priorEventId',id,'originalEventId',original_event_id,
  'priorOn',to_char(effective_on,'YYYY-MM-DD'),'originalTemplate',template,'priorAccountLabel',label,'availableRanges',ranges)
  ORDER BY effective_on DESC,id),'[]'::jsonb) INTO refunds FROM candidate;
 more:=jsonb_array_length(refunds)>50;
 IF more THEN refunds:=refunds-50; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,'label',v.label,'kind',v.kind)
  ORDER BY v.label,v.id),'[]'::jsonb) INTO channels FROM (
  SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,actual_on,zone)
  ORDER BY c.label,c.id LIMIT 181
 ) v;
 IF jsonb_array_length(channels)>180 OR EXISTS(SELECT FROM jsonb_array_elements(refunds) item
   WHERE jsonb_array_length(item->'availableRanges')>180) THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='REFUND_TRANSFER_OPTIONS_LIMIT';
 END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT h.state FROM crest.accounting_period_locks h WHERE h.business_id=period.business_id
   AND h.period_id=period.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
   AND actual_on BETWEEN period.starts_on AND period.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,'kind',adjustment_kind,
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'hasMore',more,'refunds',refunds,'channels',channels);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_refund_transfer_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_refund_transfer_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_refund_transfer_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,date)
 TO crest_finance_preview;
