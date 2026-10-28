-- Registered44 catalog construction; production and ordinary runtime activation remain blocked.
-- Four reviewed proposal bodies are retained byte-for-byte below. Their original comments
-- describe their historical construction context; CATALOG_SCHEMA44_ADOPTION.json records adoption.
-- The migration coordinator owns one atomic transaction; do not apply bodies separately.

-- BEGIN REVIEWED CATALOG 1 storage
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
 range_high_cents bigint CHECK(range_high_cents IS NULL OR (range_high_cents>=0 AND range_low_cents IS NOT NULL AND range_high_cents>=range_low_cents)),
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
 CHECK(char_length(name)>=1 AND char_length(name)<=200 AND btrim(name,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND name!~'[[:cntrl:]]'),
 CHECK(char_length(inclusions)>=1 AND char_length(inclusions)<=4000 AND btrim(inclusions,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(inclusions,E'\t\n\r','')!~'[[:cntrl:]]'),
 CHECK(char_length(exclusions)<=4000 AND translate(exclusions,E'\t\n\r','')!~'[[:cntrl:]]'),
 CHECK(internal_guidance IS NULL OR (char_length(internal_guidance)>=1 AND char_length(internal_guidance)<=4000 AND btrim(internal_guidance,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(internal_guidance,E'\t\n\r','')!~'[[:cntrl:]]'))
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

-- END REVIEWED CATALOG 1 storage

-- BEGIN REVIEWED CATALOG 2 commands
-- Unregistered command construction over registered43 + verified catalog schema.
-- PRIVATE backend role only; no HTTP route, app activation or migration ordinal.
-- CAPABILITY: crm.manage, owner-scoped nonfinancial catalog preparation.
-- BEGIN SOURCE GUARDS
DO $review$
DECLARE r oid;
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='crest_catalog_owner';
 IF r IS NULL THEN
  CREATE ROLE crest_catalog_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_catalog_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
  SELECT oid INTO r FROM pg_roles WHERE rolname='crest_catalog_owner';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=r OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=r AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',r))) a WHERE a.grantee<>r)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_ROLE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_catalog_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN('crest_schema_owner','crest_session_owner','crest_integrity_owner','crest_catalog_integrity_owner'))
  OR EXISTS(SELECT 1 FROM pg_roles p CROSS JOIN LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=p.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',p.oid))) a WHERE p.rolname IN('crest_schema_owner','crest_session_owner') AND a.grantee<>p.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles p ON p.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE p.rolname IN('crest_schema_owner','crest_session_owner') AND a.grantee<>p.oid)
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.services'::regclass,'crest.service_versions'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.app_sessions'::regclass,'crest_private.business_recovery_authorities'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>8
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.service_projection(crest.services)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7682059c83fe884e2a3e9cd9149a9563633a54181fa6d2e465c2c4f392b991bf') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.service_definition(crest.service_versions)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5a4802486fff4985ecdbfebdd78ddf89a4fdd1f7326dd6b669c0badef1fbfeab') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.service_version_projection(crest.service_versions)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='896397db79799cbc5983cd807cc7ddf0a66b2302586b044d324336be410689a4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.reject_catalog_history_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8b6ff4061e1b8355528145c495629fff13f4ee9a12326f39d0e9e083d4b0aceb') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_service_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fe39c7a8db21032cb2efe3618051689594e325e0a833b4876a6894eec017232d') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_service_version_append()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3887929028d45b3b5923cea6ffaeb512eed866d20922c4a6af5d25415559ba52') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_service_audit()') AND p.proowner='crest_catalog_integrity_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='1a7d5488a79648c8f91a1197ad7c9464acd8e711e85fc6a02544960ce8d77236') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_service_version_audit()') AND p.proowner='crest_catalog_integrity_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='0cb9e94087682106e14b230fbe5791517b9d513f161978f11d18cf9ebe7a019b') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='614b87966124be9297a7658a86bc3ee84a29f19f381a80ca23ecf702ffa0e952') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='9b2d19abde943ad1353250275d1b3bf66b34b9ff5fbe1a6d16b73a0ef42cae35') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
-- END SOURCE GUARDS
DO $storage_review$
BEGIN
 IF (SELECT count(*) FROM (VALUES
  ('crest.services','service_change','crest_private.validate_service_change()',23,false),
  ('crest.service_versions','service_version_append','crest_private.validate_service_version_append()',7,false),
  ('crest.services','service_audit','crest_private.check_service_audit()',21,true),
  ('crest.service_versions','service_version_audit','crest_private.check_service_version_audit()',5,true),
  ('crest.services','service_delete','crest_private.reject_catalog_history_change()',11,false),
  ('crest.services','service_truncate','crest_private.reject_catalog_history_change()',34,false),
  ('crest.service_versions','service_version_update','crest_private.reject_catalog_history_change()',19,false),
  ('crest.service_versions','service_version_delete','crest_private.reject_catalog_history_change()',11,false),
  ('crest.service_versions','service_version_truncate','crest_private.reject_catalog_history_change()',34,false)
 ) expected(relation,name,routine,kind,deferred) JOIN pg_trigger t ON t.tgrelid=to_regclass(expected.relation) AND t.tgname=expected.name AND t.tgfoid=to_regprocedure(expected.routine) AND t.tgtype=expected.kind AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=expected.deferred AND t.tginitdeferred=expected.deferred)<>9
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.services'::regclass AND conname='service_current_version' AND contype='f' AND conkey=ARRAY[2,1,4]::smallint[] AND confrelid='crest.service_versions'::regclass AND confkey=ARRAY[2,3,1]::smallint[] AND confdeltype='r' AND confupdtype='a' AND confmatchtype='s' AND convalidated AND condeferrable AND condeferred)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.services'::regclass AND conname='service_code_unique' AND contype='u' AND conkey=ARRAY[2,3]::smallint[] AND convalidated AND NOT condeferrable)
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.service_versions'::regclass AND conname='service_sequence_unique' AND contype='u' AND conkey=ARRAY[2,3,4]::smallint[] AND convalidated AND NOT condeferrable)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $storage_review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_catalog_owner;
GRANT USAGE ON TYPE crest.services,crest.service_versions TO crest_catalog_owner;
GRANT SELECT ON crest.services,crest.service_versions TO crest_catalog_owner;
GRANT INSERT(id,business_id,code,current_version_id,active,created_by,updated_by,origin,operation_id) ON crest.services TO crest_catalog_owner;
GRANT UPDATE(current_version_id,active,version,updated_by,operation_id) ON crest.services TO crest_catalog_owner;
GRANT INSERT(id,business_id,service_id,sequence,name,inclusions,exclusions,internal_guidance,range_low_cents,range_high_cents,estimated_seconds,created_by,origin,operation_id) ON crest.service_versions TO crest_catalog_owner;
CREATE POLICY catalog_read ON crest.services FOR SELECT TO crest_catalog_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY catalog_create ON crest.services FOR INSERT TO crest_catalog_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY catalog_edit ON crest.services FOR UPDATE TO crest_catalog_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY catalog_content_read ON crest.service_versions FOR SELECT TO crest_catalog_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY catalog_content_create ON crest.service_versions FOR INSERT TO crest_catalog_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_catalog_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_catalog_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_catalog_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_catalog_owner;
CREATE POLICY catalog_operations_read ON crest_private.operations FOR SELECT TO crest_catalog_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='catalog.service.save');
CREATE POLICY catalog_operations_create ON crest_private.operations FOR INSERT TO crest_catalog_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='catalog.service.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY catalog_operations_finish ON crest_private.operations FOR UPDATE TO crest_catalog_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='catalog.service.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='catalog.service.save');
CREATE POLICY catalog_audits_read ON crest_private.audit_events FOR SELECT TO crest_catalog_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('services','service_versions'));
CREATE POLICY catalog_audits_create ON crest_private.audit_events FOR INSERT TO crest_catalog_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('services','service_versions') AND origin='manual' AND import_row_id IS NULL);
GRANT EXECUTE ON FUNCTION crest_private.service_projection(crest.services),crest_private.service_definition(crest.service_versions),crest_private.service_version_projection(crest.service_versions) TO crest_catalog_owner;

CREATE FUNCTION crest_private.valid_service_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE d jsonb; k text; s text; blanks text:=E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>131072 OR body-ARRAY['code','active','definition']<>'{}'::jsonb OR NOT body ?& ARRAY['code','active','definition'] OR jsonb_typeof(body->'code') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'active') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
 s:=body->>'code';IF char_length(s) NOT BETWEEN 1 AND 80 OR s!~'^[a-z0-9]' OR s~'[^a-z0-9_-]' THEN RETURN false;END IF;
 d:=body->'definition';
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR d-ARRAY['name','inclusions','exclusions','internalGuidance','rangeLowCents','rangeHighCents','estimatedSeconds']<>'{}'::jsonb OR NOT d ?& ARRAY['name','inclusions','exclusions','internalGuidance','rangeLowCents','rangeHighCents','estimatedSeconds'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['name','inclusions','exclusions'] LOOP
  IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' THEN RETURN false;END IF;
  s:=d->>k;
  IF char_length(s)>(CASE WHEN k='name' THEN 200 ELSE 4000 END) OR (k<>'exclusions' AND btrim(s,blanks)='') OR (CASE WHEN k='name' THEN s ELSE translate(s,E'\t\n\r','') END)~'[[:cntrl:]]' THEN RETURN false;END IF;
 END LOOP;
 IF jsonb_typeof(d->'internalGuidance') IS DISTINCT FROM 'null' THEN
  s:=d->>'internalGuidance';
  IF jsonb_typeof(d->'internalGuidance') IS DISTINCT FROM 'string' OR char_length(s)>4000 OR btrim(s,blanks)='' OR translate(s,E'\t\n\r','')~'[[:cntrl:]]' THEN RETURN false;END IF;
 END IF;
 FOREACH k IN ARRAY ARRAY['rangeLowCents','rangeHighCents','estimatedSeconds'] LOOP
  IF jsonb_typeof(d->k) IS DISTINCT FROM 'null' THEN
   IF jsonb_typeof(d->k) IS DISTINCT FROM 'string' THEN RETURN false;END IF;
   s:=d->>k;
   IF char_length(s) NOT BETWEEN 1 AND 19 OR s~'[^0-9]' OR (char_length(s)>1 AND left(s,1)='0') THEN RETURN false;END IF;
   IF s::numeric>9223372036854775807 OR (k='estimatedSeconds' AND s::numeric=0) THEN RETURN false;END IF;
  END IF;
 END LOOP;
 IF d->'rangeHighCents'<>'null'::jsonb AND (d->'rangeLowCents'='null'::jsonb OR (d->>'rangeHighCents')::bigint<(d->>'rangeLowCents')::bigint) THEN RETURN false;END IF;
 RETURN true;
END $valid$;
CREATE FUNCTION crest_commands.authorize_catalog_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_READ_DENIED';END IF;
 RETURN context;
END $read$;
CREATE FUNCTION crest_commands.finish_catalog_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SAVE_DENIED';END IF;
END $finish$;
CREATE FUNCTION crest_private.catalog_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations; a crest_private.audit_events; v crest.service_versions; old_v crest.service_versions; r jsonb; after_row jsonb; before_row jsonb; changed boolean; expected_revision text; digest text; body jsonb; expected_action text; content_audit uuid;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type='catalog.service.save';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','serviceId','serviceRevision','contentVersionId','contentSequence','auditEventId','contentAuditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','serviceId','serviceRevision','contentVersionId','contentSequence','auditEventId','contentAuditEventId'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM requested_business::text OR jsonb_typeof(r->'serviceRevision') IS DISTINCT FROM 'string' OR jsonb_typeof(r->'contentSequence') IS DISTINCT FROM 'string' OR (r->>'serviceRevision')!~'^[1-9][0-9]{0,18}$' OR (r->>'contentSequence')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(r->>'auditEventId')::uuid AND entity_kind='services' AND entity_id=(r->>'serviceId')::uuid AND entity_version=(r->>'serviceRevision')::bigint;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
 after_row:=a.delta->'after';before_row:=a.delta->'before';
 IF jsonb_typeof(after_row) IS DISTINCT FROM 'object' OR after_row-ARRAY['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT after_row ?& ARRAY['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR before_row IS NULL OR (before_row<>'null'::jsonb AND (jsonb_typeof(before_row) IS DISTINCT FROM 'object' OR before_row->>'id' IS DISTINCT FROM after_row->>'id' OR before_row->>'business_id' IS DISTINCT FROM requested_business::text OR before_row->>'code' IS DISTINCT FROM after_row->>'code')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
 expected_revision:=CASE WHEN before_row='null'::jsonb THEN '0' ELSE before_row->>'version' END;
 SELECT * INTO v FROM crest.service_versions WHERE business_id=requested_business AND service_id=(r->>'serviceId')::uuid AND id=(r->>'contentVersionId')::uuid;
 IF NOT FOUND OR v.sequence::text IS DISTINCT FROM r->>'contentSequence' OR after_row->>'current_version_id' IS DISTINCT FROM v.id::text OR after_row->>'id' IS DISTINCT FROM r->>'serviceId' OR after_row->>'business_id' IS DISTINCT FROM requested_business::text OR after_row->>'updated_by' IS DISTINCT FROM requested_actor::text OR after_row->>'operation_id' IS DISTINCT FROM requested_operation::text OR after_row->>'version' IS DISTINCT FROM r->>'serviceRevision' OR (expected_revision::numeric)+1 IS DISTINCT FROM (r->>'serviceRevision')::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
 changed:=before_row='null'::jsonb OR before_row->>'current_version_id' IS DISTINCT FROM after_row->>'current_version_id';
 IF changed THEN
  SELECT id INTO content_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(r->>'contentAuditEventId')::uuid AND entity_kind='service_versions' AND entity_id=v.id AND entity_version=1 AND action='append' AND delta->'before'='null'::jsonb AND delta->'after'=crest_private.service_version_projection(v);
  IF content_audit IS NULL OR v.operation_id<>requested_operation OR v.created_by<>requested_actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
  IF before_row='null'::jsonb THEN
   IF v.sequence<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;expected_action:='create';
  ELSE
   SELECT * INTO old_v FROM crest.service_versions WHERE business_id=requested_business AND service_id=v.service_id AND id=(before_row->>'current_version_id')::uuid;
   IF NOT FOUND OR old_v.sequence::numeric+1<>v.sequence::numeric OR crest_private.service_definition(old_v)=crest_private.service_definition(v) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;expected_action:='edit';
  END IF;
 ELSE
  IF r->'contentAuditEventId'<>'null'::jsonb OR before_row->'active' IS NOT DISTINCT FROM after_row->'active' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
  expected_action:=CASE WHEN (after_row->>'active')::boolean THEN 'reopen' ELSE 'archive' END;
 END IF;
 IF a.action<>expected_action OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>(CASE WHEN changed THEN 2 ELSE 1 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
 body:=jsonb_build_object('code',after_row->'code','active',after_row->'active','definition',crest_private.service_definition(v));
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','catalog.service.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'serviceId',v.service_id,'expectedRevision',expected_revision,'payload',body)::text,'UTF8')),'hex');
 IF NOT crest_private.valid_service_payload(body) OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CATALOG_RESULT_REVIEW_REQUIRED';
END $result$;
CREATE FUNCTION crest_commands.save_service(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_service uuid,expected_revision bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; existing crest_private.operations; old_row crest.services; new_row crest.services; old_v crest.service_versions; new_v crest.service_versions; d jsonb; changed boolean; content_id uuid; event_id uuid; content_event uuid; command_result jsonb; action text; violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_service IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_revision IS NULL OR expected_revision<0 OR NOT crest_private.valid_service_payload(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_INPUT_REQUIRED';END IF;
 BEGIN
  context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
  PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM IN('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_CATALOG_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;
 END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','catalog.service.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'serviceId',requested_service,'expectedRevision',expected_revision::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'catalog.service.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.catalog_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   SELECT * INTO old_row FROM crest.services WHERE business_id=requested_business AND id=requested_service FOR UPDATE;
   IF coalesce(old_row.version,0)<>expected_revision THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_SERVICE_VERSION_CONFLICT';END IF;
   d:=body->'definition';
   IF expected_revision>0 THEN
    IF body->>'code'<>old_row.code THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_SERVICE_CODE_RETAINED';END IF;
    SELECT * INTO old_v FROM crest.service_versions WHERE business_id=requested_business AND service_id=requested_service AND id=old_row.current_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SERVICE_CONTENT_CONFLICT';END IF;
    changed:=crest_private.service_definition(old_v)<>d;
    IF NOT changed AND old_row.active=(body->>'active')::boolean THEN RAISE EXCEPTION USING ERRCODE='P1003',MESSAGE='CREST_SERVICE_UNCHANGED';END IF;
   ELSE changed:=true;
   END IF;
   content_id:=CASE WHEN changed THEN gen_random_uuid() ELSE old_v.id END;
   IF expected_revision=0 THEN
    INSERT INTO crest.services(id,business_id,code,current_version_id,active,created_by,updated_by,origin,operation_id) VALUES(requested_service,requested_business,body->>'code',content_id,(body->>'active')::boolean,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
   END IF;
   IF changed THEN
    INSERT INTO crest.service_versions(id,business_id,service_id,sequence,name,inclusions,exclusions,internal_guidance,range_low_cents,range_high_cents,estimated_seconds,created_by,origin,operation_id) VALUES(content_id,requested_business,requested_service,coalesce(old_v.sequence,0)+1,d->>'name',d->>'inclusions',d->>'exclusions',d->>'internalGuidance',(d->>'rangeLowCents')::bigint,(d->>'rangeHighCents')::bigint,(d->>'estimatedSeconds')::bigint,expected_actor,'manual',requested_operation) RETURNING * INTO new_v;
   ELSE new_v:=old_v;
   END IF;
   IF expected_revision>0 THEN
    UPDATE crest.services SET current_version_id=content_id,active=(body->>'active')::boolean,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_service RETURNING * INTO new_row;
   END IF;
   action:=CASE WHEN expected_revision=0 THEN 'create' WHEN changed THEN 'edit' WHEN new_row.active THEN 'reopen' ELSE 'archive' END;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'services',requested_service,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_revision=0 THEN 'null'::jsonb ELSE crest_private.service_projection(old_row) END,'after',crest_private.service_projection(new_row)),'manual') RETURNING id INTO event_id;
   IF changed THEN
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'service_versions',new_v.id,1,'append',jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.service_version_projection(new_v)),'manual') RETURNING id INTO content_event;
   END IF;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'serviceId',requested_service,'serviceRevision',new_row.version::text,'contentVersionId',new_v.id,'contentSequence',new_v.sequence::text,'auditEventId',event_id,'contentAuditEventId',content_event));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentRevision',coalesce(old_row.version,0)::text);
  WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','code');
  WHEN SQLSTATE 'P1003' THEN RETURN jsonb_build_object('state','unchanged','serviceId',requested_service,'currentRevision',old_row.version::text);
  WHEN unique_violation THEN
   GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
   IF violated='service_code_unique' THEN RETURN jsonb_build_object('state','conflict','reason','code');END IF;
   IF violated='services_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','service');END IF;RAISE;
 END;
END $save$;
CREATE FUNCTION crest_commands.lookup_service_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.catalog_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_commands.read_service_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,search_text text,after_id uuid,include_inactive boolean,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF search_text IS NULL OR char_length(search_text)>200 OR include_inactive IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH matches AS MATERIALIZED(SELECT s.id,crest_private.service_projection(s) AS service,crest_private.service_version_projection(v) AS content FROM crest.services s JOIN crest.service_versions v ON v.business_id=s.business_id AND v.service_id=s.id AND v.id=s.current_version_id WHERE s.business_id=requested_business AND (include_inactive OR s.active) AND (after_id IS NULL OR s.id>after_id) AND (search_text='' OR strpos(lower(s.code),lower(search_text))>0 OR strpos(lower(v.name),lower(search_text))>0) ORDER BY s.id LIMIT page_limit+1),
 page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'services',coalesce((SELECT jsonb_agg(jsonb_build_object('service',service,'content',content) ORDER BY id) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_PAGE_LIMIT';END IF;RETURN result;
END $directory$;
CREATE FUNCTION crest_commands.read_service_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_service uuid,after_revision bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; s crest.services; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_service IS NULL OR after_revision IS NULL OR after_revision<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO s FROM crest.services WHERE business_id=requested_business AND id=requested_service;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 WITH events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='services' AND entity_id=requested_service AND entity_version>after_revision AND entity_version<=s.version ORDER BY entity_version LIMIT page_limit+1),
 page AS(SELECT a.*,v AS content_row FROM events a JOIN crest.service_versions v ON v.business_id=a.business_id AND v.service_id=a.entity_id AND v.id=(a.delta->'after'->>'current_version_id')::uuid ORDER BY a.entity_version LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'service',crest_private.service_projection(s),'history',coalesce((SELECT jsonb_agg(jsonb_build_object('revision',entity_version::text,'eventId',id,'actorId',actor_id,'operationId',operation_id,'at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',action,'before',delta->'before','after',delta->'after','content',crest_private.service_version_projection(content_row)) ORDER BY entity_version) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM events)) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_PAGE_LIMIT';END IF;RETURN result;
END $history$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_catalog_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_catalog_owner;
ALTER FUNCTION crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.valid_service_payload(jsonb) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_private.catalog_operation_result(uuid,uuid,uuid) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.save_service(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.lookup_service_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.read_service_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.read_service_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_catalog_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_catalog_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_catalog_owner;
REVOKE ALL ON FUNCTION crest_private.valid_service_payload(jsonb),crest_private.catalog_operation_result(uuid,uuid,uuid),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.save_service(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_service_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_service_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_service_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_catalog_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_service(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_service_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_service_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,boolean,integer),crest_commands.read_service_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;

-- END REVIEWED CATALOG 2 commands

-- BEGIN REVIEWED CATALOG 3 source
-- Unregistered construction over registered43 + the pinned catalog proposals.
-- Owner export tooling only; no HTTP route, ordinary web grant or adoption.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_catalog_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_catalog_owner')
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_catalog_owner',oid,'CREATE'))
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.services'::regclass,'crest.service_versions'::regclass,'crest.businesses'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED'; END IF;
 IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.services'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.service_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','service_id','sequence','name','inclusions','exclusions','internal_guidance','range_low_cents','range_high_cents','estimated_seconds','created_at','created_by','origin','operation_id','import_row_id']
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED'; END IF;
 IF (SELECT count(*) FROM (VALUES
  ('crest_private.service_projection(crest.services)','7682059c83fe884e2a3e9cd9149a9563633a54181fa6d2e465c2c4f392b991bf'),
  ('crest_private.service_version_projection(crest.service_versions)','896397db79799cbc5983cd807cc7ddf0a66b2302586b044d324336be410689a4')
 ) expected(signature,hash) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.proowner='crest_schema_owner'::regrole AND NOT p.prosecdef AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.hash)<>2
  OR NOT has_table_privilege('crest_catalog_owner','crest.services','SELECT')
  OR NOT has_table_privilege('crest_catalog_owner','crest.service_versions','SELECT')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED'; END IF;
END $review$;
SET ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_catalog_owner;
CREATE POLICY catalog_export_business ON crest.businesses FOR SELECT TO crest_catalog_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.service_catalog_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE roots bigint; content bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CATALOG_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SCOPE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SCOPE_REQUIRED'; END IF;
 SELECT count(*) INTO roots FROM crest.services WHERE business_id=requested_business;
 SELECT count(*) INTO content FROM crest.service_versions WHERE business_id=requested_business;
 IF roots>1000 OR content>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_SNAPSHOT_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','service_catalog','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.service-catalog.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'serviceCount',roots::text,'versionCount',content::text);
END $context$;
CREATE FUNCTION crest_commands.service_catalog_snapshot_services(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.service_catalog_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS(SELECT * FROM crest.services WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'services',coalesce(jsonb_agg(crest_private.service_projection(p::crest.services) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_PAGE_LIMIT'; END IF; RETURN result;
END $page$;
CREATE FUNCTION crest_commands.service_catalog_snapshot_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.service_catalog_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS(SELECT * FROM crest.service_versions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'versions',coalesce(jsonb_agg(crest_private.service_version_projection(p::crest.service_versions) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_PAGE_LIMIT'; END IF; RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_catalog_owner;
ALTER FUNCTION crest_commands.service_catalog_snapshot_context(uuid) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer) OWNER TO crest_catalog_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_catalog_owner;
REVOKE ALL ON FUNCTION crest_commands.service_catalog_snapshot_context(uuid),crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer),crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.service_catalog_snapshot_context(uuid),crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer),crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer) TO crest_export;

-- END REVIEWED CATALOG 3 source

-- BEGIN REVIEWED CATALOG 4 resolution
-- Unregistered catalog original-save recovery; no registration or new grant.
-- Keep registered43 immutable; extend only the existing closed reference validator.
DO $review$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND NOT p.prosecdef AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8b8d306061c3e703c366e1a91186a94fcc169c14a16aa47219daf83f36699cde')
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_integrity_owner','crest_catalog_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_integrity_owner','crest_catalog_owner'))
  OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND a.grantee=0)
  OR to_regprocedure('crest_commands.save_service(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_RESOLUTION_REVIEW_REQUIRED'; END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 keys:=CASE kind
  WHEN 'business.rename' THEN ARRAY['expectedVersion']
  WHEN 'crm.customer.save' THEN ARRAY['customerId','expectedVersion']
  WHEN 'crm.address.save' THEN ARRAY['customerId','addressId','expectedVersion']
  WHEN 'crm.vehicle.save' THEN ARRAY['vehicleId','expectedVersion']
  WHEN 'crm.vehicle.association' THEN ARRAY['action','associationId','vehicleId','expectedVersion','nextAssociationId']
  WHEN 'crm.lead.source.save' THEN ARRAY['leadSourceId','expectedVersion']
  WHEN 'crm.lead.save' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.state' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.vehicle.save' THEN ARRAY['leadId','leadVehicleId','expectedVersion']
  WHEN 'crm.lead.address.save' THEN ARRAY['leadId','leadAddressId','expectedVersion']
  WHEN 'crm.lead.convert' THEN ARRAY['conversionId','leadId','expectedLeadVersion','customerId']
  WHEN 'catalog.service.save' THEN ARRAY['serviceId','expectedRevision'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key IN ('expectedVersion','expectedRevision') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state')) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 RETURN true;
END $$;
RESET ROLE;

-- END REVIEWED CATALOG 4 resolution
