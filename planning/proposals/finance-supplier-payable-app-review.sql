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
