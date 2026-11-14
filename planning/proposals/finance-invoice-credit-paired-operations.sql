-- Held E08 single-release paired review and explicit absent retirement.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY paired_credit_retirement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit');
CREATE POLICY paired_credit_retirement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=actor_id
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit'
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY paired_credit_retirement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type ='finance.invoice.retire_paired_credit' AND state='committed');
CREATE POLICY paired_credit_retirement_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire'
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.invoice.retire_paired_credit' AND o.state='committed'));
CREATE POLICY paired_credit_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
   AND o.command_type='finance.invoice.retire_paired_credit' AND o.state='pending'));


CREATE FUNCTION crest_commands.retire_fictional_paired_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,original_operation uuid,original_epoch uuid,original_credit uuid,original_unapplication uuid,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; digest text;
BEGIN
 IF review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR
  review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_fictional_paired_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
 IF existing->>'state'<>'absent' THEN RETURN existing;END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',original_operation,
  'invoiceCreditId',original_credit,'unapplicationId',original_unapplication,'originalEpoch',original_epoch,'reviewEpoch',review_epoch,'reason',review_reason);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,original_operation,expected_actor,'finance.invoice.retire_paired_credit',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_fictional_paired_invoice_credit($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
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

CREATE FUNCTION crest_commands.read_fictional_paired_invoice_credit_options(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid,requested_allocation uuid,reviewed_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $options$
DECLARE credit jsonb; release jsonb; selected date; r crest.receivable_items; dated_ar numeric; returns_mapping uuid;
BEGIN
 IF requested_customer IS NULL OR requested_invoice IS NULL OR requested_allocation IS NULL
  OR (reviewed_on IS NOT NULL AND (reviewed_on<DATE '1900-01-01' OR reviewed_on>DATE '9999-12-31')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 credit:=crest_commands.read_fictional_invoice_credit_options($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12);
 IF credit->>'state'='absent' OR credit->>'receivableId' IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 selected:=(credit->>'effectiveOn')::date;
 SELECT r0.* INTO STRICT r FROM crest.receivable_items r0
 WHERE r0.business_id=requested_business AND r0.invoice_id=requested_invoice AND r0.customer_id=requested_customer;
 -- Check the selected allocation against the invoice before reading its date
 -- or details, including when both invoices belong to the same customer.
 IF NOT EXISTS(SELECT FROM crest.allocation_events a WHERE a.business_id=requested_business
  AND a.id=requested_allocation AND a.receivable_id=r.id) THEN RETURN jsonb_build_object('state','absent');END IF;
 release:=crest_commands.read_fictional_allocation_unapplication_options($1,$2,$3,$4,$5,$6,$7,$8,$9,$11,selected);
 IF release->>'state'='absent' THEN RETURN jsonb_build_object('state','absent');END IF;
 IF release->>'receivableId' IS DISTINCT FROM credit->>'receivableId'
  OR release->>'effectiveOn' IS DISTINCT FROM credit->>'effectiveOn'
  OR release->'openPeriod' IS DISTINCT FROM credit->'openPeriod' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_REVIEW_REQUIRED';
 END IF;
 SELECT r.original_cents+coalesce(sum(d.signed_cents),0) INTO dated_ar
 FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d WHERE d.effective_on<=selected;
 -- A fully settled invoice has no standalone credit capacity. Its paired
 -- review still needs the active returns mapping before any release is chosen.
 SELECT basis.returns_mapping_id INTO returns_mapping
 FROM crest.invoice_items i JOIN crest.financial_events e ON e.business_id=i.business_id AND e.invoice_id=i.invoice_id
 CROSS JOIN LATERAL crest_private.fictional_invoice_credit_basis(i,e,r,selected,0,0) basis
 WHERE i.business_id=requested_business AND i.invoice_id=requested_invoice AND i.total_cents>0
 ORDER BY i.position LIMIT 1;
 RETURN jsonb_build_object('state','review','schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,
  'invoiceId',requested_invoice,'allocationId',requested_allocation,'credit',credit,'release',release,
  'reviewedArCents',dated_ar::text,'returnsMappingId',returns_mapping,
  'chronologySupported',dated_ar=(credit->>'availableBalanceCents')::numeric);
END $options$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_paired_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,date) OWNER TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE OR REPLACE FUNCTION crest_commands.lookup_fictional_paired_invoice_credit(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,original_operation uuid,original_credit uuid,original_unapplication uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; retirement_audit jsonb; c crest.invoice_credits; u crest.allocation_unapplications; l crest.customer_fund_lots;
 r crest.receivable_items; credit_event crest.financial_events; release_event crest.financial_events; credit jsonb; release jsonb;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_credit IS NULL OR original_unapplication IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_CREDIT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT o.id,o.recovery_epoch,o.result,o.command_type,o.payload_hash,p.invoice_credit_id,p.unapplication_id INTO saved
 FROM crest_private.operations o LEFT JOIN crest.paired_invoice_credit_releases p
  ON p.business_id=o.business_id AND p.operation_id=o.operation_id AND p.actor_id=o.actor_id
 WHERE o.business_id=requested_business AND o.operation_id=original_operation AND o.actor_id=expected_actor
  AND o.command_type IN('finance.invoice.credit_paired','finance.invoice.retire_paired_credit') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.command_type='finance.invoice.retire_paired_credit' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'invoiceCreditId',saved.result->>'unapplicationId')
   IS DISTINCT FROM (original_epoch::text,original_credit::text,original_unapplication::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.delta INTO retirement_audit FROM crest_private.audit_events a
  WHERE a.business_id=requested_business AND a.operation_id=original_operation AND a.actor_id=expected_actor
   AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.action='retire' AND a.entity_version=1 AND a.reason=saved.result->>'reason';
  IF saved.invoice_credit_id IS NOT NULL OR saved.unapplication_id IS NOT NULL OR saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR retirement_audit IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object('actorId',expected_actor))::text,'UTF8')),'hex')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_RETIREMENT_AUDIT_REQUIRED';END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF saved.invoice_credit_id IS NULL OR saved.unapplication_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED';
 END IF;
 IF (saved.recovery_epoch,saved.invoice_credit_id,saved.unapplication_id) IS DISTINCT FROM (original_epoch,original_credit,original_unapplication) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT * INTO STRICT c FROM crest.invoice_credits WHERE business_id=requested_business AND id=original_credit;
 SELECT * INTO STRICT u FROM crest.allocation_unapplications WHERE business_id=requested_business AND id=original_unapplication;
 SELECT * INTO STRICT r FROM crest.receivable_items WHERE business_id=requested_business AND id=c.receivable_id;
 SELECT * INTO STRICT l FROM crest.customer_fund_lots WHERE business_id=requested_business AND unapplication_id=u.id;
 SELECT * INTO STRICT credit_event FROM crest.financial_events WHERE business_id=requested_business AND invoice_credit_id=c.id;
 SELECT * INTO STRICT release_event FROM crest.financial_events WHERE business_id=requested_business AND unapplication_id=u.id;
 credit:=crest_private.fictional_invoice_credit_receipt(c,credit_event,r);
 release:=crest_private.fictional_unapplication_receipt(u,l,release_event,r);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'credit',credit,'release',release)
  OR NOT EXISTS(SELECT FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.operation_id=original_operation
   AND a.actor_id=expected_actor AND a.entity_kind='invoice_credits' AND a.entity_id=c.id AND a.action='credit' AND a.reason=c.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',credit))
  OR NOT EXISTS(SELECT FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.operation_id=original_operation
   AND a.actor_id=expected_actor AND a.entity_kind='allocation_unapplications' AND a.entity_id=u.id AND a.action='unapply' AND a.reason=u.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',release))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PAIRED_INVOICE_CREDIT_SOURCE_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_paired_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_paired_invoice_credit(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_paired_invoice_credit_options(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,date) TO crest_finance_preview;
