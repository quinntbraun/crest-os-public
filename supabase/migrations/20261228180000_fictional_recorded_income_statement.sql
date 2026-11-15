-- Read-only fictional report. Keep authorization and the reporting read distinct
-- so authority is refreshed after locks and all financial reads share one snapshot.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.read_fictional_recorded_income_statement(
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
  SELECT crest_private.fictional_posted_report_context_v10(requested_business,through_on,zone) AS value
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
  'schemaVersion',1,'businessId',requested_business,'currency','USD',
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

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_recorded_income_statement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_recorded_income_statement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_recorded_income_statement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date,date)
 TO crest_finance_preview;
