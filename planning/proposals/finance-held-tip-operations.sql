-- Held P06 exact operation lookup and explicitly reviewed absent retirement.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY tip_realization_retirement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.tip.retire_realization');
CREATE POLICY tip_realization_retirement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.tip.retire_realization'
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY tip_realization_retirement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.tip.retire_realization' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.tip.retire_realization' AND state='committed');
CREATE POLICY tip_realization_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.tip.retire_realization' AND o.state='committed'));
CREATE POLICY tip_realization_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='tip_realizations' AND action='realize' AND entity_version=1);
CREATE FUNCTION crest_commands.lookup_fictional_held_tip(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_tip uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; audit_delta jsonb; source_receipt jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_tip IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_REALIZATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash,p.id AS tip_realization_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.tip_realizations p ON p.business_id=o.business_id AND p.operation_id=o.operation_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.tip.realize','finance.tip.retire_realization') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.tip.retire_realization' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'tipRealizationId') IS DISTINCT FROM (original_epoch::text,original_tip::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.reason=saved.result->>'reason';
  IF saved.tip_realization_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF (saved.recovery_epoch,saved.tip_realization_id) IS DISTINCT FROM (original_epoch,original_tip) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT crest_private.fictional_tip_realization_receipt(t,l,e) INTO source_receipt
 FROM crest.tip_realizations t
 JOIN crest.customer_fund_lots l ON l.business_id=t.business_id AND l.id=t.fund_lot_id
 JOIN crest.financial_events e ON e.business_id=t.business_id AND e.tip_realization_id=t.id AND e.template='P06'
 WHERE t.business_id=requested_business AND t.id=original_tip AND t.operation_id=original_operation AND t.created_by=expected_actor;
 SELECT a.delta INTO audit_delta FROM crest_private.audit_events a
 WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
  AND a.entity_kind='tip_realizations' AND a.entity_id=original_tip AND a.action='realize'
  AND a.entity_version=1 AND a.reason=source_receipt->>'reason';
 IF source_receipt IS NULL OR saved.result IS DISTINCT FROM source_receipt
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',source_receipt) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_SOURCE_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',source_receipt);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY tip_realization_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.tip.retire_realization' AND o.state='pending'));

CREATE FUNCTION crest_commands.retire_fictional_held_tip(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_tip uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_REALIZATION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_held_tip($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'tipRealizationId',original_tip,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.tip.retire_realization',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_held_tip($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12);
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
ALTER FUNCTION crest_commands.retire_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_held_tip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_held_tip_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_jurisdiction text,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; selected date; today date; lots jsonb; jurisdictions jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL
  OR (requested_jurisdiction IS NOT NULL AND (char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
   OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]'))
  OR (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_REALIZATION_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 today:=(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date;
 selected:=coalesce(reviewed_on,today);
 IF selected>today THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_REALIZATION_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.customers c WHERE c.business_id=requested_business AND c.id=requested_customer) THEN
  RETURN jsonb_build_object('state','absent');
 END IF;
 SELECT coalesce(jsonb_agg(listed.jurisdiction ORDER BY listed.jurisdiction COLLATE "C"),'[]'::jsonb) INTO jurisdictions
 FROM (
  SELECT p.jurisdiction FROM (
   SELECT DISTINCT ON (v.jurisdiction COLLATE "C") v.jurisdiction,v.treatment,v.verification_evidence
   FROM crest.tax_profiles v WHERE v.business_id=requested_business AND v.applicability='tip' AND v.synthetic
    AND v.effective_from<=selected
   ORDER BY v.jurisdiction COLLATE "C",v.effective_from DESC
  ) p WHERE p.treatment IN('non_taxable','inclusive_single') AND p.verification_evidence IS NOT NULL
  ORDER BY p.jurisdiction COLLATE "C" LIMIT 181
 ) listed;
 SELECT coalesce(jsonb_agg(jsonb_build_object('fundLotId',available.id,'heldOn',to_char(available.effective_on,'YYYY-MM-DD'),
   'availableRanges',available.ranges,'basis',available.basis) ORDER BY available.effective_on,available.id),'[]'::jsonb) INTO lots
 FROM (
  SELECT l.id,e.effective_on,ranges.available_ranges AS ranges,
   CASE WHEN b.profile_id IS NOT NULL THEN jsonb_build_object('taxProfileId',b.profile_id,'treatment',b.treatment,'rate',b.rate::text,
    'revenueMappingId',b.revenue_mapping_id,'revenueAccountId',b.revenue_account_id,'taxMappingId',b.tax_mapping_id,
    'taxAccountId',b.tax_account_id) END AS basis
  FROM crest.customer_fund_lots l
  JOIN crest.allocation_unapplications u ON u.business_id=l.business_id AND u.id=l.unapplication_id
  JOIN crest.financial_events e ON e.business_id=u.business_id AND e.unapplication_id=u.id AND e.template='P05'
  LEFT JOIN LATERAL crest_private.fictional_tip_posting_basis(l,requested_jurisdiction,selected) b
   ON requested_jurisdiction IS NOT NULL
  CROSS JOIN LATERAL (
   SELECT coalesce(jsonb_agg(jsonb_build_object('firstCent',gap.first_cent::text,'lastCent',gap.last_cent::text)
     ORDER BY gap.first_cent),'[]'::jsonb) AS available_ranges
   FROM (
    SELECT spans.previous_end+1 AS first_cent,spans.next_start-1 AS last_cent
    FROM (
     SELECT lag(boundary.last_cent,1,u.first_cent::numeric-1) OVER(ORDER BY boundary.first_cent) AS previous_end,
      boundary.first_cent AS next_start
     FROM (
      SELECT a.first_cent::numeric,a.last_cent::numeric FROM crest.fund_lot_range_consumptions a
       WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id
      UNION ALL SELECT u.last_cent::numeric+1,NULL::numeric
     ) boundary
    ) spans WHERE spans.previous_end+1<spans.next_start ORDER BY spans.previous_end LIMIT 181
   ) gap
  ) ranges
  WHERE l.business_id=requested_business AND l.customer_id=requested_customer AND e.effective_on<=selected
   AND jsonb_array_length(ranges.available_ranges)>0
  ORDER BY e.effective_on,l.id LIMIT 181
 ) available;
 IF jsonb_array_length(jurisdictions)>180 OR jsonb_array_length(lots)>180 OR EXISTS(SELECT FROM jsonb_array_elements(lots) lot
   WHERE jsonb_array_length(lot->'availableRanges')>180)
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='TIP_REALIZATION_OPTIONS_LIMIT';END IF;
 SELECT EXISTS(SELECT FROM crest.accounting_periods a
  LEFT JOIN LATERAL (SELECT h.state FROM crest.accounting_period_locks h
   WHERE h.business_id=a.business_id AND h.period_id=a.id ORDER BY h.generation DESC LIMIT 1) last_lock ON true
  WHERE a.business_id=requested_business AND a.time_zone=auth->>'timezone'
   AND selected BETWEEN a.starts_on AND a.through_on AND last_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'jurisdiction',requested_jurisdiction,'effectiveOn',to_char(selected,'YYYY-MM-DD'),'openPeriod',open_period,
  'jurisdictions',jurisdictions,'lots',lots);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_held_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_held_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_held_tip_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,date)
 TO crest_finance_preview;
