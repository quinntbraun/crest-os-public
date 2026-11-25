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
