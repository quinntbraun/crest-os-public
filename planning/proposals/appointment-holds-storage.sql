-- Unregistered BR02 prospective calendar notes, not contracted jobs.
-- No migration ordinal, runtime command, reservation, Google event or money.
DO $review$
DECLARE role_id oid;
BEGIN
 SELECT oid INTO role_id FROM pg_roles WHERE rolname='crest_hold_integrity_owner';
 IF role_id IS NULL THEN
  CREATE ROLE crest_hold_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_hold_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
  SELECT oid INTO role_id FROM pg_roles WHERE rolname='crest_hold_integrity_owner';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=role_id AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=role_id OR member=role_id)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=role_id OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(role_id,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=role_id OR has_function_privilege(role_id,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(role_id,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=role_id AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',role_id))) a WHERE a.grantee<>role_id)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=role_id AND a.grantee<>role_id)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_ROLE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_integrity_owner'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass,'crest.customers'::regclass,'crest.leads'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>6
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_hold_integrity_owner;
CREATE TABLE crest.appointment_hold_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 hold_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 replaces_sequence bigint,
 customer_id uuid,
 lead_id uuid,
 label text NOT NULL CHECK(char_length(label)>=1 AND char_length(label)<=200 AND btrim(label)<>'' AND label!~'[[:cntrl:]]'),
 state text NOT NULL CHECK(state IN('proposed','withdrawn')),
 start_at timestamptz NOT NULL CHECK(isfinite(start_at) AND start_at>='0001-01-01T00:00:00Z'::timestamptz AND start_at<'10000-01-01T00:00:00Z'::timestamptz),
 end_at timestamptz NOT NULL CHECK(isfinite(end_at) AND end_at>start_at AND end_at<'10000-01-01T00:00:00Z'::timestamptz),
 timezone text NOT NULL CHECK(char_length(timezone)>=1 AND char_length(timezone)<=100 AND timezone~'^[A-Za-z][A-Za-z0-9_+/-]*$'),
 local_start timestamp NOT NULL CHECK(isfinite(local_start)),
 local_end timestamp NOT NULL CHECK(isfinite(local_end)),
 start_offset_minutes integer NOT NULL CHECK(start_offset_minutes>=-840 AND start_offset_minutes<=840),
 end_offset_minutes integer NOT NULL CHECK(end_offset_minutes>=-840 AND end_offset_minutes<=840),
 notes text CHECK(notes IS NULL OR (char_length(notes)<=2000 AND translate(notes,E'\t\n\r','')!~'[[:cntrl:]]')),
 reason text CHECK(reason IS NULL OR (char_length(reason)>=1 AND char_length(reason)<=1000 AND btrim(reason)<>'' AND translate(reason,E'\t\n\r','')!~'[[:cntrl:]]')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id), UNIQUE(business_id,hold_id,sequence),
 FOREIGN KEY(business_id,hold_id,replaces_sequence) REFERENCES crest.appointment_hold_versions(business_id,hold_id,sequence) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,lead_id) REFERENCES crest.leads(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK((customer_id IS NOT NULL)::integer+(lead_id IS NOT NULL)::integer=1),
 CHECK((sequence=1 AND replaces_sequence IS NULL AND state='proposed') OR (sequence>1 AND replaces_sequence IS NOT NULL AND replaces_sequence=sequence-1 AND reason IS NOT NULL))
);
CREATE INDEX appointment_holds_customer ON crest.appointment_hold_versions(business_id,customer_id);
CREATE INDEX appointment_holds_lead ON crest.appointment_hold_versions(business_id,lead_id);
CREATE INDEX appointment_holds_actor ON crest.appointment_hold_versions(business_id,created_by);
CREATE INDEX appointment_holds_operation ON crest.appointment_hold_versions(business_id,operation_id,created_by);
CREATE INDEX appointment_holds_time ON crest.appointment_hold_versions(business_id,start_at,hold_id,sequence);
ALTER TABLE crest.appointment_hold_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.appointment_hold_versions FORCE ROW LEVEL SECURITY;
CREATE FUNCTION crest_private.appointment_hold_projection(c crest.appointment_hold_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(c)||jsonb_build_object('sequence',(c).sequence::text,'replaces_sequence',(c).replaces_sequence::text,'start_at',to_char((c).start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char((c).end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'local_start',to_char((c).local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),'local_end',to_char((c).local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.reject_appointment_hold_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retained$
 BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_HOLD_HISTORY_RETAINED';END
$retained$;
CREATE FUNCTION crest_private.validate_appointment_hold_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $append$
DECLARE prior crest.appointment_hold_versions; latest bigint;
BEGIN
 -- Both UTC endpoints, actual zone/local facts and reviewed offsets are retained.
 -- A fold requires the explicit instant/offset; a gap cannot pass the round trip.
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone)
  OR NEW.start_at AT TIME ZONE NEW.timezone<>NEW.local_start OR NEW.end_at AT TIME ZONE NEW.timezone<>NEW.local_end
  OR extract(epoch FROM (NEW.local_start-(NEW.start_at AT TIME ZONE 'UTC')))<>NEW.start_offset_minutes::numeric*60
  OR extract(epoch FROM (NEW.local_end-(NEW.end_at AT TIME ZONE 'UTC')))<>NEW.end_offset_minutes::numeric*60
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_TIME_REVIEW_REQUIRED';END IF;
 IF NEW.sequence>1 THEN
  -- One stable root serializes every append without changing historical rows.
  PERFORM 1 FROM crest.appointment_hold_versions WHERE business_id=NEW.business_id AND hold_id=NEW.hold_id AND sequence=1 FOR UPDATE;
  SELECT max(sequence) INTO latest FROM crest.appointment_hold_versions WHERE business_id=NEW.business_id AND hold_id=NEW.hold_id;
  SELECT * INTO prior FROM crest.appointment_hold_versions WHERE business_id=NEW.business_id AND hold_id=NEW.hold_id AND sequence=NEW.replaces_sequence;
  IF prior.id IS NULL OR latest<>NEW.replaces_sequence OR prior.state='withdrawn'
   OR ROW(NEW.customer_id,NEW.lead_id) IS DISTINCT FROM ROW(prior.customer_id,prior.lead_id)
   OR ROW(NEW.label,NEW.state,NEW.start_at,NEW.end_at,NEW.timezone,NEW.local_start,NEW.local_end,NEW.start_offset_minutes,NEW.end_offset_minutes,NEW.notes) IS NOT DISTINCT FROM ROW(prior.label,prior.state,prior.start_at,prior.end_at,prior.timezone,prior.local_start,prior.local_end,prior.start_offset_minutes,prior.end_offset_minutes,prior.notes)
   OR NEW.state='withdrawn' AND ROW(NEW.label,NEW.start_at,NEW.end_at,NEW.timezone,NEW.local_start,NEW.local_end,NEW.start_offset_minutes,NEW.end_offset_minutes,NEW.notes) IS DISTINCT FROM ROW(prior.label,prior.start_at,prior.end_at,prior.timezone,prior.local_start,prior.local_end,prior.start_offset_minutes,prior.end_offset_minutes,prior.notes)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_SEQUENCE_REVIEW_REQUIRED';END IF;
 END IF;
 NEW.created_at:=clock_timestamp();RETURN NEW;
END $append$;
CREATE FUNCTION crest_private.check_appointment_hold_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE prior jsonb:='null'::jsonb;
BEGIN
 IF NEW.sequence>1 THEN SELECT crest_private.appointment_hold_projection(h) INTO prior FROM crest.appointment_hold_versions h WHERE business_id=NEW.business_id AND hold_id=NEW.hold_id AND sequence=NEW.replaces_sequence;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='appointment_holds' AND a.entity_id=NEW.hold_id AND a.entity_version=NEW.sequence AND a.action=CASE WHEN NEW.sequence=1 THEN 'create' WHEN NEW.state='withdrawn' THEN 'withdraw' ELSE 'revise' END AND a.delta->'before'=prior AND a.delta->'after'=crest_private.appointment_hold_projection(NEW::crest.appointment_hold_versions) AND o.command_type='operations.appointment_hold.save' AND o.schema_version=1 AND o.origin=NEW.origin AND o.import_row_id IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $audit$;
CREATE TRIGGER appointment_hold_append BEFORE INSERT ON crest.appointment_hold_versions FOR EACH ROW EXECUTE FUNCTION crest_private.validate_appointment_hold_append();
CREATE CONSTRAINT TRIGGER appointment_hold_audit AFTER INSERT ON crest.appointment_hold_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_appointment_hold_audit();
CREATE TRIGGER appointment_hold_update BEFORE UPDATE ON crest.appointment_hold_versions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_appointment_hold_change();
CREATE TRIGGER appointment_hold_delete BEFORE DELETE ON crest.appointment_hold_versions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_appointment_hold_change();
CREATE TRIGGER appointment_hold_truncate BEFORE TRUNCATE ON crest.appointment_hold_versions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_appointment_hold_change();
CREATE UNIQUE INDEX appointment_hold_audit_sequence ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='appointment_holds';
GRANT USAGE ON TYPE crest.appointment_hold_versions TO crest_hold_integrity_owner;
-- UPDATE privilege is only for SELECT FOR UPDATE. The immutable trigger rejects actual updates.
GRANT SELECT,UPDATE ON crest.appointment_hold_versions TO crest_hold_integrity_owner;
CREATE POLICY hold_integrity_read ON crest.appointment_hold_versions FOR SELECT TO crest_hold_integrity_owner USING(true);
CREATE POLICY hold_integrity_lock ON crest.appointment_hold_versions FOR UPDATE TO crest_hold_integrity_owner USING(true) WITH CHECK(false);
GRANT SELECT(business_id,operation_id,actor_id,command_type,schema_version,origin,import_row_id) ON crest_private.operations TO crest_hold_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta) ON crest_private.audit_events TO crest_hold_integrity_owner;
CREATE POLICY hold_integrity_operations ON crest_private.operations FOR SELECT TO crest_hold_integrity_owner USING(command_type='operations.appointment_hold.save');
CREATE POLICY hold_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_hold_integrity_owner USING(entity_kind='appointment_holds');
GRANT EXECUTE ON FUNCTION crest_private.appointment_hold_projection(crest.appointment_hold_versions) TO crest_hold_integrity_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_hold_integrity_owner;
ALTER FUNCTION crest_private.validate_appointment_hold_append() OWNER TO crest_hold_integrity_owner;
ALTER FUNCTION crest_private.check_appointment_hold_audit() OWNER TO crest_hold_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_hold_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.appointment_hold_projection(crest.appointment_hold_versions),crest_private.reject_appointment_hold_change(),crest_private.validate_appointment_hold_append(),crest_private.check_appointment_hold_audit() FROM PUBLIC;
