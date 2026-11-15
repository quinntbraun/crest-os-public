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
