-- Registered47 unconfirmed appointment proposals. No reservation, confirmed job or production activation.

RESET ROLE;
-- BEGIN REVIEWED APPOINTMENT 1
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

RESET ROLE;

RESET ROLE;
-- BEGIN REVIEWED APPOINTMENT 2
-- Isolated, unregistered prospective-note commands over registered44 + hold storage.
-- crm.manage is the existing owner-only nonfinancial capability. No job confirmation.
DO $review$
DECLARE r oid;
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='crest_hold_owner';
 IF r IS NULL THEN CREATE ROLE crest_hold_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;ALTER DEFAULT PRIVILEGES FOR ROLE crest_hold_owner REVOKE ALL ON ROUTINES FROM PUBLIC;SELECT oid INTO r FROM pg_roles WHERE rolname='crest_hold_owner';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=r OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=r AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',r))) a WHERE a.grantee<>r)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_COMMAND_ROLE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.appointment_hold_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT count(*) FROM pg_attribute WHERE attrelid='crest.appointment_hold_versions'::regclass AND attnum>0 AND NOT attisdropped)<>22
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_hold_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN('crest_schema_owner','crest_session_owner','crest_hold_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_hold_owner;
GRANT USAGE ON TYPE crest.appointment_hold_versions TO crest_hold_owner;
GRANT SELECT,INSERT ON crest.appointment_hold_versions TO crest_hold_owner;
CREATE POLICY holds_read ON crest.appointment_hold_versions FOR SELECT TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY holds_create ON crest.appointment_hold_versions FOR INSERT TO crest_hold_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_hold_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_hold_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_hold_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_hold_owner;
CREATE POLICY hold_operations_read ON crest_private.operations FOR SELECT TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.appointment_hold.save');
CREATE POLICY hold_operations_create ON crest_private.operations FOR INSERT TO crest_hold_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.appointment_hold.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY hold_operations_finish ON crest_private.operations FOR UPDATE TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.appointment_hold.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.appointment_hold.save');
CREATE POLICY hold_audits_read ON crest_private.audit_events FOR SELECT TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='appointment_holds');
CREATE POLICY hold_audits_create ON crest_private.audit_events FOR INSERT TO crest_hold_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='appointment_holds' AND origin='manual' AND import_row_id IS NULL);
CREATE FUNCTION crest_private.appointment_hold_payload(h crest.appointment_hold_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $payload$
 SELECT crest_private.appointment_hold_projection(h)-ARRAY['id','business_id','hold_id','sequence','replaces_sequence','created_at','created_by','operation_id','origin']
$payload$;
CREATE FUNCTION crest_private.valid_appointment_hold_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text;s text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>32768 OR body-ARRAY['customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason']<>'{}'::jsonb OR NOT body ?& ARRAY['customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['customer_id','lead_id'] LOOP IF body->k<>'null'::jsonb AND (jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR (body->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RETURN false;END IF;END LOOP;
 IF (body->'customer_id'='null'::jsonb)=(body->'lead_id'='null'::jsonb) OR jsonb_typeof(body->'state') IS DISTINCT FROM 'string' OR body->>'state' NOT IN('proposed','withdrawn') THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['label','notes','reason'] LOOP
  IF k='label' OR body->k<>'null'::jsonb THEN s:=body->>k;IF jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR char_length(s)>(CASE WHEN k='label' THEN 200 WHEN k='notes' THEN 2000 ELSE 1000 END) OR (k<>'notes' AND btrim(s)='') OR (CASE WHEN k='label' THEN s ELSE translate(s,E'\t\n\r','') END)~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['start_at','end_at'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR (body->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR (body->>k)<'0001-' THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['local_start','local_end'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR (body->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$' OR (body->>k)<'0001-' THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['start_offset_minutes','end_offset_minutes'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'number' OR (body->>k)!~'^-?[0-9]{1,3}$' OR abs((body->>k)::integer)>840 THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['start_at','end_at'] LOOP IF to_char((body->>k)::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>body->>k THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['local_start','local_end'] LOOP IF to_char((body->>k)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.US')<>body->>k THEN RETURN false;END IF;END LOOP;
 IF jsonb_typeof(body->'timezone') IS DISTINCT FROM 'string' OR char_length(body->>'timezone')>100 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=body->>'timezone') THEN RETURN false;END IF;
 IF (body->>'end_at')::timestamptz<=(body->>'start_at')::timestamptz OR (body->>'start_at')::timestamptz AT TIME ZONE (body->>'timezone')<>(body->>'local_start')::timestamp OR (body->>'end_at')::timestamptz AT TIME ZONE (body->>'timezone')<>(body->>'local_end')::timestamp
  OR extract(epoch FROM ((body->>'local_start')::timestamp-((body->>'start_at')::timestamptz AT TIME ZONE 'UTC')))<>(body->>'start_offset_minutes')::numeric*60 OR extract(epoch FROM ((body->>'local_end')::timestamp-((body->>'end_at')::timestamptz AT TIME ZONE 'UTC')))<>(body->>'end_offset_minutes')::numeric*60
 THEN RETURN false;END IF;RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN RETURN false;
END $valid$;
CREATE FUNCTION crest_private.appointment_hold_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;h crest.appointment_hold_versions;p crest.appointment_hold_versions;a crest_private.audit_events;r jsonb;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.appointment_hold.save';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','holdId','sequence','versionId','auditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','holdId','sequence','versionId','auditEventId'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO h FROM crest.appointment_hold_versions WHERE business_id=business AND id=(r->>'versionId')::uuid AND hold_id=(r->>'holdId')::uuid AND sequence::text=r->>'sequence' AND created_by=actor AND operation_id=operation;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'auditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='appointment_holds' AND entity_id=h.hold_id AND entity_version=h.sequence;
 IF h.id IS NULL OR a.id IS NULL OR a.delta->'after' IS DISTINCT FROM crest_private.appointment_hold_projection(h) OR a.action IS DISTINCT FROM (CASE WHEN h.sequence=1 THEN 'create' WHEN h.state='withdrawn' THEN 'withdraw' ELSE 'revise' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 IF h.sequence>1 THEN SELECT * INTO p FROM crest.appointment_hold_versions WHERE business_id=business AND hold_id=h.hold_id AND sequence=h.replaces_sequence;END IF;
 IF a.delta->'before' IS DISTINCT FROM (CASE WHEN h.sequence=1 THEN 'null'::jsonb ELSE crest_private.appointment_hold_projection(p) END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.appointment_hold.save','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'holdId',h.hold_id,'expectedSequence',(h.sequence-1)::text,'payload',crest_private.appointment_hold_payload(h))::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
CREATE FUNCTION crest_commands.save_appointment_hold(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_hold uuid,expected_sequence bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;prior crest.appointment_hold_versions;h crest.appointment_hold_versions;event uuid;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_hold IS NULL OR expected_sequence IS NULL OR expected_sequence<0 OR expected_sequence=9223372036854775807 OR NOT crest_private.valid_appointment_hold_payload(body) OR expected_sequence=0 AND body->>'state'<>'proposed' OR expected_sequence>0 AND body->'reason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.appointment_hold.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'holdId',requested_hold,'expectedSequence',expected_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.appointment_hold.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.appointment_hold_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('appointment-hold:'||requested_business::text||':'||requested_hold::text,0));
   SELECT * INTO prior FROM crest.appointment_hold_versions WHERE business_id=requested_business AND hold_id=requested_hold ORDER BY sequence DESC LIMIT 1;
   IF coalesce(prior.sequence,0)<>expected_sequence THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_HOLD_SEQUENCE_CONFLICT';END IF;
   IF prior.state='withdrawn' OR expected_sequence>0 AND ((body->>'customer_id')::uuid IS DISTINCT FROM prior.customer_id OR (body->>'lead_id')::uuid IS DISTINCT FROM prior.lead_id) THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_HOLD_REVIEW_REQUIRED';END IF;
   INSERT INTO crest.appointment_hold_versions(business_id,hold_id,sequence,replaces_sequence,customer_id,lead_id,label,state,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,notes,reason,created_by,operation_id) VALUES(requested_business,requested_hold,expected_sequence+1,CASE WHEN expected_sequence=0 THEN NULL ELSE expected_sequence END,(body->>'customer_id')::uuid,(body->>'lead_id')::uuid,body->>'label',body->>'state',(body->>'start_at')::timestamptz,(body->>'end_at')::timestamptz,body->>'timezone',(body->>'local_start')::timestamp,(body->>'local_end')::timestamp,(body->>'start_offset_minutes')::integer,(body->>'end_offset_minutes')::integer,body->>'notes',body->>'reason',expected_actor,requested_operation) RETURNING * INTO h;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'appointment_holds',requested_hold,h.sequence,CASE WHEN h.sequence=1 THEN 'create' WHEN h.state='withdrawn' THEN 'withdraw' ELSE 'revise' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN h.sequence=1 THEN 'null'::jsonb ELSE crest_private.appointment_hold_projection(prior) END,'after',crest_private.appointment_hold_projection(h)),'manual') RETURNING id INTO event;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'holdId',requested_hold,'sequence',h.sequence::text,'versionId',h.id,'auditEventId',event));UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentSequence',coalesce(prior.sequence,0)::text);WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','review');END;
END $save$;
CREATE FUNCTION crest_commands.lookup_appointment_hold_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.appointment_hold_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_commands.read_appointment_holds(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_hold uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF page_limit IS NULL OR page_limit<1 OR page_limit>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH latest AS(SELECT DISTINCT ON(hold_id) hold_id,crest_private.appointment_hold_projection(h) AS row FROM crest.appointment_hold_versions h WHERE business_id=requested_business AND (after_hold IS NULL OR hold_id>after_hold) ORDER BY hold_id,sequence DESC),bounded AS(SELECT * FROM latest ORDER BY hold_id LIMIT page_limit+1),page AS(SELECT * FROM bounded ORDER BY hold_id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'holds',coalesce((SELECT jsonb_agg(row ORDER BY hold_id) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM bounded)) INTO result;RETURN result;
END $list$;
CREATE FUNCTION crest_commands.read_appointment_hold_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_hold uuid,after_sequence bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;latest bigint;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_hold IS NULL OR after_sequence IS NULL OR after_sequence<0 OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT max(sequence) INTO latest FROM crest.appointment_hold_versions WHERE business_id=requested_business AND hold_id=requested_hold;IF latest IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 WITH page AS(SELECT sequence,crest_private.appointment_hold_projection(h) AS row FROM crest.appointment_hold_versions h WHERE business_id=requested_business AND hold_id=requested_hold AND sequence>after_sequence AND sequence<=latest ORDER BY sequence LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'holdId',requested_hold,'currentSequence',latest::text,'versions',coalesce((SELECT jsonb_agg(row ORDER BY sequence) FROM page),'[]'::jsonb),'hasMore',latest::numeric-after_sequence>page_limit) INTO result;RETURN result;
END $history$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.appointment_hold_projection(crest.appointment_hold_versions) TO crest_hold_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_hold_owner;
ALTER FUNCTION crest_private.appointment_hold_payload(crest.appointment_hold_versions) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_private.valid_appointment_hold_payload(jsonb) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_private.appointment_hold_operation_result(uuid,uuid,uuid) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.lookup_appointment_hold_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.read_appointment_holds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.read_appointment_hold_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_hold_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_hold_owner;
REVOKE ALL ON FUNCTION crest_private.appointment_hold_payload(crest.appointment_hold_versions),crest_private.valid_appointment_hold_payload(jsonb),crest_private.appointment_hold_operation_result(uuid,uuid,uuid),crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_appointment_hold_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_appointment_holds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_hold_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_appointment_hold_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_appointment_holds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) TO crest_web;
REVOKE ALL ON FUNCTION crest_commands.read_appointment_hold_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_appointment_hold_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;

RESET ROLE;

RESET ROLE;
-- BEGIN REVIEWED APPOINTMENT 3
-- Unregistered hold reference extension over the reviewed quote46 validator.
-- Same immutable identity/ACL and shared retirement protocol. No finance kinds.
DO $review$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND NOT p.prosecdef AND p.provolatile='i' AND NOT p.proleakproof AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='63a1f92b206081c6734f0b081913a3974e30342c95a993029c02b1ff4fe26d61')
  OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND a.grantee NOT IN('crest_schema_owner'::regrole,'crest_command_owner'::regrole))
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_hold_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_RESOLUTION_REVIEW_REQUIRED';END IF;
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
  WHEN 'catalog.service.save' THEN ARRAY['serviceId','expectedRevision']
  WHEN 'operations.appointment_hold.save' THEN ARRAY['holdId','expectedSequence']
  WHEN 'quote.draft.save' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion']
  WHEN 'quote.review.submit' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion']
  WHEN 'quote.review.approve' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key IN ('expectedSequence','expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state','quote.review.submit','quote.review.approve')) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 RETURN true;
END $$;
RESET ROLE;

RESET ROLE;

RESET ROLE;
-- BEGIN REVIEWED APPOINTMENT 4
-- Unregistered source snapshot RPCs. Reuse the existing export credential and
-- one owned read-only repeatable-read transaction. No new archive framework.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_hold_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_hold_owner')
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_hold_owner',oid,'CREATE'))
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.appointment_hold_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.appointment_hold_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','hold_id','sequence','replaces_sequence','customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason','created_at','created_by','operation_id','origin']

  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.appointment_hold_projection(crest.appointment_hold_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND NOT proleakproof AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='4d8d261441e757bd25a5e23644fa8e4b9ccffd0eeef68de37206b2d886e7823c') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_hold_owner;
CREATE POLICY hold_export_business ON crest.businesses FOR SELECT TO crest_hold_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.appointment_hold_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE versions bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_HOLD_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_SCOPE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO versions FROM crest.appointment_hold_versions WHERE business_id=requested_business;
 IF versions>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_HOLD_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','appointment_holds','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.appointment-hold.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'expectedVersionCount',versions::text);
END $context$;
CREATE FUNCTION crest_commands.appointment_hold_snapshot_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.appointment_hold_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.appointment_hold_versions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'versions',coalesce(jsonb_agg(crest_private.appointment_hold_projection(p::crest.appointment_hold_versions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.appointment_hold_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_HOLD_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_hold_owner;
ALTER FUNCTION crest_commands.appointment_hold_snapshot_context(uuid) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.appointment_hold_snapshot_versions(uuid,text,uuid,integer) OWNER TO crest_hold_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_hold_owner;
REVOKE ALL ON FUNCTION crest_commands.appointment_hold_snapshot_context(uuid),crest_commands.appointment_hold_snapshot_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.appointment_hold_snapshot_context(uuid),crest_commands.appointment_hold_snapshot_versions(uuid,text,uuid,integer) TO crest_export;

RESET ROLE;
