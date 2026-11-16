-- Held approval for a first dedicated statement with a verified zero opening.
-- Capture the exact computed plan and match children. Current use is gated by
-- a fresh plan comparison. Later statement continuity requires its own proof.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.statement_reconciliations (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 account_id uuid NOT NULL,
 statement_id uuid NOT NULL,
 draft_revision bigint NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 operation_id uuid NOT NULL,
 approved_by uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(approved_at)),
 reason text NOT NULL CHECK(char_length(reason) BETWEEN 1 AND 1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),
 UNIQUE(business_id,id,statement_id),UNIQUE(business_id,account_id,generation),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,statement_id,draft_revision) REFERENCES crest.statement_match_draft_revisions(business_id,statement_id,revision),
 FOREIGN KEY(business_id,operation_id,approved_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.statement_reconciliation_allocations (
 business_id uuid NOT NULL,
 reconciliation_id uuid NOT NULL,
 statement_id uuid NOT NULL,
 statement_row_id uuid NOT NULL,
 movement_id uuid NOT NULL,
 signed_cents bigint NOT NULL CHECK(signed_cents<>0),
 PRIMARY KEY(business_id,reconciliation_id,statement_row_id,movement_id),
 FOREIGN KEY(business_id,reconciliation_id,statement_id) REFERENCES crest.statement_reconciliations(business_id,id,statement_id),
 FOREIGN KEY(business_id,statement_id,statement_row_id) REFERENCES crest.statement_import_rows(business_id,statement_id,id),
 FOREIGN KEY(business_id,movement_id) REFERENCES crest.money_movements(business_id,id)
);
DO $scope$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['statement_reconciliations','statement_reconciliation_allocations'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_finance_account_owner',name);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',name);
  EXECUTE format('CREATE POLICY initial_reconciliation_scope ON crest.%I FOR SELECT TO crest_finance_account_owner
   USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY initial_reconciliation_integrity ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',name);
  EXECUTE format('CREATE POLICY initial_reconciliation_append ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND EXISTS(SELECT FROM crest_private.operations o
    WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.command_type=''finance.statement_reconciliation.approve'' AND o.state=''pending''))',name);
  EXECUTE format('CREATE TRIGGER initial_reconciliation_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
   FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',name);
 END LOOP;
END $scope$;
CREATE POLICY initial_reconciliation_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type='finance.statement_reconciliation.approve' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY initial_reconciliation_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.statement_reconciliation.approve');
CREATE POLICY initial_reconciliation_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type='finance.statement_reconciliation.approve' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY initial_reconciliation_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type='finance.statement_reconciliation.approve' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='finance.statement_reconciliation.approve' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY initial_reconciliation_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='statement_reconciliations');
CREATE POLICY initial_reconciliation_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(entity_kind='statement_reconciliations' AND action='review' AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE FUNCTION crest_private.initial_reconciliation_receipt(r crest.statement_reconciliations)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',r.business_id,'accountId',r.account_id,'statementId',r.statement_id,
  'reconciliationId',r.id,'generation',r.generation::text,'draftRevision',r.draft_revision::text,
  'operationId',r.operation_id,'approvedBy',r.approved_by,'approvedAt',to_char(r.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'planSha256',r.plan->>'planSha256');
$receipt$;
REVOKE ALL ON FUNCTION crest_private.initial_reconciliation_receipt(crest.statement_reconciliations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.initial_reconciliation_receipt(crest.statement_reconciliations)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_initial_reconciliation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE row_id uuid; r crest.statement_reconciliations; receipt jsonb; prior jsonb;
BEGIN
 IF TG_TABLE_NAME='statement_reconciliations' THEN row_id:=NEW.id; ELSE row_id:=NEW.reconciliation_id; END IF;
 SELECT * INTO STRICT r FROM crest.statement_reconciliations a WHERE (a.business_id,a.id)=(NEW.business_id,row_id);
 receipt:=crest_private.initial_reconciliation_receipt(r);
 SELECT crest_private.initial_reconciliation_receipt(a) INTO prior FROM crest.statement_reconciliations a
 WHERE (a.business_id,a.account_id,a.generation)=(r.business_id,r.account_id,r.generation-1);
 IF (r.generation<>1) IS DISTINCT FROM (prior IS NOT NULL)
  OR prior IS NOT NULL AND prior->>'statementId' IS DISTINCT FROM r.statement_id::text
  OR r.plan->'readyForApprovalReview' IS DISTINCT FROM 'true'::jsonb
  OR r.plan->>'planSha256' IS DISTINCT FROM encode(sha256(convert_to((r.plan-'planSha256')::text,'UTF8')),'hex')
  OR r.plan->>'businessId' IS DISTINCT FROM r.business_id::text OR r.plan->>'statementId' IS DISTINCT FROM r.statement_id::text
  OR r.plan->>'accountId' IS DISTINCT FROM r.account_id::text OR r.plan->>'draftRevision' IS DISTINCT FROM r.draft_revision::text
  OR NOT EXISTS(SELECT FROM crest.statement_match_draft_revisions d WHERE (d.business_id,d.statement_id,d.revision)=
    (r.business_id,r.statement_id,r.draft_revision) AND d.allocations=r.plan->'allocations' AND d.operation_id::text=r.plan->>'draftOperationId')
  OR EXISTS(
   WITH intended AS (SELECT (x->>'statementRowId')::uuid AS statement_row_id,(x->>'movementId')::uuid AS movement_id,
    (x->>'signedCents')::bigint AS signed_cents FROM jsonb_array_elements(r.plan->'allocations') x),
   retained AS (SELECT a.statement_row_id,a.movement_id,a.signed_cents FROM crest.statement_reconciliation_allocations a
    WHERE (a.business_id,a.reconciliation_id)=(r.business_id,r.id))
   (SELECT * FROM intended EXCEPT ALL SELECT * FROM retained) UNION ALL (SELECT * FROM retained EXCEPT ALL SELECT * FROM intended))
  OR NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
   WHERE (o.business_id,o.operation_id,o.actor_id)=(r.business_id,r.operation_id,r.approved_by)
    AND o.command_type='finance.statement_reconciliation.approve' AND o.state='committed' AND o.result=receipt
    AND a.entity_kind='statement_reconciliations' AND a.entity_id=r.id AND a.entity_version=r.generation
    AND a.action='review' AND a.reason=r.reason AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',receipt))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_RECONCILIATION_APPROVAL_PROOF_REQUIRED'; END IF;
 RETURN NULL;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_initial_reconciliation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_initial_reconciliation() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER initial_reconciliation_approval_proof AFTER INSERT ON crest.statement_reconciliations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_initial_reconciliation();
CREATE CONSTRAINT TRIGGER initial_reconciliation_allocation_proof AFTER INSERT ON crest.statement_reconciliation_allocations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_initial_reconciliation();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.approve_fictional_initial_statement_reconciliation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_reconciliation uuid,requested_statement uuid,requested_revision bigint,
 expected_generation bigint,expected_plan_sha256 text,timing_evidence jsonb,approval_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $approve$
DECLARE digest text; claimed uuid; saved record; plan jsonb; previous crest.statement_reconciliations;
 approved crest.statement_reconciliations; receipt jsonb; account uuid;
BEGIN
 IF requested_operation IS NULL OR requested_reconciliation IS NULL OR requested_statement IS NULL OR requested_revision IS NULL
  OR requested_revision<1 OR expected_generation IS NULL OR expected_generation NOT BETWEEN 0 AND 9223372036854775806
  OR expected_plan_sha256 IS NULL OR expected_plan_sha256!~'^[a-f0-9]{64}$'
  OR jsonb_typeof(timing_evidence) IS DISTINCT FROM 'array' OR octet_length(timing_evidence::text)>30000
  OR approval_reason IS NULL OR char_length(approval_reason) NOT BETWEEN 1 AND 1000 OR approval_reason<>btrim(approval_reason)
  OR approval_reason~'[[:cntrl:]]'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_RECONCILIATION_APPROVAL_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.statement_reconciliation.approve',1,requested_business,
  expected_actor,expected_epoch,requested_reconciliation,requested_statement,requested_revision,expected_generation,expected_plan_sha256,
  timing_evidence,approval_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.statement_reconciliation.approve',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.result INTO saved FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type='finance.statement_reconciliation.approve' AND o.recovery_epoch=expected_epoch AND o.state='committed';
  IF NOT FOUND OR saved.payload_hash IS DISTINCT FROM digest
  THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 plan:=crest_commands.review_fictional_initial_statement_reconciliation($1,$2,$3,$4,$5,$6,$7,$8,
  requested_statement,requested_revision,timing_evidence);
 IF plan->'readyForApprovalReview' IS DISTINCT FROM 'true'::jsonb
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_RECONCILIATION_NEEDS_REVIEW'; END IF;
 IF plan->>'planSha256' IS DISTINCT FROM expected_plan_sha256
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='STATEMENT_RECONCILIATION_PLAN_CHANGED'; END IF;
 account:=(plan->>'accountId')::uuid;
 SELECT * INTO previous FROM crest.statement_reconciliations a WHERE (a.business_id,a.account_id)=(requested_business,account)
  ORDER BY a.generation DESC LIMIT 1;
 IF coalesce(previous.generation,0)<>expected_generation
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='STATEMENT_RECONCILIATION_GENERATION_CHANGED'; END IF;
 IF previous.id IS NOT NULL AND previous.statement_id IS DISTINCT FROM requested_statement
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_RECONCILIATION_CONTINUITY_REQUIRED'; END IF;
 IF previous.plan->>'planSha256'=expected_plan_sha256
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='STATEMENT_RECONCILIATION_ALREADY_CURRENT'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 INSERT INTO crest.statement_reconciliations(id,business_id,account_id,statement_id,draft_revision,generation,operation_id,approved_by,reason,plan)
 VALUES(requested_reconciliation,requested_business,account,requested_statement,requested_revision,expected_generation+1,
  requested_operation,expected_actor,approval_reason,plan) RETURNING * INTO approved;
 INSERT INTO crest.statement_reconciliation_allocations(business_id,reconciliation_id,statement_id,statement_row_id,movement_id,signed_cents)
 SELECT requested_business,requested_reconciliation,requested_statement,(x->>'statementRowId')::uuid,(x->>'movementId')::uuid,
  (x->>'signedCents')::bigint FROM jsonb_array_elements(plan->'allocations') x;
 receipt:=crest_private.initial_reconciliation_receipt(approved);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'statement_reconciliations',approved.id,approved.generation,
  'review',approval_reason,jsonb_build_object('schemaVersion',1,'before',CASE WHEN previous.id IS NOT NULL
   THEN crest_private.initial_reconciliation_receipt(previous) END,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
  WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $approve$;

CREATE FUNCTION crest_commands.read_fictional_initial_statement_reconciliation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_statement uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE prior crest.statement_reconciliations; latest_revision bigint; notes jsonb; current_plan jsonb;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 -- Serialize with changes to signed money and matching evidence.
 PERFORM FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 SELECT * INTO prior FROM crest.statement_reconciliations a WHERE (a.business_id,a.statement_id)=(requested_business,requested_statement)
  ORDER BY a.generation DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT max(d.revision) INTO latest_revision FROM crest.statement_match_draft_revisions d
  WHERE (d.business_id,d.statement_id)=(requested_business,requested_statement);
 SELECT coalesce(jsonb_agg(item-ARRAY['eventId','effectiveOn','signedCents'] ORDER BY item->>'movementId'),'[]'::jsonb)
  INTO notes FROM jsonb_array_elements(prior.plan->'timingItems') item;
 current_plan:=crest_commands.review_fictional_initial_statement_reconciliation($1,$2,$3,$4,$5,$6,$7,$8,
  requested_statement,latest_revision,notes);
 RETURN jsonb_build_object('state',CASE WHEN current_plan->>'planSha256'=prior.plan->>'planSha256' THEN 'current' ELSE 'needs_review' END,
  'receipt',crest_private.initial_reconciliation_receipt(prior),'currentPlanSha256',current_plan->>'planSha256');
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.approve_fictional_initial_statement_reconciliation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,jsonb,text),
 crest_commands.read_fictional_initial_statement_reconciliation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.approve_fictional_initial_statement_reconciliation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,bigint,text,jsonb,text),
 crest_commands.read_fictional_initial_statement_reconciliation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_finance_preview;
