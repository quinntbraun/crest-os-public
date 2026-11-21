-- Candidate for migration122. Read-only invoice snapshot; no posting/schema adoption here.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_commands.read_fictional_invoice_outstanding(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_customer uuid,requested_invoice uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $outstanding$
DECLARE auth jsonb; zone text; selected date; result jsonb; coherent boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_customer IS NULL OR requested_invoice IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_OUTSTANDING_INPUT_REQUIRED';
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';selected:=(statement_timestamp() AT TIME ZONE zone)::date;
 PERFORM set_config('crest.business_id',requested_business::text,true);
 -- Existing complete posted controls and the selected invoice share this statement snapshot.
 WITH verified AS MATERIALIZED (
  SELECT crest_private.fictional_posted_report_context(requested_business,selected,zone,true) AS context
 ), invoice AS MATERIALIZED (
  SELECT i.id,i.customer_id,i.invoice_number,i.issued_on,i.due_on,i.currency,i.total_cents,
   e.id AS event_id,e.effective_on,r.id AS receivable_id,r.original_cents,r.customer_id AS receivable_customer,
   r.due_on AS receivable_due,r.original_cents::numeric+coalesce(d.cents,0) AS remaining
  FROM crest.invoices i
  LEFT JOIN crest.financial_events e ON (e.business_id,e.invoice_id)=(i.business_id,i.id)
  LEFT JOIN crest.receivable_items r ON (r.business_id,r.invoice_id)=(i.business_id,i.id)
  LEFT JOIN LATERAL (
   SELECT sum(signed_cents) AS cents FROM crest_private.receivable_posted_deltas(r.business_id,r.id)
   WHERE effective_on<=selected
  ) d ON true
  WHERE i.business_id=requested_business AND i.customer_id=requested_customer AND i.id=requested_invoice
 )
 SELECT CASE WHEN i.id IS NULL THEN jsonb_build_object('state','absent') ELSE
  jsonb_build_object('state',CASE WHEN i.issued_on>selected THEN 'not_effective' ELSE 'ready' END,
   'schemaVersion',1,'businessId',requested_business,'customerId',i.customer_id,'invoiceId',i.id,
   'invoiceNumber',i.invoice_number,'currency',i.currency,'issuedOn',to_char(i.issued_on,'YYYY-MM-DD'),
   'dueOn',to_char(i.due_on,'YYYY-MM-DD'),'throughOn',v.context->>'throughOn',
   'observedAt',v.context->>'observedAt','timeZone',zone,'originalCents',i.total_cents::text)
   ||CASE WHEN i.issued_on>selected THEN '{}'::jsonb ELSE
    jsonb_build_object('outstandingCents',CASE WHEN i.total_cents=0 THEN '0' ELSE i.remaining::text END) END END,
  i.id IS NULL OR coalesce(i.event_id IS NOT NULL AND i.effective_on=i.issued_on AND
   ((i.total_cents=0 AND i.receivable_id IS NULL) OR
    (i.total_cents>0 AND i.original_cents=i.total_cents AND i.receivable_customer=i.customer_id
     AND i.receivable_due=i.due_on AND i.remaining BETWEEN 0 AND i.total_cents)),false)
 INTO result,coherent FROM verified v LEFT JOIN invoice i ON true;
 IF coherent IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_OUTSTANDING_SOURCE_REVIEW_REQUIRED';
 END IF;
 RETURN result;
END $outstanding$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_invoice_outstanding(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_invoice_outstanding(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_invoice_outstanding(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_finance_preview;
