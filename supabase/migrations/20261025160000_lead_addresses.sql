-- BR02/P02/P03: retained lead-owned address intake and original history.
-- All39 published migrations remain unchanged. Synthetic tests only.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_lead_owner','crest_lead_integrity_owner','crest_schema_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_lead_owner','crest_lead_integrity_owner','crest_schema_owner'))
 OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest.leads'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_ADDRESS_SOURCE_REVIEW_REQUIRED';
 END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.lead_address_draft_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text;maximum integer;verified timestamptz;lat numeric;lng numeric;
BEGIN
 IF body IS NULL OR jsonb_typeof(body)<>'object' OR body-ARRAY['line1','line2','city','region','postalCode','country','exactLocationText','instructions','geocodeSource','geocodeAccuracy','latitude','longitude','verifiedAt','archived','archiveReason']<>'{}'::jsonb OR NOT body ?& ARRAY['line1','line2','city','region','postalCode','country','exactLocationText','instructions','geocodeSource','geocodeAccuracy','latitude','longitude','verifiedAt','archived','archiveReason'] OR octet_length(body::text)>32768 THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['line1','line2','city','region','postalCode','country','exactLocationText','instructions','geocodeSource','geocodeAccuracy'] LOOP
  maximum:=CASE WHEN k IN ('line1','line2') THEN 512 WHEN k='postalCode' THEN 128 WHEN k IN ('exactLocationText','instructions') THEN 2000 ELSE 200 END;
  IF NOT crest_private.lead_resource_text(body->k,maximum,true,false,k IN ('exactLocationText','instructions')) THEN RETURN false;END IF;
 END LOOP;
 IF jsonb_typeof(body->'archived')<>'boolean' OR NOT(CASE WHEN body->'archived'='true'::jsonb THEN crest_private.lead_resource_text(body->'archiveReason',1000,false,true,true) ELSE body->'archiveReason'='null'::jsonb END) THEN RETURN false;END IF;
 IF jsonb_typeof(body->'latitude') NOT IN ('string','null') OR jsonb_typeof(body->'longitude') NOT IN ('string','null') OR (body->'latitude'='null'::jsonb)<>(body->'longitude'='null'::jsonb) THEN RETURN false;END IF;
 IF body->>'latitude' IS NOT NULL THEN
  IF char_length(body->>'latitude')>128 OR char_length(body->>'longitude')>128 OR body->>'latitude'!~'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' OR body->>'longitude'!~'^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN RETURN false;END IF;
  lat:=(body->>'latitude')::numeric;lng:=(body->>'longitude')::numeric;
  IF lat NOT BETWEEN -90 AND 90 OR lng NOT BETWEEN -180 AND 180 THEN RETURN false;END IF;
 END IF;
 IF jsonb_typeof(body->'verifiedAt') NOT IN ('string','null') THEN RETURN false;END IF;
 IF body->>'verifiedAt' IS NOT NULL THEN
  IF body->>'verifiedAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN false;END IF;
  verified:=(body->>'verifiedAt')::timestamptz;
  IF NOT isfinite(verified) OR verified<TIMESTAMPTZ '0001-01-01 00:00:00+00' OR to_char(verified AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>body->>'verifiedAt' THEN RETURN false;END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END
$valid$;
REVOKE ALL ON FUNCTION crest_private.lead_address_draft_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_address_draft_valid(jsonb) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE TABLE crest.lead_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  lead_id uuid NOT NULL,
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
  FOREIGN KEY(business_id,lead_id) REFERENCES crest.leads(business_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
  CHECK(crest_private.lead_address_draft_valid(jsonb_build_object('line1',line1,'line2',line2,'city',city,'region',region,'postalCode',postal_code,'country',country,'exactLocationText',exact_location_text,'instructions',instructions,'geocodeSource',geocode_source,'geocodeAccuracy',geocode_accuracy,'latitude',latitude::text,'longitude',longitude::text,'verifiedAt',to_char(verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived',archived_at IS NOT NULL,'archiveReason',archived_reason))),
  CHECK((latitude IS NULL)=(longitude IS NULL)), CHECK((archived_at IS NULL)=(archived_reason IS NULL)),
  CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at AND (archived_at IS NULL OR archived_at>=created_at AND archived_at<=updated_at))
);
CREATE INDEX lead_addresses_parent ON crest.lead_addresses(business_id,lead_id,id);
CREATE INDEX lead_addresses_creator ON crest.lead_addresses(business_id,created_by);
CREATE INDEX lead_addresses_updater ON crest.lead_addresses(business_id,updated_by);
CREATE INDEX lead_addresses_operation ON crest.lead_addresses(business_id,operation_id,updated_by);
GRANT USAGE ON TYPE crest.lead_addresses TO crest_lead_owner,crest_lead_integrity_owner;
ALTER TABLE crest.lead_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.lead_addresses FORCE ROW LEVEL SECURITY;

CREATE FUNCTION crest_private.lead_address_projection(c crest.lead_addresses) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $project$
  SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'lead_id',(c).lead_id,'line1',(c).line1,'line2',(c).line2,'city',(c).city,'region',(c).region,'postal_code',(c).postal_code,'country',(c).country,'exact_location_text',(c).exact_location_text,'instructions',(c).instructions,'geocode_source',(c).geocode_source,'geocode_accuracy',(c).geocode_accuracy,'latitude',(c).latitude::text,'longitude',(c).longitude::text,'verified_at',to_char((c).verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_at',to_char((c).archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_reason',(c).archived_reason,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$project$;
REVOKE ALL ON FUNCTION crest_private.lead_address_projection(crest.lead_addresses) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_address_projection(crest.lead_addresses) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.validate_lead_address_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 -- Serialize intake with future conversion on the genuine parent, even when
 -- two separate intake locations are being edited at once.
 PERFORM 1 FROM crest.leads WHERE business_id=NEW.business_id AND id=NEW.lead_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_LEAD_ADDRESS_PARENT_REQUIRED';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.business_id,NEW.lead_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.lead_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_ADDRESS_PROVENANCE';END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_VERSION_CONFLICT';END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN NEW.archived_at:=OLD.archived_at;ELSIF NEW.archived_at IS NOT NULL THEN NEW.archived_at:=stamp;END IF;
 ELSE
  IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_VERSION_CONFLICT';END IF;
  NEW.created_at:=stamp;IF NEW.archived_at IS NOT NULL THEN NEW.archived_at:=stamp;END IF;
 END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_lead_address_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='lead_addresses' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.lead_address_projection(NEW::crest.lead_addresses) AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.lead_address_projection(OLD::crest.lead_addresses) END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_AUDIT_REQUIRED';END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER lead_address_change BEFORE INSERT OR UPDATE ON crest.lead_addresses FOR EACH ROW EXECUTE FUNCTION crest_private.validate_lead_address_change();
CREATE CONSTRAINT TRIGGER lead_address_audit AFTER INSERT OR UPDATE ON crest.lead_addresses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_lead_address_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.lead_addresses FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.lead_addresses FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.lead_addresses TO crest_lead_owner;
GRANT INSERT(id,business_id,lead_id,line1,line2,city,region,postal_code,country,exact_location_text,instructions,geocode_source,geocode_accuracy,latitude,longitude,verified_at,archived_at,archived_reason,created_by,updated_by,origin,operation_id) ON crest.lead_addresses TO crest_lead_owner;
GRANT UPDATE(line1,line2,city,region,postal_code,country,exact_location_text,instructions,geocode_source,geocode_accuracy,latitude,longitude,verified_at,archived_at,archived_reason,version,updated_by,operation_id) ON crest.lead_addresses TO crest_lead_owner;
CREATE POLICY lead_address_read ON crest.lead_addresses FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY lead_address_create ON crest.lead_addresses FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY lead_address_edit ON crest.lead_addresses FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY lead_address_audits_read ON crest_private.audit_events FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='lead_addresses');
CREATE POLICY lead_address_audits_create ON crest_private.audit_events FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='lead_addresses' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_address_operations_read ON crest_private.operations FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.address.save');
CREATE POLICY lead_address_operations_create ON crest_private.operations FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.lead.address.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_address_operations_finish ON crest_private.operations FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.address.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.address.save');
CREATE POLICY lead_address_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_lead_integrity_owner USING(entity_kind='lead_addresses');
CREATE UNIQUE INDEX lead_address_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='lead_addresses';
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.check_lead_address_audit() OWNER TO crest_lead_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_lead_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_lead_address_audit(),crest_private.validate_lead_address_change() FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.lead_address_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;a record;r jsonb;b jsonb;n jsonb;body jsonb;expected_version text;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type='crm.lead.address.save';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','leadId','leadAddressId','leadAddressVersion','auditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','leadId','leadAddressId','leadAddressVersion','auditEventId'] OR r->'schemaVersion'<>'1'::jsonb OR r->>'businessId'<>requested_business::text OR jsonb_typeof(r->'leadAddressVersion')<>'string' OR r->>'leadAddressVersion'!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND id=(r->>'auditEventId')::uuid AND operation_id=requested_operation AND actor_id=requested_actor AND entity_kind='lead_addresses' AND entity_id=(r->>'leadAddressId')::uuid AND entity_version=(r->>'leadAddressVersion')::bigint;
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_RESULT_REVIEW_REQUIRED';END IF;
 b:=a.delta->'before';n:=a.delta->'after';expected_version:=CASE WHEN b='null'::jsonb THEN '0' ELSE b->>'version' END;
 IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR n-ARRAY['id','business_id','lead_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT n ?& ARRAY['id','business_id','lead_id','line1','line2','city','region','postal_code','country','exact_location_text','instructions','geocode_source','geocode_accuracy','latitude','longitude','verified_at','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR b IS NULL OR (b<>'null'::jsonb AND (jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'id' IS DISTINCT FROM r->>'leadAddressId' OR b->>'lead_id' IS DISTINCT FROM r->>'leadId')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_RESULT_REVIEW_REQUIRED';END IF;
 body:=jsonb_build_object('line1',n->'line1','line2',n->'line2','city',n->'city','region',n->'region','postalCode',n->'postal_code','country',n->'country','exactLocationText',n->'exact_location_text','instructions',n->'instructions','geocodeSource',n->'geocode_source','geocodeAccuracy',n->'geocode_accuracy','latitude',n->'latitude','longitude',n->'longitude','verifiedAt',n->'verified_at','archived',n->'archived_at'<>'null'::jsonb,'archiveReason',n->'archived_reason');
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.address.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'leadId',r->'leadId','leadAddressId',r->'leadAddressId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
 IF expected_version IS NULL OR NOT crest_private.lead_address_draft_valid(body) OR (r->>'leadAddressVersion')::bigint<>expected_version::bigint+1 OR n->>'id'<>r->>'leadAddressId' OR n->>'lead_id'<>r->>'leadId' OR n->>'business_id'<>requested_business::text OR n->>'operation_id'<>requested_operation::text OR n->>'updated_by'<>requested_actor::text OR n->>'version'<>r->>'leadAddressVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_ADDRESS_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END
$result$;
CREATE FUNCTION crest_commands.save_lead_address(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_lead uuid,requested_lead_address uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb;digest text;claimed uuid;existing record;old_row crest.lead_addresses;new_row crest.lead_addresses;event_id uuid;command_result jsonb;action text;violated text;latitude_value numeric;longitude_value numeric;verified_value timestamptz;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_lead IS NULL OR requested_lead_address IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR NOT crest_private.lead_address_draft_valid(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_INPUT_REQUIRED';END IF;
 -- NUMERIC retains decimal scale but has no signed zero. Canonicalize before hashing.
 latitude_value:=(body->>'latitude')::numeric;longitude_value:=(body->>'longitude')::numeric;verified_value:=(body->>'verifiedAt')::timestamptz;
 body:=body||jsonb_build_object('latitude',latitude_value::text,'longitude',longitude_value::text);
 BEGIN
  context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  PERFORM crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_LEAD_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.address.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'leadId',requested_lead,'leadAddressId',requested_lead_address,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.lead.address.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.lead_address_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM 1 FROM crest.leads WHERE business_id=requested_business AND id=requested_lead FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_ADDRESS_PARENT_CONFLICT';END IF;
   SELECT * INTO old_row FROM crest.lead_addresses WHERE business_id=requested_business AND id=requested_lead_address FOR UPDATE;
   IF old_row.id IS NOT NULL AND old_row.lead_id<>requested_lead THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_ADDRESS_PARENT_CONFLICT';END IF;
   IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_LEAD_ADDRESS_VERSION_CONFLICT';END IF;
   IF expected_version=0 THEN
    INSERT INTO crest.lead_addresses(id,business_id,lead_id,line1,line2,city,region,postal_code,country,exact_location_text,instructions,geocode_source,geocode_accuracy,latitude,longitude,verified_at,archived_at,archived_reason,created_by,updated_by,origin,operation_id) VALUES(requested_lead_address,requested_business,requested_lead,body->>'line1',body->>'line2',body->>'city',body->>'region',body->>'postalCode',body->>'country',body->>'exactLocationText',body->>'instructions',body->>'geocodeSource',body->>'geocodeAccuracy',latitude_value,longitude_value,verified_value,CASE WHEN body->'archived'='true'::jsonb THEN clock_timestamp() END,body->>'archiveReason',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
   ELSE
    UPDATE crest.lead_addresses SET line1=body->>'line1',line2=body->>'line2',city=body->>'city',region=body->>'region',postal_code=body->>'postalCode',country=body->>'country',exact_location_text=body->>'exactLocationText',instructions=body->>'instructions',geocode_source=body->>'geocodeSource',geocode_accuracy=body->>'geocodeAccuracy',latitude=latitude_value,longitude=longitude_value,verified_at=verified_value,archived_at=CASE WHEN body->'archived'='true'::jsonb THEN coalesce(archived_at,clock_timestamp()) END,archived_reason=body->>'archiveReason',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_lead_address AND lead_id=requested_lead RETURNING * INTO new_row;
   END IF;
   action:=CASE WHEN expected_version=0 THEN 'create' WHEN old_row.archived_at IS NULL AND new_row.archived_at IS NOT NULL THEN 'archive' WHEN old_row.archived_at IS NOT NULL AND new_row.archived_at IS NULL THEN 'reopen' ELSE 'edit' END;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'lead_addresses',requested_lead_address,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.lead_address_projection(old_row) END,'after',crest_private.lead_address_projection(new_row)),'manual') RETURNING id INTO event_id;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadAddressId',requested_lead_address,'leadAddressVersion',new_row.version::text,'auditEventId',event_id));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_lead_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','parent');
 WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
 WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated='lead_addresses_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','lead_address');END IF;RAISE;
 END;
END
$save$;
CREATE FUNCTION crest_commands.lookup_lead_address_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.lead_address_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_private.lead_address_operation_result(uuid,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.save_lead_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lookup_lead_address_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_private.lead_address_operation_result(uuid,uuid,uuid),crest_commands.save_lead_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_lead_address_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_lead_address(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_lead_address_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_lead_addresses(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,after_id uuid,include_archived boolean,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR include_archived IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH target AS MATERIALIZED(SELECT version FROM crest.leads WHERE business_id=requested_business AND id=requested_lead),
 matches AS MATERIALIZED(SELECT v.* FROM crest.lead_addresses v WHERE v.business_id=requested_business AND v.lead_id=requested_lead AND (include_archived OR v.archived_at IS NULL) AND (after_id IS NULL OR v.id>after_id) ORDER BY v.id LIMIT page_limit+1),
 page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadVersion',(SELECT version::text FROM target),'leadAddresses',coalesce((SELECT jsonb_agg(crest_private.lead_address_projection(p::crest.lead_addresses) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) ELSE jsonb_build_object('state','absent') END INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_ADDRESS_PAGE_LIMIT';END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_lead_address_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,requested_lead_address uuid,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR requested_lead_address IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH target AS MATERIALIZED(SELECT * FROM crest.lead_addresses WHERE business_id=requested_business AND lead_id=requested_lead AND id=requested_lead_address),
 events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='lead_addresses' AND entity_id=requested_lead_address AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
 page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadAddress',(SELECT crest_private.lead_address_projection(t::crest.lead_addresses) FROM target t),'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_ADDRESS_PAGE_LIMIT';END IF;RETURN result;
END
$history$;
-- Separate privileged export caller, never raw table access or web execute.
-- Whole-export authorization and private custody remain separately required.
CREATE FUNCTION crest_commands.lead_address_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_ADDRESS_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_INPUT_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO n FROM crest.lead_addresses WHERE business_id=requested_business;IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_ADDRESS_SNAPSHOT_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','lead_address_intake','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead.address.intake.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.lead_address_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.lead_address_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_ADDRESS_SNAPSHOT_REQUIRED';END IF;
 WITH page AS(SELECT * FROM crest.lead_addresses WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'leadAddresses',coalesce(jsonb_agg(crest_private.lead_address_projection(p::crest.lead_addresses) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_ADDRESS_PAGE_LIMIT';END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_addresses(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,boolean,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_address_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_address_snapshot_context(uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_address_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.read_lead_addresses(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,boolean,integer),crest_commands.read_lead_address_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer),crest_commands.lead_address_snapshot_context(uuid),crest_commands.lead_address_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_addresses(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,boolean,integer),crest_commands.read_lead_address_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_address_snapshot_context(uuid),crest_commands.lead_address_snapshot_page(uuid,text,uuid,integer) TO crest_export;
