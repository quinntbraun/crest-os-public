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
