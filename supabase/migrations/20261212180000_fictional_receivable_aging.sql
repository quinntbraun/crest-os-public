-- Held invoice aging over the verified P08 ledger. This adds no posting or persistence.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.read_fictional_receivable_aging(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,through_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $aging$
DECLARE auth jsonb; zone text; selected date; result jsonb;
BEGIN
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 selected:=coalesce(through_on,(statement_timestamp() AT TIME ZONE zone)::date);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 -- Validate all posted controls and derive balances in the same SQL snapshot.
 WITH verified AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context_v6(requested_business,selected,zone) AS context
 ), outstanding AS MATERIALIZED (
  SELECT r.id, i.id AS invoice_id, i.invoice_number, i.issued_on, r.due_on,
   r.customer_id,i.customer_snapshot->>'displayName' AS customer_name,
   r.original_cents::numeric+coalesce(d.change_cents,0) AS cents,
   greatest(selected-r.due_on,0) AS overdue
  FROM crest.receivable_items r
  JOIN crest.invoices i ON (i.business_id,i.id,i.customer_id)=(r.business_id,r.invoice_id,r.customer_id)
  JOIN crest.financial_events issue ON (issue.business_id,issue.invoice_id)=(i.business_id,i.id)
  LEFT JOIN LATERAL (
   SELECT sum(signed_cents) AS change_cents FROM crest_private.receivable_posted_deltas(r.business_id,r.id)
   WHERE effective_on<=selected
  ) d ON true
  WHERE r.business_id=requested_business AND issue.effective_on<=selected
 ), open_items AS MATERIALIZED (
  SELECT * FROM outstanding WHERE cents>0
 ), first_page AS (
  SELECT * FROM open_items ORDER BY due_on,id LIMIT 100
 ), totals AS (
  SELECT count(*)::text AS count,coalesce(sum(cents),0)::text AS total,
   coalesce(sum(cents) FILTER(WHERE overdue=0),0)::text AS current_amount,
   coalesce(sum(cents) FILTER(WHERE overdue BETWEEN 1 AND 30),0)::text AS days_1_30,
   coalesce(sum(cents) FILTER(WHERE overdue BETWEEN 31 AND 60),0)::text AS days_31_60,
   coalesce(sum(cents) FILTER(WHERE overdue BETWEEN 61 AND 90),0)::text AS days_61_90,
   coalesce(sum(cents) FILTER(WHERE overdue>90),0)::text AS days_91_plus
  FROM open_items
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'throughOn',v.context->>'throughOn',
   'observedAt',v.context->>'observedAt','timeZone',zone,'currency','USD',
   'scope','posted-invoices','itemCount',t.count,'totalCents',t.total,
   'buckets',jsonb_build_object('current',t.current_amount,'days1To30',t.days_1_30,'days31To60',t.days_31_60,
    'days61To90',t.days_61_90,'days91Plus',t.days_91_plus),
   'rows',coalesce((
    SELECT jsonb_agg(jsonb_build_object('receivableId',p.id,'invoiceId',p.invoice_id,'invoiceNumber',p.invoice_number,
     'customerId',p.customer_id,'customerName',p.customer_name,'issuedOn',to_char(p.issued_on,'YYYY-MM-DD'),
     'dueOn',to_char(p.due_on,'YYYY-MM-DD'),'outstandingCents',p.cents::text,'daysOverdue',p.overdue)
     ORDER BY p.due_on,p.id) FROM first_page p
   ),'[]'::jsonb))
 INTO result FROM verified v CROSS JOIN totals t;
 RETURN result;
END $aging$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_receivable_aging(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_receivable_aging(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_receivable_aging(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date)
 TO crest_finance_preview;
