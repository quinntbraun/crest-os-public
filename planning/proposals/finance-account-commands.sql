-- Held synthetic account configuration. The ordinary web role has no
-- execution grant. Installation creates no enabled business or ledger data.
CREATE ROLE crest_finance_account_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crest_finance_preview NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.finance_controls (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL UNIQUE REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 recovery_authority_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 origin text NOT NULL CHECK (origin='system'),
 UNIQUE(business_id,id),
 FOREIGN KEY (business_id,recovery_authority_id) REFERENCES crest_private.business_recovery_authorities(business_id,id),
 FOREIGN KEY (business_id,created_by) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE INDEX finance_control_authority ON crest_private.finance_controls(business_id,recovery_authority_id);
CREATE INDEX finance_control_creator ON crest_private.finance_controls(business_id,created_by);
ALTER TABLE crest_private.finance_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.finance_controls FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_finance_account_owner;
GRANT USAGE ON SCHEMA crest_commands TO crest_finance_preview;
GRANT SELECT ON crest_private.finance_controls TO crest_finance_account_owner;
GRANT UPDATE(recovery_authority_id) ON crest_private.finance_controls TO crest_finance_account_owner;
CREATE POLICY finance_control_read ON crest_private.finance_controls FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_control_lock ON crest_private.finance_controls FOR UPDATE TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK (false);

GRANT SELECT,INSERT ON crest.accounts,crest.account_versions TO crest_finance_account_owner;
CREATE POLICY finance_account_read ON crest.accounts FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_account_append ON crest.accounts FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY finance_account_versions_read ON crest.account_versions FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY finance_account_versions_append ON crest.account_versions FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

-- The existing audit trigger reads the entire exact operation row before
-- accepting provenance. Row policy still scopes it to this actor and command.
GRANT SELECT ON crest_private.operations TO crest_finance_account_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 ON crest_private.operations TO crest_finance_account_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_finance_account_owner;
CREATE POLICY finance_account_op_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.account.save','finance.account.retire'));
CREATE POLICY finance_account_op_insert ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.account.save','finance.account.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY finance_account_op_commit ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.account.save','finance.account.retire') AND state='pending')
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.account.save','finance.account.retire') AND state='committed');

GRANT INSERT(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 ON crest_private.audit_events TO crest_finance_account_owner;
CREATE POLICY finance_account_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='accounts' AND action IN ('create','revise') AND origin='manual' AND import_row_id IS NULL);
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,delta,hash_input,payload,event_hash)
 ON crest_private.audit_events TO crest_finance_account_owner;
CREATE POLICY finance_account_retirement_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire');
CREATE POLICY finance_account_retirement_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.id=audit_events.entity_id AND o.command_type='finance.account.retire' AND o.state='pending'));
GRANT EXECUTE ON FUNCTION crest_private.finance_account_snapshot(crest.accounts,crest.account_versions)
 TO crest_finance_account_owner;

CREATE FUNCTION crest_private.finance_account_result(business uuid, actor uuid, operation uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $result$
DECLARE receipt jsonb; epoch uuid;
BEGIN
 SELECT o.result,o.recovery_epoch INTO receipt,epoch FROM crest_private.operations o
 WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
  AND o.command_type='finance.account.save' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF NOT EXISTS (SELECT 1 FROM crest.account_versions v
  WHERE v.business_id=business AND v.operation_id=operation AND v.created_by=actor
   AND v.account_id::text=receipt->>'accountId' AND v.version::text=receipt->>'version'
   AND v.audit_event_id::text=receipt->>'auditEventId')
  OR receipt->>'businessId' IS DISTINCT FROM business::text
  OR receipt->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_ACCOUNT_RESULT_REVIEW_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',epoch,'receipt',receipt);
END $result$;
REVOKE ALL ON FUNCTION crest_private.finance_account_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_account_result(uuid,uuid,uuid) TO crest_finance_account_owner;

-- A retirement retains only the original reference and explicit review reason.
-- It competes for the same claim as the save and cannot retire a posted entry.
CREATE FUNCTION crest_private.finance_account_resolution(business uuid, actor uuid, operation uuid,
 original_epoch uuid, account uuid, expected_version bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $resolution$
DECLARE saved crest_private.operations; evidence record; result jsonb; decision jsonb;
BEGIN
 SELECT * INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(business,operation,actor);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.state<>'committed' OR saved.schema_version<>1 OR saved.result_schema_version<>1 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_ACCOUNT_RESULT_REVIEW_REQUIRED';
 END IF;
 IF saved.command_type='finance.account.save' THEN
  IF saved.recovery_epoch IS DISTINCT FROM original_epoch OR saved.result->>'accountId' IS DISTINCT FROM account::text
   OR saved.result->>'version' IS DISTINCT FROM (expected_version+1)::text THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN crest_private.finance_account_result(business,actor,operation);
 END IF;
 SELECT a.id,a.reason,a.delta,a.hash_input,a.payload,a.event_hash INTO STRICT evidence
 FROM crest_private.audit_events a
 WHERE (a.business_id,a.operation_id,a.actor_id)=(business,operation,actor)
  AND a.entity_kind='operations' AND a.entity_id=saved.id AND a.entity_version=1 AND a.action='retire';
 result:=jsonb_build_object('schemaVersion',1,'businessId',business,'accountId',account,'expectedVersion',expected_version::text,
  'auditEventId',evidence.id,'reviewEpoch',saved.recovery_epoch);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',operation,'recoveryEpoch',original_epoch,'receipt',result);
 IF saved.result IS DISTINCT FROM decision THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 IF evidence.reason IS NULL OR evidence.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision)
  OR evidence.hash_input IS DISTINCT FROM evidence.payload::text
  OR evidence.event_hash IS DISTINCT FROM encode(sha256(convert_to(evidence.hash_input,'UTF8')),'hex')
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to((decision||jsonb_build_object('reason',evidence.reason,'actorId',actor,
   'commandType','finance.account.retire'))::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_ACCOUNT_RESULT_REVIEW_REQUIRED';
 END IF;
 RETURN decision;
END $resolution$;
REVOKE ALL ON FUNCTION crest_private.finance_account_resolution(uuid,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.finance_account_resolution(uuid,uuid,uuid,uuid,uuid,bigint) TO crest_finance_account_owner;

CREATE FUNCTION crest_commands.save_finance_account(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, requested_operation uuid, request_schema integer, requested_account uuid, expected_version bigint, body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE identity_body jsonb; digest text; claimed uuid; existing record; account crest.accounts;
 prior crest.account_versions; fresh crest.account_versions; event_id uuid; receipt jsonb; violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_account IS NULL OR request_schema IS DISTINCT FROM 1
  OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>8192
  OR body-ARRAY['identity','name','active','reason']<>'{}'::jsonb OR NOT body ?& ARRAY['identity','name','active','reason']
  OR jsonb_typeof(body->'name')<>'string' OR char_length(body->>'name') NOT BETWEEN 1 AND 200
  OR btrim(body->>'name')<>body->>'name' OR (body->>'name')~'[[:cntrl:]]'
  OR jsonb_typeof(body->'active')<>'boolean' OR jsonb_typeof(body->'reason') NOT IN ('null','string')
  OR char_length(btrim(body->>'reason')) NOT BETWEEN 1 AND 1000
  OR (expected_version>0 AND body->>'reason' IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_INPUT_REQUIRED';
 END IF;
 identity_body:=body->'identity';
 IF expected_version=0 THEN
  IF jsonb_typeof(identity_body)<>'object'
   OR identity_body-ARRAY['code','accountType','normalSide','controlKind','reportRole']<>'{}'::jsonb
   OR NOT identity_body ?& ARRAY['code','accountType','normalSide','controlKind','reportRole']
   OR EXISTS(SELECT 1 FROM jsonb_each(identity_body) WHERE
    (key='controlKind' AND jsonb_typeof(value) NOT IN ('null','string'))
    OR (key<>'controlKind' AND jsonb_typeof(value)<>'string')) THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_INPUT_REQUIRED';
  END IF;
 ELSIF identity_body<>'null'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_IDENTITY_RETAINED';
 END IF;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','finance.account.save','schemaVersion',1,
  'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'accountId',requested_account,
  'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'finance.account.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT o.recovery_epoch,o.payload_hash INTO existing FROM crest_private.operations o
    WHERE o.business_id=requested_business AND o.operation_id=requested_operation;
   IF NOT FOUND OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN
    RETURN jsonb_build_object('state','conflict','reason','operation');
   END IF;
   PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
   RETURN crest_private.finance_account_result(requested_business,expected_actor,requested_operation);
  END IF;

  PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  SELECT * INTO prior FROM crest.account_versions v WHERE (v.business_id,v.account_id)=(requested_business,requested_account)
   ORDER BY v.version DESC LIMIT 1;
  IF coalesce(prior.version,0)<>expected_version THEN
   RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='FINANCE_ACCOUNT_VERSION_CONFLICT';
  END IF;
  IF expected_version=0 THEN
   INSERT INTO crest.accounts(id,business_id,code,account_type,normal_side,control_kind,report_role,currency,created_by,operation_id,origin)
   VALUES(requested_account,requested_business,identity_body->>'code',identity_body->>'accountType',identity_body->>'normalSide',
    identity_body->>'controlKind',identity_body->>'reportRole','USD',expected_actor,requested_operation,'manual') RETURNING * INTO account;
  ELSE
   SELECT * INTO STRICT account FROM crest.accounts a WHERE (a.business_id,a.id)=(requested_business,requested_account);
  END IF;
  event_id:=gen_random_uuid();
  INSERT INTO crest.account_versions(business_id,account_id,version,name,active,reason,audit_event_id,created_by,operation_id,origin)
   VALUES(requested_business,requested_account,expected_version+1,body->>'name',(body->>'active')::boolean,body->>'reason',
    event_id,expected_actor,requested_operation,'manual') RETURNING * INTO fresh;
  INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
   VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'accounts',requested_account,fresh.version,
    CASE WHEN expected_version=0 THEN 'create' ELSE 'revise' END, fresh.reason,
    jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb
     ELSE crest_private.finance_account_snapshot(account,prior) END,'after',crest_private.finance_account_snapshot(account,fresh)),'manual');
  receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'accountId',requested_account,
   'version',fresh.version::text,'auditEventId',event_id);
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
   WHERE business_id=requested_business AND operation_id=requested_operation;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_ACCOUNT_RESULT_REVIEW_REQUIRED'; END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN crest_private.finance_account_result(requested_business,expected_actor,requested_operation);
 EXCEPTION WHEN SQLSTATE 'P1001' THEN
  RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(prior.version,0)::text);
 WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
  IF violated IN ('accounts_pkey','accounts_business_id_code_key') THEN
   RETURN jsonb_build_object('state','conflict','reason','account');
  END IF;
  RAISE;
 END;
END $save$;

CREATE FUNCTION crest_commands.lookup_finance_account_operation(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_operation uuid, original_epoch uuid, requested_account uuid, expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR requested_account IS NULL
  OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 RETURN crest_private.finance_account_resolution(requested_business,expected_actor,requested_operation,original_epoch,requested_account,expected_version);
END $lookup$;

CREATE FUNCTION crest_commands.retire_finance_account_save(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 review_epoch uuid, requested_operation uuid, original_epoch uuid, requested_account uuid, expected_version bigint, requested_reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claim uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR original_epoch IS NULL OR requested_account IS NULL
  OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807
  OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 1000
  OR btrim(requested_reason)<>requested_reason OR requested_reason~'[[:cntrl:]]' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','operationId',requested_operation,'recoveryEpoch',original_epoch,
  'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'accountId',requested_account,
   'expectedVersion',expected_version::text,'auditEventId',event_id,'reviewEpoch',review_epoch));
 digest:=encode(sha256(convert_to((decision||jsonb_build_object('reason',requested_reason,'actorId',expected_actor,
  'commandType','finance.account.retire'))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.account.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
 IF claim IS NULL THEN
  PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  existing:=crest_private.finance_account_resolution(requested_business,expected_actor,requested_operation,
   original_epoch,requested_account,expected_version);
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
 RETURN crest_private.finance_account_resolution(requested_business,expected_actor,requested_operation,
  original_epoch,requested_account,expected_version);
END $retire$;

CREATE FUNCTION crest_commands.list_finance_accounts(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 after_code text, include_archived boolean, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE items jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF include_archived IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 OR
  (after_code IS NOT NULL AND (char_length(after_code) NOT BETWEEN 1 AND 64 OR after_code~'[[:cntrl:]]')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT coalesce(jsonb_agg(p.item ORDER BY p.code COLLATE "C"),'[]'::jsonb) INTO items FROM (
  SELECT a.code,crest_private.finance_account_snapshot(a,v) AS item
  FROM crest.accounts a CROSS JOIN LATERAL (
   SELECT r.* FROM crest.account_versions r WHERE (r.business_id,r.account_id)=(a.business_id,a.id)
   ORDER BY r.version DESC LIMIT 1
  ) v
  WHERE a.business_id=requested_business AND (include_archived OR v.active)
   AND (after_code IS NULL OR a.code COLLATE "C">after_code COLLATE "C")
  ORDER BY a.code COLLATE "C" LIMIT page_limit+1
 ) p;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'hasMore',jsonb_array_length(items)>page_limit,'rows',CASE WHEN jsonb_array_length(items)>page_limit THEN items-page_limit ELSE items END);
END $list$;

CREATE FUNCTION crest_commands.read_finance_account_history(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_account uuid, after_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE items jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_account IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_ACCOUNT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT coalesce(jsonb_agg(p.item ORDER BY p.version),'[]'::jsonb) INTO items FROM (
  SELECT v.version,crest_private.finance_account_snapshot(a,v)||jsonb_build_object('reason',v.reason,'auditEventId',v.audit_event_id) AS item
  FROM crest.accounts a JOIN crest.account_versions v ON (v.business_id,v.account_id)=(a.business_id,a.id)
  WHERE (a.business_id,a.id)=(requested_business,requested_account) AND v.version>after_version
  ORDER BY v.version LIMIT page_limit+1
 ) p;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'accountId',requested_account,
  'hasMore',jsonb_array_length(items)>page_limit,'rows',CASE WHEN jsonb_array_length(items)>page_limit THEN items-page_limit ELSE items END);
END $history$;
RESET ROLE;

GRANT EXECUTE ON FUNCTION
 crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),
 crest_commands.lock_financial_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.finish_financial_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)
 TO crest_finance_account_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_finance_account(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_finance_account_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_finance_account_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.list_finance_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,boolean,integer)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_finance_account_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.save_finance_account(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),
 crest_commands.lookup_finance_account_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_finance_account_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text),
 crest_commands.list_finance_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,boolean,integer),
 crest_commands.read_finance_account_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.save_finance_account(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),
 crest_commands.lookup_finance_account_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint),
 crest_commands.retire_finance_account_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text),
 crest_commands.list_finance_accounts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,boolean,integer),
 crest_commands.read_finance_account_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer)
 TO crest_finance_preview;
