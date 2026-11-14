SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.lookup_fictional_collection_failure_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_settlement uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE operation crest_private.operations; s crest.collection_failure_settlements; f crest.collection_failures; e crest.financial_events; m crest.money_movements; v crest.money_channel_versions;
 receipt jsonb; audit_reason text; audit_delta jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_settlement IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO operation FROM crest_private.operations WHERE business_id=requested_business AND operation_id=original_operation
  AND actor_id=expected_actor AND command_type IN('finance.collection_failure.recredit','finance.collection_failure.retire_recredit') AND state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF operation.command_type='finance.collection_failure.retire_recredit' THEN
  IF (operation.result->>'originalEpoch',operation.result->>'settlementId') IS DISTINCT FROM
   (original_epoch::text,original_settlement::text) THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
   AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='operations' AND entity_id=operation.id
   AND action='retire' AND entity_version=1;
  IF operation.result->>'reviewEpoch' IS DISTINCT FROM operation.recovery_epoch::text
   OR audit_reason IS DISTINCT FROM operation.result->>'reason'
   OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',operation.result)
   OR operation.payload_hash IS DISTINCT FROM encode(sha256(convert_to((operation.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',operation.result);
 END IF;
 SELECT * INTO STRICT s FROM crest.collection_failure_settlements WHERE business_id=requested_business AND operation_id=original_operation;
 IF (operation.recovery_epoch,s.id) IS DISTINCT FROM (original_epoch,original_settlement) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT e FROM crest.financial_events WHERE business_id=requested_business AND collection_failure_settlement_id=s.id;
 SELECT * INTO m FROM crest.money_movements WHERE business_id=requested_business AND event_id=e.id;
 SELECT * INTO STRICT v FROM crest.money_channel_versions WHERE business_id=requested_business AND id=s.channel_version_id;
 SELECT reason,delta INTO STRICT audit_reason,audit_delta FROM crest_private.audit_events WHERE business_id=requested_business
  AND operation_id=original_operation AND actor_id=expected_actor AND entity_kind='collection_failure_settlements' AND entity_id=s.id
  AND action='recredit' AND entity_version=1;
 SELECT * INTO STRICT f FROM crest.collection_failures WHERE (business_id,id)=(requested_business,s.failure_id);
 receipt:=crest_private.collection_settlement_receipt(s,f,e,m,v);
 IF operation.result IS DISTINCT FROM receipt OR audit_reason IS DISTINCT FROM s.reason
  OR audit_delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_collection_failure_recredit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_epoch uuid,original_operation uuid,original_settlement uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_collection_failure_recredit($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'settlementId',original_settlement,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.collection_failure.retire_recredit',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_collection_failure_recredit($1,$2,$3,$4,$5,$6,$7,$8,$10,$11,$12);
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
ALTER FUNCTION crest_commands.lookup_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.lookup_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.lookup_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_collection_failure_recredit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.collection_failure_grouped_available(requested_business uuid,requested_customer uuid,requested_failure uuid)
RETURNS TABLE(failure_id uuid,payment_id uuid,failed_on date,failure_cents bigint,component_id uuid,source_kind text,
 original_receivable_id uuid,ranges nummultirange)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $available$
 SELECT f.id,f.payment_id,f.effective_on,f.cents,c.id,crest_private.collection_failure_component_kind(c),basis.original_receivable_id,
  nummultirange(numrange(c.root_first_cent::numeric,c.root_last_cent::numeric+1,'[)'))
   - coalesce((SELECT range_agg(numrange(x.first_cent::numeric,x.last_cent::numeric+1,'[)'))
    FROM crest.collection_failure_recredit_claims x WHERE (x.business_id,x.failure_component_id)=(c.business_id,c.id)),'{}'::nummultirange)
 FROM crest.collection_failures f
 JOIN crest.payments p ON (p.business_id,p.id)=(f.business_id,f.payment_id)
 JOIN crest.collection_failure_components c ON (c.business_id,c.collection_failure_id)=(f.business_id,f.id)
 CROSS JOIN LATERAL crest_private.collection_settlement_component_basis(c.business_id,c.id) basis
 WHERE (f.business_id,f.kind,p.customer_id,basis.customer_id)=(requested_business,'settled_failure',requested_customer,requested_customer)
  AND (requested_failure IS NULL OR f.id=requested_failure);
$available$;
REVOKE ALL ON FUNCTION crest_private.collection_failure_grouped_available(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.collection_failure_grouped_available(uuid,uuid,uuid) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.list_fictional_collection_failure_recredits(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_customer uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE results jsonb; more boolean;
BEGIN
 IF requested_customer IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF NOT EXISTS(SELECT FROM crest.customers c WHERE (c.business_id,c.id)=(requested_business,requested_customer))
 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('failureId',a.failure_id,'originalPaymentId',a.payment_id,
  'failedOn',to_char(a.failed_on,'YYYY-MM-DD'),'cents',a.failure_cents::text,'availableCents',a.available::text)
  ORDER BY a.failed_on DESC,a.failure_id),'[]'::jsonb) INTO results FROM (
   SELECT s.failure_id,s.payment_id,s.failed_on,s.failure_cents,sum(upper(r.value)-lower(r.value)) AS available
   FROM crest_private.collection_failure_grouped_available(requested_business,requested_customer,NULL) s
   CROSS JOIN LATERAL unnest(s.ranges) r(value)
   GROUP BY s.failure_id,s.payment_id,s.failed_on,s.failure_cents ORDER BY s.failed_on DESC,s.failure_id LIMIT 51
  ) a;
 more:=jsonb_array_length(results)>50;
 IF more THEN results:=results-50;END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'hasMore',more,'failures',results);
END $read$;

CREATE FUNCTION crest_commands.read_fictional_collection_failure_recredit_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_failure uuid,actual_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE auth jsonb; zone text; f crest.collection_failures; components jsonb; channels jsonb; funds_mapping jsonb; open_period boolean;
BEGIN
 IF requested_customer IS NULL OR requested_failure IS NULL OR actual_on IS NULL
  OR actual_on<DATE '1900-01-01' OR actual_on>DATE '9999-12-31'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='COLLECTION_RECREDIT_INPUT_REQUIRED';END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF actual_on>(statement_timestamp() AT TIME ZONE zone)::date
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_DATE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT failure.* INTO f FROM crest.collection_failures failure JOIN crest.payments p
  ON (p.business_id,p.id)=(failure.business_id,failure.payment_id)
 WHERE (failure.business_id,failure.id,failure.kind,p.customer_id)=(requested_business,requested_failure,'settled_failure',requested_customer);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF actual_on<f.effective_on THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='COLLECTION_RECREDIT_DATE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('failureComponentId',s.component_id,'sourceKind',s.source_kind,'originalReceivableId',s.original_receivable_id,
  'originalInvoiceNumber',(SELECT invoice.invoice_number FROM crest.receivable_items item JOIN crest.invoices invoice
   ON (invoice.business_id,invoice.id)=(item.business_id,item.invoice_id) WHERE (item.business_id,item.id,item.customer_id)=
    (requested_business,s.original_receivable_id,requested_customer)),
  'receivableCapacityCents',CASE WHEN s.original_receivable_id IS NOT NULL THEN
   crest_private.collection_settlement_receivable_capacity(requested_business,s.original_receivable_id,actual_on,9223372036854775807)::text END,
  'availableRanges',ranges.value) ORDER BY s.component_id),'[]'::jsonb) INTO components
 FROM crest_private.collection_failure_grouped_available(requested_business,requested_customer,requested_failure) s
 CROSS JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('firstCent',lower(r.value)::text,'lastCent',(upper(r.value)-1)::text)
  ORDER BY lower(r.value)) AS value FROM (SELECT value FROM unnest(s.ranges) r(value) ORDER BY lower(value) LIMIT 181) r) ranges
 WHERE ranges.value IS NOT NULL;
 IF jsonb_array_length(components)=0 THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'version',v.version::text,'label',v.label,'kind',v.kind)
  ORDER BY v.label,v.id),'[]'::jsonb) INTO channels FROM (
   SELECT c.* FROM crest.money_channel_versions c WHERE c.business_id=requested_business
   AND c.id=crest_private.direct_receipt_channel(requested_business,c.channel_id,actual_on,zone) ORDER BY c.label,c.id LIMIT 181
  ) v;
 IF jsonb_array_length(components)>180 OR jsonb_array_length(channels)>180 OR EXISTS(SELECT FROM jsonb_array_elements(components) item
  WHERE jsonb_array_length(item->'availableRanges')>180)
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='COLLECTION_RECREDIT_OPTIONS_LIMIT';END IF;
 SELECT jsonb_build_object('mappingId',mapping.id,'accountId',mapping.account_id,'label',account.name) INTO funds_mapping
 FROM crest.account_mapping_versions mapping
 JOIN LATERAL (SELECT v.name FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(mapping.business_id,mapping.account_id)
  ORDER BY v.version DESC LIMIT 1) account ON true
 WHERE mapping.business_id=requested_business AND mapping.id=crest_private.unapplication_funds_mapping(requested_business,actual_on);
 SELECT EXISTS(SELECT FROM crest.accounting_periods period
  LEFT JOIN LATERAL(SELECT state FROM crest.accounting_period_locks h WHERE h.business_id=period.business_id AND h.period_id=period.id
   ORDER BY generation DESC LIMIT 1) active_lock ON true
  WHERE period.business_id=requested_business AND period.time_zone=zone
  AND actual_on BETWEEN period.starts_on AND period.through_on AND active_lock.state IS DISTINCT FROM 'locked') INTO open_period;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'failureId',f.id,'originalPaymentId',f.payment_id,'failedOn',to_char(f.effective_on,'YYYY-MM-DD'),
  'actualOn',to_char(actual_on,'YYYY-MM-DD'),'openPeriod',open_period,'fundsMapping',funds_mapping,'components',components,'channels',channels);
END $options$;

CREATE OR REPLACE FUNCTION crest_private.collection_failure_held_recredit_available(requested_business uuid,requested_customer uuid,requested_failure uuid)
RETURNS TABLE(failure_id uuid,payment_id uuid,failed_on date,failure_cents bigint,component_id uuid,previous_lot_id uuid,ranges nummultirange)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $available$
 SELECT f.id,f.payment_id,f.effective_on,f.cents,c.id,l.id,
  nummultirange(numrange(c.root_first_cent::numeric,c.root_last_cent::numeric+1,'[)'))
   - coalesce((SELECT range_agg(numrange(x.first_cent::numeric,x.last_cent::numeric+1,'[)'))
    FROM crest.collection_failure_recredit_claims x WHERE (x.business_id,x.failure_component_id)=(c.business_id,c.id)),'{}'::nummultirange)
 FROM crest.collection_failures f
 JOIN crest.payments p ON (p.business_id,p.id)=(f.business_id,f.payment_id)
 JOIN crest.collection_failure_components c ON (c.business_id,c.collection_failure_id)=(f.business_id,f.id)
 JOIN crest.customer_fund_lots l ON (l.business_id,l.id)=(c.business_id,c.fund_lot_id)
 WHERE (f.business_id,f.kind,p.customer_id,l.customer_id)=(requested_business,'settled_failure',requested_customer,requested_customer)
  AND l.collection_failure_recredit_event_id IS NULL AND (requested_failure IS NULL OR f.id=requested_failure);
$available$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_fictional_collection_failure_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_collection_failure_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_collection_failure_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.read_fictional_collection_failure_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_collection_failure_recredits(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.read_fictional_collection_failure_recredit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,date) TO crest_finance_preview;
