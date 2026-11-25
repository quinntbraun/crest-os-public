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

