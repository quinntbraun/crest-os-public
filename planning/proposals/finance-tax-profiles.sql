-- ACCOUNTING section 7, BR12.2 and DATABASE 7.1. Fictional configuration only.
-- No journal, invoice, tax-rate default, or production approval.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.tax_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 jurisdiction text NOT NULL CHECK (char_length(jurisdiction)>=1 AND char_length(jurisdiction)<=200
  AND btrim(jurisdiction)=jurisdiction AND jurisdiction !~ '[[:cntrl:]]'),
 applicability text NOT NULL CHECK (applicability IN ('service','tip')),
 service_id uuid,
 scope_key text GENERATED ALWAYS AS (CASE WHEN service_id IS NULL THEN 'tip' ELSE 'service:'||service_id::text END) STORED,
 version bigint NOT NULL CHECK (version>0),
 previous_version bigint GENERATED ALWAYS AS (nullif(version-1,0)) STORED,
 effective_from date NOT NULL CHECK (effective_from BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 treatment text NOT NULL CHECK (treatment IN ('unresolved','non_taxable','exempt','inclusive_single')),
 rate numeric,
 verification_evidence text CHECK (char_length(verification_evidence)>=1 AND char_length(verification_evidence)<=1000
  AND btrim(verification_evidence)=verification_evidence AND verification_evidence !~ '[[:cntrl:]]'),
 reason text NOT NULL CHECK (char_length(reason)>=1 AND char_length(reason)<=1000
  AND btrim(reason)=reason AND reason !~ '[[:cntrl:]]'),
 synthetic boolean NOT NULL CHECK (synthetic),
 audit_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL CHECK (origin='manual'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,jurisdiction,scope_key,version),
 UNIQUE(business_id,jurisdiction,scope_key,effective_from),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY (business_id,service_id) REFERENCES crest.services(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY (business_id,jurisdiction,scope_key,previous_version)
  REFERENCES crest.tax_profiles(business_id,jurisdiction,scope_key,version),
 FOREIGN KEY (business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY (business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id)
  DEFERRABLE INITIALLY DEFERRED,
 CHECK ((applicability='service')=(service_id IS NOT NULL)),
 CHECK ((treatment='unresolved')=(verification_evidence IS NULL)),
 CHECK ((treatment='inclusive_single' AND rate IS NOT NULL AND rate>0 AND rate<'Infinity'::numeric
   AND octet_length(rate::text)<=128 AND scale(rate)=scale(trim_scale(rate)))
   OR (treatment<>'inclusive_single' AND rate IS NULL))
);

CREATE INDEX tax_profiles_service ON crest.tax_profiles(business_id,service_id);
CREATE INDEX tax_profiles_cursor ON crest.tax_profiles(business_id,created_at,id);
ALTER TABLE crest.tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.tax_profiles FORCE ROW LEVEL SECURITY;

GRANT SELECT ON crest.tax_profiles TO crest_finance_integrity_owner;
CREATE POLICY finance_tax_integrity ON crest.tax_profiles FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY finance_tax_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.tax_profile.approve');
CREATE POLICY finance_tax_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='tax_profiles');

GRANT SELECT,INSERT ON crest.tax_profiles TO crest_finance_account_owner;
CREATE POLICY finance_tax_read ON crest.tax_profiles FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_tax_append ON crest.tax_profiles FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE FUNCTION crest_private.finance_tax_snapshot(profile crest.tax_profiles)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object(
  'schemaVersion',1,'id',profile.id,'businessId',profile.business_id,'jurisdiction',profile.jurisdiction,
  'applicability',profile.applicability,'serviceId',profile.service_id,'version',profile.version::text,
  'effectiveFrom',to_char(profile.effective_from,'YYYY-MM-DD'),'treatment',profile.treatment,
  'rate',profile.rate::text,'verificationEvidence',profile.verification_evidence,'reason',profile.reason,
  'synthetic',profile.synthetic,'reviewedBy',profile.created_by,'auditEventId',profile.audit_event_id
 )
$snapshot$;

CREATE FUNCTION crest_private.check_finance_tax_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.tax_profiles; before_snapshot jsonb; after_snapshot jsonb;
BEGIN
 IF NEW.version>1 THEN
  SELECT * INTO STRICT previous FROM crest.tax_profiles p
  WHERE (p.business_id,p.jurisdiction,p.scope_key,p.version)=(NEW.business_id,NEW.jurisdiction,NEW.scope_key,NEW.previous_version);
  IF NEW.effective_from<=previous.effective_from THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_TAX_EFFECTIVE_ORDER_REQUIRED';
  END IF;
  before_snapshot:=crest_private.finance_tax_snapshot(previous);
 END IF;
 after_snapshot:=crest_private.finance_tax_snapshot(NEW);
 IF NOT EXISTS (
  SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o USING(business_id,operation_id,actor_id)
  WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
   AND a.entity_kind='tax_profiles' AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action='approve' AND a.reason=NEW.reason AND a.origin=NEW.origin AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_snapshot,'after',after_snapshot)
   AND o.command_type='finance.tax_profile.approve' AND o.state='committed' AND o.origin=NEW.origin
   AND o.result=after_snapshot AND o.import_row_id IS NULL
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_TAX_APPROVAL_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;

REVOKE ALL ON FUNCTION crest_private.finance_tax_snapshot(crest.tax_profiles),
 crest_private.check_finance_tax_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_tax_snapshot(crest.tax_profiles)
 TO crest_finance_integrity_owner,crest_finance_account_owner;
CREATE CONSTRAINT TRIGGER tax_profile_audited AFTER INSERT ON crest.tax_profiles
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_finance_tax_profile();
CREATE TRIGGER tax_profile_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.tax_profiles
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.finance_tax_charge(gross bigint,discount bigint,rate numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $charge$
DECLARE amount bigint; net bigint; gross_net bigint; multiplier numeric;
BEGIN
 IF gross IS NULL OR discount IS NULL OR gross<0 OR discount<0 OR discount>gross OR rate IS NULL
  OR rate<0 OR rate>='Infinity'::numeric OR octet_length(rate::text)>128 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_COMPONENT_INPUT_REQUIRED';
 END IF;
 amount:=gross-discount;
 multiplier:=1+rate;
 -- Exact round-half-up of nonnegative rational cents. div returns an integer quotient.
 net:=div(2*amount::numeric+multiplier,2*multiplier)::bigint;
 gross_net:=div(2*gross::numeric+multiplier,2*multiplier)::bigint;
 RETURN jsonb_build_object('grossInclusiveCents',gross::text,'discountInclusiveCents',discount::text,
  'inclusiveCents',amount::text,'grossNetCents',gross_net::text,'netCents',net::text,
  'taxCents',(amount-net)::text,'discountNetCents',(gross_net-net)::text);
END $charge$;

REVOKE ALL ON FUNCTION crest_private.finance_tax_charge(bigint,bigint,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_tax_charge(bigint,bigint,numeric) TO crest_finance_account_owner;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_finance_tax_profile() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;

CREATE POLICY finance_tax_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.tax_profile.approve','finance.tax_profile.retire'));
CREATE POLICY finance_tax_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.tax_profile.approve','finance.tax_profile.retire') AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY finance_tax_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.tax_profile.approve','finance.tax_profile.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.tax_profile.approve','finance.tax_profile.retire') AND state='committed');
CREATE POLICY finance_tax_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='tax_profiles' AND action='approve' AND origin='manual' AND import_row_id IS NULL);

CREATE POLICY finance_tax_retirement_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL AND EXISTS(
   SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
    AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
    AND o.command_type='finance.tax_profile.retire' AND o.state='pending'
  ));

CREATE FUNCTION crest_private.finance_tax_scope(jurisdiction text,applicability text,service_id uuid)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $scope$
BEGIN
 IF jurisdiction IS NULL OR char_length(jurisdiction) NOT BETWEEN 1 AND 200 OR btrim(jurisdiction)<>jurisdiction
  OR jurisdiction~'[[:cntrl:]]' OR applicability IS NULL OR applicability NOT IN ('service','tip')
  OR ((applicability='service')<>(service_id IS NOT NULL)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_SCOPE_REQUIRED';
 END IF;
 RETURN CASE WHEN service_id IS NULL THEN 'tip' ELSE 'service:'||service_id::text END;
END $scope$;

CREATE FUNCTION crest_private.finance_tax_approval_result(
 business uuid,actor uuid,operation uuid,original_epoch uuid,expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved crest_private.operations; profile crest.tax_profiles; evidence record; decision jsonb;
BEGIN
 SELECT * INTO saved FROM crest_private.operations o WHERE
  (o.business_id,o.operation_id,o.actor_id)=(business,operation,actor)
  AND o.command_type IN ('finance.tax_profile.approve','finance.tax_profile.retire');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' OR saved.schema_version<>1 OR saved.result_schema_version<>1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_TAX_RESULT_REVIEW_REQUIRED';
 END IF;
 IF saved.command_type='finance.tax_profile.approve' THEN
  IF saved.recovery_epoch IS DISTINCT FROM original_epoch OR saved.result->>'version' IS DISTINCT FROM (expected_version+1)::text THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT * INTO STRICT profile FROM crest.tax_profiles p WHERE
   (p.business_id,p.operation_id,p.created_by)=(business,operation,actor);
  IF saved.result IS DISTINCT FROM crest_private.finance_tax_snapshot(profile) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_TAX_RESULT_REVIEW_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;

 SELECT a.id,a.reason,a.delta,a.hash_input,a.payload,a.event_hash INTO STRICT evidence FROM crest_private.audit_events a
 WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_id)=(business,operation,actor,saved.id)
  AND a.entity_kind='operations' AND a.entity_version=1 AND a.action='retire';
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',business,'expectedVersion',expected_version::text,
   'auditEventId',evidence.id,'reviewEpoch',saved.recovery_epoch));
 IF saved.result IS DISTINCT FROM decision THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 IF evidence.reason IS NULL OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision)
  OR evidence.hash_input IS DISTINCT FROM evidence.payload::text
  OR evidence.event_hash IS DISTINCT FROM encode(sha256(convert_to(evidence.hash_input,'UTF8')),'hex')
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((decision||jsonb_build_object('reason',evidence.reason,
   'actorId',actor,'commandType','finance.tax_profile.retire'))::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_TAX_RESULT_REVIEW_REQUIRED';
 END IF;
 RETURN decision;
END $result$;
REVOKE ALL ON FUNCTION crest_private.finance_tax_scope(text,text,uuid),
 crest_private.finance_tax_approval_result(uuid,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_tax_scope(text,text,uuid),
 crest_private.finance_tax_approval_result(uuid,uuid,uuid,uuid,bigint) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.approve_finance_tax_profile(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,jurisdiction text,applicability text,service_id uuid,expected_version bigint,
 effective_from date,treatment text,rate numeric,verification_evidence text,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $approve$
DECLARE scope text; digest text; claimed uuid; saved crest_private.operations; prior crest.tax_profiles;
 fresh crest.tax_profiles; event_id uuid:=gen_random_uuid(); snapshot jsonb; canonical_rate numeric:=trim_scale(rate);
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 scope:=crest_private.finance_tax_scope(jurisdiction,applicability,service_id);
 IF requested_operation IS NULL OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807
  OR effective_from IS NULL OR effective_from NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  OR treatment IS NULL OR treatment NOT IN ('unresolved','non_taxable','exempt','inclusive_single')
  OR ((treatment='unresolved')<>(verification_evidence IS NULL))
  OR (verification_evidence IS NOT NULL AND (char_length(verification_evidence) NOT BETWEEN 1 AND 1000
   OR btrim(verification_evidence)<>verification_evidence OR verification_evidence~'[[:cntrl:]]'))
  OR ((treatment='inclusive_single')<>(rate IS NOT NULL))
  OR (rate IS NOT NULL AND (rate<=0 OR rate>='Infinity'::numeric OR octet_length(rate::text)>128))
  OR reason IS NULL OR char_length(reason) NOT BETWEEN 1 AND 1000 OR btrim(reason)<>reason OR reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_PROFILE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.tax_profile.approve',1,requested_business,expected_actor,expected_epoch,
  jurisdiction,scope,expected_version::text,to_char(effective_from,'YYYY-MM-DD'),treatment,canonical_rate::text,
  verification_evidence,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.tax_profile.approve',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT * INTO saved FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor);
  IF NOT FOUND OR (saved.command_type,saved.state,saved.recovery_epoch,saved.payload_hash)
   IS DISTINCT FROM ('finance.tax_profile.approve','committed',expected_epoch,digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN crest_private.finance_tax_approval_result(requested_business,expected_actor,requested_operation,expected_epoch,expected_version);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO prior FROM crest.tax_profiles p
 WHERE (p.business_id,p.jurisdiction,p.scope_key)=(requested_business,$11,scope) ORDER BY p.version DESC LIMIT 1;
 IF coalesce(prior.version,0)<>expected_version THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='FINANCE_TAX_VERSION_CONFLICT';
 END IF;
 IF prior.id IS NOT NULL AND effective_from<=prior.effective_from THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_EFFECTIVE_ORDER_REQUIRED';
 END IF;

 INSERT INTO crest.tax_profiles(business_id,jurisdiction,applicability,service_id,version,effective_from,
  treatment,rate,verification_evidence,reason,synthetic,audit_event_id,created_by,operation_id,origin)
 VALUES(requested_business,jurisdiction,applicability,service_id,expected_version+1,effective_from,
  treatment,canonical_rate,verification_evidence,reason,true,event_id,expected_actor,requested_operation,'manual')
 RETURNING * INTO fresh;
 snapshot:=crest_private.finance_tax_snapshot(fresh);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'tax_profiles',fresh.id,fresh.version,
  'approve',reason,jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior.id IS NULL THEN NULL
   ELSE crest_private.finance_tax_snapshot(prior) END,'after',snapshot),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=snapshot
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',snapshot);
END $approve$;

CREATE FUNCTION crest_commands.lookup_finance_tax_profile_approval(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_operation uuid,original_epoch uuid,expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR expected_version IS NULL OR expected_version<0
  OR expected_version=9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_PROFILE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 RETURN crest_private.finance_tax_approval_result(requested_business,expected_actor,requested_operation,original_epoch,
  expected_version);
END $lookup$;

CREATE FUNCTION crest_commands.retire_finance_tax_profile_approval(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,requested_operation uuid,original_epoch uuid,expected_version bigint,requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claim uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR expected_version IS NULL
  OR expected_version<0 OR expected_version=9223372036854775807 OR requested_reason IS NULL
  OR char_length(requested_reason) NOT BETWEEN 1 AND 1000 OR btrim(requested_reason)<>requested_reason
  OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_PROFILE_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',requested_operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'expectedVersion',expected_version::text,
   'auditEventId',event_id,'reviewEpoch',review_epoch));
 digest:=encode(sha256(convert_to((decision||jsonb_build_object('reason',requested_reason,'actorId',expected_actor,
  'commandType','finance.tax_profile.retire'))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.tax_profile.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_private.finance_tax_approval_result(requested_business,expected_actor,requested_operation,original_epoch,expected_version);
  IF existing->>'state'='committed' THEN RETURN existing; END IF;
  IF existing->>'state'='retired' AND existing->'receipt'->>'reviewEpoch'=review_epoch::text AND EXISTS(
   SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.id::text=existing->'receipt'->>'auditEventId'
    AND a.operation_id=requested_operation AND a.reason=requested_reason
  ) THEN RETURN existing; END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'operations',claim,1,'retire',requested_reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,requested_operation);
 RETURN crest_private.finance_tax_approval_result(requested_business,expected_actor,requested_operation,original_epoch,expected_version);
END $retire$;

CREATE FUNCTION crest_commands.preview_finance_tax_charge(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 jurisdiction text,applicability text,service_id uuid,requested_date date,gross bigint,discount bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $preview$
DECLARE scope text; profile crest.tax_profiles; snapshot jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 scope:=crest_private.finance_tax_scope(jurisdiction,applicability,service_id);
 IF requested_date IS NULL OR requested_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  OR gross IS NULL OR discount IS NULL OR gross<0 OR discount<0 OR discount>gross THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_COMPONENT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO profile FROM crest.tax_profiles p WHERE (p.business_id,p.jurisdiction,p.scope_key)=(requested_business,$9,scope)
  AND p.effective_from<=requested_date ORDER BY p.effective_from DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unresolved','profile',NULL); END IF;
 snapshot:=crest_private.finance_tax_snapshot(profile);
 IF profile.treatment='unresolved' THEN RETURN jsonb_build_object('state','unresolved','profile',snapshot); END IF;
 IF profile.treatment='exempt' THEN RETURN jsonb_build_object('state','exemption_review_required','profile',snapshot); END IF;
 RETURN jsonb_build_object('state','ready','profile',snapshot,
  'components',crest_private.finance_tax_charge(gross,discount,coalesce(profile.rate,0)));
END $preview$;

CREATE FUNCTION crest_commands.read_finance_tax_profile_history(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 jurisdiction text,applicability text,service_id uuid,before_version bigint,page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE scope text; items jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 scope:=crest_private.finance_tax_scope(jurisdiction,applicability,service_id);
 IF before_version<1 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_TAX_HISTORY_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(page.item ORDER BY page.version DESC),'[]'::jsonb) INTO items FROM (
  SELECT p.version,crest_private.finance_tax_snapshot(p) AS item
  FROM crest.tax_profiles p WHERE (p.business_id,p.jurisdiction,p.scope_key)=(requested_business,$9,scope)
   AND (before_version IS NULL OR p.version<before_version)
  ORDER BY p.version DESC LIMIT page_limit+1
 ) page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jurisdiction',jurisdiction,
  'applicability',applicability,'serviceId',service_id,'hasMore',jsonb_array_length(items)>page_limit,
  'rows',CASE WHEN jsonb_array_length(items)>page_limit THEN items-page_limit ELSE items END);
END $history$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.approve_finance_tax_profile(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,text,uuid,bigint,date,text,numeric,text,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_finance_tax_profile_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.preview_finance_tax_charge(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,date,bigint,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_finance_tax_profile_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,bigint,integer)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_finance_tax_profile_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.read_finance_tax_profile_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,bigint,integer),
 crest_commands.approve_finance_tax_profile(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,text,uuid,bigint,date,text,numeric,text,text),
 crest_commands.lookup_finance_tax_profile_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint),
 crest_commands.retire_finance_tax_profile_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text),
 crest_commands.preview_finance_tax_charge(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,date,bigint,bigint)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.read_finance_tax_profile_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,bigint,integer),
 crest_commands.approve_finance_tax_profile(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,text,uuid,bigint,date,text,numeric,text,text),
 crest_commands.lookup_finance_tax_profile_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint),
 crest_commands.retire_finance_tax_profile_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text),
 crest_commands.preview_finance_tax_charge(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,date,bigint,bigint)
 TO crest_finance_preview;
