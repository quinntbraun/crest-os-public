-- ACCOUNTING §§2–3, 12 and 26, DATABASE §7.3 and BR20.
-- Private fictional channel review records. No posting, balance or cutover is created.

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.money_channel_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 channel_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 previous_version bigint GENERATED ALWAYS AS (nullif(version-1,0)) STORED,
 effective_from date NOT NULL CHECK(effective_from>=DATE '0001-01-01' AND effective_from<=DATE '9999-12-31'),
 account_id uuid NOT NULL,
 owner_actor_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('bank','wallet','cash','checks')),
 ownership_scope text NOT NULL CHECK(
  (ownership_scope='dedicated_business' AND kind IN ('bank','wallet'))
  OR (ownership_scope='physical_business_cash' AND kind='cash')
  OR (ownership_scope='check_custody' AND kind='checks')
  OR (ownership_scope='mixed_personal' AND kind IN ('bank','wallet','cash'))
 ),
 provider_namespace text,
 masked_suffix text,
 label text NOT NULL CHECK(char_length(label)>=1 AND char_length(label)<=200
  AND btrim(label)=label AND label!~'[[:cntrl:]]'),
 ownership_evidence text CHECK(char_length(ownership_evidence)>=1 AND char_length(ownership_evidence)<=1000
  AND btrim(ownership_evidence)=ownership_evidence AND ownership_evidence!~'[[:cntrl:]]'),
 opening_state text NOT NULL CHECK(opening_state IN ('unknown','verified_zero','verified')),
 opening_on date,
 opening_cents bigint,
 opening_evidence text CHECK(char_length(opening_evidence)>=1 AND char_length(opening_evidence)<=1000
  AND btrim(opening_evidence)=opening_evidence AND opening_evidence!~'[[:cntrl:]]'),
 active boolean NOT NULL,
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000
  AND btrim(reason)=reason AND reason!~'[[:cntrl:]]'),
 audit_event_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL CHECK(origin='manual'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,channel_id,version),
 UNIQUE(business_id,channel_id,effective_from),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,channel_id,previous_version)
  REFERENCES crest.money_channel_versions(business_id,channel_id,version),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,owner_actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK(version<>1 OR owner_actor_id=created_by),
 CHECK(
  (kind IN ('bank','wallet') AND provider_namespace IS NOT NULL AND masked_suffix IS NOT NULL
   AND provider_namespace~'^[a-z][a-z0-9_-]{0,63}$' AND masked_suffix~'^[A-Z0-9]{4}$')
  OR (kind IN ('cash','checks') AND provider_namespace IS NULL AND masked_suffix IS NULL)
 ),
 CHECK(
  (opening_state='unknown' AND opening_on IS NULL AND opening_cents IS NULL AND opening_evidence IS NULL)
  OR (opening_state IN ('verified','verified_zero') AND ownership_evidence IS NOT NULL
   AND opening_on IS NOT NULL AND opening_on>=DATE '0001-01-01' AND opening_on<=DATE '9999-12-31'
   AND opening_cents IS NOT NULL AND opening_evidence IS NOT NULL
   AND (opening_state='verified_zero')=(opening_cents=0)
   AND (ownership_scope='dedicated_business' OR opening_cents>=0))
 )
);
CREATE UNIQUE INDEX money_channel_account_once ON crest.money_channel_versions(business_id,account_id) WHERE version=1;
CREATE INDEX money_channel_account_versions ON crest.money_channel_versions(business_id,account_id,version DESC);
ALTER TABLE crest.money_channel_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.money_channel_versions FORCE ROW LEVEL SECURITY;

GRANT SELECT ON crest.money_channel_versions TO crest_finance_integrity_owner;
GRANT SELECT,INSERT ON crest.money_channel_versions TO crest_finance_account_owner;
CREATE POLICY money_channel_integrity ON crest.money_channel_versions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY money_channel_read ON crest.money_channel_versions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY money_channel_append ON crest.money_channel_versions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');

CREATE POLICY money_channel_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.money_channel.save');
CREATE POLICY money_channel_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='money_channel_versions');

CREATE FUNCTION crest_private.money_channel_account_matches(kind text, scope text, account crest.accounts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $match$
 SELECT coalesce(account.currency='USD' AND account.account_type='asset' AND account.normal_side='debit'
  AND CASE
   WHEN scope='mixed_personal' THEN account.control_kind='owner_custody' AND account.report_role='owner_custody'
    AND account.code~'^107[0-9]([.-][A-Za-z0-9]+)*$'
   WHEN kind='cash' AND scope='physical_business_cash' THEN account.code='1010' AND account.control_kind='cash'
   WHEN kind='checks' AND scope='check_custody' THEN account.code='1020' AND account.control_kind='checks'
   WHEN kind='bank' AND scope='dedicated_business' THEN account.control_kind='bank' AND account.report_role='money'
    AND account.code~'^100[0-9]([.-][A-Za-z0-9]+)*$'
   WHEN kind='wallet' AND scope='dedicated_business' THEN account.control_kind='wallet' AND account.report_role='money'
    AND account.code~'^(1030|1040|1050|1090)([.-][A-Za-z0-9]+)*$'
   ELSE false
  END,false)
$match$;

CREATE FUNCTION crest_private.money_channel_snapshot(channel crest.money_channel_versions)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object(
  'schemaVersion',1,'businessId',channel.business_id,'channelId',channel.channel_id,'version',channel.version::text,
  'effectiveFrom',to_char(channel.effective_from,'YYYY-MM-DD'),'accountId',channel.account_id,'ownerActorId',channel.owner_actor_id,
  'kind',channel.kind,'ownershipScope',channel.ownership_scope,'providerNamespace',channel.provider_namespace,
  'maskedSuffix',channel.masked_suffix,'label',channel.label,'ownershipEvidence',channel.ownership_evidence,
  'openingState',channel.opening_state,'openingOn',to_char(channel.opening_on,'YYYY-MM-DD'),
  'openingCents',channel.opening_cents::text,'openingEvidence',channel.opening_evidence,
  'active',channel.active,'reason',channel.reason,'auditEventId',channel.audit_event_id
 )
$snapshot$;

CREATE FUNCTION crest_private.check_money_channel_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.money_channel_versions; account crest.accounts; before_value jsonb; after_value jsonb;
BEGIN
 SELECT * INTO STRICT account FROM crest.accounts a WHERE (a.business_id,a.id)=(NEW.business_id,NEW.account_id);
 IF NOT crest_private.money_channel_account_matches(NEW.kind,NEW.ownership_scope,account) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_ACCOUNT_REQUIRED';
 END IF;
 IF NEW.version>1 THEN
  SELECT * INTO STRICT previous FROM crest.money_channel_versions v
   WHERE (v.business_id,v.channel_id,v.version)=(NEW.business_id,NEW.channel_id,NEW.previous_version);
  IF (NEW.account_id,NEW.owner_actor_id,NEW.kind,NEW.ownership_scope,NEW.provider_namespace,NEW.masked_suffix)
   IS DISTINCT FROM
   (previous.account_id,previous.owner_actor_id,previous.kind,previous.ownership_scope,previous.provider_namespace,previous.masked_suffix)
   OR NEW.effective_from<=previous.effective_from THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_IDENTITY_RETAINED';
  END IF;
  before_value:=crest_private.money_channel_snapshot(previous);
 END IF;
 after_value:=crest_private.money_channel_snapshot(NEW);
 IF NOT EXISTS (
  SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o USING(business_id,operation_id,actor_id)
  WHERE (a.business_id,a.id,a.operation_id,a.actor_id)=(NEW.business_id,NEW.audit_event_id,NEW.operation_id,NEW.created_by)
   AND a.entity_kind='money_channel_versions' AND a.entity_id=NEW.channel_id AND a.entity_version=NEW.version
   AND a.action=CASE WHEN NEW.version=1 THEN 'create' ELSE 'revise' END AND a.reason=NEW.reason
   AND a.origin=NEW.origin AND a.import_row_id IS NULL
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_value,'after',after_value)
   AND o.command_type='finance.money_channel.save' AND o.state='committed' AND o.origin=NEW.origin
   AND o.result=after_value AND o.import_row_id IS NULL
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_AUDIT_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_private.require_unpinned_money_channel_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $archive$
DECLARE business_day date;
BEGIN
 SELECT (clock_timestamp() AT TIME ZONE b.timezone)::date INTO STRICT business_day
 FROM crest.businesses b WHERE b.id=NEW.business_id;
 IF EXISTS(
  SELECT 1 FROM crest.money_channel_versions v
  WHERE (v.business_id,v.account_id)=(NEW.business_id,NEW.account_id) AND v.active
   AND (v.effective_from>business_day OR NOT EXISTS(
    SELECT 1 FROM crest.money_channel_versions next
    WHERE (next.business_id,next.channel_id)=(v.business_id,v.channel_id)
     AND next.effective_from>v.effective_from AND next.effective_from<=business_day
   ))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_ACCOUNT_PINNED'; END IF;
 RETURN NEW;
END $archive$;

REVOKE ALL ON FUNCTION crest_private.money_channel_account_matches(text,text,crest.accounts),
 crest_private.money_channel_snapshot(crest.money_channel_versions),crest_private.check_money_channel_version(),
 crest_private.require_unpinned_money_channel_archive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.money_channel_account_matches(text,text,crest.accounts),
 crest_private.money_channel_snapshot(crest.money_channel_versions) TO crest_finance_integrity_owner,crest_finance_account_owner;

CREATE CONSTRAINT TRIGGER money_channel_audited AFTER INSERT ON crest.money_channel_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_money_channel_version();
CREATE TRIGGER money_channel_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.money_channel_versions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER money_channel_account_archive BEFORE INSERT ON crest.account_versions
 FOR EACH ROW WHEN (NOT NEW.active) EXECUTE FUNCTION crest_private.require_unpinned_money_channel_archive();

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_money_channel_version() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.require_unpinned_money_channel_archive() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY money_channel_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.money_channel.save','finance.money_channel.retire'));
CREATE POLICY money_channel_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.money_channel.save','finance.money_channel.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY money_channel_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.money_channel.save','finance.money_channel.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.money_channel.save','finance.money_channel.retire') AND state='committed');
CREATE POLICY money_channel_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='money_channel_versions' AND action IN ('create','revise') AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY money_channel_retirement_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL AND EXISTS(
   SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
    AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id
    AND o.command_type='finance.money_channel.retire' AND o.state='pending'
  ));

CREATE FUNCTION crest_private.money_channel_operation_result(
 business uuid, actor uuid, operation uuid, original_epoch uuid, requested_channel uuid, expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved crest_private.operations; channel crest.money_channel_versions; evidence record; decision jsonb;
BEGIN
 SELECT * INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(business,operation,actor)
  AND o.command_type IN ('finance.money_channel.save','finance.money_channel.retire');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' OR saved.schema_version<>1 OR saved.result_schema_version<>1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_RESULT_REVIEW_REQUIRED';
 END IF;
 IF saved.command_type='finance.money_channel.save' THEN
  IF saved.recovery_epoch IS DISTINCT FROM original_epoch OR saved.result->>'channelId' IS DISTINCT FROM requested_channel::text
   OR saved.result->>'version' IS DISTINCT FROM (expected_version+1)::text THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT * INTO STRICT channel FROM crest.money_channel_versions v
  WHERE (v.business_id,v.channel_id,v.operation_id,v.created_by)=(business,requested_channel,operation,actor);
  IF saved.result IS DISTINCT FROM crest_private.money_channel_snapshot(channel) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_RESULT_REVIEW_REQUIRED';
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',saved.result);
 END IF;
 SELECT a.id,a.reason,a.delta,a.hash_input,a.payload,a.event_hash INTO STRICT evidence FROM crest_private.audit_events a
 WHERE (a.business_id,a.operation_id,a.actor_id,a.entity_id)=(business,operation,actor,saved.id)
  AND a.entity_kind='operations' AND a.entity_version=1 AND a.action='retire';
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',business,'channelId',requested_channel,
   'expectedVersion',expected_version::text,'auditEventId',evidence.id,'reviewEpoch',saved.recovery_epoch));
 IF saved.result IS DISTINCT FROM decision THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 IF evidence.reason IS NULL OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision)
  OR evidence.hash_input IS DISTINCT FROM evidence.payload::text
  OR evidence.event_hash IS DISTINCT FROM encode(sha256(convert_to(evidence.hash_input,'UTF8')),'hex')
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((decision||jsonb_build_object('reason',evidence.reason,
   'actorId',actor,'commandType','finance.money_channel.retire'))::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_CHANNEL_RESULT_REVIEW_REQUIRED';
 END IF;
 RETURN decision;
END $result$;
REVOKE ALL ON FUNCTION crest_private.money_channel_operation_result(uuid,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.money_channel_operation_result(uuid,uuid,uuid,uuid,uuid,bigint) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.save_money_channel(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, requested_channel uuid, expected_version bigint, body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE keys text[]:=ARRAY['identity','label','effectiveFrom','ownershipEvidence','openingState','openingOn','openingCents','openingEvidence','active','reason'];
 identity_keys text[]:=ARRAY['accountId','kind','ownershipScope','providerNamespace','maskedSuffix'];
 identity_body jsonb; digest text; claimed uuid; saved crest_private.operations; account crest.accounts;
 prior crest.money_channel_versions; fresh crest.money_channel_versions; event_id uuid:=gen_random_uuid(); snapshot jsonb;
 selected_account_id uuid; owner_id uuid; kind text; scope text; provider text; suffix text; start_on date;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_channel IS NULL OR expected_version IS NULL OR expected_version<0
  OR expected_version=9223372036854775807 OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT body?&keys OR body-keys<>'{}'::jsonb
  OR octet_length(body::text)>8192 OR jsonb_typeof(body->'label') IS DISTINCT FROM 'string'
  OR jsonb_typeof(body->'effectiveFrom') IS DISTINCT FROM 'string' OR body->>'effectiveFrom'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(body->'ownershipEvidence') NOT IN ('string','null') OR jsonb_typeof(body->'openingState') IS DISTINCT FROM 'string'
  OR jsonb_typeof(body->'openingOn') NOT IN ('string','null') OR coalesce(body->>'openingOn'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false)
  OR jsonb_typeof(body->'openingCents') NOT IN ('string','null') OR coalesce(body->>'openingCents'!~'^(0|-?[1-9][0-9]{0,18})$',false)
  OR jsonb_typeof(body->'openingEvidence') NOT IN ('string','null') OR jsonb_typeof(body->'active') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
 END IF;
 identity_body:=body->'identity';
 IF expected_version=0 THEN
  IF jsonb_typeof(identity_body) IS DISTINCT FROM 'object' OR NOT identity_body?&identity_keys OR identity_body-identity_keys<>'{}'::jsonb
   OR jsonb_typeof(identity_body->'accountId') IS DISTINCT FROM 'string'
   OR jsonb_typeof(identity_body->'kind') IS DISTINCT FROM 'string' OR jsonb_typeof(identity_body->'ownershipScope') IS DISTINCT FROM 'string'
   OR jsonb_typeof(identity_body->'providerNamespace') NOT IN ('string','null')
   OR jsonb_typeof(identity_body->'maskedSuffix') NOT IN ('string','null') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
  END IF;
 ELSIF identity_body<>'null'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_IDENTITY_RETAINED';
 END IF;
 start_on:=(body->>'effectiveFrom')::date;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.money_channel.save',1,requested_business,expected_actor,expected_epoch,
  requested_channel,expected_version::text,body)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.money_channel.save',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT * INTO saved FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor);
  IF NOT FOUND OR (saved.command_type,saved.state,saved.recovery_epoch,saved.payload_hash)
   IS DISTINCT FROM ('finance.money_channel.save','committed',expected_epoch,digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN crest_private.money_channel_operation_result(requested_business,expected_actor,requested_operation,expected_epoch,
   requested_channel,expected_version);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO prior FROM crest.money_channel_versions v WHERE (v.business_id,v.channel_id)=(requested_business,requested_channel)
 ORDER BY v.version DESC LIMIT 1;
 IF coalesce(prior.version,0)<>expected_version THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='FINANCE_CHANNEL_VERSION_CONFLICT';
 END IF;
 IF prior.id IS NULL THEN
  selected_account_id:=(identity_body->>'accountId')::uuid; owner_id:=expected_actor;
  kind:=identity_body->>'kind'; scope:=identity_body->>'ownershipScope';
  provider:=identity_body->>'providerNamespace'; suffix:=identity_body->>'maskedSuffix';
  IF EXISTS(SELECT 1 FROM crest.money_channel_versions v WHERE (v.business_id,v.account_id)=(requested_business,selected_account_id)) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_ACCOUNT_PINNED';
  END IF;
 ELSE
  IF start_on<=prior.effective_from THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_EFFECTIVE_ORDER_REQUIRED'; END IF;
  selected_account_id:=prior.account_id; owner_id:=prior.owner_actor_id; kind:=prior.kind;
  scope:=prior.ownership_scope; provider:=prior.provider_namespace; suffix:=prior.masked_suffix;
 END IF;
 SELECT * INTO account FROM crest.accounts a WHERE (a.business_id,a.id)=(requested_business,selected_account_id);
 IF NOT FOUND OR NOT crest_private.money_channel_account_matches(kind,scope,account)
  OR ((prior.id IS NULL OR (body->>'active')::boolean) AND NOT coalesce((
   SELECT v.active FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(requested_business,selected_account_id)
   ORDER BY v.version DESC LIMIT 1),false)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_ACCOUNT_REQUIRED';
 END IF;
 INSERT INTO crest.money_channel_versions(
  business_id,channel_id,version,effective_from,account_id,owner_actor_id,kind,ownership_scope,provider_namespace,masked_suffix,
  label,ownership_evidence,opening_state,opening_on,opening_cents,opening_evidence,active,reason,audit_event_id,created_by,operation_id,origin
 ) VALUES(
  requested_business,requested_channel,expected_version+1,start_on,selected_account_id,owner_id,kind,scope,provider,suffix,
  body->>'label',body->>'ownershipEvidence',body->>'openingState',(body->>'openingOn')::date,(body->>'openingCents')::bigint,
  body->>'openingEvidence',(body->>'active')::boolean,body->>'reason',event_id,expected_actor,requested_operation,'manual'
 ) RETURNING * INTO fresh;
 snapshot:=crest_private.money_channel_snapshot(fresh);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'money_channel_versions',requested_channel,
  fresh.version,CASE WHEN prior.id IS NULL THEN 'create' ELSE 'revise' END,fresh.reason,
  jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.money_channel_snapshot(prior) END,
   'after',snapshot),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=snapshot
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',snapshot);
END $save$;

CREATE FUNCTION crest_commands.lookup_money_channel_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_operation uuid,original_epoch uuid,requested_channel uuid,expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_channel IS NULL OR original_epoch IS NULL OR expected_version IS NULL OR expected_version<0
  OR expected_version=9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 RETURN crest_private.money_channel_operation_result(requested_business,expected_actor,requested_operation,original_epoch,
  requested_channel,expected_version);
END $lookup$;

CREATE FUNCTION crest_commands.retire_money_channel_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 review_epoch uuid,requested_operation uuid,original_epoch uuid,requested_channel uuid,expected_version bigint,requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claim uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_channel IS NULL OR original_epoch IS NULL OR expected_version IS NULL
  OR expected_version<0 OR expected_version=9223372036854775807 OR requested_reason IS NULL
  OR char_length(requested_reason) NOT BETWEEN 1 AND 1000 OR btrim(requested_reason)<>requested_reason
  OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',requested_operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'channelId',requested_channel,'expectedVersion',expected_version::text,
   'auditEventId',event_id,'reviewEpoch',review_epoch));
 digest:=encode(sha256(convert_to((decision||jsonb_build_object('reason',requested_reason,'actorId',expected_actor,
  'commandType','finance.money_channel.retire'))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.money_channel.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_private.money_channel_operation_result(requested_business,expected_actor,requested_operation,original_epoch,requested_channel,expected_version);
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
 RETURN crest_private.money_channel_operation_result(requested_business,expected_actor,requested_operation,original_epoch,requested_channel,expected_version);
END $retire$;

CREATE FUNCTION crest_commands.read_money_channels(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 after_channel uuid, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE items jsonb; more boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH candidates AS (
  SELECT first.channel_id,crest_private.money_channel_snapshot(latest)||jsonb_build_object('accountCode',a.code) AS item
  FROM crest.money_channel_versions first JOIN crest.accounts a ON (a.business_id,a.id)=(first.business_id,first.account_id)
  JOIN LATERAL (
   SELECT v.* FROM crest.money_channel_versions v WHERE (v.business_id,v.channel_id)=(first.business_id,first.channel_id)
   ORDER BY v.version DESC LIMIT 1
  ) latest ON true
  WHERE first.business_id=requested_business AND first.version=1 AND (after_channel IS NULL OR first.channel_id>after_channel)
  ORDER BY first.channel_id LIMIT page_limit+1
 ), page AS (SELECT * FROM candidates ORDER BY channel_id LIMIT page_limit)
 SELECT coalesce(jsonb_agg(item ORDER BY channel_id),'[]'::jsonb),
  (SELECT count(*)>page_limit FROM candidates) INTO items,more FROM page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'rows',items,'hasMore',more);
END $list$;

CREATE FUNCTION crest_commands.read_money_channel_history(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_channel uuid, before_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE items jsonb; more boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_channel IS NULL OR (before_version IS NOT NULL AND before_version<1)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH candidates AS (
  SELECT v.version,crest_private.money_channel_snapshot(v) item
  FROM crest.money_channel_versions v WHERE (v.business_id,v.channel_id)=(requested_business,requested_channel)
   AND (before_version IS NULL OR v.version<before_version)
  ORDER BY v.version DESC LIMIT page_limit+1
 ), page AS (SELECT * FROM candidates ORDER BY version DESC LIMIT page_limit)
 SELECT coalesce(jsonb_agg(item ORDER BY version DESC),'[]'::jsonb),
  (SELECT count(*)>page_limit FROM candidates) INTO items,more FROM page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'channelId',requested_channel,'rows',items,'hasMore',more);
END $history$;

CREATE FUNCTION crest_commands.list_money_channel_accounts(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 channel_kind text, ownership_scope text, after_code text, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $accounts$
DECLARE items jsonb; more boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF channel_kind IS NULL OR channel_kind NOT IN ('bank','wallet','cash','checks') OR ownership_scope IS NULL
  OR ownership_scope NOT IN ('dedicated_business','physical_business_cash','check_custody','mixed_personal')
  OR (after_code IS NOT NULL AND (char_length(after_code) NOT BETWEEN 1 AND 64
   OR btrim(after_code)<>after_code OR after_code~'[[:cntrl:]]'))
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_CHANNEL_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 WITH candidates AS (
  SELECT a.id,a.code,v.name
  FROM crest.accounts a JOIN LATERAL (
   SELECT r.name,r.active FROM crest.account_versions r
   WHERE (r.business_id,r.account_id)=(a.business_id,a.id) ORDER BY r.version DESC LIMIT 1
  ) v ON v.active
  WHERE a.business_id=requested_business AND crest_private.money_channel_account_matches(channel_kind,ownership_scope,a)
   AND (after_code IS NULL OR a.code COLLATE "C">after_code COLLATE "C")
   AND NOT EXISTS(SELECT 1 FROM crest.money_channel_versions c WHERE (c.business_id,c.account_id)=(a.business_id,a.id))
  ORDER BY a.code COLLATE "C" LIMIT page_limit+1
 ), page AS (SELECT * FROM candidates ORDER BY code COLLATE "C" LIMIT page_limit)
 SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY code COLLATE "C"),'[]'::jsonb),
  (SELECT count(*)>page_limit FROM candidates) INTO items,more FROM page;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'kind',channel_kind,
  'ownershipScope',ownership_scope,'rows',items,'hasMore',more);
END $accounts$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_money_channel(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_money_channel_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_money_channel_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_money_channels(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_money_channel_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_money_channel_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,text,integer)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.save_money_channel(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.lookup_money_channel_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_money_channel_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text),
 crest_commands.read_money_channels(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer),
 crest_commands.read_money_channel_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),
 crest_commands.list_money_channel_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_money_channel(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.lookup_money_channel_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_money_channel_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text),
 crest_commands.read_money_channels(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer),
 crest_commands.read_money_channel_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),
 crest_commands.list_money_channel_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,text,integer) TO crest_finance_preview;
