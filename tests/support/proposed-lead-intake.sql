-- ADR41 closed CRM boundary: lead_source source. Synthetic proposal only.
-- Not an applied/published migration; native acceptance is required.
DO $review$
DECLARE r oid; role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['crest_lead_source_owner','crest_lead_source_integrity_owner'] LOOP
  SELECT oid INTO r FROM pg_roles WHERE rolname=role_name;
  IF r IS NULL THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    SELECT oid INTO r FROM pg_roles WHERE rolname=role_name;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private','crest_commands')
      AND (c.relowner=r OR CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_ROLE_REVIEW_REQUIRED';
  END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner') AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>5
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_SOURCE_REVIEW_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.customers'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_lead_source_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_lead_source_integrity_owner;
CREATE TABLE crest.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK(char_length(label)<=200 AND char_length(label)>=1 AND btrim(label,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND label!~'[[:cntrl:]]'),
  kind text NOT NULL CHECK(char_length(kind)<=200 AND char_length(kind)>=1 AND btrim(kind,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND kind!~'[[:cntrl:]]'),
  active boolean NOT NULL,
  referral_customer_id uuid,
  label_normalized text GENERATED ALWAYS AS (lower(btrim(label,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'))) STORED,
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  origin text NOT NULL CHECK(origin IN ('manual','import','system')),
  operation_id uuid NOT NULL,
  import_row_id uuid,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
  CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at),
  FOREIGN KEY(business_id,referral_customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX lead_sources_label ON crest.lead_sources(business_id,lower(label),id);
CREATE INDEX lead_sources_creator ON crest.lead_sources(business_id,created_by);
CREATE INDEX lead_sources_updater ON crest.lead_sources(business_id,updated_by);
CREATE INDEX lead_sources_operation ON crest.lead_sources(business_id,operation_id,updated_by);
CREATE UNIQUE INDEX lead_sources_label_unique ON crest.lead_sources(business_id,label_normalized);
CREATE INDEX lead_sources_referral ON crest.lead_sources(business_id,referral_customer_id) WHERE referral_customer_id IS NOT NULL;
GRANT USAGE ON TYPE crest.lead_sources TO crest_lead_source_owner,crest_lead_source_integrity_owner;
ALTER TABLE crest.lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.lead_sources FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.lead_source_projection(c crest.lead_sources) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $projection$
  SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'label',(c).label,'label_normalized',(c).label_normalized,'kind',(c).kind,'active',(c).active,'referral_customer_id',(c).referral_customer_id,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$projection$;
REVOKE ALL ON FUNCTION crest_private.lead_source_projection(crest.lead_sources) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_source_projection(crest.lead_sources) TO crest_lead_source_owner,crest_lead_source_integrity_owner;
CREATE FUNCTION crest_private.validate_lead_source_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Generated hints are filled after BEFORE triggers; compare source provenance explicitly.
    IF ROW(NEW.id,NEW.business_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_SOURCE_PROVENANCE';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_VERSION_CONFLICT'; END IF;
  ELSE
    IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_VERSION_CONFLICT'; END IF;
    NEW.created_at:=stamp;
  END IF;

  NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_lead_source_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by
    AND a.entity_kind='lead_sources' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.lead_source_projection(NEW::crest.lead_sources)
    AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.lead_source_projection(OLD::crest.lead_sources) END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_AUDIT_REQUIRED';
  END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER lead_source_change BEFORE INSERT OR UPDATE ON crest.lead_sources FOR EACH ROW EXECUTE FUNCTION crest_private.validate_lead_source_change();
CREATE CONSTRAINT TRIGGER lead_source_audit AFTER INSERT OR UPDATE ON crest.lead_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_lead_source_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.lead_sources FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.lead_sources FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.lead_sources TO crest_lead_source_owner;
GRANT INSERT(id,business_id,label,kind,active,referral_customer_id,created_by,updated_by,origin,operation_id) ON crest.lead_sources TO crest_lead_source_owner;
GRANT UPDATE(label,kind,active,referral_customer_id,version,updated_by,operation_id) ON crest.lead_sources TO crest_lead_source_owner;
CREATE POLICY lead_source_read ON crest.lead_sources FOR SELECT TO crest_lead_source_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY lead_source_create ON crest.lead_sources FOR INSERT TO crest_lead_source_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY lead_source_edit ON crest.lead_sources FOR UPDATE TO crest_lead_source_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid)
  WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_lead_source_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_lead_source_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_lead_source_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_lead_source_owner;
CREATE POLICY lead_source_operations_read ON crest_private.operations FOR SELECT TO crest_lead_source_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.source.save');
CREATE POLICY lead_source_operations_create ON crest_private.operations FOR INSERT TO crest_lead_source_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.lead.source.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_source_operations_finish ON crest_private.operations FOR UPDATE TO crest_lead_source_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.source.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.source.save');
CREATE POLICY lead_source_audits_read ON crest_private.audit_events FOR SELECT TO crest_lead_source_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='lead_sources');
CREATE POLICY lead_source_audits_create ON crest_private.audit_events FOR INSERT TO crest_lead_source_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='lead_sources' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_lead_source_integrity_owner;
ALTER FUNCTION crest_private.check_lead_source_audit() OWNER TO crest_lead_source_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_lead_source_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_lead_source_audit() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.authorize_lead_source_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
  context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_READ_DENIED'; END IF;
  RETURN context;
END
$read$;
CREATE FUNCTION crest_commands.finish_lead_source_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
  PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_SAVE_DENIED'; END IF;
END
$finish$;
CREATE FUNCTION crest_private.lead_source_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record; a record; after_row jsonb; before_row jsonb; body jsonb; expected_version text; receipt jsonb; digest text;
BEGIN
  SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND command_type='crm.lead.source.save';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  receipt:=o.result;
  IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt)<>'object' OR receipt-ARRAY['schemaVersion','businessId','leadSourceId','leadSourceVersion','auditEventId']<>'{}'::jsonb
    OR NOT receipt ?& ARRAY['schemaVersion','businessId','leadSourceId','leadSourceVersion','auditEventId'] OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId'<>requested_business::text
    OR jsonb_typeof(receipt->'leadSourceVersion')<>'string' OR (receipt->>'leadSourceVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_RESULT_REVIEW_REQUIRED'; END IF;
  SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'auditEventId')::uuid AND entity_kind='lead_sources' AND entity_id=(receipt->>'leadSourceId')::uuid AND entity_version=(receipt->>'leadSourceVersion')::bigint;
  IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_RESULT_REVIEW_REQUIRED'; END IF;
  after_row:=a.delta->'after';before_row:=a.delta->'before';expected_version:=CASE WHEN before_row='null'::jsonb THEN '0' ELSE before_row->>'version' END;
  IF jsonb_typeof(after_row) IS DISTINCT FROM 'object' OR after_row-ARRAY['id','business_id','label','label_normalized','kind','active','referral_customer_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT after_row ?& ARRAY['id','business_id','label','label_normalized','kind','active','referral_customer_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR before_row IS NULL OR (before_row<>'null'::jsonb AND (jsonb_typeof(before_row) IS DISTINCT FROM 'object' OR before_row->>'id' IS DISTINCT FROM receipt->>'leadSourceId')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_RESULT_REVIEW_REQUIRED'; END IF;
  body:=jsonb_build_object('label',after_row->'label','kind',after_row->'kind','active',after_row->'active','referralCustomerId',after_row->'referral_customer_id');
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.source.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'leadSourceId',receipt->'leadSourceId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
  IF expected_version IS NULL OR (receipt->>'leadSourceVersion')::bigint<>(expected_version::bigint)+1 OR after_row->>'id'<>receipt->>'leadSourceId' OR after_row->>'business_id'<>requested_business::text OR after_row->>'operation_id'<>requested_operation::text OR after_row->>'updated_by'<>requested_actor::text OR after_row->>'version'<>receipt->>'leadSourceVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_RESULT_REVIEW_REQUIRED'; END IF;
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END
$result$;
CREATE FUNCTION crest_commands.save_lead_source(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_lead_source uuid,expected_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; existing record; old_row crest.lead_sources; new_row crest.lead_sources; event_id uuid; command_result jsonb; action text; violated text; source_value jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL OR requested_lead_source IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR body IS NULL OR jsonb_typeof(body)<>'object'
    OR body-ARRAY['label','kind','active','referralCustomerId']<>'{}'::jsonb OR NOT body ?& ARRAY['label','kind','active','referralCustomerId'] OR octet_length(body::text)>131072 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'label') NOT IN ('string') OR body->>'label' IS NOT NULL AND NOT (char_length(body->>'label')<=200 AND char_length(body->>'label')>=1 AND btrim(body->>'label',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND body->>'label'!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'kind') NOT IN ('string') OR body->>'kind' IS NOT NULL AND NOT (char_length(body->>'kind')<=200 AND char_length(body->>'kind')>=1 AND btrim(body->>'kind',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND body->>'kind'!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'active') NOT IN ('boolean') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'referralCustomerId') NOT IN ('string','null') OR body->>'referralCustomerId' IS NOT NULL AND body->>'referralCustomerId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  BEGIN
    context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
    PERFORM crest_commands.authorize_lead_source_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_LEAD_SOURCE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied'); END IF;RAISE;
  END;
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.source.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'leadSourceId',requested_lead_source,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
  BEGIN
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.lead.source.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
    IF claimed IS NULL THEN
      SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
      IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
      command_result:=crest_private.lead_source_operation_result(requested_business,expected_actor,requested_operation);
    ELSE
      IF body->>'referralCustomerId' IS NOT NULL THEN
        PERFORM 1 FROM crest.customers WHERE business_id=requested_business AND id=(body->>'referralCustomerId')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_SOURCE_PARENT_CONFLICT'; END IF;
      END IF;
      SELECT * INTO old_row FROM crest.lead_sources WHERE business_id=requested_business AND id=requested_lead_source FOR UPDATE;
      IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_LEAD_SOURCE_VERSION_CONFLICT'; END IF;
      IF expected_version=0 THEN
        INSERT INTO crest.lead_sources(id,business_id,label,kind,active,referral_customer_id,created_by,updated_by,origin,operation_id) VALUES(requested_lead_source,requested_business,body->>'label',body->>'kind',(body->>'active')::boolean,(body->>'referralCustomerId')::uuid,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
      ELSE
        UPDATE crest.lead_sources SET label=body->>'label',kind=body->>'kind',active=(body->>'active')::boolean,referral_customer_id=(body->>'referralCustomerId')::uuid,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_lead_source RETURNING * INTO new_row;
      END IF;
      action:=CASE WHEN expected_version=0 THEN 'create' ELSE CASE WHEN NOT new_row.active AND old_row.active THEN 'deactivate' WHEN new_row.active AND NOT old_row.active THEN 'activate' ELSE 'edit' END END;
      INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'lead_sources',requested_lead_source,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.lead_source_projection(old_row) END,'after',crest_private.lead_source_projection(new_row)),'manual') RETURNING id INTO event_id;
      command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadSourceId',requested_lead_source,'leadSourceVersion',new_row.version::text,'auditEventId',event_id));
      UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
    END IF;
    PERFORM crest_commands.finish_lead_source_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
  EXCEPTION WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','parent');
    WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
    WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated='lead_sources_label_unique' THEN RETURN jsonb_build_object('state','conflict','reason','label'); END IF;
      IF violated='lead_sources_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','lead_source'); END IF;RAISE;

  END;
END
$save$;

GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,delta) ON crest_private.audit_events TO crest_lead_source_integrity_owner;
CREATE POLICY lead_source_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_lead_source_integrity_owner USING(entity_kind='lead_sources');
CREATE UNIQUE INDEX lead_source_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='lead_sources';
CREATE FUNCTION crest_commands.lookup_lead_source_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_lead_source_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  RETURN crest_private.lead_source_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_lead_source_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,search_text text,after_id uuid,include_inactive boolean,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF search_text IS NULL OR char_length(search_text)>200 OR include_inactive IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_lead_source_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH matches AS MATERIALIZED(SELECT c.* FROM crest.lead_sources c WHERE c.business_id=requested_business AND (include_inactive OR c.active) AND (after_id IS NULL OR c.id>after_id)
    AND (search_text='' OR strpos(lower(c.label),lower(search_text))>0 OR strpos(lower(c.kind),lower(search_text))>0) ORDER BY c.id LIMIT page_limit+1),
    page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'lead_sources',coalesce((SELECT jsonb_agg(crest_private.lead_source_projection(p::crest.lead_sources) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_SOURCE_PAGE_LIMIT'; END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_lead_source_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead_source uuid,after_version bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_lead_source IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_lead_source_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH target AS MATERIALIZED(SELECT * FROM crest.lead_sources WHERE business_id=requested_business AND id=requested_lead_source),
    events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='lead_sources' AND entity_id=requested_lead_source AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
    page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
  SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'lead_source',(SELECT crest_private.lead_source_projection(t::crest.lead_sources) FROM target t),
    'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_SOURCE_PAGE_LIMIT'; END IF;RETURN result;
END
$history$;

-- Separate privileged export caller; no ordinary web execute. It must receive
-- a recently authorized fixed business from the future whole-export job.
GRANT SELECT(id) ON crest.businesses TO crest_lead_source_owner;
CREATE POLICY lead_source_export_business ON crest.businesses FOR SELECT TO crest_lead_source_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.lead_source_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_SOURCE_SNAPSHOT_REQUIRED'; END IF;
  IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_INPUT_REQUIRED'; END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_SCOPE_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM crest.lead_sources WHERE business_id=requested_business;
  IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_SOURCE_SNAPSHOT_LIMIT'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','lead_source_directory','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead_source.directory.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.lead_source_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
  context:=crest_commands.lead_source_snapshot_context(requested_business);
  IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SOURCE_SNAPSHOT_REQUIRED'; END IF;
  WITH page AS(SELECT * FROM crest.lead_sources WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'lead_sources',coalesce(jsonb_agg(crest_private.lead_source_projection(p::crest.lead_sources) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_SOURCE_PAGE_LIMIT'; END IF;RETURN result;
END
$page$;
GRANT SELECT(id,business_id) ON crest.customers TO crest_lead_source_owner;
CREATE POLICY lead_source_customer_parent ON crest.customers FOR SELECT TO crest_lead_source_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_lead_source_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.authorize_lead_source_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_lead_source_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.lead_source_operation_result(uuid,uuid,uuid) OWNER TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.save_lead_source(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.lookup_lead_source_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.read_lead_source_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer) OWNER TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.read_lead_source_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.lead_source_snapshot_context(uuid) OWNER TO crest_lead_source_owner;
ALTER FUNCTION crest_commands.lead_source_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_source_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_lead_source_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_lead_source_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_lead_source_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_lead_source_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.lead_source_operation_result(uuid,uuid,uuid),crest_commands.save_lead_source(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_lead_source_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_source_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_lead_source_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),crest_commands.lead_source_snapshot_context(uuid),crest_commands.lead_source_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_lead_source_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_lead_source_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_lead_source_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_lead_source(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_lead_source_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_source_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_lead_source_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_source_snapshot_context(uuid),crest_commands.lead_source_snapshot_page(uuid,text,uuid,integer) TO crest_export;

-- ADR41 closed CRM boundary: lead source. Synthetic proposal only.
-- Not an applied/published migration; native acceptance is required.
DO $review$
DECLARE r oid; role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['crest_lead_owner','crest_lead_integrity_owner'] LOOP
  SELECT oid INTO r FROM pg_roles WHERE rolname=role_name;
  IF r IS NULL THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    SELECT oid INTO r FROM pg_roles WHERE rolname=role_name;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private','crest_commands')
      AND (c.relowner=r OR CASE WHEN c.relkind IN ('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_ROLE_REVIEW_REQUIRED';
  END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner') AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>5
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_REVIEW_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.customers'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_lead_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_lead_integrity_owner;
CREATE TABLE crest.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK(char_length(label)<=200 AND char_length(label)>=1 AND btrim(label,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND label!~'[[:cntrl:]]'),
  customer_id uuid,
  source_id uuid,
  referral_text text CHECK(referral_text IS NULL OR char_length(referral_text)<=2000 AND translate(referral_text,E'\t\n\r','')!~'[[:cntrl:]]'),
  phone_raw text CHECK(phone_raw IS NULL OR char_length(phone_raw)<=512 AND char_length(phone_raw)>=1 AND btrim(phone_raw,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND phone_raw!~'[[:cntrl:]]'),
  email_raw text CHECK(email_raw IS NULL OR char_length(email_raw)<=512 AND char_length(email_raw)>=1 AND btrim(email_raw,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND email_raw!~'[[:cntrl:]]'),
  requested_scope text CHECK(requested_scope IS NULL OR char_length(requested_scope)<=4000 AND translate(requested_scope,E'\t\n\r','')!~'[[:cntrl:]]'),
  availability text CHECK(availability IS NULL OR char_length(availability)<=4000 AND translate(availability,E'\t\n\r','')!~'[[:cntrl:]]'),
  estimated_cents bigint,
  follow_up_at timestamptz,
  notes text CHECK(notes IS NULL OR char_length(notes)<=4000 AND translate(notes,E'\t\n\r','')!~'[[:cntrl:]]'),
  source_snapshot jsonb,
  phone_normalized text GENERATED ALWAYS AS (nullif(regexp_replace(phone_raw,'[^0-9]','','g'),'')) STORED,
  email_normalized text GENERATED ALWAYS AS (nullif(lower(btrim(email_raw)),'')) STORED,
  state text NOT NULL DEFAULT 'new' CHECK(state IN ('new','contacted','awaiting_information','quote_needed','quote_sent','follow_up','won','lost')),
  lost_reason text CHECK(lost_reason IS NULL OR char_length(lost_reason)<=1000 AND char_length(lost_reason)>=1 AND btrim(lost_reason,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(lost_reason,E'\t\n\r','')!~'[[:cntrl:]]'),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  origin text NOT NULL CHECK(origin IN ('manual','import','system')),
  operation_id uuid NOT NULL,
  import_row_id uuid,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
  CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at),
  FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,source_id) REFERENCES crest.lead_sources(business_id,id) ON DELETE RESTRICT,
  CHECK((source_id IS NULL AND source_snapshot IS NULL) OR (source_id IS NOT NULL AND source_snapshot IS NOT NULL AND jsonb_typeof(source_snapshot)='object')),
  CHECK(estimated_cents IS NULL OR estimated_cents>=0),
  CHECK(follow_up_at IS NULL OR isfinite(follow_up_at) AND follow_up_at>=TIMESTAMPTZ '0001-01-01T00:00:00Z' AND follow_up_at<TIMESTAMPTZ '10000-01-01T00:00:00Z'),
  CHECK((state='lost')=(lost_reason IS NOT NULL))
);
CREATE INDEX leads_label ON crest.leads(business_id,lower(label),id);
CREATE INDEX leads_creator ON crest.leads(business_id,created_by);
CREATE INDEX leads_updater ON crest.leads(business_id,updated_by);
CREATE INDEX leads_operation ON crest.leads(business_id,operation_id,updated_by);
CREATE INDEX leads_customer ON crest.leads(business_id,customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX leads_source ON crest.leads(business_id,source_id) WHERE source_id IS NOT NULL;
CREATE INDEX leads_phone ON crest.leads(business_id,phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX leads_email ON crest.leads(business_id,email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX leads_follow_up ON crest.leads(business_id,follow_up_at,id) WHERE follow_up_at IS NOT NULL;
CREATE INDEX leads_state ON crest.leads(business_id,state,id);
GRANT USAGE ON TYPE crest.leads TO crest_lead_owner,crest_lead_integrity_owner;
ALTER TABLE crest.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.leads FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.lead_projection(c crest.leads) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $projection$
  SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'label',(c).label,'customer_id',(c).customer_id,'source_id',(c).source_id,'source_snapshot',(c).source_snapshot,'referral_text',(c).referral_text,'phone_raw',(c).phone_raw,'phone_normalized',(c).phone_normalized,'email_raw',(c).email_raw,'email_normalized',(c).email_normalized,'requested_scope',(c).requested_scope,'availability',(c).availability,'estimated_cents',(c).estimated_cents::text,'state',(c).state,'follow_up_at',to_char((c).follow_up_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lost_reason',(c).lost_reason,'notes',(c).notes,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$projection$;
REVOKE ALL ON FUNCTION crest_private.lead_projection(crest.leads) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_projection(crest.leads) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.validate_lead_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Generated hints are filled after BEFORE triggers; compare source provenance explicitly.
    IF ROW(NEW.id,NEW.business_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id,NEW.state,NEW.lost_reason)
      IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id,OLD.state,OLD.lost_reason) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_PROVENANCE';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VERSION_CONFLICT'; END IF;
  ELSE
    IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VERSION_CONFLICT'; END IF;
    NEW.created_at:=stamp;
  END IF;
  IF TG_OP='INSERT' AND (NEW.state<>'new' OR NEW.lost_reason IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_EVENT_REQUIRED'; END IF;
  IF TG_OP='UPDATE' AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id THEN
    IF NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_SOURCE_SNAPSHOT'; END IF;
  ELSIF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.lead_sources c WHERE c.business_id=NEW.business_id AND c.id=NEW.source_id AND NEW.source_snapshot=crest_private.lead_source_projection(c)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_SNAPSHOT_REQUIRED';
  END IF;
  NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_lead_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by
    AND a.entity_kind='leads' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.lead_projection(NEW::crest.leads)
    AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.lead_projection(OLD::crest.leads) END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_AUDIT_REQUIRED';
  END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER lead_change BEFORE INSERT OR UPDATE ON crest.leads FOR EACH ROW EXECUTE FUNCTION crest_private.validate_lead_change();
CREATE CONSTRAINT TRIGGER lead_audit AFTER INSERT OR UPDATE ON crest.leads DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_lead_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.leads FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.leads FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.leads TO crest_lead_owner;
GRANT INSERT(id,business_id,label,customer_id,source_id,referral_text,phone_raw,email_raw,requested_scope,availability,estimated_cents,follow_up_at,notes,source_snapshot,created_by,updated_by,origin,operation_id) ON crest.leads TO crest_lead_owner;
GRANT UPDATE(label,customer_id,source_id,referral_text,phone_raw,email_raw,requested_scope,availability,estimated_cents,follow_up_at,notes,source_snapshot,version,updated_by,operation_id) ON crest.leads TO crest_lead_owner;
CREATE POLICY lead_read ON crest.leads FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY lead_create ON crest.leads FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY lead_edit ON crest.leads FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid)
  WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_lead_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_lead_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_lead_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_lead_owner;
CREATE POLICY lead_operations_read ON crest_private.operations FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.save');
CREATE POLICY lead_operations_create ON crest_private.operations FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.lead.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_operations_finish ON crest_private.operations FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.save');
CREATE POLICY lead_audits_read ON crest_private.audit_events FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='leads');
CREATE POLICY lead_audits_create ON crest_private.audit_events FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='leads' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.check_lead_audit() OWNER TO crest_lead_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_lead_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_lead_audit() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.authorize_lead_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
  context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_READ_DENIED'; END IF;
  RETURN context;
END
$read$;
CREATE FUNCTION crest_commands.finish_lead_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
  PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_SAVE_DENIED'; END IF;
END
$finish$;
CREATE FUNCTION crest_private.lead_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record; a record; after_row jsonb; before_row jsonb; body jsonb; expected_version text; receipt jsonb; digest text;
BEGIN
  SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND command_type='crm.lead.save';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  receipt:=o.result;
  IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt)<>'object' OR receipt-ARRAY['schemaVersion','businessId','leadId','leadVersion','auditEventId']<>'{}'::jsonb
    OR NOT receipt ?& ARRAY['schemaVersion','businessId','leadId','leadVersion','auditEventId'] OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId'<>requested_business::text
    OR jsonb_typeof(receipt->'leadVersion')<>'string' OR (receipt->>'leadVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_RESULT_REVIEW_REQUIRED'; END IF;
  SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'auditEventId')::uuid AND entity_kind='leads' AND entity_id=(receipt->>'leadId')::uuid AND entity_version=(receipt->>'leadVersion')::bigint;
  IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_RESULT_REVIEW_REQUIRED'; END IF;
  after_row:=a.delta->'after';before_row:=a.delta->'before';expected_version:=CASE WHEN before_row='null'::jsonb THEN '0' ELSE before_row->>'version' END;
  IF jsonb_typeof(after_row) IS DISTINCT FROM 'object' OR after_row-ARRAY['id','business_id','label','customer_id','source_id','source_snapshot','referral_text','phone_raw','phone_normalized','email_raw','email_normalized','requested_scope','availability','estimated_cents','state','follow_up_at','lost_reason','notes','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT after_row ?& ARRAY['id','business_id','label','customer_id','source_id','source_snapshot','referral_text','phone_raw','phone_normalized','email_raw','email_normalized','requested_scope','availability','estimated_cents','state','follow_up_at','lost_reason','notes','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR before_row IS NULL OR (before_row<>'null'::jsonb AND (jsonb_typeof(before_row) IS DISTINCT FROM 'object' OR before_row->>'id' IS DISTINCT FROM receipt->>'leadId')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_RESULT_REVIEW_REQUIRED'; END IF;
  body:=jsonb_build_object('label',after_row->'label','customerId',after_row->'customer_id','sourceId',after_row->'source_id','referralText',after_row->'referral_text','phone',after_row->'phone_raw','email',after_row->'email_raw','requestedScope',after_row->'requested_scope','availability',after_row->'availability','estimatedCents',after_row->'estimated_cents','followUpAt',after_row->'follow_up_at','notes',after_row->'notes');
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'leadId',receipt->'leadId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
  IF expected_version IS NULL OR (receipt->>'leadVersion')::bigint<>(expected_version::bigint)+1 OR after_row->>'id'<>receipt->>'leadId' OR after_row->>'business_id'<>requested_business::text OR after_row->>'operation_id'<>requested_operation::text OR after_row->>'updated_by'<>requested_actor::text OR after_row->>'version'<>receipt->>'leadVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_RESULT_REVIEW_REQUIRED'; END IF;
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END
$result$;
CREATE FUNCTION crest_commands.save_lead(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_lead uuid,expected_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; existing record; old_row crest.leads; new_row crest.leads; event_id uuid; command_result jsonb; action text; violated text; source_value jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL OR requested_lead IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR body IS NULL OR jsonb_typeof(body)<>'object'
    OR body-ARRAY['label','customerId','sourceId','referralText','phone','email','requestedScope','availability','estimatedCents','followUpAt','notes']<>'{}'::jsonb OR NOT body ?& ARRAY['label','customerId','sourceId','referralText','phone','email','requestedScope','availability','estimatedCents','followUpAt','notes'] OR octet_length(body::text)>131072 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'label') NOT IN ('string') OR body->>'label' IS NOT NULL AND NOT (char_length(body->>'label')<=200 AND char_length(body->>'label')>=1 AND btrim(body->>'label',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND body->>'label'!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'customerId') NOT IN ('string','null') OR body->>'customerId' IS NOT NULL AND body->>'customerId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'sourceId') NOT IN ('string','null') OR body->>'sourceId' IS NOT NULL AND body->>'sourceId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'referralText') NOT IN ('string','null') OR body->>'referralText' IS NOT NULL AND NOT (char_length(body->>'referralText')<=2000 AND translate(body->>'referralText',E'\t\n\r','')!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'phone') NOT IN ('string','null') OR body->>'phone' IS NOT NULL AND NOT (char_length(body->>'phone')<=512 AND char_length(body->>'phone')>=1 AND btrim(body->>'phone',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND body->>'phone'!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'email') NOT IN ('string','null') OR body->>'email' IS NOT NULL AND NOT (char_length(body->>'email')<=512 AND char_length(body->>'email')>=1 AND btrim(body->>'email',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND body->>'email'!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'requestedScope') NOT IN ('string','null') OR body->>'requestedScope' IS NOT NULL AND NOT (char_length(body->>'requestedScope')<=4000 AND translate(body->>'requestedScope',E'\t\n\r','')!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'availability') NOT IN ('string','null') OR body->>'availability' IS NOT NULL AND NOT (char_length(body->>'availability')<=4000 AND translate(body->>'availability',E'\t\n\r','')!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'estimatedCents') NOT IN ('string','null') OR body->>'estimatedCents' IS NOT NULL AND (body->>'estimatedCents'!~'^(0|[1-9][0-9]{0,18})$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF body->>'estimatedCents' IS NOT NULL AND (body->>'estimatedCents')::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'followUpAt') NOT IN ('string','null') OR body->>'followUpAt' IS NOT NULL AND body->>'followUpAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{6}Z$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  IF body->>'followUpAt' IS NOT NULL THEN
    BEGIN
      IF (body->>'followUpAt')::timestamptz<TIMESTAMPTZ '0001-01-01T00:00:00Z' OR (body->>'followUpAt')::timestamptz>=TIMESTAMPTZ '10000-01-01T00:00:00Z' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END;
  END IF;
  IF jsonb_typeof(body->'notes') NOT IN ('string','null') OR body->>'notes' IS NOT NULL AND NOT (char_length(body->>'notes')<=4000 AND translate(body->>'notes',E'\t\n\r','')!~'[[:cntrl:]]') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  BEGIN
    context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
    PERFORM crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_LEAD_READ_DENIED') THEN RETURN jsonb_build_object('state','denied'); END IF;RAISE;
  END;
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'leadId',requested_lead,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
  BEGIN
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.lead.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
    IF claimed IS NULL THEN
      SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
      IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
      command_result:=crest_private.lead_operation_result(requested_business,expected_actor,requested_operation);
    ELSE
      IF body->>'customerId' IS NOT NULL THEN
        PERFORM 1 FROM crest.customers WHERE business_id=requested_business AND id=(body->>'customerId')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_PARENT_CONFLICT'; END IF;
      END IF;
      source_value:=NULL;
      IF body->>'sourceId' IS NOT NULL THEN
        SELECT crest_private.lead_source_projection(c) INTO source_value FROM crest.lead_sources c WHERE business_id=requested_business AND id=(body->>'sourceId')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_PARENT_CONFLICT'; END IF;
      END IF;
      SELECT * INTO old_row FROM crest.leads WHERE business_id=requested_business AND id=requested_lead FOR UPDATE;
      IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_LEAD_VERSION_CONFLICT'; END IF;
      IF expected_version=0 THEN
        IF expected_version>0 AND old_row.source_id IS NOT DISTINCT FROM (body->>'sourceId')::uuid THEN source_value:=old_row.source_snapshot; END IF;
        INSERT INTO crest.leads(id,business_id,label,customer_id,source_id,referral_text,phone_raw,email_raw,requested_scope,availability,estimated_cents,follow_up_at,notes,source_snapshot,created_by,updated_by,origin,operation_id) VALUES(requested_lead,requested_business,body->>'label',(body->>'customerId')::uuid,(body->>'sourceId')::uuid,body->>'referralText',body->>'phone',body->>'email',body->>'requestedScope',body->>'availability',(body->>'estimatedCents')::bigint,(body->>'followUpAt')::timestamptz,body->>'notes',source_value,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
      ELSE
        IF expected_version>0 AND old_row.source_id IS NOT DISTINCT FROM (body->>'sourceId')::uuid THEN source_value:=old_row.source_snapshot; END IF;
        UPDATE crest.leads SET label=body->>'label',customer_id=(body->>'customerId')::uuid,source_id=(body->>'sourceId')::uuid,referral_text=body->>'referralText',phone_raw=body->>'phone',email_raw=body->>'email',requested_scope=body->>'requestedScope',availability=body->>'availability',estimated_cents=(body->>'estimatedCents')::bigint,follow_up_at=(body->>'followUpAt')::timestamptz,notes=body->>'notes',source_snapshot=source_value,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_lead RETURNING * INTO new_row;
      END IF;
      action:=CASE WHEN expected_version=0 THEN 'create' ELSE 'edit' END;
      INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'leads',requested_lead,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.lead_projection(old_row) END,'after',crest_private.lead_projection(new_row)),'manual') RETURNING id INTO event_id;
      command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadVersion',new_row.version::text,'auditEventId',event_id));
      UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
    END IF;
    PERFORM crest_commands.finish_lead_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
  EXCEPTION WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','parent');
    WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
    WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated='leads_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','lead'); END IF;RAISE;

  END;
END
$save$;

GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,delta) ON crest_private.audit_events TO crest_lead_integrity_owner;
CREATE POLICY lead_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_lead_integrity_owner USING(entity_kind='leads');
CREATE UNIQUE INDEX lead_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='leads';
CREATE FUNCTION crest_commands.lookup_lead_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  RETURN crest_private.lead_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_lead_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,search_text text,after_id uuid,include_lost boolean,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF search_text IS NULL OR char_length(search_text)>200 OR include_lost IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH matches AS MATERIALIZED(SELECT c.* FROM crest.leads c WHERE c.business_id=requested_business AND (include_lost OR c.state<>'lost') AND (after_id IS NULL OR c.id>after_id)
    AND (search_text='' OR strpos(lower(c.label),lower(search_text))>0 OR strpos(lower(c.phone_raw),lower(search_text))>0 OR strpos(lower(c.phone_normalized),lower(search_text))>0 OR strpos(lower(c.email_raw),lower(search_text))>0 OR strpos(lower(c.email_normalized),lower(search_text))>0 OR strpos(lower(c.referral_text),lower(search_text))>0 OR strpos(lower(c.requested_scope),lower(search_text))>0 OR strpos(lower(c.notes),lower(search_text))>0) ORDER BY c.id LIMIT page_limit+1),
    page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leads',coalesce((SELECT jsonb_agg(crest_private.lead_projection(p::crest.leads) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_PAGE_LIMIT'; END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_lead_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,after_version bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_lead IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH target AS MATERIALIZED(SELECT * FROM crest.leads WHERE business_id=requested_business AND id=requested_lead),
    events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='leads' AND entity_id=requested_lead AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
    page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
  SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'lead',(SELECT crest_private.lead_projection(t::crest.leads) FROM target t),
    'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_PAGE_LIMIT'; END IF;RETURN result;
END
$history$;

-- Separate privileged export caller; no ordinary web execute. It must receive
-- a recently authorized fixed business from the future whole-export job.
GRANT SELECT(id) ON crest.businesses TO crest_lead_owner;
CREATE POLICY lead_export_business ON crest.businesses FOR SELECT TO crest_lead_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.lead_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_SNAPSHOT_REQUIRED'; END IF;
  IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_INPUT_REQUIRED'; END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SCOPE_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM crest.leads WHERE business_id=requested_business;
  IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_SNAPSHOT_LIMIT'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','lead_directory','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead.directory.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.lead_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
  context:=crest_commands.lead_snapshot_context(requested_business);
  IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_SNAPSHOT_REQUIRED'; END IF;
  WITH page AS(SELECT * FROM crest.leads WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'leads',coalesce(jsonb_agg(crest_private.lead_projection(p::crest.leads) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_PAGE_LIMIT'; END IF;RETURN result;
END
$page$;
GRANT SELECT(id,business_id) ON crest.customers TO crest_lead_owner;
CREATE POLICY lead_customer_parent ON crest.customers FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
GRANT SELECT ON crest.lead_sources TO crest_lead_owner;
CREATE POLICY lead_source_parent ON crest.lead_sources FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
GRANT EXECUTE ON FUNCTION crest_private.lead_source_projection(crest.lead_sources) TO crest_lead_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_lead_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.authorize_lead_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_lead_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.lead_operation_result(uuid,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.save_lead(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lookup_lead_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_snapshot_context(uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_lead_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_lead_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.lead_operation_result(uuid,uuid,uuid),crest_commands.save_lead(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_lead_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_lead_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),crest_commands.lead_snapshot_context(uuid),crest_commands.lead_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_lead_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_lead_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_lead_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_lead(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_lead_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_lead_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_snapshot_context(uuid),crest_commands.lead_snapshot_page(uuid,text,uuid,integer) TO crest_export;
