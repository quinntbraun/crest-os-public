-- BR11 invoice numbering, exact issue, immutable journal and private source capture.
-- The migration coordinator owns the atomic transaction. Financial activation remains separate.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-exemption-evidence.sql
-- Held fictional evidence for one retained invoice outcome and exempt profile.
-- The reference identifies reviewed evidence. It is never an authorization URL.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.invoice_exemption_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 draft_id uuid NOT NULL,
 draft_revision bigint NOT NULL,
 outcome_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 jurisdiction text NOT NULL CHECK(char_length(jurisdiction)>=1 AND char_length(jurisdiction)<=200
  AND jurisdiction=btrim(jurisdiction) AND jurisdiction!~'[[:cntrl:]]'),
 profile_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 previous_version bigint GENERATED ALWAYS AS (nullif(version-1,0)) STORED,
 valid_from date NOT NULL CHECK(valid_from BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 valid_through date NOT NULL CHECK(valid_through BETWEEN valid_from AND DATE '9999-12-31'),
 evidence_reference text NOT NULL CHECK(char_length(evidence_reference)>=1 AND char_length(evidence_reference)<=1000
  AND evidence_reference=btrim(evidence_reference) AND evidence_reference!~'[[:cntrl:]]'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 audit_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,draft_id,draft_revision,outcome_id,profile_id,version),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,draft_id,draft_revision) REFERENCES crest.invoice_draft_revisions(business_id,draft_id,revision),
 FOREIGN KEY(business_id,outcome_id) REFERENCES crest.work_scope_outcomes(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,profile_id) REFERENCES crest.tax_profiles(business_id,id),
 FOREIGN KEY(business_id,draft_id,draft_revision,outcome_id,profile_id,previous_version)
  REFERENCES crest.invoice_exemption_evidence(business_id,draft_id,draft_revision,outcome_id,profile_id,version),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX invoice_exemption_outcome ON crest.invoice_exemption_evidence(business_id,outcome_id);
CREATE INDEX invoice_exemption_customer ON crest.invoice_exemption_evidence(business_id,customer_id);
CREATE INDEX invoice_exemption_profile ON crest.invoice_exemption_evidence(business_id,profile_id);
ALTER TABLE crest.invoice_exemption_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_exemption_evidence FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.invoice_exemption_evidence TO crest_finance_integrity_owner;
CREATE POLICY invoice_exemption_integrity ON crest.invoice_exemption_evidence FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT,INSERT ON crest.invoice_exemption_evidence TO crest_finance_account_owner;
CREATE POLICY invoice_exemption_read ON crest.invoice_exemption_evidence FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_exemption_append ON crest.invoice_exemption_evidence FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE POLICY invoice_exemption_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice_exemption.approve');
CREATE POLICY invoice_exemption_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='invoice_exemption_evidence');
CREATE POLICY invoice_exemption_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='finance.invoice_exemption.approve');
CREATE POLICY invoice_exemption_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_exemption.approve' AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY invoice_exemption_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_exemption.approve' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_exemption.approve' AND state='committed');
CREATE POLICY invoice_exemption_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='invoice_exemption_evidence' AND action='approve' AND origin='manual' AND import_row_id IS NULL);

CREATE FUNCTION crest_private.invoice_exemption_snapshot(evidence crest.invoice_exemption_evidence)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',1,'id',evidence.id,'businessId',evidence.business_id,
  'draftId',evidence.draft_id,'draftRevision',evidence.draft_revision::text,'outcomeId',evidence.outcome_id,
  'customerId',evidence.customer_id,'jurisdiction',evidence.jurisdiction,'profileId',evidence.profile_id,
  'version',evidence.version::text,'validFrom',to_char(evidence.valid_from,'YYYY-MM-DD'),
  'validThrough',to_char(evidence.valid_through,'YYYY-MM-DD'),'evidenceReference',evidence.evidence_reference,
  'reason',evidence.reason,'auditEventId',evidence.audit_event_id)
$snapshot$;

CREATE FUNCTION crest_private.check_invoice_exemption_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE prior jsonb; approved jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM crest.invoice_draft_revisions d
  JOIN crest.work_scope_outcomes w ON (w.business_id,w.id,w.job_id)=(d.business_id,NEW.outcome_id,d.job_id)
  JOIN crest.tax_profiles p ON (p.business_id,p.id)=(d.business_id,NEW.profile_id)
  CROSS JOIN LATERAL jsonb_array_elements(d.retained_lines) l(value)
  WHERE (d.business_id,d.draft_id,d.revision,d.customer_id)=(NEW.business_id,NEW.draft_id,NEW.draft_revision,NEW.customer_id)
   AND d.state='draft' AND w.outcome='completed' AND NEW.outcome_id=ANY(d.selected_outcomes)
   AND l.value->>'outcomeId'=NEW.outcome_id::text AND l.value->>'serviceId'=p.service_id::text
   AND p.jurisdiction=NEW.jurisdiction AND p.applicability='service' AND p.treatment='exempt' AND p.synthetic
   AND p.effective_from<=NEW.valid_through
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_EXEMPTION_SCOPE_REQUIRED';
 END IF;
 IF NEW.version>1 THEN
  SELECT crest_private.invoice_exemption_snapshot(e) INTO STRICT prior FROM crest.invoice_exemption_evidence e
  WHERE (e.business_id,e.draft_id,e.draft_revision,e.outcome_id,e.profile_id,e.version)=
   (NEW.business_id,NEW.draft_id,NEW.draft_revision,NEW.outcome_id,NEW.profile_id,NEW.previous_version);
 END IF;
 approved:=crest_private.invoice_exemption_snapshot(NEW);
 IF NOT EXISTS(SELECT FROM crest_private.audit_events a JOIN crest_private.operations o USING(business_id,operation_id,actor_id)
  WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
   AND a.entity_kind='invoice_exemption_evidence' AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action='approve' AND a.reason=NEW.reason AND a.origin='manual' AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',approved)
   AND o.command_type='finance.invoice_exemption.approve' AND o.state='committed' AND o.origin='manual'
   AND o.import_row_id IS NULL AND o.result=approved
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_EXEMPTION_APPROVAL_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER invoice_exemption_audited AFTER INSERT ON crest.invoice_exemption_evidence
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_invoice_exemption_evidence();
CREATE TRIGGER invoice_exemption_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_exemption_evidence
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_commands.approve_invoice_exemption_evidence(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, requested_draft uuid, requested_revision bigint,
 requested_outcome uuid, requested_jurisdiction text, requested_profile uuid, expected_evidence_version bigint,
 requested_from date, requested_through date, requested_reference text, requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $approve$
DECLARE digest text; claim uuid; saved record; draft crest.invoice_draft_revisions;
 prior crest.invoice_exemption_evidence; evidence crest.invoice_exemption_evidence; event_id uuid:=gen_random_uuid(); receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_draft IS NULL OR requested_revision IS NULL OR requested_revision<1
  OR requested_outcome IS NULL OR requested_profile IS NULL OR expected_evidence_version IS NULL
  OR expected_evidence_version NOT BETWEEN 0 AND 9223372036854775806
  OR requested_jurisdiction IS NULL OR char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
  OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]'
  OR requested_from IS NULL OR requested_through IS NULL OR requested_from<DATE '0001-01-01'
  OR requested_through NOT BETWEEN requested_from AND DATE '9999-12-31'
  OR requested_reference IS NULL OR char_length(requested_reference) NOT BETWEEN 1 AND 1000
  OR requested_reference<>btrim(requested_reference) OR requested_reference~'[[:cntrl:]]'
  OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 1000
  OR requested_reason<>btrim(requested_reason) OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_EXEMPTION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.invoice_exemption.approve',1,requested_business,expected_actor,
  expected_epoch,requested_draft,requested_revision,requested_outcome,requested_jurisdiction,requested_profile,expected_evidence_version,
  to_char(requested_from,'YYYY-MM-DD'),to_char(requested_through,'YYYY-MM-DD'),requested_reference,requested_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice_exemption.approve',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type='finance.invoice_exemption.approve' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT d.* INTO draft FROM crest.invoice_draft_revisions d
 WHERE (d.business_id,d.draft_id)=(requested_business,requested_draft) ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND OR draft.state<>'draft' OR draft.revision<>requested_revision OR NOT (requested_outcome=ANY(draft.selected_outcomes)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_EXEMPTION_SCOPE_REQUIRED';
 END IF;
 SELECT e.* INTO prior FROM crest.invoice_exemption_evidence e
 WHERE (e.business_id,e.draft_id,e.draft_revision,e.outcome_id,e.profile_id)=
  (requested_business,requested_draft,requested_revision,requested_outcome,requested_profile)
 ORDER BY e.version DESC LIMIT 1;
 IF coalesce(prior.version,0)<>expected_evidence_version THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='INVOICE_EXEMPTION_VERSION_CONFLICT';
 END IF;
 INSERT INTO crest.invoice_exemption_evidence(business_id,draft_id,draft_revision,outcome_id,customer_id,jurisdiction,profile_id,version,
  valid_from,valid_through,evidence_reference,reason,audit_event_id,created_by,operation_id)
 VALUES(requested_business,requested_draft,requested_revision,requested_outcome,draft.customer_id,requested_jurisdiction,
  requested_profile,expected_evidence_version+1,requested_from,requested_through,requested_reference,requested_reason,event_id,
  expected_actor,requested_operation) RETURNING * INTO evidence;
 receipt:=crest_private.invoice_exemption_snapshot(evidence);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'invoice_exemption_evidence',evidence.id,
  evidence.version,'approve',requested_reason,jsonb_build_object('schemaVersion',1,
   'before',CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.invoice_exemption_snapshot(prior) END,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $approve$;

CREATE FUNCTION crest_commands.read_invoice_exemption_evidence(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_draft uuid, requested_revision bigint, requested_outcome uuid, requested_jurisdiction text, requested_profile uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE latest jsonb;
BEGIN
 IF requested_draft IS NULL OR requested_revision IS NULL OR requested_revision<1 OR requested_outcome IS NULL
  OR requested_profile IS NULL OR requested_jurisdiction IS NULL OR char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
  OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_EXEMPTION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.invoice_exemption_snapshot(e)||jsonb_build_object('operationId',e.operation_id) INTO latest
 FROM crest.invoice_exemption_evidence e
 WHERE (e.business_id,e.draft_id,e.draft_revision,e.outcome_id,e.jurisdiction,e.profile_id)=
  (requested_business,requested_draft,requested_revision,requested_outcome,requested_jurisdiction,requested_profile)
 ORDER BY e.version DESC LIMIT 1;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'draftId',requested_draft,
  'draftRevision',requested_revision::text,'outcomeId',requested_outcome,'jurisdiction',requested_jurisdiction,
  'profileId',requested_profile,'latest',latest);
END $read$;

RESET ROLE;
ALTER FUNCTION crest_private.check_invoice_exemption_evidence() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_invoice_exemption_evidence(),crest_private.invoice_exemption_snapshot(crest.invoice_exemption_evidence) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.invoice_exemption_snapshot(crest.invoice_exemption_evidence)
 TO crest_finance_integrity_owner,crest_finance_account_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.approve_invoice_exemption_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,bigint,uuid,text,uuid,bigint,date,date,text,text) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_invoice_exemption_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,bigint,uuid,text,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.approve_invoice_exemption_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,bigint,uuid,text,uuid,bigint,date,date,text,text),
 crest_commands.read_invoice_exemption_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.approve_invoice_exemption_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,bigint,uuid,text,uuid,bigint,date,date,text,text),
 crest_commands.read_invoice_exemption_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,uuid,text,uuid) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-exemption-evidence.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-issue-tax-review.sql
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

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-issue-tax-review.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-issue-account-review.sql
-- Invoice issuance dependency. Read the reviewed, dated fixed mappings that
-- P01/P02 require after approved tax has been resolved for all selected lines.
-- No entries are created. Tax payable requires its own jurisdiction mapping.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.tax_payable_mapping_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 jurisdiction text NOT NULL CHECK(char_length(jurisdiction)>=1 AND char_length(jurisdiction)<=200
  AND jurisdiction=btrim(jurisdiction) AND jurisdiction!~'[[:cntrl:]]'),
 version bigint NOT NULL CHECK(version>0),
 previous_version bigint GENERATED ALWAYS AS (nullif(version-1,0)) STORED,
 account_id uuid,
 effective_from date NOT NULL CHECK(effective_from BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason!~'[[:cntrl:]]'),
 audit_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,jurisdiction,version),
 UNIQUE(business_id,jurisdiction,effective_from),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,jurisdiction,previous_version) REFERENCES crest.tax_payable_mapping_versions(business_id,jurisdiction,version),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX tax_payable_mapping_account ON crest.tax_payable_mapping_versions(business_id,account_id);
ALTER TABLE crest.tax_payable_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tax_payable_mapping_versions FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.tax_payable_mapping_versions TO crest_finance_integrity_owner;
CREATE POLICY tax_payable_mapping_integrity ON crest.tax_payable_mapping_versions FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT,INSERT ON crest.tax_payable_mapping_versions TO crest_finance_account_owner;
CREATE POLICY tax_payable_mapping_read ON crest.tax_payable_mapping_versions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY tax_payable_mapping_append ON crest.tax_payable_mapping_versions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE POLICY tax_payable_mapping_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.tax_payable.approve');
CREATE POLICY tax_payable_mapping_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='tax_payable_mapping_versions');
CREATE POLICY tax_payable_mapping_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='finance.tax_payable.approve');
CREATE POLICY tax_payable_mapping_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tax_payable.approve' AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY tax_payable_mapping_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tax_payable.approve' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.tax_payable.approve' AND state='committed');
CREATE POLICY tax_payable_mapping_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='tax_payable_mapping_versions' AND action='approve' AND origin='manual' AND import_row_id IS NULL);

CREATE FUNCTION crest_private.invoice_tax_payable_account_matches(account crest.accounts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $matches$
 SELECT (account.code,account.account_type,account.normal_side,account.control_kind,account.currency)
  IS NOT DISTINCT FROM ('2100'::text,'liability'::text,'credit'::text,'tax_payable'::text,'USD'::character(3))
$matches$;

CREATE FUNCTION crest_private.invoice_tax_payable_mapping_snapshot(mapping crest.tax_payable_mapping_versions)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',1,'id',mapping.id,'businessId',mapping.business_id,
  'jurisdiction',mapping.jurisdiction,'version',mapping.version::text,'accountId',mapping.account_id,
  'effectiveFrom',to_char(mapping.effective_from,'YYYY-MM-DD'),'reason',mapping.reason,'auditEventId',mapping.audit_event_id)
$snapshot$;

CREATE FUNCTION crest_private.check_invoice_tax_payable_mapping() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE prior crest.tax_payable_mapping_versions; before_snapshot jsonb; after_snapshot jsonb;
BEGIN
 IF NEW.version>1 THEN
  SELECT m.* INTO STRICT prior FROM crest.tax_payable_mapping_versions m
  WHERE (m.business_id,m.jurisdiction,m.version)=(NEW.business_id,NEW.jurisdiction,NEW.previous_version);
  IF NEW.effective_from<=prior.effective_from THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_MAPPING_EFFECTIVE_ORDER_REQUIRED';
  END IF;
  before_snapshot:=crest_private.invoice_tax_payable_mapping_snapshot(prior);
 END IF;
 IF NEW.account_id IS NULL AND prior.account_id IS NULL OR NEW.account_id IS NOT NULL AND NOT EXISTS(
  SELECT FROM crest.accounts a WHERE (a.business_id,a.id)=(NEW.business_id,NEW.account_id)
   AND crest_private.invoice_tax_payable_account_matches(a)
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_MAPPING_ACCOUNT_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT FROM crest.tax_profiles p WHERE (p.business_id,p.jurisdiction)=(NEW.business_id,NEW.jurisdiction)
  AND p.synthetic) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_MAPPING_JURISDICTION_REQUIRED';
 END IF;
 after_snapshot:=crest_private.invoice_tax_payable_mapping_snapshot(NEW);
 IF NOT EXISTS(
  SELECT FROM crest_private.audit_events a JOIN crest_private.operations o USING(business_id,operation_id,actor_id)
  WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
   AND a.entity_kind='tax_payable_mapping_versions' AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action='approve' AND a.reason=NEW.reason AND a.origin='manual' AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_snapshot,'after',after_snapshot)
   AND o.command_type='finance.tax_payable.approve' AND o.state='committed' AND o.origin='manual'
   AND o.result=after_snapshot AND o.import_row_id IS NULL
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_MAPPING_APPROVAL_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER invoice_tax_payable_mapping_audited AFTER INSERT ON crest.tax_payable_mapping_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_invoice_tax_payable_mapping();
CREATE TRIGGER invoice_tax_payable_mapping_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tax_payable_mapping_versions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.require_unmapped_invoice_tax_account_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $archive$
DECLARE business_day date;
BEGIN
 SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date INTO STRICT business_day FROM crest.businesses b WHERE b.id=NEW.business_id;
 IF EXISTS(SELECT FROM crest.tax_payable_mapping_versions m
  WHERE (m.business_id,m.account_id)=(NEW.business_id,NEW.account_id)
   AND (m.effective_from>business_day OR NOT EXISTS(
    SELECT FROM crest.tax_payable_mapping_versions n WHERE (n.business_id,n.jurisdiction)=(m.business_id,m.jurisdiction)
     AND n.effective_from>m.effective_from AND n.effective_from<=business_day
   ))) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_ACCOUNT_STILL_ASSIGNED';
 END IF;
 RETURN NEW;
END $archive$;
CREATE TRIGGER invoice_tax_payable_account_archive BEFORE INSERT ON crest.account_versions
 FOR EACH ROW WHEN (NOT NEW.active) EXECUTE FUNCTION crest_private.require_unmapped_invoice_tax_account_archive();

CREATE FUNCTION crest_private.resolve_invoice_tax_payable_mapping(business uuid, scope_jurisdiction text, on_date date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $resolve$
 SELECT jsonb_build_object('mappingId',m.id,'accountId',a.id,'accountCode',a.code)
 FROM (SELECT * FROM crest.tax_payable_mapping_versions v
  WHERE (v.business_id,v.jurisdiction)=(business,scope_jurisdiction) AND v.effective_from<=on_date
  ORDER BY v.effective_from DESC LIMIT 1) m
 JOIN crest.accounts a ON (a.business_id,a.id)=(m.business_id,m.account_id)
 WHERE crest_private.invoice_tax_payable_account_matches(a)
  AND (SELECT v.active FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(a.business_id,a.id)
   ORDER BY v.version DESC LIMIT 1) IS TRUE
$resolve$;

CREATE FUNCTION crest_commands.approve_invoice_tax_payable_mapping(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, requested_jurisdiction text, expected_version bigint,
 requested_account uuid, requested_from date, requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $approve$
DECLARE digest text; claim uuid; saved record; prior crest.tax_payable_mapping_versions;
 mapping crest.tax_payable_mapping_versions; event_id uuid:=gen_random_uuid(); receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_jurisdiction IS NULL
  OR char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
  OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]'
  OR expected_version IS NULL OR expected_version NOT BETWEEN 0 AND 9223372036854775806
  OR requested_from IS NULL OR requested_from NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 1000
  OR requested_reason<>btrim(requested_reason) OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_TAX_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.tax_payable.approve',1,requested_business,expected_actor,
  expected_epoch,requested_jurisdiction,expected_version::text,requested_account,to_char(requested_from,'YYYY-MM-DD'),
  requested_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.tax_payable.approve',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type='finance.tax_payable.approve' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT m.* INTO prior FROM crest.tax_payable_mapping_versions m
 WHERE (m.business_id,m.jurisdiction)=(requested_business,requested_jurisdiction) ORDER BY m.version DESC LIMIT 1;
 IF coalesce(prior.version,0)<>expected_version THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='INVOICE_TAX_MAPPING_VERSION_CONFLICT';
 END IF;
 IF prior.id IS NOT NULL AND requested_from<=prior.effective_from THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_TAX_MAPPING_EFFECTIVE_ORDER_REQUIRED';
 END IF;
 IF requested_account IS NOT NULL AND NOT EXISTS(SELECT FROM crest.accounts a
  WHERE (a.business_id,a.id)=(requested_business,requested_account) AND crest_private.invoice_tax_payable_account_matches(a)
   AND (SELECT v.active FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(a.business_id,a.id)
    ORDER BY v.version DESC LIMIT 1) IS TRUE) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_TAX_MAPPING_ACCOUNT_REQUIRED';
 END IF;
 INSERT INTO crest.tax_payable_mapping_versions(business_id,jurisdiction,version,account_id,effective_from,reason,audit_event_id,created_by,operation_id)
 VALUES(requested_business,requested_jurisdiction,expected_version+1,requested_account,requested_from,requested_reason,event_id,
  expected_actor,requested_operation) RETURNING * INTO mapping;
 receipt:=crest_private.invoice_tax_payable_mapping_snapshot(mapping);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'tax_payable_mapping_versions',mapping.id,
  mapping.version,'approve',requested_reason,jsonb_build_object('schemaVersion',1,
   'before',CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.invoice_tax_payable_mapping_snapshot(prior) END,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $approve$;

CREATE FUNCTION crest_commands.read_invoice_tax_payable_mapping(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_jurisdiction text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE latest jsonb; eligible jsonb;
BEGIN
 IF requested_jurisdiction IS NULL OR char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200
  OR requested_jurisdiction<>btrim(requested_jurisdiction) OR requested_jurisdiction~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_TAX_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 IF EXISTS(SELECT FROM crest.tax_profiles p WHERE (p.business_id,p.jurisdiction)=(requested_business,requested_jurisdiction)
  AND p.synthetic) THEN
  SELECT crest_private.invoice_tax_payable_mapping_snapshot(m)||jsonb_build_object('operationId',m.operation_id)
  INTO latest FROM crest.tax_payable_mapping_versions m
  WHERE (m.business_id,m.jurisdiction)=(requested_business,requested_jurisdiction) ORDER BY m.version DESC LIMIT 1;
  SELECT jsonb_build_object('id',a.id,'name',v.name,'code',a.code) INTO eligible FROM crest.accounts a
  CROSS JOIN LATERAL (SELECT av.name,av.active FROM crest.account_versions av
   WHERE (av.business_id,av.account_id)=(a.business_id,a.id) ORDER BY av.version DESC LIMIT 1) v
  WHERE a.business_id=requested_business AND a.code='2100' AND crest_private.invoice_tax_payable_account_matches(a) AND v.active;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jurisdiction',requested_jurisdiction,
  'latest',latest,'eligibleAccount',eligible);
END $read$;

CREATE FUNCTION crest_commands.lookup_invoice_tax_payable_mapping_approval(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_operation uuid, original_epoch uuid, requested_jurisdiction text, expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; approved crest.tax_payable_mapping_versions; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR original_epoch IS NULL OR requested_jurisdiction IS NULL
  OR char_length(requested_jurisdiction) NOT BETWEEN 1 AND 200 OR requested_jurisdiction<>btrim(requested_jurisdiction)
  OR requested_jurisdiction~'[[:cntrl:]]' OR expected_version IS NULL OR expected_version NOT BETWEEN 0 AND 9223372036854775806 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_TAX_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
  AND o.command_type='finance.tax_payable.approve' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT m.* INTO STRICT approved FROM crest.tax_payable_mapping_versions m
 WHERE (m.business_id,m.operation_id,m.created_by)=(requested_business,requested_operation,expected_actor);
 IF (saved.recovery_epoch,approved.jurisdiction,approved.version) IS DISTINCT FROM
  (original_epoch,requested_jurisdiction,expected_version+1) THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 receipt:=crest_private.invoice_tax_payable_mapping_snapshot(approved);
 IF saved.result IS DISTINCT FROM receipt THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_MAPPING_APPROVAL_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $lookup$;

CREATE FUNCTION crest_commands.review_invoice_issue_accounts(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_draft uuid, expected_revision bigint, line_jurisdictions jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE assessment jsonb; mapping jsonb; target_date date; purpose text; jurisdiction text;
 fixed jsonb:='{}'::jsonb; missing jsonb:='[]'::jsonb; tax_jurisdictions jsonb:='[]'::jsonb; tax_mappings jsonb:='{}'::jsonb;
BEGIN
 assessment:=crest_commands.review_invoice_issue_tax($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 IF assessment->>'state'<>'review' THEN RETURN jsonb_build_object('taxReview',assessment,'accountReview',NULL); END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(assessment->'lines') e(line) WHERE line->>'state'<>'ready') THEN
  RETURN jsonb_build_object('taxReview',assessment,'accountReview',NULL);
 END IF;
 -- The same configuration lock used by mapping/tax changes gives this review
 -- a coherent view. Re-read under it so changes during the first read cannot
 -- yield account requirements for a superseded tax treatment or draft.
 PERFORM set_config('crest.business_id',requested_business::text,true);
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('taxReview',assessment,'accountReview',NULL); END IF;
 assessment:=crest_commands.review_invoice_issue_tax($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 IF assessment->>'state'<>'review' THEN RETURN jsonb_build_object('taxReview',assessment,'accountReview',NULL); END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(assessment->'lines') e(line) WHERE line->>'state'<>'ready') THEN
  RETURN jsonb_build_object('taxReview',assessment,'accountReview',NULL);
 END IF;
 target_date:=(assessment->>'issueDate')::date;
 FOR purpose IN SELECT p.key FROM (VALUES
   ('ar','inclusiveCents'),('discount','discountNetCents'),('service_revenue','grossNetCents')
  ) p(key,component)
  WHERE EXISTS(SELECT FROM jsonb_array_elements(assessment->'lines') e(line)
    WHERE (line->'components'->>p.component)::bigint>0)
  ORDER BY p.key COLLATE "C"
 LOOP
  BEGIN
   mapping:=crest_commands.resolve_fixed_finance_mapping($1,$2,$3,$4,$5,$6,$7,$8,purpose,target_date);
   fixed:=fixed||jsonb_build_object(purpose,jsonb_build_object('mappingId',mapping->'id',
    'accountId',mapping->'accountId','accountCode',mapping->'accountCode'));
  EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'MAPPING_NOT_READY' THEN RAISE; END IF;
   missing:=missing||jsonb_build_array(purpose);
  END;
 END LOOP;
 FOR jurisdiction IN SELECT DISTINCT (line->>'jurisdiction') COLLATE "C" FROM jsonb_array_elements(assessment->'lines') e(line)
  WHERE (line->'components'->>'taxCents')::bigint>0 ORDER BY 1
 LOOP
  mapping:=crest_private.resolve_invoice_tax_payable_mapping(requested_business,jurisdiction,target_date);
  IF mapping IS NULL THEN tax_jurisdictions:=tax_jurisdictions||jsonb_build_array(jurisdiction);
  ELSE tax_mappings:=tax_mappings||jsonb_build_object(jurisdiction,mapping); END IF;
 END LOOP;
 RETURN jsonb_build_object('taxReview',assessment,'accountReview',jsonb_build_object(
  'fixedMappings',fixed,'missingFixedPurposes',missing,'requiredTaxJurisdictions',tax_jurisdictions)
  ||CASE WHEN tax_mappings='{}'::jsonb THEN '{}'::jsonb ELSE jsonb_build_object('taxMappings',tax_mappings) END);
END $review$;
RESET ROLE;
ALTER FUNCTION crest_private.check_invoice_tax_payable_mapping() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.require_unmapped_invoice_tax_account_archive() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_invoice_tax_payable_mapping(),crest_private.require_unmapped_invoice_tax_account_archive(),
 crest_private.invoice_tax_payable_account_matches(crest.accounts),crest_private.invoice_tax_payable_mapping_snapshot(crest.tax_payable_mapping_versions),
 crest_private.resolve_invoice_tax_payable_mapping(uuid,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.invoice_tax_payable_account_matches(crest.accounts),
 crest_private.invoice_tax_payable_mapping_snapshot(crest.tax_payable_mapping_versions),crest_private.resolve_invoice_tax_payable_mapping(uuid,text,date)
 TO crest_finance_integrity_owner,crest_finance_account_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.approve_invoice_tax_payable_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint,uuid,date,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_invoice_tax_payable_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_invoice_tax_payable_mapping_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.review_invoice_issue_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.approve_invoice_tax_payable_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint,uuid,date,text),
 crest_commands.read_invoice_tax_payable_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text),
 crest_commands.lookup_invoice_tax_payable_mapping_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint),
 crest_commands.review_invoice_issue_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.approve_invoice_tax_payable_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint,uuid,date,text),
 crest_commands.read_invoice_tax_payable_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text),
 crest_commands.lookup_invoice_tax_payable_mapping_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint),
 crest_commands.review_invoice_issue_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-issue-account-review.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-issuance-prerequisites.sql
-- P01/P02 issuance prerequisites. No automatic series or open period.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.accounting_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 starts_on date NOT NULL CHECK (starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 month_start date GENERATED ALWAYS AS (date_trunc('month',starts_on::timestamp)::date) STORED,
 through_on date NOT NULL,
 time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 128),
 opening_boundary boolean NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,month_start),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK (through_on=(date_trunc('month',starts_on::timestamp)+interval '1 month - 1 day')::date),
 CHECK (opening_boundary OR extract(day FROM starts_on)=1)
);
CREATE UNIQUE INDEX one_opening_accounting_period ON crest.accounting_periods(business_id) WHERE opening_boundary;
ALTER TABLE crest.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.accounting_periods FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.validate_accounting_period_start() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $period$
BEGIN
 -- Period mutations share the finance lock in the future command layer.
 IF NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=NEW.time_zone) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_TIMEZONE_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.accounting_periods p WHERE p.business_id=NEW.business_id
  AND p.id<>NEW.id AND (NEW.opening_boundary AND p.starts_on<NEW.starts_on
    OR p.opening_boundary AND NEW.starts_on<p.starts_on)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED';
 END IF;
 RETURN NULL;
END $period$;

CREATE CONSTRAINT TRIGGER accounting_period_valid AFTER INSERT ON crest.accounting_periods
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.validate_accounting_period_start();
CREATE TRIGGER accounting_period_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.accounting_periods
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.accounting_periods TO crest_finance_integrity_owner;
CREATE POLICY accounting_period_integrity ON crest.accounting_periods FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE TABLE crest.invoice_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 label text NOT NULL CHECK (label ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,79}$'),
 recovery_epoch uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('original','recovery')),
 incident_id uuid,
 approval_reason text NOT NULL CHECK (char_length(btrim(approval_reason)) BETWEEN 1 AND 1000),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,label),
 UNIQUE(business_id,recovery_epoch),
 UNIQUE(business_id,id,recovery_epoch),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK ((kind='original' AND incident_id IS NULL)
  OR (kind='recovery' AND incident_id IS NOT NULL AND right(label,36)=recovery_epoch::text))
);
CREATE UNIQUE INDEX one_original_invoice_series ON crest.invoice_series(business_id) WHERE kind='original';
ALTER TABLE crest.invoice_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_series FORCE ROW LEVEL SECURITY;

CREATE TABLE crest.invoice_number_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 full_number text NOT NULL CHECK (char_length(full_number)>=1 AND char_length(full_number)<=120 AND full_number=btrim(full_number)
  AND full_number !~ '[[:cntrl:]]'),
 series_id uuid,
 number_sequence bigint CHECK (number_sequence>0),
 issued_source_id uuid,
 incident_id uuid,
 external_evidence text CHECK (char_length(btrim(external_evidence)) BETWEEN 1 AND 2000),
 recovery_epoch uuid NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,full_number),
 UNIQUE(business_id,series_id,number_sequence),
 UNIQUE(business_id,issued_source_id),
 FOREIGN KEY(business_id,series_id,recovery_epoch) REFERENCES crest.invoice_series(business_id,id,recovery_epoch) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK ((series_id IS NULL)=(number_sequence IS NULL)),
 CHECK ((incident_id IS NULL AND external_evidence IS NULL AND issued_source_id IS NOT NULL AND series_id IS NOT NULL)
  OR (incident_id IS NOT NULL AND external_evidence IS NOT NULL))
);
ALTER TABLE crest.invoice_number_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_number_reservations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.invoice_series TO crest_finance_integrity_owner;
CREATE POLICY invoice_series_integrity ON crest.invoice_series FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE FUNCTION crest_private.verify_invoice_number_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $number$
BEGIN
 IF NEW.incident_id IS NULL AND NOT EXISTS(
  SELECT FROM crest.invoice_series s
  WHERE (s.business_id,s.id,s.recovery_epoch)=(NEW.business_id,NEW.series_id,NEW.recovery_epoch)
   AND NEW.full_number=s.label||'-'||NEW.number_sequence::text
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_NUMBER_SERIES_REQUIRED';
 END IF;
 RETURN NULL;
END $number$;
CREATE CONSTRAINT TRIGGER invoice_number_verified AFTER INSERT ON crest.invoice_number_reservations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_number_reservation();
CREATE TRIGGER invoice_series_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_series
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER invoice_numbers_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_number_reservations
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

-- The issue command owns the operation, lock order and posting transaction.
-- Reserving a number is an internal step within that same transaction.
CREATE UNIQUE INDEX ordinary_invoice_number_operation ON crest.invoice_number_reservations(business_id,operation_id)
 WHERE incident_id IS NULL;
GRANT SELECT ON crest.invoice_series,crest.invoice_number_reservations TO crest_finance_account_owner;
GRANT INSERT(business_id,full_number,series_id,number_sequence,issued_source_id,recovery_epoch,created_by,operation_id)
 ON crest.invoice_number_reservations TO crest_finance_account_owner;
CREATE POLICY invoice_series_issue_read ON crest.invoice_series FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_number_issue_read ON crest.invoice_number_reservations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY invoice_number_issue_append ON crest.invoice_number_reservations FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND incident_id IS NULL AND external_evidence IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=invoice_number_reservations.business_id
    AND o.operation_id=invoice_number_reservations.operation_id
    AND o.actor_id=invoice_number_reservations.created_by
    AND o.recovery_epoch=invoice_number_reservations.recovery_epoch
    AND o.command_type='finance.invoice.issue' AND o.state='pending'));
CREATE POLICY invoice_number_issue_operation ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.issue');
GRANT SELECT(id,business_id,active_epoch,writes_enabled) ON crest_private.business_recovery_authorities TO crest_finance_account_owner;
CREATE POLICY invoice_number_issue_authority ON crest_private.business_recovery_authorities FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_private.reserve_issued_invoice_number(requested_invoice uuid, expected_epoch uuid)
 RETURNS TABLE(reservation_id uuid, invoice_number text) LANGUAGE plpgsql VOLATILE
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE
 business uuid:=nullif(current_setting('crest.business_id',true),'')::uuid;
 actor uuid:=nullif(current_setting('crest.actor_id',true),'')::uuid;
 operation uuid:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 series crest.invoice_series;
 last_sequence bigint;
 next_number text;
BEGIN
 IF requested_invoice IS NULL OR expected_epoch IS NULL OR NOT EXISTS(
  SELECT FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id,o.recovery_epoch)=
   (business,operation,actor,expected_epoch) AND o.command_type='finance.invoice.issue' AND o.state='pending'
 ) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='INVOICE_NUMBER_ISSUE_CONTEXT_REQUIRED';
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT FROM crest_private.finance_controls f JOIN crest_private.business_recovery_authorities a
  ON (a.business_id,a.id)=(f.business_id,f.recovery_authority_id)
  WHERE f.business_id=business AND a.active_epoch=expected_epoch AND a.writes_enabled) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_REVIEW_REQUIRED';
 END IF;
 SELECT s.* INTO series FROM crest.invoice_series s WHERE (s.business_id,s.recovery_epoch)=(business,expected_epoch);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVED_INVOICE_SERIES_REQUIRED'; END IF;
 SELECT coalesce(max(n.number_sequence),0) INTO last_sequence FROM crest.invoice_number_reservations n
 WHERE (n.business_id,n.series_id)=(business,series.id);
 LOOP
  IF last_sequence=9223372036854775807 THEN
   RAISE EXCEPTION USING ERRCODE='22003',MESSAGE='INVOICE_SERIES_EXHAUSTED';
  END IF;
  last_sequence:=last_sequence+1;
  next_number:=series.label||'-'||last_sequence::text;
  EXIT WHEN NOT EXISTS(SELECT FROM crest.invoice_number_reservations n WHERE (n.business_id,n.full_number)=(business,next_number));
 END LOOP;
 RETURN QUERY INSERT INTO crest.invoice_number_reservations
  (business_id,full_number,series_id,number_sequence,issued_source_id,recovery_epoch,created_by,operation_id)
  VALUES(business,next_number,series.id,last_sequence,requested_invoice,expected_epoch,actor,operation)
  RETURNING id,full_number;
END $reserve$;
REVOKE ALL ON FUNCTION crest_private.reserve_issued_invoice_number(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.reserve_issued_invoice_number(uuid,uuid) TO crest_finance_account_owner;

RESET ROLE;
ALTER FUNCTION crest_private.validate_accounting_period_start() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_number_reservation() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.validate_accounting_period_start(),crest_private.verify_invoice_number_reservation() FROM PUBLIC;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-issuance-prerequisites.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-issuance-period-fence.sql
-- A posted event must cite an open month and generation observed while
-- holding the shared finance-control row lock.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.accounting_period_locks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 period_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 previous_generation bigint GENERATED ALWAYS AS (nullif(generation-1,0)) STORED,
 state text NOT NULL CHECK(state IN ('locked','reopened')),
 evidence_ref text NOT NULL CHECK(char_length(evidence_ref)>=1 AND char_length(evidence_ref)<=500
  AND btrim(evidence_ref)=evidence_ref AND evidence_ref !~ '[[:cntrl:]]'),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,period_id,generation),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,period_id) REFERENCES crest.accounting_periods(business_id,id),
 FOREIGN KEY(business_id,period_id,previous_generation) REFERENCES crest.accounting_period_locks(business_id,period_id,generation),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((state='locked')=(generation%2=1))
);
ALTER TABLE crest.accounting_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.accounting_period_locks FORCE ROW LEVEL SECURITY;
CREATE TRIGGER accounting_period_lock_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.accounting_period_locks
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.accounting_periods,crest.accounting_period_locks TO crest_finance_account_owner;
CREATE POLICY finance_accounting_period_read ON crest.accounting_periods FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_accounting_period_lock_read ON crest.accounting_period_locks FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_private.require_open_accounting_period(requested_business uuid, effective_on date, requested_zone text)
 RETURNS TABLE(period_id uuid, generation bigint) LANGUAGE plpgsql VOLATILE
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $period$
BEGIN
 IF requested_business IS NULL OR effective_on IS NULL OR NOT isfinite(effective_on)
  OR requested_zone IS NULL OR requested_business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ACCOUNTING_PERIOD_CONTEXT_REQUIRED';
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';
 END IF;
 RETURN QUERY SELECT p.id,coalesce(l.generation,0) FROM crest.accounting_periods p
 LEFT JOIN LATERAL (
  SELECT h.generation,h.state FROM crest.accounting_period_locks h
  WHERE (h.business_id,h.period_id)=(p.business_id,p.id) ORDER BY h.generation DESC LIMIT 1
 ) l ON true
 WHERE p.business_id=requested_business AND p.time_zone=requested_zone
  AND effective_on BETWEEN p.starts_on AND p.through_on AND l.state IS DISTINCT FROM 'locked';
 IF NOT FOUND THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_OPEN_PERIOD_REQUIRED';
 END IF;
END $period$;
REVOKE ALL ON FUNCTION crest_private.require_open_accounting_period(uuid,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.require_open_accounting_period(uuid,date,text) TO crest_finance_account_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-issuance-period-fence.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-setup.sql
-- Held fictional setup. No production activation, balance, posting or period unlock.
SET LOCAL ROLE crest_schema_owner;

CREATE POLICY invoice_setup_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice_setup.configure');
CREATE POLICY invoice_setup_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind IN('invoice_series','accounting_periods') AND action='configure');
GRANT SELECT(recovery_epoch) ON crest_private.operations TO crest_finance_integrity_owner;
CREATE POLICY invoice_setup_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='finance.invoice_setup.configure');
CREATE POLICY invoice_setup_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_setup.configure' AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY invoice_setup_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_setup.configure' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice_setup.configure' AND state='committed');
CREATE POLICY invoice_setup_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind IN('invoice_series','accounting_periods') AND action='configure' AND origin='manual' AND import_row_id IS NULL);

GRANT INSERT(business_id,label,recovery_epoch,kind,approval_reason,created_by,operation_id) ON crest.invoice_series TO crest_finance_account_owner;
GRANT INSERT(business_id,starts_on,through_on,time_zone,opening_boundary,created_by,operation_id) ON crest.accounting_periods TO crest_finance_account_owner;
CREATE POLICY invoice_setup_series_insert ON crest.invoice_series FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND kind='original' AND incident_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=invoice_series.business_id AND o.operation_id=invoice_series.operation_id
    AND o.actor_id=invoice_series.created_by AND o.recovery_epoch=invoice_series.recovery_epoch
    AND o.command_type='finance.invoice_setup.configure' AND o.state='pending'));
CREATE POLICY invoice_setup_period_insert ON crest.accounting_periods FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=accounting_periods.business_id AND o.operation_id=accounting_periods.operation_id
    AND o.actor_id=accounting_periods.created_by
    AND o.command_type='finance.invoice_setup.configure' AND o.state='pending'));

CREATE FUNCTION crest_private.fictional_invoice_series_snapshot(series crest.invoice_series)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('id',series.id,'label',series.label,'recoveryEpoch',series.recovery_epoch,'kind',series.kind)
$snapshot$;
CREATE FUNCTION crest_private.fictional_accounting_period_snapshot(period crest.accounting_periods)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('id',period.id,'startsOn',to_char(period.starts_on,'YYYY-MM-DD'),
  'throughOn',to_char(period.through_on,'YYYY-MM-DD'),'timeZone',period.time_zone,'openingBoundary',period.opening_boundary)
$snapshot$;

CREATE FUNCTION crest_private.verify_fictional_invoice_setup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE o record; snapshot jsonb; setup_kind text;
BEGIN
 SELECT p.state,p.recovery_epoch,p.result INTO o FROM crest_private.operations p WHERE (p.business_id,p.operation_id,p.actor_id)=
  (NEW.business_id,NEW.operation_id,NEW.created_by) AND p.command_type='finance.invoice_setup.configure';
 -- Historic source and special incident recovery use their own provenance.
 -- Ordinary inserts through the finance policy can only reach this branch.
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='invoice_series' THEN
  setup_kind:='invoice_series';
  snapshot:=crest_private.fictional_invoice_series_snapshot(NEW);
  IF NEW.kind<>'original' OR NEW.recovery_epoch<>o.recovery_epoch OR NEW.approval_reason IS DISTINCT FROM o.result->>'reason' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_SETUP_APPROVAL_REQUIRED';
  END IF;
 ELSE
  setup_kind:='accounting_period';
  snapshot:=crest_private.fictional_accounting_period_snapshot(NEW);
 END IF;
 IF o.state<>'committed' OR o.result IS DISTINCT FROM jsonb_build_object(
  'schemaVersion',1,'businessId',NEW.business_id,'operationId',NEW.operation_id,'kind',setup_kind,'record',snapshot,
  'auditEventId',o.result->'auditEventId','reason',o.result->'reason'
 ) OR NOT EXISTS(SELECT FROM crest_private.audit_events a
  WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action)=
   (NEW.business_id,NEW.operation_id,NEW.created_by,TG_TABLE_NAME,NEW.id,1,'configure')
   AND a.id::text=o.result->>'auditEventId' AND a.reason=o.result->>'reason'
   AND a.origin='manual' AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',o.result)
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_SETUP_APPROVAL_REQUIRED';
 END IF;
 RETURN NULL;
END $verify$;
CREATE CONSTRAINT TRIGGER invoice_series_setup_audited AFTER INSERT ON crest.invoice_series
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_invoice_setup();
CREATE CONSTRAINT TRIGGER accounting_period_setup_audited AFTER INSERT ON crest.accounting_periods
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_fictional_invoice_setup();

CREATE FUNCTION crest_commands.configure_fictional_invoice_setup(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, request jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $configure$
DECLARE setup_kind text; reason text; label text; requested_start date; month_boundary date; opening_start date;
 series crest.invoice_series; period crest.accounting_periods; saved record; context jsonb; zone text; today date;
 digest text; claim uuid; record_id uuid; entity_kind text; snapshot jsonb; receipt jsonb; event_id uuid:=gen_random_uuid();
BEGIN
 IF requested_operation IS NULL OR jsonb_typeof(request) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END IF;
 setup_kind:=request->>'kind'; reason:=request->>'reason';
 IF jsonb_typeof(request->'reason') IS DISTINCT FROM 'string'
  OR char_length(reason) NOT BETWEEN 1 AND 1000 OR reason<>btrim(reason) OR reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END IF;
 CASE setup_kind
 WHEN 'invoice_series' THEN
  label:=request->>'label';
  IF request-ARRAY['kind','label','reason']<>'{}'::jsonb OR jsonb_typeof(request->'label') IS DISTINCT FROM 'string'
   OR label!~'^[A-Za-z0-9][A-Za-z0-9-]{0,79}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
  END IF;
 WHEN 'accounting_period' THEN
  IF request-ARRAY['kind','startsOn','reason']<>'{}'::jsonb OR jsonb_typeof(request->'startsOn') IS DISTINCT FROM 'string'
   OR request->>'startsOn'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
  END IF;
  BEGIN
   requested_start:=(request->>'startsOn')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
  END;
 ELSE
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END CASE;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.invoice_setup.configure',1,requested_business,expected_actor,
  expected_epoch,request)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice_setup.configure',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type='finance.invoice_setup.configure' AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=context->>'timezone';
 today:=(clock_timestamp() AT TIME ZONE zone)::date;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 IF setup_kind='invoice_series' THEN
  -- The ordinary command never creates a recovery namespace or guesses prior numbers.
  IF EXISTS(SELECT FROM crest.invoice_series s WHERE s.business_id=requested_business)
   OR EXISTS(SELECT FROM crest.invoice_number_reservations n WHERE n.business_id=requested_business) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ORIGINAL_SERIES_ALREADY_CONFIGURED';
  END IF;
  INSERT INTO crest.invoice_series(business_id,label,recovery_epoch,kind,approval_reason,created_by,operation_id)
  VALUES(requested_business,label,expected_epoch,'original',reason,expected_actor,requested_operation) RETURNING * INTO series;
  record_id:=series.id;
  entity_kind:='invoice_series';
  snapshot:=crest_private.fictional_invoice_series_snapshot(series);
 ELSE
  month_boundary:=date_trunc('month',requested_start::timestamp)::date;
  SELECT p.starts_on INTO opening_start FROM crest.accounting_periods p WHERE p.business_id=requested_business AND p.opening_boundary;
  IF requested_start>today OR (opening_start IS NOT NULL AND (requested_start<=opening_start OR requested_start<>month_boundary))
   OR (opening_start IS NULL AND EXISTS(SELECT FROM crest.accounting_periods p WHERE p.business_id=requested_business)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_OPENING_ORDER_REQUIRED';
  END IF;
  IF EXISTS(SELECT FROM crest.accounting_periods p WHERE (p.business_id,p.month_start)=(requested_business,month_boundary)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCOUNTING_PERIOD_ALREADY_CONFIGURED';
  END IF;
  INSERT INTO crest.accounting_periods(business_id,starts_on,through_on,time_zone,opening_boundary,created_by,operation_id)
  VALUES(requested_business,requested_start,(month_boundary+interval '1 month - 1 day')::date,zone,opening_start IS NULL,
   expected_actor,requested_operation) RETURNING * INTO period;
  record_id:=period.id;
  entity_kind:='accounting_periods';
  snapshot:=crest_private.fictional_accounting_period_snapshot(period);
 END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'kind',setup_kind,
  'record',snapshot,'auditEventId',event_id,'reason',reason);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,entity_kind,record_id,1,'configure',reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $configure$;

CREATE FUNCTION crest_commands.read_fictional_invoice_setup(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, requested_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb; zone text; today date; selected date; series jsonb; opening_period jsonb; selected_period jsonb;
BEGIN
 IF requested_on IS NOT NULL AND requested_on NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_SETUP_INPUT_REQUIRED';
 END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=context->>'timezone';
 today:=(clock_timestamp() AT TIME ZONE zone)::date;
 selected:=coalesce(requested_on,today);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.fictional_invoice_series_snapshot(s)||jsonb_build_object('operationId',s.operation_id)
 INTO series FROM crest.invoice_series s JOIN crest_private.finance_controls f ON f.business_id=s.business_id
 JOIN crest_private.business_recovery_authorities a ON (a.business_id,a.id)=(f.business_id,f.recovery_authority_id)
 WHERE s.business_id=requested_business AND s.recovery_epoch=a.active_epoch;
 SELECT crest_private.fictional_accounting_period_snapshot(p)||jsonb_build_object('operationId',p.operation_id)
 INTO opening_period FROM crest.accounting_periods p WHERE p.business_id=requested_business AND p.opening_boundary;
 SELECT crest_private.fictional_accounting_period_snapshot(p)||jsonb_build_object('operationId',p.operation_id,
  'state',CASE WHEN l.state='locked' THEN 'locked' ELSE 'open' END,'generation',coalesce(l.generation,0)::text)
 INTO selected_period FROM crest.accounting_periods p LEFT JOIN LATERAL (
  SELECT h.state,h.generation FROM crest.accounting_period_locks h
  WHERE (h.business_id,h.period_id)=(p.business_id,p.id) ORDER BY h.generation DESC LIMIT 1
 ) l ON true WHERE p.business_id=requested_business AND p.time_zone=zone AND selected BETWEEN p.starts_on AND p.through_on;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'today',to_char(today,'YYYY-MM-DD'),
  'requestedOn',to_char(selected,'YYYY-MM-DD'),'timeZone',zone,'series',series,'openingPeriod',opening_period,'period',selected_period);
END $read$;

RESET ROLE;
ALTER FUNCTION crest_private.verify_fictional_invoice_setup() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_fictional_invoice_setup(),crest_private.fictional_invoice_series_snapshot(crest.invoice_series),
 crest_private.fictional_accounting_period_snapshot(crest.accounting_periods) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fictional_invoice_series_snapshot(crest.invoice_series),
 crest_private.fictional_accounting_period_snapshot(crest.accounting_periods) TO crest_finance_integrity_owner,crest_finance_account_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.configure_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.configure_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),
 crest_commands.read_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.configure_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),
 crest_commands.read_fictional_invoice_setup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,date) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-setup.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-issued-invoice-source.sql
-- P01/P02 retained source and scope. The posting command will write these rows
-- alongside the numbered receipt, journal and receivable in one transaction.
SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest.invoice_number_reservations
 ADD CONSTRAINT invoice_number_source_identity UNIQUE(business_id,id,issued_source_id,full_number);

CREATE TABLE crest.invoices (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 draft_id uuid NOT NULL,
 draft_revision bigint NOT NULL,
 job_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 reservation_id uuid NOT NULL,
 invoice_number text NOT NULL,
 issued_on date NOT NULL CHECK(issued_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 due_on date NOT NULL CHECK(due_on BETWEEN issued_on AND DATE '9999-12-31'),
 time_zone text NOT NULL,
 customer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(customer_snapshot)='object' AND customer_snapshot->'schemaVersion' IS NOT DISTINCT FROM '1'::jsonb),
 location_snapshot jsonb NOT NULL CHECK(jsonb_typeof(location_snapshot)='object' AND location_snapshot->'schemaVersion' IS NOT DISTINCT FROM '1'::jsonb),
 total_cents bigint NOT NULL CHECK(total_cents>=0),
 currency char(3) NOT NULL CHECK(currency='USD'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,draft_id),
 UNIQUE(business_id,reservation_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,draft_id,draft_revision) REFERENCES crest.invoice_draft_revisions(business_id,draft_id,revision),
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),
 FOREIGN KEY(business_id,reservation_id,id,invoice_number)
  REFERENCES crest.invoice_number_reservations(business_id,id,issued_source_id,full_number),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX issued_invoice_job ON crest.invoices(business_id,job_id);
CREATE INDEX issued_invoice_customer ON crest.invoices(business_id,customer_id,issued_on,id);

CREATE TABLE crest.invoice_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 180),
 outcome_id uuid NOT NULL,
 completion_part_id uuid NOT NULL,
 partition_id uuid NOT NULL,
 agreement_id uuid NOT NULL,
 entitlement_version_id uuid NOT NULL,
 service_version_id uuid NOT NULL,
 tax_profile_id uuid NOT NULL,
 exemption_evidence_id uuid,
 gross_inclusive_cents bigint NOT NULL CHECK(gross_inclusive_cents>=0),
 discount_inclusive_cents bigint NOT NULL CHECK(discount_inclusive_cents>=0),
 gross_net_cents bigint NOT NULL CHECK(gross_net_cents>=0),
 discount_net_cents bigint NOT NULL CHECK(discount_net_cents>=0),
 net_cents bigint NOT NULL CHECK(net_cents>=0),
 tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 total_cents bigint NOT NULL CHECK(total_cents>=0),
 description text NOT NULL CHECK(char_length(btrim(description)) BETWEEN 1 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_id,position),
 UNIQUE(business_id,outcome_id),
 UNIQUE(business_id,completion_part_id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES crest.invoices(business_id,id),
 FOREIGN KEY(business_id,outcome_id) REFERENCES crest.work_scope_outcomes(business_id,id),
 FOREIGN KEY(business_id,completion_part_id) REFERENCES crest.allocation_plan_parts(business_id,id),
 FOREIGN KEY(business_id,agreement_id) REFERENCES crest.agreements(business_id,id),
 FOREIGN KEY(business_id,entitlement_version_id) REFERENCES crest.entitlement_versions(business_id,id),
 FOREIGN KEY(business_id,service_version_id) REFERENCES crest.service_versions(business_id,id),
 FOREIGN KEY(business_id,tax_profile_id) REFERENCES crest.tax_profiles(business_id,id),
 FOREIGN KEY(business_id,exemption_evidence_id) REFERENCES crest.invoice_exemption_evidence(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(gross_inclusive_cents::numeric-discount_inclusive_cents::numeric=total_cents),
 CHECK(gross_net_cents::numeric-discount_net_cents::numeric=net_cents),
 CHECK(net_cents::numeric+tax_cents::numeric=total_cents)
);
CREATE INDEX issued_invoice_item_agreement ON crest.invoice_items(business_id,agreement_id);
CREATE INDEX issued_invoice_item_entitlement ON crest.invoice_items(business_id,entitlement_version_id);
CREATE INDEX issued_invoice_item_service ON crest.invoice_items(business_id,service_version_id);
CREATE INDEX issued_invoice_item_tax ON crest.invoice_items(business_id,tax_profile_id);
CREATE INDEX issued_invoice_item_exemption ON crest.invoice_items(business_id,exemption_evidence_id);
CREATE INDEX issued_invoice_item_operation ON crest.invoice_items(business_id,operation_id);

-- The first issue consumes the entire fulfilled partition, including a zero
-- amount. A correction must retain this original row and its unique partition.
CREATE TABLE crest.billing_consumptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_item_id uuid NOT NULL,
 partition_id uuid NOT NULL,
 consumed_cents bigint NOT NULL CHECK(consumed_cents>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_item_id),
 UNIQUE(business_id,partition_id),
 FOREIGN KEY(business_id,invoice_item_id) REFERENCES crest.invoice_items(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX billing_consumption_operation ON crest.billing_consumptions(business_id,operation_id);

ALTER TABLE crest.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.billing_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.billing_consumptions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER issued_invoice_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoices
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER issued_invoice_item_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.invoice_items
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER billing_consumption_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.billing_consumptions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

GRANT SELECT ON crest.invoices,crest.invoice_items,crest.billing_consumptions,
 crest.invoice_number_reservations TO crest_finance_integrity_owner;
CREATE POLICY issued_invoice_integrity ON crest.invoices FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY issued_invoice_item_integrity ON crest.invoice_items FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY billing_consumption_integrity ON crest.billing_consumptions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY issued_invoice_number_integrity ON crest.invoice_number_reservations FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY issued_invoice_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.invoice.issue');
CREATE POLICY issued_invoice_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='invoices' AND action='issue');
GRANT SELECT(business_id,id,display_name) ON crest.customers TO crest_finance_integrity_owner;
CREATE POLICY issued_invoice_customer_integrity ON crest.customers FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT(work_location_snapshot,state,completed_at) ON crest.jobs TO crest_finance_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.finance_tax_charge(bigint,bigint,numeric) TO crest_finance_integrity_owner;

CREATE FUNCTION crest_private.verify_issued_invoice_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE issued crest.invoices; draft crest.invoice_draft_revisions; number crest.invoice_number_reservations;
 count_items bigint; sum_items numeric;
BEGIN
 IF TG_TABLE_NAME='invoices' THEN issued:=NEW;
 ELSIF TG_TABLE_NAME='invoice_items' THEN
  SELECT i.* INTO STRICT issued FROM crest.invoices i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.invoice_id);
 ELSE
  SELECT i.* INTO STRICT issued FROM crest.invoices i JOIN crest.invoice_items item
   ON (item.business_id,item.invoice_id)=(i.business_id,i.id)
   WHERE (item.business_id,item.id)=(NEW.business_id,NEW.invoice_item_id);
 END IF;
 SELECT d.* INTO STRICT draft FROM crest.invoice_draft_revisions d
  WHERE (d.business_id,d.draft_id,d.revision)=(issued.business_id,issued.draft_id,issued.draft_revision);
 SELECT n.* INTO STRICT number FROM crest.invoice_number_reservations n
  WHERE (n.business_id,n.id)=(issued.business_id,issued.reservation_id);
 IF draft.state<>'draft' OR (draft.job_id,draft.customer_id)<>(issued.job_id,issued.customer_id)
  OR issued.due_on<>coalesce(draft.due_on,issued.issued_on)
  OR (number.created_by,number.operation_id)<>(issued.created_by,issued.operation_id)
  OR number.incident_id IS NOT NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=issued.time_zone)
  OR NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
   WHERE (o.business_id,o.operation_id,o.actor_id)=(issued.business_id,issued.operation_id,issued.created_by)
    AND o.command_type='finance.invoice.issue' AND o.state='committed'
    AND o.result->>'invoiceId'=issued.id::text AND o.result->>'invoiceNumber'=issued.invoice_number
    AND (a.entity_kind,a.entity_id,a.entity_version,a.action)=('invoices',issued.id,1::bigint,'issue')
    AND a.delta->'before'='null'::jsonb AND a.delta->'after' IS NOT DISTINCT FROM o.result)
  OR NOT EXISTS(SELECT FROM crest.jobs j JOIN crest.customers c ON (c.business_id,c.id)=(j.business_id,j.customer_id)
   WHERE (j.business_id,j.id,j.customer_id)=(issued.business_id,issued.job_id,issued.customer_id)
    AND j.state='completed' AND (j.completed_at AT TIME ZONE issued.time_zone)::date<=issued.issued_on
    AND issued.customer_snapshot=jsonb_build_object('schemaVersion',1,'id',c.id,'displayName',c.display_name)
    AND issued.location_snapshot=j.work_location_snapshot) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ISSUED_INVOICE_SOURCE_REQUIRED';
 END IF;
 SELECT count(*),sum(item.total_cents) INTO count_items,sum_items
 FROM crest.invoice_items item WHERE (item.business_id,item.invoice_id)=(issued.business_id,issued.id);
 IF count_items<>cardinality(draft.selected_outcomes) OR count_items=0 OR sum_items<>issued.total_cents THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ISSUED_INVOICE_TOTAL_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.invoice_items item
  LEFT JOIN crest.billing_consumptions c ON (c.business_id,c.invoice_item_id)=(item.business_id,item.id)
  JOIN crest.tax_profiles profile ON (profile.business_id,profile.id)=(item.business_id,item.tax_profile_id)
  CROSS JOIN LATERAL (SELECT draft.retained_lines->(item.position-1) AS line) d
  CROSS JOIN LATERAL (SELECT crest_private.finance_tax_charge(
   item.gross_inclusive_cents,item.discount_inclusive_cents,coalesce(profile.rate,0)) AS amounts) charge
  WHERE (item.business_id,item.invoice_id)=(issued.business_id,issued.id) AND (
   d.line IS NULL OR profile.treatment NOT IN('non_taxable','inclusive_single','exempt') OR profile.effective_from>issued.issued_on
   OR profile.applicability<>'service' OR profile.synthetic IS DISTINCT FROM true
   OR (profile.treatment='exempt')<>(item.exemption_evidence_id IS NOT NULL)
   OR (profile.treatment='exempt' AND NOT EXISTS(
    SELECT FROM crest.invoice_exemption_evidence e WHERE (e.business_id,e.id,e.draft_id,e.draft_revision,e.outcome_id,e.customer_id,e.jurisdiction,e.profile_id)=
     (issued.business_id,item.exemption_evidence_id,issued.draft_id,issued.draft_revision,item.outcome_id,
      issued.customer_id,profile.jurisdiction,profile.id)
    AND issued.issued_on BETWEEN e.valid_from AND e.valid_through
    AND NOT EXISTS(SELECT FROM crest.invoice_exemption_evidence newer
     WHERE (newer.business_id,newer.draft_id,newer.draft_revision,newer.outcome_id,newer.profile_id)=
      (e.business_id,e.draft_id,e.draft_revision,e.outcome_id,e.profile_id) AND newer.version>e.version)
   ))
   OR profile.service_id IS DISTINCT FROM (d.line->>'serviceId')::uuid
   OR EXISTS(SELECT FROM crest.tax_profiles newer
    WHERE (newer.business_id,newer.jurisdiction,newer.scope_key)=(profile.business_id,profile.jurisdiction,profile.scope_key)
     AND newer.effective_from>profile.effective_from AND newer.effective_from<=issued.issued_on)
   OR (item.outcome_id,item.completion_part_id,item.partition_id,item.agreement_id,item.entitlement_version_id,item.service_version_id,
    item.gross_inclusive_cents,item.discount_inclusive_cents,item.description) IS DISTINCT FROM
    ((d.line->>'outcomeId')::uuid,(d.line->>'completionPartId')::uuid,(d.line->>'partitionId')::uuid,
     (d.line->>'agreementId')::uuid,(d.line->>'entitlementVersionId')::uuid,(d.line->>'serviceVersionId')::uuid,
     (d.line->>'grossInclusiveCents')::bigint,(d.line->>'discountInclusiveCents')::bigint,d.line->>'description')
   OR (item.gross_net_cents,item.discount_net_cents,item.net_cents,item.tax_cents) IS DISTINCT FROM
    ((charge.amounts->>'grossNetCents')::bigint,(charge.amounts->>'discountNetCents')::bigint,
     (charge.amounts->>'netCents')::bigint,(charge.amounts->>'taxCents')::bigint)
   OR (item.created_by,item.operation_id)<>(issued.created_by,issued.operation_id)
   OR (c.partition_id,c.consumed_cents,c.created_by,c.operation_id) IS DISTINCT FROM
    (item.partition_id,item.total_cents,issued.created_by,issued.operation_id)
  )) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ISSUED_INVOICE_SCOPE_AND_CHARGE_REQUIRED';
 END IF;
 RETURN NULL;
END $verify$;

CREATE CONSTRAINT TRIGGER issued_invoice_source AFTER INSERT ON crest.invoices
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_issued_invoice_source();
CREATE CONSTRAINT TRIGGER issued_invoice_item_source AFTER INSERT ON crest.invoice_items
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_issued_invoice_source();
CREATE CONSTRAINT TRIGGER billing_consumption_source AFTER INSERT ON crest.billing_consumptions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_issued_invoice_source();
RESET ROLE;
ALTER FUNCTION crest_private.verify_issued_invoice_source() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_issued_invoice_source() FROM PUBLIC;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-issued-invoice-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-ledger.sql
-- P01/P02 posting records. Only restricted source commands will receive write
-- access. These constraints validate source effects again at commit.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.atomic_finance_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 commit_sequence bigint NOT NULL CHECK(commit_sequence>0),
 recovery_epoch uuid NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,commit_sequence),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.financial_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 group_id uuid NOT NULL,
 event_sequence integer NOT NULL CHECK(event_sequence>0),
 invoice_id uuid NOT NULL,
 period_id uuid NOT NULL,
 period_generation bigint NOT NULL CHECK(period_generation>=0 AND period_generation%2=0),
 reopened_generation bigint GENERATED ALWAYS AS (nullif(period_generation,0)) STORED,
 effective_on date NOT NULL,
 time_zone text NOT NULL,
 template text NOT NULL CHECK(template IN('P01','P02')),
 template_version integer NOT NULL CHECK(template_version=1),
 zero_effect_reason text CHECK(zero_effect_reason='literal_zero_charge'),
 posted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(posted_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,group_id,event_sequence),
 UNIQUE(business_id,invoice_id),
 FOREIGN KEY(business_id,group_id) REFERENCES crest.atomic_finance_groups(business_id,id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES crest.invoices(business_id,id),
 FOREIGN KEY(business_id,period_id) REFERENCES crest.accounting_periods(business_id,id),
 FOREIGN KEY(business_id,period_id,reopened_generation) REFERENCES crest.accounting_period_locks(business_id,period_id,generation)
);
CREATE INDEX invoice_event_period ON crest.financial_events(business_id,period_id,reopened_generation);

CREATE TABLE crest.receivable_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 account_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 original_cents bigint NOT NULL CHECK(original_cents>0),
 due_on date NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_id),
 FOREIGN KEY(business_id,invoice_id) REFERENCES crest.invoices(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id)
);
CREATE INDEX receivable_account ON crest.receivable_items(business_id,account_id);
CREATE INDEX receivable_customer ON crest.receivable_items(business_id,customer_id,due_on,id);

CREATE TABLE crest.invoice_tax_payable_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 event_id uuid NOT NULL,
 invoice_item_id uuid NOT NULL,
 tax_profile_id uuid NOT NULL,
 mapping_id uuid NOT NULL,
 account_id uuid NOT NULL,
 jurisdiction text NOT NULL,
 cents bigint NOT NULL CHECK(cents>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,invoice_item_id),
 FOREIGN KEY(business_id,event_id) REFERENCES crest.financial_events(business_id,id),
 FOREIGN KEY(business_id,invoice_item_id) REFERENCES crest.invoice_items(business_id,id),
 FOREIGN KEY(business_id,tax_profile_id) REFERENCES crest.tax_profiles(business_id,id),
 FOREIGN KEY(business_id,mapping_id) REFERENCES crest.tax_payable_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id)
);
CREATE INDEX invoice_tax_payable_event ON crest.invoice_tax_payable_movements(business_id,event_id);
CREATE INDEX invoice_tax_payable_profile ON crest.invoice_tax_payable_movements(business_id,tax_profile_id);
CREATE INDEX invoice_tax_payable_mapping ON crest.invoice_tax_payable_movements(business_id,mapping_id);
CREATE INDEX invoice_tax_payable_account ON crest.invoice_tax_payable_movements(business_id,account_id);
CREATE INDEX invoice_tax_payable_jurisdiction ON crest.invoice_tax_payable_movements(business_id,jurisdiction);

CREATE TABLE crest.journal_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 event_id uuid NOT NULL,
 entry_sequence integer NOT NULL CHECK(entry_sequence>0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,event_id,entry_sequence),
 FOREIGN KEY(business_id,event_id) REFERENCES crest.financial_events(business_id,id)
);
CREATE TABLE crest.journal_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 entry_id uuid NOT NULL,
 invoice_item_id uuid NOT NULL,
 receivable_id uuid,
 account_id uuid NOT NULL,
 fixed_mapping_id uuid,
 tax_payable_movement_id uuid,
 purpose text NOT NULL CHECK(purpose IN('ar','discount','service_revenue','tax_payable')),
 debit_cents bigint NOT NULL CHECK(debit_cents>=0),
 credit_cents bigint NOT NULL CHECK(credit_cents>=0),
 UNIQUE(business_id,id),
 UNIQUE(business_id,entry_id,invoice_item_id,purpose),
 FOREIGN KEY(business_id,entry_id) REFERENCES crest.journal_entries(business_id,id),
 FOREIGN KEY(business_id,invoice_item_id) REFERENCES crest.invoice_items(business_id,id),
 FOREIGN KEY(business_id,receivable_id) REFERENCES crest.receivable_items(business_id,id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,fixed_mapping_id) REFERENCES crest.account_mapping_versions(business_id,id),
 FOREIGN KEY(business_id,tax_payable_movement_id) REFERENCES crest.invoice_tax_payable_movements(business_id,id),
 CHECK((debit_cents>0)<>(credit_cents>0)),
 CHECK((purpose='ar')=(receivable_id IS NOT NULL)),
 CHECK((purpose='tax_payable')=(tax_payable_movement_id IS NOT NULL)),
 CHECK((purpose='tax_payable')=(fixed_mapping_id IS NULL))
);
CREATE INDEX invoice_journal_line_item ON crest.journal_lines(business_id,invoice_item_id);
CREATE INDEX invoice_journal_line_account ON crest.journal_lines(business_id,account_id);
CREATE INDEX invoice_journal_line_mapping ON crest.journal_lines(business_id,fixed_mapping_id);
CREATE INDEX invoice_journal_line_receivable ON crest.journal_lines(business_id,receivable_id);
CREATE INDEX invoice_journal_line_tax_movement ON crest.journal_lines(business_id,tax_payable_movement_id);

DO $ledger$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['atomic_finance_groups','financial_events','receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_finance_integrity_owner',name);
  EXECUTE format('CREATE POLICY finance_ledger_integrity ON crest.%I FOR SELECT TO crest_finance_integrity_owner USING(true)',name);
  EXECUTE format('CREATE TRIGGER finance_ledger_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',name);
 END LOOP;
END $ledger$;
GRANT SELECT ON crest.accounting_period_locks TO crest_finance_integrity_owner;
CREATE POLICY invoice_ledger_period_lock_integrity ON crest.accounting_period_locks FOR SELECT TO crest_finance_integrity_owner USING(true);
GRANT SELECT(recovery_epoch) ON crest_private.operations TO crest_finance_integrity_owner;

CREATE FUNCTION crest_private.verify_invoice_posting(business uuid, invoice uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE issued crest.invoices; event crest.financial_events; entry crest.journal_entries; ar crest.receivable_items;
 expected_count bigint; actual_count bigint; debits numeric; credits numeric; expected_zero boolean;
BEGIN
 SELECT i.* INTO STRICT issued FROM crest.invoices i WHERE (i.business_id,i.id)=(business,invoice);
 SELECT e.* INTO event FROM crest.financial_events e WHERE (e.business_id,e.invoice_id)=(business,invoice);
 IF NOT FOUND OR NOT EXISTS(
  SELECT FROM crest.atomic_finance_groups g
  JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(g.business_id,g.operation_id,g.created_by)
  JOIN crest.accounting_periods p ON (p.business_id,p.id)=(event.business_id,event.period_id)
  WHERE (g.business_id,g.id,g.operation_id,g.created_by,g.recovery_epoch)=
   (business,event.group_id,issued.operation_id,issued.created_by,o.recovery_epoch)
   AND event.event_sequence=1 AND event.effective_on=issued.issued_on AND event.time_zone=issued.time_zone
   AND event.template=CASE WHEN issued.total_cents=0 THEN 'P02' ELSE 'P01' END
   AND event.posted_at>=issued.created_at
   AND (event.posted_at AT TIME ZONE event.time_zone)::date=issued.issued_on
   AND event.time_zone=p.time_zone AND event.effective_on BETWEEN p.starts_on AND p.through_on
   AND event.period_generation=coalesce((SELECT max(l.generation) FROM crest.accounting_period_locks l
    WHERE (l.business_id,l.period_id)=(p.business_id,p.id)),0)
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_POSTING_EVENT_REQUIRED';
 END IF;
 SELECT r.* INTO ar FROM crest.receivable_items r WHERE (r.business_id,r.invoice_id)=(business,invoice);
 IF (ar.id IS NULL)<>(issued.total_cents=0) OR ar.id IS NOT NULL
  AND (ar.customer_id,ar.original_cents,ar.due_on) IS DISTINCT FROM (issued.customer_id,issued.total_cents,issued.due_on) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_RECEIVABLE_REQUIRED';
 END IF;
 IF (SELECT count(*) FROM crest.invoice_tax_payable_movements t WHERE (t.business_id,t.event_id)=(business,event.id))
  <> (SELECT count(*) FROM crest.invoice_items i WHERE (i.business_id,i.invoice_id)=(business,invoice) AND i.tax_cents>0)
  OR EXISTS(
   SELECT FROM crest.invoice_tax_payable_movements t
   JOIN crest.invoice_items i ON (i.business_id,i.id)=(t.business_id,t.invoice_item_id)
   JOIN crest.tax_profiles p ON (p.business_id,p.id)=(i.business_id,i.tax_profile_id)
   WHERE (t.business_id,t.event_id)=(business,event.id) AND (
    i.invoice_id<>invoice OR t.tax_profile_id<>i.tax_profile_id OR t.jurisdiction<>p.jurisdiction
    OR p.treatment<>'inclusive_single' OR p.synthetic IS DISTINCT FROM true OR t.cents<>i.tax_cents
    OR jsonb_build_object('mappingId',t.mapping_id,'accountId',t.account_id,'accountCode','2100')
     IS DISTINCT FROM crest_private.resolve_invoice_tax_payable_mapping(business,p.jurisdiction,event.effective_on)
   )
  ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_TAX_PAYABLE_EFFECT_REQUIRED';
 END IF;
 SELECT count(*) INTO expected_count FROM crest.invoice_items i CROSS JOIN LATERAL
  (VALUES(i.total_cents),(i.discount_net_cents),(i.gross_net_cents),(i.tax_cents)) amounts(cents)
  WHERE (i.business_id,i.invoice_id)=(business,invoice) AND amounts.cents>0;
 expected_zero:=expected_count=0;
 SELECT j.* INTO entry FROM crest.journal_entries j WHERE (j.business_id,j.event_id,j.entry_sequence)=(business,event.id,1);
 IF expected_zero IS DISTINCT FROM (event.zero_effect_reason IS NOT NULL)
  OR (entry.id IS NULL)<>expected_zero
  OR EXISTS(SELECT FROM crest.journal_entries j WHERE (j.business_id,j.event_id)=(business,event.id) AND j.entry_sequence<>1) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_JOURNAL_REQUIRED';
 END IF;
 IF expected_zero THEN RETURN; END IF;
 SELECT count(*),sum(l.debit_cents),sum(l.credit_cents) INTO actual_count,debits,credits
 FROM crest.journal_lines l WHERE (l.business_id,l.entry_id)=(business,entry.id);
 IF actual_count<2 OR actual_count<>expected_count OR debits<>credits OR EXISTS(
  SELECT FROM crest.journal_lines l
  JOIN crest.invoice_items i ON (i.business_id,i.id)=(l.business_id,l.invoice_item_id)
  LEFT JOIN crest.account_mapping_versions m ON (m.business_id,m.id)=(l.business_id,l.fixed_mapping_id)
  LEFT JOIN crest.invoice_tax_payable_movements t ON (t.business_id,t.id)=(l.business_id,l.tax_payable_movement_id)
  JOIN crest.accounts a ON (a.business_id,a.id)=(l.business_id,l.account_id)
  WHERE (l.business_id,l.entry_id)=(business,entry.id) AND (
   i.invoice_id<>invoice
   OR (l.purpose='tax_payable' AND (t.event_id,t.invoice_item_id,t.account_id,l.debit_cents,l.credit_cents)
    IS DISTINCT FROM (event.id,i.id,l.account_id,0::bigint,i.tax_cents))
   OR (l.purpose<>'tax_payable' AND (
    (m.purpose,m.account_id) IS DISTINCT FROM (l.purpose,l.account_id)
    OR m.effective_from>event.effective_on OR NOT crest_private.fixed_finance_mapping_matches(l.purpose,a)
    OR EXISTS(SELECT FROM crest.account_mapping_versions newer WHERE (newer.business_id,newer.purpose)=(m.business_id,m.purpose)
     AND newer.effective_from>m.effective_from AND newer.effective_from<=event.effective_on)
   ))
   OR (SELECT v.active FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(a.business_id,a.id)
    ORDER BY v.version DESC LIMIT 1) IS DISTINCT FROM true
   OR (l.purpose='ar' AND (l.receivable_id,l.account_id,l.debit_cents,l.credit_cents)
    IS DISTINCT FROM (ar.id,ar.account_id,i.total_cents,0::bigint))
   OR (l.purpose='discount' AND (l.debit_cents,l.credit_cents)<>(i.discount_net_cents,0::bigint))
   OR (l.purpose='service_revenue' AND (l.debit_cents,l.credit_cents)<>(0::bigint,i.gross_net_cents))
  )
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_JOURNAL_EFFECT_REQUIRED';
 END IF;
END $posting$;

CREATE FUNCTION crest_private.verify_invoice_posting_rows() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $posting$
DECLARE source_invoice uuid;
BEGIN
 IF TG_TABLE_NAME='invoices' THEN source_invoice:=NEW.id;
 ELSIF TG_TABLE_NAME IN('financial_events','receivable_items') THEN source_invoice:=NEW.invoice_id;
 ELSIF TG_TABLE_NAME='invoice_tax_payable_movements' THEN
  SELECT e.invoice_id INTO STRICT source_invoice FROM crest.financial_events e
   WHERE (e.business_id,e.id)=(NEW.business_id,NEW.event_id);
 ELSIF TG_TABLE_NAME='journal_entries' THEN
  SELECT e.invoice_id INTO STRICT source_invoice FROM crest.financial_events e
   WHERE (e.business_id,e.id)=(NEW.business_id,NEW.event_id);
 ELSE
  SELECT e.invoice_id INTO STRICT source_invoice FROM crest.financial_events e JOIN crest.journal_entries j
   ON (j.business_id,j.event_id)=(e.business_id,e.id) WHERE (j.business_id,j.id)=(NEW.business_id,NEW.entry_id);
 END IF;
 PERFORM crest_private.verify_invoice_posting(NEW.business_id,source_invoice);
 RETURN NULL;
END $posting$;
CREATE FUNCTION crest_private.verify_invoice_group_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $group$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.financial_events e
  WHERE (e.business_id,e.group_id,e.event_sequence)=(NEW.business_id,NEW.id,1)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_POSTING_EVENT_REQUIRED';
 END IF;
 RETURN NULL;
END $group$;
CREATE CONSTRAINT TRIGGER invoice_group_requires_event AFTER INSERT ON crest.atomic_finance_groups
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_group_source();
DO $ledger$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['invoices','financial_events','receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER invoice_posting_required AFTER INSERT ON crest.%I
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_invoice_posting_rows()',name);
 END LOOP;
END $ledger$;
RESET ROLE;
ALTER FUNCTION crest_private.verify_invoice_posting(uuid,uuid) OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_posting_rows() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.verify_invoice_group_source() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verify_invoice_posting(uuid,uuid),crest_private.verify_invoice_posting_rows(),
 crest_private.verify_invoice_group_source() FROM PUBLIC;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-ledger.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-issue.sql
-- Fictional P01/P02 issuance. Exposed only to the existing isolated finance
-- preview role, after review. Exempt items pin their original evidence.
SET LOCAL ROLE crest_schema_owner;

GRANT SELECT(business_id,id,display_name) ON crest.customers TO crest_finance_account_owner;
GRANT SELECT(work_location_snapshot) ON crest.jobs TO crest_finance_account_owner;
CREATE POLICY issue_invoice_customer ON crest.customers FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY issue_invoice_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.invoice.issue','finance.invoice.retire') AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY issue_invoice_complete ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.invoice.issue','finance.invoice.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN('finance.invoice.issue','finance.invoice.retire') AND state='committed');
CREATE POLICY retire_invoice_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='finance.invoice.retire');
CREATE POLICY issue_invoice_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='invoices' AND action='issue' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY retire_invoice_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id
    AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
    AND o.command_type='finance.invoice.retire' AND o.state='pending'));

DO $grants$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['invoices','invoice_items','billing_consumptions','atomic_finance_groups','financial_events',
  'receivable_items','invoice_tax_payable_movements','journal_entries','journal_lines'] LOOP
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_finance_account_owner',name);
  EXECUTE format('CREATE POLICY invoice_issue_read ON crest.%I FOR SELECT TO crest_finance_account_owner
   USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY invoice_issue_insert ON crest.%I FOR INSERT TO crest_finance_account_owner
   WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
    AND EXISTS(SELECT FROM crest_private.operations o
     WHERE o.business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid
      AND o.operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid
      AND o.actor_id=nullif(current_setting(''crest.actor_id'',true),'''')::uuid
      AND o.command_type=''finance.invoice.issue'' AND o.state=''pending''))',name);
 END LOOP;
END $grants$;

CREATE FUNCTION crest_private.keep_issued_invoice_draft() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $draft$
BEGIN
 IF EXISTS(SELECT FROM crest.invoices i WHERE (i.business_id,i.draft_id)=(NEW.business_id,NEW.draft_id)) THEN
  RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='INVOICE_DRAFT_REVISION_CONFLICT';
 END IF;
 RETURN NEW;
END $draft$;
CREATE TRIGGER invoice_draft_issued BEFORE INSERT ON crest.invoice_draft_revisions
 FOR EACH ROW EXECUTE FUNCTION crest_private.keep_issued_invoice_draft();
CREATE TRIGGER invoice_exemption_issued BEFORE INSERT ON crest.invoice_exemption_evidence
 FOR EACH ROW EXECUTE FUNCTION crest_private.keep_issued_invoice_draft();

CREATE FUNCTION crest_commands.prepare_reviewed_invoice_issue(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_draft uuid, expected_revision bigint, jurisdictions jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $prepare$
DECLARE review jsonb;
BEGIN
 review:=crest_commands.review_invoice_issue_accounts($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 RETURN review||jsonb_build_object('reviewDigest',encode(sha256(convert_to(review::text,'UTF8')),'hex'));
END $prepare$;

CREATE FUNCTION crest_commands.issue_reviewed_invoice(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, expected_epoch uuid, requested_operation uuid, requested_draft uuid,
 expected_revision bigint, jurisdictions jsonb, reviewed_digest text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $issue$
DECLARE
 claim uuid; digest text; saved record; draft crest.invoice_draft_revisions; review jsonb; tax jsonb; mappings jsonb;
 family uuid; zone text; issue_date date; due_date date; period record; number record;
 issued uuid:=gen_random_uuid(); group_id uuid; event_id uuid; entry_id uuid; receivable_id uuid;
 customer jsonb; location jsonb; total bigint; line record; item_id uuid; expected_line record; mapping jsonb; tax_movement_id uuid;
 zero_effect boolean; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_draft IS NULL OR expected_revision IS NULL OR expected_revision<1
  OR reviewed_digest IS NULL OR reviewed_digest !~ '^[a-f0-9]{64}$'
  OR jsonb_typeof(jurisdictions) IS DISTINCT FROM 'object' OR octet_length(jurisdictions::text)>160000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.invoice.issue',1,requested_business,expected_actor,
  expected_epoch,requested_draft,expected_revision,jurisdictions,reviewed_digest)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice.issue',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  SELECT o.payload_hash,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
   WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation) AND o.state='committed';
  IF NOT FOUND OR (saved.payload_hash,saved.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 SELECT d.* INTO draft FROM crest.invoice_draft_revisions d
  WHERE (d.business_id,d.draft_id)=(requested_business,requested_draft) ORDER BY d.revision DESC LIMIT 1;
 IF NOT FOUND OR draft.state<>'draft' OR draft.revision<>expected_revision
  OR EXISTS(SELECT FROM crest.invoices i WHERE (i.business_id,i.draft_id)=(requested_business,requested_draft)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_DRAFT_REQUIRED';
 END IF;
 FOR family IN SELECT DISTINCT a.family_id FROM crest.agreements a
  JOIN jsonb_array_elements(draft.retained_lines) d(value) ON (d.value->>'agreementId')::uuid=a.id
  WHERE a.business_id=requested_business ORDER BY a.family_id LOOP
  PERFORM crest_private.lock_booking_family(requested_business,family);
 END LOOP;
 IF EXISTS(SELECT FROM crest.billing_consumptions c
  JOIN jsonb_array_elements(draft.retained_lines) d(value) ON (d.value->>'partitionId')::uuid=c.partition_id
  WHERE c.business_id=requested_business) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_SCOPE_ALREADY_CONSUMED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 review:=crest_commands.review_invoice_issue_accounts($1,$2,$3,$4,$5,$6,$7,$8,requested_draft,expected_revision,jurisdictions);
 tax:=review->'taxReview';
 mappings:=review->'accountReview';
 IF tax->>'state' IS DISTINCT FROM 'review' OR jsonb_typeof(mappings) IS DISTINCT FROM 'object'
  OR mappings->'missingFixedPurposes' IS DISTINCT FROM '[]'::jsonb
  OR mappings->'requiredTaxJurisdictions' IS DISTINCT FROM '[]'::jsonb
  OR EXISTS(SELECT FROM jsonb_array_elements(tax->'lines') t(value)
   WHERE t.value->>'treatment' NOT IN('non_taxable','inclusive_single','exempt')
    OR (t.value->>'treatment'='exempt' AND t.value->>'exemptionEvidenceId' IS NULL))
  OR reviewed_digest<>encode(sha256(convert_to(review::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_REVIEW_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 zone:=tax->>'timezone'; issue_date:=(tax->>'issueDate')::date; due_date:=(tax->>'dueOn')::date;
 IF (clock_timestamp() AT TIME ZONE zone)::date<>issue_date THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_REVIEW_REQUIRED';
 END IF;
 SELECT * INTO STRICT period FROM crest_private.require_open_accounting_period(requested_business,issue_date,zone);
 SELECT * INTO STRICT number FROM crest_private.reserve_issued_invoice_number(issued,expected_epoch);
 SELECT jsonb_build_object('schemaVersion',1,'id',c.id,'displayName',c.display_name),j.work_location_snapshot
 INTO STRICT customer,location FROM crest.jobs j JOIN crest.customers c ON (c.business_id,c.id)=(j.business_id,j.customer_id)
 WHERE (j.business_id,j.id,j.customer_id)=(requested_business,draft.job_id,draft.customer_id);
 SELECT sum((t.value->'components'->>'inclusiveCents')::bigint)::bigint,
  bool_and((t.value->'components'->>'grossNetCents')::bigint=0
   AND (t.value->'components'->>'inclusiveCents')::bigint=0) INTO total,zero_effect
 FROM jsonb_array_elements(tax->'lines') t(value);

 INSERT INTO crest.invoices(id,business_id,draft_id,draft_revision,job_id,customer_id,reservation_id,invoice_number,
  issued_on,due_on,time_zone,customer_snapshot,location_snapshot,total_cents,currency,created_by,operation_id)
 VALUES(issued,requested_business,requested_draft,expected_revision,draft.job_id,draft.customer_id,
  number.reservation_id,number.invoice_number,issue_date,due_date,zone,customer,location,total,'USD',expected_actor,requested_operation);
 INSERT INTO crest.atomic_finance_groups(business_id,commit_sequence,recovery_epoch,created_by,operation_id)
 SELECT requested_business,coalesce(max(g.commit_sequence),0)+1,expected_epoch,expected_actor,requested_operation
 FROM crest.atomic_finance_groups g WHERE g.business_id=requested_business RETURNING id INTO group_id;
 INSERT INTO crest.financial_events(business_id,group_id,event_sequence,invoice_id,period_id,period_generation,effective_on,
  time_zone,template,template_version,zero_effect_reason)
 VALUES(requested_business,group_id,1,issued,period.period_id,period.generation,issue_date,zone,
  CASE WHEN total=0 THEN 'P02' ELSE 'P01' END,1,CASE WHEN zero_effect THEN 'literal_zero_charge' END) RETURNING id INTO event_id;
 IF total>0 THEN
  INSERT INTO crest.receivable_items(business_id,invoice_id,account_id,customer_id,original_cents,due_on)
  VALUES(requested_business,issued,(mappings->'fixedMappings'->'ar'->>'accountId')::uuid,draft.customer_id,total,due_date)
  RETURNING id INTO receivable_id;
 END IF;
 IF NOT zero_effect THEN
  INSERT INTO crest.journal_entries(business_id,event_id,entry_sequence) VALUES(requested_business,event_id,1)
  RETURNING id INTO entry_id;
 END IF;
 FOR line IN SELECT d.source,d.position,t.value->'components' AS charge,(t.value->>'profileId')::uuid AS profile,
  t.value->>'jurisdiction' AS jurisdiction,(t.value->>'exemptionEvidenceId')::uuid AS exemption_evidence
  FROM jsonb_array_elements(draft.retained_lines) WITH ORDINALITY d(source,position)
  JOIN jsonb_array_elements(tax->'lines') t(value) ON t.value->>'outcomeId'=d.source->>'outcomeId'
  ORDER BY d.position LOOP
  INSERT INTO crest.invoice_items(business_id,invoice_id,position,outcome_id,completion_part_id,partition_id,agreement_id,
   entitlement_version_id,service_version_id,tax_profile_id,exemption_evidence_id,gross_inclusive_cents,discount_inclusive_cents,gross_net_cents,
   discount_net_cents,net_cents,tax_cents,total_cents,description,created_by,operation_id)
  VALUES(requested_business,issued,line.position,(line.source->>'outcomeId')::uuid,(line.source->>'completionPartId')::uuid,
   (line.source->>'partitionId')::uuid,(line.source->>'agreementId')::uuid,(line.source->>'entitlementVersionId')::uuid,
   (line.source->>'serviceVersionId')::uuid,line.profile,line.exemption_evidence,(line.charge->>'grossInclusiveCents')::bigint,
   (line.charge->>'discountInclusiveCents')::bigint,(line.charge->>'grossNetCents')::bigint,(line.charge->>'discountNetCents')::bigint,
   (line.charge->>'netCents')::bigint,(line.charge->>'taxCents')::bigint,(line.charge->>'inclusiveCents')::bigint,
   line.source->>'description',expected_actor,requested_operation) RETURNING id INTO item_id;
  INSERT INTO crest.billing_consumptions(business_id,invoice_item_id,partition_id,consumed_cents,created_by,operation_id)
  VALUES(requested_business,item_id,(line.source->>'partitionId')::uuid,(line.charge->>'inclusiveCents')::bigint,expected_actor,requested_operation);
  IF (line.charge->>'taxCents')::bigint>0 THEN
   mapping:=mappings->'taxMappings'->line.jurisdiction;
   INSERT INTO crest.invoice_tax_payable_movements(business_id,event_id,invoice_item_id,tax_profile_id,mapping_id,account_id,jurisdiction,cents)
   VALUES(requested_business,event_id,item_id,line.profile,(mapping->>'mappingId')::uuid,(mapping->>'accountId')::uuid,
    line.jurisdiction,(line.charge->>'taxCents')::bigint) RETURNING id INTO tax_movement_id;
   INSERT INTO crest.journal_lines(business_id,entry_id,invoice_item_id,account_id,tax_payable_movement_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,entry_id,item_id,(mapping->>'accountId')::uuid,tax_movement_id,'tax_payable',0,(line.charge->>'taxCents')::bigint);
  END IF;
  FOR expected_line IN SELECT * FROM (VALUES
   ('ar',receivable_id,(line.charge->>'inclusiveCents')::bigint,0::bigint),
   ('discount',NULL::uuid,(line.charge->>'discountNetCents')::bigint,0::bigint),
   ('service_revenue',NULL::uuid,0::bigint,(line.charge->>'grossNetCents')::bigint)
  ) p(purpose,ar_id,debit,credit) WHERE p.debit>0 OR p.credit>0 LOOP
   mapping:=mappings->'fixedMappings'->expected_line.purpose;
   INSERT INTO crest.journal_lines(business_id,entry_id,invoice_item_id,receivable_id,account_id,fixed_mapping_id,purpose,debit_cents,credit_cents)
   VALUES(requested_business,entry_id,item_id,expected_line.ar_id,(mapping->>'accountId')::uuid,(mapping->>'mappingId')::uuid,
    expected_line.purpose,expected_line.debit,expected_line.credit);
  END LOOP;
 END LOOP;
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'invoiceId',issued,'invoiceNumber',number.invoice_number,
  'issuedOn',to_char(issue_date,'YYYY-MM-DD'),'dueOn',to_char(due_date,'YYYY-MM-DD'),'totalCents',total::text,
  'eventId',event_id,'receivableId',receivable_id,'draftId',requested_draft,'draftRevision',expected_revision::text);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(gen_random_uuid(),requested_business,requested_operation,expected_actor,expected_actor,'invoices',issued,1,'issue',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $issue$;

CREATE FUNCTION crest_commands.read_issued_invoice(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, requested_draft uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE saved crest.invoices; lines jsonb;
BEGIN
 IF requested_draft IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT i.* INTO saved FROM crest.invoices i
 WHERE (i.business_id,i.draft_id)=(requested_business,requested_draft);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT jsonb_agg(jsonb_build_object('description',i.description,'inclusiveCents',i.total_cents::text,
  'grossInclusiveCents',i.gross_inclusive_cents::text,'discountInclusiveCents',i.discount_inclusive_cents::text,
  'netCents',i.net_cents::text,'taxCents',i.tax_cents::text)
  || CASE WHEN i.exemption_evidence_id IS NULL THEN '{}'::jsonb ELSE
   jsonb_build_object('exemptionEvidenceId',i.exemption_evidence_id) END ORDER BY i.position)
 INTO lines FROM crest.invoice_items i WHERE (i.business_id,i.invoice_id)=(requested_business,saved.id);
 RETURN jsonb_build_object('state','issued','schemaVersion',1,'businessId',saved.business_id,'invoiceId',saved.id,
  'invoiceNumber',saved.invoice_number,'draftId',saved.draft_id,'draftRevision',saved.draft_revision::text,
  'issuedOn',to_char(saved.issued_on,'YYYY-MM-DD'),'dueOn',to_char(saved.due_on,'YYYY-MM-DD'),
  'timezone',saved.time_zone,'currency',saved.currency,'totalCents',saved.total_cents::text,
  'customer',saved.customer_snapshot,'location',saved.location_snapshot,'lines',lines);
END $read$;

CREATE FUNCTION crest_commands.lookup_invoice_issue(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz,
 requested_business uuid, expected_epoch uuid, requested_operation uuid, requested_draft uuid, expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved record; evidence record;
BEGIN
 IF expected_epoch IS NULL OR requested_operation IS NULL OR requested_draft IS NULL
  OR expected_revision IS NULL OR expected_revision<1 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 SELECT o.id,o.command_type,o.recovery_epoch,o.result,o.payload_hash INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.state)=(requested_business,requested_operation,'committed')
  AND o.command_type IN('finance.invoice.issue','finance.invoice.retire');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.command_type='finance.invoice.retire' THEN
  IF (saved.result->>'originalEpoch',saved.result->>'draftId',saved.result->>'draftRevision')
   IS DISTINCT FROM (expected_epoch::text,requested_draft::text,expected_revision::text) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT a.reason,a.delta INTO STRICT evidence FROM crest_private.audit_events a
  WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.action)=
   (requested_business,requested_operation,expected_actor,'operations',saved.id,'retire')
   AND a.id::text=saved.result->>'auditEventId';
  IF saved.result->>'reviewEpoch' IS DISTINCT FROM saved.recovery_epoch::text
   OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',saved.result)
   OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((saved.result||jsonb_build_object(
    'actorId',expected_actor,'reason',evidence.reason))::text,'UTF8')),'hex') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='INVOICE_ISSUE_RETIREMENT_AUDIT_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','retired','receipt',saved.result);
 END IF;
 IF saved.recovery_epoch<>expected_epoch OR saved.result->>'draftId' IS DISTINCT FROM requested_draft::text
  OR saved.result->>'draftRevision' IS DISTINCT FROM expected_revision::text THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_invoice_issue(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 review_epoch uuid, requested_operation uuid, original_epoch uuid, requested_draft uuid, expected_revision bigint, review_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE existing jsonb; receipt jsonb; claim uuid; audit uuid:=gen_random_uuid(); digest text;
BEGIN
 IF review_reason IS NULL OR review_reason<>btrim(review_reason) OR char_length(review_reason) NOT BETWEEN 1 AND 1000
  OR review_reason~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVOICE_ISSUE_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 existing:=crest_commands.lookup_invoice_issue($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
 IF existing->>'state'<>'absent' THEN RETURN existing; END IF;
 receipt:=jsonb_build_object('schemaVersion',1,'operationId',requested_operation,'originalEpoch',original_epoch,
  'reviewEpoch',review_epoch,'draftId',requested_draft,'draftRevision',expected_revision::text,'auditEventId',audit);
 digest:=encode(sha256(convert_to((receipt||jsonb_build_object('actorId',expected_actor,'reason',review_reason))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.invoice.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_commands.lookup_invoice_issue($1,$2,$3,$4,$5,$6,$7,$8,$11,$10,$12,$13);
  IF existing->>'state'<>'absent' THEN RETURN existing; END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(audit,requested_business,requested_operation,expected_actor,expected_actor,'operations',claim,1,'retire',review_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,requested_operation);
 RETURN jsonb_build_object('state','retired','receipt',receipt);
END $retire$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.lock_booking_family(uuid,uuid) TO crest_finance_account_owner;
ALTER FUNCTION crest_private.keep_issued_invoice_draft() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.keep_issued_invoice_draft() FROM PUBLIC;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.prepare_reviewed_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.issue_reviewed_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_issued_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.prepare_reviewed_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb),
 crest_commands.issue_reviewed_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text),
 crest_commands.read_issued_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.lookup_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.prepare_reviewed_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,jsonb),
 crest_commands.issue_reviewed_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text),
 crest_commands.read_issued_invoice(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.lookup_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_invoice_issue(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-issue.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-invoice-posting-source-export.sql
-- Held invoice posting source capture. This source is private to the existing
-- export credential and is composed with business history in one read snapshot.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.invoice_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('accounting_periods', ARRAY[
  'id:uuid', 'business_id:uuid', 'starts_on:date', 'month_start:date',
  'through_on:date', 'time_zone:text', 'opening_boundary:boolean', 'created_by:uuid',
  'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('invoice_series', ARRAY[
  'id:uuid', 'business_id:uuid', 'label:text', 'recovery_epoch:uuid',
  'kind:text', 'incident_id:uuid', 'approval_reason:text', 'created_by:uuid',
  'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('invoice_number_reservations', ARRAY[
  'id:uuid', 'business_id:uuid', 'full_number:text', 'series_id:uuid',
  'number_sequence:bigint', 'issued_source_id:uuid', 'incident_id:uuid', 'external_evidence:text',
  'recovery_epoch:uuid', 'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('accounting_period_locks', ARRAY[
  'id:uuid', 'business_id:uuid', 'period_id:uuid', 'generation:bigint',
  'previous_generation:bigint', 'state:text', 'evidence_ref:text', 'created_by:uuid',
  'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('tax_payable_mapping_versions', ARRAY[
  'id:uuid', 'business_id:uuid', 'jurisdiction:text', 'version:bigint',
  'previous_version:bigint', 'account_id:uuid', 'effective_from:date', 'reason:text',
  'audit_event_id:uuid', 'created_at:timestamp with time zone', 'created_by:uuid', 'operation_id:uuid'
 ]),
 ('invoice_exemption_evidence', ARRAY[
  'id:uuid', 'business_id:uuid', 'draft_id:uuid', 'draft_revision:bigint',
  'outcome_id:uuid', 'customer_id:uuid', 'jurisdiction:text', 'profile_id:uuid',
  'version:bigint', 'previous_version:bigint', 'valid_from:date', 'valid_through:date',
  'evidence_reference:text', 'reason:text', 'audit_event_id:uuid', 'created_at:timestamp with time zone',
  'created_by:uuid', 'operation_id:uuid'
 ]),
 ('invoices', ARRAY[
  'id:uuid', 'business_id:uuid', 'draft_id:uuid', 'draft_revision:bigint',
  'job_id:uuid', 'customer_id:uuid', 'reservation_id:uuid', 'invoice_number:text',
  'issued_on:date', 'due_on:date', 'time_zone:text', 'customer_snapshot:jsonb',
  'location_snapshot:jsonb', 'total_cents:bigint', 'currency:character(3)', 'created_at:timestamp with time zone',
  'created_by:uuid', 'operation_id:uuid'
 ]),
 ('invoice_items', ARRAY[
  'id:uuid', 'business_id:uuid', 'invoice_id:uuid', 'position:integer',
  'outcome_id:uuid', 'completion_part_id:uuid', 'partition_id:uuid', 'agreement_id:uuid',
  'entitlement_version_id:uuid', 'service_version_id:uuid', 'tax_profile_id:uuid', 'exemption_evidence_id:uuid',
  'gross_inclusive_cents:bigint', 'discount_inclusive_cents:bigint', 'gross_net_cents:bigint', 'discount_net_cents:bigint',
  'net_cents:bigint', 'tax_cents:bigint', 'total_cents:bigint', 'description:text',
  'created_at:timestamp with time zone', 'created_by:uuid', 'operation_id:uuid'
 ]),
 ('billing_consumptions', ARRAY[
  'id:uuid', 'business_id:uuid', 'invoice_item_id:uuid', 'partition_id:uuid',
  'consumed_cents:bigint', 'created_at:timestamp with time zone', 'created_by:uuid', 'operation_id:uuid'
 ]),
 ('atomic_finance_groups', ARRAY[
  'id:uuid', 'business_id:uuid', 'commit_sequence:bigint', 'recovery_epoch:uuid',
  'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('financial_events', ARRAY[
  'id:uuid', 'business_id:uuid', 'group_id:uuid', 'event_sequence:integer',
  'invoice_id:uuid', 'period_id:uuid', 'period_generation:bigint', 'reopened_generation:bigint',
  'effective_on:date', 'time_zone:text', 'template:text', 'template_version:integer',
  'zero_effect_reason:text', 'posted_at:timestamp with time zone'
 ]),
 ('receivable_items', ARRAY[
  'id:uuid', 'business_id:uuid', 'invoice_id:uuid', 'account_id:uuid',
  'customer_id:uuid', 'original_cents:bigint', 'due_on:date'
 ]),
 ('invoice_tax_payable_movements', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'invoice_item_id:uuid',
  'tax_profile_id:uuid', 'mapping_id:uuid', 'account_id:uuid', 'jurisdiction:text',
  'cents:bigint'
 ]),
 ('journal_entries', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'entry_sequence:integer'
 ]),
 ('journal_lines', ARRAY[
  'id:uuid', 'business_id:uuid', 'entry_id:uuid', 'invoice_item_id:uuid',
  'receivable_id:uuid', 'account_id:uuid', 'fixed_mapping_id:uuid', 'tax_payable_movement_id:uuid',
  'purpose:text', 'debit_cents:bigint', 'credit_cents:bigint'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.invoice_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
   SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED';
 END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.invoice_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.invoice_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
   RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_INVOICE_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_SOURCE_SCOPE_REQUIRED';
 END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN
   RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_SOURCE_LIMIT';
 END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.invoice.posting.sources/1',requested_business,
   pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.invoice_source_token(uuid) FROM PUBLIC;

RESET ROLE;
DO $review$
DECLARE source record; columns text;
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_export','crest_export_owner')
     AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
     AND rolconfig IS NULL)<>2
   OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN('crest_export'::regrole,'crest_export_owner'::regrole)
      OR roleid='crest_export_owner'::regrole)
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE has_schema_privilege('crest_export_owner',oid,'CREATE')
      OR has_schema_privilege('crest_export',oid,'CREATE'))
   OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_export_owner'::regrole) AND a.grantee<>d.defaclrole)
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
      AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;

 FOR source IN SELECT * FROM crest_private.invoice_source_dictionary() LOOP
   PERFORM crest_private.invoice_source_check_group(source.group_name,source.fields);
   IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
   THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
   SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
   EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_export_owner',columns,source.group_name);
   EXECUTE format('CREATE POLICY invoice_source_export_read ON crest.%I FOR SELECT TO crest_export_owner
     USING (business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source.group_name);
 END LOOP;
END $review$;

SET LOCAL ROLE crest_schema_owner;
GRANT EXECUTE ON FUNCTION crest_private.invoice_source_dictionary(),
 crest_private.invoice_source_check_group(text,text[]),crest_private.invoice_source_token(uuid) TO crest_export_owner;

CREATE FUNCTION crest_commands.invoice_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.invoice_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
   set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.invoice_source_dictionary() LOOP
   PERFORM crest_private.invoice_source_check_group(source.group_name,source.fields);
   EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
     INTO group_count USING requested_business;
   total:=total+group_count;
   IF total>10000 THEN
     RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_SOURCE_LIMIT';
   END IF;
   counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','invoice_posting_sources','businessId',requested_business,
   'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.invoice_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.invoice_source_token(requested_business)
   OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.invoice_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM crest_private.invoice_source_check_group(requested_group,fields);
 -- The page credential requires the same reviewed business export scope as context.
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
   set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
   WHEN 'boolean' THEN format('t.%I',name)
   WHEN 'timestamp with time zone' THEN
     format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection
 FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS column_spec(name,kind);

 EXECUTE format($query$
   WITH candidates AS MATERIALIZED (
     SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
     WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2)
     ORDER BY t.id LIMIT $3+1
   ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
   SELECT jsonb_build_object('schemaVersion',1,'businessId',$1,'snapshotToken',$4,'group',$5,
     'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
     'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN
   RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_SOURCE_LIMIT';
 END IF;
 RETURN result;
END $page$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_export_owner;
ALTER FUNCTION crest_commands.invoice_source_snapshot_context(uuid) OWNER TO crest_export_owner;
ALTER FUNCTION crest_commands.invoice_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_export_owner;
REVOKE ALL ON FUNCTION crest_commands.invoice_source_snapshot_context(uuid),
 crest_commands.invoice_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.invoice_source_snapshot_context(uuid),
 crest_commands.invoice_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-invoice-posting-source-export.sql
