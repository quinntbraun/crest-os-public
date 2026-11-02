-- Unregistered construction over49. No command, runtime grant or job confirmation.
-- P08: Mobile and Customer Drop-Off start enabled; Pickup + Return starts disabled.
DO $review$ BEGIN
 IF to_regclass('crest.fulfillment_mode_versions') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_mode_integrity_owner')
  OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>49
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_integrity_owner'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MODE_SOURCE_REVIEW_REQUIRED';END IF;
 CREATE ROLE crest_mode_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_mode_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_mode_integrity_owner;
CREATE TABLE crest.fulfillment_mode_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 sequence bigint NOT NULL CHECK(sequence>0),
 replaces_sequence bigint,
 mobile_enabled boolean NOT NULL,
 dropoff_enabled boolean NOT NULL,
 pickup_return_enabled boolean NOT NULL,
 reason text CHECK(reason IS NULL OR(char_length(reason)>=1 AND char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>'' AND translate(reason,E'\t\n\r','')!~'[[:cntrl:]]')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at) AND created_at>='0001-01-01T00:00:00Z'::timestamptz AND created_at<'10000-01-01T00:00:00Z'::timestamptz),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,sequence),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,replaces_sequence) REFERENCES crest.fulfillment_mode_versions(business_id,sequence) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK((sequence=1 AND replaces_sequence IS NULL AND mobile_enabled AND dropoff_enabled AND NOT pickup_return_enabled AND reason IS NULL) OR(sequence>1 AND replaces_sequence IS NOT NULL AND replaces_sequence=sequence-1 AND reason IS NOT NULL))
);
CREATE INDEX fulfillment_mode_actor ON crest.fulfillment_mode_versions(business_id,created_by);
CREATE INDEX fulfillment_mode_operation_actor ON crest.fulfillment_mode_versions(business_id,operation_id,created_by);
ALTER TABLE crest.fulfillment_mode_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.fulfillment_mode_versions FORCE ROW LEVEL SECURITY;
CREATE FUNCTION crest_private.fulfillment_mode_projection(v crest.fulfillment_mode_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(v)||jsonb_build_object('sequence',(v).sequence::text,'replaces_sequence',(v).replaces_sequence::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.reject_fulfillment_mode_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retain$
 BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_MODE_HISTORY_RETAINED';END
$retain$;
CREATE FUNCTION crest_private.validate_fulfillment_mode_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $append$
DECLARE prior crest.fulfillment_mode_versions;latest bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MODE_FRESH_READ_REQUIRED';END IF;
 -- Initialization and all later revisions share one lock, including the empty
 -- history case. No UPDATE grant on the business root is required for locking.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||NEW.business_id::text,0));
 SELECT max(sequence) INTO latest FROM crest.fulfillment_mode_versions WHERE business_id=NEW.business_id;
 IF NEW.sequence=1 THEN
  IF latest IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_SEQUENCE_REVIEW_REQUIRED';END IF;
 ELSE
  SELECT * INTO prior FROM crest.fulfillment_mode_versions WHERE business_id=NEW.business_id AND sequence=NEW.replaces_sequence;
  IF prior.id IS NULL OR latest IS DISTINCT FROM NEW.replaces_sequence OR ROW(NEW.mobile_enabled,NEW.dropoff_enabled,NEW.pickup_return_enabled) IS NOT DISTINCT FROM ROW(prior.mobile_enabled,prior.dropoff_enabled,prior.pickup_return_enabled)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_SEQUENCE_REVIEW_REQUIRED';END IF;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $append$;
CREATE FUNCTION crest_private.check_fulfillment_mode_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE prior jsonb:='null'::jsonb;
BEGIN
 IF NEW.sequence>1 THEN SELECT crest_private.fulfillment_mode_projection(v) INTO prior FROM crest.fulfillment_mode_versions v WHERE business_id=NEW.business_id AND sequence=NEW.replaces_sequence;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='fulfillment_modes' AND a.entity_id=NEW.business_id AND a.entity_version=NEW.sequence AND a.action=CASE WHEN NEW.sequence=1 THEN 'initialize' ELSE 'revise' END AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',crest_private.fulfillment_mode_projection(NEW::crest.fulfillment_mode_versions)) AND o.state='committed' AND o.schema_version=1 AND o.origin=NEW.origin AND o.import_row_id IS NULL AND(NEW.sequence=1 AND o.command_type IN('operations.fulfillment_modes.initialize','operations.job.book') OR NEW.sequence>1 AND o.command_type='operations.fulfillment_modes.save'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $audit$;
CREATE TRIGGER fulfillment_mode_append BEFORE INSERT ON crest.fulfillment_mode_versions FOR EACH ROW EXECUTE FUNCTION crest_private.validate_fulfillment_mode_append();
CREATE CONSTRAINT TRIGGER fulfillment_mode_audit AFTER INSERT ON crest.fulfillment_mode_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_fulfillment_mode_audit();
CREATE TRIGGER fulfillment_mode_update BEFORE UPDATE ON crest.fulfillment_mode_versions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_fulfillment_mode_change();
CREATE TRIGGER fulfillment_mode_delete BEFORE DELETE ON crest.fulfillment_mode_versions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_fulfillment_mode_change();
CREATE TRIGGER fulfillment_mode_truncate BEFORE TRUNCATE ON crest.fulfillment_mode_versions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_fulfillment_mode_change();
CREATE UNIQUE INDEX fulfillment_mode_audit_sequence ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='fulfillment_modes';
GRANT USAGE ON TYPE crest.fulfillment_mode_versions TO crest_mode_integrity_owner;
GRANT SELECT ON crest.fulfillment_mode_versions TO crest_mode_integrity_owner;
CREATE POLICY mode_integrity_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_mode_integrity_owner USING(true);
GRANT SELECT(business_id,operation_id,actor_id,command_type,state,schema_version,origin,import_row_id) ON crest_private.operations TO crest_mode_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta) ON crest_private.audit_events TO crest_mode_integrity_owner;
CREATE POLICY mode_integrity_operations ON crest_private.operations FOR SELECT TO crest_mode_integrity_owner USING(command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book'));
CREATE POLICY mode_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_mode_integrity_owner USING(entity_kind='fulfillment_modes');
GRANT EXECUTE ON FUNCTION crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions) TO crest_mode_integrity_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_mode_integrity_owner;
ALTER FUNCTION crest_private.validate_fulfillment_mode_append() OWNER TO crest_mode_integrity_owner;
ALTER FUNCTION crest_private.check_fulfillment_mode_audit() OWNER TO crest_mode_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_mode_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions),crest_private.reject_fulfillment_mode_change(),crest_private.validate_fulfillment_mode_append(),crest_private.check_fulfillment_mode_audit() FROM PUBLIC;
