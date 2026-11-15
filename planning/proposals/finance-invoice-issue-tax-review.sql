-- Candidate invoice issue review over registered76. It evaluates saved scope
-- and effective tax only. Issuance must repeat these checks in its locked transaction.
SET LOCAL ROLE crest_schema_owner;

GRANT SELECT(complimentary_reason) ON crest.quote_items TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.review_invoice_issue_tax(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_draft uuid, expected_revision bigint, line_jurisdictions jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE draft crest.invoice_draft_revisions; local_zone text; issue_on date; saved_job record;
 retained jsonb; rows jsonb; expected_count integer; selection_count integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_draft IS NULL OR expected_revision IS NULL OR expected_revision<1
  OR jsonb_typeof(line_jurisdictions) IS DISTINCT FROM 'object' OR octet_length(line_jurisdictions::text)>160000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_REVIEW_INPUT_REQUIRED';
 END IF;
 local_zone:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8)->>'timezone';
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT d.* INTO draft FROM crest.invoice_draft_revisions d
 WHERE (d.business_id,d.draft_id)=(requested_business,requested_draft) ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF draft.revision<>expected_revision THEN RETURN jsonb_build_object('state','stale'); END IF;
 IF draft.state<>'draft' THEN RETURN jsonb_build_object('state','cancelled'); END IF;
 expected_count:=cardinality(draft.selected_outcomes);
 IF expected_count=0 THEN RETURN jsonb_build_object('state','completed_scope_required'); END IF;

 issue_on:=(statement_timestamp() AT TIME ZONE local_zone)::date;
 IF draft.due_on<issue_on THEN RETURN jsonb_build_object('state','due_date_review_required'); END IF;
 SELECT j.state,j.completed_at INTO STRICT saved_job FROM crest.jobs j WHERE (j.business_id,j.id)=(requested_business,draft.job_id);
 IF saved_job.state<>'completed' OR saved_job.completed_at IS NULL
  OR (saved_job.completed_at AT TIME ZONE local_zone)::date>issue_on THEN
  RETURN jsonb_build_object('state','completed_scope_required');
 END IF;
 retained:=crest_commands.read_invoice_preparation($1,$2,$3,$4,$5,$6,$7,$8,draft.job_id);
 IF retained->>'state'<>'ready' OR retained->>'customerId'<>draft.customer_id::text OR
  (SELECT jsonb_agg(line ORDER BY ord)
   FROM jsonb_array_elements(retained->'lines') WITH ORDINALITY e(line,ord)
   WHERE (line->>'outcomeId')::uuid=ANY(draft.selected_outcomes)) IS DISTINCT FROM draft.retained_lines THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_SCOPE_REVIEW_REQUIRED';
 END IF;
 SELECT count(*) INTO selection_count FROM jsonb_each(line_jurisdictions) j(outcome,selection);
 IF selection_count>expected_count OR EXISTS (
  SELECT FROM jsonb_each(line_jurisdictions) j(outcome,selection)
  WHERE NOT EXISTS (SELECT FROM unnest(draft.selected_outcomes) o(id) WHERE o.id::text=j.outcome)
   OR jsonb_typeof(j.selection)<>'string' OR char_length(j.selection#>>'{}') NOT BETWEEN 1 AND 200
   OR btrim(j.selection#>>'{}')<>j.selection#>>'{}' OR j.selection#>>'{}' ~ '[[:cntrl:]]'
 ) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_REVIEW_INPUT_REQUIRED';
 END IF;

 -- Each line uses only its explicitly reviewed jurisdiction and retained
 -- service identity. An expired or superseded approval cannot be selected.
 SELECT jsonb_agg(jsonb_build_object(
  'outcomeId',line->>'outcomeId','description',line->>'description','serviceId',line->'serviceId',
  'grossInclusiveCents',line->>'grossInclusiveCents','discountInclusiveCents',line->>'discountInclusiveCents',
  'inclusiveCents',line->>'inclusiveCents','complimentaryReason',q.complimentary_reason,
  'jurisdiction',line_jurisdictions->(line->>'outcomeId'),
  'availableJurisdictions',choices.names,
  'state',CASE
   WHEN (line->>'inclusiveCents')::bigint=0 AND q.complimentary_reason IS NULL THEN 'complimentary_review_required'
   WHEN line->>'serviceId' IS NULL THEN 'service_classification_required'
   WHEN NOT line_jurisdictions ? (line->>'outcomeId') THEN 'jurisdiction_required'
   WHEN profile.id IS NULL OR profile.treatment='unresolved' THEN 'tax_profile_required'
   WHEN profile.treatment='exempt' AND exemption.id IS NULL THEN 'exemption_review_required'
   ELSE 'ready' END,
  'profileId',profile.id,'profileVersion',profile.version::text,
  'profileEffectiveFrom',to_char(profile.effective_from,'YYYY-MM-DD'),'treatment',profile.treatment,'rate',profile.rate::text,
  'components',CASE WHEN (profile.treatment IN ('non_taxable','inclusive_single') OR exemption.id IS NOT NULL)
   AND ((line->>'inclusiveCents')::bigint<>0 OR q.complimentary_reason IS NOT NULL) THEN
    crest_private.finance_tax_charge((line->>'grossInclusiveCents')::bigint,(line->>'discountInclusiveCents')::bigint,coalesce(profile.rate,0))
   END
 ) || CASE WHEN exemption.id IS NULL THEN '{}'::jsonb ELSE
  jsonb_build_object('exemptionEvidenceId',exemption.id,'exemptionEvidenceVersion',exemption.version::text) END
 ORDER BY ord) INTO rows
 FROM jsonb_array_elements(draft.retained_lines) WITH ORDINALITY e(line,ord)
 JOIN crest.quote_items q ON (q.business_id,q.id)=(requested_business,(line->>'quoteItemId')::uuid)
 LEFT JOIN LATERAL (
  SELECT p.id,p.version,p.effective_from,p.treatment,p.rate FROM crest.tax_profiles p
  WHERE (p.business_id,p.jurisdiction,p.service_id)=(requested_business,
   line_jurisdictions->>(line->>'outcomeId'),(line->>'serviceId')::uuid)
   AND p.applicability='service' AND p.synthetic AND p.effective_from<=issue_on
  ORDER BY p.effective_from DESC LIMIT 1
 ) profile ON true
 LEFT JOIN LATERAL (
  SELECT e.id,e.version,e.valid_from,e.valid_through FROM crest.invoice_exemption_evidence e
  WHERE (e.business_id,e.draft_id,e.draft_revision,e.outcome_id,e.customer_id,e.jurisdiction,e.profile_id)=
   (requested_business,draft.draft_id,draft.revision,(line->>'outcomeId')::uuid,draft.customer_id,
    line_jurisdictions->>(line->>'outcomeId'),profile.id)
  ORDER BY e.version DESC LIMIT 1
 ) exemption ON profile.treatment='exempt' AND issue_on BETWEEN exemption.valid_from AND exemption.valid_through
 CROSS JOIN LATERAL (
  SELECT coalesce(jsonb_agg(eligible.jurisdiction ORDER BY eligible.jurisdiction COLLATE "C"),'[]'::jsonb) AS names
  FROM (
   SELECT DISTINCT p.jurisdiction COLLATE "C" AS jurisdiction FROM crest.tax_profiles p
   WHERE (p.business_id,p.service_id)=(requested_business,(line->>'serviceId')::uuid)
    AND p.applicability='service' AND p.synthetic AND p.effective_from<=issue_on
   ORDER BY jurisdiction LIMIT 25
  ) eligible
 ) choices;
 IF jsonb_array_length(rows) IS DISTINCT FROM expected_count THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_SCOPE_REVIEW_REQUIRED';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'state','review','businessId',requested_business,
  'draftId',requested_draft,'revision',draft.revision::text,'jobId',draft.job_id,
  'issueDate',to_char(issue_on,'YYYY-MM-DD'),'dueOn',to_char(coalesce(draft.due_on,issue_on),'YYYY-MM-DD'),
  'timezone',local_zone,'lines',rows);
END $review$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.review_invoice_issue_tax(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.review_invoice_issue_tax(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_invoice_issue_tax(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 TO crest_finance_preview;
