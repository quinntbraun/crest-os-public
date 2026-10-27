-- Unregistered catalog-storage construction over registered43. Synthetic only.
-- No runtime commands, table grants, activation or migration number are assigned.
DO $review$
DECLARE role_id oid;
BEGIN
 SELECT oid INTO role_id FROM pg_roles WHERE rolname='crest_catalog_integrity_owner';
 IF role_id IS NULL THEN
  CREATE ROLE crest_catalog_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_catalog_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
  SELECT oid INTO role_id FROM pg_roles WHERE rolname='crest_catalog_integrity_owner';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=role_id AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=role_id OR member=role_id)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=role_id OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(role_id,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=role_id OR has_function_privilege(role_id,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(role_id,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=role_id AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',role_id))) a WHERE a.grantee<>role_id)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=role_id AND a.grantee<>role_id)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_ROLE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_integrity_owner'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_catalog_integrity_owner;
CREATE TABLE crest.services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 code text NOT NULL CHECK(code~'^[a-z0-9][a-z0-9_-]{0,79}$'),
 current_version_id uuid NOT NULL,
 active boolean NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN('manual','import','system')),
 operation_id uuid NOT NULL,
 import_row_id uuid,
 UNIQUE(business_id,id),
 CONSTRAINT service_code_unique UNIQUE(business_id,code),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at)
);
CREATE TABLE crest.service_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 service_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 name text NOT NULL,
 inclusions text NOT NULL,
 exclusions text NOT NULL,
 internal_guidance text,
 range_low_cents bigint CHECK(range_low_cents>=0),
 range_high_cents bigint CHECK(range_high_cents>=0 AND range_low_cents IS NOT NULL AND range_high_cents>=range_low_cents),
 estimated_seconds bigint CHECK(estimated_seconds>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 created_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN('manual','import','system')),
 operation_id uuid NOT NULL,
 import_row_id uuid,
 UNIQUE(business_id,id),
 UNIQUE(business_id,service_id,id),
 CONSTRAINT service_sequence_unique UNIQUE(business_id,service_id,sequence),
 FOREIGN KEY(business_id,service_id) REFERENCES crest.services(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(char_length(name) BETWEEN 1 AND 200 AND btrim(name,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND name!~'[[:cntrl:]]'),
 CHECK(char_length(inclusions) BETWEEN 1 AND 4000 AND btrim(inclusions,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(inclusions,E'\t\n\r','')!~'[[:cntrl:]]'),
 CHECK(char_length(exclusions)<=4000 AND translate(exclusions,E'\t\n\r','')!~'[[:cntrl:]]'),
 CHECK(internal_guidance IS NULL OR (char_length(internal_guidance) BETWEEN 1 AND 4000 AND btrim(internal_guidance,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(internal_guidance,E'\t\n\r','')!~'[[:cntrl:]]'))
);
-- Both sides are tenant/service typed. Deferred publication permits creating
-- the directory root and its first content row in one atomic transaction.
ALTER TABLE crest.services ADD CONSTRAINT service_current_version FOREIGN KEY(business_id,id,current_version_id) REFERENCES crest.service_versions(business_id,service_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX services_creator ON crest.services(business_id,created_by);
CREATE INDEX services_updater ON crest.services(business_id,updated_by);
CREATE INDEX services_operation ON crest.services(business_id,operation_id,updated_by);
CREATE INDEX services_cursor ON crest.services(business_id,created_at,id);
CREATE INDEX service_versions_creator ON crest.service_versions(business_id,created_by);
CREATE INDEX service_versions_operation ON crest.service_versions(business_id,operation_id,created_by);
CREATE INDEX service_versions_cursor ON crest.service_versions(business_id,created_at,id);
ALTER TABLE crest.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.services FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.service_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.service_versions FORCE ROW LEVEL SECURITY;
CREATE FUNCTION crest_private.service_projection(c crest.services) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(c)||jsonb_build_object('version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.service_definition(c crest.service_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $definition$
 SELECT jsonb_build_object('name',(c).name,'inclusions',(c).inclusions,'exclusions',(c).exclusions,'internalGuidance',(c).internal_guidance,'rangeLowCents',(c).range_low_cents::text,'rangeHighCents',(c).range_high_cents::text,'estimatedSeconds',(c).estimated_seconds::text)
$definition$;
CREATE FUNCTION crest_private.service_version_projection(c crest.service_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(c)||jsonb_build_object('sequence',(c).sequence::text,'range_low_cents',(c).range_low_cents::text,'range_high_cents',(c).range_high_cents::text,'estimated_seconds',(c).estimated_seconds::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.reject_catalog_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retained$
 BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_CATALOG_HISTORY_RETAINED';END
$retained$;
CREATE FUNCTION crest_private.validate_service_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp(); prior crest.service_versions; following crest.service_versions;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_VERSION_CONFLICT';END IF;
  NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.code,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.code,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_SERVICE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 OR (NEW.current_version_id=OLD.current_version_id AND NEW.active=OLD.active) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_VERSION_CONFLICT';END IF;
  IF NEW.current_version_id<>OLD.current_version_id THEN
   SELECT * INTO prior FROM crest.service_versions WHERE business_id=OLD.business_id AND service_id=OLD.id AND id=OLD.current_version_id;
   SELECT * INTO following FROM crest.service_versions WHERE business_id=NEW.business_id AND service_id=NEW.id AND id=NEW.current_version_id;
   IF prior.id IS NULL OR following.id IS NULL OR following.sequence::numeric<>prior.sequence::numeric+1 OR following.created_by<>NEW.updated_by OR following.operation_id<>NEW.operation_id OR crest_private.service_definition(prior)=crest_private.service_definition(following) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_CONFLICT';END IF;
  END IF;
 END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END $change$;
CREATE FUNCTION crest_private.validate_service_version_append() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $append$
DECLARE parent crest.services; current_sequence bigint;
BEGIN
 SELECT * INTO parent FROM crest.services WHERE business_id=NEW.business_id AND id=NEW.service_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_SERVICE_PARENT_REQUIRED';END IF;
 SELECT sequence INTO current_sequence FROM crest.service_versions WHERE business_id=NEW.business_id AND service_id=NEW.service_id AND id=parent.current_version_id;
 IF current_sequence IS NULL THEN
  IF NEW.sequence<>1 OR parent.version<>1 OR parent.current_version_id<>NEW.id OR parent.operation_id<>NEW.operation_id OR parent.updated_by<>NEW.created_by OR parent.origin<>NEW.origin OR parent.import_row_id IS DISTINCT FROM NEW.import_row_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_CONFLICT';END IF;
 ELSIF NEW.sequence::numeric<>current_sequence::numeric+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_CONFLICT';
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $append$;
CREATE FUNCTION crest_private.check_service_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE prior jsonb:='null'::jsonb; expected_action text:='create'; v crest.service_versions; changed boolean:=true;
BEGIN
 IF TG_OP='UPDATE' THEN
  prior:=crest_private.service_projection(OLD::crest.services);
  changed:=NEW.current_version_id<>OLD.current_version_id;
  expected_action:=CASE WHEN NEW.current_version_id<>OLD.current_version_id THEN 'edit' WHEN NEW.active THEN 'reopen' ELSE 'archive' END;
 END IF;
 SELECT * INTO v FROM crest.service_versions WHERE business_id=NEW.business_id AND service_id=NEW.id AND id=NEW.current_version_id;
 IF v.id IS NULL OR TG_OP='INSERT' AND v.sequence<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_CONFLICT';END IF;
 IF changed AND (v.operation_id<>NEW.operation_id OR v.created_by<>NEW.updated_by) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_CONFLICT';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='services' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.action=expected_action AND a.delta->'before'=prior AND a.delta->'after'=crest_private.service_projection(NEW::crest.services) AND o.command_type='catalog.service.save' AND o.schema_version=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $audit$;
CREATE FUNCTION crest_private.check_service_version_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='service_versions' AND a.entity_id=NEW.id AND a.entity_version=1 AND a.action='append' AND a.delta->'before'='null'::jsonb AND a.delta->'after'=crest_private.service_version_projection(NEW::crest.service_versions) AND o.command_type='catalog.service.save' AND o.schema_version=1 AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
  OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.services s ON s.business_id=a.business_id AND s.id=a.entity_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='services' AND a.entity_id=NEW.service_id AND a.entity_version<=s.version AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'current_version_id'=NEW.id::text AND (a.delta->'before'='null'::jsonb OR a.delta->'before'->>'current_version_id'<>NEW.id::text))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $audit$;
CREATE TRIGGER service_change BEFORE INSERT OR UPDATE ON crest.services FOR EACH ROW EXECUTE FUNCTION crest_private.validate_service_change();
CREATE TRIGGER service_version_append BEFORE INSERT ON crest.service_versions FOR EACH ROW EXECUTE FUNCTION crest_private.validate_service_version_append();
CREATE CONSTRAINT TRIGGER service_audit AFTER INSERT OR UPDATE ON crest.services DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_service_audit();
CREATE CONSTRAINT TRIGGER service_version_audit AFTER INSERT ON crest.service_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_service_version_audit();
CREATE TRIGGER service_delete BEFORE DELETE ON crest.services FOR EACH ROW EXECUTE FUNCTION crest_private.reject_catalog_history_change();
CREATE TRIGGER service_truncate BEFORE TRUNCATE ON crest.services FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_catalog_history_change();
CREATE TRIGGER service_version_update BEFORE UPDATE ON crest.service_versions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_catalog_history_change();
CREATE TRIGGER service_version_delete BEFORE DELETE ON crest.service_versions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_catalog_history_change();
CREATE TRIGGER service_version_truncate BEFORE TRUNCATE ON crest.service_versions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_catalog_history_change();
CREATE UNIQUE INDEX service_audit_revision ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='services';
CREATE UNIQUE INDEX service_version_audit_identity ON crest_private.audit_events(business_id,entity_id) WHERE entity_kind='service_versions';
GRANT USAGE ON TYPE crest.services,crest.service_versions TO crest_catalog_integrity_owner;
GRANT SELECT ON crest.services,crest.service_versions TO crest_catalog_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,command_type,schema_version,origin,import_row_id) ON crest_private.operations TO crest_catalog_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta) ON crest_private.audit_events TO crest_catalog_integrity_owner;
CREATE POLICY catalog_integrity_services ON crest.services FOR SELECT TO crest_catalog_integrity_owner USING(true);
CREATE POLICY catalog_integrity_versions ON crest.service_versions FOR SELECT TO crest_catalog_integrity_owner USING(true);
CREATE POLICY catalog_integrity_operations ON crest_private.operations FOR SELECT TO crest_catalog_integrity_owner USING(command_type='catalog.service.save');
CREATE POLICY catalog_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_catalog_integrity_owner USING(entity_kind IN('services','service_versions'));
GRANT EXECUTE ON FUNCTION crest_private.service_projection(crest.services),crest_private.service_definition(crest.service_versions),crest_private.service_version_projection(crest.service_versions) TO crest_catalog_integrity_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_catalog_integrity_owner;
ALTER FUNCTION crest_private.check_service_audit() OWNER TO crest_catalog_integrity_owner;
ALTER FUNCTION crest_private.check_service_version_audit() OWNER TO crest_catalog_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_catalog_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.service_projection(crest.services),crest_private.service_definition(crest.service_versions),crest_private.service_version_projection(crest.service_versions),crest_private.reject_catalog_history_change(),crest_private.validate_service_change(),crest_private.validate_service_version_append(),crest_private.check_service_audit(),crest_private.check_service_version_audit() FROM PUBLIC;
