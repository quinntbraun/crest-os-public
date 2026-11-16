-- Register the reviewed fictional supplier payables, originals, reports and finance source.

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-review.sql
-- Held P14 preparation for ordinary unpaid expenses. The reviewed reference and digest
-- identify documentary evidence. Original-file custody is a separate posting prerequisite.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.supplier_bill_draft_revisions TO crest_finance_account_owner;
CREATE POLICY supplier_payable_review_source ON crest.supplier_bill_draft_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.review_fictional_supplier_payable(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_bill uuid,
 requested_revision bigint,document_reference text,document_sha256 text,tax_treatment text,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $review$
DECLARE authority jsonb; draft crest.supplier_bill_draft_revisions; incurred date; period record;
 payable crest.account_mapping_versions; payable_account crest.accounts; cost record; mapping crest.account_mapping_versions;
 debit_lines jsonb:='[]'; debits numeric:=0; gross bigint; tax bigint; reviewed jsonb;
BEGIN
 IF requested_bill IS NULL OR requested_revision IS NULL OR requested_revision<1
  OR document_reference IS NULL OR char_length(document_reference) NOT BETWEEN 1 AND 200
  OR document_reference<>btrim(document_reference) OR document_reference~'[[:cntrl:]]'
  OR document_sha256 IS NULL OR document_sha256!~'^[a-f0-9]{64}$'
  OR tax_treatment IS NULL OR tax_treatment NOT IN ('none','verified_nonrecoverable')
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason<>btrim(review_reason) OR review_reason~'[[:cntrl:]]'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_REVIEW_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||requested_bill::text,0));
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d
  WHERE (d.business_id,d.bill_id)=(requested_business,requested_bill) ORDER BY d.revision DESC LIMIT 1;
 IF draft.revision IS DISTINCT FROM requested_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='SUPPLIER_PAYABLE_CURRENT_DRAFT_REQUIRED'; END IF;
 IF draft.payload->>'vendor' IS NULL OR draft.payload->>'documentReference' IS DISTINCT FROM document_reference
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_DOCUMENT_REVIEW_REQUIRED'; END IF;
 IF draft.payload->>'dueOn' IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_DUE_DATE_REQUIRED'; END IF;
 incurred:=(draft.payload->>'incurredOn')::date;
 IF incurred>(statement_timestamp() AT TIME ZONE (authority->>'timezone'))::date
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_INCURRED_DATE_REQUIRED'; END IF;
 gross:=(draft.payload->>'grossCents')::bigint;
 tax:=(draft.payload->>'purchaseTaxCents')::bigint;
 IF tax IS NULL OR (tax=0) IS DISTINCT FROM (tax_treatment='none')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_PURCHASE_TAX_REVIEW_REQUIRED'; END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,incurred,authority->>'timezone');
 SELECT m.* INTO payable FROM crest.account_mapping_versions m
  WHERE m.business_id=requested_business AND m.purpose='payable' AND m.effective_from<=incurred
  ORDER BY m.effective_from DESC LIMIT 1;
 IF payable.account_id IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_CONTROL_MAPPING_REQUIRED'; END IF;
 SELECT a.* INTO payable_account FROM crest.accounts a WHERE (a.business_id,a.id)=(requested_business,payable.account_id);
 IF NOT FOUND OR NOT crest_private.fixed_finance_mapping_matches('payable',payable_account)
  OR (SELECT a.active FROM crest.account_versions a WHERE (a.business_id,a.account_id)=(requested_business,payable.account_id)
      ORDER BY a.version DESC LIMIT 1) IS DISTINCT FROM true
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_CONTROL_MAPPING_REQUIRED'; END IF;
 FOR cost IN SELECT value->>'category' AS category,(value->>'grossCents')::bigint AS cents
  FROM jsonb_array_elements(draft.payload->'splits') ORDER BY value->>'category' COLLATE "C"
 LOOP
  SELECT m.* INTO mapping FROM crest.account_mapping_versions m WHERE m.business_id=requested_business
   AND m.id=crest_private.expense_posting_mapping(requested_business,cost.category,incurred);
  IF NOT FOUND OR mapping.account_id=payable.account_id
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_ORDINARY_COST_MAPPING_REQUIRED'; END IF;
  debits:=debits+cost.cents;
  debit_lines:=debit_lines||jsonb_build_array(jsonb_build_object('category',cost.category,'accountId',mapping.account_id,
   'mappingId',mapping.id,'debitCents',cost.cents::text,'creditCents','0'));
 END LOOP;
 IF debits<>gross THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_PAYABLE_SPLIT_TOTAL_REQUIRED'; END IF;
 reviewed:=jsonb_build_object('schemaVersion',1,'state','entry_preview','template','P14','currency','USD',
  'businessId',requested_business,'billId',requested_bill,'revision',requested_revision::text,
  'incurredOn',incurred,'dueOn',draft.payload->'dueOn','unknownDueReason',draft.payload->'unknownDueReason',
  'vendor',draft.payload->>'vendor','documentReference',document_reference,'documentSha256',document_sha256,
  'purchaseTaxTreatment',tax_treatment,'includedPurchaseTaxCents',tax::text,'reviewReason',review_reason,
  'periodId',period.period_id,'periodGeneration',period.generation::text,'approvalRequiresOriginal',true,
  'totalDebitCents',debits::text,'totalCreditCents',gross::text,'lines',debit_lines||jsonb_build_array(
   jsonb_build_object('category',NULL,'accountId',payable.account_id,'mappingId',payable.id,'debitCents','0','creditCents',gross::text)));
 RETURN reviewed||jsonb_build_object('planSha256',encode(sha256(convert_to(reviewed::text,'UTF8')),'hex'));
END $review$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_supplier_payable(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_supplier_payable(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,text) TO crest_finance_preview;
-- END REVIEWED planning/proposals/finance-supplier-payable-review.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-accrual.sql
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
-- END REVIEWED planning/proposals/finance-supplier-payable-accrual.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-bill-original-intake.sql
-- Held supplier original intake. Apply after the P14 proposals in a disposable
-- workspace. Browser authorization and the isolated validator are distinct.
CREATE ROLE crest_supplier_bill_document_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA crest_commands TO crest_supplier_bill_document_worker;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.supplier_bill_original_intents (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 bill_revision bigint NOT NULL,
 document_reference text NOT NULL,
 recovery_epoch uuid NOT NULL,
 media_type text NOT NULL CHECK(media_type IN('application/pdf','image/jpeg','image/png','image/heic')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 26214400),
 dispatch_id uuid NOT NULL UNIQUE,
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(reserved_at)),
 UNIQUE(business_id,id,bill_id,bill_revision),
 FOREIGN KEY(business_id,bill_id,bill_revision) REFERENCES crest.supplier_bill_draft_revisions(business_id,bill_id,revision),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(char_length(document_reference)>=1 AND char_length(document_reference)<=200 AND document_reference=btrim(document_reference)
  AND document_reference!~'[[:cntrl:]]')
);
ALTER TABLE crest.supplier_bill_original_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_bill_original_intents FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.supplier_bill_original_intents TO crest_finance_account_owner;
CREATE POLICY supplier_bill_original_intent_scope ON crest.supplier_bill_original_intents FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE TRIGGER supplier_bill_original_intent_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.supplier_bill_original_intents
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

ALTER TABLE crest.supplier_bill_originals DROP CONSTRAINT supplier_bill_original_object_key;
ALTER TABLE crest.supplier_bill_originals
 ADD COLUMN candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate)='object' AND octet_length(candidate::text)<=8192),
 ADD COLUMN operation_id uuid NOT NULL,
 ADD COLUMN created_by uuid NOT NULL,
 ADD CONSTRAINT supplier_bill_original_key CHECK(object_key='originals/'||business_id::text||'/'||id::text),
 ADD CONSTRAINT supplier_bill_original_reserved FOREIGN KEY(business_id,id,bill_id,bill_revision)
  REFERENCES crest.supplier_bill_original_intents(business_id,id,bill_id,bill_revision),
 ADD CONSTRAINT supplier_bill_original_publish_operation FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id);
GRANT INSERT ON crest.supplier_bill_originals TO crest_finance_account_owner;

CREATE FUNCTION crest_private.supplier_bill_original_reservation(i crest.supplier_bill_original_intents)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $reservation$
 SELECT jsonb_build_object('businessId',i.business_id,'originalId',i.id,'billId',i.bill_id,'billRevision',i.bill_revision::text,
  'recoveryEpoch',i.recovery_epoch,'declaredType',i.media_type,'byteSize',i.byte_size,'dispatchId',i.dispatch_id,
  'stagingKey','staging/'||i.business_id::text||'/'||i.id::text||'/'||i.dispatch_id::text,
  'originalKey','originals/'||i.business_id::text||'/'||i.id::text,'previewKey','previews/'||i.business_id::text||'/'||i.id::text);
$reservation$;
REVOKE ALL ON FUNCTION crest_private.supplier_bill_original_reservation(crest.supplier_bill_original_intents) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.supplier_bill_original_reservation(crest.supplier_bill_original_intents) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_receipt_reservation(jsonb),crest_private.valid_receipt_candidate(jsonb,jsonb)
 TO crest_finance_account_owner;

CREATE POLICY supplier_bill_document_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY supplier_bill_document_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY supplier_bill_document_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY supplier_bill_document_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK((entity_kind,action) IN(('supplier_bill_original_intents','reserve'),('supplier_bill_originals','publish'))
  AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY supplier_bill_original_intent_append ON crest.supplier_bill_original_intents FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=supplier_bill_original_intents.business_id
    AND o.operation_id=supplier_bill_original_intents.operation_id AND o.actor_id=supplier_bill_original_intents.created_by
    AND o.command_type='bookkeeping.supplier_bill.original.reserve' AND o.state='pending' AND o.recovery_epoch=supplier_bill_original_intents.recovery_epoch));
CREATE POLICY supplier_bill_original_append ON crest.supplier_bill_originals FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=supplier_bill_originals.business_id
    AND o.operation_id=supplier_bill_originals.operation_id AND o.actor_id=supplier_bill_originals.created_by
    AND o.command_type='bookkeeping.supplier_bill.original.publish' AND o.state='pending'));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.change_fictional_supplier_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_original uuid,requested_bill uuid,requested_revision bigint,
 declared_type text,declared_bytes integer,verified_candidate jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $change$
DECLARE publishing boolean:=verified_candidate IS NOT NULL; command text; entity text; digest text; claimed uuid; prior record;
 draft crest.supplier_bill_draft_revisions; intent crest.supplier_bill_original_intents;
 reservation jsonb; validator_scope jsonb; expected_state jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_original IS NULL OR requested_bill IS NULL
  OR requested_revision IS NULL OR requested_revision<1
  OR (NOT publishing AND (declared_type IS NULL OR declared_type NOT IN('application/pdf','image/jpeg','image/png','image/heic')
    OR declared_bytes IS NULL OR declared_bytes NOT BETWEEN 1 AND 26214400))
  OR (publishing AND (declared_type IS NOT NULL OR declared_bytes IS NOT NULL OR jsonb_typeof(verified_candidate)<>'object'
    OR octet_length(verified_candidate::text)>8192))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_ORIGINAL_INPUT_REQUIRED'; END IF;
 IF publishing THEN
  command:='bookkeeping.supplier_bill.original.publish';entity:='supplier_bill_originals';
 ELSE
  command:='bookkeeping.supplier_bill.original.reserve';entity:='supplier_bill_original_intents';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||requested_bill::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 digest:=encode(sha256(convert_to(jsonb_build_array(command,1,requested_business,expected_actor,expected_epoch,
  requested_original,requested_bill,requested_revision,declared_type,declared_bytes,verified_candidate)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,command,1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.result INTO prior FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type=command AND o.recovery_epoch=expected_epoch AND o.state='committed';
  IF NOT FOUND OR prior.payload_hash IS DISTINCT FROM digest
  THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  RETURN jsonb_build_object('state','committed','receipt',prior.result);
 END IF;

 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d
 WHERE (d.business_id,d.bill_id)=(requested_business,requested_bill) ORDER BY d.revision DESC LIMIT 1;
 IF draft.revision IS DISTINCT FROM requested_revision OR draft.payload->>'documentReference' IS NULL
  OR EXISTS(SELECT FROM crest.supplier_payables p WHERE (p.business_id,p.bill_id)=(requested_business,requested_bill))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_CURRENT_DOCUMENT_REQUIRED'; END IF;

 IF NOT publishing THEN
  INSERT INTO crest.supplier_bill_original_intents(id,business_id,bill_id,bill_revision,document_reference,recovery_epoch,
   media_type,byte_size,dispatch_id,operation_id,created_by)
  VALUES(requested_original,requested_business,requested_bill,requested_revision,draft.payload->>'documentReference',expected_epoch,
   declared_type,declared_bytes,gen_random_uuid(),requested_operation,expected_actor) RETURNING * INTO intent;
  reservation:=crest_private.supplier_bill_original_reservation(intent);
  expected_state:=jsonb_build_object('schemaVersion',1,'reservation',reservation);
 ELSE
  SELECT * INTO intent FROM crest.supplier_bill_original_intents i
  WHERE (i.business_id,i.id,i.bill_id,i.bill_revision,i.recovery_epoch,i.created_by)=
   (requested_business,requested_original,requested_bill,requested_revision,expected_epoch,expected_actor);
  IF NOT FOUND OR intent.document_reference IS DISTINCT FROM draft.payload->>'documentReference'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_RESERVATION_REQUIRED'; END IF;
  reservation:=crest_private.supplier_bill_original_reservation(intent);
  -- Use the existing strict private document validator with the same key and media fields.
  validator_scope:=(reservation-ARRAY['originalId','billId','billRevision'])||jsonb_build_object(
   'receiptId',intent.id,'expenseId',intent.bill_id,'expenseRevision',intent.bill_revision::text);
  IF crest_private.valid_receipt_candidate(verified_candidate,validator_scope) IS DISTINCT FROM true
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_VERIFIED_BYTES_REQUIRED'; END IF;
  IF EXISTS(SELECT FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(requested_business,requested_original))
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='SUPPLIER_ORIGINAL_ALREADY_RECORDED'; END IF;
  INSERT INTO crest.supplier_bill_originals(id,business_id,bill_id,bill_revision,document_reference,file_sha256,byte_size,
   media_type,object_key,candidate,operation_id,created_by)
  VALUES(intent.id,intent.business_id,intent.bill_id,intent.bill_revision,intent.document_reference,verified_candidate#>>'{source,sha256}',
   intent.byte_size,intent.media_type,reservation->>'originalKey',verified_candidate,requested_operation,expected_actor);
  expected_state:=jsonb_build_object('schemaVersion',1,'originalId',intent.id,'billId',intent.bill_id,
   'billRevision',intent.bill_revision::text,'sha256',verified_candidate#>>'{source,sha256}');
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,entity,requested_original,1,
  CASE WHEN publishing THEN 'publish' ELSE 'reserve' END,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected_state),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=expected_state
  WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',expected_state);
END $change$;

CREATE FUNCTION crest_commands.reserve_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
 SELECT crest_commands.change_fictional_supplier_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL);
$reserve$;
CREATE FUNCTION crest_commands.publish_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,jsonb
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $publish$
 SELECT crest_commands.change_fictional_supplier_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,$14);
$publish$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.change_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer,jsonb),
 crest_commands.reserve_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer),
 crest_commands.publish_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer) TO crest_finance_preview;
GRANT EXECUTE ON FUNCTION crest_commands.publish_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,jsonb) TO crest_supplier_bill_document_worker;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.supplier_bill_original_intents TO crest_finance_integrity_owner;
GRANT SELECT(payload_hash) ON crest_private.operations TO crest_finance_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.supplier_bill_original_reservation(crest.supplier_bill_original_intents),
 crest_private.valid_receipt_reservation(jsonb),crest_private.valid_receipt_candidate(jsonb,jsonb) TO crest_finance_integrity_owner;
CREATE POLICY supplier_bill_original_intent_integrity ON crest.supplier_bill_original_intents FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY supplier_bill_document_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish'));
CREATE POLICY supplier_bill_document_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind IN('supplier_bill_original_intents','supplier_bill_originals'));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_supplier_original_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE publishing boolean:=TG_TABLE_NAME='supplier_bill_originals'; intent crest.supplier_bill_original_intents;
 original crest.supplier_bill_originals; reservation jsonb; validator_scope jsonb; expected jsonb; digest text;
 command text; expected_action text;
BEGIN
 SELECT * INTO STRICT intent FROM crest.supplier_bill_original_intents i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.id);
 IF NOT EXISTS(SELECT FROM crest.supplier_bill_draft_revisions draft
  WHERE (draft.business_id,draft.bill_id,draft.revision)=(intent.business_id,intent.bill_id,intent.bill_revision)
   AND (draft.payload->>'documentReference')=intent.document_reference)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_HISTORY_REQUIRED'; END IF;
 reservation:=crest_private.supplier_bill_original_reservation(intent);
 IF publishing THEN
  SELECT * INTO STRICT original FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(NEW.business_id,NEW.id);
  validator_scope:=(reservation-ARRAY['originalId','billId','billRevision'])||jsonb_build_object(
   'receiptId',intent.id,'expenseId',intent.bill_id,'expenseRevision',intent.bill_revision::text);
  IF (original.created_by,original.document_reference,original.media_type,original.byte_size,original.object_key,original.file_sha256)
   IS DISTINCT FROM (intent.created_by,intent.document_reference,intent.media_type,intent.byte_size::bigint,reservation->>'originalKey',
    original.candidate#>>'{source,sha256}') OR crest_private.valid_receipt_candidate(original.candidate,validator_scope) IS DISTINCT FROM true
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_HISTORY_REQUIRED'; END IF;
  command:='bookkeeping.supplier_bill.original.publish'; expected_action:='publish';
  expected:=jsonb_build_object('schemaVersion',1,'originalId',intent.id,'billId',intent.bill_id,'billRevision',intent.bill_revision::text,
   'sha256',original.file_sha256);
 ELSE
  command:='bookkeeping.supplier_bill.original.reserve'; expected_action:='reserve';
  expected:=jsonb_build_object('schemaVersion',1,'reservation',reservation);
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(command,1,intent.business_id,intent.created_by,intent.recovery_epoch,
  intent.id,intent.bill_id,intent.bill_revision,CASE WHEN NOT publishing THEN intent.media_type END,
  CASE WHEN NOT publishing THEN intent.byte_size END,original.candidate)::text,'UTF8')),'hex');
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by)
   AND o.command_type=command AND o.payload_hash=digest AND o.recovery_epoch=intent.recovery_epoch AND o.state='committed'
   AND o.result=expected AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=NEW.id AND a.entity_version=1
   AND a.action=expected_action AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_HISTORY_REQUIRED'; END IF;
 RETURN NULL;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_original_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_original_history() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER supplier_original_intent_history AFTER INSERT ON crest.supplier_bill_original_intents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_original_history();
CREATE CONSTRAINT TRIGGER supplier_original_publish_history AFTER INSERT ON crest.supplier_bill_originals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_original_history();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_supplier_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_original uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE intent crest.supplier_bill_original_intents; candidate jsonb;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO intent FROM crest.supplier_bill_original_intents i WHERE (i.business_id,i.id)=(requested_business,requested_original);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT o.candidate INTO candidate FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(requested_business,requested_original);
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.supplier_bill_original_reservation(intent),
  'candidate',candidate);
END $read$;

CREATE FUNCTION crest_commands.authorize_fictional_supplier_original_write(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_original uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE intent crest.supplier_bill_original_intents; draft crest.supplier_bill_draft_revisions;
BEGIN
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO intent FROM crest.supplier_bill_original_intents i
 WHERE (i.business_id,i.id,i.recovery_epoch,i.created_by)=(requested_business,requested_original,expected_epoch,expected_actor);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_RESERVATION_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||intent.bill_id::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d WHERE (d.business_id,d.bill_id)=(intent.business_id,intent.bill_id)
 ORDER BY d.revision DESC LIMIT 1;
 IF draft.revision IS DISTINCT FROM intent.bill_revision OR draft.payload->>'documentReference' IS DISTINCT FROM intent.document_reference
  OR EXISTS(SELECT FROM crest.supplier_payables p WHERE (p.business_id,p.bill_id)=(intent.business_id,intent.bill_id))
  OR EXISTS(SELECT FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(intent.business_id,intent.id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_CURRENT_DOCUMENT_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.supplier_bill_original_reservation(intent));
END $check$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.authorize_fictional_supplier_original_write(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.authorize_fictional_supplier_original_write(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_finance_preview,crest_supplier_bill_document_worker;
-- END REVIEWED planning/proposals/finance-supplier-bill-original-intake.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-settlement.sql
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
-- END REVIEWED planning/proposals/finance-supplier-payable-settlement.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-app-review.sql
-- The application selects retained validator evidence by identity. Browser
-- instructions do not supply the document reference or checksum used in P14.
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.review_fictional_supplier_payable_from_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_bill uuid,
 requested_revision bigint,requested_original uuid,tax_treatment text,review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE draft crest.supplier_bill_draft_revisions; original crest.supplier_bill_originals;
 choices jsonb; payable_id uuid; plan jsonb; duplicates jsonb;
BEGIN
 IF requested_bill IS NULL OR requested_revision IS NULL OR requested_revision<1
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_REVIEW_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 PERFORM FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||requested_bill::text,0));
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d WHERE (d.business_id,d.bill_id)=(requested_business,requested_bill)
  ORDER BY d.revision DESC LIMIT 1;
 IF draft.revision IS DISTINCT FROM requested_revision THEN RETURN jsonb_build_object('state','stale'); END IF;
 SELECT p.id INTO payable_id FROM crest.supplier_payables p WHERE (p.business_id,p.bill_id)=(requested_business,requested_bill);
 IF FOUND THEN RETURN jsonb_build_object('state','posted','payableId',payable_id); END IF;
 IF requested_original IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('originalId',o.id,'fileSha256',o.file_sha256,'mediaType',o.media_type)
   ORDER BY o.id),'[]'::jsonb) INTO choices FROM crest.supplier_bill_originals o
  WHERE (o.business_id,o.bill_id)=(requested_business,requested_bill) AND o.bill_revision<=requested_revision
   AND o.document_reference=draft.payload->>'documentReference';
  IF jsonb_array_length(choices)=0 THEN RETURN jsonb_build_object('state','original_required'); END IF;
  IF jsonb_array_length(choices)>1 THEN RETURN jsonb_build_object('state','select_original','originals',choices); END IF;
  requested_original:=(choices->0->>'originalId')::uuid;
 END IF;
 SELECT * INTO original FROM crest.supplier_bill_originals o
 WHERE (o.business_id,o.id,o.bill_id)=(requested_business,requested_original,requested_bill)
  AND o.bill_revision<=requested_revision AND o.document_reference=draft.payload->>'documentReference';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','original_required'); END IF;
 plan:=crest_commands.review_fictional_supplier_payable($1,$2,$3,$4,$5,$6,$7,$8,requested_bill,requested_revision,
  original.document_reference,original.file_sha256,tax_treatment,review_reason);
 duplicates:=crest_commands.read_fictional_supplier_payable_duplicates($1,$2,$3,$4,$5,$6,$7,$8,
  requested_bill,requested_revision,requested_original);
 RETURN jsonb_build_object('state','ready','originalId',original.id,'plan',plan,'candidates',duplicates->'candidates');
END $review$;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_supplier_payable_from_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_supplier_payable_from_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid,text,text) TO crest_finance_preview;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
-- END REVIEWED planning/proposals/finance-supplier-payable-app-review.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-app-lookup.sql
-- Resolves interrupted app writes by owner, operation, original recovery epoch,
-- and the originally requested payable or settlement ID.
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.lookup_fictional_supplier_payable_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original_epoch uuid,
 requested_operation uuid,requested_id uuid,kind text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE command text; entity_field text; saved record;
BEGIN
 IF original_epoch IS NULL OR requested_operation IS NULL OR requested_id IS NULL OR kind IS NULL OR kind NOT IN('payable','settlement')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_LOOKUP_REQUIRED'; END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 IF kind='payable' THEN command:='finance.supplier_bill.accrual';entity_field:='payableId';
 ELSE command:='finance.supplier_bill.settle';entity_field:='settlementId'; END IF;
 SELECT o.command_type,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.actor_id,o.operation_id)=(requested_business,expected_actor,requested_operation) AND o.state='committed';
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved.command_type IS NULL THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.command_type<>command OR saved.recovery_epoch IS DISTINCT FROM original_epoch
  OR saved.result->>entity_field IS DISTINCT FROM requested_id::text
 THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_supplier_payable_operation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_supplier_payable_operation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
-- END REVIEWED planning/proposals/finance-supplier-payable-app-lookup.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-reports.sql
-- Held report coverage for P14 and P15. Apply after the supplier payable proposals.
-- Legacy readers keep their prior wire format and fail closed if the ledger gains
-- a template outside their coverage. All controls run within the reporting snapshot.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.verify_supplier_payables_report(requested_business uuid,through_on date)
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
BEGIN
 IF EXISTS(
  WITH source AS (
   SELECT p.id AS source_id,p.id AS payable_id,p.payable_account_id AS account_id,
    (p.review->>'incurredOn')::date AS effective_on,p.gross_cents::numeric AS cents
   FROM crest.supplier_payables p
   WHERE p.business_id=requested_business AND (p.review->>'incurredOn')::date<=through_on
   UNION ALL
   SELECT s.id,s.payable_id,p.payable_account_id,s.actual_on,-s.paid_cents::numeric
   FROM crest.supplier_payable_settlements s
   JOIN crest.supplier_payables p ON (p.business_id,p.id)=(s.business_id,s.payable_id)
   WHERE s.business_id=requested_business AND s.actual_on<=through_on
  ), ledger AS (
   SELECT coalesce(e.supplier_payable_id,e.supplier_payable_settlement_id) AS source_id,
    coalesce(e.supplier_payable_id,s.payable_id) AS payable_id,l.account_id,e.effective_on,
    sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents,count(*) AS line_count
   FROM crest.financial_events e JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
   JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
   JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
   LEFT JOIN crest.supplier_payable_settlements s ON (s.business_id,s.id)=(e.business_id,e.supplier_payable_settlement_id)
   WHERE e.business_id=requested_business AND e.effective_on<=through_on AND a.control_kind='payable'
   GROUP BY 1,2,3,4
  ), remaining AS (
   SELECT payable_id,sum(cents) AS cents FROM source GROUP BY payable_id
  )
  SELECT FROM source s FULL JOIN ledger l
   ON (l.source_id,l.payable_id,l.account_id,l.effective_on,l.cents)=(s.source_id,s.payable_id,s.account_id,s.effective_on,s.cents)
  WHERE s.source_id IS NULL OR l.source_id IS NULL OR l.line_count<>1
  UNION ALL
  SELECT FROM remaining WHERE cents<0
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_SUPPLIER_PAYABLE_CONTROL_FAILED'; END IF;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_payables_report(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_payables_report(uuid,date) TO crest_finance_account_owner;

CREATE FUNCTION crest_private.fictional_posted_report_context(requested_business uuid,through_on date,zone text,include_supplier_payables boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE event_count bigint; coverage_start date;
BEGIN
 IF through_on<DATE '1900-01-01' OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 SELECT count(*),min(e.effective_on) INTO event_count,coverage_start FROM crest.financial_events e
 WHERE e.business_id=requested_business AND e.effective_on<=through_on;
 IF EXISTS(SELECT FROM crest.financial_events e WHERE e.business_id=requested_business AND e.effective_on<=through_on
  AND (NOT (
   (e.template_version IN(1,2,3) AND e.template IN('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12'))
   OR (include_supplier_payables AND e.template_version=1 AND e.template IN('P14','P15'))))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_TEMPLATE_REVIEW_REQUIRED';
 END IF;
 IF EXISTS(
  SELECT FROM crest.financial_events e LEFT JOIN crest.journal_entries j
   ON j.business_id=e.business_id AND j.event_id=e.id
  LEFT JOIN LATERAL(SELECT count(*) AS n,sum(l.debit_cents::numeric) AS debit,sum(l.credit_cents::numeric) AS credit
   FROM crest.journal_lines l WHERE l.business_id=e.business_id AND l.entry_id=j.id) amounts ON true
  WHERE e.business_id=requested_business AND e.effective_on<=through_on
   AND ((e.zero_effect_reason IS NULL AND (j.id IS NULL OR amounts.n<2 OR amounts.debit IS DISTINCT FROM amounts.credit))
    OR (e.zero_effect_reason IS NOT NULL AND j.id IS NOT NULL))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_LEDGER_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH booked AS (
   SELECT r.id,r.account_id,r.original_cents::numeric+coalesce((
    SELECT sum(d.signed_cents) FROM crest_private.receivable_posted_deltas(r.business_id,r.id) d WHERE d.effective_on<=through_on
   ),0) AS outstanding
   FROM crest.receivable_items r JOIN crest.financial_events issue ON issue.business_id=r.business_id AND issue.invoice_id=r.invoice_id
   WHERE r.business_id=requested_business AND issue.effective_on<=through_on
  ), ledger AS (
   SELECT l.receivable_id,l.account_id,sum(l.debit_cents::numeric-l.credit_cents::numeric) AS balance
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND l.receivable_id IS NOT NULL AND e.effective_on<=through_on
   GROUP BY l.receivable_id,l.account_id
  )
  SELECT FROM booked b FULL JOIN ledger l ON l.receivable_id=b.id AND l.account_id=b.account_id
  WHERE b.id IS NULL OR l.receivable_id IS NULL OR b.outstanding<0 OR b.outstanding IS DISTINCT FROM l.balance
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_RECEIVABLE_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH source AS (
   SELECT m.id,m.event_id,m.account_id,m.signed_cents FROM crest.money_movements m
   JOIN crest.financial_events e ON e.business_id=m.business_id AND e.id=m.event_id
   WHERE m.business_id=requested_business AND e.effective_on<=through_on
  ), ledger AS (
   SELECT l.money_movement_id,j.event_id,l.account_id,(l.debit_cents::numeric-l.credit_cents::numeric) AS net
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND l.money_movement_id IS NOT NULL AND e.effective_on<=through_on
  )
  SELECT FROM source s FULL JOIN ledger l ON l.money_movement_id=s.id AND l.event_id=s.event_id AND l.account_id=s.account_id
  WHERE s.id IS NULL OR l.money_movement_id IS NULL OR s.signed_cents IS DISTINCT FROM l.net
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_MONEY_CONTROL_FAILED';END IF;
 -- A no-movement correction adjusts the recorded account. It must match the
 -- retained source and ties independently of the verified external-movement rows.
 IF EXISTS(
  WITH corrections AS (
   SELECT e.id AS event_id,s.money_account_id AS account_id,-s.cents::numeric AS cents
   FROM crest.collection_failures s
   JOIN crest.financial_events e ON (e.business_id,e.collection_failure_id)=(s.business_id,s.id)
   WHERE s.business_id=requested_business AND s.kind='recording_error' AND e.effective_on<=through_on
  ), ledger AS (
   SELECT e.id AS event_id,l.account_id,(l.debit_cents::numeric-l.credit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON (j.business_id,j.id)=(l.business_id,l.entry_id)
   JOIN crest.financial_events e ON (e.business_id,e.id)=(j.business_id,j.event_id)
   WHERE l.business_id=requested_business AND l.purpose='collection_failure_money'
    AND l.money_movement_id IS NULL AND e.effective_on<=through_on
  )
  SELECT FROM corrections c FULL JOIN ledger l ON (l.event_id,l.account_id)=(c.event_id,c.account_id)
  WHERE c.event_id IS NULL OR l.event_id IS NULL OR c.cents IS DISTINCT FROM l.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_MONEY_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH ordinary_lots AS (
   SELECT l.id,l.account_id,l.original_cents::numeric-coalesce((
    SELECT sum(a.last_cent::numeric-a.first_cent+1) FROM crest.fund_lot_range_consumptions a
    JOIN crest.financial_events applied ON applied.business_id=a.business_id
     AND ((a.fund_application_id IS NOT NULL AND applied.fund_application_id=a.fund_application_id)
      OR (a.tip_realization_id IS NOT NULL AND applied.tip_realization_id=a.tip_realization_id)
      OR (a.service_refund_id IS NOT NULL AND applied.service_refund_id=a.service_refund_id)
      OR (a.excess_return_id IS NOT NULL AND applied.excess_return_id=a.excess_return_id)
      OR (a.collection_failure_component_id IS NOT NULL AND EXISTS(
       SELECT FROM crest.collection_failure_components c
       WHERE (c.business_id,c.id,c.collection_failure_id)=(a.business_id,a.collection_failure_component_id,applied.collection_failure_id))))
    WHERE a.business_id=l.business_id AND a.fund_lot_id=l.id AND applied.effective_on<=through_on
   ),0) AS available FROM crest.customer_fund_lots l
   JOIN crest.financial_events e ON e.business_id=l.business_id AND (e.unapplication_id=l.unapplication_id OR e.id=l.receipt_event_id OR e.id=l.receipt_tip_event_id OR e.id=l.collection_failure_recredit_event_id OR EXISTS(SELECT FROM crest.collection_failure_settlement_components cc
    WHERE (cc.business_id,cc.id,cc.settlement_id)=(l.business_id,l.collection_failure_settlement_component_id,e.collection_failure_settlement_id)))
   WHERE l.business_id=requested_business AND e.effective_on<=through_on
  ), refund_due AS (
   SELECT q.fund_lot_id,q.account_id,sum(q.remaining_cents) AS cents
   FROM crest_private.fictional_refund_due_amounts(requested_business,through_on) q
   GROUP BY q.fund_lot_id,q.account_id
  ), journal AS (
   SELECT l.fund_lot_id,l.account_id,
    coalesce(sum(l.credit_cents::numeric-l.debit_cents::numeric) FILTER(WHERE l.refund_transfer_adjustment_id IS NULL),0) AS ordinary,
    coalesce(sum(l.credit_cents::numeric-l.debit_cents::numeric) FILTER(WHERE l.refund_transfer_adjustment_id IS NOT NULL),0) AS refund_due
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   WHERE l.business_id=requested_business AND e.effective_on<=through_on AND l.fund_lot_id IS NOT NULL
   GROUP BY l.fund_lot_id,l.account_id
  )
  SELECT FROM ordinary_lots a FULL JOIN journal j ON (j.fund_lot_id,j.account_id)=(a.id,a.account_id)
  FULL JOIN refund_due d ON (d.fund_lot_id,d.account_id)=
   (coalesce(a.id,j.fund_lot_id),coalesce(a.account_id,j.account_id))
  WHERE a.id IS NULL OR a.available<0 OR a.available IS DISTINCT FROM coalesce(j.ordinary,0)
   OR coalesce(d.cents,0)<0 OR coalesce(d.cents,0) IS DISTINCT FROM coalesce(j.refund_due,0)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_CUSTOMER_FUNDS_CONTROL_FAILED';END IF;
 IF EXISTS(
  WITH booked AS (
   SELECT m.account_id,sum(m.cents::numeric) AS cents
   FROM crest.invoice_tax_payable_movements m JOIN crest.financial_events e ON e.business_id=m.business_id AND e.id=m.event_id
   WHERE m.business_id=requested_business AND e.effective_on<=through_on GROUP BY m.account_id
   UNION ALL
   SELECT t.tax_account_id,sum(t.tax_cents::numeric)
   FROM crest.tip_realizations t JOIN crest.financial_events e ON e.business_id=t.business_id AND e.tip_realization_id=t.id
   WHERE t.business_id=requested_business AND t.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT t.tax_account_id,-sum(r.tax_cents::numeric)
   FROM crest.tip_returns r JOIN crest.tip_realizations t ON (t.business_id,t.id)=(r.business_id,r.tip_realization_id)
   JOIN crest.financial_events e ON (e.business_id,e.tip_return_id)=(r.business_id,r.id) AND e.template='P10'
   WHERE r.business_id=requested_business AND r.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT t.tax_account_id,-sum(c.tax_cents::numeric)
   FROM crest.collection_failure_components c
   JOIN crest.tip_realizations t ON (t.business_id,t.id)=(c.business_id,c.tip_realization_id)
   JOIN crest.financial_events e ON (e.business_id,e.collection_failure_id)=(c.business_id,c.collection_failure_id)
   WHERE c.business_id=requested_business AND c.tax_cents>0 AND e.effective_on<=through_on GROUP BY t.tax_account_id
   UNION ALL
   SELECT c.tax_account_id,-sum(c.tax_cents::numeric)
   FROM crest.invoice_credits c JOIN crest.financial_events e ON e.business_id=c.business_id AND e.invoice_credit_id=c.id
   WHERE c.business_id=requested_business AND c.tax_cents>0 AND e.effective_on<=through_on GROUP BY c.tax_account_id
   UNION ALL
   SELECT t.tax_account_id,sum(t.tax_cents::numeric)
   FROM crest.tip_realizations t JOIN LATERAL crest_private.tip_generation_posting(t) posted ON posted.effective_on<=through_on
   WHERE t.business_id=requested_business AND t.restored_settlement_component_id IS NOT NULL AND t.tax_cents>0 GROUP BY t.tax_account_id
  ), source AS (
   SELECT account_id,sum(cents) AS cents FROM booked GROUP BY account_id
  ), ledger AS (
   SELECT l.account_id,sum(l.credit_cents::numeric-l.debit_cents::numeric) AS cents
   FROM crest.journal_lines l JOIN crest.journal_entries j ON j.business_id=l.business_id AND j.id=l.entry_id
   JOIN crest.financial_events e ON e.business_id=j.business_id AND e.id=j.event_id
   JOIN crest.accounts a ON a.business_id=l.business_id AND a.id=l.account_id
   WHERE l.business_id=requested_business AND a.control_kind='tax_payable' AND e.effective_on<=through_on
   GROUP BY l.account_id
  )
  SELECT FROM source s FULL JOIN ledger l ON l.account_id=s.account_id
  WHERE s.account_id IS NULL OR l.account_id IS NULL OR s.cents IS DISTINCT FROM l.cents
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_TAX_CONTROL_FAILED';END IF;
 IF include_supplier_payables THEN
  PERFORM crest_private.verify_supplier_payables_report(requested_business,through_on);
 END IF;
 RETURN jsonb_build_object('schemaVersion',CASE WHEN include_supplier_payables THEN 11 ELSE 10 END,'businessId',requested_business,'currency','USD','timeZone',zone,
  'throughOn',to_char(through_on,'YYYY-MM-DD'),'observedAt',
  to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'postedEventCount',event_count::text,'coverageStart',to_char(coverage_start,'YYYY-MM-DD'),
  'refundDue',crest_private.fictional_refund_due_body(requested_business,through_on),
  'coverage',jsonb_build_object('complete',false,'openingBalancesIncluded',false,'reconciliationVerified',false,
   'templates',jsonb_build_array('P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12')||
    CASE WHEN include_supplier_payables THEN jsonb_build_array('P14','P15') ELSE '[]'::jsonb END),
  'controls',jsonb_build_object('ledgerBalanced',true,'receivablesTie',true,'moneyMovementsTie',true,'customerFundsTie',true,'taxPayableTie',true)||
   CASE WHEN include_supplier_payables THEN jsonb_build_object('supplierPayablesTie',true) ELSE '{}'::jsonb END);
END $report$;

REVOKE ALL ON FUNCTION crest_private.fictional_posted_report_context(uuid,date,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_posted_report_context(uuid,date,text,boolean) TO crest_finance_account_owner;

CREATE OR REPLACE FUNCTION crest_private.fictional_posted_report_context_v10(requested_business uuid,through_on date,zone text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $legacy$
 SELECT crest_private.fictional_posted_report_context(requested_business,through_on,zone,false)
$legacy$;

CREATE FUNCTION crest_private.fictional_journal_body_v16(requested_business uuid,through_on date,requested_account uuid,after_line uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE body jsonb; rows jsonb;
BEGIN
 body:=crest_private.fictional_journal_body_v14(requested_business,through_on,requested_account,after_line,page_limit);
 SELECT coalesce(jsonb_agg(j.row||jsonb_build_object(
  'supplierPayableId',p.id,'supplierBillId',p.bill_id,'supplierSettlementId',s.id,
  'supplierMoneyMovementId',CASE WHEN s.id IS NOT NULL THEN l.money_movement_id END) ORDER BY j.position),'[]'::jsonb)
 INTO rows FROM jsonb_array_elements(body->'rows') WITH ORDINALITY j(row,position)
 JOIN crest.journal_lines l ON (l.business_id,l.id)=(requested_business,(j.row->>'lineId')::uuid)
 LEFT JOIN crest.supplier_payable_settlements s ON (s.business_id,s.id)=(l.business_id,l.supplier_payable_settlement_id)
 LEFT JOIN crest.supplier_payables p ON (p.business_id,p.id)=(l.business_id,coalesce(l.supplier_payable_id,s.payable_id));
 IF jsonb_array_length(rows)<>jsonb_array_length(body->'rows') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_REPORT_LEDGER_CONTROL_FAILED';
 END IF;
 RETURN jsonb_set(body,'{rows}',rows);
END $body$;
REVOKE ALL ON FUNCTION crest_private.fictional_journal_body_v16(uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_journal_body_v16(uuid,date,uuid,uuid,integer) TO crest_finance_account_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;

CREATE FUNCTION crest_commands.read_fictional_trial_balance_v11(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context(requested_business,selected,zone,true)||
  crest_private.fictional_trial_balance_body(requested_business,selected) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_journal_v16(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date,
 requested_account uuid,after_line uuid,page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_posted_report_context(requested_business,selected,zone,true)||
  crest_private.fictional_journal_body_v16(requested_business,selected,requested_account,after_line,page_limit)||jsonb_build_object('schemaVersion',16) INTO result;
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.read_fictional_recorded_income_statement_v2(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, from_on date, through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $report$
DECLARE authority jsonb; zone text; result jsonb;
BEGIN
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=authority->>'timezone';
 IF from_on IS NULL OR through_on IS NULL OR from_on<DATE '1900-01-01'
    OR through_on<from_on OR through_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='FINANCE_REPORT_DATE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH context AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context(requested_business,through_on,zone,true) AS value
 ), movements AS (
  SELECT l.account_id,sum(l.debit_cents::numeric) AS debit,sum(l.credit_cents::numeric) AS credit
  FROM crest.financial_events e
  JOIN crest.journal_entries j ON (j.business_id,j.event_id)=(e.business_id,e.id)
  JOIN crest.journal_lines l ON (l.business_id,l.entry_id)=(j.business_id,j.id)
  WHERE e.business_id=requested_business AND e.effective_on BETWEEN from_on AND through_on
  GROUP BY l.account_id
 ), accounts AS (
  SELECT a.id,a.code,a.account_type,v.name,v.active,m.debit,m.credit
  FROM movements m JOIN crest.accounts a ON a.business_id=requested_business AND a.id=m.account_id
  JOIN LATERAL (
   SELECT name,active FROM crest.account_versions v
   WHERE v.business_id=a.business_id AND v.account_id=a.id ORDER BY version DESC LIMIT 1
  ) v ON true
  WHERE a.account_type IN ('revenue','contra_revenue','expense')
 ), lines AS (
  SELECT *,credit-debit AS income,CASE
   WHEN account_type='revenue' AND code='4000' THEN 'service_revenue'
   WHEN account_type='revenue' AND code='4100' THEN 'tips_revenue'
   WHEN account_type='revenue' THEN 'other_income'
   WHEN account_type='contra_revenue' AND code='4900' THEN 'discounts'
   WHEN account_type='contra_revenue' AND code='4910' THEN 'returns'
   WHEN account_type='contra_revenue' THEN 'other_contra_revenue'
   ELSE 'expense'
  END AS section FROM accounts
 )
 SELECT jsonb_build_object(
  'schemaVersion',2,'businessId',requested_business,'currency','USD',
  'timeZone',zone,'observedAt',context.value->'observedAt',
  'fromOn',to_char(from_on,'YYYY-MM-DD'),'throughOn',context.value->'throughOn',
  'coverageStart',context.value->'coverageStart','coverage',context.value->'coverage',
  'controls',context.value->'controls',
  'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'section',section,'accountId',id,'code',code,'name',name,'active',active,
   'debitCents',debit::text,'creditCents',credit::text,'incomeCents',income::text
  ) ORDER BY section COLLATE "C",code COLLATE "C",id) FROM lines),'[]'::jsonb),
  'netIncomeCents',(SELECT coalesce(sum(income),0)::text FROM lines)
 ) INTO result FROM context;
 IF jsonb_array_length(result->'rows')>5000 THEN
  RAISE EXCEPTION USING ERRCODE='54000', MESSAGE='FINANCE_REPORT_ACCOUNT_LIMIT';
 END IF;
 RETURN result;
END $report$;

CREATE FUNCTION crest_commands.read_fictional_statement_match_review_v2(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_statement uuid, requested_from date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET datestyle='ISO, YMD' AS $review$
DECLARE authority jsonb; retained crest.statement_imports; result jsonb; from_on date; zone text;
BEGIN
 authority:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=authority->>'timezone';
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO retained FROM crest.statement_imports
 WHERE business_id=requested_business AND id=requested_statement;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='STATEMENT_MATCH_SOURCE_REQUIRED';
 END IF;
 from_on:=coalesce(requested_from,retained.starts_on);
 IF from_on<DATE '0001-01-01' OR from_on>retained.ends_on
    OR retained.ends_on>(statement_timestamp() AT TIME ZONE zone)::date THEN
  RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='STATEMENT_MATCH_DATE_REQUIRED';
 END IF;
 WITH ledger AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context(requested_business,retained.ends_on,zone,true) AS checked
 ), movements AS MATERIALIZED (
  SELECT m.id,e.effective_on,m.signed_cents
  FROM crest.money_movements m JOIN crest.financial_events e ON (e.business_id,e.id)=(m.business_id,m.event_id)
  WHERE m.business_id=requested_business AND m.account_id=retained.account_id
    AND e.effective_on BETWEEN from_on AND retained.ends_on
  ORDER BY e.effective_on,m.id LIMIT 1001
 ), rows AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'statementOn',r.statement_on,'signedCents',r.signed_cents::text)
   ORDER BY r.statement_on,r.id),'[]'::jsonb) AS rows
  FROM crest.statement_import_rows r WHERE r.business_id=requested_business AND r.statement_id=requested_statement
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'statementId',retained.id,
  'accountId',retained.account_id,'startsOn',retained.starts_on,'endsOn',retained.ends_on,'movementFromOn',from_on,
  'observedAt',ledger.checked->'observedAt','statementDifferenceCents',retained.statement_difference_cents::text,
  'rows',rows.rows,'movements',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'accountId',retained.account_id,
   'effectiveOn',m.effective_on,'signedCents',m.signed_cents::text,'previouslyMatchedCents','0') ORDER BY m.effective_on,m.id),'[]'::jsonb)
   FROM movements m)) INTO result FROM ledger CROSS JOIN rows;
 IF jsonb_array_length(result->'rows')<>retained.row_count OR jsonb_array_length(result->'movements')>1000 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_MATCH_SOURCE_LIMIT';
 END IF;
 RETURN result;
END $review$;

REVOKE ALL ON FUNCTION crest_commands.read_fictional_trial_balance_v11(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_trial_balance_v11(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_journal_v16(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_journal_v16(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,uuid,uuid,integer) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_recorded_income_statement_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_recorded_income_statement_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_statement_match_review_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_statement_match_review_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) TO crest_finance_preview;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
-- END REVIEWED planning/proposals/finance-supplier-payable-reports.sql
RESET ROLE;

-- BEGIN REVIEWED planning/proposals/finance-supplier-payable-export.sql
-- Isolated supplier-payables source snapshot. Original bytes are held by
-- private object storage. The snapshot retains their exact verification manifest.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,business_id,bill_id,bill_revision,document_reference,recovery_epoch,media_type,byte_size,dispatch_id,operation_id,created_by,reserved_at) ON crest.supplier_bill_original_intents TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_bill_original_intents FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,bill_id,bill_revision,document_reference,file_sha256,byte_size,media_type,object_key,verified_at,candidate,operation_id,created_by) ON crest.supplier_bill_originals TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_bill_originals FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,bill_id,bill_revision,original_id,payable_account_id,payable_mapping_id,gross_cents,review,duplicate_payable_ids,distinct_reason,operation_id,created_by,recorded_at) ON crest.supplier_payables TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_payables FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,payable_id,operation_id,created_by,channel_version_id,evidence_id,actual_on,paid_cents,remaining_before_cents,confirmation,recorded_at) ON crest.supplier_payable_settlements TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.supplier_payable_settlements FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,commit_sequence,recovery_epoch,created_by,operation_id,created_at) ON crest.atomic_finance_groups TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.atomic_finance_groups FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,group_id,event_sequence,invoice_id,period_id,period_generation,reopened_generation,effective_on,time_zone,template,template_version,zero_effect_reason,posted_at,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,supplier_payable_id,supplier_payable_settlement_id) ON crest.financial_events TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.financial_events FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,event_id,entry_sequence) ON crest.journal_entries TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.journal_entries FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,tax_payable_movement_id,purpose,debit_cents,credit_cents,money_movement_id,allocation_event_id,unapplication_id,fund_lot_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,collection_failure_settlement_component_id,supplier_payable_id,supplier_payable_settlement_id) ON crest.journal_lines TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.journal_lines FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,event_id,account_id,evidence_id,signed_cents) ON crest.money_movements TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.money_movements FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);
GRANT SELECT(id,business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,normalization_rule,confirmed_on,signed_cents,currency) ON crest.external_money_evidence TO crest_paid_expense_export_owner;
CREATE POLICY supplier_payable_export_read ON crest.external_money_evidence FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_payable_export_business_id',true),'')::uuid);

CREATE FUNCTION crest_commands.supplier_payable_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on
 SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source jsonb; prior_scope text:=current_setting('crest.supplier_payable_export_business_id',true);
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='SUPPLIER_PAYABLE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_INPUT_REQUIRED'; END IF;
 PERFORM set_config('crest.supplier_payable_export_business_id',requested_business::text,true);
 source:=jsonb_build_object(
  'supplier_bill_original_intents',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'bill_id',t.bill_id::text,'bill_revision',t.bill_revision::text,
   'document_reference',t.document_reference::text,'recovery_epoch',t.recovery_epoch::text,'media_type',t.media_type::text,'byte_size',t.byte_size::text,
   'dispatch_id',t.dispatch_id::text,'operation_id',t.operation_id::text,'created_by',t.created_by::text,'reserved_at',t.reserved_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,bill_id,bill_revision,document_reference,recovery_epoch,media_type,byte_size,dispatch_id,operation_id,created_by,reserved_at
   FROM crest.supplier_bill_original_intents t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'supplier_bill_originals',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'bill_id',t.bill_id::text,'bill_revision',t.bill_revision::text,
   'document_reference',t.document_reference::text,'file_sha256',t.file_sha256::text,'byte_size',t.byte_size::text,'media_type',t.media_type::text,
   'object_key',t.object_key::text,'verified_at',t.verified_at::text,'candidate',t.candidate,'operation_id',t.operation_id::text,
   'created_by',t.created_by::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,bill_id,bill_revision,document_reference,file_sha256,byte_size,media_type,object_key,verified_at,candidate,operation_id,created_by
   FROM crest.supplier_bill_originals t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'supplier_payables',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'bill_id',t.bill_id::text,'bill_revision',t.bill_revision::text,
   'original_id',t.original_id::text,'payable_account_id',t.payable_account_id::text,'payable_mapping_id',t.payable_mapping_id::text,'gross_cents',t.gross_cents::text,
   'review',t.review,'duplicate_payable_ids',t.duplicate_payable_ids,'distinct_reason',t.distinct_reason::text,'operation_id',t.operation_id::text,
   'created_by',t.created_by::text,'recorded_at',t.recorded_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,bill_id,bill_revision,original_id,payable_account_id,payable_mapping_id,gross_cents,review,duplicate_payable_ids,distinct_reason,operation_id,created_by,recorded_at
   FROM crest.supplier_payables t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'supplier_payable_settlements',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'payable_id',t.payable_id::text,'operation_id',t.operation_id::text,
   'created_by',t.created_by::text,'channel_version_id',t.channel_version_id::text,'evidence_id',t.evidence_id::text,'actual_on',t.actual_on::text,
   'paid_cents',t.paid_cents::text,'remaining_before_cents',t.remaining_before_cents::text,'confirmation',t.confirmation::text,'recorded_at',t.recorded_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,payable_id,operation_id,created_by,channel_version_id,evidence_id,actual_on,paid_cents,remaining_before_cents,confirmation,recorded_at
   FROM crest.supplier_payable_settlements t WHERE t.business_id=requested_business
   ORDER BY t.id LIMIT 10001) t),
  'atomic_finance_groups',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'commit_sequence',t.commit_sequence::text,'recovery_epoch',t.recovery_epoch::text,
   'created_by',t.created_by::text,'operation_id',t.operation_id::text,'created_at',t.created_at::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,commit_sequence,recovery_epoch,created_by,operation_id,created_at
   FROM crest.atomic_finance_groups t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.financial_events e WHERE (e.business_id,e.group_id)=(t.business_id,t.id) AND e.template IN ('P14','P15'))
   ORDER BY t.id LIMIT 10001) t),
  'financial_events',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'group_id',t.group_id::text,'event_sequence',t.event_sequence::text,
   'invoice_id',t.invoice_id::text,'period_id',t.period_id::text,'period_generation',t.period_generation::text,'reopened_generation',t.reopened_generation::text,
   'effective_on',t.effective_on::text,'time_zone',t.time_zone::text,'template',t.template::text,'template_version',t.template_version::text,
   'zero_effect_reason',t.zero_effect_reason::text,'posted_at',t.posted_at::text,'payment_id',t.payment_id::text,'posted_expense_id',t.posted_expense_id::text,
   'unapplication_id',t.unapplication_id::text,'fund_application_id',t.fund_application_id::text,'tip_realization_id',t.tip_realization_id::text,'invoice_credit_id',t.invoice_credit_id::text,
   'service_refund_id',t.service_refund_id::text,'excess_return_id',t.excess_return_id::text,'tip_return_id',t.tip_return_id::text,'collection_failure_id',t.collection_failure_id::text,
   'refund_transfer_adjustment_id',t.refund_transfer_adjustment_id::text,'collection_failure_recredit_id',t.collection_failure_recredit_id::text,'collection_failure_settlement_id',t.collection_failure_settlement_id::text,'supplier_payable_id',t.supplier_payable_id::text,
   'supplier_payable_settlement_id',t.supplier_payable_settlement_id::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,group_id,event_sequence,invoice_id,period_id,period_generation,reopened_generation,effective_on,time_zone,template,template_version,zero_effect_reason,posted_at,payment_id,posted_expense_id,unapplication_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,supplier_payable_id,supplier_payable_settlement_id
   FROM crest.financial_events t WHERE t.business_id=requested_business AND t.template IN ('P14','P15')
   ORDER BY t.id LIMIT 10001) t),
  'journal_entries',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'event_id',t.event_id::text,'entry_sequence',t.entry_sequence::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,event_id,entry_sequence
   FROM crest.journal_entries t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.financial_events e WHERE (e.business_id,e.id)=(t.business_id,t.event_id) AND e.template IN ('P14','P15'))
   ORDER BY t.id LIMIT 10001) t),
  'journal_lines',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'entry_id',t.entry_id::text,'invoice_item_id',t.invoice_item_id::text,
   'receivable_id',t.receivable_id::text,'account_id',t.account_id::text,'fixed_mapping_id',t.fixed_mapping_id::text,'tax_payable_movement_id',t.tax_payable_movement_id::text,
   'purpose',t.purpose::text,'debit_cents',t.debit_cents::text,'credit_cents',t.credit_cents::text,'money_movement_id',t.money_movement_id::text,
   'allocation_event_id',t.allocation_event_id::text,'unapplication_id',t.unapplication_id::text,'fund_lot_id',t.fund_lot_id::text,'fund_application_id',t.fund_application_id::text,
   'tip_realization_id',t.tip_realization_id::text,'invoice_credit_id',t.invoice_credit_id::text,'service_refund_id',t.service_refund_id::text,'excess_return_id',t.excess_return_id::text,
   'tip_return_id',t.tip_return_id::text,'collection_failure_id',t.collection_failure_id::text,'collection_failure_component_id',t.collection_failure_component_id::text,'refund_transfer_adjustment_id',t.refund_transfer_adjustment_id::text,
   'collection_failure_recredit_id',t.collection_failure_recredit_id::text,'collection_failure_settlement_id',t.collection_failure_settlement_id::text,'collection_failure_settlement_component_id',t.collection_failure_settlement_component_id::text,'supplier_payable_id',t.supplier_payable_id::text,
   'supplier_payable_settlement_id',t.supplier_payable_settlement_id::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,tax_payable_movement_id,purpose,debit_cents,credit_cents,money_movement_id,allocation_event_id,unapplication_id,fund_lot_id,fund_application_id,tip_realization_id,invoice_credit_id,service_refund_id,excess_return_id,tip_return_id,collection_failure_id,collection_failure_component_id,refund_transfer_adjustment_id,collection_failure_recredit_id,collection_failure_settlement_id,collection_failure_settlement_component_id,supplier_payable_id,supplier_payable_settlement_id
   FROM crest.journal_lines t WHERE t.business_id=requested_business AND num_nonnulls(t.supplier_payable_id,t.supplier_payable_settlement_id)=1
   ORDER BY t.id LIMIT 10001) t),
  'money_movements',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'event_id',t.event_id::text,'account_id',t.account_id::text,
   'evidence_id',t.evidence_id::text,'signed_cents',t.signed_cents::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,event_id,account_id,evidence_id,signed_cents
   FROM crest.money_movements t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.financial_events e WHERE (e.business_id,e.id)=(t.business_id,t.event_id) AND e.template='P15')
   ORDER BY t.id LIMIT 10001) t),
  'external_money_evidence',(SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',t.id::text,'business_id',t.business_id::text,'provider_namespace',t.provider_namespace::text,'external_account_id',t.external_account_id::text,
   'id_namespace',t.id_namespace::text,'external_id',t.external_id::text,'raw_reference',t.raw_reference::text,'normalization_rule',t.normalization_rule::text,
   'confirmed_on',t.confirmed_on::text,'signed_cents',t.signed_cents::text,'currency',t.currency::text
  ) ORDER BY t.id),'[]'::jsonb) FROM (SELECT id,business_id,provider_namespace,external_account_id,id_namespace,external_id,raw_reference,normalization_rule,confirmed_on,signed_cents,currency
   FROM crest.external_money_evidence t WHERE t.business_id=requested_business AND EXISTS (SELECT FROM crest.supplier_payable_settlements s WHERE (s.business_id,s.evidence_id)=(t.business_id,t.id))
   ORDER BY t.id LIMIT 10001) t)
 );
 IF (SELECT sum(jsonb_array_length(rows)) FROM jsonb_each(source) AS group_rows(name,rows))>10000
  OR octet_length(source::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SUPPLIER_PAYABLE_SOURCE_LIMIT'; END IF;
 PERFORM set_config('crest.supplier_payable_export_business_id',coalesce(prior_scope,''),true);
 RETURN jsonb_build_object('schemaVersion',1,'scope','supplier_payable_source','businessId',requested_business,'tables',source);
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_paid_expense_export_owner;
ALTER FUNCTION crest_commands.supplier_payable_source_snapshot(uuid) OWNER TO crest_paid_expense_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_paid_expense_export_owner;
REVOKE ALL ON FUNCTION crest_commands.supplier_payable_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.supplier_payable_source_snapshot(uuid) TO crest_export;

-- The old projections still omit supplier rows and retain their original column shape.
-- Schema checks admit only these two reviewed links on the shared ledger tables.
SET LOCAL ROLE crest_schema_owner;

CREATE OR REPLACE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
  WHEN 'financial_events' THEN expected_fields||ARRAY['payment_id:uuid','posted_expense_id:uuid','unapplication_id:uuid','fund_application_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['money_movement_id:uuid','allocation_event_id:uuid','unapplication_id:uuid','fund_lot_id:uuid','fund_application_id:uuid']
  ELSE expected_fields END;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.receipt_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
 WHEN 'financial_events' THEN expected_fields||ARRAY['posted_expense_id:uuid','unapplication_id:uuid','fund_application_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_lot_id:uuid','fund_application_id:uuid']
  ELSE expected_fields END;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.posted_expense_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 expected_fields:=CASE requested_group
 WHEN 'financial_events' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_application_id:uuid']
  WHEN 'journal_lines' THEN expected_fields||ARRAY['unapplication_id:uuid','fund_lot_id:uuid','fund_application_id:uuid']
  ELSE expected_fields END;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_EXPENSE_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.unapplication_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['fund_application_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group='customer_fund_lots' THEN expected_fields:=expected_fields||ARRAY['receipt_event_id:uuid','receipt_tip_event_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNAPPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.fund_application_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_realization_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FUND_APPLICATION_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.invoice_credit_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;

CREATE OR REPLACE FUNCTION crest_private.held_tip_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['invoice_credit_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines','fund_lot_range_consumptions') THEN
  expected_fields:=expected_fields||ARRAY['service_refund_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines','fund_lot_range_consumptions') THEN
  expected_fields:=expected_fields||ARRAY['excess_return_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['tip_return_id:uuid'];
 END IF;
 IF requested_group='financial_events' THEN expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid'];END IF;
 IF requested_group='journal_lines' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_id:uuid','collection_failure_component_id:uuid'];
 END IF;
 IF requested_group='fund_lot_range_consumptions' THEN expected_fields:=expected_fields||ARRAY['collection_failure_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['refund_transfer_adjustment_id:uuid'];
 END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_id:uuid','collection_failure_settlement_id:uuid'];
  IF requested_group='journal_lines' THEN expected_fields:=expected_fields||ARRAY['collection_failure_settlement_component_id:uuid'];END IF;
 END IF;
 IF requested_group='customer_fund_lots' THEN
  expected_fields:=expected_fields||ARRAY['collection_failure_recredit_event_id:uuid','collection_failure_settlement_component_id:uuid'];
 END IF;
 IF requested_group='tip_realizations' THEN expected_fields:=expected_fields||ARRAY['restored_settlement_component_id:uuid'];END IF;
 IF requested_group IN('financial_events','journal_lines') THEN
  expected_fields:=expected_fields||ARRAY['supplier_payable_id:uuid','supplier_payable_settlement_id:uuid'];
 END IF;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HELD_TIP_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
RESET ROLE;

-- The authorized download receipt binds the same v23 profile as the archive.
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=109 THEN 'crest.posted-finance-source.v23' WHEN source_version>=108 THEN 'crest.posted-finance-source.v22' WHEN source_version>=107 THEN 'crest.posted-finance-source.v21' WHEN source_version>=105 THEN 'crest.posted-finance-source.v20' WHEN source_version>=103 THEN 'crest.posted-finance-source.v19' WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-supplier-payable-export.sql
RESET ROLE;
