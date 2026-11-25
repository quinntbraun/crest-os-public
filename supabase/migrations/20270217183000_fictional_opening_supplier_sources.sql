-- Candidate141 retained supplier evidence and reconciliation; no posting or production activation.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270207180000_opening_payables_sources.sql
-- HELD/unregistered opening supplier-payable evidence. No production or posting activation.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.opening_payables_origins (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,
 source_namespace text NOT NULL CHECK(source_namespace~'^[a-z][a-z0-9_.-]{0,99}$'),
 vendor text NOT NULL CHECK(length(vendor)>=1 AND length(vendor)<=200 AND btrim(vendor)=vendor AND vendor!~'[[:cntrl:]]'),
 external_id text NOT NULL CHECK(length(external_id)>=1 AND length(external_id)<=200 AND btrim(external_id)=external_id AND external_id!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,source_namespace,external_id),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.opening_payables_schedule_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 worksheet_revision_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 prior_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,
 audit_event_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=2097152),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
 UNIQUE(business_id,worksheet_revision_id,revision),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,worksheet_revision_id) REFERENCES crest.opening_worksheet_revisions(business_id,id),
 FOREIGN KEY(business_id,worksheet_revision_id,prior_revision)
  REFERENCES crest.opening_payables_schedule_revisions(business_id,worksheet_revision_id,revision),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE crest.opening_payables_schedule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_payables_schedule_revisions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_payables_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_payables_schedule_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_payables_schedule_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_payables_schedule_revisions TO crest_finance_integrity_owner;
CREATE POLICY opening_payables_review ON crest.opening_payables_schedule_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_payables_append ON crest.opening_payables_schedule_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_payables_integrity ON crest.opening_payables_schedule_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);


ALTER TABLE crest.opening_payables_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_payables_origins FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_payables_origins_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_payables_origins
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_payables_origins TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_payables_origins TO crest_finance_integrity_owner;
CREATE POLICY opening_payables_origins_review ON crest.opening_payables_origins FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_payables_origins_append ON crest.opening_payables_origins FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_payables_origins_integrity ON crest.opening_payables_origins FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE POLICY opening_payables_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.opening_payables.save','finance.opening_payables.retire'));
CREATE POLICY opening_payables_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_payables.save','finance.opening_payables.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_payables_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_payables.save','finance.opening_payables.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_payables.save','finance.opening_payables.retire') AND state='committed');
CREATE POLICY opening_payables_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='opening_payables_schedule_revisions' AND action='review' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_payables_retire_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.id=audit_events.entity_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.opening_payables.retire' AND o.state='pending'));
CREATE POLICY opening_payables_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.opening_payables.save');
CREATE POLICY opening_payables_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='opening_payables_schedule_revisions');

CREATE FUNCTION crest_private.opening_payables_receipt(saved crest.opening_payables_schedule_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',saved.business_id,'scheduleRevisionId',saved.id,
  'worksheetRevisionId',saved.worksheet_revision_id,'revision',saved.revision::text,'operationId',saved.operation_id,
  'auditEventId',saved.audit_event_id,'recordedBy',saved.recorded_by,
  'recordedAt',to_char(saved.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidenceSha256',saved.evidence_sha256,'evidence',saved.evidence)
$receipt$;

CREATE FUNCTION crest_private.check_opening_payables_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.opening_payables_schedule_revisions;
BEGIN
 IF NEW.prior_revision IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM crest.opening_payables_schedule_revisions p
  WHERE p.business_id=NEW.business_id AND p.worksheet_revision_id=NEW.worksheet_revision_id AND p.revision=NEW.prior_revision;
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.recorded_by
    AND o.command_type='finance.opening_payables.save' AND o.state='committed' AND o.result_schema_version=1
    AND o.result=crest_private.opening_payables_receipt(NEW)
    AND a.id=NEW.audit_event_id AND a.entity_id=NEW.id AND a.entity_version=NEW.revision
    AND a.entity_kind='opening_payables_schedule_revisions' AND a.action='review' AND a.reason=NEW.evidence->>'reason'
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',
     CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_payables_receipt(previous) END,'after',o.result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_PAYABLES_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_payables_audited AFTER INSERT ON crest.opening_payables_schedule_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_payables_history();


CREATE FUNCTION crest_private.check_opening_payables_identity_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.opening_payables_schedule_revisions s CROSS JOIN LATERAL jsonb_array_elements(s.evidence->'bills') bill
  WHERE s.business_id=NEW.business_id AND s.operation_id=NEW.operation_id AND s.recorded_by=NEW.recorded_by
   AND bill->>'billId'=NEW.id::text AND bill->>'sourceNamespace'=NEW.source_namespace AND bill->>'externalId'=NEW.external_id AND bill->>'vendor'=NEW.vendor)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_PAYABLES_ORIGIN_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_payables_origins_audited AFTER INSERT ON crest.opening_payables_origins
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_payables_identity_history();

CREATE FUNCTION crest_private.opening_payables_date(input jsonb) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp SET datestyle='ISO, YMD' AS $date$
DECLARE stamp date;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'string' OR input#>>'{}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_DATE_REQUIRED'; END IF;
 stamp:=(input#>>'{}')::date;
 IF stamp NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' OR to_char(stamp,'YYYY-MM-DD')<>input#>>'{}'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_DATE_REQUIRED'; END IF;
 RETURN stamp;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_DATE_REQUIRED';
END $date$;

CREATE FUNCTION crest_private.opening_payables_cents(input jsonb,positive boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $cents$
DECLARE amount numeric;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'string' OR input#>>'{}'!~'^(0|[1-9][0-9]{0,18})$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_AMOUNT_REQUIRED'; END IF;
 amount:=(input#>>'{}')::numeric;
 IF amount>9223372036854775807 OR (positive AND amount=0)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_AMOUNT_REQUIRED'; END IF;
 RETURN amount;
END $cents$;

CREATE FUNCTION crest_private.opening_payables_document(input jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT crest_private.opening_worksheet_document(input) AND length(input->>'reference')<=200
$$;
CREATE FUNCTION crest_private.opening_payables_evidence(business uuid,cutover date,lines jsonb,reason text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $evidence$
DECLARE bill jsonb; reduction jsonb; incurred date; due date; occurred date;
 original numeric; remaining numeric; reduced numeric; total numeric:=0;
 unknown_due integer:=0; unknown_tax integer:=0; ids text[]:='{}'; origins jsonb:='[]'; refs text[];
 normalized jsonb:='[]';
 bill_keys text[]:=ARRAY['billId','sourceNamespace','externalId','vendor','purpose','incurredOn','originalDueOn','unknownDueReason','originalCents','remainingCents','billEvidence','reductions','taxEvidence'];
 reduction_keys text[]:=ARRAY['kind','reference','appliedOn','amountCents','evidence'];
BEGIN
 IF cutover IS NULL OR NOT isfinite(cutover) OR jsonb_typeof(lines) IS DISTINCT FROM 'array' OR octet_length(lines::text)>1048576
  OR NOT crest_private.opening_worksheet_note(to_jsonb(reason)) OR jsonb_array_length(lines)>200
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
 FOR bill IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(bill) IS DISTINCT FROM 'object' OR NOT bill?&bill_keys OR bill-bill_keys<>'{}'
   OR jsonb_typeof(bill->'billId') IS DISTINCT FROM 'string' OR bill->>'billId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(bill->'sourceNamespace') IS DISTINCT FROM 'string' OR bill->>'sourceNamespace'!~'^[a-z][a-z0-9_.-]{0,99}$'
   OR NOT crest_private.opening_worksheet_note(bill->'externalId') OR length(bill->>'externalId')>200
   OR NOT crest_private.opening_worksheet_note(bill->'vendor') OR length(bill->>'vendor')>200
   OR NOT crest_private.opening_worksheet_note(bill->'purpose') OR NOT crest_private.opening_payables_document(bill->'billEvidence')
   OR jsonb_typeof(bill->'reductions') IS DISTINCT FROM 'array' OR jsonb_array_length(bill->'reductions')>100
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
  IF bill->>'billId'=ANY(ids) OR origins @> jsonb_build_array(jsonb_build_array(bill->>'sourceNamespace',bill->>'externalId'))
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_PAYABLES_DUPLICATE_ORIGIN';END IF;
  ids:=array_append(ids,bill->>'billId');origins:=origins||jsonb_build_array(jsonb_build_array(bill->>'sourceNamespace',bill->>'externalId'));
  incurred:=crest_private.opening_payables_date(bill->'incurredOn');
  IF incurred>=cutover THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_DATE_REQUIRED';END IF;
  IF bill->'originalDueOn'='null' THEN
   IF NOT crest_private.opening_worksheet_note(bill->'unknownDueReason') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
   unknown_due:=unknown_due+1;
  ELSE
   due:=crest_private.opening_payables_date(bill->'originalDueOn');
   IF due<incurred OR bill->'unknownDueReason'<>'null' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
  END IF;
  IF bill->'taxEvidence'='null' THEN unknown_tax:=unknown_tax+1;
  ELSIF NOT crest_private.opening_payables_document(bill->'taxEvidence') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
  original:=crest_private.opening_payables_cents(bill->'originalCents',true);remaining:=crest_private.opening_payables_cents(bill->'remainingCents',true);reduced:=0;refs:='{}';
  FOR reduction IN SELECT value FROM jsonb_array_elements(bill->'reductions') LOOP
   IF jsonb_typeof(reduction) IS DISTINCT FROM 'object' OR NOT reduction?&reduction_keys OR reduction-reduction_keys<>'{}'
    OR reduction->>'kind' NOT IN('payment','supplier_credit') OR jsonb_typeof(reduction->'kind') IS DISTINCT FROM 'string'
    OR NOT crest_private.opening_worksheet_note(reduction->'reference') OR length(reduction->>'reference')>200
    OR reduction->>'reference'=ANY(refs) OR NOT crest_private.opening_payables_document(reduction->'evidence')
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
   refs:=array_append(refs,reduction->>'reference');occurred:=crest_private.opening_payables_date(reduction->'appliedOn');
   IF occurred<incurred OR occurred>=cutover THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_DATE_REQUIRED';END IF;
   reduced:=reduced+crest_private.opening_payables_cents(reduction->'amountCents',true);
   IF reduced>original THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
  END LOOP;
  IF original-reduced<>remaining THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
  total:=total+remaining;IF total>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';END IF;
  normalized:=normalized||jsonb_build_array(bill||jsonb_build_object('openingLiabilityCents',remaining::text,
   'dueState',CASE WHEN bill->'originalDueOn'='null' THEN 'unknown' ELSE 'source_recorded' END,
   'taxState',CASE WHEN bill->'taxEvidence'='null' THEN 'unknown' ELSE 'source_recorded' END));
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'cutoverOn',cutover::text,'currency','USD','state','evidence_prepared','reason',reason,'bills',normalized,
  'totals',jsonb_build_object('remainingCents',total::text,'billCount',jsonb_array_length(normalized),'unknownDueCount',unknown_due,'unknownTaxCount',unknown_tax),
  'posted',false,'paymentAuthorized',false,'newExpenseCents','0','newPaymentCents','0','verifiedZero',false,'historicalAllocationClosureVerified',false,'fullSourceClosureVerified',false);
END $evidence$;

CREATE FUNCTION crest_commands.save_fictional_opening_payables_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,operation uuid,worksheet_revision bigint,expected_revision bigint,lines jsonb,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE parent crest.opening_worksheet_revisions; previous crest.opening_payables_schedule_revisions;
 stored crest.opening_payables_schedule_revisions; existing crest_private.operations; operation_row uuid;
 evidence_body jsonb; receipt jsonb; digest text; root jsonb; item jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR worksheet_revision IS NULL OR worksheet_revision<1 OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 OR jsonb_typeof(lines) IS DISTINCT FROM 'array'
  OR octet_length(lines::text)>1048576 OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_payables.save',1,business,actor,epoch,
  worksheet_revision::text,expected_revision::text,lines,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_payables.save',1,epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO operation_row;
 IF operation_row IS NULL THEN
  SELECT * INTO existing FROM crest_private.operations o
   WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
    AND o.command_type IN ('finance.opening_payables.save','finance.opening_payables.retire') AND o.state='committed';
  IF existing.command_type='finance.opening_payables.retire' THEN
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
 SELECT * INTO previous FROM crest.opening_payables_schedule_revisions p
  WHERE p.business_id=business AND p.worksheet_revision_id=parent.id ORDER BY p.revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_PAYABLES_REVISION_CONFLICT'; END IF;
 evidence_body:=crest_private.opening_payables_evidence(business,parent.cutover_on,lines,reason);
 FOR root IN SELECT value FROM jsonb_array_elements(evidence_body->'bills') LOOP
  INSERT INTO crest.opening_payables_origins(id,business_id,source_namespace,external_id,vendor,operation_id,recorded_by)
   VALUES((root->>'billId')::uuid,business,root->>'sourceNamespace',root->>'externalId',root->>'vendor',operation,actor)
   ON CONFLICT(business_id,id) DO NOTHING;
  IF NOT EXISTS(SELECT FROM crest.opening_payables_origins o WHERE o.business_id=business AND o.id=(root->>'billId')::uuid
   AND o.source_namespace=root->>'sourceNamespace' AND o.external_id=root->>'externalId' AND o.vendor=root->>'vendor')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_PAYABLES_ORIGIN_IDENTITY_CONFLICT';END IF;
 END LOOP;
 INSERT INTO crest.opening_payables_schedule_revisions(business_id,worksheet_revision_id,revision,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256)
 VALUES(business,parent.id,expected_revision+1,operation,gen_random_uuid(),actor,evidence_body,
  encode(sha256(convert_to(evidence_body::text,'UTF8')),'hex')) RETURNING * INTO stored;
 receipt:=crest_private.opening_payables_receipt(stored);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(stored.audit_event_id,business,operation,actor,actor,'opening_payables_schedule_revisions',stored.id,stored.revision,
  'review',reason,jsonb_build_object('schemaVersion',1,'before',
   CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_payables_receipt(previous) END,'after',receipt),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
  WHERE o.business_id=business AND o.operation_id=operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.lookup_fictional_opening_payables_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE existing crest_private.operations;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR original_epoch IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT * INTO existing FROM crest_private.operations o
  WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
   AND o.command_type IN ('finance.opening_payables.save','finance.opening_payables.retire') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state',CASE WHEN original_epoch=review_epoch THEN 'absent' ELSE 'review_required' END); END IF;
 IF existing.command_type='finance.opening_payables.retire' THEN
  RETURN CASE WHEN existing.result->>'originalEpoch'=original_epoch::text THEN jsonb_build_object('state','retired')
   ELSE jsonb_build_object('state','conflict','reason','operation') END;
 END IF;
 IF existing.recovery_epoch<>original_epoch THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',existing.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_opening_payables_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claimed uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 IF operation IS NULL OR original_epoch IS NULL OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','businessId',business,
  'operationId',operation,'originalEpoch',original_epoch,'auditEventId',event_id,'reviewEpoch',review_epoch);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_payables.retire',actor,decision,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_payables.retire',1,review_epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  existing_result:=crest_commands.lookup_fictional_opening_payables_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
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

CREATE FUNCTION crest_commands.read_fictional_opening_payables_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,worksheet bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE parent_id uuid; saved crest.opening_payables_schedule_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT id INTO parent_id FROM crest.opening_worksheet_revisions w WHERE w.business_id=business AND w.revision=worksheet;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;
 SELECT * INTO saved FROM crest.opening_payables_schedule_revisions r
  WHERE r.business_id=business AND r.worksheet_revision_id=parent_id ORDER BY r.revision DESC LIMIT 1;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'worksheetRevisionId',parent_id,
  'schedule',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_payables_receipt(saved) END);
END $read$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_payables_history() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_payables_identity_history() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_payables_identity_history() FROM PUBLIC;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_payables_history(),crest_private.opening_payables_date(jsonb),
 crest_private.opening_payables_cents(jsonb,boolean),crest_private.opening_payables_evidence(uuid,date,jsonb,text),
 crest_private.opening_payables_receipt(crest.opening_payables_schedule_revisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_payables_date(jsonb),crest_private.opening_payables_cents(jsonb,boolean),
 crest_private.opening_payables_evidence(uuid,date,jsonb,text) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.opening_payables_receipt(crest.opening_payables_schedule_revisions)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_payables_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_payables_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_payables_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_payables_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.save_fictional_opening_payables_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_payables_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_payables_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_payables_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.save_fictional_opening_payables_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_payables_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_payables_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_payables_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;


SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_payables_origins TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_payables_origins_export ON crest.opening_payables_origins FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT SELECT ON crest.opening_payables_schedule_revisions TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_payables_schedule_revisions_export ON crest.opening_payables_schedule_revisions FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT EXECUTE ON FUNCTION crest_private.opening_payables_receipt(crest.opening_payables_schedule_revisions) TO crest_opening_worksheet_export_owner;
CREATE FUNCTION crest_commands.opening_payables_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE origins jsonb; revisions jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_PAYABLES_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_PAYABLES_SOURCE_BUSINESS_REQUIRED'; END IF;
 PERFORM set_config('crest.opening_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO origins
  FROM(SELECT * FROM crest.opening_payables_origins WHERE business_id=requested_business ORDER BY id LIMIT 20001) r;
 SELECT coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(r),'receipt',crest_private.opening_payables_receipt(r),'evidenceText',r.evidence::text)
  ORDER BY r.worksheet_revision_id,r.revision),'[]') INTO revisions
  FROM(SELECT * FROM crest.opening_payables_schedule_revisions WHERE business_id=requested_business ORDER BY worksheet_revision_id,revision LIMIT 101) r;
 snapshot:=jsonb_build_object('schemaVersion',1,'profile','crest.opening-payables-source-candidate.v1','catalogRegistered',false,
  'businessId',requested_business,'origins',origins,'revisions',revisions,'completeBusinessExport',false);
 IF jsonb_array_length(origins)>20000 OR jsonb_array_length(revisions)>100 OR octet_length(snapshot::text)>33554432 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_PAYABLES_SOURCE_LIMIT'; END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_payables_source_snapshot(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_payables_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_payables_source_snapshot(uuid) TO crest_export;

REVOKE ALL ON FUNCTION crest_private.opening_payables_document(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_payables_document(jsonb) TO crest_finance_account_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/20270207180000_opening_payables_sources.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270208180000_opening_payables_export_history.sql
-- HELD after funds sources. v2 retains complete original operation/audit text.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY opening_payables_export_operations ON crest_private.operations FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND command_type IN ('finance.opening_payables.save','finance.opening_payables.retire'));
CREATE POLICY opening_payables_export_audits ON crest_private.audit_events FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.command_type IN('finance.opening_payables.save','finance.opening_payables.retire')));
CREATE FUNCTION crest_commands.opening_payables_source_snapshot_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source jsonb; revisions jsonb; operations jsonb; audits jsonb; snapshot_result jsonb;
BEGIN
 source:=crest_commands.opening_payables_source_snapshot(requested_business);
 -- Convert bigint revision fields inside PostgreSQL, before any JSON number can
 -- pass through JavaScript. Exact evidence JSON text remains separately retained.
 SELECT coalesce(jsonb_agg(item||jsonb_build_object('row',(item->'row')||jsonb_build_object(
  'revision',item->'row'->>'revision','prior_revision',item->'row'->>'prior_revision')) ORDER BY ordinal),'[]') INTO revisions
  FROM jsonb_array_elements(source->'revisions') WITH ORDINALITY AS selected(item,ordinal);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id::text,'business_id',o.business_id::text,'operation_id',o.operation_id::text,'actor_id',o.actor_id::text,'command_type',o.command_type::text,'schema_version',o.schema_version::text,'recovery_epoch',o.recovery_epoch::text,'payload_hash',o.payload_hash::text,'state',o.state::text,'result_schema_version',o.result_schema_version::text,'result',o.result::text,'committed_at',to_char(o.committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',o.created_by::text,'origin',o.origin::text,'import_row_id',o.import_row_id::text) ORDER BY o.operation_id),'[]') INTO operations
  FROM(SELECT id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id FROM crest_private.operations WHERE business_id=requested_business AND command_type IN('finance.opening_payables.save','finance.opening_payables.retire') ORDER BY operation_id LIMIT 1001) o;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'business_id',a.business_id::text,'operation_id',a.operation_id::text,'actor_id',a.actor_id::text,'entity_kind',a.entity_kind::text,'entity_id',a.entity_id::text,'entity_version',a.entity_version::text,'action',a.action::text,'reason',a.reason::text,'effective_at',to_char(a.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'delta',a.delta::text,'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recorded_at',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',a.created_by::text,'origin',a.origin::text,'import_row_id',a.import_row_id::text,'database_principal',a.database_principal::text,'payload',a.payload::text,'hash_input',a.hash_input::text,'event_hash',a.event_hash::text) ORDER BY a.operation_id),'[]') INTO audits
  FROM(SELECT a.id,a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action,a.reason,a.effective_at,a.delta,a.created_at,a.recorded_at,a.created_by,a.origin,a.import_row_id,a.database_principal,a.payload,a.hash_input,a.event_hash FROM crest_private.audit_events a WHERE a.business_id=requested_business AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.command_type IN('finance.opening_payables.save','finance.opening_payables.retire')) ORDER BY a.operation_id LIMIT 1001) a;
 snapshot_result:=source||jsonb_build_object('profile','crest.opening-payables-source-candidate.v2','revisions',revisions,'operations',operations,'audits',audits);
 IF jsonb_array_length(operations)>1000 OR jsonb_array_length(audits)>1000 OR octet_length(snapshot_result::text)>33554432 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_PAYABLES_SOURCE_LIMIT'; END IF;
 RETURN snapshot_result;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_payables_source_snapshot_v2(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_payables_source_snapshot_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_payables_source_snapshot_v2(uuid) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/20270208180000_opening_payables_export_history.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270209180000_opening_journal_payables_context.sql
-- HELD after registered140 and the opening-payables source proposals.
-- Binds supplier evidence to the existing locked context; grants no posting authority.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.review_fictional_opening_journal_context_v3(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 expected_worksheet_revision bigint,expected_receivables_revision bigint,expected_funds_revision bigint,
 expected_payables_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE context jsonb; schedule crest.opening_payables_schedule_revisions; result jsonb;
BEGIN
 -- v2 authenticates and holds the business/session/recovery and finance-control
 -- locks, verifies a fresh READ COMMITTED snapshot, and binds worksheet/AR/funds.
 context:=crest_commands.review_fictional_opening_journal_context_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12);
 IF expected_payables_revision IS NULL OR expected_payables_revision<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_CONTEXT_INPUT_REQUIRED'; END IF;
 SELECT * INTO schedule FROM crest.opening_payables_schedule_revisions s
  WHERE s.business_id=requested_business AND s.worksheet_revision_id=(context->>'worksheetRevisionId')::uuid
  ORDER BY s.revision DESC LIMIT 1;
 IF coalesce(schedule.revision,0) IS DISTINCT FROM expected_payables_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_PAYABLES_REVISION_CONFLICT'; END IF;
 result:=context||jsonb_build_object('profile','crest.opening-journal-context-candidate.v3',
  'supplierPayablesRevision',coalesce(schedule.revision,0)::text,
  'supplierPayables',CASE WHEN schedule.id IS NOT NULL THEN crest_private.opening_payables_receipt(schedule) END);
 IF octet_length(result::text)>8388608 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_CONTEXT_CAPACITY_REQUIRED'; END IF;
 RETURN result;
END $review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.review_fictional_opening_journal_context_v3(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,bigint,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_opening_journal_context_v3(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_opening_journal_context_v3(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,bigint,bigint)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/20270209180000_opening_journal_payables_context.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270210180000_opening_payables_allocation_review.sql
-- HELD after registered140 and supplier proposals; retained allocation review only.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.opening_allocations_origins (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,
 source_namespace text NOT NULL CHECK(source_namespace~'^[a-z][a-z0-9_.-]{0,99}$'),
 vendor text NOT NULL CHECK(length(vendor)>=1 AND length(vendor)<=200 AND btrim(vendor)=vendor AND vendor!~'[[:cntrl:]]'),
 external_id text NOT NULL CHECK(length(external_id)>=1 AND length(external_id)<=200 AND btrim(external_id)=external_id AND external_id!~'[[:cntrl:]]'),
 kind text NOT NULL CHECK(kind IN('payment','supplier_credit')),reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 200),
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,source_namespace,external_id),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.opening_allocations_schedule_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 worksheet_revision_id uuid NOT NULL,
 payables_revision bigint NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 prior_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,
 audit_event_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=2097152),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
 UNIQUE(business_id,worksheet_revision_id,revision),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,worksheet_revision_id,payables_revision) REFERENCES crest.opening_payables_schedule_revisions(business_id,worksheet_revision_id,revision),
 FOREIGN KEY(business_id,worksheet_revision_id) REFERENCES crest.opening_worksheet_revisions(business_id,id),
 FOREIGN KEY(business_id,worksheet_revision_id,prior_revision)
  REFERENCES crest.opening_allocations_schedule_revisions(business_id,worksheet_revision_id,revision),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE crest.opening_allocations_schedule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_allocations_schedule_revisions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_allocations_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_allocations_schedule_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_allocations_schedule_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_allocations_schedule_revisions TO crest_finance_integrity_owner;
CREATE POLICY opening_allocations_review ON crest.opening_allocations_schedule_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_allocations_append ON crest.opening_allocations_schedule_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_allocations_integrity ON crest.opening_allocations_schedule_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);


ALTER TABLE crest.opening_allocations_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_allocations_origins FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_allocations_origins_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_allocations_origins
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_allocations_origins TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_allocations_origins TO crest_finance_integrity_owner;
CREATE POLICY opening_allocations_origins_review ON crest.opening_allocations_origins FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_allocations_origins_append ON crest.opening_allocations_origins FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_allocations_origins_integrity ON crest.opening_allocations_origins FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE POLICY opening_allocations_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire'));
CREATE POLICY opening_allocations_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_allocations_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire') AND state='committed');
CREATE POLICY opening_allocations_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='opening_allocations_schedule_revisions' AND action='review' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_allocations_retire_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.id=audit_events.entity_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.opening_allocations.retire' AND o.state='pending'));
CREATE POLICY opening_allocations_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.opening_allocations.save');
CREATE POLICY opening_allocations_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='opening_allocations_schedule_revisions');

CREATE FUNCTION crest_private.opening_allocations_receipt(saved crest.opening_allocations_schedule_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',saved.business_id,'allocationRevisionId',saved.id,'payablesRevision',saved.payables_revision::text,
  'worksheetRevisionId',saved.worksheet_revision_id,'revision',saved.revision::text,'operationId',saved.operation_id,
  'auditEventId',saved.audit_event_id,'recordedBy',saved.recorded_by,
  'recordedAt',to_char(saved.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidenceSha256',saved.evidence_sha256,'evidence',saved.evidence)
$receipt$;

CREATE FUNCTION crest_private.check_opening_allocations_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.opening_allocations_schedule_revisions;
BEGIN
 IF NEW.prior_revision IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM crest.opening_allocations_schedule_revisions p
  WHERE p.business_id=NEW.business_id AND p.worksheet_revision_id=NEW.worksheet_revision_id AND p.revision=NEW.prior_revision;
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.recorded_by
    AND o.command_type='finance.opening_allocations.save' AND o.state='committed' AND o.result_schema_version=1
    AND o.result=crest_private.opening_allocations_receipt(NEW)
    AND a.id=NEW.audit_event_id AND a.entity_id=NEW.id AND a.entity_version=NEW.revision
    AND a.entity_kind='opening_allocations_schedule_revisions' AND a.action='review' AND a.reason=NEW.evidence->>'reason'
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',
     CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_allocations_receipt(previous) END,'after',o.result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_ALLOCATIONS_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_allocations_audited AFTER INSERT ON crest.opening_allocations_schedule_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_allocations_history();


CREATE FUNCTION crest_private.check_opening_allocations_identity_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.opening_allocations_schedule_revisions s CROSS JOIN LATERAL jsonb_array_elements(s.evidence->'roots') bill
  WHERE s.business_id=NEW.business_id AND s.operation_id=NEW.operation_id AND s.recorded_by=NEW.recorded_by
   AND bill->>'rootId'=NEW.id::text AND bill->>'sourceNamespace'=NEW.source_namespace AND bill->>'externalId'=NEW.external_id AND bill->>'vendor'=NEW.vendor AND bill->>'kind'=NEW.kind AND bill->>'reference'=NEW.reference)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_ALLOCATIONS_ORIGIN_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_allocations_origins_audited AFTER INSERT ON crest.opening_allocations_origins
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_allocations_identity_history();

CREATE FUNCTION crest_private.opening_allocations_evidence(cutover date,schedule jsonb,lines jsonb,reason text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $evidence$
DECLARE root jsonb; normalized jsonb:='[]'; allocations jsonb; original numeric; elsewhere numeric; allocated numeric;
 matched integer; total_matched integer:=0; total_reductions integer; ids text[]:='{}'; origins jsonb:='[]'; bindings jsonb:='[]';
 identity jsonb; binding jsonb;
 keys text[]:=ARRAY['rootId','sourceNamespace','externalId','vendor','kind','reference','appliedOn','originalCents','evidence','otherAllocatedCents','otherAllocationEvidence'];
BEGIN
 IF cutover IS NULL OR NOT isfinite(cutover) OR jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines)>1000
  OR octet_length(jsonb_build_object('schemaVersion',1,'roots',lines,'reason',reason)::text)>1048576
  OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
 SELECT count(*) INTO total_reductions FROM jsonb_array_elements(schedule->'bills') b CROSS JOIN LATERAL jsonb_array_elements(b->'reductions') r;
 FOR root IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(root) IS DISTINCT FROM 'object' OR NOT root?&keys OR root-keys<>'{}'
   OR jsonb_typeof(root->'rootId') IS DISTINCT FROM 'string' OR root->>'rootId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR root->>'rootId'=ANY(ids)
   OR jsonb_typeof(root->'sourceNamespace') IS DISTINCT FROM 'string' OR root->>'sourceNamespace'!~'^[a-z][a-z0-9_.-]{0,99}$'
   OR NOT crest_private.opening_worksheet_note(root->'externalId') OR length(root->>'externalId')>200
   OR NOT crest_private.opening_worksheet_note(root->'vendor') OR length(root->>'vendor')>200
   OR jsonb_typeof(root->'kind') IS DISTINCT FROM 'string' OR root->>'kind' NOT IN('payment','supplier_credit')
   OR NOT crest_private.opening_worksheet_note(root->'reference') OR length(root->>'reference')>200
   OR NOT crest_private.opening_payables_document(root->'evidence')
   OR crest_private.opening_payables_date(root->'appliedOn')>=cutover
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
  identity:=jsonb_build_array(root->>'sourceNamespace',root->>'externalId');binding:=jsonb_build_array(root->>'vendor',root->>'kind',root->>'reference');
  IF origins@>jsonb_build_array(identity) OR bindings@>jsonb_build_array(binding)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
  ids:=array_append(ids,root->>'rootId');origins:=origins||jsonb_build_array(identity);bindings:=bindings||jsonb_build_array(binding);
  original:=crest_private.opening_payables_cents(root->'originalCents',true);elsewhere:=crest_private.opening_payables_cents(root->'otherAllocatedCents');
  IF elsewhere>original OR (elsewhere>0 AND NOT crest_private.opening_payables_document(root->'otherAllocationEvidence'))
   OR (elsewhere=0 AND root->'otherAllocationEvidence'<>'null')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
  IF EXISTS(SELECT FROM jsonb_array_elements(schedule->'bills') b CROSS JOIN LATERAL jsonb_array_elements(b->'reductions') r
   WHERE b->>'vendor'=root->>'vendor' AND r->>'kind'=root->>'kind' AND r->>'reference'=root->>'reference'
    AND (r->'appliedOn' IS DISTINCT FROM root->'appliedOn' OR r->'evidence' IS DISTINCT FROM root->'evidence'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
  SELECT count(*),coalesce(sum((r->>'amountCents')::numeric),0),coalesce(jsonb_agg(jsonb_build_object('billId',b->>'billId','amountCents',r->>'amountCents') ORDER BY bi,ri),'[]')
   INTO matched,allocated,allocations FROM jsonb_array_elements(schedule->'bills') WITH ORDINALITY bills(b,bi)
   CROSS JOIN LATERAL jsonb_array_elements(b->'reductions') WITH ORDINALITY reductions(r,ri)
   WHERE b->>'vendor'=root->>'vendor' AND r->>'kind'=root->>'kind' AND r->>'reference'=root->>'reference';
  IF matched=0 OR allocated+elsewhere>original
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
  total_matched:=total_matched+matched;
  normalized:=normalized||jsonb_build_array(root||jsonb_build_object('allocations',allocations,'selectedAllocationCents',allocated::text,'unallocatedCents',(original-elsewhere-allocated)::text));
 END LOOP;
 IF total_matched<>total_reductions THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'cutoverOn',cutover::text,'currency','USD','reason',reason,'roots',normalized,
  'rootCount',jsonb_array_length(normalized),'reductionCount',total_matched,'remainingPayablesCents',schedule#>>'{totals,remainingCents}',
  'selectedAllocationCapacityChecked',true,'externalEvidenceVerified',false,'historicalAllocationClosureVerified',false,
  'fullSourceClosureVerified',false,'posted',false,'paymentAuthorized',false,'newExpenseCents','0','newPaymentCents','0');
END $evidence$;

CREATE FUNCTION crest_commands.save_fictional_opening_allocations_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,operation uuid,worksheet_revision bigint,payables_revision bigint,expected_revision bigint,lines jsonb,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE parent crest.opening_worksheet_revisions; supplier crest.opening_payables_schedule_revisions; previous crest.opening_allocations_schedule_revisions;
 stored crest.opening_allocations_schedule_revisions; existing crest_private.operations; operation_row uuid;
 evidence_body jsonb; receipt jsonb; digest text; root jsonb; item jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR worksheet_revision IS NULL OR worksheet_revision<1 OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 OR jsonb_typeof(lines) IS DISTINCT FROM 'array'
  OR octet_length(lines::text)>1048576 OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_allocations.save',1,business,actor,epoch,
  worksheet_revision::text,payables_revision::text,expected_revision::text,lines,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_allocations.save',1,epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO operation_row;
 IF operation_row IS NULL THEN
  SELECT * INTO existing FROM crest_private.operations o
   WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
    AND o.command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire') AND o.state='committed';
  IF existing.command_type='finance.opening_allocations.retire' THEN
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
 SELECT * INTO supplier FROM crest.opening_payables_schedule_revisions s
  WHERE s.business_id=business AND s.worksheet_revision_id=parent.id ORDER BY s.revision DESC LIMIT 1;
 IF payables_revision IS NULL OR supplier.revision IS DISTINCT FROM payables_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_PAYABLES_REVISION_CONFLICT'; END IF;
 SELECT * INTO previous FROM crest.opening_allocations_schedule_revisions p
  WHERE p.business_id=business AND p.worksheet_revision_id=parent.id ORDER BY p.revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_ALLOCATIONS_REVISION_CONFLICT'; END IF;
 evidence_body:=crest_private.opening_allocations_evidence(parent.cutover_on,supplier.evidence,lines,reason);
 FOR root IN SELECT value FROM jsonb_array_elements(evidence_body->'roots') LOOP
  INSERT INTO crest.opening_allocations_origins(id,business_id,source_namespace,external_id,vendor,kind,reference,operation_id,recorded_by)
   VALUES((root->>'rootId')::uuid,business,root->>'sourceNamespace',root->>'externalId',root->>'vendor',root->>'kind',root->>'reference',operation,actor)
   ON CONFLICT(business_id,id) DO NOTHING;
  IF NOT EXISTS(SELECT FROM crest.opening_allocations_origins o WHERE o.business_id=business AND o.id=(root->>'rootId')::uuid
   AND o.source_namespace=root->>'sourceNamespace' AND o.external_id=root->>'externalId' AND o.vendor=root->>'vendor' AND o.kind=root->>'kind' AND o.reference=root->>'reference')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_ALLOCATIONS_ORIGIN_IDENTITY_CONFLICT';END IF;
 END LOOP;
 INSERT INTO crest.opening_allocations_schedule_revisions(business_id,worksheet_revision_id,payables_revision,revision,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256)
 VALUES(business,parent.id,payables_revision,expected_revision+1,operation,gen_random_uuid(),actor,evidence_body,
  encode(sha256(convert_to(evidence_body::text,'UTF8')),'hex')) RETURNING * INTO stored;
 receipt:=crest_private.opening_allocations_receipt(stored);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(stored.audit_event_id,business,operation,actor,actor,'opening_allocations_schedule_revisions',stored.id,stored.revision,
  'review',reason,jsonb_build_object('schemaVersion',1,'before',
   CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_allocations_receipt(previous) END,'after',receipt),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
  WHERE o.business_id=business AND o.operation_id=operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.lookup_fictional_opening_allocations_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE existing crest_private.operations;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR original_epoch IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT * INTO existing FROM crest_private.operations o
  WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
   AND o.command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state',CASE WHEN original_epoch=review_epoch THEN 'absent' ELSE 'review_required' END); END IF;
 IF existing.command_type='finance.opening_allocations.retire' THEN
  RETURN CASE WHEN existing.result->>'originalEpoch'=original_epoch::text THEN jsonb_build_object('state','retired')
   ELSE jsonb_build_object('state','conflict','reason','operation') END;
 END IF;
 IF existing.recovery_epoch<>original_epoch THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',existing.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_opening_allocations_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claimed uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 IF operation IS NULL OR original_epoch IS NULL OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','businessId',business,
  'operationId',operation,'originalEpoch',original_epoch,'auditEventId',event_id,'reviewEpoch',review_epoch);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_allocations.retire',actor,decision,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_allocations.retire',1,review_epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  existing_result:=crest_commands.lookup_fictional_opening_allocations_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
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

CREATE FUNCTION crest_commands.read_fictional_opening_allocations_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,worksheet bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE parent_id uuid; saved crest.opening_allocations_schedule_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT id INTO parent_id FROM crest.opening_worksheet_revisions w WHERE w.business_id=business AND w.revision=worksheet;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;
 SELECT * INTO saved FROM crest.opening_allocations_schedule_revisions r
  WHERE r.business_id=business AND r.worksheet_revision_id=parent_id ORDER BY r.revision DESC LIMIT 1;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'worksheetRevisionId',parent_id,
  'schedule',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_allocations_receipt(saved) END);
END $read$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_allocations_history() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_allocations_identity_history() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_allocations_identity_history() FROM PUBLIC;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_allocations_history(),crest_private.opening_allocations_evidence(date,jsonb,jsonb,text),
 crest_private.opening_allocations_receipt(crest.opening_allocations_schedule_revisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION 
 crest_private.opening_allocations_evidence(date,jsonb,jsonb,text) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.opening_allocations_receipt(crest.opening_allocations_schedule_revisions)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_allocations_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_allocations_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_allocations_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.save_fictional_opening_allocations_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_allocations_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_allocations_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_allocations_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.save_fictional_opening_allocations_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_allocations_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_allocations_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_allocations_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;


SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_allocations_origins TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_allocations_origins_export ON crest.opening_allocations_origins FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT SELECT ON crest.opening_allocations_schedule_revisions TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_allocations_schedule_revisions_export ON crest.opening_allocations_schedule_revisions FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT EXECUTE ON FUNCTION crest_private.opening_allocations_receipt(crest.opening_allocations_schedule_revisions) TO crest_opening_worksheet_export_owner;
CREATE FUNCTION crest_commands.opening_allocations_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE origins jsonb; revisions jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_ALLOCATIONS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_ALLOCATIONS_SOURCE_BUSINESS_REQUIRED'; END IF;
 PERFORM set_config('crest.opening_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO origins
  FROM(SELECT * FROM crest.opening_allocations_origins WHERE business_id=requested_business ORDER BY id LIMIT 20001) r;
 SELECT coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(r),'receipt',crest_private.opening_allocations_receipt(r),'evidenceText',r.evidence::text)
  ORDER BY r.worksheet_revision_id,r.revision),'[]') INTO revisions
  FROM(SELECT * FROM crest.opening_allocations_schedule_revisions WHERE business_id=requested_business ORDER BY worksheet_revision_id,revision LIMIT 101) r;
 snapshot:=jsonb_build_object('schemaVersion',1,'profile','crest.opening-allocations-source-candidate.v1','catalogRegistered',false,
  'businessId',requested_business,'origins',origins,'revisions',revisions,'completeBusinessExport',false);
 IF jsonb_array_length(origins)>20000 OR jsonb_array_length(revisions)>100 OR octet_length(snapshot::text)>33554432 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_ALLOCATIONS_SOURCE_LIMIT'; END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_allocations_source_snapshot(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_allocations_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_allocations_source_snapshot(uuid) TO crest_export;


RESET ROLE;
-- END REVIEWED planning/proposals/20270210180000_opening_payables_allocation_review.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270211180000_opening_allocation_export_history.sql
-- HELD after funds sources. v2 retains complete original operation/audit text.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY opening_allocations_export_operations ON crest_private.operations FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND command_type IN ('finance.opening_allocations.save','finance.opening_allocations.retire'));
CREATE POLICY opening_allocations_export_audits ON crest_private.audit_events FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.command_type IN('finance.opening_allocations.save','finance.opening_allocations.retire')));
CREATE FUNCTION crest_commands.opening_allocations_source_snapshot_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source jsonb; revisions jsonb; operations jsonb; audits jsonb; snapshot_result jsonb;
BEGIN
 source:=crest_commands.opening_allocations_source_snapshot(requested_business);
 -- Convert bigint revision fields inside PostgreSQL, before any JSON number can
 -- pass through JavaScript. Exact evidence JSON text remains separately retained.
 SELECT coalesce(jsonb_agg(item||jsonb_build_object('row',(item->'row')||jsonb_build_object(
  'revision',item->'row'->>'revision','prior_revision',item->'row'->>'prior_revision','payables_revision',item->'row'->>'payables_revision')) ORDER BY ordinal),'[]') INTO revisions
  FROM jsonb_array_elements(source->'revisions') WITH ORDINALITY AS selected(item,ordinal);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id::text,'business_id',o.business_id::text,'operation_id',o.operation_id::text,'actor_id',o.actor_id::text,'command_type',o.command_type::text,'schema_version',o.schema_version::text,'recovery_epoch',o.recovery_epoch::text,'payload_hash',o.payload_hash::text,'state',o.state::text,'result_schema_version',o.result_schema_version::text,'result',o.result::text,'committed_at',to_char(o.committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',o.created_by::text,'origin',o.origin::text,'import_row_id',o.import_row_id::text) ORDER BY o.operation_id),'[]') INTO operations
  FROM(SELECT id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id FROM crest_private.operations WHERE business_id=requested_business AND command_type IN('finance.opening_allocations.save','finance.opening_allocations.retire') ORDER BY operation_id LIMIT 1001) o;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'business_id',a.business_id::text,'operation_id',a.operation_id::text,'actor_id',a.actor_id::text,'entity_kind',a.entity_kind::text,'entity_id',a.entity_id::text,'entity_version',a.entity_version::text,'action',a.action::text,'reason',a.reason::text,'effective_at',to_char(a.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'delta',a.delta::text,'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recorded_at',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',a.created_by::text,'origin',a.origin::text,'import_row_id',a.import_row_id::text,'database_principal',a.database_principal::text,'payload',a.payload::text,'hash_input',a.hash_input::text,'event_hash',a.event_hash::text) ORDER BY a.operation_id),'[]') INTO audits
  FROM(SELECT a.id,a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action,a.reason,a.effective_at,a.delta,a.created_at,a.recorded_at,a.created_by,a.origin,a.import_row_id,a.database_principal,a.payload,a.hash_input,a.event_hash FROM crest_private.audit_events a WHERE a.business_id=requested_business AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.command_type IN('finance.opening_allocations.save','finance.opening_allocations.retire')) ORDER BY a.operation_id LIMIT 1001) a;
 snapshot_result:=source||jsonb_build_object('profile','crest.opening-allocations-source-candidate.v2','revisions',revisions,'operations',operations,'audits',audits);
 IF jsonb_array_length(operations)>1000 OR jsonb_array_length(audits)>1000 OR octet_length(snapshot_result::text)>33554432 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_ALLOCATIONS_SOURCE_LIMIT'; END IF;
 RETURN snapshot_result;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_allocations_source_snapshot_v2(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_allocations_source_snapshot_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_allocations_source_snapshot_v2(uuid) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/20270211180000_opening_allocation_export_history.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270212180000_opening_allocation_context.sql
-- HELD after supplier context v3 and immutable allocation reviews.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.review_fictional_opening_journal_context_v4(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 expected_worksheet_revision bigint,expected_receivables_revision bigint,expected_funds_revision bigint,
 expected_payables_revision bigint,expected_allocations_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE context jsonb; saved crest.opening_allocations_schedule_revisions; result jsonb;
BEGIN
 context:=crest_commands.review_fictional_opening_journal_context_v3($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
 IF expected_allocations_revision IS NULL OR expected_allocations_revision<0 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_CONTEXT_INPUT_REQUIRED'; END IF;
 SELECT * INTO saved FROM crest.opening_allocations_schedule_revisions s
  WHERE s.business_id=requested_business AND s.worksheet_revision_id=(context->>'worksheetRevisionId')::uuid
  ORDER BY s.revision DESC LIMIT 1;
 IF coalesce(saved.revision,0) IS DISTINCT FROM expected_allocations_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_ALLOCATIONS_REVISION_CONFLICT'; END IF;
 IF saved.id IS NOT NULL AND saved.payables_revision IS DISTINCT FROM expected_payables_revision THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_ALLOCATIONS_SUPPLIER_REVISION_CONFLICT'; END IF;
 result:=context||jsonb_build_object('profile','crest.opening-journal-context-candidate.v4',
  'supplierAllocationsRevision',coalesce(saved.revision,0)::text,
  'supplierAllocations',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_allocations_receipt(saved) END);
 IF octet_length(result::text)>8388608 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_CONTEXT_CAPACITY_REQUIRED'; END IF;
 RETURN result;
END $review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.review_fictional_opening_journal_context_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,bigint,bigint,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_opening_journal_context_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_opening_journal_context_v4(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,bigint,bigint,bigint)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/20270212180000_opening_allocation_context.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270213180000_opening_allocation_private_response.sql
-- HELD; original commands/audits remain unchanged. Private responses include the exact historical parent.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.opening_allocations_private_response(value jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $response$
DECLARE saved jsonb; parent crest.opening_payables_schedule_revisions;
BEGIN
 IF value->>'state'='committed' THEN saved:=value->'receipt';
 ELSIF value?'schedule' THEN saved:=value->'schedule';
 ELSE RETURN value; END IF;
 IF saved='null' THEN RETURN value||jsonb_build_object('supplierSchedule',NULL);END IF;
 SELECT * INTO STRICT parent FROM crest.opening_payables_schedule_revisions p
  WHERE p.business_id=(saved->>'businessId')::uuid AND p.worksheet_revision_id=(saved->>'worksheetRevisionId')::uuid
   AND p.revision=(saved->>'payablesRevision')::bigint;
 RETURN value||jsonb_build_object('supplierSchedule',crest_private.opening_payables_receipt(parent));
END $response$;
REVOKE ALL ON FUNCTION crest_private.opening_allocations_private_response(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_allocations_private_response(jsonb) TO crest_finance_account_owner;
CREATE FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,operation uuid,worksheet_revision bigint,payables_revision bigint,expected_revision bigint,lines jsonb,reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.save_fictional_opening_allocations_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,worksheet bigint) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.read_fictional_opening_allocations_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,operation uuid,original_epoch uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.lookup_fictional_opening_allocations_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,operation uuid,original_epoch uuid,reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.retire_fictional_opening_allocations_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/20270213180000_opening_allocation_private_response.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270214180000_opening_supplier_source_history.sql
-- HELD; authenticated, paginated access to retained sources. No copy/write or approval.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_opening_payables_history(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,before_at timestamptz,before_id uuid,page_size integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE selected record; entries jsonb:='[]'; cursor jsonb:=NULL; count integer:=0; more boolean:=false;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 20 OR (before_at IS NULL)<>(before_id IS NULL) OR (before_at IS NOT NULL AND NOT isfinite(before_at)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED'; END IF;
 FOR selected IN SELECT r.id,r.revision,r.recorded_at,w.revision AS worksheet_revision,w.cutover_on,
  jsonb_array_length(r.evidence->'bills') AS item_count
  FROM crest.opening_payables_schedule_revisions r JOIN crest.opening_worksheet_revisions w ON w.business_id=r.business_id AND w.id=r.worksheet_revision_id
  WHERE r.business_id=business AND (before_at IS NULL OR (r.recorded_at,r.id)<(before_at,before_id))
  ORDER BY r.recorded_at DESC,r.id DESC LIMIT page_size+1 LOOP
  IF count=page_size THEN more:=true;EXIT;END IF;count:=count+1;
  entries:=entries||jsonb_build_array(jsonb_build_object('revisionId',selected.id,'worksheetRevision',selected.worksheet_revision::text,
   'revision',selected.revision::text,'cutoverOn',selected.cutover_on::text,'recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'itemCount',selected.item_count));
  cursor:=jsonb_build_object('recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',selected.id);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'kind','payables','entries',entries,'nextCursor',CASE WHEN more THEN cursor END);
END $history$;
CREATE FUNCTION crest_commands.read_fictional_opening_payables_revision(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,revision_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $revision$
DECLARE saved crest.opening_payables_schedule_revisions; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF revision_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED';END IF;
 SELECT * INTO saved FROM crest.opening_payables_schedule_revisions r WHERE r.business_id=business AND r.id=revision_id;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'schedule',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_payables_receipt(saved) END);
END $revision$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_payables_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_payables_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_opening_payables_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_payables_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_payables_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_payables_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_opening_allocations_history(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,before_at timestamptz,before_id uuid,page_size integer) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE selected record; entries jsonb:='[]'; cursor jsonb:=NULL; count integer:=0; more boolean:=false;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 20 OR (before_at IS NULL)<>(before_id IS NULL) OR (before_at IS NOT NULL AND NOT isfinite(before_at)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED'; END IF;
 FOR selected IN SELECT r.id,r.revision,r.recorded_at,w.revision AS worksheet_revision,w.cutover_on,
  jsonb_array_length(r.evidence->'roots') AS item_count
  FROM crest.opening_allocations_schedule_revisions r JOIN crest.opening_worksheet_revisions w ON w.business_id=r.business_id AND w.id=r.worksheet_revision_id
  WHERE r.business_id=business AND (before_at IS NULL OR (r.recorded_at,r.id)<(before_at,before_id))
  ORDER BY r.recorded_at DESC,r.id DESC LIMIT page_size+1 LOOP
  IF count=page_size THEN more:=true;EXIT;END IF;count:=count+1;
  entries:=entries||jsonb_build_array(jsonb_build_object('revisionId',selected.id,'worksheetRevision',selected.worksheet_revision::text,
   'revision',selected.revision::text,'cutoverOn',selected.cutover_on::text,'recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'itemCount',selected.item_count));
  cursor:=jsonb_build_object('recordedAt',to_char(selected.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',selected.id);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'kind','allocations','entries',entries,'nextCursor',CASE WHEN more THEN cursor END);
END $history$;
CREATE FUNCTION crest_commands.read_fictional_opening_allocations_revision(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,revision_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $revision$
DECLARE saved crest.opening_allocations_schedule_revisions; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 IF revision_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_SOURCE_HISTORY_INPUT_REQUIRED';END IF;
 SELECT * INTO saved FROM crest.opening_allocations_schedule_revisions r WHERE r.business_id=business AND r.id=revision_id;
 IF saved.id IS NULL THEN RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'schedule',NULL,'supplierSchedule',NULL);END IF;
 result:=crest_private.opening_allocations_private_response(jsonb_build_object('state','committed','receipt',crest_private.opening_allocations_receipt(saved)));
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'schedule',result->'receipt','supplierSchedule',result->'supplierSchedule');
END $revision$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_opening_allocations_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_allocations_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_allocations_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,timestamptz,uuid,integer),crest_commands.read_fictional_opening_allocations_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/20270214180000_opening_supplier_source_history.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270215180000_opening_supplier_recovery_read.sql
-- HELD: preserve the closed, non-login recovery reader's existing contract.
-- No write, function-execute, membership, login or runtime privilege is added.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_payables_origins,crest.opening_payables_schedule_revisions,
 crest.opening_allocations_origins,crest.opening_allocations_schedule_revisions TO crest_backup_reader;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/20270215180000_opening_supplier_recovery_read.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270216180000_opening_supplier_workspace_export.sql
-- HELD141 workspace export: retained supplier evidence, allocation reviews and versioned export requests.
-- No new financial posting, refund, provider or runtime activation authority.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.business_source_dictionary_v3()
RETURNS TABLE(source_name text,fields text[],business_column text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 SELECT * FROM crest_private.business_source_dictionary_v2()
 UNION ALL SELECT * FROM (VALUES
 ('crest.opening_payables_origins',ARRAY['id','business_id','source_namespace','external_id','vendor','operation_id','recorded_by','recorded_at'],'business_id'),
 ('crest.opening_payables_schedule_revisions',ARRAY['id','business_id','worksheet_revision_id','revision','prior_revision','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],'business_id'),
 ('crest.opening_allocations_origins',ARRAY['id','business_id','source_namespace','external_id','vendor','kind','reference','operation_id','recorded_by','recorded_at'],'business_id'),
 ('crest.opening_allocations_schedule_revisions',ARRAY['id','business_id','worksheet_revision_id','payables_revision','revision','prior_revision','operation_id','audit_event_id','recorded_by','recorded_at','evidence','evidence_sha256'],'business_id')) AS added(source_name,fields,business_column);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.business_source_dictionary_v3() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.business_source_dictionary_v3() TO crest_business_source_owner;
DO $grant$
DECLARE d record; source_oid oid; projection text;
BEGIN
 FOR d IN SELECT * FROM crest_private.business_source_dictionary_v3() WHERE source_name IN('crest.opening_payables_origins','crest.opening_payables_schedule_revisions','crest.opening_allocations_origins','crest.opening_allocations_schedule_revisions') LOOP
  source_oid:=to_regclass(d.source_name);
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=source_oid AND relkind='r'
   AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR NOT EXISTS(SELECT FROM pg_index i WHERE i.indrelid=source_oid AND i.indisprimary
    AND NOT EXISTS(SELECT FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid=source_oid AND a.attnum=k WHERE NOT a.attname=ANY(d.fields)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO projection FROM unnest(d.fields) field;
  EXECUTE format('GRANT SELECT(%s) ON %s TO crest_business_source_owner',projection,source_oid::regclass);
  EXECUTE format('CREATE POLICY current_business_source_scope ON %s FOR SELECT TO crest_business_source_owner USING(%I=nullif(current_setting(''crest.business_source_business'',true),'''')::uuid)',source_oid::regclass,d.business_column);
 END LOOP;
END $grant$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_business_source_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.business_source_page_v3(requested_business uuid,requested_source text,expected_snapshot text,after_key text[],page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' SET bytea_output='hex' SET extra_float_digits=3 AS $source$
DECLARE d record; source_oid oid; pk text[]; projection text; key_sql text; keys jsonb; data jsonb; snapshot_value text; token text; next_cursor jsonb; types jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF page_size IS NULL OR page_size<1 OR page_size>100 OR requested_business IS NULL
  OR (after_key IS NOT NULL AND (expected_snapshot IS NULL OR cardinality(after_key)<1 OR cardinality(after_key)>16 OR array_position(after_key,NULL) IS NOT NULL))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT * INTO d FROM crest_private.business_source_dictionary_v3() WHERE source_name=requested_source;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('crest.business.rows/2',requested_business,pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
 IF expected_snapshot IS NOT NULL AND expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_CHANGED'; END IF;
 source_oid:=to_regclass(d.source_name);
 SELECT array_agg(a.attname::text ORDER BY k.position) INTO pk FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number WHERE i.indrelid=source_oid AND i.indisprimary;
 IF pk IS NULL OR cardinality(pk)>16 OR after_key IS NOT NULL AND cardinality(after_key)<>cardinality(pk)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT string_agg(format('%L,%s',field,CASE WHEN a.atttypid='timestamptz'::regtype
  THEN format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',field)
  ELSE format('t.%I::text',field) END),',' ORDER BY position),
  jsonb_object_agg(field,format_type(a.atttypid,a.atttypmod)) INTO projection,types
  FROM unnest(d.fields) WITH ORDINALITY f(field,position) JOIN pg_attribute a ON a.attrelid=source_oid AND a.attname=field;
 SELECT 'ARRAY['||string_agg(format('t.%I::text',field),',' ORDER BY position)||']::text[]' INTO key_sql FROM unnest(pk) WITH ORDINALITY f(field,position);
 EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),''[]''::jsonb),coalesce(jsonb_agg(to_jsonb(key) ORDER BY key COLLATE "C"),''[]''::jsonb) FROM (SELECT %s AS key,jsonb_build_object(%s) AS value FROM %s t WHERE t.%I=$1 AND ($2::text[] IS NULL OR (%s COLLATE "C")>($2::text[] COLLATE "C")) ORDER BY %s COLLATE "C" LIMIT $3) bounded',key_sql,projection,source_oid::regclass,d.business_column,key_sql,key_sql)
  INTO data,keys USING requested_business,after_key,page_size+1;
 IF jsonb_array_length(data)>page_size THEN data:=data-page_size;next_cursor:=keys->(page_size-1); END IF;
 IF octet_length(data::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'source',requested_source,'snapshotToken',token,
  'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'columns',d.fields,'types',types,'primaryKey',pk,'rows',data,'nextCursor',next_cursor);
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.business_source_page_v3(uuid,text,text,text[],integer) OWNER TO crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_commands.business_source_page_v3(uuid,text,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_source_page_v3(uuid,text,text,text[],integer) TO crest_export;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_business_source_owner;

-- Versioned workspace export jobs141; old request writers and receipts retained.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.export_jobs DROP CONSTRAINT export_jobs_profile_schema_check;
ALTER TABLE crest_private.export_jobs ADD CONSTRAINT export_jobs_profile_schema_check CHECK((profile='crest.business-source-journal-bundle.v1' AND source_schema_version=43) OR(profile='crest.current-business-source-bundle.v1' AND source_schema_version IN(134,135,136,137,138,140,141)));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_source_schema_version_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_source_schema_version_check CHECK(source_schema_version IN(43,134,135,136,137,138,140,141));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_request_text_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_request_text_check CHECK(octet_length(request_text) BETWEEN 1 AND (CASE WHEN source_schema_version IN(136,137,138,140,141) THEN 33554432 ELSE 1048576 END));
CREATE OR REPLACE FUNCTION crest_private.source_export_snapshot_plan(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE maximum_bytes integer:=CASE WHEN j.source_schema_version IN(136,137,138,140,141) THEN 33554432 ELSE 1048576 END;r jsonb;p jsonb;f jsonb;names text[]:=ARRAY[]::text[];ids text[]:=ARRAY[]::text[];previous_name text;name text;n bigint:=0;position integer:=0;stamp timestamptz;plan_text text;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND maximum_bytes OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;p:=r->'plan';plan_text:=(original::json->'plan')::text;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256'])
 OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR r->>'planSha256' IS DISTINCT FROM encode(sha256(convert_to(plan_text,'UTF8')),'hex')
 OR NOT crest_private.export_json_object(p,ARRAY['formatVersion','claim','generationId','observedAt','appReleaseId','sourceSchemaVersion','manifestSha256','parts','totalBytes','referenceClosureComplete','completePortableExport','completeBackup']||CASE WHEN j.source_schema_version IN(136,137,138,140,141) THEN ARRAY['originals'] ELSE ARRAY[]::text[] END)
 OR p->'formatVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.source_export_claim_matches(p->'claim',j) OR NOT crest_private.export_json_uuid(p->'generationId')
 OR p->'appReleaseId' IS DISTINCT FROM to_jsonb(j.app_release_id) OR p->'sourceSchemaVersion' IS DISTINCT FROM to_jsonb(j.source_schema_version)
 OR p->'referenceClosureComplete' IS DISTINCT FROM 'false'::jsonb OR p->'completePortableExport' IS DISTINCT FROM 'false'::jsonb OR p->'completeBackup' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(p->'manifestSha256') IS DISTINCT FROM 'string' OR coalesce(p->>'manifestSha256','')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(p->'observedAt') IS DISTINCT FROM 'string' OR coalesce(p->>'observedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?\+00:00$'
 OR jsonb_typeof(p->'parts') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'totalBytes') IS DISTINCT FROM 'number' OR coalesce(p->>'totalBytes','')!~'^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 IF jsonb_array_length(p->'parts') NOT BETWEEN 2 AND 1024 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 stamp:=(p->>'observedAt')::timestamptz;
 IF NOT isfinite(stamp) OR stamp>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM crest_private.export_job_attempts a WHERE a.business_id=j.business_id AND a.export_job_id=j.id AND a.id=j.lease_id AND a.leased_at<=stamp) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'parts') LOOP
  position:=position+1;
  IF NOT crest_private.export_json_object(f,ARRAY['partId','fileName','contentType','bytes','sha256']) OR NOT crest_private.export_json_uuid(f->'partId')
  OR jsonb_typeof(f->'fileName') IS DISTINCT FROM 'string' OR coalesce(f->>'fileName','')!~'^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$'
  OR jsonb_typeof(f->'bytes') IS DISTINCT FROM 'number' OR coalesce(f->>'bytes','')!~'^[1-9][0-9]{0,6}$' OR (f->>'bytes')::bigint>8388608
  OR jsonb_typeof(f->'sha256') IS DISTINCT FROM 'string' OR coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$'
  OR f->'contentType' IS DISTINCT FROM to_jsonb(CASE WHEN right(f->>'fileName',4)='.csv' THEN 'text/csv; charset=utf-8' WHEN right(f->>'fileName',5)='.json' THEN 'application/json' ELSE 'text/plain; charset=utf-8' END)
  OR f->>'fileName'=ANY(names) OR f->>'partId'=ANY(ids) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
  name:=f->>'fileName';
  IF position=jsonb_array_length(p->'parts') THEN
   IF name<>'source_manifest.json' OR f->'sha256' IS DISTINCT FROM p->'manifestSha256' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
  ELSIF name='source_manifest.json' OR previous_name IS NOT NULL AND name COLLATE "C"<=previous_name COLLATE "C" THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
  END IF;
  previous_name:=name;names:=array_append(names,name);ids:=array_append(ids,f->>'partId');n:=n+(f->>'bytes')::bigint;
 END LOOP;
 IF n<>(p->>'totalBytes')::bigint OR n>67108864 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 IF j.source_schema_version IN(136,137,138,140,141) AND crest_private.source_export_original_index_valid(p->'originals') IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_ORIGINAL_INDEX_REQUIRED';END IF;
 RETURN p;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
END $$;
CREATE OR REPLACE FUNCTION crest_private.source_export_receipt(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE o crest_private.operations;r jsonb;a record;expected_command jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 r:=o.result;
 IF o.command_type NOT IN('export.request','export.claim','export.expire','export.stop','export.ready') OR o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR r IS NULL OR jsonb_typeof(r)<>'object' OR NOT(r?&ARRAY['schemaVersion','command','job','auditEventId']) OR r-ARRAY['schemaVersion','command','job','auditEventId']<>'{}'::jsonb OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(r->'job') IS DISTINCT FROM 'object' OR r->'job'->>'business_id' IS DISTINCT FROM business::text OR r->'job'->>'operation_id' IS DISTINCT FROM operation::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 SELECT id,delta INTO a FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id::text=r->>'auditEventId' AND entity_kind='export_jobs' AND entity_id::text=r->'job'->>'id' AND entity_version::text=r->'job'->>'version' AND action=split_part(o.command_type,'.',2) AND delta->'after'=r->'job';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 IF o.command_type='export.ready' THEN
  SELECT crest_private.source_export_ready_command(business,o.recovery_epoch,operation,(r->'job'->>'id')::uuid,c.expected_version::text,c.lease_id,c.generation_id,c.request_sha256) INTO expected_command FROM crest_private.export_job_completions c WHERE c.business_id=business AND c.export_job_id=(r->'job'->>'id')::uuid AND c.operation_id=operation AND c.actor_id=actor AND c.expected_version::text=a.delta->'before'->>'version' AND c.lease_id::text=a.delta->'before'->>'lease_id' AND a.delta->'before'->>'state'='Running' AND r->'job'->>'state'='Ready';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 ELSE
 expected_command:=crest_private.source_export_command(o.command_type,business,o.recovery_epoch,operation,(r->'job'->>'id')::uuid,a.delta->'before'->>'version',CASE WHEN o.command_type='export.claim' THEN (a.delta->'after'->>'lease_id')::uuid WHEN o.command_type='export.expire' THEN (a.delta->'before'->>'lease_id')::uuid ELSE NULL END,CASE WHEN o.command_type='export.request' THEN r->'job'->>'app_release_id' ELSE NULL END);
 END IF;
 IF o.command_type='export.request' AND r->'job'->>'profile'='crest.current-business-source-bundle.v1' AND r->'job'->'source_schema_version' IN('134'::jsonb,'135'::jsonb,'136'::jsonb,'137'::jsonb,'138'::jsonb,'140'::jsonb,'141'::jsonb) THEN
  expected_command:=jsonb_set(jsonb_set(expected_command,'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}',r->'job'->'source_schema_version');
 END IF;
 IF r->'command' IS DISTINCT FROM expected_command THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $$;
CREATE OR REPLACE FUNCTION crest_private.source_export_request_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 RETURN coalesce(v?&ARRAY['schemaVersion','businessId','commandType','reference'] AND v-ARRAY['schemaVersion','businessId','commandType','reference']='{}'::jsonb
 AND v->'schemaVersion'='1'::jsonb AND crest_private.original_operation_uuid(v->'businessId') AND v->>'commandType'='export.request'
 AND jsonb_typeof(v->'reference')='object'
 AND v->'reference'?&ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']
 AND (v->'reference')-ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']='{}'::jsonb
 AND crest_private.original_operation_uuid(v->'reference'->'operationId') AND crest_private.original_operation_uuid(v->'reference'->'recoveryEpoch') AND crest_private.original_operation_uuid(v->'reference'->'exportJobId')
 AND jsonb_typeof(v->'reference'->'appReleaseId')='string' AND v->'reference'->>'appReleaseId'~'^[a-f0-9]{40}$'
 AND ((v->'reference'->>'profile'='crest.business-source-journal-bundle.v1' AND v->'reference'->'sourceSchemaVersion'='43'::jsonb) OR (v->'reference'->>'profile'='crest.current-business-source-bundle.v1' AND v->'reference'->'sourceSchemaVersion' IN('134'::jsonb,'135'::jsonb,'136'::jsonb,'137'::jsonb,'138'::jsonb,'140'::jsonb,'141'::jsonb))),false);
END $$;
CREATE FUNCTION crest_commands.request_current_source_export_v7_for_execution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_job uuid,requested_release text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;j crest_private.export_jobs;after_state jsonb;event uuid;receipt jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_job IS NULL OR requested_release IS NULL OR requested_release!~'^[a-f0-9]{40}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 -- Actor/business/session-update precedes recovery and the original operation
 -- key. No lock spans provider, collection or object-store I/O.
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 context:=crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 -- Exactly the unchanged schema43 request writer's canonical payload hash.
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType','export.request','businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',NULL::text,'leaseId',NULL::uuid,'appReleaseId',requested_release,'profile','crest.current-business-source-bundle.v1','sourceSchemaVersion',141)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'export.request',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
   IF existing.id IS NULL OR existing.actor_id IS DISTINCT FROM expected_actor OR existing.command_type IS DISTINCT FROM 'export.request' OR existing.recovery_epoch IS DISTINCT FROM expected_epoch OR existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.source_export_receipt(requested_business,expected_actor,requested_operation);
   PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
   RETURN jsonb_build_object('state','recorded','result',result);
  END IF;
  INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(requested_job,requested_business,expected_actor,'crest.current-business-source-bundle.v1',requested_release,141,expected_epoch,requested_operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO j;
  after_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'export_jobs',requested_job,j.version,'request',jsonb_build_object('schemaVersion',1,'before',NULL,'after',after_state),'manual') RETURNING id INTO event;
  receipt:=jsonb_build_object('schemaVersion',1,'command',jsonb_set(jsonb_set(crest_private.source_export_command('export.request',requested_business,expected_epoch,requested_operation,requested_job,NULL::text,NULL::uuid,requested_release),'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}','141'::jsonb),'job',after_state,'auditEventId',event);
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
  result:=crest_private.source_export_receipt(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  -- Keep the original verified scope through deferred audit checks at COMMIT.
  RETURN jsonb_build_object('state','created','result',result);
 EXCEPTION WHEN unique_violation THEN
  PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  RETURN jsonb_build_object('state','conflict','reason','active_or_identity');
 END;
END $$;
REVOKE ALL ON FUNCTION crest_commands.request_current_source_export_v7_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_current_source_export_v7_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.request_current_source_export_v7_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_source_export_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;original jsonb;original_index jsonb;matches jsonb;
BEGIN
 IF requested_attachment IS NULL OR requested_kind IS NULL OR requested_kind NOT IN('expense_receipt','supplier_document','condition_photo') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 IF context->'header'->>'profile' IS DISTINCT FROM 'crest.current-business-source-bundle.v1'
 OR (context->'header'->>'sourceSchemaVersion')::integer NOT IN(136,137,138,140,141)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT request_text::jsonb->'plan'->'originals' INTO original_index FROM crest_private.export_job_snapshots WHERE business_id=requested_business AND export_job_id=requested_job AND generation_id=requested_generation;
 IF NOT FOUND OR original_index->>'profile' IS DISTINCT FROM 'crest.source-export-original-index.v1' OR jsonb_typeof(original_index->'files') IS DISTINCT FROM 'array'
 OR coalesce(original_index->>'inventorySha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO matches FROM jsonb_array_elements(original_index->'files') WHERE value->>'kind'=requested_kind AND value->>'attachmentId'=requested_attachment::text;
 IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_OUTSIDE_SNAPSHOT';END IF;
 original:=crest_private.current_source_export_original(requested_business,requested_kind,requested_attachment);
 IF original->'file' IS DISTINCT FROM matches->0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 IF crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) IS DISTINCT FROM context
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 RETURN jsonb_build_object('profile','crest.source-export-original-permit.v1','header',context->'header','authority',context->'authority','indexSha256',original_index->'inventorySha256','file',original->'file','object',original->'object');
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/20270216180000_opening_supplier_workspace_export.sql
