-- Held P14 ledger implementation for ordinary unpaid expenses. Apply after the
-- supplier payable review proposal. Only trusted intake can attest to a stored
-- original. The public-facing draft paths have no write access to that evidence.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.supplier_bill_originals (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 bill_revision bigint NOT NULL,
 document_reference text NOT NULL CHECK(char_length(document_reference)>=1 AND char_length(document_reference)<=200
  AND document_reference=btrim(document_reference) AND document_reference!~'[[:cntrl:]]'),
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 26214400),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png','image/heic')),
 object_key text NOT NULL UNIQUE,
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(verified_at)),
 UNIQUE(business_id,id,bill_id),
 CONSTRAINT supplier_bill_original_object_key CHECK(object_key='supplier-bills/originals/'||business_id::text||'/'||id::text),
 FOREIGN KEY(business_id,bill_id,bill_revision) REFERENCES crest.supplier_bill_draft_revisions(business_id,bill_id,revision)
);
CREATE INDEX supplier_original_digest_lookup ON crest.supplier_bill_originals(business_id,file_sha256);
CREATE TABLE crest.supplier_payables (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 bill_revision bigint NOT NULL,
 original_id uuid NOT NULL,
 payable_account_id uuid NOT NULL,
 payable_mapping_id uuid NOT NULL,
 gross_cents bigint NOT NULL CHECK(gross_cents>0),
 review jsonb NOT NULL CHECK(jsonb_typeof(review)='object' AND octet_length(review::text)<=24000),
 duplicate_payable_ids uuid[] NOT NULL,
 distinct_reason text,
 CHECK((cardinality(duplicate_payable_ids)=0 AND distinct_reason IS NULL) OR
  (cardinality(duplicate_payable_ids)>0 AND distinct_reason IS NOT NULL AND char_length(distinct_reason) BETWEEN 1 AND 1000
   AND distinct_reason=btrim(distinct_reason) AND distinct_reason!~'[[:cntrl:]]')),
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,bill_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,bill_id,bill_revision) REFERENCES crest.supplier_bill_draft_revisions(business_id,bill_id,revision),
 FOREIGN KEY(business_id,original_id,bill_id) REFERENCES crest.supplier_bill_originals(business_id,id,bill_id),
 FOREIGN KEY(business_id,payable_account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,payable_mapping_id) REFERENCES crest.account_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.supplier_bill_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_bill_originals FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_payables FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.supplier_bill_originals,crest.supplier_payables TO crest_finance_account_owner,crest_finance_integrity_owner;
GRANT SELECT ON crest.supplier_bill_draft_revisions TO crest_finance_integrity_owner;
GRANT INSERT ON crest.supplier_payables TO crest_finance_account_owner;
CREATE POLICY supplier_bill_original_scope ON crest.supplier_bill_originals FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY supplier_payable_scope ON crest.supplier_payables FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY supplier_bill_original_integrity ON crest.supplier_bill_originals FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY supplier_bill_draft_payable_integrity ON crest.supplier_bill_draft_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY supplier_payable_integrity ON crest.supplier_payables FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE TRIGGER supplier_original_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.supplier_bill_originals
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER supplier_payable_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.supplier_payables
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

ALTER TABLE crest.financial_events ADD COLUMN supplier_payable_id uuid;
ALTER TABLE crest.financial_events ADD CONSTRAINT supplier_payable_event_source
 FOREIGN KEY(business_id,supplier_payable_id) REFERENCES crest.supplier_payables(business_id,id);
ALTER TABLE crest.financial_events ADD UNIQUE(business_id,supplier_payable_id);
ALTER TABLE crest.journal_lines ADD COLUMN supplier_payable_id uuid;
ALTER TABLE crest.journal_lines ADD CONSTRAINT supplier_payable_journal_source
 FOREIGN KEY(business_id,supplier_payable_id) REFERENCES crest.supplier_payables(business_id,id);
CREATE INDEX supplier_payable_journal_line ON crest.journal_lines(business_id,supplier_payable_id) WHERE supplier_payable_id IS NOT NULL;

-- Retain the exact preexisting typed-source predicates for every existing event
-- and line. The P14 predicates form a disjoint additional source path.
DO $constraints$
DECLARE event_predicate text; line_predicate text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT event_predicate FROM pg_constraint
  WHERE conrelid='crest.financial_events'::regclass AND conname='finance_event_typed_source';
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT line_predicate FROM pg_constraint
  WHERE conrelid='crest.journal_lines'::regclass AND conname='finance_journal_line_typed_source';
 ALTER TABLE crest.financial_events DROP CONSTRAINT finance_event_typed_source;
 EXECUTE 'ALTER TABLE crest.financial_events ADD CONSTRAINT finance_event_typed_source CHECK(
  (supplier_payable_id IS NULL AND ('||event_predicate||')) OR
  (supplier_payable_id IS NOT NULL AND template=''P14'' AND template_version=1
   AND num_nonnulls(invoice_id,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,
    invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,
    collection_failure_recredit_id,collection_failure_settlement_id,zero_effect_reason)=0))';
 ALTER TABLE crest.journal_lines DROP CONSTRAINT finance_journal_line_typed_source;
 EXECUTE 'ALTER TABLE crest.journal_lines ADD CONSTRAINT finance_journal_line_typed_source CHECK(
  (supplier_payable_id IS NULL AND ('||line_predicate||')) OR
  (supplier_payable_id IS NOT NULL AND fixed_mapping_id IS NOT NULL
   AND num_nonnulls(invoice_item_id,receivable_id,tax_payable_movement_id,money_movement_id,allocation_event_id,unapplication_id,
    fund_lot_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,
    collection_failure_id,collection_failure_component_id,refund_transfer_adjustment_id,collection_failure_recredit_id,
    collection_failure_settlement_id,collection_failure_settlement_component_id)=0
   AND ((purpose=''supplier_bill_cost'' AND debit_cents>0 AND credit_cents=0)
    OR (purpose=''supplier_bill_payable'' AND debit_cents=0 AND credit_cents>0))))';
END $constraints$;

CREATE POLICY supplier_accrual_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type='finance.supplier_bill.accrual' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY supplier_accrual_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.supplier_bill.accrual');
CREATE POLICY supplier_accrual_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='supplier_payables');
CREATE POLICY supplier_accrual_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type='finance.supplier_bill.accrual' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY supplier_accrual_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type='finance.supplier_bill.accrual' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='finance.supplier_bill.accrual' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY supplier_accrual_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(entity_kind='supplier_payables' AND action='post' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
DO $writers$
DECLARE target text;
BEGIN
 FOREACH target IN ARRAY ARRAY['supplier_payables','atomic_finance_groups','financial_events','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE POLICY supplier_accrual_append ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND EXISTS(SELECT FROM crest_private.operations o
    WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
     AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
     AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
     AND o.command_type=''finance.supplier_bill.accrual'' AND o.state=''pending''))',target);
 END LOOP;
END $writers$;
RESET ROLE;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.supplier_payable_receipt(p crest.supplier_payables,event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',p.business_id,'payableId',p.id,'billId',p.bill_id,
  'billRevision',p.bill_revision::text,'originalId',p.original_id,'operationId',p.operation_id,
  'eventId',event_id,'grossCents',p.gross_cents::text,'reviewSha256',p.review->>'planSha256',
  'duplicatePayableIds',to_jsonb(p.duplicate_payable_ids),'distinctReason',p.distinct_reason);
$receipt$;
REVOKE ALL ON FUNCTION crest_private.supplier_payable_receipt(crest.supplier_payables,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.supplier_payable_receipt(crest.supplier_payables,uuid)
 TO crest_finance_account_owner,crest_finance_integrity_owner;

CREATE FUNCTION crest_private.find_supplier_payable_duplicates(requested_business uuid,requested_bill uuid,source_hash text,
 vendor text,document_reference text)
RETURNS TABLE(payable_id uuid,bill_id uuid,incurred_on text,gross_cents text,document_reference_match boolean,source_hash_match boolean)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $duplicates$
 SELECT p.id,p.bill_id,p.review->>'incurredOn',p.gross_cents::text,
  lower(p.review->>'vendor')=lower(vendor) AND lower(original.document_reference)=lower(document_reference),
  original.file_sha256=source_hash
 FROM crest.supplier_payables p JOIN crest.supplier_bill_originals original
  ON (original.business_id,original.id)=(p.business_id,p.original_id)
 WHERE p.business_id=requested_business AND p.bill_id<>requested_bill AND (original.file_sha256=source_hash
  OR (lower(p.review->>'vendor')=lower(vendor) AND lower(original.document_reference)=lower(document_reference)))
 ORDER BY p.id;
$duplicates$;
REVOKE ALL ON FUNCTION crest_private.find_supplier_payable_duplicates(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.find_supplier_payable_duplicates(uuid,uuid,text,text,text) TO crest_finance_account_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_supplier_payable_accrual(requested_business uuid,requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $proof$
DECLARE e crest.financial_events; p crest.supplier_payables; d crest.supplier_bill_draft_revisions;
 original crest.supplier_bill_originals; expected jsonb;
BEGIN
 SELECT * INTO STRICT e FROM crest.financial_events f WHERE (f.business_id,f.id)=(requested_business,requested_event);
 SELECT * INTO STRICT p FROM crest.supplier_payables s WHERE (s.business_id,s.id)=(e.business_id,e.supplier_payable_id);
 SELECT * INTO STRICT d FROM crest.supplier_bill_draft_revisions s
  WHERE (s.business_id,s.bill_id,s.revision)=(p.business_id,p.bill_id,p.bill_revision);
 SELECT * INTO STRICT original FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(p.business_id,p.original_id);
 IF e.template<>'P14' OR e.template_version<>1 OR e.event_sequence<>1
  OR e.effective_on::text IS DISTINCT FROM (p.review->>'incurredOn') OR e.effective_on::text IS DISTINCT FROM (d.payload->>'incurredOn')
  OR e.period_id::text IS DISTINCT FROM (p.review->>'periodId') OR e.period_generation::text IS DISTINCT FROM (p.review->>'periodGeneration')
  OR p.gross_cents::text IS DISTINCT FROM (d.payload->>'grossCents') OR p.gross_cents::text IS DISTINCT FROM (p.review->>'totalDebitCents')
  OR p.gross_cents::text IS DISTINCT FROM (p.review->>'totalCreditCents') OR p.bill_id::text IS DISTINCT FROM (p.review->>'billId')
  OR p.bill_revision::text IS DISTINCT FROM (p.review->>'revision') OR p.business_id::text IS DISTINCT FROM (p.review->>'businessId')
  OR original.file_sha256 IS DISTINCT FROM (p.review->>'documentSha256')
  OR original.document_reference IS DISTINCT FROM (p.review->>'documentReference')
  OR original.bill_revision>p.bill_revision
  OR NOT EXISTS(SELECT FROM crest.supplier_bill_draft_revisions src
   WHERE (src.business_id,src.bill_id,src.revision)=(original.business_id,original.bill_id,original.bill_revision)
    AND src.payload->>'documentReference'=original.document_reference)
  OR (p.review->>'documentReference') IS DISTINCT FROM (d.payload->>'documentReference')
  OR d.payload->>'dueOn' IS NULL OR (p.review->>'dueOn') IS DISTINCT FROM (d.payload->>'dueOn')
  OR d.payload->>'vendor' IS NULL OR (p.review->>'vendor') IS DISTINCT FROM (d.payload->>'vendor')
  OR d.payload->>'purchaseTaxCents' IS NULL
  OR (p.review->>'includedPurchaseTaxCents') IS DISTINCT FROM (d.payload->>'purchaseTaxCents')
  OR (p.review->>'purchaseTaxTreatment') IS DISTINCT FROM (
   CASE WHEN (d.payload->>'purchaseTaxCents')::bigint=0 THEN 'none'
    WHEN (d.payload->>'purchaseTaxCents')::bigint>0 THEN 'verified_nonrecoverable' END)
  OR jsonb_typeof(p.review->'lines') IS DISTINCT FROM 'array'
  OR EXISTS(SELECT FROM unnest(p.duplicate_payable_ids) prior(id) WHERE prior.id IS NULL OR prior.id=p.id
   OR NOT EXISTS(SELECT FROM crest.supplier_payables same_business WHERE (same_business.business_id,same_business.id)=(p.business_id,prior.id)))
  OR (p.review->>'planSha256') IS DISTINCT FROM encode(sha256(convert_to((p.review-'planSha256')::text,'UTF8')),'hex')
  OR (SELECT count(*) FROM crest.financial_events f WHERE (f.business_id,f.group_id)=(e.business_id,e.group_id))<>1
  OR EXISTS(SELECT FROM crest.money_movements m WHERE (m.business_id,m.event_id)=(e.business_id,e.id))
  OR (SELECT count(*) FROM crest.journal_entries j WHERE (j.business_id,j.event_id)=(e.business_id,e.id))<>1
  OR NOT EXISTS(SELECT FROM crest.journal_entries j WHERE (j.business_id,j.event_id,j.entry_sequence)=(e.business_id,e.id,1))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_ACCRUAL_PROOF_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM crest.account_mapping_versions m JOIN crest.accounts a ON (a.business_id,a.id)=(m.business_id,m.account_id)
  WHERE (m.business_id,m.id,m.account_id)=(p.business_id,p.payable_mapping_id,p.payable_account_id)
   AND m.purpose='payable' AND m.effective_from<=e.effective_on AND crest_private.fixed_finance_mapping_matches('payable',a))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_MAPPING_PROOF_REQUIRED'; END IF;
 IF EXISTS(
  WITH intended AS MATERIALIZED (
   SELECT item->>'category' AS category,(item->>'accountId')::uuid AS account_id,(item->>'mappingId')::uuid AS mapping_id,
    (item->>'debitCents')::bigint AS debit,(item->>'creditCents')::bigint AS credit
   FROM jsonb_array_elements(p.review->'lines') item
  ), expected_lines AS (
   SELECT account_id,mapping_id,debit,credit,CASE WHEN category IS NULL THEN 'supplier_bill_payable' ELSE 'supplier_bill_cost' END AS purpose
   FROM intended
  ), actual_lines AS (
   SELECT l.account_id,l.fixed_mapping_id AS mapping_id,l.debit_cents AS debit,l.credit_cents AS credit,l.purpose
   FROM crest.journal_entries j JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
   WHERE (j.business_id,j.event_id)=(e.business_id,e.id)
  )
  SELECT FROM ((SELECT * FROM expected_lines EXCEPT ALL SELECT * FROM actual_lines)
   UNION ALL (SELECT * FROM actual_lines EXCEPT ALL SELECT * FROM expected_lines)) difference
  UNION ALL SELECT FROM intended i WHERE i.category IS NULL AND (
   i.account_id IS DISTINCT FROM p.payable_account_id OR i.mapping_id IS DISTINCT FROM p.payable_mapping_id
   OR i.debit IS DISTINCT FROM 0 OR i.credit IS DISTINCT FROM p.gross_cents)
  UNION ALL SELECT FROM intended i WHERE i.category IS NOT NULL AND (
   i.credit IS DISTINCT FROM 0 OR i.debit IS NULL OR i.debit<=0 OR NOT EXISTS(
    SELECT FROM crest.account_mapping_versions m JOIN crest.accounts a ON (a.business_id,a.id)=(m.business_id,m.account_id)
    WHERE (m.business_id,m.id,m.account_id)=(p.business_id,i.mapping_id,i.account_id)
     AND m.purpose='category_'||i.category AND a.account_type='expense' AND m.effective_from<=e.effective_on
     AND crest_private.fixed_finance_mapping_matches(m.purpose,a)))
  UNION ALL SELECT FROM (
   (SELECT category,debit FROM intended WHERE category IS NOT NULL EXCEPT ALL
    SELECT s->>'category',(s->>'grossCents')::bigint FROM jsonb_array_elements(d.payload->'splits') s)
   UNION ALL
   (SELECT s->>'category',(s->>'grossCents')::bigint FROM jsonb_array_elements(d.payload->'splits') s EXCEPT ALL
    SELECT category,debit FROM intended WHERE category IS NOT NULL)
  ) differences
 ) OR (SELECT count(*) FROM jsonb_array_elements(p.review->'lines') item WHERE item->'category'='null'::jsonb)<>1
 OR EXISTS(SELECT FROM crest.journal_entries j JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
   WHERE (j.business_id,j.event_id)=(e.business_id,e.id) AND l.supplier_payable_id IS DISTINCT FROM p.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_JOURNAL_PROOF_REQUIRED'; END IF;
 expected:=crest_private.supplier_payable_receipt(p,e.id);
 IF NOT EXISTS(SELECT FROM crest.atomic_finance_groups g JOIN crest_private.operations o
  ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
  JOIN crest_private.audit_events a ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (g.business_id,g.id,g.operation_id,g.created_by)=(e.business_id,e.group_id,p.operation_id,p.created_by)
   AND o.command_type='finance.supplier_bill.accrual' AND o.recovery_epoch=g.recovery_epoch AND o.state='committed'
   AND o.result=expected AND a.entity_kind='supplier_payables' AND a.entity_id=p.id AND a.entity_version=1
   AND a.action='post' AND a.reason=p.review->>'reviewReason'
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_AUDIT_PROOF_REQUIRED'; END IF;
END $proof$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_payable_accrual(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION crest_private.verify_supplier_payable_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $require$
DECLARE event uuid;
BEGIN
 SELECT f.id INTO event FROM crest.financial_events f WHERE (f.business_id,f.supplier_payable_id)=(NEW.business_id,NEW.id);
 IF event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_EVENT_REQUIRED'; END IF;
 PERFORM crest_private.verify_supplier_payable_accrual(NEW.business_id,event);
 RETURN NULL;
END $require$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_payable_row() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_payable_row() TO crest_schema_owner;

CREATE FUNCTION crest_private.require_unposted_supplier_bill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $draft$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||NEW.business_id::text||NEW.bill_id::text,0));
 IF EXISTS(SELECT FROM crest.supplier_payables p WHERE (p.business_id,p.bill_id)=(NEW.business_id,NEW.bill_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_DRAFT_IS_POSTED'; END IF;
 RETURN NEW;
END $draft$;
REVOKE ALL ON FUNCTION crest_private.require_unposted_supplier_bill() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.require_unposted_supplier_bill() TO crest_schema_owner;

CREATE FUNCTION crest_private.refuse_supplier_payable_cash() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $cash$
BEGIN
 IF EXISTS(SELECT FROM crest.financial_events f WHERE (f.business_id,f.id)=(NEW.business_id,NEW.event_id) AND f.template='P14')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_CASH_NOT_ALLOWED'; END IF;
 RETURN NEW;
END $cash$;
REVOKE ALL ON FUNCTION crest_private.refuse_supplier_payable_cash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.refuse_supplier_payable_cash() TO crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.verify_finance_event_posting(requested_business uuid, requested_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE saved crest.financial_events;
BEGIN
 SELECT e.* INTO saved FROM crest.financial_events e WHERE e.business_id=requested_business AND e.id=requested_event;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_EVENT_REQUIRED';END IF;
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
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_POSTING_TEMPLATE_NOT_SUPPORTED';
 END CASE;
END $posting$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER supplier_payable_event_required AFTER INSERT ON crest.supplier_payables
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_payable_row();
CREATE TRIGGER supplier_payable_draft_sealed BEFORE INSERT ON crest.supplier_bill_draft_revisions
 FOR EACH ROW EXECUTE FUNCTION crest_private.require_unposted_supplier_bill();
CREATE TRIGGER supplier_payable_cash_refused BEFORE INSERT ON crest.money_movements
 FOR EACH ROW EXECUTE FUNCTION crest_private.refuse_supplier_payable_cash();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_supplier_payable_duplicates(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_bill uuid,
 requested_revision bigint,requested_original uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE original crest.supplier_bill_originals; draft crest.supplier_bill_draft_revisions; candidates jsonb;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO original FROM crest.supplier_bill_originals o
  WHERE (o.business_id,o.id,o.bill_id)=(requested_business,requested_original,requested_bill) AND o.bill_revision<=requested_revision;
 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d
  WHERE (d.business_id,d.bill_id)=(requested_business,requested_bill) ORDER BY d.revision DESC LIMIT 1;
 IF original.id IS NULL OR draft.revision IS DISTINCT FROM requested_revision OR draft.payload->>'vendor' IS NULL
  OR draft.payload->>'documentReference' IS DISTINCT FROM original.document_reference
 THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('payableId',d.payable_id,'billId',d.bill_id,'incurredOn',d.incurred_on,
  'grossCents',d.gross_cents,'sameDocumentReference',d.document_reference_match,'sameOriginalSha256',d.source_hash_match)
  ORDER BY d.payable_id),'[]'::jsonb) INTO candidates
 FROM crest_private.find_supplier_payable_duplicates(requested_business,requested_bill,original.file_sha256,
  draft.payload->>'vendor',original.document_reference) d;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'candidates',candidates);
END $read$;
CREATE FUNCTION crest_commands.post_fictional_supplier_payable(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_payable uuid,requested_bill uuid,requested_revision bigint,requested_original uuid,
 tax_treatment text,review_reason text,expected_plan_sha256 text,reviewed_duplicates uuid[],distinct_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $post$
DECLARE authority jsonb; digest text; claimed uuid; prior record; original crest.supplier_bill_originals;
 plan jsonb; control_line jsonb; posted crest.supplier_payables; group_id uuid; event_id uuid; entry_id uuid; receipt jsonb;
 current_duplicates uuid[];
BEGIN
 IF requested_operation IS NULL OR requested_payable IS NULL OR requested_bill IS NULL OR requested_original IS NULL
  OR requested_revision IS NULL OR requested_revision<1 OR expected_plan_sha256 IS NULL OR expected_plan_sha256!~'^[a-f0-9]{64}$'
  OR tax_treatment IS NULL OR tax_treatment NOT IN ('none','verified_nonrecoverable') OR review_reason IS NULL
  OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]'
  OR reviewed_duplicates IS NULL OR (cardinality(reviewed_duplicates)>0) IS DISTINCT FROM (distinct_reason IS NOT NULL)
  OR distinct_reason IS NOT NULL AND (char_length(distinct_reason) NOT BETWEEN 1 AND 1000 OR distinct_reason<>btrim(distinct_reason)
   OR distinct_reason~'[[:cntrl:]]')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_POST_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.supplier_bill.accrual',1,requested_business,expected_actor,
  expected_epoch,requested_payable,requested_bill,requested_revision,requested_original,tax_treatment,review_reason,
  expected_plan_sha256,reviewed_duplicates,distinct_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.supplier_bill.accrual',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO prior FROM crest_private.operations o
   WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
    AND o.command_type='finance.supplier_bill.accrual' AND o.state='committed';
  IF NOT FOUND OR (prior.payload_hash,prior.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch)
  THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',prior.result);
 END IF;

 SELECT * INTO original FROM crest.supplier_bill_originals o
  WHERE (o.business_id,o.id,o.bill_id)=(requested_business,requested_original,requested_bill)
   AND o.bill_revision<=requested_revision AND EXISTS(SELECT FROM crest.supplier_bill_draft_revisions src
    WHERE (src.business_id,src.bill_id,src.revision)=(o.business_id,o.bill_id,o.bill_revision)
     AND src.payload->>'documentReference'=o.document_reference);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_VERIFIED_ORIGINAL_REQUIRED'; END IF;
 plan:=crest_commands.review_fictional_supplier_payable($1,$2,$3,$4,$5,$6,$7,$8,requested_bill,requested_revision,
  original.document_reference,original.file_sha256,tax_treatment,review_reason);
 IF plan->>'planSha256' IS DISTINCT FROM expected_plan_sha256
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_PAYABLE_REVIEW_CHANGED'; END IF;
 IF EXISTS(SELECT FROM crest.supplier_payables p WHERE p.business_id=requested_business
  AND (p.bill_id=requested_bill OR p.id=requested_payable))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='SUPPLIER_PAYABLE_ALREADY_POSTED'; END IF;
 current_duplicates:=ARRAY(SELECT d.payable_id FROM crest_private.find_supplier_payable_duplicates(requested_business,
  requested_bill,original.file_sha256,plan->>'vendor',original.document_reference) d ORDER BY d.payable_id);
 IF current_duplicates IS DISTINCT FROM reviewed_duplicates
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_PAYABLE_DUPLICATE_REVIEW_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 SELECT item INTO STRICT control_line FROM jsonb_array_elements(plan->'lines') item WHERE item->'category'='null'::jsonb;
 INSERT INTO crest.supplier_payables(id,business_id,bill_id,bill_revision,original_id,payable_account_id,payable_mapping_id,
  gross_cents,review,duplicate_payable_ids,distinct_reason,operation_id,created_by)
 VALUES(requested_payable,requested_business,requested_bill,requested_revision,requested_original,(control_line->>'accountId')::uuid,
  (control_line->>'mappingId')::uuid,(plan->>'totalDebitCents')::bigint,plan,reviewed_duplicates,distinct_reason,
  requested_operation,expected_actor) RETURNING * INTO posted;
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
  FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,supplier_payable_id,period_id,period_generation,
  effective_on,time_zone,template,template_version)
 VALUES(requested_business,group_id,1,requested_payable,(plan->>'periodId')::uuid,(plan->>'periodGeneration')::bigint,
  (plan->>'incurredOn')::date,authority->>'timezone','P14',1) RETURNING id INTO event_id;
 INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1) RETURNING id INTO entry_id;
 INSERT INTO crest.journal_lines(business_id,entry_id,account_id,fixed_mapping_id,supplier_payable_id,purpose,debit_cents,credit_cents)
 SELECT requested_business,entry_id,(item->>'accountId')::uuid,(item->>'mappingId')::uuid,requested_payable,
  CASE WHEN item->'category'='null'::jsonb THEN 'supplier_bill_payable' ELSE 'supplier_bill_cost' END,
  (item->>'debitCents')::bigint,(item->>'creditCents')::bigint FROM jsonb_array_elements(plan->'lines') item;
 receipt:=crest_private.supplier_payable_receipt(posted,event_id);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'supplier_payables',requested_payable,1,'post',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
  WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $post$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_supplier_payable_duplicates(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid),crest_commands.post_fictional_supplier_payable(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,text,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_supplier_payable_duplicates(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid),crest_commands.post_fictional_supplier_payable(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,text,text,uuid[],text) TO crest_finance_preview;
