-- Registered command for the private nonposting opening AR evidence preview.
-- The caller owns the transaction. No ledger or receivable source is written.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.review_fictional_opening_receivables(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 expected_revision bigint,requested_customers uuid[]
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE current_worksheet crest.opening_worksheet_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF expected_revision IS NULL OR expected_revision<1 OR requested_customers IS NULL OR
  cardinality(requested_customers) NOT BETWEEN 1 AND 20 OR array_position(requested_customers,NULL) IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_RECEIVABLES_EVIDENCE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT * INTO current_worksheet FROM crest.opening_worksheet_revisions w
  WHERE w.business_id=requested_business ORDER BY w.revision DESC LIMIT 1;
 IF current_worksheet.revision IS DISTINCT FROM expected_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT';
 END IF;
 IF EXISTS (SELECT FROM unnest(requested_customers) AS selected(id) WHERE NOT EXISTS (
  SELECT FROM crest.customers c WHERE c.business_id=requested_business AND c.id=selected.id
 )) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_RECEIVABLES_CUSTOMER_REQUIRED';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'revision',current_worksheet.revision::text,
  'worksheetRevisionId',current_worksheet.id,'cutoverOn',to_char(current_worksheet.cutover_on,'YYYY-MM-DD'));
END $review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.review_fictional_opening_receivables(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid[])
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_opening_receivables(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_opening_receivables(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid[])
 TO crest_finance_preview;

-- Registered synthetic evidence storage. Each worksheet revision has an independent
-- append-only AR schedule. No journal, balance or production approval writes.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.opening_receivable_schedule_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 worksheet_revision_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 prior_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,
 audit_event_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=36000),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
 UNIQUE(business_id,worksheet_revision_id,revision),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,worksheet_revision_id) REFERENCES crest.opening_worksheet_revisions(business_id,id),
 FOREIGN KEY(business_id,worksheet_revision_id,prior_revision)
  REFERENCES crest.opening_receivable_schedule_revisions(business_id,worksheet_revision_id,revision),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE crest.opening_receivable_schedule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_receivable_schedule_revisions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_ar_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_receivable_schedule_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_receivable_schedule_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_receivable_schedule_revisions TO crest_finance_integrity_owner;
CREATE POLICY opening_ar_review ON crest.opening_receivable_schedule_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_ar_append ON crest.opening_receivable_schedule_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_ar_integrity ON crest.opening_receivable_schedule_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE POLICY opening_ar_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.opening_ar.save','finance.opening_ar.retire'));
CREATE POLICY opening_ar_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_ar.save','finance.opening_ar.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_ar_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_ar.save','finance.opening_ar.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_ar.save','finance.opening_ar.retire') AND state='committed');
CREATE POLICY opening_ar_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='opening_receivable_schedule_revisions' AND action='review' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_ar_retire_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.id=audit_events.entity_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.opening_ar.retire' AND o.state='pending'));
CREATE POLICY opening_ar_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.opening_ar.save');
CREATE POLICY opening_ar_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='opening_receivable_schedule_revisions');

CREATE FUNCTION crest_private.opening_ar_receipt(saved crest.opening_receivable_schedule_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',saved.business_id,'scheduleRevisionId',saved.id,
  'worksheetRevisionId',saved.worksheet_revision_id,'revision',saved.revision::text,'operationId',saved.operation_id,
  'auditEventId',saved.audit_event_id,'recordedBy',saved.recorded_by,
  'recordedAt',to_char(saved.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidenceSha256',saved.evidence_sha256,'evidence',saved.evidence)
$receipt$;

CREATE FUNCTION crest_private.check_opening_ar_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.opening_receivable_schedule_revisions;
BEGIN
 IF NEW.prior_revision IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM crest.opening_receivable_schedule_revisions p
  WHERE p.business_id=NEW.business_id AND p.worksheet_revision_id=NEW.worksheet_revision_id AND p.revision=NEW.prior_revision;
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.recorded_by
    AND o.command_type='finance.opening_ar.save' AND o.state='committed' AND o.result_schema_version=1
    AND o.result=crest_private.opening_ar_receipt(NEW)
    AND a.id=NEW.audit_event_id AND a.entity_id=NEW.id AND a.entity_version=NEW.revision
    AND a.entity_kind='opening_receivable_schedule_revisions' AND a.action='review' AND a.reason=NEW.evidence->>'reason'
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',
     CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_ar_receipt(previous) END,'after',o.result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_AR_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_ar_audited AFTER INSERT ON crest.opening_receivable_schedule_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_ar_history();

CREATE FUNCTION crest_private.opening_ar_date(input jsonb) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp SET datestyle='ISO, YMD' AS $date$
DECLARE stamp date;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'string' OR input#>>'{}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_DATE_REQUIRED'; END IF;
 stamp:=(input#>>'{}')::date;
 IF stamp NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' OR to_char(stamp,'YYYY-MM-DD')<>input#>>'{}'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_DATE_REQUIRED'; END IF;
 RETURN stamp;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_DATE_REQUIRED';
END $date$;

CREATE FUNCTION crest_private.opening_ar_positive_cents(input jsonb) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $cents$
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'string' OR input#>>'{}'!~'^[1-9][0-9]{0,17}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_AMOUNT_REQUIRED'; END IF;
 RETURN (input#>>'{}')::numeric;
END $cents$;

CREATE FUNCTION crest_private.opening_ar_evidence(business uuid,cutover date,lines jsonb,reason text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $evidence$
DECLARE item jsonb; adjustment jsonb; customer uuid; purchased date; applied date; remaining numeric;
 original numeric; reduced numeric; total numeric:=0; source jsonb; used jsonb:='[]'; allocated jsonb; reviewed jsonb:='[]';
 row_keys text[]:=ARRAY['customerId','legacyReference','scope','chargedOn','originalDueOn','originalCents','remainingCents',
  'chargeEvidence','reductions','taxEvidence'];
 reduction_keys text[]:=ARRAY['kind','amountCents','appliedOn','evidence'];
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR octet_length(lines::text)>24000
  OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED'; END IF;
 IF jsonb_array_length(lines) NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT item?&row_keys OR item-row_keys<>'{}'
   OR jsonb_typeof(item->'customerId') IS DISTINCT FROM 'string'
   OR item->>'customerId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR NOT crest_private.opening_worksheet_note(item->'legacyReference') OR length(item->>'legacyReference')>200
   OR NOT crest_private.opening_worksheet_note(item->'scope')
   OR NOT crest_private.opening_worksheet_document(item->'chargeEvidence')
   OR (item->'taxEvidence'<>'null' AND NOT crest_private.opening_worksheet_document(item->'taxEvidence'))
   OR jsonb_typeof(item->'reductions') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED'; END IF;
  customer:=(item->>'customerId')::uuid;
  IF NOT EXISTS(SELECT FROM crest.customers c WHERE c.business_id=business AND c.id=customer)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_RECEIVABLES_CUSTOMER_REQUIRED'; END IF;
  purchased:=crest_private.opening_ar_date(item->'chargedOn');
  PERFORM crest_private.opening_ar_date(item->'originalDueOn');
  IF purchased>=cutover THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_DATE_REQUIRED'; END IF;
  source:=jsonb_build_object('document',item->'chargeEvidence'->>'sha256','reference',item->>'legacyReference');
  IF used @> jsonb_build_array(source) THEN
   RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_AR_DUPLICATE_EVIDENCE';
  END IF;
  used:=used||jsonb_build_array(source);
  original:=crest_private.opening_ar_positive_cents(item->'originalCents');
  remaining:=crest_private.opening_ar_positive_cents(item->'remainingCents');
  reduced:=0;
  allocated:='[]';
  IF jsonb_array_length(item->'reductions')>20 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED';
  END IF;
  FOR adjustment IN SELECT value FROM jsonb_array_elements(item->'reductions') LOOP
   IF jsonb_typeof(adjustment)<>'object' OR NOT adjustment?&reduction_keys OR adjustment-reduction_keys<>'{}'
    OR coalesce(adjustment->>'kind','') NOT IN ('payment','credit')
    OR NOT crest_private.opening_worksheet_document(adjustment->'evidence')
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED'; END IF;
   applied:=crest_private.opening_ar_date(adjustment->'appliedOn');
   IF applied<purchased OR applied>=cutover THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_DATE_REQUIRED'; END IF;
   source:=adjustment->'evidence';
   IF allocated @> jsonb_build_array(source) THEN
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_AR_DUPLICATE_EVIDENCE';
   END IF;
   allocated:=allocated||jsonb_build_array(source);
   reduced:=reduced+crest_private.opening_ar_positive_cents(adjustment->'amountCents');
  END LOOP;
  IF original-reduced<>remaining THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_AR_BALANCE_REQUIRED'; END IF;
  total:=total+remaining;
  reviewed:=reviewed||jsonb_build_array(item||jsonb_build_object('taxReview',
   CASE WHEN item->'taxEvidence'='null' THEN 'unknown' ELSE 'source_recorded' END));
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'cutoverOn',to_char(cutover,'YYYY-MM-DD'),'state','evidence_saved','posted',false,
  'currency','USD','reason',reason,'totals',jsonb_build_object('remainingCents',total::text),'lines',reviewed);
END $evidence$;

CREATE FUNCTION crest_commands.save_fictional_opening_ar_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,operation uuid,worksheet_revision bigint,expected_revision bigint,lines jsonb,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE parent crest.opening_worksheet_revisions; previous crest.opening_receivable_schedule_revisions;
 stored crest.opening_receivable_schedule_revisions; existing crest_private.operations; operation_row uuid;
 evidence_body jsonb; receipt jsonb; digest text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR worksheet_revision IS NULL OR worksheet_revision<1 OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 OR jsonb_typeof(lines) IS DISTINCT FROM 'array'
  OR octet_length(lines::text)>24000 OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_ar.save',1,business,actor,epoch,
  worksheet_revision::text,expected_revision::text,lines,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_ar.save',1,epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO operation_row;
 IF operation_row IS NULL THEN
  SELECT * INTO existing FROM crest_private.operations o
   WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
    AND o.command_type IN ('finance.opening_ar.save','finance.opening_ar.retire') AND o.state='committed';
  IF existing.command_type='finance.opening_ar.retire' THEN
   RETURN CASE WHEN existing.result->>'originalEpoch'=epoch::text THEN jsonb_build_object('state','retired')
    ELSE jsonb_build_object('state','conflict','reason','operation') END;
  END IF;
  IF NOT FOUND OR (existing.recovery_epoch,existing.payload_hash) IS DISTINCT FROM (epoch,digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',existing.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO parent FROM crest.opening_worksheet_revisions w WHERE w.business_id=business ORDER BY w.revision DESC LIMIT 1;
 IF parent.revision IS DISTINCT FROM worksheet_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;
 SELECT * INTO previous FROM crest.opening_receivable_schedule_revisions p
  WHERE p.business_id=business AND p.worksheet_revision_id=parent.id ORDER BY p.revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_AR_REVISION_CONFLICT'; END IF;
 evidence_body:=crest_private.opening_ar_evidence(business,parent.cutover_on,lines,reason);
 INSERT INTO crest.opening_receivable_schedule_revisions(business_id,worksheet_revision_id,revision,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256)
 VALUES(business,parent.id,expected_revision+1,operation,gen_random_uuid(),actor,evidence_body,
  encode(sha256(convert_to(evidence_body::text,'UTF8')),'hex')) RETURNING * INTO stored;
 receipt:=crest_private.opening_ar_receipt(stored);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(stored.audit_event_id,business,operation,actor,actor,'opening_receivable_schedule_revisions',stored.id,stored.revision,
  'review',reason,jsonb_build_object('schemaVersion',1,'before',
   CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_ar_receipt(previous) END,'after',receipt),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
  WHERE o.business_id=business AND o.operation_id=operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.lookup_fictional_opening_ar_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE existing crest_private.operations;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR original_epoch IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT * INTO existing FROM crest_private.operations o
  WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
   AND o.command_type IN ('finance.opening_ar.save','finance.opening_ar.retire') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state',CASE WHEN original_epoch=review_epoch THEN 'absent' ELSE 'review_required' END); END IF;
 IF existing.command_type='finance.opening_ar.retire' THEN
  RETURN CASE WHEN existing.result->>'originalEpoch'=original_epoch::text THEN jsonb_build_object('state','retired')
   ELSE jsonb_build_object('state','conflict','reason','operation') END;
 END IF;
 IF existing.recovery_epoch<>original_epoch THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',existing.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_opening_ar_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claimed uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 IF operation IS NULL OR original_epoch IS NULL OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_AR_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','businessId',business,
  'operationId',operation,'originalEpoch',original_epoch,'auditEventId',event_id,'reviewEpoch',review_epoch);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_ar.retire',actor,decision,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_ar.retire',1,review_epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  existing_result:=crest_commands.lookup_fictional_opening_ar_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
  IF existing_result->>'state' IN ('absent','review_required') THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN existing_result;
 END IF;
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,business,operation,actor,actor,'operations',claimed,1,'retire',reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=decision
  WHERE o.business_id=business AND o.operation_id=operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 RETURN jsonb_build_object('state','retired');
END $retire$;

CREATE FUNCTION crest_commands.read_fictional_opening_ar_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,worksheet bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE parent_id uuid; saved crest.opening_receivable_schedule_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT id INTO parent_id FROM crest.opening_worksheet_revisions w WHERE w.business_id=business AND w.revision=worksheet;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;
 SELECT * INTO saved FROM crest.opening_receivable_schedule_revisions r
  WHERE r.business_id=business AND r.worksheet_revision_id=parent_id ORDER BY r.revision DESC LIMIT 1;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'worksheetRevisionId',parent_id,
  'schedule',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_ar_receipt(saved) END);
END $read$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_ar_history() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_ar_history(),crest_private.opening_ar_date(jsonb),
 crest_private.opening_ar_positive_cents(jsonb),crest_private.opening_ar_evidence(uuid,date,jsonb,text),
 crest_private.opening_ar_receipt(crest.opening_receivable_schedule_revisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_ar_date(jsonb),crest_private.opening_ar_positive_cents(jsonb),
 crest_private.opening_ar_evidence(uuid,date,jsonb,text) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.opening_ar_receipt(crest.opening_receivable_schedule_revisions)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_ar_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_ar_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_ar_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_ar_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.save_fictional_opening_ar_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_ar_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_ar_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_ar_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.save_fictional_opening_ar_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_ar_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_ar_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_ar_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_receivable_schedule_revisions TO crest_opening_worksheet_export_owner;
GRANT EXECUTE ON FUNCTION crest_private.opening_ar_receipt(crest.opening_receivable_schedule_revisions)
 TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_ar_export ON crest.opening_receivable_schedule_revisions FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);

CREATE FUNCTION crest_commands.opening_receivables_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE revisions jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_RECEIVABLES_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_RECEIVABLES_SOURCE_BUSINESS_REQUIRED';
 END IF;
 PERFORM set_config('crest.opening_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('receipt',crest_private.opening_ar_receipt(r),'evidenceText',r.evidence::text)
  ORDER BY r.worksheet_revision_id,r.revision),'[]') INTO revisions
 FROM (SELECT * FROM crest.opening_receivable_schedule_revisions WHERE business_id=requested_business
  ORDER BY worksheet_revision_id,revision LIMIT 101) r;
 snapshot:=jsonb_build_object('schemaVersion',1,'scope','opening_receivables_source','businessId',requested_business,'revisions',revisions);
 IF jsonb_array_length(revisions)>100 OR octet_length(snapshot::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_RECEIVABLES_SOURCE_LIMIT';
 END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_receivables_source_snapshot(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_receivables_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_receivables_source_snapshot(uuid) TO crest_export;

GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.record_posted_finance_export_access(credential_hash bytea,expected_session uuid,expected_actor uuid,
 expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,source_version integer,app_release text,observed_at text,manifest_digest text,archive_digest text,archive_bytes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $handoff$
DECLARE operation uuid:=gen_random_uuid(); event uuid; scope jsonb; receipt jsonb; recorded timestamptz; observed timestamptz;
BEGIN
 IF expected_epoch IS NULL OR source_version IS NULL OR source_version NOT BETWEEN 89 AND 999
   OR app_release IS NULL OR app_release!~'^[a-f0-9]{40}$' OR observed_at IS NULL
   OR observed_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00:00$'
   OR manifest_digest IS NULL OR manifest_digest!~'^[a-f0-9]{64}$' OR archive_digest IS NULL OR archive_digest!~'^[a-f0-9]{64}$'
   OR archive_bytes IS NULL OR archive_bytes NOT BETWEEN 1 AND 8388608 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 observed:=observed_at::timestamptz;
 IF NOT isfinite(observed) OR observed>clock_timestamp() OR observed<=clock_timestamp()-interval '2 minutes' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
   set_config('crest.operation_id',operation::text,true);
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=105 THEN 'crest.posted-finance-source.v20' WHEN source_version>=103 THEN 'crest.posted-finance-source.v19' WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
   'appReleaseId',app_release,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,
   'observedAt',observed_at,'manifestSha256',manifest_digest,'archiveSha256',archive_digest,'archiveBytes',archive_bytes);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'finance.export_access',1,expected_epoch,
  encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'finance_export_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,recorded;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,
  'recordedAt',to_char(recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch,operation);
 RETURN receipt;
END $handoff$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;

RESET ROLE;
