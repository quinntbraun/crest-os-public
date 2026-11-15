SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_fictional_tip_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_return uuid,requested_tip uuid,requested_customer uuid,
 requested_channel uuid,expected_channel_version bigint,actual_on date,
 confirmation text,review_reason text,external_identity jsonb,verified_cents bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; digest text; saved record; claimed uuid;
 t crest.tip_realizations; l crest.customer_fund_lots; original crest.financial_events; v crest.money_channel_versions;
 s crest.tip_returns; e crest.financial_events; m crest.money_movements; period record;
 group_id uuid; journal_id uuid; evidence_id uuid; receipt jsonb; amounts record;
BEGIN
 IF requested_operation IS NULL OR requested_return IS NULL OR requested_tip IS NULL OR requested_customer IS NULL
  OR requested_channel IS NULL OR expected_channel_version IS NULL OR expected_channel_version<=0
  OR actual_on IS NULL OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31'
  OR verified_cents IS NULL OR verified_cents<1
  OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000 OR confirmation<>btrim(confirmation) OR confirmation~'[[:cntrl:]]'
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]'
  OR jsonb_typeof(external_identity) IS DISTINCT FROM 'object' OR octet_length(external_identity::text)>8192
  OR NOT external_identity?&ARRAY['namespace','id','rawReference'] OR external_identity-ARRAY['namespace','id','rawReference']<>'{}'::jsonb
  OR jsonb_typeof(external_identity->'namespace') IS DISTINCT FROM 'string'
  OR jsonb_typeof(external_identity->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(external_identity->'rawReference') IS DISTINCT FROM 'string'
  OR external_identity->>'namespace'!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
  OR char_length(external_identity->>'id') NOT BETWEEN 1 AND 200 OR external_identity->>'id'<>btrim(external_identity->>'id')
  OR external_identity->>'id'~'[[:cntrl:]]' OR char_length(external_identity->>'rawReference') NOT BETWEEN 1 AND 1000
  OR external_identity->>'rawReference'<>btrim(external_identity->>'rawReference') OR external_identity->>'rawReference'~'[[:cntrl:]]'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_RETURN_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.refund.record_tip',1,requested_business,expected_actor,expected_epoch,
  requested_return,requested_tip,requested_customer,requested_channel,expected_channel_version,actual_on,
  confirmation,review_reason,external_identity,verified_cents::text)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.refund.record_tip',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor
   AND o.command_type='finance.refund.record_tip' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);

 SELECT * INTO t FROM crest.tip_realizations WHERE business_id=requested_business AND id=requested_tip;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_ORIGINAL_REQUIRED';END IF;
 SELECT * INTO l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id AND customer_id=requested_customer;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_ORIGINAL_REQUIRED';END IF;
 SELECT * INTO original FROM crest.financial_events WHERE business_id=requested_business AND tip_realization_id=t.id AND template='P06';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_ORIGINAL_REQUIRED';END IF;
 IF actual_on<original.effective_on OR actual_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_DATE_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.tip_returns x WHERE x.business_id=requested_business AND x.id=requested_return) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='TIP_RETURN_ALREADY_RECORDED';
 END IF;

 -- Consume the lowest eligible relative offsets on the original tip selected by the owner.
 -- Prefix differences retain the original realization's frozen tax, including after gaps.
 WITH spans AS (
  SELECT lag(boundary.last_cent,1,0::numeric) OVER(ORDER BY boundary.first_cent)+1 AS first_cent,
   boundary.first_cent-1 AS last_cent
  FROM (
   SELECT x.first_cent::numeric,x.last_cent::numeric FROM crest.tip_realization_range_consumptions x
   WHERE x.business_id=requested_business AND x.tip_realization_id=t.id
   UNION ALL SELECT t.inclusive_cents::numeric+1,NULL::numeric
  ) boundary
 ), available AS (
  SELECT first_cent,last_cent,coalesce(sum(last_cent-first_cent+1) OVER(
   ORDER BY first_cent ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS used
  FROM spans WHERE last_cent>=first_cent
 ), bounded AS (
  SELECT first_cent::bigint AS first_cent,least(last_cent,first_cent+verified_cents-used-1)::bigint AS last_cent
  FROM available WHERE used<verified_cents ORDER BY first_cent LIMIT 181
 )
 SELECT jsonb_agg(jsonb_build_object('first_cent',x.first_cent,'last_cent',x.last_cent) ORDER BY x.first_cent) AS selected,
  sum(x.last_cent-x.first_cent+1) AS cents,sum(c.net_cents) AS net,sum(c.tax_cents) AS tax,count(*) AS ranges
 INTO amounts
 FROM bounded x CROSS JOIN LATERAL crest_private.original_tip_return_components(t.inclusive_cents,t.net_cents,x.first_cent,x.last_cent) c;
 IF amounts.cents IS DISTINCT FROM verified_cents::numeric OR amounts.ranges NOT BETWEEN 1 AND 180 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_AMOUNT_UNAVAILABLE';
 END IF;
 SELECT * INTO v FROM crest.money_channel_versions candidate WHERE candidate.business_id=requested_business
  AND candidate.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,auth->>'timezone');
 IF NOT FOUND OR v.version<>expected_channel_version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_VERIFIED_CHANNEL_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,auth->>'timezone');
 IF EXISTS(SELECT FROM crest.external_money_evidence ev WHERE ev.business_id=requested_business
  AND ev.provider_namespace=v.provider_namespace AND ev.external_account_id=v.account_id
  AND ev.id_namespace=external_identity->>'namespace' AND ev.external_id=external_identity->>'id')
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='TIP_RETURN_EXTERNAL_ID_ALREADY_RECORDED';END IF;

 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,v.provider_namespace,v.account_id,external_identity->>'namespace',external_identity->>'id',
  external_identity->>'rawReference','exact_case_v1',actual_on,-verified_cents,'USD') RETURNING id INTO evidence_id;
 INSERT INTO crest.tip_returns(id,business_id,tip_realization_id,channel_version_id,account_id,evidence_id,
  actual_on,cents,net_cents,tax_cents,confirmation,reason,operation_id,created_by)
 VALUES(requested_return,requested_business,t.id,v.id,v.account_id,evidence_id,actual_on,verified_cents,amounts.net,amounts.tax,
  confirmation,review_reason,requested_operation,expected_actor) RETURNING * INTO s;
 INSERT INTO crest.tip_realization_range_consumptions(business_id,tip_realization_id,tip_return_id,first_cent,last_cent)
 SELECT requested_business,t.id,s.id,x.first_cent,x.last_cent FROM jsonb_to_recordset(amounts.selected) AS x(first_cent bigint,last_cent bigint);
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,tip_return_id,period_id,period_generation,effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,s.id,period.period_id,period.generation,actual_on,auth->>'timezone','P10',1) RETURNING * INTO e;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,e.id,v.account_id,evidence_id,-s.cents) RETURNING * INTO m;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,e.id,1) RETURNING id INTO journal_id;
 IF s.net_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,tip_return_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,s.id,t.revenue_account_id,t.revenue_mapping_id,'tip_return_revenue',s.net_cents,0);
 END IF;
 IF s.tax_cents>0 THEN
  INSERT INTO crest.journal_lines(business_id,entry_id,tip_return_id,account_id,purpose,debit_cents,credit_cents)
  VALUES(requested_business,journal_id,s.id,t.tax_account_id,'tip_return_tax',s.tax_cents,0);
 END IF;
 INSERT INTO crest.journal_lines(business_id,entry_id,tip_return_id,account_id,money_movement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,s.id,v.account_id,m.id,'tip_return_money',0,s.cents);
 receipt:=crest_private.fictional_tip_return_receipt(s,t,original,l,e,m,v);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'tip_returns',s.id,1,'record_return',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.record_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,text,text,jsonb,bigint) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.record_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,text,text,jsonb,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,text,text,jsonb,bigint) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY tip_return_original_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='tip_returns' AND action='record_return'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.refund.record_tip' AND o.state='committed'));

CREATE FUNCTION crest_commands.lookup_fictional_tip_return(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_return uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE operation crest_private.operations; s crest.tip_returns; e crest.financial_events; original crest.financial_events;
 t crest.tip_realizations; l crest.customer_fund_lots; m crest.money_movements; v crest.money_channel_versions;
 receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_return IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='TIP_RETURN_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO operation FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.refund.record_tip','finance.refund.retire_tip') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF operation.command_type='finance.refund.retire_tip' THEN
  IF (operation.result->>'originalEpoch',operation.result->>'tipReturnId') IS DISTINCT FROM
   (original_epoch::text,original_return::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
   AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='operations' AND entity_id=operation.id
   AND action='retire' AND entity_version=1;
  IF operation.result->>'reviewEpoch' IS DISTINCT FROM operation.recovery_epoch::text
   OR audit_reason IS DISTINCT FROM operation.result->>'reason'
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',operation.result)
   OR operation.payload_hash IS DISTINCT FROM encode(sha256(convert_to((operation.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_RETIREMENT_AUDIT_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',operation.result);
 END IF;
 SELECT * INTO STRICT s FROM crest.tip_returns WHERE business_id=requested_business AND operation_id=original_operation;
 IF (operation.recovery_epoch,s.id) IS DISTINCT FROM (original_epoch,original_return) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND tip_return_id=s.id;
 SELECT * INTO STRICT original FROM crest.financial_events WHERE business_id=requested_business AND tip_realization_id=s.tip_realization_id;
 SELECT * INTO STRICT t FROM crest.tip_realizations WHERE business_id=requested_business AND id=s.tip_realization_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND id=t.fund_lot_id;
 SELECT * INTO STRICT m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
  AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='tip_returns' AND entity_id=s.id
  AND action='record_return' AND entity_version=1;
 receipt:=crest_private.fictional_tip_return_receipt(s,t,original,l,e,m,v);
 IF operation.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM s.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TIP_RETURN_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_tip_return(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;
