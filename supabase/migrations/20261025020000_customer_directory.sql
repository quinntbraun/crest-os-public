-- ADR41: first real CRM directory. Synthetic development only; no provisioning.
-- Missing source/lead/vehicle/address workflows are explicit future migrations.
DO $review$
DECLARE r oid; role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['crest_customer_owner','crest_customer_integrity_owner'] LOOP
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
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_ROLE_REVIEW_REQUIRED';
  END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner') AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_SOURCE_REVIEW_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_customer_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_customer_integrity_owner;
CREATE TABLE crest.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK(char_length(display_name) BETWEEN 1 AND 200 AND btrim(display_name)<>'' AND display_name!~'[[:cntrl:]]'),
  phone_raw text CHECK(phone_raw IS NULL OR char_length(phone_raw)<=512 AND btrim(phone_raw)<>'' AND phone_raw!~'[[:cntrl:]]'),
  phone_normalized text GENERATED ALWAYS AS (nullif(regexp_replace(phone_raw,'[^0-9]','','g'),'')) STORED,
  email_raw text CHECK(email_raw IS NULL OR char_length(email_raw)<=512 AND btrim(email_raw)<>'' AND email_raw!~'[[:cntrl:]]'),
  email_normalized text GENERATED ALWAYS AS (nullif(lower(btrim(email_raw)),'')) STORED,
  contact_preference text CHECK(contact_preference IS NULL OR char_length(contact_preference)<=200 AND contact_preference!~'[[:cntrl:]]'),
  outreach_opt_out boolean NOT NULL DEFAULT false,
  notes text CHECK(notes IS NULL OR char_length(notes)<=2000 AND translate(notes,E'\t\n\r','')!~'[[:cntrl:]]'),
  customer_since date CHECK(customer_since IS NULL OR isfinite(customer_since) AND customer_since BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  archived_at timestamptz CHECK(archived_at IS NULL OR isfinite(archived_at)),
  archived_reason text CHECK(archived_reason IS NULL OR char_length(archived_reason) BETWEEN 1 AND 1000 AND btrim(archived_reason)<>'' AND translate(archived_reason,E'\t\n\r','')!~'[[:cntrl:]]'),
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
  CHECK((archived_at IS NULL)=(archived_reason IS NULL)),
  CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at)
);
CREATE INDEX customers_name ON crest.customers(business_id,lower(display_name),id);
CREATE INDEX customers_phone ON crest.customers(business_id,phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX customers_email ON crest.customers(business_id,email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX customers_creator ON crest.customers(business_id,created_by);
CREATE INDEX customers_updater ON crest.customers(business_id,updated_by);
CREATE INDEX customers_operation ON crest.customers(business_id,operation_id,updated_by);
GRANT USAGE ON TYPE crest.customers TO crest_customer_owner,crest_customer_integrity_owner;
ALTER TABLE crest.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.customers FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.customer_projection(c crest.customers) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $projection$
  SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'display_name',(c).display_name,'phone_raw',(c).phone_raw,'phone_normalized',(c).phone_normalized,
    'email_raw',(c).email_raw,'email_normalized',(c).email_normalized,'contact_preference',(c).contact_preference,'outreach_opt_out',(c).outreach_opt_out,
    'notes',(c).notes,'customer_since',to_char((c).customer_since,'YYYY-MM-DD'),'archived_at',to_char((c).archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'archived_reason',(c).archived_reason,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,
    'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$projection$;
REVOKE ALL ON FUNCTION crest_private.customer_projection(crest.customers) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.customer_projection(crest.customers) TO crest_customer_owner,crest_customer_integrity_owner;
CREATE FUNCTION crest_private.validate_customer_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['display_name','phone_raw','phone_normalized','email_raw','email_normalized','contact_preference','outreach_opt_out','notes','customer_since','archived_at','archived_reason','version','updated_at','updated_by','operation_id'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['display_name','phone_raw','phone_normalized','email_raw','email_normalized','contact_preference','outreach_opt_out','notes','customer_since','archived_at','archived_reason','version','updated_at','updated_by','operation_id']) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_CUSTOMER_PROVENANCE';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTOMER_VERSION_CONFLICT'; END IF;
  ELSE
    IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTOMER_VERSION_CONFLICT'; END IF;
    NEW.created_at:=stamp;
  END IF;
  NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_customer_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by
    AND a.entity_kind='customers' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.customer_projection(NEW::crest.customers)
    AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.customer_projection(OLD::crest.customers) END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTOMER_AUDIT_REQUIRED';
  END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER customer_change BEFORE INSERT OR UPDATE ON crest.customers FOR EACH ROW EXECUTE FUNCTION crest_private.validate_customer_change();
CREATE CONSTRAINT TRIGGER customer_audit AFTER INSERT OR UPDATE ON crest.customers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_customer_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.customers FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.customers FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.customers TO crest_customer_owner;
GRANT INSERT(id,business_id,display_name,phone_raw,email_raw,contact_preference,outreach_opt_out,notes,customer_since,archived_at,archived_reason,created_by,updated_by,origin,operation_id) ON crest.customers TO crest_customer_owner;
GRANT UPDATE(display_name,phone_raw,email_raw,contact_preference,outreach_opt_out,notes,customer_since,archived_at,archived_reason,version,updated_by,operation_id) ON crest.customers TO crest_customer_owner;
CREATE POLICY customer_read ON crest.customers FOR SELECT TO crest_customer_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY customer_create ON crest.customers FOR INSERT TO crest_customer_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY customer_edit ON crest.customers FOR UPDATE TO crest_customer_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid)
  WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_customer_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_customer_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_customer_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_customer_owner;
CREATE POLICY customer_operations_read ON crest_private.operations FOR SELECT TO crest_customer_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.customer.save');
CREATE POLICY customer_operations_create ON crest_private.operations FOR INSERT TO crest_customer_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.customer.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY customer_operations_finish ON crest_private.operations FOR UPDATE TO crest_customer_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.customer.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.customer.save');
CREATE POLICY customer_audits_read ON crest_private.audit_events FOR SELECT TO crest_customer_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='customers');
CREATE POLICY customer_audits_create ON crest_private.audit_events FOR INSERT TO crest_customer_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='customers' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
ALTER FUNCTION crest_private.check_customer_audit() OWNER TO crest_customer_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_customer_audit() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.authorize_customer_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
  context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_READ_DENIED'; END IF;
  RETURN context;
END
$read$;
CREATE FUNCTION crest_commands.finish_customer_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
  PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTOMER_SAVE_DENIED'; END IF;
END
$finish$;
CREATE FUNCTION crest_private.customer_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record; a record; after_row jsonb; before_row jsonb; body jsonb; expected_version text; receipt jsonb; digest text;
BEGIN
  SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND command_type='crm.customer.save';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  receipt:=o.result;
  IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt)<>'object' OR receipt-ARRAY['schemaVersion','businessId','customerId','customerVersion','auditEventId']<>'{}'::jsonb
    OR NOT receipt ?& ARRAY['schemaVersion','businessId','customerId','customerVersion','auditEventId'] OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId'<>requested_business::text
    OR jsonb_typeof(receipt->'customerVersion')<>'string' OR (receipt->>'customerVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTOMER_RESULT_REVIEW_REQUIRED'; END IF;
  SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'auditEventId')::uuid AND entity_kind='customers' AND entity_id=(receipt->>'customerId')::uuid AND entity_version=(receipt->>'customerVersion')::bigint;
  IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTOMER_RESULT_REVIEW_REQUIRED'; END IF;
  after_row:=a.delta->'after';before_row:=a.delta->'before';expected_version:=CASE WHEN before_row='null'::jsonb THEN '0' ELSE before_row->>'version' END;
  body:=jsonb_build_object('displayName',after_row->'display_name','phone',after_row->'phone_raw','email',after_row->'email_raw','contactPreference',after_row->'contact_preference','outreachOptOut',after_row->'outreach_opt_out','notes',after_row->'notes','customerSince',after_row->'customer_since','archived',after_row->'archived_at'<>'null'::jsonb,'archiveReason',after_row->'archived_reason');
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.customer.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'customerId',receipt->'customerId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
  IF expected_version IS NULL OR (receipt->>'customerVersion')::bigint<>(expected_version::bigint)+1 OR after_row->>'id'<>receipt->>'customerId' OR after_row->>'business_id'<>requested_business::text OR after_row->>'operation_id'<>requested_operation::text OR after_row->>'updated_by'<>requested_actor::text OR after_row->>'version'<>receipt->>'customerVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTOMER_RESULT_REVIEW_REQUIRED'; END IF;
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END
$result$;
CREATE FUNCTION crest_commands.save_customer(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_customer uuid,expected_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; existing record; old_row crest.customers; new_row crest.customers; event_id uuid; command_result jsonb; since_date date; archived boolean; action text; violated text;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL OR requested_customer IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR body IS NULL OR jsonb_typeof(body)<>'object'
    OR body-ARRAY['displayName','phone','email','contactPreference','outreachOptOut','notes','customerSince','archived','archiveReason']<>'{}'::jsonb
    OR NOT body ?& ARRAY['displayName','phone','email','contactPreference','outreachOptOut','notes','customerSince','archived','archiveReason']
    OR jsonb_typeof(body->'displayName')<>'string' OR char_length(body->>'displayName') NOT BETWEEN 1 AND 200 OR btrim(body->>'displayName')=''
    OR jsonb_typeof(body->'outreachOptOut')<>'boolean' OR jsonb_typeof(body->'archived')<>'boolean'
    OR EXISTS(SELECT 1 FROM jsonb_each(body) WHERE key IN ('phone','email','contactPreference','notes','customerSince','archiveReason') AND jsonb_typeof(value) NOT IN ('null','string'))
    OR char_length(body->>'phone')>512 OR char_length(body->>'email')>512 OR btrim(body->>'phone')='' OR btrim(body->>'email')=''
    OR (body->>'displayName')~'[[:cntrl:]]' OR (body->>'phone')~'[[:cntrl:]]' OR (body->>'email')~'[[:cntrl:]]' OR (body->>'contactPreference')~'[[:cntrl:]]'
    OR translate(body->>'notes',E'\t\n\r','')~'[[:cntrl:]]' OR translate(body->>'archiveReason',E'\t\n\r','')~'[[:cntrl:]]'
    OR char_length(body->>'contactPreference')>200 OR char_length(body->>'notes')>2000 OR octet_length(body::text)>32768 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END IF;
  archived:=(body->>'archived')::boolean;
  IF archived AND (body->>'archiveReason' IS NULL OR char_length(body->>'archiveReason') NOT BETWEEN 1 AND 1000 OR btrim(body->>'archiveReason')='') OR NOT archived AND body->'archiveReason'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END IF;
  IF body->>'customerSince' IS NOT NULL THEN
    BEGIN
      IF (body->>'customerSince')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid'; END IF;
      since_date:=(body->>'customerSince')::date;
      IF since_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' THEN RAISE EXCEPTION 'invalid'; END IF;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END;
  END IF;
  BEGIN
    context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
    PERFORM crest_commands.authorize_customer_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_CUSTOMER_READ_DENIED') THEN RETURN jsonb_build_object('state','denied'); END IF;RAISE;
  END;
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.customer.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'customerId',requested_customer,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
  BEGIN
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.customer.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
    IF claimed IS NULL THEN
      SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
      IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
      command_result:=crest_private.customer_operation_result(requested_business,expected_actor,requested_operation);
    ELSE
      SELECT * INTO old_row FROM crest.customers WHERE business_id=requested_business AND id=requested_customer FOR UPDATE;
      IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_CUSTOMER_VERSION_CONFLICT'; END IF;
      IF expected_version=0 THEN
        INSERT INTO crest.customers(id,business_id,display_name,phone_raw,email_raw,contact_preference,outreach_opt_out,notes,customer_since,archived_at,archived_reason,created_by,updated_by,origin,operation_id)
          VALUES(requested_customer,requested_business,body->>'displayName',body->>'phone',body->>'email',body->>'contactPreference',(body->>'outreachOptOut')::boolean,body->>'notes',since_date,CASE WHEN archived THEN clock_timestamp() END,body->>'archiveReason',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
      ELSE
        UPDATE crest.customers SET display_name=body->>'displayName',phone_raw=body->>'phone',email_raw=body->>'email',contact_preference=body->>'contactPreference',outreach_opt_out=(body->>'outreachOptOut')::boolean,notes=body->>'notes',customer_since=since_date,archived_at=CASE WHEN archived THEN coalesce(archived_at,clock_timestamp()) END,archived_reason=body->>'archiveReason',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_customer RETURNING * INTO new_row;
      END IF;
      action:=CASE WHEN expected_version=0 THEN 'create' WHEN archived AND old_row.archived_at IS NULL THEN 'archive' WHEN NOT archived AND old_row.archived_at IS NOT NULL THEN 'reopen' ELSE 'edit' END;
      INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'customers',requested_customer,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.customer_projection(old_row) END,'after',crest_private.customer_projection(new_row)),'manual') RETURNING id INTO event_id;
      command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_customer,'customerVersion',new_row.version::text,'auditEventId',event_id));
      UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
    END IF;
    PERFORM crest_commands.finish_customer_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
    WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated='customers_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','customer'); END IF;RAISE;
  END;
END
$save$;

GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,delta) ON crest_private.audit_events TO crest_customer_integrity_owner;
CREATE POLICY customer_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_customer_integrity_owner USING(entity_kind='customers');
CREATE UNIQUE INDEX customer_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='customers';
CREATE FUNCTION crest_commands.lookup_customer_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_customer_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  RETURN crest_private.customer_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_customer_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,search_text text,after_id uuid,include_archived boolean,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb; digits text;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF search_text IS NULL OR char_length(search_text)>200 OR include_archived IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_customer_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  digits:=CASE WHEN search_text!~'[[:alpha:]]' THEN nullif(regexp_replace(search_text,'[^0-9]','','g'),'') END;
  WITH matches AS MATERIALIZED(SELECT c.* FROM crest.customers c WHERE c.business_id=requested_business AND (include_archived OR c.archived_at IS NULL) AND (after_id IS NULL OR c.id>after_id)
    AND (search_text='' OR strpos(lower(c.display_name),lower(search_text))>0 OR strpos(c.email_normalized,lower(search_text))>0 OR strpos(lower(c.phone_raw),lower(search_text))>0 OR digits IS NOT NULL AND strpos(c.phone_normalized,digits)>0) ORDER BY c.id LIMIT page_limit+1),
    page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customers',coalesce((SELECT jsonb_agg(crest_private.customer_projection(p::crest.customers) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CUSTOMER_PAGE_LIMIT'; END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_customer_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_customer uuid,after_version bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_customer IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_customer_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH target AS MATERIALIZED(SELECT * FROM crest.customers WHERE business_id=requested_business AND id=requested_customer),
    events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='customers' AND entity_id=requested_customer AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
    page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
  SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customer',(SELECT crest_private.customer_projection(t::crest.customers) FROM target t),
    'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CUSTOMER_PAGE_LIMIT'; END IF;RETURN result;
END
$history$;

-- Separate privileged export caller; no ordinary web execute. It must receive
-- a recently authorized fixed business from the future whole-export job.
GRANT SELECT(id) ON crest.businesses TO crest_customer_owner;
CREATE POLICY customer_export_business ON crest.businesses FOR SELECT TO crest_customer_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.customer_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CUSTOMER_SNAPSHOT_REQUIRED'; END IF;
  IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_INPUT_REQUIRED'; END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_SCOPE_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM crest.customers WHERE business_id=requested_business;
  IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CUSTOMER_SNAPSHOT_LIMIT'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','customer_directory','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.customer.directory.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.customer_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
  context:=crest_commands.customer_snapshot_context(requested_business);
  IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTOMER_SNAPSHOT_REQUIRED'; END IF;
  WITH page AS(SELECT * FROM crest.customers WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'customers',coalesce(jsonb_agg(crest_private.customer_projection(p::crest.customers) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CUSTOMER_PAGE_LIMIT'; END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_customer_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_customer_owner;
ALTER FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_customer_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.customer_operation_result(uuid,uuid,uuid) OWNER TO crest_customer_owner;
ALTER FUNCTION crest_commands.save_customer(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_customer_owner;
ALTER FUNCTION crest_commands.lookup_customer_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_customer_owner;
ALTER FUNCTION crest_commands.read_customer_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer) OWNER TO crest_customer_owner;
ALTER FUNCTION crest_commands.read_customer_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_customer_owner;
ALTER FUNCTION crest_commands.customer_snapshot_context(uuid) OWNER TO crest_customer_owner;
ALTER FUNCTION crest_commands.customer_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_customer_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_customer_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_customer_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_customer_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.customer_operation_result(uuid,uuid,uuid),crest_commands.save_customer(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_customer_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_customer_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_customer_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),crest_commands.customer_snapshot_context(uuid),crest_commands.customer_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_customer_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_customer_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_customer(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_customer_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_customer_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_customer_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.customer_snapshot_context(uuid),crest_commands.customer_snapshot_page(uuid,text,uuid,integer) TO crest_export;
