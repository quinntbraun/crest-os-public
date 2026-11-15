-- Read-only evidence for proposing ordinary statement matches. Approval and
-- durable allocations require a later command with the finance write lock.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.read_fictional_statement_match_review(
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
  SELECT crest_private.fictional_posted_report_context_v10(requested_business,retained.ends_on,zone) AS checked
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

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_statement_match_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_statement_match_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_statement_match_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date)
 TO crest_finance_preview;
