-- ADR41: first real CRM directory. Synthetic development only; no provisioning.
-- Categories and dated customer associations require genuine later sources/commands.
DO $review$
DECLARE r oid; role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['crest_vehicle_owner','crest_vehicle_integrity_owner'] LOOP
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
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_VEHICLE_ROLE_REVIEW_REQUIRED';
  END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner') AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>5
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_VEHICLE_SOURCE_REVIEW_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.customers'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_VEHICLE_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_vehicle_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_vehicle_integrity_owner;
CREATE TABLE crest.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  label text NOT NULL CHECK(char_length(label)>=1 AND char_length(label)<=200 AND btrim(label,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND label!~'[[:cntrl:]]'),
  year integer,
  make text CHECK(make IS NULL OR char_length(make)>=1 AND char_length(make)<=200 AND btrim(make,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND make!~'[[:cntrl:]]'),
  model text CHECK(model IS NULL OR char_length(model)>=1 AND char_length(model)<=200 AND btrim(model,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND model!~'[[:cntrl:]]'),
  color text CHECK(color IS NULL OR char_length(color)>=1 AND char_length(color)<=128 AND btrim(color,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND color!~'[[:cntrl:]]'),
  vin_raw text CHECK(vin_raw IS NULL OR char_length(vin_raw)>=1 AND char_length(vin_raw)<=128 AND btrim(vin_raw,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND vin_raw!~'[[:cntrl:]]'),
  vin_normalized text GENERATED ALWAYS AS (nullif(translate(regexp_replace(vin_raw,'[^A-Za-z0-9]','','g'),'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'')) STORED,
  plate text CHECK(plate IS NULL OR char_length(plate)>=1 AND char_length(plate)<=128 AND btrim(plate,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND plate!~'[[:cntrl:]]'),
  kind text NOT NULL CHECK(kind IN ('customer_vehicle','business_rig','other')),
  notes text CHECK(notes IS NULL OR char_length(notes)<=2000 AND translate(notes,E'\t\n\r','')!~'[[:cntrl:]]'),
  archived_at timestamptz CHECK(archived_at IS NULL OR isfinite(archived_at)),
  archived_reason text CHECK(archived_reason IS NULL OR char_length(archived_reason)>=1 AND char_length(archived_reason)<=1000 AND btrim(archived_reason,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(archived_reason,E'\t\n\r','')!~'[[:cntrl:]]'),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL,updated_by uuid NOT NULL,origin text NOT NULL CHECK(origin IN ('manual','import','system')),
  operation_id uuid NOT NULL,import_row_id uuid,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
  CHECK((archived_at IS NULL)=(archived_reason IS NULL)),
  CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at)
);
CREATE INDEX vehicles_label ON crest.vehicles(business_id,label,id);
CREATE INDEX vehicles_vin_hint ON crest.vehicles(business_id,vin_normalized,id);
CREATE INDEX vehicles_creator ON crest.vehicles(business_id,created_by);
CREATE INDEX vehicles_updater ON crest.vehicles(business_id,updated_by);
CREATE INDEX vehicles_operation ON crest.vehicles(business_id,operation_id,updated_by);
GRANT USAGE ON TYPE crest.vehicles TO crest_vehicle_owner,crest_vehicle_integrity_owner;
ALTER TABLE crest.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.vehicles FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.vehicle_projection(c crest.vehicles) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $projection$
  SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'label',(c).label,'year',(c).year,'make',(c).make,'model',(c).model,'color',(c).color,'vin_raw',(c).vin_raw,'vin_normalized',(c).vin_normalized,'plate',(c).plate,'kind',(c).kind,'notes',(c).notes,'archived_at',to_char((c).archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_reason',(c).archived_reason,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$projection$;
REVOKE ALL ON FUNCTION crest_private.vehicle_projection(crest.vehicles) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.vehicle_projection(crest.vehicles) TO crest_vehicle_owner,crest_vehicle_integrity_owner;
CREATE FUNCTION crest_private.validate_vehicle_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' THEN
    -- Stored VIN search hints are computed after BEFORE triggers. Compare
    -- immutable provenance explicitly; never read NEW.vin_normalized here.
    IF ROW(NEW.id,NEW.business_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_VEHICLE_PROVENANCE';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_VERSION_CONFLICT'; END IF;
  ELSE
    IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_VERSION_CONFLICT'; END IF;
    NEW.created_at:=stamp;
  END IF;
  NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_vehicle_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by
    AND a.entity_kind='vehicles' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.vehicle_projection(NEW::crest.vehicles)
    AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.vehicle_projection(OLD::crest.vehicles) END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_AUDIT_REQUIRED';
  END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER vehicle_change BEFORE INSERT OR UPDATE ON crest.vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.validate_vehicle_change();
CREATE CONSTRAINT TRIGGER vehicle_audit AFTER INSERT OR UPDATE ON crest.vehicles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_vehicle_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.vehicles FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.vehicles TO crest_vehicle_owner;
GRANT INSERT(id,business_id,label,year,make,model,color,vin_raw,plate,kind,notes,archived_at,archived_reason,created_by,updated_by,origin,operation_id) ON crest.vehicles TO crest_vehicle_owner;
GRANT UPDATE(label,year,make,model,color,vin_raw,plate,kind,notes,archived_at,archived_reason,version,updated_at,updated_by,operation_id) ON crest.vehicles TO crest_vehicle_owner;
CREATE POLICY vehicle_read ON crest.vehicles FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY vehicle_create ON crest.vehicles FOR INSERT TO crest_vehicle_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY vehicle_edit ON crest.vehicles FOR UPDATE TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid)
  WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_vehicle_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_vehicle_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_vehicle_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_vehicle_owner;
CREATE POLICY vehicle_operations_read ON crest_private.operations FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.vehicle.save');
CREATE POLICY vehicle_operations_create ON crest_private.operations FOR INSERT TO crest_vehicle_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.vehicle.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY vehicle_operations_finish ON crest_private.operations FOR UPDATE TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.vehicle.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.vehicle.save');
CREATE POLICY vehicle_audits_read ON crest_private.audit_events FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='vehicles');
CREATE POLICY vehicle_audits_create ON crest_private.audit_events FOR INSERT TO crest_vehicle_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='vehicles' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_vehicle_integrity_owner;
ALTER FUNCTION crest_private.check_vehicle_audit() OWNER TO crest_vehicle_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_vehicle_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_vehicle_audit() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.authorize_vehicle_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
  context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_VEHICLE_READ_DENIED'; END IF;
  RETURN context;
END
$read$;
CREATE FUNCTION crest_commands.finish_vehicle_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
  PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_VEHICLE_SAVE_DENIED'; END IF;
END
$finish$;
CREATE FUNCTION crest_private.vehicle_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record; a record; after_row jsonb; before_row jsonb; body jsonb; expected_version text; receipt jsonb; digest text;
BEGIN
  SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND command_type='crm.vehicle.save';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  receipt:=o.result;
  IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt)<>'object' OR receipt-ARRAY['schemaVersion','businessId','vehicleId','vehicleVersion','auditEventId']<>'{}'::jsonb
    OR NOT receipt ?& ARRAY['schemaVersion','businessId','vehicleId','vehicleVersion','auditEventId'] OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId'<>requested_business::text
    OR jsonb_typeof(receipt->'vehicleVersion')<>'string' OR (receipt->>'vehicleVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_RESULT_REVIEW_REQUIRED'; END IF;
  SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'auditEventId')::uuid AND entity_kind='vehicles' AND entity_id=(receipt->>'vehicleId')::uuid AND entity_version=(receipt->>'vehicleVersion')::bigint;
  IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_RESULT_REVIEW_REQUIRED'; END IF;
  after_row:=a.delta->'after';before_row:=a.delta->'before';expected_version:=CASE WHEN before_row='null'::jsonb THEN '0' ELSE before_row->>'version' END;
  IF jsonb_typeof(after_row) IS DISTINCT FROM 'object' OR after_row-ARRAY['id','business_id','label','year','make','model','color','vin_raw','vin_normalized','plate','kind','notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT after_row ?& ARRAY['id','business_id','label','year','make','model','color','vin_raw','vin_normalized','plate','kind','notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR before_row IS NULL OR (before_row<>'null'::jsonb AND (jsonb_typeof(before_row) IS DISTINCT FROM 'object' OR before_row->>'id' IS DISTINCT FROM receipt->>'vehicleId')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_RESULT_REVIEW_REQUIRED'; END IF;
  body:=jsonb_build_object('label',after_row->'label','year',after_row->'year','make',after_row->'make','model',after_row->'model','color',after_row->'color','vin',after_row->'vin_raw','plate',after_row->'plate','kind',after_row->'kind','notes',after_row->'notes','archived',after_row->'archived_at'<>'null'::jsonb,'archiveReason',after_row->'archived_reason');
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.vehicle.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'vehicleId',receipt->'vehicleId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
  IF expected_version IS NULL OR (receipt->>'vehicleVersion')::bigint<>(expected_version::bigint)+1 OR after_row->>'id'<>receipt->>'vehicleId' OR after_row->>'business_id'<>requested_business::text OR after_row->>'operation_id'<>requested_operation::text OR after_row->>'updated_by'<>requested_actor::text OR after_row->>'version'<>receipt->>'vehicleVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_VEHICLE_RESULT_REVIEW_REQUIRED'; END IF;
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END
$result$;
CREATE FUNCTION crest_commands.save_vehicle(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_vehicle uuid,expected_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; existing record; old_row crest.vehicles; new_row crest.vehicles; event_id uuid; command_result jsonb; year_value integer; numeric_year numeric; archived boolean; action text; violated text;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL OR requested_vehicle IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR body IS NULL OR jsonb_typeof(body)<>'object'
    OR body-ARRAY['label','year','make','model','color','vin','plate','kind','notes','archived','archiveReason']<>'{}'::jsonb OR NOT body ?& ARRAY['label','year','make','model','color','vin','plate','kind','notes','archived','archiveReason'] OR octet_length(body::text)>32768
    OR jsonb_typeof(body->'label')<>'string' OR char_length(body->>'label')<1 OR char_length(body->>'label')>200 OR btrim(body->>'label',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR (body->>'label')~'[[:cntrl:]]'
    OR jsonb_typeof(body->'kind')<>'string' OR body->>'kind' NOT IN ('customer_vehicle','business_rig','other')
    OR jsonb_typeof(body->'archived')<>'boolean' OR jsonb_typeof(body->'archiveReason') NOT IN ('string','null') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'make') NOT IN ('string','null') OR char_length(body->>'make')> 200 OR btrim(body->>'make',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR (body->>'make')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'model') NOT IN ('string','null') OR char_length(body->>'model')> 200 OR btrim(body->>'model',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR (body->>'model')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'color') NOT IN ('string','null') OR char_length(body->>'color')> 128 OR btrim(body->>'color',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR (body->>'color')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'vin') NOT IN ('string','null') OR char_length(body->>'vin')> 128 OR btrim(body->>'vin',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR (body->>'vin')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'plate') NOT IN ('string','null') OR char_length(body->>'plate')> 128 OR btrim(body->>'plate',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR (body->>'plate')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'notes') NOT IN ('string','null') OR char_length(body->>'notes')>2000 OR translate(body->>'notes',E'\t\n\r','')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  archived:=(body->>'archived')::boolean;
  IF archived AND (body->>'archiveReason' IS NULL OR char_length(body->>'archiveReason')<1 OR char_length(body->>'archiveReason')>1000 OR btrim(body->>'archiveReason',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR translate(body->>'archiveReason',E'\t\n\r','')~'[[:cntrl:]]') OR NOT archived AND body->'archiveReason'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'year') NOT IN ('number','null') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  IF body->>'year' IS NOT NULL THEN
    numeric_year:=(body->>'year')::numeric;
    IF numeric_year<>trunc(numeric_year) OR numeric_year < -2147483648 OR numeric_year>2147483647 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
    year_value:=numeric_year::integer;
  END IF;
  -- INTEGER semantics: canonicalize equivalent JSON numeric spellings only.
  -- Preserve unusual years; plausibility is advisory, never a save prohibition.
  body:=body||jsonb_build_object('year',year_value);
  BEGIN
    context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
    PERFORM crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_VEHICLE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied'); END IF;RAISE;
  END;
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.vehicle.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'vehicleId',requested_vehicle,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
  BEGIN
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.vehicle.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
    IF claimed IS NULL THEN
      SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
      IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
      command_result:=crest_private.vehicle_operation_result(requested_business,expected_actor,requested_operation);
    ELSE
      SELECT * INTO old_row FROM crest.vehicles WHERE business_id=requested_business AND id=requested_vehicle FOR UPDATE;
      IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_VEHICLE_VERSION_CONFLICT'; END IF;
      IF expected_version=0 THEN
        INSERT INTO crest.vehicles(id,business_id,label,year,make,model,color,vin_raw,plate,kind,notes,archived_at,archived_reason,created_by,updated_by,origin,operation_id) VALUES(requested_vehicle,requested_business,body->>'label',year_value,body->>'make',body->>'model',body->>'color',body->>'vin',body->>'plate',body->>'kind',body->>'notes',CASE WHEN archived THEN clock_timestamp() END,body->>'archiveReason',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
      ELSE
        UPDATE crest.vehicles SET label=body->>'label',year=year_value,make=body->>'make',model=body->>'model',color=body->>'color',vin_raw=body->>'vin',plate=body->>'plate',kind=body->>'kind',notes=body->>'notes',archived_at=CASE WHEN archived THEN coalesce(archived_at,clock_timestamp()) END,archived_reason=body->>'archiveReason',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_vehicle RETURNING * INTO new_row;
      END IF;
      action:=CASE WHEN expected_version=0 THEN 'create' WHEN archived AND old_row.archived_at IS NULL THEN 'archive' WHEN NOT archived AND old_row.archived_at IS NOT NULL THEN 'reopen' ELSE 'edit' END;
      INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'vehicles',requested_vehicle,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.vehicle_projection(old_row) END,'after',crest_private.vehicle_projection(new_row)),'manual') RETURNING id INTO event_id;
      command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'vehicleId',requested_vehicle,'vehicleVersion',new_row.version::text,'auditEventId',event_id));
      UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
    END IF;
    PERFORM crest_commands.finish_vehicle_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
    WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated='vehicles_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','vehicle'); END IF;RAISE;

  END;
END
$save$;

GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,delta) ON crest_private.audit_events TO crest_vehicle_integrity_owner;
CREATE POLICY vehicle_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_vehicle_integrity_owner USING(entity_kind='vehicles');
CREATE UNIQUE INDEX vehicle_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='vehicles';
CREATE FUNCTION crest_commands.lookup_vehicle_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  RETURN crest_private.vehicle_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_vehicle_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,search_text text,after_id uuid,include_archived boolean,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF search_text IS NULL OR char_length(search_text)>200 OR include_archived IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH matches AS MATERIALIZED(SELECT c.* FROM crest.vehicles c WHERE c.business_id=requested_business AND (include_archived OR c.archived_at IS NULL) AND (after_id IS NULL OR c.id>after_id)
    AND (search_text='' OR strpos(lower(c.label),lower(search_text))>0 OR strpos(lower(c.make),lower(search_text))>0 OR strpos(lower(c.model),lower(search_text))>0 OR strpos(lower(c.color),lower(search_text))>0 OR strpos(lower(c.vin_raw),lower(search_text))>0 OR strpos(lower(c.vin_normalized),lower(search_text))>0 OR strpos(lower(c.plate),lower(search_text))>0 OR strpos(lower(c.kind),lower(search_text))>0 OR strpos(lower(c.notes),lower(search_text))>0) ORDER BY c.id LIMIT page_limit+1),
    page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'vehicles',coalesce((SELECT jsonb_agg(crest_private.vehicle_projection(p::crest.vehicles) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_VEHICLE_PAGE_LIMIT'; END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_vehicle_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_vehicle uuid,after_version bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_vehicle IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH target AS MATERIALIZED(SELECT * FROM crest.vehicles WHERE business_id=requested_business AND id=requested_vehicle),
    events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='vehicles' AND entity_id=requested_vehicle AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
    page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
  SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'vehicle',(SELECT crest_private.vehicle_projection(t::crest.vehicles) FROM target t),
    'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_VEHICLE_PAGE_LIMIT'; END IF;RETURN result;
END
$history$;

-- Separate privileged export caller; no ordinary web execute. It must receive
-- a recently authorized fixed business from the future whole-export job.
GRANT SELECT(id) ON crest.businesses TO crest_vehicle_owner;
CREATE POLICY vehicle_export_business ON crest.businesses FOR SELECT TO crest_vehicle_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.vehicle_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_VEHICLE_SNAPSHOT_REQUIRED'; END IF;
  IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_INPUT_REQUIRED'; END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_SCOPE_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM crest.vehicles WHERE business_id=requested_business;
  IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_VEHICLE_SNAPSHOT_LIMIT'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','vehicle_directory','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.vehicle.directory.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.vehicle_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
  context:=crest_commands.vehicle_snapshot_context(requested_business);
  IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_VEHICLE_SNAPSHOT_REQUIRED'; END IF;
  WITH page AS(SELECT * FROM crest.vehicles WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'vehicles',coalesce(jsonb_agg(crest_private.vehicle_projection(p::crest.vehicles) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_VEHICLE_PAGE_LIMIT'; END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_vehicle_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.authorize_vehicle_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_vehicle_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.vehicle_operation_result(uuid,uuid,uuid) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.save_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.lookup_vehicle_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.read_vehicle_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.read_vehicle_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.vehicle_snapshot_context(uuid) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.vehicle_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_vehicle_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_vehicle_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_vehicle_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_vehicle_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_vehicle_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.vehicle_operation_result(uuid,uuid,uuid),crest_commands.save_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_vehicle_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_vehicle_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_vehicle_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),crest_commands.vehicle_snapshot_context(uuid),crest_commands.vehicle_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_vehicle_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_vehicle_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_vehicle_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_vehicle_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_vehicle_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_vehicle_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.vehicle_snapshot_context(uuid),crest_commands.vehicle_snapshot_page(uuid,text,uuid,integer) TO crest_export;
