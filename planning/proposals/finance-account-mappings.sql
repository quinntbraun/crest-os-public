-- ACCOUNTING section 3 and DATABASE section 7.1. Held over the fictional
-- account configuration. Scoped purposes need their typed source identities.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.fixed_finance_mapping_matches(purpose text, account crest.accounts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $match$
 SELECT coalesce(EXISTS(
  SELECT 1 FROM (VALUES
   ('service_revenue','4000','revenue','credit',NULL),
   ('tips_revenue','4100','revenue','credit',NULL),
   ('discount','4900','contra_revenue','debit',NULL),
   ('returns','4910','contra_revenue','debit',NULL),
   ('ar','1100','asset','debit','ar'),
   ('other_receivable','1120','asset','debit','other_receivable'),
   ('customer_funds','2000','liability','credit','customer_funds'),
   ('cash','1010','asset','debit','cash'),
   ('checks','1020','asset','debit','checks'),
   ('transfer_transit','1060','asset','debit','transfer_transit'),
   ('fee','5300','expense','debit',NULL),
   ('owner_contribution','3100','equity','credit',NULL),
   ('owner_draw','3200','equity','debit',NULL),
   ('opening_equity','3000','equity','credit',NULL),
   ('payable','2200','liability','credit','payable'),
   ('due_owner','2350','liability','credit','due_owner'),
   ('purchase_tax_recoverable','1180','asset','debit','purchase_tax_recoverable'),
   ('fixed_asset','1500','asset','debit','fixed_asset'),
   ('accumulated_depreciation','1590','asset','credit','accumulated_depreciation'),
   ('depreciation_expense','6200','expense','debit',NULL),
   ('disposal_gain','4300','revenue','credit',NULL),
   ('disposal_loss','6300','expense','debit',NULL),
   ('prepaid','1150','asset','debit','prepaid'),
   ('suspense_outflow','1190','asset','debit','suspense_outflow'),
   ('unidentified_inflow','2390','liability','credit','unidentified_inflow')
  ) AS approved(key,code,kind,side,control)
  WHERE approved.key=purpose AND (approved.code,approved.kind,approved.side)
   =(account.code,account.account_type,account.normal_side)
   AND approved.control IS NOT DISTINCT FROM account.control_kind
   AND account.currency='USD'
   AND (purpose<>'owner_draw' OR account.report_role='contra_equity')
   AND (purpose<>'accumulated_depreciation' OR account.report_role='contra_asset')
 ),false)
$match$;

CREATE TABLE crest.account_mapping_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{0,63}$'),
 version bigint NOT NULL CHECK (version>0),
 previous_version bigint GENERATED ALWAYS AS (nullif(version-1,0)) STORED,
 account_id uuid,
 effective_from date NOT NULL CHECK (effective_from>=DATE '0001-01-01' AND effective_from<=DATE '9999-12-31'),
 reason text NOT NULL CHECK (char_length(reason)>=1 AND char_length(reason)<=1000
  AND btrim(reason)=reason AND reason !~ '[[:cntrl:]]'),
 audit_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL CHECK (origin='manual'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,purpose,version),
 UNIQUE(business_id,purpose,effective_from),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,purpose,previous_version) REFERENCES crest.account_mapping_versions(business_id,purpose,version),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX account_mapping_account ON crest.account_mapping_versions(business_id,account_id);
CREATE INDEX account_mapping_cursor ON crest.account_mapping_versions(business_id,created_at,id);
ALTER TABLE crest.account_mapping_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.account_mapping_versions FORCE ROW LEVEL SECURITY;

GRANT SELECT ON crest.account_mapping_versions TO crest_finance_integrity_owner;
CREATE POLICY finance_mapping_integrity ON crest.account_mapping_versions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY finance_mapping_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.mapping.approve');
CREATE POLICY finance_mapping_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='account_mapping_versions');
GRANT SELECT(result) ON crest_private.operations TO crest_finance_integrity_owner;

GRANT SELECT,INSERT ON crest.account_mapping_versions TO crest_finance_account_owner;
CREATE POLICY finance_mapping_read ON crest.account_mapping_versions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_mapping_append ON crest.account_mapping_versions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE FUNCTION crest_private.finance_mapping_snapshot(mapping crest.account_mapping_versions)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',1,'id',mapping.id,'purpose',mapping.purpose,'version',mapping.version::text,
  'accountId',mapping.account_id,'effectiveFrom',to_char(mapping.effective_from,'YYYY-MM-DD'),
  'reason',mapping.reason,'auditEventId',mapping.audit_event_id)
$snapshot$;

CREATE FUNCTION crest_private.check_finance_mapping_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE account crest.accounts; previous crest.account_mapping_versions; prior jsonb; current_mapping jsonb;
BEGIN
 IF NEW.version>1 THEN
  SELECT * INTO STRICT previous FROM crest.account_mapping_versions m
  WHERE (m.business_id,m.purpose,m.version)=(NEW.business_id,NEW.purpose,NEW.previous_version);
  IF NEW.effective_from<=previous.effective_from THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED';
  END IF;
  prior:=crest_private.finance_mapping_snapshot(previous);
 END IF;
 IF NEW.account_id IS NULL THEN
  IF previous.account_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_CLOSURE_REQUIRED';
  END IF;
 ELSE
  SELECT * INTO STRICT account FROM crest.accounts a WHERE (a.business_id,a.id)=(NEW.business_id,NEW.account_id);
  IF NOT crest_private.fixed_finance_mapping_matches(NEW.purpose,account) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_ACCOUNT_REQUIRED';
  END IF;
 END IF;
 current_mapping:=crest_private.finance_mapping_snapshot(NEW);
 IF NOT EXISTS(
  SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o USING(business_id,operation_id,actor_id)
  WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
   AND a.entity_kind='account_mapping_versions' AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action='approve' AND a.reason=NEW.reason AND a.origin='manual' AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',current_mapping)
   AND o.command_type='finance.mapping.approve' AND o.state='committed' AND o.origin='manual' AND o.import_row_id IS NULL
   AND o.result=current_mapping
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_AUDIT_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER finance_mapping_version_audited AFTER INSERT ON crest.account_mapping_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_finance_mapping_version();
CREATE TRIGGER finance_mapping_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.account_mapping_versions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

GRANT SELECT(id,timezone) ON crest.businesses TO crest_finance_integrity_owner;
CREATE POLICY finance_mapping_business_clock ON crest.businesses FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE FUNCTION crest_private.require_unmapped_account_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $archive$
DECLARE business_day date;
BEGIN
 SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date INTO STRICT business_day
 FROM crest.businesses b WHERE b.id=NEW.business_id;
 IF EXISTS(
  SELECT 1 FROM crest.account_mapping_versions m
  WHERE (m.business_id,m.account_id)=(NEW.business_id,NEW.account_id)
   AND (m.effective_from>business_day OR NOT EXISTS(
    SELECT 1 FROM crest.account_mapping_versions next
    WHERE (next.business_id,next.purpose)=(m.business_id,m.purpose)
     AND next.effective_from>m.effective_from AND next.effective_from<=business_day
   ))
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_ACCOUNT_STILL_ASSIGNED';
 END IF;
 RETURN NEW;
END $archive$;
CREATE TRIGGER finance_mapping_account_archive BEFORE INSERT ON crest.account_versions
 FOR EACH ROW WHEN (NOT NEW.active) EXECUTE FUNCTION crest_private.require_unmapped_account_archive();
REVOKE ALL ON FUNCTION crest_private.fixed_finance_mapping_matches(text,crest.accounts),
 crest_private.finance_mapping_snapshot(crest.account_mapping_versions),crest_private.check_finance_mapping_version(),
 crest_private.require_unmapped_account_archive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.fixed_finance_mapping_matches(text,crest.accounts),
 crest_private.finance_mapping_snapshot(crest.account_mapping_versions) TO crest_finance_integrity_owner,crest_finance_account_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_finance_mapping_version() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.require_unmapped_account_archive() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY finance_mapping_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.mapping.approve','finance.mapping.retire'));
CREATE POLICY finance_mapping_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.mapping.approve','finance.mapping.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY finance_mapping_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.mapping.approve','finance.mapping.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.mapping.approve','finance.mapping.retire') AND state='committed');
CREATE POLICY finance_mapping_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='account_mapping_versions' AND action='approve' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY finance_mapping_retirement_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL AND EXISTS(
   SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
    AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
    AND o.command_type='finance.mapping.retire' AND o.state='pending'
  ));

CREATE FUNCTION crest_private.finance_mapping_operation_result(business uuid, actor uuid, operation uuid,
 original_epoch uuid, requested_purpose text, expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $result$
DECLARE saved crest_private.operations; mapping crest.account_mapping_versions; evidence record; decision jsonb;
BEGIN
 SELECT * INTO saved FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=(business,operation,actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' OR saved.schema_version<>1 OR saved.result_schema_version<>1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_RESULT_REVIEW_REQUIRED';
 END IF;
 IF saved.command_type='finance.mapping.approve' THEN
  IF saved.recovery_epoch IS DISTINCT FROM original_epoch OR saved.result->>'purpose' IS DISTINCT FROM requested_purpose
   OR saved.result->>'version' IS DISTINCT FROM (expected_version+1)::text THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT * INTO STRICT mapping FROM crest.account_mapping_versions m
  WHERE (m.business_id,m.operation_id,m.created_by)=(business,operation,actor);
  IF saved.result IS DISTINCT FROM crest_private.finance_mapping_snapshot(mapping) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_RESULT_REVIEW_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 IF saved.command_type<>'finance.mapping.retire' THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 SELECT a.id,a.reason,a.delta,a.hash_input,a.payload,a.event_hash INTO STRICT evidence FROM crest_private.audit_events a
 WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_id)=(business,operation,actor,saved.id)
  AND a.entity_kind='operations' AND a.entity_version=1 AND a.action='retire';
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',business,'purpose',requested_purpose,
   'expectedVersion',expected_version::text,'auditEventId',evidence.id,'reviewEpoch',saved.recovery_epoch));
 IF saved.result IS DISTINCT FROM decision THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 IF evidence.reason IS NULL OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision)
  OR evidence.hash_input IS DISTINCT FROM evidence.payload::text
  OR evidence.event_hash IS DISTINCT FROM encode(sha256(convert_to(evidence.hash_input,'UTF8')),'hex')
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((decision||jsonb_build_object('reason',evidence.reason,
   'actorId',actor,'commandType','finance.mapping.retire'))::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_RESULT_REVIEW_REQUIRED';
 END IF;
 RETURN decision;
END $result$;
REVOKE ALL ON FUNCTION crest_private.finance_mapping_operation_result(uuid,uuid,uuid,uuid,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_mapping_operation_result(uuid,uuid,uuid,uuid,text,bigint) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.approve_fixed_finance_mapping(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, requested_purpose text, expected_version bigint,
 requested_account uuid, requested_from date, requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $approve$
DECLARE digest text; claimed uuid; recorded crest_private.operations; account crest.accounts;
 prior crest.account_mapping_versions; mapping crest.account_mapping_versions; event_id uuid:=gen_random_uuid(); decision jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_purpose IS NULL OR requested_purpose !~ '^[a-z][a-z0-9_]{0,63}$'
  OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807
  OR requested_from IS NULL OR requested_from<DATE '0001-01-01' OR requested_from>DATE '9999-12-31'
  OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 1000
  OR btrim(requested_reason)<>requested_reason OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.mapping.approve',1,requested_business,expected_actor,expected_epoch,
  requested_purpose,expected_version::text,requested_account,to_char(requested_from,'YYYY-MM-DD'),requested_reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.mapping.approve',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT * INTO recorded FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor);
  IF NOT FOUND OR (recorded.command_type,recorded.state,recorded.recovery_epoch,recorded.payload_hash)
   IS DISTINCT FROM ('finance.mapping.approve','committed',expected_epoch,digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN crest_private.finance_mapping_operation_result(requested_business,expected_actor,requested_operation,
   expected_epoch,requested_purpose,expected_version);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO prior FROM crest.account_mapping_versions m WHERE m.business_id=requested_business AND m.purpose=requested_purpose
 ORDER BY m.version DESC LIMIT 1;
 IF coalesce(prior.version,0)<>expected_version THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='FINANCE_MAPPING_VERSION_CONFLICT';
 END IF;
 IF prior.id IS NOT NULL AND requested_from<=prior.effective_from THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED';
 END IF;
 IF requested_account IS NULL THEN
  IF prior.account_id IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_CLOSURE_REQUIRED';
  END IF;
 ELSE
  SELECT * INTO account FROM crest.accounts a WHERE (a.business_id,a.id)=(requested_business,requested_account);
  IF NOT FOUND OR NOT crest_private.fixed_finance_mapping_matches(requested_purpose,account)
   OR NOT coalesce((SELECT v.active FROM crest.account_versions v
     WHERE (v.business_id,v.account_id)=(requested_business,requested_account) ORDER BY v.version DESC LIMIT 1),false) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_ACCOUNT_REQUIRED';
  END IF;
 END IF;
 INSERT INTO crest.account_mapping_versions(business_id,purpose,version,account_id,effective_from,reason,audit_event_id,created_by,operation_id,origin)
 VALUES(requested_business,requested_purpose,expected_version+1,requested_account,requested_from,requested_reason,event_id,
  expected_actor,requested_operation,'manual') RETURNING * INTO mapping;
 decision:=crest_private.finance_mapping_snapshot(mapping);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'account_mapping_versions',mapping.id,
  mapping.version,'approve',requested_reason,jsonb_build_object('schemaVersion',1,
   'before',CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.finance_mapping_snapshot(prior) END,'after',decision),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',decision);
END $approve$;

CREATE FUNCTION crest_commands.lookup_fixed_finance_mapping_operation(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_operation uuid, original_epoch uuid, requested_purpose text, expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR requested_purpose IS NULL
  OR requested_purpose !~ '^[a-z][a-z0-9_]{0,63}$' OR expected_version IS NULL
  OR expected_version<0 OR expected_version=9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 RETURN crest_private.finance_mapping_operation_result(requested_business,expected_actor,requested_operation,
  original_epoch,requested_purpose,expected_version);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fixed_finance_mapping_approval(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 review_epoch uuid, requested_operation uuid, original_epoch uuid, requested_purpose text, expected_version bigint, requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claim uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR requested_purpose IS NULL
  OR requested_purpose !~ '^[a-z][a-z0-9_]{0,63}$' OR expected_version IS NULL
  OR expected_version<0 OR expected_version=9223372036854775807
  OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 1000
  OR btrim(requested_reason)<>requested_reason OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',requested_operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'purpose',requested_purpose,
   'expectedVersion',expected_version::text,'auditEventId',event_id,'reviewEpoch',review_epoch));
 digest:=encode(sha256(convert_to((decision||jsonb_build_object('reason',requested_reason,'actorId',expected_actor,
  'commandType','finance.mapping.retire'))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.mapping.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_private.finance_mapping_operation_result(requested_business,expected_actor,requested_operation,
   original_epoch,requested_purpose,expected_version);
  IF existing->>'state'='committed' THEN RETURN existing; END IF;
  IF existing->>'state'='retired' AND existing->'receipt'->>'reviewEpoch'=review_epoch::text AND EXISTS(
   SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.id::text=existing->'receipt'->>'auditEventId'
    AND a.operation_id=requested_operation AND a.reason=requested_reason) THEN
   RETURN existing;
  END IF;
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
 RETURN crest_private.finance_mapping_operation_result(requested_business,expected_actor,requested_operation,
  original_epoch,requested_purpose,expected_version);
END $retire$;

-- The next approved start is the exclusive end of the preceding version.
-- An ordinary lookup always checks the currently retained account availability.
CREATE FUNCTION crest_commands.resolve_fixed_finance_mapping(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_purpose text, effective_date date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $resolve$
DECLARE resolved jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_purpose IS NULL OR requested_purpose !~ '^[a-z][a-z0-9_]{0,63}$' OR effective_date IS NULL
  OR effective_date<DATE '0001-01-01' OR effective_date>DATE '9999-12-31' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT crest_private.finance_mapping_snapshot(mapping)||jsonb_build_object('effectiveUntil',to_char(next.effective_from,'YYYY-MM-DD'),
  'accountCode',account.code,'accountType',account.account_type,'normalSide',account.normal_side,
  'controlKind',account.control_kind,'reportRole',account.report_role,'currency',account.currency) INTO resolved
 FROM (
  SELECT m.* FROM crest.account_mapping_versions m
  WHERE m.business_id=requested_business AND m.purpose=requested_purpose AND m.effective_from<=effective_date
  ORDER BY m.effective_from DESC LIMIT 1
 ) mapping JOIN crest.accounts account ON (account.business_id,account.id)=(mapping.business_id,mapping.account_id)
 JOIN LATERAL (
  SELECT v.active FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(account.business_id,account.id)
  ORDER BY v.version DESC LIMIT 1
 ) availability ON availability.active
 LEFT JOIN crest.account_mapping_versions next
  ON (next.business_id,next.purpose,next.previous_version)=(mapping.business_id,mapping.purpose,mapping.version)
 WHERE crest_private.fixed_finance_mapping_matches(requested_purpose,account);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MAPPING_NOT_READY'; END IF;
 RETURN resolved;
END $resolve$;

CREATE FUNCTION crest_commands.read_fixed_finance_mapping_history(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_purpose text, before_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE items jsonb; more boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_purpose IS NULL OR requested_purpose !~ '^[a-z][a-z0-9_]{0,63}$'
  OR (before_version IS NOT NULL AND before_version<1) OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH selected AS (
  SELECT m.version,crest_private.finance_mapping_snapshot(m)||
   jsonb_build_object('accountCode',a.code) AS item
  FROM crest.account_mapping_versions m LEFT JOIN crest.accounts a ON (a.business_id,a.id)=(m.business_id,m.account_id)
  WHERE m.business_id=requested_business AND m.purpose=requested_purpose
   AND (before_version IS NULL OR m.version<before_version)
  ORDER BY m.version DESC LIMIT page_limit+1
 ), page AS (SELECT * FROM selected ORDER BY version DESC LIMIT page_limit)
 SELECT coalesce(jsonb_agg(item ORDER BY version DESC),'[]'::jsonb),
  (SELECT count(*)>page_limit FROM selected) INTO items,more FROM page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'purpose',requested_purpose,'rows',items,'hasMore',more);
END $history$;

CREATE FUNCTION crest_commands.fixed_finance_mapping_editor(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_purpose text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $editor$
DECLARE latest jsonb; eligible jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_purpose IS NULL OR requested_purpose !~ '^[a-z][a-z0-9_]{0,63}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_MAPPING_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT (
  SELECT jsonb_build_object('version',m.version::text,'accountId',m.account_id,
   'effectiveFrom',to_char(m.effective_from,'YYYY-MM-DD'))
  FROM crest.account_mapping_versions m
  WHERE m.business_id=requested_business AND m.purpose=requested_purpose ORDER BY m.version DESC LIMIT 1
 ), (
  SELECT jsonb_build_object('id',a.id,'code',a.code,'name',v.name)
  FROM crest.accounts a
  JOIN LATERAL (SELECT r.name,r.active FROM crest.account_versions r
   WHERE (r.business_id,r.account_id)=(a.business_id,a.id) ORDER BY r.version DESC LIMIT 1) v ON v.active
  WHERE a.business_id=requested_business AND crest_private.fixed_finance_mapping_matches(requested_purpose,a)
 ) INTO latest,eligible;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'purpose',requested_purpose,'latest',latest,'eligible',eligible);
END $editor$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.approve_fixed_finance_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint,uuid,date,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fixed_finance_mapping_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fixed_finance_mapping_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,bigint,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.resolve_fixed_finance_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,date)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fixed_finance_mapping_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.fixed_finance_mapping_editor(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.approve_fixed_finance_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint,uuid,date,text),
 crest_commands.lookup_fixed_finance_mapping_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint),
 crest_commands.retire_fixed_finance_mapping_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,bigint,text),
 crest_commands.resolve_fixed_finance_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,date),
 crest_commands.read_fixed_finance_mapping_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer),
 crest_commands.fixed_finance_mapping_editor(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.approve_fixed_finance_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint,uuid,date,text),
 crest_commands.lookup_fixed_finance_mapping_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,text,bigint),
 crest_commands.retire_fixed_finance_mapping_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,bigint,text),
 crest_commands.resolve_fixed_finance_mapping(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,date),
 crest_commands.read_fixed_finance_mapping_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer),
 crest_commands.fixed_finance_mapping_editor(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text) TO crest_finance_preview;
