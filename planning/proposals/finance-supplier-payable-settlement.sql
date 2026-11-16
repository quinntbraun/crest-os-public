-- Held P15 for confirmed outflows from a verified dedicated business channel.
-- The accrued cost stays in its original period, and the payable control balance
-- derives from immutable P14 and P15 records. Link provider evidence only once.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.supplier_payable_settlements (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 payable_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 actual_on date NOT NULL CHECK(isfinite(actual_on)),
 paid_cents bigint NOT NULL CHECK(paid_cents>0),
 remaining_before_cents bigint NOT NULL CHECK(remaining_before_cents>=paid_cents),
 confirmation text NOT NULL CHECK(char_length(confirmation)>=1 AND char_length(confirmation)<=1000 AND confirmation=btrim(confirmation)
  AND confirmation!~'[[:cntrl:]]'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,operation_id),UNIQUE(business_id,evidence_id),
 FOREIGN KEY(business_id,payable_id) REFERENCES crest.supplier_payables(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,evidence_id) REFERENCES crest.external_money_evidence(business_id,id)
);
CREATE INDEX supplier_settlement_by_payable ON crest.supplier_payable_settlements(business_id,payable_id);
ALTER TABLE crest.supplier_payable_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_payable_settlements FORCE ROW LEVEL SECURITY;
CREATE TRIGGER supplier_settlement_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.supplier_payable_settlements
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.supplier_payable_settlements TO crest_finance_account_owner;
GRANT SELECT ON crest.supplier_payable_settlements TO crest_finance_integrity_owner;
CREATE POLICY supplier_settlement_scope ON crest.supplier_payable_settlements FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY supplier_settlement_integrity ON crest.supplier_payable_settlements FOR SELECT TO crest_finance_integrity_owner USING(true);

ALTER TABLE crest.financial_events ADD COLUMN supplier_payable_settlement_id uuid;
ALTER TABLE crest.financial_events ADD CONSTRAINT supplier_settlement_event_source FOREIGN KEY(business_id,supplier_payable_settlement_id)
 REFERENCES crest.supplier_payable_settlements(business_id,id);
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,supplier_payable_settlement_id);
ALTER TABLE crest.journal_lines ADD COLUMN supplier_payable_settlement_id uuid;
ALTER TABLE crest.journal_lines ADD CONSTRAINT supplier_settlement_line_source FOREIGN KEY(business_id,supplier_payable_settlement_id)
 REFERENCES crest.supplier_payable_settlements(business_id,id);
DO $constraints$
DECLARE event_predicate text; line_predicate text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT event_predicate FROM pg_constraint
  WHERE conrelid='crest.financial_events'::regclass AND conname='finance_event_typed_source';
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT line_predicate FROM pg_constraint
  WHERE conrelid='crest.journal_lines'::regclass AND conname='finance_journal_line_typed_source';
 ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
 EXECUTE 'ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(
  (supplier_payable_settlement_id IS NULL AND ('||event_predicate||')) OR
  (supplier_payable_settlement_id IS NOT NULL AND template=''P15'' AND template_version=1
   AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,
    invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,
    collection_failure_recredit_id,collection_failure_settlement_id,supplier_payable_id,zero_effect_reason)=0))';
 ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
 EXECUTE 'ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(
  (supplier_payable_settlement_id IS NULL AND ('||line_predicate||')) OR
  (supplier_payable_settlement_id IS NOT NULL AND num_nonnulls(invoice_item_id,receivable_id,tax_payable_movement_id,
    allocation_event_id,unapplication_id,fund_lot_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,
    excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id,refund_transfer_adjustment_id,
    collection_failure_recredit_id,collection_failure_settlement_id,collection_failure_settlement_component_id,supplier_payable_id)=0
   AND ((purpose=''supplier_settlement_payable'' AND fixed_mapping_id IS NOT NULL AND money_movement_id IS NULL
      AND debit_cents>0 AND credit_cents=0)
    OR (purpose=''supplier_settlement_money'' AND money_movement_id IS NOT NULL AND fixed_mapping_id IS NULL
      AND debit_cents=0 AND credit_cents>0))))';
END $constraints$;

CREATE POLICY supplier_settlement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type='finance.supplier_bill.settle' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY supplier_settlement_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.supplier_bill.settle');
CREATE POLICY supplier_settlement_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type='finance.supplier_bill.settle' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY supplier_settlement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type='finance.supplier_bill.settle' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='finance.supplier_bill.settle' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY supplier_settlement_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='supplier_payable_settlements');
CREATE POLICY supplier_settlement_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(entity_kind='supplier_payable_settlements' AND action='post' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
DO $writers$
DECLARE target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['supplier_payable_settlements','atomic_finance_groups','financial_events','journal_entries',
  'journal_lines','external_money_evidence','money_movements'] LOOP
  EXECUTE format('CREATE POLICY supplier_settlement_append ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND EXISTS(SELECT FROM crest_private.operations o
    WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.command_type=''finance.supplier_bill.settle'' AND o.state=''pending''))',target);
 END LOOP;
END $writers$;

CREATE FUNCTION crest_private.supplier_settlement_receipt(s crest.supplier_payable_settlements,event_id uuid,movement_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',s.business_id,'payableId',s.payable_id,'settlementId',s.id,
  'operationId',s.operation_id,'actualOn',s.actual_on,'paidCents',s.paid_cents::text,
  'remainingCents',(s.remaining_before_cents-s.paid_cents)::text,'channelVersionId',s.channel_version_id,
  'evidenceId',s.evidence_id,'eventId',event_id,'movementId',movement_id);
$receipt$;
REVOKE ALL ON FUNCTION crest_private.supplier_settlement_receipt(crest.supplier_payable_settlements,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.supplier_settlement_receipt(crest.supplier_payable_settlements,uuid,uuid)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_supplier_payable_settlement(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE e crest.financial_events; s crest.supplier_payable_settlements; p crest.supplier_payables;
 g crest.atomic_finance_groups; m crest.money_movements; evidence crest.external_money_evidence;
 channel crest.money_channel_versions; journal_id uuid; expected jsonb; previous_total numeric;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events f WHERE (f.business_id,f.id)=(requested_business,requested_event);
 SELECT * INTO STRICT s FROM crest.supplier_payable_settlements a
  WHERE (a.business_id,a.id)=(requested_business,e.supplier_payable_settlement_id);
 SELECT * INTO STRICT p FROM crest.supplier_payables a WHERE (a.business_id,a.id)=(requested_business,s.payable_id);
 SELECT * INTO STRICT g FROM crest.atomic_finance_groups a WHERE (a.business_id,a.id)=(requested_business,e.group_id);
 SELECT * INTO STRICT m FROM crest.money_movements a WHERE (a.business_id,a.event_id)=(requested_business,requested_event);
 SELECT * INTO STRICT evidence FROM crest.external_money_evidence a WHERE (a.business_id,a.id)=(requested_business,s.evidence_id);
 SELECT * INTO STRICT channel FROM crest.money_channel_versions a WHERE (a.business_id,a.id)=(requested_business,s.channel_version_id);
 SELECT j.id INTO STRICT journal_id FROM crest.journal_entries j WHERE (j.business_id,j.event_id,j.entry_sequence)=(requested_business,requested_event,1);
 SELECT coalesce(sum(earlier.paid_cents),0) INTO previous_total
 FROM crest.supplier_payable_settlements earlier JOIN crest.financial_events f
  ON (f.business_id,f.supplier_payable_settlement_id)=(earlier.business_id,earlier.id)
 JOIN crest.atomic_finance_groups prior ON (prior.business_id,prior.id)=(f.business_id,f.group_id)
 WHERE (earlier.business_id,earlier.payable_id)=(s.business_id,s.payable_id) AND prior.commit_sequence<g.commit_sequence;
 IF e.template<>'P15' OR e.template_version<>1 OR e.event_sequence<>1 OR e.effective_on<>s.actual_on
  OR s.actual_on<(p.review->>'incurredOn')::date OR (g.operation_id,g.created_by) IS DISTINCT FROM (s.operation_id,s.created_by)
  OR p.gross_cents-previous_total<>s.remaining_before_cents OR s.paid_cents>s.remaining_before_cents
  OR (m.account_id,m.evidence_id,m.signed_cents) IS DISTINCT FROM (channel.account_id,s.evidence_id,-s.paid_cents)
  OR (evidence.provider_namespace,evidence.external_account_id,evidence.confirmed_on,evidence.signed_cents,evidence.currency)
   IS DISTINCT FROM (channel.provider_namespace,channel.account_id,s.actual_on,-s.paid_cents,'USD')
  OR (SELECT count(*) FROM crest.financial_events f WHERE (f.business_id,f.group_id)=(g.business_id,g.id))<>1
  OR (SELECT count(*) FROM crest.journal_entries j WHERE (j.business_id,j.event_id)=(e.business_id,e.id))<>1
  OR (SELECT count(*) FROM crest.journal_lines l WHERE (l.business_id,l.entry_id)=(s.business_id,journal_id))<>2
  OR NOT EXISTS(SELECT FROM crest.journal_lines l WHERE (l.business_id,l.entry_id,l.supplier_payable_settlement_id)=(s.business_id,journal_id,s.id)
    AND (l.purpose,l.account_id,l.fixed_mapping_id,l.debit_cents,l.credit_cents)=
     ('supplier_settlement_payable',p.payable_account_id,p.payable_mapping_id,s.paid_cents,0))
  OR NOT EXISTS(SELECT FROM crest.journal_lines l WHERE (l.business_id,l.entry_id,l.supplier_payable_settlement_id)=(s.business_id,journal_id,s.id)
    AND (l.purpose,l.account_id,l.money_movement_id,l.debit_cents,l.credit_cents)=
     ('supplier_settlement_money',m.account_id,m.id,0,s.paid_cents))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_SETTLEMENT_LEDGER_PROOF_REQUIRED'; END IF;
 expected:=crest_private.supplier_settlement_receipt(s,e.id,m.id);
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(s.business_id,s.operation_id,s.created_by)
   AND o.command_type='finance.supplier_bill.settle' AND o.recovery_epoch=g.recovery_epoch AND o.state='committed'
   AND o.result=expected AND a.entity_kind='supplier_payable_settlements' AND a.entity_id=s.id AND a.entity_version=1
   AND a.action='post' AND a.reason=s.confirmation AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_SETTLEMENT_AUDIT_PROOF_REQUIRED'; END IF;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_payable_settlement(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION crest_private.verify_supplier_settlement_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $trigger$
DECLARE event uuid;
BEGIN
 SELECT f.id INTO event FROM crest.financial_events f WHERE (f.business_id,f.supplier_payable_settlement_id)=(NEW.business_id,NEW.id);
 IF event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_SETTLEMENT_EVENT_REQUIRED'; END IF;
 PERFORM crest_private.verify_supplier_payable_settlement(NEW.business_id,event);
 RETURN NULL;
END $trigger$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_settlement_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_settlement_row() TO crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED'; END IF;
 IF saved.collection_failure_settlement_id IS NOT NULL THEN
  PERFORM crest_private.verify_collection_failure_settlement(saved.business_id,saved.id);
  RETURN;
 END IF;
 IF saved.collection_failure_recredit_id IS NOT NULL THEN
  PERFORM crest_private.verify_collection_failure_held_recredit(saved.business_id,saved.id);
  RETURN;
 END IF;
 IF saved.refund_transfer_adjustment_id IS NOT NULL THEN
  PERFORM crest_private.verify_fictional_refund_transfer_adjustment(saved.business_id,saved.id);
  RETURN;
 END IF;
 CASE saved.template
  WHEN 'P01','P02' THEN PERFORM crest_private.verify_invoice_posting(saved.business_id,saved.invoice_id);
  WHEN 'P03' THEN PERFORM crest_private.verify_direct_receipt(saved.business_id,saved.id);
  WHEN 'P04' THEN PERFORM crest_private.verify_fictional_fund_application(saved.business_id,saved.id);
  WHEN 'P05' THEN PERFORM crest_private.verify_fictional_unapplication(saved.business_id,saved.id);
  WHEN 'P06' THEN PERFORM crest_private.verify_fictional_tip_realization(saved.business_id,saved.id);
  WHEN 'P07' THEN PERFORM crest_private.verify_fictional_invoice_credit(saved.business_id,saved.id);
  WHEN 'P08' THEN PERFORM crest_private.verify_fictional_service_refund(saved.business_id,saved.id);
  WHEN 'P09' THEN PERFORM crest_private.verify_fictional_excess_return(saved.business_id,saved.id);
  WHEN 'P10' THEN PERFORM crest_private.verify_fictional_tip_return(saved.business_id,saved.id);
  WHEN 'P11' THEN PERFORM crest_private.verify_fictional_collection_failure(saved.business_id,saved.id);
  WHEN 'P12' THEN PERFORM crest_private.verify_same_day_expense(saved.business_id,saved.id);
  WHEN 'P14' THEN PERFORM crest_private.verify_supplier_payable_accrual(saved.business_id,saved.id);
  WHEN 'P15' THEN PERFORM crest_private.verify_supplier_payable_settlement(saved.business_id,saved.id);
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER supplier_settlement_event_required AFTER INSERT ON crest.supplier_payable_settlements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_settlement_row();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.settle_fictional_supplier_payable(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_settlement uuid,requested_payable uuid,requested_channel uuid,requested_channel_version bigint,
 actual_on date,paid_cents bigint,expected_remaining_cents bigint,reference_namespace text,reference_id text,
 verified_reference text,confirmation text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $settle$
DECLARE authority jsonb; digest text; claimed uuid; previous record; p crest.supplier_payables; channel crest.money_channel_versions;
 period record; remaining bigint; settlement crest.supplier_payable_settlements; evidence_id uuid; group_id uuid; event_id uuid;
 movement_id uuid; journal_id uuid; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_settlement IS NULL OR requested_payable IS NULL OR requested_channel IS NULL
  OR requested_channel_version IS NULL OR requested_channel_version<1 OR actual_on IS NULL
  OR actual_on NOT BETWEEN DATE '1900-01-01' AND DATE '9999-12-31' OR paid_cents IS NULL OR paid_cents<=0
  OR expected_remaining_cents IS NULL OR expected_remaining_cents<paid_cents
  OR reference_namespace IS NULL OR reference_namespace!~'^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
  OR reference_id IS NULL OR char_length(reference_id) NOT BETWEEN 1 AND 200 OR reference_id<>btrim(reference_id)
  OR reference_id~'[[:cntrl:]]' OR verified_reference IS NULL OR char_length(verified_reference) NOT BETWEEN 1 AND 1000
  OR verified_reference<>btrim(verified_reference) OR verified_reference~'[[:cntrl:]]'
  OR confirmation IS NULL OR char_length(confirmation) NOT BETWEEN 1 AND 1000 OR confirmation<>btrim(confirmation)
  OR confirmation~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_SETTLEMENT_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.supplier_bill.settle',1,requested_business,expected_actor,
  expected_epoch,requested_settlement,requested_payable,requested_channel,requested_channel_version,actual_on,paid_cents,
  expected_remaining_cents,reference_namespace,reference_id,verified_reference,confirmation)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.supplier_bill.settle',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.result INTO previous FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type='finance.supplier_bill.settle' AND o.recovery_epoch=expected_epoch AND o.state='committed';
  IF NOT FOUND OR previous.payload_hash IS DISTINCT FROM digest
  THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',previous.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 SELECT * INTO p FROM crest.supplier_payables a WHERE (a.business_id,a.id)=(requested_business,requested_payable);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_SETTLEMENT_PAYABLE_REQUIRED'; END IF;
 IF actual_on<(p.review->>'incurredOn')::date OR actual_on>(clock_timestamp() AT TIME ZONE (authority->>'timezone'))::date
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_SETTLEMENT_ACTUAL_DATE_REQUIRED'; END IF;
 SELECT p.gross_cents-coalesce(sum(s.paid_cents),0) INTO remaining FROM crest.supplier_payable_settlements s
 WHERE (s.business_id,s.payable_id)=(requested_business,requested_payable);
 IF remaining IS DISTINCT FROM expected_remaining_cents OR paid_cents>remaining
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_SETTLEMENT_REMAINING_CHANGED'; END IF;
 SELECT v.* INTO channel FROM crest.money_channel_versions v WHERE v.business_id=requested_business
  AND v.id=crest_private.direct_receipt_channel(requested_business,requested_channel,actual_on,authority->>'timezone');
 IF NOT FOUND OR channel.version<>requested_channel_version
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_SETTLEMENT_VERIFIED_CHANNEL_REQUIRED'; END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,actual_on,authority->>'timezone');
 IF EXISTS(SELECT FROM crest.external_money_evidence e WHERE e.business_id=requested_business
  AND (e.provider_namespace,e.external_account_id,e.id_namespace,e.external_id)=
   (channel.provider_namespace,channel.account_id,reference_namespace,reference_id))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='SUPPLIER_SETTLEMENT_EXTERNAL_ID_ALREADY_RECORDED'; END IF;
 INSERT INTO crest.external_money_evidence(business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,
  normalization_rule,confirmed_on,signed_cents,currency)
 VALUES(requested_business,channel.provider_namespace,channel.account_id,reference_namespace,reference_id,verified_reference,
  'exact_case_v1',actual_on,-paid_cents,'USD') RETURNING id INTO evidence_id;
 INSERT INTO crest.supplier_payable_settlements(id,business_id,payable_id,operation_id,created_by,channel_version_id,evidence_id,
  actual_on,paid_cents,remaining_before_cents,confirmation)
 VALUES(requested_settlement,requested_business,requested_payable,requested_operation,expected_actor,channel.id,evidence_id,
  actual_on,paid_cents,remaining,confirmation) RETURNING * INTO settlement;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
  FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,supplier_payable_settlement_id,period_id,period_generation,
  effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,requested_settlement,period.period_id,period.generation,actual_on,authority->>'timezone','P15',1)
 RETURNING id INTO event_id;
 INSERT INTO crest.money_movements(business_id,event_id,account_id,evidence_id,signed_cents)
 VALUES(requested_business,event_id,channel.account_id,evidence_id,-paid_cents) RETURNING id INTO movement_id;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1) RETURNING id INTO journal_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,fixed_mapping_id,supplier_payable_settlement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,p.payable_account_id,p.payable_mapping_id,requested_settlement,'supplier_settlement_payable',paid_cents,0);
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,money_movement_id,supplier_payable_settlement_id,purpose,debit_cents,credit_cents)
 VALUES(requested_business,journal_id,channel.account_id,movement_id,requested_settlement,'supplier_settlement_money',0,paid_cents);
 receipt:=crest_private.supplier_settlement_receipt(settlement,event_id,movement_id);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'supplier_payable_settlements',requested_settlement,1,
  'post',confirmation,jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $settle$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.settle_fictional_supplier_payable(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,bigint,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.settle_fictional_supplier_payable(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,uuid,bigint,date,bigint,bigint,text,text,text,text) TO crest_finance_preview;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_supplier_payables(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date,after_payable uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $report$
DECLARE authority jsonb; effective_date date; report jsonb;
BEGIN
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 effective_date:=coalesce(through_on,(statement_timestamp() AT TIME ZONE (authority->>'timezone'))::date);
 IF effective_date NOT BETWEEN DATE '1900-01-01' AND (statement_timestamp() AT TIME ZONE (authority->>'timezone'))::date
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_REPORT_DATE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH settled AS (
  SELECT s.payable_id,sum(s.paid_cents) AS paid
  FROM crest.supplier_payable_settlements s JOIN crest.financial_events f
   ON (f.business_id,f.supplier_payable_settlement_id)=(s.business_id,s.id)
  WHERE s.business_id=requested_business AND f.effective_on<=effective_date GROUP BY s.payable_id
 ), balances AS MATERIALIZED (
  SELECT p.id,p.bill_id,p.review->>'vendor' AS vendor,f.effective_on AS incurred_on,(p.review->>'dueOn')::date AS due_on,
   p.gross_cents,coalesce(s.paid,0) AS settled,p.gross_cents-coalesce(s.paid,0) AS remaining
  FROM crest.supplier_payables p JOIN crest.financial_events f ON (f.business_id,f.supplier_payable_id)=(p.business_id,p.id)
  LEFT JOIN settled s ON s.payable_id=p.id
  WHERE p.business_id=requested_business AND f.effective_on<=effective_date
 ), control AS (
  SELECT coalesce(sum(l.credit_cents-l.debit_cents),0) AS book_balance
  FROM crest.journal_lines l JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
  JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id)
  JOIN crest.financial_events f ON (f.business_id,f.id)=(j.business_id,j.event_id)
  WHERE l.business_id=requested_business AND a.control_kind='payable' AND f.effective_on<=effective_date
 ), total AS (
  SELECT coalesce(sum(remaining),0) AS outstanding,count(*) FILTER(WHERE remaining>0) AS open_count,count(*) AS row_count,
   coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]'::jsonb) AS snapshot FROM balances b
 ), page AS (
  SELECT * FROM balances WHERE after_payable IS NULL OR id>after_payable ORDER BY id LIMIT 51
 )
 SELECT jsonb_build_object('schemaVersion',1,'scope','recorded_supplier_payables','businessId',requested_business,
  'throughOn',effective_date,'openCount',total.open_count,'rowCount',total.row_count,'outstandingCents',total.outstanding::text,
  'ledgerPayableCents',control.book_balance::text,'ledgerAgrees',control.book_balance=total.outstanding,
  'sourceSha256',encode(sha256(convert_to(jsonb_build_array(requested_business,effective_date,control.book_balance,total.snapshot)::text,'UTF8')),'hex'),
  'hasMore',(SELECT count(*)>50 FROM page),'rows',(SELECT coalesce(jsonb_agg(jsonb_build_object('payableId',p.id,'billId',p.bill_id,
   'vendor',p.vendor,'incurredOn',p.incurred_on,'dueOn',p.due_on,
   'overdueDays',CASE WHEN p.remaining>0 THEN greatest(effective_date-p.due_on,0) ELSE 0 END,
   'grossCents',p.gross_cents::text,'paidCents',p.settled::text,'remainingCents',p.remaining::text) ORDER BY p.id),'[]'::jsonb)
   FROM (SELECT * FROM page ORDER BY id LIMIT 50) p)) INTO report
 FROM control CROSS JOIN total;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN report;
END $report$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_supplier_payables(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_supplier_payables(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid) TO crest_finance_preview;
