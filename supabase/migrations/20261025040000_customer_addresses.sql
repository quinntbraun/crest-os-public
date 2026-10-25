-- ADR41: first real CRM directory. Synthetic development only; no provisioning.
-- Missing source/lead/vehicle/address workflows are explicit future migrations.
DO $review$
DECLARE r oid; role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['crest_address_owner','crest_address_integrity_owner'] LOOP
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
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ADDRESS_ROLE_REVIEW_REQUIRED';
  END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner') AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>5
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN ('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_customer_owner','crest_customer_integrity_owner')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ADDRESS_SOURCE_REVIEW_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.customers'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ADDRESS_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_address_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_address_integrity_owner;
CREATE TABLE crest.addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  line1 text CHECK(line1 IS NULL OR char_length(line1)<=512 AND line1!~'[[:cntrl:]]'),
  line2 text CHECK(line2 IS NULL OR char_length(line2)<=512 AND line2!~'[[:cntrl:]]'),
  city text CHECK(city IS NULL OR char_length(city)<=200 AND city!~'[[:cntrl:]]'),
  region text CHECK(region IS NULL OR char_length(region)<=200 AND region!~'[[:cntrl:]]'),
  postal_code text CHECK(postal_code IS NULL OR char_length(postal_code)<=128 AND postal_code!~'[[:cntrl:]]'),
  country text CHECK(country IS NULL OR char_length(country)<=200 AND country!~'[[:cntrl:]]'),
  exact_location_text text CHECK(exact_location_text IS NULL OR char_length(exact_location_text)<=2000 AND translate(exact_location_text,E'\t\n\r','')!~'[[:cntrl:]]'),
  instructions text CHECK(instructions IS NULL OR char_length(instructions)<=2000 AND translate(instructions,E'\t\n\r','')!~'[[:cntrl:]]'),
  geocode_source text CHECK(geocode_source IS NULL OR char_length(geocode_source)<=200 AND geocode_source!~'[[:cntrl:]]'),
  geocode_accuracy text CHECK(geocode_accuracy IS NULL OR char_length(geocode_accuracy)<=200 AND geocode_accuracy!~'[[:cntrl:]]'),
  latitude numeric CHECK(latitude IS NULL OR latitude>=-90 AND latitude<=90 AND char_length(latitude::text)<=128),
  longitude numeric CHECK(longitude IS NULL OR longitude>=-180 AND longitude<=180 AND char_length(longitude::text)<=128),
  verified_at timestamptz CHECK(verified_at IS NULL OR isfinite(verified_at) AND verified_at>=TIMESTAMPTZ '0001-01-01 00:00:00+00' AND verified_at<TIMESTAMPTZ '10000-01-01 00:00:00+00'),
  archived_at timestamptz CHECK(archived_at IS NULL OR isfinite(archived_at)),
  archived_reason text CHECK(archived_reason IS NULL OR char_length(archived_reason)>=1 AND char_length(archived_reason)<=1000 AND btrim(archived_reason)<>'' AND translate(archived_reason,E'\t\n\r','')!~'[[:cntrl:]]'),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, origin text NOT NULL CHECK(origin IN ('manual','import','system')),
  operation_id uuid NOT NULL, import_row_id uuid,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
  CHECK((latitude IS NULL)=(longitude IS NULL)), CHECK((archived_at IS NULL)=(archived_reason IS NULL)),
  CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at)
);
CREATE INDEX addresses_customer ON crest.addresses(business_id,customer_id,id);
CREATE INDEX addresses_creator ON crest.addresses(business_id,created_by);
CREATE INDEX addresses_updater ON crest.addresses(business_id,updated_by);
CREATE INDEX addresses_operation ON crest.addresses(business_id,operation_id,updated_by);
GRANT USAGE ON TYPE crest.addresses TO crest_address_owner,crest_address_integrity_owner;
ALTER TABLE crest.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.addresses FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.address_projection(c crest.addresses) RETURNS jsonb LANGUAGE sql IMMUTABLE
SET search_path=pg_catalog,pg_temp AS $projection$
  SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'customer_id',(c).customer_id,'line1',(c).line1,'line2',(c).line2,'city',(c).city,'region',(c).region,'postal_code',(c).postal_code,'country',(c).country,'exact_location_text',(c).exact_location_text,'instructions',(c).instructions,'geocode_source',(c).geocode_source,'geocode_accuracy',(c).geocode_accuracy,'latitude',(c).latitude::text,'longitude',(c).longitude::text,'verified_at',to_char((c).verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_at',to_char((c).archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_reason',(c).archived_reason,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$projection$;
REVOKE ALL ON FUNCTION crest_private.address_projection(crest.addresses) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.address_projection(crest.addresses) TO crest_address_owner,crest_address_integrity_owner;
CREATE FUNCTION crest_private.validate_address_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','updated_at','updated_by','operation_id'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','updated_at','updated_by','operation_id']) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_ADDRESS_PROVENANCE';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_VERSION_CONFLICT'; END IF;
  ELSE
    IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_VERSION_CONFLICT'; END IF;
    NEW.created_at:=stamp;
  END IF;
  NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_address_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by
    AND a.entity_kind='addresses' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.address_projection(NEW::crest.addresses)
    AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.address_projection(OLD::crest.addresses) END) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_AUDIT_REQUIRED';
  END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER address_change BEFORE INSERT OR UPDATE ON crest.addresses FOR EACH ROW EXECUTE FUNCTION crest_private.validate_address_change();
CREATE CONSTRAINT TRIGGER address_audit AFTER INSERT OR UPDATE ON crest.addresses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_address_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.addresses FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.addresses FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.addresses TO crest_address_owner;
GRANT INSERT(id,business_id,customer_id,line1,line2,city,region,postal_code,country,exact_location_text,instructions,geocode_source,geocode_accuracy,latitude,longitude,verified_at,archived_at,archived_reason,created_by,updated_by,origin,operation_id) ON crest.addresses TO crest_address_owner;
GRANT UPDATE(line1,line2,city,region,postal_code,country,exact_location_text,instructions,geocode_source,geocode_accuracy,latitude,longitude,verified_at,archived_at,archived_reason,version,updated_by,operation_id) ON crest.addresses TO crest_address_owner;
CREATE POLICY address_read ON crest.addresses FOR SELECT TO crest_address_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY address_create ON crest.addresses FOR INSERT TO crest_address_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY address_edit ON crest.addresses FOR UPDATE TO crest_address_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid)
  WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_address_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_address_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_address_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_address_owner;
CREATE POLICY address_operations_read ON crest_private.operations FOR SELECT TO crest_address_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.address.save');
CREATE POLICY address_operations_create ON crest_private.operations FOR INSERT TO crest_address_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.address.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY address_operations_finish ON crest_private.operations FOR UPDATE TO crest_address_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.address.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.address.save');
CREATE POLICY address_audits_read ON crest_private.audit_events FOR SELECT TO crest_address_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='addresses');
CREATE POLICY address_audits_create ON crest_private.audit_events FOR INSERT TO crest_address_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='addresses' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_address_integrity_owner;
ALTER FUNCTION crest_private.check_address_audit() OWNER TO crest_address_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_address_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_address_audit() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.authorize_address_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
  context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ADDRESS_READ_DENIED'; END IF;
  RETURN context;
END
$read$;
CREATE FUNCTION crest_commands.finish_address_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
  PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ADDRESS_SAVE_DENIED'; END IF;
END
$finish$;
CREATE FUNCTION crest_private.address_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record; a record; after_row jsonb; before_row jsonb; body jsonb; expected_version text; receipt jsonb; digest text;
BEGIN
  SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND command_type='crm.address.save';
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  receipt:=o.result;
  IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt)<>'object' OR receipt-ARRAY['schemaVersion','businessId','customerId','addressId','addressVersion','auditEventId']<>'{}'::jsonb
    OR NOT receipt ?& ARRAY['schemaVersion','businessId','customerId','addressId','addressVersion','auditEventId'] OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId'<>requested_business::text
    OR jsonb_typeof(receipt->'addressVersion')<>'string' OR (receipt->>'addressVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_RESULT_REVIEW_REQUIRED'; END IF;
  SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'auditEventId')::uuid AND entity_kind='addresses' AND entity_id=(receipt->>'addressId')::uuid AND entity_version=(receipt->>'addressVersion')::bigint;
  IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_RESULT_REVIEW_REQUIRED'; END IF;
  after_row:=a.delta->'after';before_row:=a.delta->'before';expected_version:=CASE WHEN before_row='null'::jsonb THEN '0' ELSE before_row->>'version' END;
  IF jsonb_typeof(after_row) IS DISTINCT FROM 'object' OR after_row-ARRAY['id','business_id','customer_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT after_row ?& ARRAY['id','business_id','customer_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR before_row IS NULL OR (before_row<>'null'::jsonb AND (jsonb_typeof(before_row) IS DISTINCT FROM 'object' OR before_row->>'id' IS DISTINCT FROM receipt->>'addressId' OR before_row->>'customer_id' IS DISTINCT FROM receipt->>'customerId')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_RESULT_REVIEW_REQUIRED'; END IF;
  body:=jsonb_build_object('line1',after_row->'line1','line2',after_row->'line2','city',after_row->'city','region',after_row->'region','postalCode',after_row->'postal_code','country',after_row->'country','exactLocationText',after_row->'exact_location_text','instructions',after_row->'instructions','geocodeSource',after_row->'geocode_source','geocodeAccuracy',after_row->'geocode_accuracy','latitude',after_row->'latitude','longitude',after_row->'longitude','verifiedAt',after_row->'verified_at','archived',after_row->'archived_at'<>'null'::jsonb,'archiveReason',after_row->'archived_reason');
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.address.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'customerId',receipt->'customerId','addressId',receipt->'addressId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
  IF expected_version IS NULL OR (receipt->>'addressVersion')::bigint<>(expected_version::bigint)+1 OR after_row->>'customer_id' IS DISTINCT FROM receipt->>'customerId' OR after_row->>'id'<>receipt->>'addressId' OR after_row->>'business_id'<>requested_business::text OR after_row->>'operation_id'<>requested_operation::text OR after_row->>'updated_by'<>requested_actor::text OR after_row->>'version'<>receipt->>'addressVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ADDRESS_RESULT_REVIEW_REQUIRED'; END IF;
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END
$result$;
CREATE FUNCTION crest_commands.save_address(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_address uuid,requested_parent uuid,expected_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; existing record; old_row crest.addresses; new_row crest.addresses; event_id uuid; command_result jsonb; latitude_value numeric; longitude_value numeric; verified_value timestamptz; archived boolean; action text; violated text;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL OR requested_address IS NULL OR requested_parent IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR body IS NULL OR jsonb_typeof(body)<>'object'
    OR body-ARRAY['line1','line2','city','region','postalCode','country','exactLocationText','instructions','geocodeSource','geocodeAccuracy','latitude','longitude','verifiedAt','archived','archiveReason']<>'{}'::jsonb OR NOT body ?& ARRAY['line1','line2','city','region','postalCode','country','exactLocationText','instructions','geocodeSource','geocodeAccuracy','latitude','longitude','verifiedAt','archived','archiveReason'] OR octet_length(body::text)>32768
    OR jsonb_typeof(body->'archived')<>'boolean' OR jsonb_typeof(body->'archiveReason') NOT IN ('string','null') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'line1') NOT IN ('string','null') OR char_length(body->>'line1')>512 OR (body->>'line1')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'line2') NOT IN ('string','null') OR char_length(body->>'line2')>512 OR (body->>'line2')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'city') NOT IN ('string','null') OR char_length(body->>'city')>200 OR (body->>'city')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'region') NOT IN ('string','null') OR char_length(body->>'region')>200 OR (body->>'region')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'postalCode') NOT IN ('string','null') OR char_length(body->>'postalCode')>128 OR (body->>'postalCode')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'country') NOT IN ('string','null') OR char_length(body->>'country')>200 OR (body->>'country')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'exactLocationText') NOT IN ('string','null') OR char_length(body->>'exactLocationText')>2000 OR translate(body->>'exactLocationText',E'\t\n\r','')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'instructions') NOT IN ('string','null') OR char_length(body->>'instructions')>2000 OR translate(body->>'instructions',E'\t\n\r','')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'geocodeSource') NOT IN ('string','null') OR char_length(body->>'geocodeSource')>200 OR (body->>'geocodeSource')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'geocodeAccuracy') NOT IN ('string','null') OR char_length(body->>'geocodeAccuracy')>200 OR (body->>'geocodeAccuracy')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  archived:=(body->>'archived')::boolean;
  IF archived AND (body->>'archiveReason' IS NULL OR char_length(body->>'archiveReason')<1 OR char_length(body->>'archiveReason')>1000 OR btrim(body->>'archiveReason')='' OR translate(body->>'archiveReason',E'\t\n\r','')~'[[:cntrl:]]') OR NOT archived AND body->'archiveReason'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF jsonb_typeof(body->'latitude') NOT IN ('string','null') OR jsonb_typeof(body->'longitude') NOT IN ('string','null') OR (body->'latitude'='null'::jsonb)<>(body->'longitude'='null'::jsonb) OR jsonb_typeof(body->'verifiedAt') NOT IN ('string','null') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  IF body->>'latitude' IS NOT NULL THEN
    IF char_length(body->>'latitude')>128 OR char_length(body->>'longitude')>128 OR (body->>'latitude')!~'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' OR (body->>'longitude')!~'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
    latitude_value:=(body->>'latitude')::numeric;longitude_value:=(body->>'longitude')::numeric;
    IF latitude_value < -90 OR latitude_value>90 OR longitude_value < -180 OR longitude_value>180 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  END IF;
  IF body->>'verifiedAt' IS NOT NULL THEN
    BEGIN
      IF (body->>'verifiedAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RAISE EXCEPTION 'invalid'; END IF;
      verified_value:=(body->>'verifiedAt')::timestamptz;
      IF NOT isfinite(verified_value) OR to_char(verified_value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>body->>'verifiedAt' THEN RAISE EXCEPTION 'invalid'; END IF;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END;
  END IF;
  -- NUMERIC has no signed zero. Keep its exact decimal scale, including zero,
  -- while canonicalizing only that sign before hashing/replay reconstruction.
  body:=body||jsonb_build_object('latitude',latitude_value::text,'longitude',longitude_value::text);
  BEGIN
    context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
    PERFORM crest_commands.authorize_address_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_ADDRESS_READ_DENIED') THEN RETURN jsonb_build_object('state','denied'); END IF;RAISE;
  END;
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.address.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'customerId',requested_parent,'addressId',requested_address,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
  BEGIN
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.address.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
    IF claimed IS NULL THEN
      SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
      IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
      command_result:=crest_private.address_operation_result(requested_business,expected_actor,requested_operation);
    ELSE
      SELECT * INTO old_row FROM crest.addresses WHERE business_id=requested_business AND id=requested_address AND customer_id=requested_parent FOR UPDATE;
      IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_ADDRESS_VERSION_CONFLICT'; END IF;
      IF expected_version=0 THEN
        INSERT INTO crest.addresses(id,business_id,customer_id,line1,line2,city,region,postal_code,country,exact_location_text,instructions,geocode_source,geocode_accuracy,latitude,longitude,verified_at,archived_at,archived_reason,created_by,updated_by,origin,operation_id) VALUES(requested_address,requested_business,requested_parent,body->>'line1',body->>'line2',body->>'city',body->>'region',body->>'postalCode',body->>'country',body->>'exactLocationText',body->>'instructions',body->>'geocodeSource',body->>'geocodeAccuracy',latitude_value,longitude_value,verified_value,CASE WHEN archived THEN clock_timestamp() END,body->>'archiveReason',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
      ELSE
        UPDATE crest.addresses SET line1=body->>'line1',line2=body->>'line2',city=body->>'city',region=body->>'region',postal_code=body->>'postalCode',country=body->>'country',exact_location_text=body->>'exactLocationText',instructions=body->>'instructions',geocode_source=body->>'geocodeSource',geocode_accuracy=body->>'geocodeAccuracy',latitude=latitude_value,longitude=longitude_value,verified_at=verified_value,archived_at=CASE WHEN archived THEN coalesce(archived_at,clock_timestamp()) END,archived_reason=body->>'archiveReason',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_address AND customer_id=requested_parent RETURNING * INTO new_row;
      END IF;
      action:=CASE WHEN expected_version=0 THEN 'create' WHEN archived AND old_row.archived_at IS NULL THEN 'archive' WHEN NOT archived AND old_row.archived_at IS NOT NULL THEN 'reopen' ELSE 'edit' END;
      INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'addresses',requested_address,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.address_projection(old_row) END,'after',crest_private.address_projection(new_row)),'manual') RETURNING id INTO event_id;
      command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_parent,'addressId',requested_address,'addressVersion',new_row.version::text,'auditEventId',event_id));
      UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
    END IF;
    PERFORM crest_commands.finish_address_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
    WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated='addresses_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','address'); END IF;RAISE;
    WHEN foreign_key_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
      IF violated='addresses_business_id_customer_id_fkey' THEN RETURN jsonb_build_object('state','conflict','reason','parent'); END IF;RAISE;
  END;
END
$save$;

GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,delta) ON crest_private.audit_events TO crest_address_integrity_owner;
CREATE POLICY address_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_address_integrity_owner USING(entity_kind='addresses');
CREATE UNIQUE INDEX address_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='addresses';
CREATE FUNCTION crest_commands.lookup_address_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_address_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  RETURN crest_private.address_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_address_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_parent uuid,search_text text,after_id uuid,include_archived boolean,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_parent IS NULL OR search_text IS NULL OR char_length(search_text)>200 OR include_archived IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_address_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH matches AS MATERIALIZED(SELECT c.* FROM crest.addresses c WHERE c.business_id=requested_business AND (include_archived OR c.archived_at IS NULL) AND (after_id IS NULL OR c.id>after_id)
    AND c.customer_id=requested_parent AND (search_text='' OR strpos(lower(c.line1),lower(search_text))>0 OR strpos(lower(c.line2),lower(search_text))>0 OR strpos(lower(c.city),lower(search_text))>0 OR strpos(lower(c.region),lower(search_text))>0 OR strpos(lower(c.postal_code),lower(search_text))>0 OR strpos(lower(c.country),lower(search_text))>0 OR strpos(lower(c.exact_location_text),lower(search_text))>0 OR strpos(lower(c.instructions),lower(search_text))>0 OR strpos(lower(c.geocode_source),lower(search_text))>0 OR strpos(lower(c.geocode_accuracy),lower(search_text))>0) ORDER BY c.id LIMIT page_limit+1),
    page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_parent,'addresses',coalesce((SELECT jsonb_agg(crest_private.address_projection(p::crest.addresses) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ADDRESS_PAGE_LIMIT'; END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_address_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_parent uuid,requested_address uuid,after_version bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_parent IS NULL OR requested_address IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  context:=crest_commands.authorize_address_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  WITH target AS MATERIALIZED(SELECT * FROM crest.addresses WHERE business_id=requested_business AND id=requested_address AND customer_id=requested_parent),
    events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='addresses' AND entity_id=requested_address AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
    page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
  SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'customerId',requested_parent,'address',(SELECT crest_private.address_projection(t::crest.addresses) FROM target t),
    'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ADDRESS_PAGE_LIMIT'; END IF;RETURN result;
END
$history$;

-- Separate privileged export caller; no ordinary web execute. It must receive
-- a recently authorized fixed business from the future whole-export job.
GRANT SELECT(id) ON crest.businesses TO crest_address_owner;
CREATE POLICY address_export_business ON crest.businesses FOR SELECT TO crest_address_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.address_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_ADDRESS_SNAPSHOT_REQUIRED'; END IF;
  IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_INPUT_REQUIRED'; END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_SCOPE_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM crest.addresses WHERE business_id=requested_business;
  IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ADDRESS_SNAPSHOT_LIMIT'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','address_directory','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.address.directory.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.address_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
  context:=crest_commands.address_snapshot_context(requested_business);
  IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ADDRESS_SNAPSHOT_REQUIRED'; END IF;
  WITH page AS(SELECT * FROM crest.addresses WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'addresses',coalesce(jsonb_agg(crest_private.address_projection(p::crest.addresses) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ADDRESS_PAGE_LIMIT'; END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_address_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_address_owner;
ALTER FUNCTION crest_commands.authorize_address_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_address_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.address_operation_result(uuid,uuid,uuid) OWNER TO crest_address_owner;
ALTER FUNCTION crest_commands.save_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) OWNER TO crest_address_owner;
ALTER FUNCTION crest_commands.lookup_address_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_address_owner;
ALTER FUNCTION crest_commands.read_address_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,uuid,boolean,integer) OWNER TO crest_address_owner;
ALTER FUNCTION crest_commands.read_address_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) OWNER TO crest_address_owner;
ALTER FUNCTION crest_commands.address_snapshot_context(uuid) OWNER TO crest_address_owner;
ALTER FUNCTION crest_commands.address_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_address_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_address_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_address_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_address_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_address_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.address_operation_result(uuid,uuid,uuid),crest_commands.save_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_address_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_address_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,uuid,boolean,integer),crest_commands.read_address_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer),crest_commands.address_snapshot_context(uuid),crest_commands.address_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_address_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_address_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_address_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_address_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_address_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,uuid,boolean,integer),crest_commands.read_address_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.address_snapshot_context(uuid),crest_commands.address_snapshot_page(uuid,text,uuid,integer) TO crest_export;
