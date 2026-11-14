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
