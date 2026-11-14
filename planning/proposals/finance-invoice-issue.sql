-- Fictional P01/P02 issuance. Exposed only to the existing isolated finance
-- preview role, after review. Exempt items pin their original evidence.
SET LOCAL ROLE crest_schema_owner;

GRANT SELECT(business_id,id,display_name) ON crest.customers TO crest_finance_account_owner;
GRANT SELECT(work_location_snapshot) ON crest.jobs TO crest_finance_account_owner;
CREATE POLICY issue_invoice_customer ON crest.customers FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY issue_invoice_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.invoice.issue','finance.invoice.retire') AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY issue_invoice_complete ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.invoice.issue','finance.invoice.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.invoice.issue','finance.invoice.retire') AND state='committed');
CREATE POLICY retire_invoice_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.retire');
CREATE POLICY issue_invoice_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='invoices' AND action='issue' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY retire_invoice_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id
    AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
    AND o.command_type='finance.invoice.retire' AND o.state='pending'));

DO $grants$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['invoices','invoice_items','billing_consumptions','atomic_finance_groups','financial_events',
  'receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_finance_account_owner',name);
  EXECUTE format('CREATE POLICY invoice_issue_read ON crest.%I FOR SELECT TO crest_finance_account_owner
   USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY invoice_issue_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.invoice.issue'' AND o.state=''pending''))',name);
 END LOOP;
END $grants$;

CREATE FUNCTION crest_private.keep_issued_invoice_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $draft$
BEGIN
 IF EXISTS(SELECT FROM crest.invoices i WHERE (i.business_id,i.draft_id)=(NEW.business_id,NEW.draft_id)) THEN
  RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='INVOICE_DRAFT_REVISION_CONFLICT';
 END IF;
 RETURN NEW;
END $draft$;
CREATE TRIGGER invoice_draft_issued BEFORE INSERT ON crest.invoice_draft_revisions
 FOR EACH ROW EXECUTE FUNCTION crest_private.keep_issued_invoice_draft();
CREATE TRIGGER invoice_exemption_issued BEFORE INSERT ON crest.invoice_exemption_evidence
 FOR EACH ROW EXECUTE FUNCTION crest_private.keep_issued_invoice_draft();

CREATE FUNCTION crest_commands.prepare_reviewed_invoice_issue(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_draft uuid, expected_revision bigint, jurisdictions jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $prepare$
DECLARE review jsonb;
BEGIN
 review:=crest_commands.review_invoice_issue_accounts($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 RETURN review||jsonb_build_object('reviewDigest',encode(sha256(convert_to(review::text,'UTF8')),'hex'));
END $prepare$;

CREATE FUNCTION crest_commands.issue_reviewed_invoice(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, expected_epoch uuid, requested_operation uuid, requested_draft uuid,
 expected_revision bigint, jurisdictions jsonb, reviewed_digest text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $issue$
DECLARE
 claim uuid; digest text; saved record; draft crest.invoice_draft_revisions; review jsonb; tax jsonb; mappings jsonb;
 family uuid; zone text; issue_date date; due_date date; period record; number record;
 issued uuid:=gen_random_uuid(); group_id uuid; event_id uuid; entry_id uuid; receivable_id uuid;
 customer jsonb; location jsonb; total bigint; line record; item_id uuid; expected_line record; mapping jsonb; tax_movement_id uuid;
 zero_effect boolean; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_draft IS NULL OR expected_revision IS NULL OR expected_revision<1
  OR reviewed_digest IS NULL OR reviewed_digest !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(jurisdictions) IS DISTINCT FROM 'object' OR octet_length(jurisdictions::text)>160000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.invoice.issue',1,requested_business,expected_actor,
  expected_epoch,requested_draft,expected_revision,jurisdictions,reviewed_digest)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice.issue',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
   WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation) AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 SELECT d.* INTO draft FROM crest.invoice_draft_revisions d
  WHERE (d.business_id,d.draft_id)=(requested_business,requested_draft) ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND OR draft.state<>'draft' OR draft.revision<>expected_revision
  OR EXISTS(SELECT FROM crest.invoices i WHERE (i.business_id,i.draft_id)=(requested_business,requested_draft)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_DRAFT_REQUIRED';
 END IF;
 FOR family IN SELECT DISTINCT a.family_id FROM crest.agreements a
  JOIN jsonb_array_elements(draft.retained_lines) d(value) ON (d.value->>'agreementId')::uuid=a.id
  WHERE a.business_id=requested_business ORDER BY a.family_id LOOP
  PERFORM crest_private.lock_booking_family(requested_business,family);
 END LOOP;
 IF EXISTS(SELECT FROM crest.billing_consumptions c
  JOIN jsonb_array_elements(draft.retained_lines) d(value) ON (d.value->>'partitionId')::uuid=c.partition_id
  WHERE c.business_id=requested_business) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_SCOPE_ALREADY_CONSUMED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 review:=crest_commands.review_invoice_issue_accounts($1,$2,$3,$4,$5,$6,$7,$8,requested_draft,expected_revision,jurisdictions);
 tax:=review->'taxReview';
 mappings:=review->'accountReview';
 IF tax->>'state' IS DISTINCT FROM 'review' OR jsonb_typeof(mappings) IS DISTINCT FROM 'object'
  OR mappings->'missingFixedPurposes' IS DISTINCT FROM '[]'::jsonb
  OR mappings->'requiredTaxJurisdictions' IS DISTINCT FROM '[]'::jsonb
  OR EXISTS(SELECT FROM jsonb_array_elements(tax->'lines') t(value)
   WHERE t.value->>'treatment' NOT IN('non_taxable','inclusive_single','exempt')
    OR (t.value->>'treatment'='exempt' AND t.value->>'exemptionEvidenceId' IS NULL))
  OR reviewed_digest<>encode(sha256(convert_to(review::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_REVIEW_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 zone:=tax->>'timezone'; issue_date:=(tax->>'issueDate')::date; due_date:=(tax->>'dueOn')::date;
 IF (clock_timestamp() AT TIME ZONE zone)::date<>issue_date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_REVIEW_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,issue_date,zone);
 SELECT * INTO STRICT number FROM crest_private.reserve_issued_invoice_number(issued,expected_epoch);
 SELECT jsonb_build_object('schemaVersion',1,'id',c.id,'displayName',c.display_name),j.work_location_snapshot
 INTO STRICT customer,location FROM crest.jobs j JOIN crest.customers c ON (c.business_id,c.id)=(j.business_id,j.customer_id)
 WHERE (j.business_id,j.id,j.customer_id)=(requested_business,draft.job_id,draft.customer_id);
 SELECT sum((t.value->'components'->>'inclusiveCents')::bigint)::bigint,
  bool_and((t.value->'components'->>'grossNetCents')::bigint=0
   AND (t.value->'components'->>'inclusiveCents')::bigint=0) INTO total,zero_effect
 FROM jsonb_array_elements(tax->'lines') t(value);

 INSERT INTO crest.invoices(id,business_id,draft_id,draft_revision,job_id,customer_id,reservation_id,invoice_number,
  issued_on,due_on,time_zone,customer_snapshot,location_snapshot,total_cents,currency,created_by,operation_id)
 VALUES(issued,requested_business,requested_draft,expected_revision,draft.job_id,draft.customer_id,
  number.reservation_id,number.invoice_number,issue_date,due_date,zone,customer,location,total,'USD',expected_actor,requested_operation);
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,invoice_id,period_id,period_generation,effective_on,
  time_zone,template,template_version,zero_effect_reason)
 VALUES(requested_business,group_id,1,issued,period.period_id,period.generation,issue_date,zone,
  CASE WHEN total=0 THEN 'P02' ELSE 'P01' END,1,CASE WHEN zero_effect THEN 'literal_zero_charge' END) RETURNING id INTO event_id;
 IF total>0 THEN
  INSERT INTO crest.receivable_items(business_id,invoice_id,account_id,customer_id,original_cents,due_on)
  VALUES(requested_business,issued,(mappings->'fixedMappings'->'ar'->>'accountId')::uuid,draft.customer_id,total,due_date)
  RETURNING id INTO receivable_id;
 END IF;
 IF NOT zero_effect THEN
  INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1)
  RETURNING id INTO entry_id;
 END IF;
 FOR line IN SELECT d.source,d.position,t.value->'components' AS charge,(t.value->>'profileId')::uuid AS profile,
  t.value->>'jurisdiction' AS jurisdiction,(t.value->>'exemptionEvidenceId')::uuid AS exemption_evidence
  FROM jsonb_array_elements(draft.retained_lines) WITH ORDINALITY d(source,position)
  JOIN jsonb_array_elements(tax->'lines') t(value) ON t.value->>'outcomeId'=d.source->>'outcomeId'
  ORDER BY d.position LOOP
  INSERT INTO crest.invoice_items(business_id,invoice_id,position,outcome_id,completion_part_id,partition_id,agreement_id,
   entitlement_version_id,service_version_id,tax_profile_id,exemption_evidence_id,gross_inclusive_cents,discount_inclusive_cents,gross_net_cents,
   discount_net_cents,net_cents,tax_cents,total_cents,description,created_by,operation_id)
  VALUES(requested_business,issued,line.position,(line.source->>'outcomeId')::uuid,(line.source->>'completionPartId')::uuid,
   (line.source->>'partitionId')::uuid,(line.source->>'agreementId')::uuid,(line.source->>'entitlementVersionId')::uuid,
   (line.source->>'serviceVersionId')::uuid,line.profile,line.exemption_evidence,(line.charge->>'grossInclusiveCents')::bigint,
   (line.charge->>'discountInclusiveCents')::bigint,(line.charge->>'grossNetCents')::bigint,(line.charge->>'discountNetCents')::bigint,
   (line.charge->>'netCents')::bigint,(line.charge->>'taxCents')::bigint,(line.charge->>'inclusiveCents')::bigint,
   line.source->>'description',expected_actor,requested_operation) RETURNING id INTO item_id;
  INSERT INTO crest.billing_consumptions(business_id,invoice_item_id,partition_id,consumed_cents,created_by,operation_id)
  VALUES(requested_business,item_id,(line.source->>'partitionId')::uuid,(line.charge->>'inclusiveCents')::bigint,expected_actor,requested_operation);
  IF (line.charge->>'taxCents')::bigint>0 THEN
   mapping:=mappings->'taxMappings'->line.jurisdiction;
   INSERT INTO crest.invoice_tax_payable_movements(business_id,event_id,invoice_item_id,tax_profile_id,mapping_id,account_id,jurisdiction,cents)
   VALUES(requested_business,event_id,item_id,line.profile,(mapping->>'mappingId')::uuid,(mapping->>'accountId')::uuid,
    line.jurisdiction,(line.charge->>'taxCents')::bigint) RETURNING id INTO tax_movement_id;
   INSERT INTO crest.journal_lines(business_id,entry_id,invoice_item_id,account_id,tax_payable_movement_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,entry_id,item_id,(mapping->>'accountId')::uuid,tax_movement_id,'tax_payable',0,(line.charge->>'taxCents')::bigint);
  END IF;
  FOR expected_line IN SELECT * FROM (VALUES
   ('ar',receivable_id,(line.charge->>'inclusiveCents')::bigint,0::bigint),
   ('discount',NULL::uuid,(line.charge->>'discountNetCents')::bigint,0::bigint),
   ('service_revenue',NULL::uuid,0::bigint,(line.charge->>'grossNetCents')::bigint)
  ) p(purpose,ar_id,debit,credit) WHERE p.debit>0 OR p.credit>0 LOOP
   mapping:=mappings->'fixedMappings'->expected_line.purpose;
   INSERT INTO crest.journal_lines(business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,entry_id,item_id,expected_line.ar_id,(mapping->>'accountId')::uuid,(mapping->>'mappingId')::uuid,
    expected_line.purpose,expected_line.debit,expected_line.credit);
  END LOOP;
 END LOOP;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'invoiceId',issued,'invoiceNumber',number.invoice_number,
  'issuedOn',to_char(issue_date,'YYYY-MM-DD'),'dueOn',to_char(due_date,'YYYY-MM-DD'),'totalCents',total::text,
  'eventId',event_id,'receivableId',receivable_id,'draftId',requested_draft,'draftRevision',expected_revision::text);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(gen_random_uuid(),requested_business,requested_operation,expected_actor,expected_actor,'invoices',issued,1,'issue',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $issue$;

CREATE FUNCTION crest_commands.read_issued_invoice(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_draft uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE saved crest.invoices; lines jsonb;
BEGIN
 IF requested_draft IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT i.* INTO saved FROM crest.invoices i
 WHERE (i.business_id,i.draft_id)=(requested_business,requested_draft);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT jsonb_agg(jsonb_build_object('description',i.description,'inclusiveCents',i.total_cents::text,
  'grossInclusiveCents',i.gross_inclusive_cents::text,'discountInclusiveCents',i.discount_inclusive_cents::text,
  'netCents',i.net_cents::text,'taxCents',i.tax_cents::text)
  || CASE WHEN i.exemption_evidence_id IS NULL THEN '{}'::jsonb ELSE
   jsonb_build_object('exemptionEvidenceId',i.exemption_evidence_id) END ORDER BY i.position)
 INTO lines FROM crest.invoice_items i WHERE (i.business_id,i.invoice_id)=(requested_business,saved.id);
 RETURN jsonb_build_object('state','issued','schemaVersion',1,'businessId',saved.business_id,'invoiceId',saved.id,
  'invoiceNumber',saved.invoice_number,'draftId',saved.draft_id,'draftRevision',saved.draft_revision::text,
  'issuedOn',to_char(saved.issued_on,'YYYY-MM-DD'),'dueOn',to_char(saved.due_on,'YYYY-MM-DD'),
  'timezone',saved.time_zone,'currency',saved.currency,'totalCents',saved.total_cents::text,
  'customer',saved.customer_snapshot,'location',saved.location_snapshot,'lines',lines);
END $read$;

CREATE FUNCTION crest_commands.lookup_invoice_issue(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, expected_epoch uuid, requested_operation uuid, requested_draft uuid, expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; evidence record;
BEGIN
 IF expected_epoch IS NULL OR requested_operation IS NULL OR requested_draft IS NULL
  OR expected_revision IS NULL OR expected_revision<1 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.state)=(requested_business,requested_operation,'committed')
  AND o.command_type IN('finance.invoice.issue','finance.invoice.retire');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.command_type='finance.invoice.retire' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'draftId',saved.result->>'draftRevision')
   IS DISTINCT FROM (expected_epoch::text,requested_draft::text,expected_revision::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.reason,a.delta INTO STRICT evidence FROM crest_private.audit_events a
  WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.action)=
   (requested_business,requested_operation,expected_actor,'operations',saved.id,'retire')
   AND a.id::text=saved.result->>'auditEventId';
  IF saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object(
    'actorId',expected_actor,'reason',evidence.reason))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF saved.recovery_epoch<>expected_epoch OR saved.result->>'draftId' IS DISTINCT FROM requested_draft::text
  OR saved.result->>'draftRevision' IS DISTINCT FROM expected_revision::text THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_invoice_issue(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 review_epoch uuid, requested_operation uuid, original_epoch uuid, requested_draft uuid, expected_revision bigint, review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; audit uuid:=gen_random_uuid(); digest text;
BEGIN
 IF review_reason IS NULL OR review_reason<>btrim(review_reason) OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_invoice_issue($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
 IF existing->>'state'<>'absent' THEN RETURN existing; END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'operationId',requested_operation,'originalEpoch',original_epoch,
  'reviewEpoch',review_epoch,'draftId',requested_draft,'draftRevision',expected_revision::text,'auditEventId',audit);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor,'reason',review_reason))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_invoice_issue($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
  IF existing->>'state'<>'absent' THEN RETURN existing; END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(audit,requested_business,requested_operation,expected_actor,expected_actor,'operations',claim,1,'retire',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,requested_operation);
 RETURN jsonb_build_object('state','retired','receipt',receipt);
END $retire$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.lock_booking_family(uuid,uuid) TO crest_finance_account_owner;
ALTER FUNCTION crest_private.keep_issued_invoice_draft() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.keep_issued_invoice_draft() FROM PUBLIC;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.prepare_reviewed_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.issue_reviewed_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_issued_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.prepare_reviewed_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb),
 crest_commands.issue_reviewed_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text),
 crest_commands.read_issued_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.lookup_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.prepare_reviewed_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb),
 crest_commands.issue_reviewed_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text),
 crest_commands.read_issued_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.lookup_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 TO crest_finance_preview;
