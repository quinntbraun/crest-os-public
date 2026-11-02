-- Confirmed booking schema50 candidate. Synthetic construction only.
-- Reviewed SQL bytes are unchanged. The coordinator owns one atomic transaction.
-- Runtime/production/real-data/financial activation and full V1 release remain gated.
DO $candidate_review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_command_owner','crest_quote_owner','crest_export_owner','crest_export','crest_web') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>7 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING50_SOURCE_REVIEW_REQUIRED';END IF;
END $candidate_review$;

RESET ROLE;
-- BEGIN REVIEWED fulfillment-mode-storage.sql
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

RESET ROLE;
-- END REVIEWED fulfillment-mode-storage.sql

RESET ROLE;
-- BEGIN REVIEWED fulfillment-mode-commands.sql
-- Unregistered owner mode settings over49 plus reviewed mode storage.
-- Existing crm.manage is owner-only nonfinancial authority; no booking/finance grant.
DO $review$
DECLARE r oid;
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='crest_mode_owner';
 IF r IS NULL THEN CREATE ROLE crest_mode_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;ALTER DEFAULT PRIVILEGES FOR ROLE crest_mode_owner REVOKE ALL ON ROUTINES FROM PUBLIC;SELECT oid INTO r FROM pg_roles WHERE rolname='crest_mode_owner';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=r OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=r AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',r))) a WHERE a.grantee<>r)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MODE_COMMAND_ROLE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT count(*) FROM pg_attribute WHERE attrelid='crest.fulfillment_mode_versions'::regclass AND attnum>0 AND NOT attisdropped)<>12
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_mode_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN('crest_schema_owner','crest_session_owner','crest_mode_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MODE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_mode_owner;
GRANT USAGE ON TYPE crest.fulfillment_mode_versions TO crest_mode_owner;
GRANT SELECT,INSERT ON crest.fulfillment_mode_versions TO crest_mode_owner;
CREATE POLICY modes_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY modes_create ON crest.fulfillment_mode_versions FOR INSERT TO crest_mode_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_mode_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_mode_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_mode_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_mode_owner;
CREATE POLICY mode_operations_read ON crest_private.operations FOR SELECT TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save'));
CREATE POLICY mode_operations_create ON crest_private.operations FOR INSERT TO crest_mode_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mode_operations_finish ON crest_private.operations FOR UPDATE TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save'));
CREATE POLICY mode_audits_read ON crest_private.audit_events FOR SELECT TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='fulfillment_modes');
CREATE POLICY mode_audits_create ON crest_private.audit_events FOR INSERT TO crest_mode_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='fulfillment_modes' AND origin='manual' AND import_row_id IS NULL);
CREATE FUNCTION crest_private.fulfillment_mode_payload(v crest.fulfillment_mode_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $payload$
 SELECT jsonb_build_object('mobileEnabled',(v).mobile_enabled,'dropoffEnabled',(v).dropoff_enabled,'pickupReturnEnabled',(v).pickup_return_enabled,'reason',(v).reason)
$payload$;
CREATE FUNCTION crest_private.valid_fulfillment_mode_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text;s text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>8192 OR body-ARRAY['mobileEnabled','dropoffEnabled','pickupReturnEnabled','reason']<>'{}'::jsonb OR NOT body ?& ARRAY['mobileEnabled','dropoffEnabled','pickupReturnEnabled','reason'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['mobileEnabled','dropoffEnabled','pickupReturnEnabled'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;END LOOP;
 IF body->'reason'<>'null'::jsonb THEN s:=body->>'reason';IF jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR char_length(s)<1 OR char_length(s)>1000 OR btrim(s,E' \t\n\r')='' OR translate(s,E'\t\n\r','')~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;RETURN true;
END $valid$;
CREATE FUNCTION crest_private.fulfillment_mode_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;v crest.fulfillment_mode_versions;p crest.fulfillment_mode_versions;a crest_private.audit_events;r jsonb;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save');IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','sequence','versionId','auditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','sequence','versionId','auditEventId'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO v FROM crest.fulfillment_mode_versions WHERE business_id=business AND id=(r->>'versionId')::uuid AND sequence::text=r->>'sequence' AND created_by=actor AND operation_id=operation;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'auditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='fulfillment_modes' AND entity_id=business AND entity_version=v.sequence;
 IF v.sequence>1 THEN SELECT * INTO p FROM crest.fulfillment_mode_versions WHERE business_id=business AND sequence=v.replaces_sequence;END IF;
 IF v.id IS NULL OR a.id IS NULL OR a.action IS DISTINCT FROM (CASE WHEN v.sequence=1 THEN 'initialize' ELSE 'revise' END) OR a.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',CASE WHEN v.sequence=1 THEN 'null'::jsonb ELSE crest_private.fulfillment_mode_projection(p) END,'after',crest_private.fulfillment_mode_projection(v)) OR o.command_type IS DISTINCT FROM (CASE WHEN v.sequence=1 THEN 'operations.fulfillment_modes.initialize' ELSE 'operations.fulfillment_modes.save' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType',o.command_type,'schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'expectedSequence',(v.sequence-1)::text,'payload',crest_private.fulfillment_mode_payload(v))::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
CREATE FUNCTION crest_commands.save_fulfillment_modes(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,expected_sequence bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb;kind text;digest text;claim uuid;existing crest_private.operations;prior crest.fulfillment_mode_versions;v crest.fulfillment_mode_versions;event uuid;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR expected_sequence IS NULL OR expected_sequence<0 OR expected_sequence=9223372036854775807 OR NOT crest_private.valid_fulfillment_mode_payload(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 IF expected_sequence=0 AND body IS DISTINCT FROM jsonb_build_object('mobileEnabled',true,'dropoffEnabled',true,'pickupReturnEnabled',false,'reason',NULL) OR expected_sequence>0 AND body->'reason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 kind:=CASE WHEN expected_sequence=0 THEN 'operations.fulfillment_modes.initialize' ELSE 'operations.fulfillment_modes.save' END;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType',kind,'schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'expectedSequence',expected_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,kind,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.fulfillment_mode_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO prior FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF coalesce(prior.sequence,0)<>expected_sequence THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_MODE_SEQUENCE_CONFLICT';END IF;
   IF expected_sequence>0 AND ROW((body->>'mobileEnabled')::boolean,(body->>'dropoffEnabled')::boolean,(body->>'pickupReturnEnabled')::boolean) IS NOT DISTINCT FROM ROW(prior.mobile_enabled,prior.dropoff_enabled,prior.pickup_return_enabled) THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_MODE_REVIEW_REQUIRED';END IF;
   INSERT INTO crest.fulfillment_mode_versions(business_id,sequence,replaces_sequence,mobile_enabled,dropoff_enabled,pickup_return_enabled,reason,created_by,operation_id) VALUES(requested_business,expected_sequence+1,CASE WHEN expected_sequence=0 THEN NULL ELSE expected_sequence END,(body->>'mobileEnabled')::boolean,(body->>'dropoffEnabled')::boolean,(body->>'pickupReturnEnabled')::boolean,body->>'reason',expected_actor,requested_operation) RETURNING * INTO v;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'fulfillment_modes',requested_business,v.sequence,CASE WHEN v.sequence=1 THEN 'initialize' ELSE 'revise' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN v.sequence=1 THEN 'null'::jsonb ELSE crest_private.fulfillment_mode_projection(prior) END,'after',crest_private.fulfillment_mode_projection(v)),'manual') RETURNING id INTO event;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'sequence',v.sequence::text,'versionId',v.id,'auditEventId',event));UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentSequence',coalesce(prior.sequence,0)::text);WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','review');END;
END $save$;
CREATE FUNCTION crest_commands.lookup_fulfillment_mode_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.fulfillment_mode_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_commands.read_fulfillment_mode_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_sequence bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;latest bigint;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF after_sequence IS NULL OR after_sequence<0 OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT max(sequence) INTO latest FROM crest.fulfillment_mode_versions WHERE business_id=requested_business;IF latest IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 WITH page AS(SELECT sequence,crest_private.fulfillment_mode_projection(v) AS row FROM crest.fulfillment_mode_versions v WHERE business_id=requested_business AND sequence>after_sequence AND sequence<=latest ORDER BY sequence LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'currentSequence',latest::text,'versions',coalesce((SELECT jsonb_agg(row ORDER BY sequence) FROM page),'[]'::jsonb),'hasMore',latest::numeric-after_sequence>page_limit) INTO result;RETURN result;
END $history$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions) TO crest_mode_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_mode_owner;
ALTER FUNCTION crest_private.fulfillment_mode_payload(crest.fulfillment_mode_versions) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_private.valid_fulfillment_mode_payload(jsonb) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_private.fulfillment_mode_operation_result(uuid,uuid,uuid) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_commands.read_fulfillment_mode_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint,integer) OWNER TO crest_mode_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_mode_owner;
REVOKE ALL ON FUNCTION crest_private.fulfillment_mode_payload(crest.fulfillment_mode_versions),crest_private.valid_fulfillment_mode_payload(jsonb),crest_private.fulfillment_mode_operation_result(uuid,uuid,uuid),crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb),crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_fulfillment_mode_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_mode_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb),crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_fulfillment_mode_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint,integer) TO crest_web;

RESET ROLE;
-- END REVIEWED fulfillment-mode-commands.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-storage.sql
-- Unregistered confirmed-booking construction over49 + mode storage.
-- Source49 commercial rows remain unchanged. No runtime grants or activation.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>49 OR to_regclass('crest.fulfillment_mode_versions') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner')
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=ANY(ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events']))
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_schema_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid='crest_schema_owner'::regrole OR m.member='crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_REVIEW_REQUIRED';END IF;
 CREATE ROLE crest_booking_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_booking_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
-- Required composite target for the job/accepted-agreement/customer binding;
-- existing agreement rows, original migration bytes and semantics stay intact.
ALTER TABLE crest.agreements ADD CONSTRAINT agreement_booking_customer UNIQUE(business_id,id,family_id,customer_id);
CREATE TABLE crest.jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 customer_id uuid NOT NULL, operator_actor_id uuid NOT NULL, fulfillment_mode text NOT NULL CHECK(fulfillment_mode IN('mobile','dropoff','pickup_return')),mode_version_id uuid NOT NULL,work_address_id uuid,work_location_snapshot jsonb NOT NULL CHECK(jsonb_typeof(work_location_snapshot)='object'),state text NOT NULL CHECK(state IN('scheduled','en_route','in_progress','paused','completed','cancelled')),current_appointment_id uuid NOT NULL,first_work_at timestamptz,completed_at timestamptz,completion_outcome text CHECK(completion_outcome IN('full','partial')),version bigint NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL,
 FOREIGN KEY(business_id,work_address_id) REFERENCES crest.addresses(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),FOREIGN KEY(business_id,operator_actor_id) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,mode_version_id) REFERENCES crest.fulfillment_mode_versions(business_id,id),FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id),CHECK(isfinite(updated_at) AND updated_at>=created_at),CHECK((state='completed')=(completed_at IS NOT NULL AND completion_outcome IS NOT NULL)),CHECK(state='completed' OR completed_at IS NULL AND completion_outcome IS NULL),CHECK(first_work_at IS NULL OR isfinite(first_work_at)),CHECK(completed_at IS NULL OR isfinite(completed_at) AND first_work_at IS NOT NULL AND completed_at>=first_work_at),UNIQUE(business_id,id,customer_id),UNIQUE(business_id,id,operator_actor_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.jobs FORCE ROW LEVEL SECURITY;
CREATE INDEX jobs_actor_operation ON crest.jobs(business_id,operation_id,created_by);
CREATE TABLE crest.job_vehicles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,vehicle_id uuid NOT NULL,customer_vehicle_id uuid,vehicle_snapshot jsonb NOT NULL CHECK(jsonb_typeof(vehicle_snapshot)='object'),customer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(customer_snapshot)='object'),pickup_address_id uuid,return_address_id uuid,pickup_location_snapshot jsonb,return_location_snapshot jsonb,
 FOREIGN KEY(business_id,pickup_address_id) REFERENCES crest.addresses(business_id,id),FOREIGN KEY(business_id,return_address_id) REFERENCES crest.addresses(business_id,id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),FOREIGN KEY(business_id,customer_vehicle_id) REFERENCES crest.customer_vehicles(business_id,id),UNIQUE(business_id,job_id,vehicle_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.job_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.job_vehicles FORCE ROW LEVEL SECURITY;
CREATE INDEX job_vehicles_actor_operation ON crest.job_vehicles(business_id,operation_id,created_by);
CREATE TABLE crest.job_encounters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,customer_id uuid NOT NULL,family_id uuid NOT NULL,agreement_id uuid NOT NULL,encounter_id uuid NOT NULL,
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),FOREIGN KEY(business_id,agreement_id,family_id,customer_id) REFERENCES crest.agreements(business_id,id,family_id,customer_id),UNIQUE(business_id,job_id,family_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.job_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.job_encounters FORCE ROW LEVEL SECURITY;
CREATE INDEX job_encounters_actor_operation ON crest.job_encounters(business_id,operation_id,created_by);
CREATE TABLE crest.appointments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,start_at timestamptz NOT NULL,end_at timestamptz NOT NULL,timezone text NOT NULL,local_start timestamp NOT NULL,local_end timestamp NOT NULL,start_offset_minutes integer NOT NULL,end_offset_minutes integer NOT NULL,travel_before_seconds integer CHECK(travel_before_seconds>=0),travel_after_seconds integer CHECK(travel_after_seconds>=0),confirmation_state text NOT NULL CHECK(confirmation_state IN('proposed','confirmed','withdrawn','cancelled')),customer_confirmation jsonb,contact_snapshot jsonb NOT NULL,unknown_travel_reviewed boolean NOT NULL,reason text,
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,job_id,sequence),UNIQUE(business_id,id,job_id),UNIQUE(business_id,id,job_id,sequence),FOREIGN KEY(business_id,replaces_id,job_id) REFERENCES crest.appointments(business_id,id,job_id),CHECK(isfinite(start_at) AND isfinite(end_at) AND end_at>start_at),CHECK(sequence=1 AND replaces_id IS NULL OR sequence>1 AND replaces_id IS NOT NULL),CHECK(confirmation_state<>'confirmed' OR jsonb_typeof(customer_confirmation) IS NOT DISTINCT FROM 'object'),CHECK(jsonb_typeof(contact_snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.appointments FORCE ROW LEVEL SECURITY;
CREATE INDEX appointments_actor_operation ON crest.appointments(business_id,operation_id,created_by);
CREATE TABLE crest.operator_controls(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 operator_actor_id uuid NOT NULL,
 FOREIGN KEY(business_id,operator_actor_id) REFERENCES crest.memberships(business_id,actor_id),UNIQUE(business_id,operator_actor_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.operator_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.operator_controls FORCE ROW LEVEL SECURITY;
CREATE INDEX operator_controls_actor_operation ON crest.operator_controls(business_id,operation_id,created_by);
CREATE TABLE crest.schedule_reservations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,appointment_id uuid NOT NULL,operator_actor_id uuid NOT NULL,blocked_interval tstzrange NOT NULL,unknown_travel boolean NOT NULL,override_id uuid,
 FOREIGN KEY(business_id,job_id,operator_actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),FOREIGN KEY(business_id,appointment_id,job_id) REFERENCES crest.appointments(business_id,id,job_id),CHECK(NOT isempty(blocked_interval) AND NOT lower_inf(blocked_interval) AND NOT upper_inf(blocked_interval) AND lower_inc(blocked_interval) AND NOT upper_inc(blocked_interval)),UNIQUE(business_id,job_id),UNIQUE(business_id,appointment_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.schedule_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.schedule_reservations FORCE ROW LEVEL SECURITY;
CREATE INDEX schedule_reservations_actor_operation ON crest.schedule_reservations(business_id,operation_id,created_by);
CREATE TABLE crest.schedule_overrides(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,appointment_id uuid NOT NULL,reason text NOT NULL CHECK(char_length(reason)>0 AND char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>''),
 FOREIGN KEY(business_id,appointment_id,job_id) REFERENCES crest.appointments(business_id,id,job_id),UNIQUE(business_id,appointment_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.schedule_overrides FORCE ROW LEVEL SECURITY;
CREATE INDEX schedule_overrides_actor_operation ON crest.schedule_overrides(business_id,operation_id,created_by);
CREATE TABLE crest.schedule_override_conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 override_id uuid NOT NULL,conflicting_appointment_id uuid NOT NULL,
 FOREIGN KEY(business_id,override_id) REFERENCES crest.schedule_overrides(business_id,id),FOREIGN KEY(business_id,conflicting_appointment_id) REFERENCES crest.appointments(business_id,id),UNIQUE(business_id,override_id,conflicting_appointment_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.schedule_override_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.schedule_override_conflicts FORCE ROW LEVEL SECURITY;
CREATE INDEX schedule_override_conflicts_actor_operation ON crest.schedule_override_conflicts(business_id,operation_id,created_by);
CREATE TABLE crest.allocation_plan_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 source_allocation_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,reason text,
 FOREIGN KEY(business_id,source_allocation_id) REFERENCES crest.scope_allocations(business_id,id),UNIQUE(business_id,source_allocation_id,sequence),UNIQUE(business_id,id,source_allocation_id),FOREIGN KEY(business_id,replaces_id,source_allocation_id) REFERENCES crest.allocation_plan_versions(business_id,id,source_allocation_id),CHECK(sequence=1 AND replaces_id IS NULL OR sequence>1 AND replaces_id IS NOT NULL),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.allocation_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.allocation_plan_versions FORCE ROW LEVEL SECURITY;
CREATE INDEX allocation_plan_versions_actor_operation ON crest.allocation_plan_versions(business_id,operation_id,created_by);
CREATE TABLE crest.allocation_plan_parts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 plan_id uuid NOT NULL,stable_partition_id uuid NOT NULL,job_id uuid,allocation_state text NOT NULL CHECK(allocation_state IN('unassigned','assigned','completed','cancelled')),gross_inclusive_cents bigint NOT NULL CHECK(gross_inclusive_cents>=0),discount_inclusive_cents bigint NOT NULL CHECK(discount_inclusive_cents>=0),amount_cents bigint NOT NULL CHECK(amount_cents>=0),scope_description text NOT NULL CHECK(char_length(scope_description)>0 AND char_length(scope_description)<=2000 AND btrim(scope_description,E' \t\n\r')<>''),CHECK((job_id IS NULL)=(allocation_state='unassigned')),
 FOREIGN KEY(business_id,plan_id) REFERENCES crest.allocation_plan_versions(business_id,id),FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,plan_id,stable_partition_id),CHECK(gross_inclusive_cents::numeric-discount_inclusive_cents::numeric=amount_cents::numeric),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.allocation_plan_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.allocation_plan_parts FORCE ROW LEVEL SECURITY;
CREATE INDEX allocation_plan_parts_actor_operation ON crest.allocation_plan_parts(business_id,operation_id,created_by);
CREATE TABLE crest.job_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),from_state text,to_state text NOT NULL,effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),reason text,evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,job_id,sequence),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.job_events FORCE ROW LEVEL SECURITY;
CREATE INDEX job_events_actor_operation ON crest.job_events(business_id,operation_id,created_by);
ALTER TABLE crest.jobs ADD CONSTRAINT job_current_appointment FOREIGN KEY(business_id,current_appointment_id,id) REFERENCES crest.appointments(business_id,id,job_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE crest.appointments ADD CONSTRAINT appointment_operation_once UNIQUE(business_id,job_id,operation_id);
ALTER TABLE crest.job_events ADD CONSTRAINT job_event_operation_once UNIQUE(business_id,job_id,operation_id);
ALTER TABLE crest.schedule_reservations ADD CONSTRAINT reservation_override FOREIGN KEY(business_id,override_id) REFERENCES crest.schedule_overrides(business_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX reservation_operator_interval ON crest.schedule_reservations USING gist(blocked_interval);
CREATE INDEX reservation_operator ON crest.schedule_reservations(business_id,operator_actor_id);
-- Construction is deliberately closed until the complete typed transaction,
-- deferred aggregate/audit guards and current-allocation projection are installed.
CREATE FUNCTION crest_private.booking_construction_closed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $closed$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_IMPLEMENTATION_REQUIRED';END $closed$;
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.jobs FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.job_vehicles FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.job_encounters FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.appointments FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.operator_controls FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.schedule_reservations FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.schedule_overrides FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.schedule_override_conflicts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.allocation_plan_versions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.allocation_plan_parts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
CREATE TRIGGER booking_construction_closed BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.job_events FOR EACH STATEMENT EXECUTE FUNCTION crest_private.booking_construction_closed();
REVOKE ALL ON FUNCTION crest_private.booking_construction_closed() FROM PUBLIC;
RESET ROLE;

RESET ROLE;
-- END REVIEWED confirmed-bookings-storage.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-history.sql
-- Unregistered booking row history. The statement construction gate remains
-- closed until aggregate guards and a trusted command are installed together.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_booking_integrity_owner',oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND(c.relowner='crest_booking_integrity_owner'::regrole OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege('crest_booking_integrity_owner',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_booking_integrity_owner',c.oid,'DELETE,TRUNCATE,TRIGGER') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND(p.proowner='crest_booking_integrity_owner'::regrole OR has_function_privilege('crest_booking_integrity_owner',p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_booking_integrity_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_booking_integrity_owner'::regrole))) a WHERE a.grantee<>'crest_booking_integrity_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_booking_integrity_owner'::regrole AND a.grantee<>d.defaclrole)
  OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=ANY(ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events']) AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)<>11
  OR EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='crest_private'::regnamespace AND proname='stamp_booking_row')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_HISTORY_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.jobs_projection(v crest.jobs) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('version',(v).version::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'first_work_at',to_char((v).first_work_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'completed_at',to_char((v).completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.jobs TO crest_booking_integrity_owner;
GRANT SELECT ON crest.jobs TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.jobs FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.jobs_projection(crest.jobs) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.jobs_projection(crest.jobs) FROM PUBLIC;
CREATE FUNCTION crest_private.job_vehicles_projection(v crest.job_vehicles) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.job_vehicles TO crest_booking_integrity_owner;
GRANT SELECT ON crest.job_vehicles TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.job_vehicles FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.job_vehicles_projection(crest.job_vehicles) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.job_vehicles_projection(crest.job_vehicles) FROM PUBLIC;
CREATE FUNCTION crest_private.job_encounters_projection(v crest.job_encounters) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.job_encounters TO crest_booking_integrity_owner;
GRANT SELECT ON crest.job_encounters TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.job_encounters FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.job_encounters_projection(crest.job_encounters) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.job_encounters_projection(crest.job_encounters) FROM PUBLIC;
CREATE FUNCTION crest_private.appointments_projection(v crest.appointments) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('sequence',(v).sequence::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'start_at',to_char((v).start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char((v).end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'local_start',to_char((v).local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),'local_end',to_char((v).local_end,'YYYY-MM-DD"T"HH24:MI:SS.US')) $projection$;
GRANT USAGE ON TYPE crest.appointments TO crest_booking_integrity_owner;
GRANT SELECT ON crest.appointments TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.appointments FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.appointments_projection(crest.appointments) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.appointments_projection(crest.appointments) FROM PUBLIC;
CREATE FUNCTION crest_private.operator_controls_projection(v crest.operator_controls) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.operator_controls TO crest_booking_integrity_owner;
GRANT SELECT ON crest.operator_controls TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.operator_controls FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.operator_controls_projection(crest.operator_controls) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.operator_controls_projection(crest.operator_controls) FROM PUBLIC;
CREATE FUNCTION crest_private.schedule_reservations_projection(v crest.schedule_reservations) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'blocked_interval',jsonb_build_object('start_at',to_char(lower((v).blocked_interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char(upper((v).blocked_interval) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lower_inclusive',lower_inc((v).blocked_interval),'upper_inclusive',upper_inc((v).blocked_interval))) $projection$;
GRANT USAGE ON TYPE crest.schedule_reservations TO crest_booking_integrity_owner;
GRANT SELECT ON crest.schedule_reservations TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.schedule_reservations FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.schedule_reservations_projection(crest.schedule_reservations) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.schedule_reservations_projection(crest.schedule_reservations) FROM PUBLIC;
CREATE FUNCTION crest_private.schedule_overrides_projection(v crest.schedule_overrides) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.schedule_overrides TO crest_booking_integrity_owner;
GRANT SELECT ON crest.schedule_overrides TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.schedule_overrides FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.schedule_overrides_projection(crest.schedule_overrides) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.schedule_overrides_projection(crest.schedule_overrides) FROM PUBLIC;
CREATE FUNCTION crest_private.schedule_override_conflicts_projection(v crest.schedule_override_conflicts) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.schedule_override_conflicts TO crest_booking_integrity_owner;
GRANT SELECT ON crest.schedule_override_conflicts TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.schedule_override_conflicts FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.schedule_override_conflicts_projection(crest.schedule_override_conflicts) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.schedule_override_conflicts_projection(crest.schedule_override_conflicts) FROM PUBLIC;
CREATE FUNCTION crest_private.allocation_plan_versions_projection(v crest.allocation_plan_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('sequence',(v).sequence::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.allocation_plan_versions TO crest_booking_integrity_owner;
GRANT SELECT ON crest.allocation_plan_versions TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.allocation_plan_versions FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions) FROM PUBLIC;
CREATE FUNCTION crest_private.allocation_plan_parts_projection(v crest.allocation_plan_parts) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('gross_inclusive_cents',(v).gross_inclusive_cents::text,'discount_inclusive_cents',(v).discount_inclusive_cents::text,'amount_cents',(v).amount_cents::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.allocation_plan_parts TO crest_booking_integrity_owner;
GRANT SELECT ON crest.allocation_plan_parts TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.allocation_plan_parts FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.allocation_plan_parts_projection(crest.allocation_plan_parts) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.allocation_plan_parts_projection(crest.allocation_plan_parts) FROM PUBLIC;
CREATE FUNCTION crest_private.job_events_projection(v crest.job_events) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$ SELECT to_jsonb(v)||jsonb_build_object('sequence',(v).sequence::text,'effective_at',to_char((v).effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $projection$;
GRANT USAGE ON TYPE crest.job_events TO crest_booking_integrity_owner;
GRANT SELECT ON crest.job_events TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.job_events FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT EXECUTE ON FUNCTION crest_private.job_events_projection(crest.job_events) TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.job_events_projection(crest.job_events) FROM PUBLIC;
GRANT SELECT(business_id,operation_id,actor_id,command_type,state,schema_version,result_schema_version,origin,import_row_id) ON crest_private.operations TO crest_booking_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin,import_row_id) ON crest_private.audit_events TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_operations ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel'));
CREATE POLICY booking_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(entity_kind IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'));
CREATE UNIQUE INDEX booking_entity_audit_version ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events');
CREATE FUNCTION crest_private.retain_booking_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retain$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_HISTORY_RETAINED';END $retain$;
CREATE FUNCTION crest_private.stamp_booking_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
DECLARE stamp timestamptz:=clock_timestamp();actor uuid;operation uuid;kind text;
BEGIN
 actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 IF actor IS NULL OR operation IS NULL OR NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM operation OR NEW.origin<>'manual' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL;
 IF kind IS NULL OR kind NOT IN('operations.job.book','operations.job.reschedule','operations.job.cancel') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ACTOR_REQUIRED';END IF;NEW.created_at:=stamp;
  IF TG_TABLE_NAME='jobs' THEN IF kind<>'operations.job.book' OR NEW.version<>1 OR NEW.updated_by<>actor OR NEW.state<>'scheduled' OR NEW.first_work_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.completion_outcome IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;NEW.updated_at:=stamp;END IF;
 ELSE
  IF TG_TABLE_NAME<>'jobs' OR ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.operator_actor_id,NEW.created_at,NEW.created_by,NEW.origin) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.operator_actor_id,OLD.created_at,OLD.created_by,OLD.origin) OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR OLD.state<>'scheduled' OR OLD.first_work_at IS NOT NULL OR ROW(NEW.first_work_at,NEW.completed_at,NEW.completion_outcome) IS DISTINCT FROM ROW(OLD.first_work_at,OLD.completed_at,OLD.completion_outcome) OR NOT(kind='operations.job.reschedule' AND NEW.state='scheduled' OR kind='operations.job.cancel' AND NEW.state='cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;
  NEW.updated_at:=stamp;
  IF kind='operations.job.cancel' AND ROW(NEW.fulfillment_mode,NEW.mode_version_id,NEW.work_address_id,NEW.work_location_snapshot) IS DISTINCT FROM ROW(OLD.fulfillment_mode,OLD.mode_version_id,OLD.work_address_id,OLD.work_location_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SOURCE_RETAINED';END IF;
 END IF;
 RETURN NEW;
END $stamp$;
CREATE FUNCTION crest_private.check_booking_row_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE b uuid;entity uuid;actor uuid;operation uuid;revision bigint;verb text;before_row jsonb:='null'::jsonb;after_row jsonb:='null'::jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME<>'schedule_reservations' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_HISTORY_RETAINED';END IF;
  b:=OLD.business_id;entity:=OLD.id;actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;revision:=2;verb:='release';
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;
 ELSE
  b:=NEW.business_id;entity:=NEW.id;operation:=NEW.operation_id;verb:=CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'revise' END;
  IF TG_TABLE_NAME='jobs' THEN actor:=NEW.updated_by;revision:=NEW.version;ELSE actor:=NEW.created_by;revision:=1;END IF;
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO after_row USING NEW;
  IF TG_OP='UPDATE' THEN EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=b AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=entity AND a.entity_version=revision AND a.action=verb AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row) AND a.origin='manual' AND a.import_row_id IS NULL AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL AND o.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') AND(TG_OP<>'DELETE' OR o.command_type IN('operations.job.reschedule','operations.job.cancel')))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_AUDIT_REQUIRED';END IF;RETURN NULL;
END $audit$;
CREATE TRIGGER booking_stamp BEFORE INSERT OR UPDATE ON crest.jobs FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT OR UPDATE ON crest.jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE DELETE ON crest.jobs FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.jobs FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.job_vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.job_vehicles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.job_vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.job_vehicles FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.job_encounters FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.job_encounters DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.job_encounters FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.job_encounters FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.appointments FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.appointments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.appointments FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.appointments FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.operator_controls FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.operator_controls DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.operator_controls FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.operator_controls FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.schedule_reservations FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT OR DELETE ON crest.schedule_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE ON crest.schedule_reservations FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.schedule_reservations FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.schedule_overrides FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.schedule_overrides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.schedule_overrides FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.schedule_overrides FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.schedule_override_conflicts FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.schedule_override_conflicts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.schedule_override_conflicts FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.schedule_override_conflicts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.allocation_plan_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.allocation_plan_versions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.allocation_plan_parts FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.allocation_plan_parts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.allocation_plan_parts FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.allocation_plan_parts FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_stamp BEFORE INSERT ON crest.job_events FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_booking_row();
CREATE CONSTRAINT TRIGGER booking_audit AFTER INSERT ON crest.job_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_row_audit();
CREATE TRIGGER booking_retain BEFORE UPDATE OR DELETE ON crest.job_events FOR EACH ROW EXECUTE FUNCTION crest_private.retain_booking_history();
CREATE TRIGGER booking_retain_truncate BEFORE TRUNCATE ON crest.job_events FOR EACH STATEMENT EXECUTE FUNCTION crest_private.retain_booking_history();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.stamp_booking_row() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_row_audit() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.stamp_booking_row(),crest_private.check_booking_row_audit(),crest_private.retain_booking_history() FROM PUBLIC;

RESET ROLE;
-- END REVIEWED confirmed-bookings-history.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-invariants.sql
-- Unregistered aggregate booking construction. No app write grant or gate removal.
-- Existing commercial parent locks are the serialization point for scope plans.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
  OR to_regclass('crest.current_scope_allocation_parts') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_booking_row()') AND proowner='crest_booking_integrity_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.allocation_plan_parts'::regclass AND attname='allocation_state' AND NOT attisdropped)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_AGGREGATE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.quote_families,crest.quote_family_commercial_state,crest.agreements,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions,crest.customers,crest.vehicles,crest.customer_vehicles,crest.memberships,crest.fulfillment_mode_versions TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.quote_families FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.quote_family_commercial_state FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.agreements FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.scope_allocations FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.scope_entitlements FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.entitlement_versions FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.customers FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.vehicles FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.customer_vehicles FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.memberships FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY booking_integrity_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_booking_integrity_owner USING(true);
-- PostgreSQL requires column UPDATE permission for SELECT FOR UPDATE. The
-- WITH CHECK(false) policies forbid actual updates by this closed lock role.
GRANT UPDATE(id) ON crest.quote_families,crest.operator_controls TO crest_booking_integrity_owner;
CREATE POLICY booking_family_lock ON crest.quote_families FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_operator_lock ON crest.operator_controls FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE VIEW crest.current_scope_allocation_parts WITH(security_barrier=true,security_invoker=true) AS
 WITH latest AS(SELECT DISTINCT ON(business_id,source_allocation_id) business_id,source_allocation_id,id,sequence FROM crest.allocation_plan_versions ORDER BY business_id,source_allocation_id,sequence DESC)
 SELECT s.business_id,s.id AS source_allocation_id,s.entitlement_id,s.entitlement_version_id,s.agreement_id,
 l.id AS plan_id,coalesce(l.sequence,0::bigint) AS plan_sequence,
 CASE WHEN l.id IS NULL THEN s.stable_partition_id ELSE p.stable_partition_id END AS stable_partition_id,
 p.job_id,CASE WHEN l.id IS NULL THEN 'unassigned'::text ELSE p.allocation_state END AS allocation_state,
 CASE WHEN l.id IS NULL THEN s.gross_inclusive_cents ELSE p.gross_inclusive_cents END AS gross_inclusive_cents,
 CASE WHEN l.id IS NULL THEN s.discount_inclusive_cents ELSE p.discount_inclusive_cents END AS discount_inclusive_cents,
 CASE WHEN l.id IS NULL THEN s.amount_cents ELSE p.amount_cents END AS amount_cents,
 CASE WHEN l.id IS NULL THEN s.scope_description ELSE p.scope_description END AS scope_description
 FROM crest.scope_allocations s LEFT JOIN latest l ON l.business_id=s.business_id AND l.source_allocation_id=s.id
 LEFT JOIN crest.allocation_plan_parts p ON p.business_id=l.business_id AND p.plan_id=l.id
 WHERE l.id IS NULL OR p.id IS NOT NULL;
GRANT SELECT ON crest.current_scope_allocation_parts TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.lock_booking_family(business uuid,family uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 PERFORM 1 FROM crest.quote_families WHERE business_id=business AND id=family FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_FAMILY_REQUIRED';END IF;
END $lock$;
CREATE FUNCTION crest_private.lock_booking_operator(business uuid,operator_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 PERFORM 1 FROM crest.operator_controls WHERE business_id=business AND operator_actor_id=operator_actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_OPERATOR_REQUIRED';END IF;
END $lock$;
CREATE FUNCTION crest_private.validate_booking_plan_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plan$
DECLARE family uuid;latest crest.allocation_plan_versions;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 SELECT e.agreement_family_id INTO family FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=NEW.business_id AND s.id=NEW.source_allocation_id;
 IF family IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_SCOPE_REQUIRED';END IF;
 PERFORM crest_private.lock_booking_family(NEW.business_id,family);
 SELECT * INTO latest FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND source_allocation_id=NEW.source_allocation_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(latest.sequence,0)+1 OR NEW.replaces_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PLAN_CONFLICT';END IF;
 RETURN NEW;
END $plan$;
CREATE FUNCTION crest_private.check_booking_plan() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plan$
DECLARE p crest.allocation_plan_versions;s crest.scope_allocations;e crest.scope_entitlements;kind text;part_count bigint;gross numeric;discount numeric;amount numeric;
BEGIN
 IF TG_TABLE_NAME='allocation_plan_versions' THEN SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.id;
 ELSE SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.plan_id;END IF;
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=p.business_id AND id=s.entitlement_id;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=p.business_id AND operation_id=p.operation_id AND actor_id=p.created_by;
 SELECT count(*),coalesce(sum(gross_inclusive_cents::numeric),0),coalesce(sum(discount_inclusive_cents::numeric),0),coalesce(sum(amount_cents::numeric),0) INTO part_count,gross,discount,amount FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id;
 IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR kind IS NULL OR kind NOT IN('operations.job.book','operations.job.cancel') OR part_count=0 OR gross<>s.gross_inclusive_cents OR discount<>s.discount_inclusive_cents OR amount<>s.amount_cents
  OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state c WHERE c.business_id=p.business_id AND c.family_id=e.agreement_family_id AND c.current_agreement_id=s.agreement_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(a.operation_id<>p.operation_id OR a.created_by<>p.created_by))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_TOTAL_REQUIRED';END IF;
 IF kind='operations.job.book' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.allocation_state='assigned' AND j.operation_id=p.operation_id AND j.state='scheduled')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_NEW_SCOPE_REQUIRED';END IF;
 -- Cancellation changes state, not the previously explicit money or scope.
 IF kind='operations.job.cancel' AND(p.replaces_id IS NULL
  OR EXISTS(SELECT 1 FROM(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.replaces_id) prior_part FULL JOIN(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id) next ON next.stable_partition_id=prior_part.stable_partition_id
    WHERE prior_part.id IS NULL OR next.id IS NULL OR ROW(next.job_id,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
       OR next.allocation_state IS DISTINCT FROM prior_part.allocation_state AND NOT(prior_part.allocation_state='assigned' AND next.allocation_state='cancelled' AND EXISTS(SELECT 1 FROM crest.jobs j WHERE j.business_id=prior_part.business_id AND j.id=prior_part.job_id AND j.state='cancelled' AND j.operation_id=p.operation_id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SCOPE_RETAINED';END IF;
 -- Stable partition identity cannot migrate into another entitlement's source.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.allocation_plan_parts other ON other.business_id=a.business_id AND other.stable_partition_id=a.stable_partition_id JOIN crest.allocation_plan_versions previous ON previous.business_id=other.business_id AND previous.id=other.plan_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND previous.source_allocation_id<>p.source_allocation_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.scope_allocations original ON original.business_id=a.business_id AND original.stable_partition_id=a.stable_partition_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND original.id<>p.source_allocation_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PARTITION_IDENTITY_REQUIRED';END IF;
 -- A zero-dollar source/partition cannot disappear merely because the total
 -- remains zero. Preserve its original identity through explicit allocations.
 IF p.replaces_id IS NULL AND s.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=s.stable_partition_id)
  OR p.replaces_id IS NOT NULL AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=prior_part.stable_partition_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ZERO_IDENTITY_REQUIRED';END IF;
 -- Every assigned partition has the accepted customer's actual job and vehicle.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.agreements agreement ON agreement.business_id=s.business_id AND agreement.id=s.agreement_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(j.customer_id<>agreement.customer_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id AND v.vehicle_id=e.vehicle_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_BINDING_REQUIRED';END IF;
 -- Existing assigned work stays intact when booking another visit; completed
 -- scope and active physical work cannot be moved by any booking command.
 IF p.replaces_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts prior_part JOIN crest.jobs j ON j.business_id=prior_part.business_id AND j.id=prior_part.job_id
  LEFT JOIN crest.allocation_plan_parts next ON next.business_id=prior_part.business_id AND next.plan_id=p.id AND next.stable_partition_id=prior_part.stable_partition_id
  WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND(
   prior_part.allocation_state='completed' OR j.state IN('en_route','in_progress','paused') OR prior_part.allocation_state='assigned' AND j.state='scheduled' AND kind='operations.job.book'
  ) AND ROW(next.job_id,next.allocation_state,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ASSIGNED_SCOPE_RETAINED';END IF;
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a LEFT JOIN crest.allocation_plan_parts prior_part ON prior_part.business_id=a.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.stable_partition_id=a.stable_partition_id LEFT JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(
  a.allocation_state='completed' AND(prior_part.id IS NULL OR prior_part.allocation_state<>'completed' OR ROW(a.job_id,a.gross_inclusive_cents,a.discount_inclusive_cents,a.amount_cents,a.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description))
  OR a.allocation_state='assigned' AND(prior_part.id IS NULL OR prior_part.job_id IS DISTINCT FROM a.job_id OR prior_part.allocation_state IS DISTINCT FROM 'assigned') AND(kind<>'operations.job.book' OR j.operation_id<>p.operation_id OR j.state<>'scheduled')
  OR a.allocation_state='cancelled' AND(prior_part.id IS NULL OR prior_part.allocation_state IS DISTINCT FROM 'cancelled') AND(kind<>'operations.job.cancel' OR j.operation_id<>p.operation_id OR j.state<>'cancelled')
 )) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_STATE_REQUIRED';END IF;
 RETURN NULL;
END $plan$;
CREATE TRIGGER booking_validate_plan BEFORE INSERT ON crest.allocation_plan_versions FOR EACH ROW EXECUTE FUNCTION crest_private.validate_booking_plan_append();
CREATE CONSTRAINT TRIGGER booking_plan_total AFTER INSERT ON crest.allocation_plan_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_plan();
CREATE CONSTRAINT TRIGGER booking_plan_part_total AFTER INSERT ON crest.allocation_plan_parts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_plan();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.lock_booking_family(uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.lock_booking_operator(uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.validate_booking_plan_append() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_plan() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.lock_booking_family(uuid,uuid),crest_private.lock_booking_operator(uuid,uuid),crest_private.validate_booking_plan_append(),crest_private.check_booking_plan() FROM PUBLIC;

RESET ROLE;
-- END REVIEWED confirmed-bookings-invariants.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-job-invariants.sql
-- Unregistered job graph checks. Statement construction protection is retained.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.lock_booking_family(uuid,uuid)') IS NULL OR to_regclass('crest.current_scope_allocation_parts') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_JOB_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.addresses TO crest_booking_integrity_owner;
CREATE POLICY booking_integrity_read ON crest.addresses FOR SELECT TO crest_booking_integrity_owner USING(true);
GRANT UPDATE(id) ON crest.customers,crest.vehicles,crest.addresses,crest.memberships TO crest_booking_integrity_owner;
CREATE POLICY booking_lock ON crest.customers FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_lock ON crest.vehicles FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_lock ON crest.addresses FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
CREATE POLICY booking_lock ON crest.memberships FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(false);
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.quote_review_note_valid(jsonb),crest_private.valid_appointment_hold_payload(jsonb),crest_private.customer_projection(crest.customers),crest_private.vehicle_projection(crest.vehicles),crest_private.address_projection(crest.addresses) TO crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.booking_text_required(v jsonb,max_length integer) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $text$
 SELECT coalesce(jsonb_typeof(v)='string' AND char_length(v#>>'{}')<=max_length AND crest_private.quote_review_note_valid(v),false)
$text$;
CREATE FUNCTION crest_private.valid_booking_contact(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $contact$
DECLARE base text[];
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF v->>'kind'='no_contact' THEN RETURN v-ARRAY['kind','reason']='{}'::jsonb AND v ?& ARRAY['kind','reason'] AND crest_private.booking_text_required(v->'reason',1000);END IF;
 IF v-ARRAY['kind','value']<>'{}'::jsonb OR NOT v ?& ARRAY['kind','value'] OR NOT crest_private.booking_text_required(v->'value',512) THEN RETURN false;END IF;
 IF v->>'kind'='email' THEN RETURN(v->>'value')~'^[^[:space:]@]+@[^[:space:]@]+$';END IF;
 IF v->>'kind'<>'phone' OR v->>'kind' IS NULL THEN RETURN false;END IF;
 base:=regexp_match(v->>'value','^([+]?[0-9(). -]+?)([ ]*(?:ext[.]?|x|#)[ ]*[0-9]+)?$','i');
 RETURN base IS NOT NULL AND length(regexp_replace(base[1],'[^0-9]','','g'))>=7 AND length(regexp_replace(base[1],'[^0-9]','','g'))<=15;
END $contact$;
CREATE FUNCTION crest_private.valid_booking_confirmation(v jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirmation$
DECLARE effective timestamptz;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['channel','effectiveAt','evidenceNote']<>'{}'::jsonb OR NOT v ?& ARRAY['channel','effectiveAt','evidenceNote'] OR jsonb_typeof(v->'channel') IS DISTINCT FROM 'string' OR v->>'channel' NOT IN('text','phone','email','in_person') OR NOT crest_private.booking_text_required(v->'evidenceNote',2000) OR jsonb_typeof(v->'effectiveAt') IS DISTINCT FROM 'string' OR(v->>'effectiveAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{6}Z$' OR(v->>'effectiveAt')<'0001-' THEN RETURN false;END IF;
 effective:=(v->>'effectiveAt')::timestamptz;
 RETURN recorded IS NOT NULL AND isfinite(recorded) AND isfinite(effective) AND effective<=recorded AND to_char(effective AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=v->>'effectiveAt';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN RETURN false;
END $confirmation$;
CREATE FUNCTION crest_private.valid_booking_location(v jsonb,business uuid,customer uuid,fresh boolean) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $location$
DECLARE a crest.addresses;
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RETURN false;END IF;
 IF v->>'kind'='manual' THEN
  RETURN v-ARRAY['schemaVersion','kind','locationText','instructions']='{}'::jsonb AND v ?& ARRAY['schemaVersion','kind','locationText','instructions'] AND crest_private.booking_text_required(v->'locationText',2000) AND(v->'instructions'='null'::jsonb OR crest_private.booking_text_required(v->'instructions',2000));
 END IF;
 IF v->>'kind' IS DISTINCT FROM 'customer_address' OR v-ARRAY['schemaVersion','kind','addressId','addressVersion','snapshot']<>'{}'::jsonb OR NOT v ?& ARRAY['schemaVersion','kind','addressId','addressVersion','snapshot'] OR jsonb_typeof(v->'addressId') IS DISTINCT FROM 'string' OR(v->>'addressId')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR jsonb_typeof(v->'addressVersion') IS DISTINCT FROM 'string' OR(v->>'addressVersion')!~'^[1-9][0-9]{0,18}$' OR jsonb_typeof(v->'snapshot') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF NOT fresh THEN RETURN v->'snapshot'->>'id'=v->>'addressId' AND v->'snapshot'->>'business_id'=business::text AND v->'snapshot'->>'customer_id'=customer::text AND v->'snapshot'->>'version'=v->>'addressVersion';END IF;
 SELECT * INTO a FROM crest.addresses WHERE business_id=business AND customer_id=customer AND id=(v->>'addressId')::uuid FOR SHARE;
 RETURN a.id IS NOT NULL AND a.archived_at IS NULL AND a.version::text=v->>'addressVersion' AND crest_private.address_projection(a)=v->'snapshot'
  AND(crest_private.booking_text_required(to_jsonb(a.exact_location_text),2000) OR crest_private.booking_text_required(to_jsonb(a.line1),512) AND crest_private.booking_text_required(to_jsonb(a.city),200));
END $location$;
CREATE FUNCTION crest_private.validate_booking_reservation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reservation$
DECLARE actor uuid;operation uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 IF TG_OP='DELETE' THEN
  actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
  IF NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=OLD.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND schema_version=1 AND command_type IN('operations.job.reschedule','operations.job.cancel') AND origin='manual' AND import_row_id IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RELEASE_CONTEXT_REQUIRED';END IF;
  PERFORM crest_private.lock_booking_operator(OLD.business_id,OLD.operator_actor_id);RETURN OLD;
 END IF;
 PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);RETURN NEW;
END $reservation$;
CREATE TRIGGER booking_validate_reservation BEFORE INSERT OR DELETE ON crest.schedule_reservations FOR EACH ROW EXECUTE FUNCTION crest_private.validate_booking_reservation();
CREATE FUNCTION crest_private.booking_slot_review(p_business uuid,p_operator uuid,p_job uuid,p_blocked tstzrange,p_before integer,p_after integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE conflicts uuid[];has_unknown boolean;
BEGIN
 IF p_business IS NULL OR p_operator IS NULL OR p_blocked IS NULL OR isempty(p_blocked) OR lower_inf(p_blocked) OR upper_inf(p_blocked) OR NOT isfinite(lower(p_blocked)) OR NOT isfinite(upper(p_blocked)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_REVIEW_INPUT_REQUIRED';END IF;
 SELECT coalesce(array_agg(r.appointment_id ORDER BY r.appointment_id),ARRAY[]::uuid[]) INTO conflicts FROM crest.schedule_reservations r WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND r.blocked_interval&&p_blocked;
 has_unknown:=p_before IS NULL OR p_after IS NULL;
 has_unknown:=has_unknown OR EXISTS(SELECT 1 FROM(
  (SELECT other.travel_after_seconds IS NULL AS is_unknown FROM crest.schedule_reservations r JOIN crest.appointments other ON other.business_id=r.business_id AND other.id=r.appointment_id WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND upper(r.blocked_interval)<=lower(p_blocked) ORDER BY upper(r.blocked_interval) DESC LIMIT 1)
  UNION ALL
  (SELECT other.travel_before_seconds IS NULL AS is_unknown FROM crest.schedule_reservations r JOIN crest.appointments other ON other.business_id=r.business_id AND other.id=r.appointment_id WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND lower(r.blocked_interval)>=upper(p_blocked) ORDER BY lower(r.blocked_interval) LIMIT 1)
  UNION ALL
  SELECT other.travel_before_seconds IS NULL OR other.travel_after_seconds IS NULL AS is_unknown FROM crest.schedule_reservations r JOIN crest.appointments other ON other.business_id=r.business_id AND other.id=r.appointment_id WHERE r.business_id=p_business AND r.operator_actor_id=p_operator AND(p_job IS NULL OR r.job_id<>p_job) AND r.blocked_interval&&p_blocked
 ) neighbours WHERE is_unknown);
 RETURN jsonb_build_object('conflictingAppointmentIds',conflicts,'unknownTravel',has_unknown);
END $review$;
CREATE FUNCTION crest_private.check_booking_job_graph(business uuid,job uuid,source_operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $job$
DECLARE j crest.jobs;a crest.appointments;latest crest.appointments;m crest.fulfillment_mode_versions;c crest.customers;v crest.job_vehicles;vehicle crest.vehicles;event crest.job_events;reservation crest.schedule_reservations;kind text;fresh boolean;family uuid;conflicts uuid[];recorded_conflicts uuid[];unknown_travel boolean;expected_range tstzrange;latest_event bigint;before_state text;review_snapshot jsonb;schedule_action text;preserve_slot boolean;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;
 IF j.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_BOOKING_JOB_REQUIRED';END IF;
 IF j.operation_id IS DISTINCT FROM source_operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CURRENT_MUTATION_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=business AND operation_id=source_operation;
 -- New commands acquire these same locks before writing. Repeating them here
 -- also keeps the deferred check and its commit in the same protected interval.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||business::text,0));
 FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=business AND job_id=job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(business,family);END LOOP;
 PERFORM crest_private.lock_booking_operator(business,j.operator_actor_id);
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=j.current_appointment_id AND job_id=j.id;
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=j.id AND sequence=j.version;
 SELECT * INTO latest FROM crest.appointments WHERE business_id=business AND job_id=j.id ORDER BY sequence DESC LIMIT 1;
 schedule_action:=event.evidence->'request'->'payload'->>'action';preserve_slot:=kind='operations.job.reschedule' AND schedule_action IN('propose','withdraw');fresh:=kind='operations.job.book' OR kind='operations.job.reschedule' AND schedule_action IN('propose','confirm');
 SELECT max(sequence) INTO latest_event FROM crest.job_events WHERE business_id=business AND job_id=j.id;
 SELECT delta->'before'->>'state' INTO before_state FROM crest_private.audit_events WHERE business_id=business AND operation_id=j.operation_id AND entity_kind='jobs' AND entity_id=j.id AND entity_version=j.version;
 IF a.id IS NULL OR event.id IS NULL OR latest_event<>j.version OR event.operation_id<>j.operation_id OR event.created_by<>j.updated_by OR event.from_state IS DISTINCT FROM before_state OR event.to_state<>j.state OR event.effective_at>event.created_at
  OR NOT coalesce(preserve_slot,false) AND a.id IS DISTINCT FROM latest.id
  OR NOT EXISTS(SELECT 1 FROM crest.job_vehicles WHERE business_id=business AND job_id=j.id)
  OR NOT EXISTS(SELECT 1 FROM crest.job_encounters WHERE business_id=business AND job_id=j.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_GRAPH_REQUIRED';END IF;
 IF crest_private.valid_booking_contact(a.contact_snapshot) IS NOT TRUE
  OR crest_private.valid_booking_location(j.work_location_snapshot,business,j.customer_id,fresh AND kind='operations.job.book') IS NOT TRUE
  OR j.work_address_id IS DISTINCT FROM(CASE WHEN j.work_location_snapshot->>'kind'='customer_address' THEN(j.work_location_snapshot->>'addressId')::uuid ELSE NULL END)
  OR crest_private.valid_appointment_hold_payload(jsonb_build_object('customer_id',j.customer_id,'lead_id',NULL,'label','Booking time grammar','state','proposed','start_at',to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char(a.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',a.timezone,'local_start',to_char(a.local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),'local_end',to_char(a.local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),'start_offset_minutes',a.start_offset_minutes,'end_offset_minutes',a.end_offset_minutes,'notes',NULL,'reason',NULL)) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_EVIDENCE_REQUIRED';END IF;
 -- The call above reuses only the existing UTC/local/offset data grammar. It
 -- does not create a proposal or substitute a proposal for a confirmed job.
 IF EXISTS(SELECT 1 FROM crest.job_encounters e JOIN crest.job_encounters other ON other.business_id=e.business_id AND other.family_id=e.family_id WHERE e.business_id=business AND e.job_id=j.id AND other.encounter_id<>e.encounter_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ENCOUNTER_IDENTITY_REQUIRED';END IF;
 IF fresh THEN
  SELECT * INTO c FROM crest.customers WHERE business_id=business AND id=j.customer_id FOR SHARE;
  IF c.id IS NULL OR c.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CUSTOMER_REQUIRED';END IF;
  PERFORM 1 FROM crest.memberships WHERE business_id=business AND actor_id=j.operator_actor_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATOR_REQUIRED';END IF;
  SELECT * INTO m FROM crest.fulfillment_mode_versions WHERE business_id=business ORDER BY sequence DESC LIMIT 1;
  IF (kind='operations.job.book' OR schedule_action='confirm') AND m.id IS DISTINCT FROM j.mode_version_id OR NOT(CASE j.fulfillment_mode WHEN 'mobile' THEN m.mobile_enabled WHEN 'dropoff' THEN m.dropoff_enabled WHEN 'pickup_return' THEN m.pickup_return_enabled ELSE false END)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_MODE_REQUIRED';END IF;
 END IF;
 FOR v IN SELECT * FROM crest.job_vehicles WHERE business_id=business AND job_id=j.id ORDER BY vehicle_id LOOP
  IF fresh THEN
   SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=business AND id=v.vehicle_id FOR SHARE;
   IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_VEHICLE_REQUIRED';END IF;
   IF v.operation_id=source_operation AND(v.vehicle_snapshot IS DISTINCT FROM crest_private.vehicle_projection(vehicle) OR v.customer_snapshot IS DISTINCT FROM crest_private.customer_projection(c)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SNAPSHOT_REQUIRED';END IF;
   IF v.customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.customer_vehicles link WHERE link.business_id=business AND link.id=v.customer_vehicle_id AND link.customer_id=j.customer_id AND link.vehicle_id=v.vehicle_id AND link.valid_to IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_VEHICLE_LINK_REQUIRED';END IF;
  END IF;
  IF j.fulfillment_mode='pickup_return' AND(crest_private.valid_booking_location(v.pickup_location_snapshot,business,j.customer_id,fresh AND kind='operations.job.book') IS NOT TRUE OR crest_private.valid_booking_location(v.return_location_snapshot,business,j.customer_id,fresh AND kind='operations.job.book') IS NOT TRUE)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_TRANSPORT_LOCATION_REQUIRED';END IF;
  IF v.pickup_address_id IS DISTINCT FROM(CASE WHEN v.pickup_location_snapshot->>'kind'='customer_address' THEN(v.pickup_location_snapshot->>'addressId')::uuid ELSE NULL END) OR v.return_address_id IS DISTINCT FROM(CASE WHEN v.return_location_snapshot->>'kind'='customer_address' THEN(v.return_location_snapshot->>'addressId')::uuid ELSE NULL END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_TRANSPORT_LOCATION_REQUIRED';END IF;
 END LOOP;
 IF j.state='cancelled' THEN
  IF a.confirmation_state<>'cancelled' OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=j.id)
   OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=j.id AND allocation_state<>'cancelled')
   OR crest_private.booking_text_required(to_jsonb(a.reason),1000) IS NOT TRUE OR crest_private.booking_text_required(to_jsonb(event.reason),1000) IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLATION_REQUIRED';END IF;RETURN;
 END IF;
 IF j.state<>'scheduled' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_FIELD_IMPLEMENTATION_REQUIRED';END IF;
 IF a.confirmation_state<>'confirmed' OR crest_private.valid_booking_confirmation(a.customer_confirmation,a.created_at) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=j.id AND allocation_state='assigned')
  OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=j.id AND allocation_state<>'assigned')
  OR fresh AND EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts p JOIN crest.scope_entitlements e ON e.business_id=p.business_id AND e.id=p.entitlement_id JOIN crest.quote_family_commercial_state active ON active.business_id=e.business_id AND active.family_id=e.agreement_family_id WHERE p.business_id=business AND p.job_id=j.id AND p.agreement_id IS DISTINCT FROM active.current_agreement_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFIRMED_SCOPE_REQUIRED';END IF;
 SELECT * INTO reservation FROM crest.schedule_reservations WHERE business_id=business AND job_id=j.id;
 expected_range:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');
 IF reservation.id IS NULL OR reservation.appointment_id<>a.id OR reservation.operator_actor_id<>j.operator_actor_id OR reservation.blocked_interval IS DISTINCT FROM expected_range
  OR NOT isfinite(lower(expected_range)) OR NOT isfinite(upper(expected_range)) OR lower(expected_range)<'0001-01-01T00:00:00Z'::timestamptz OR upper(expected_range)>='10000-01-01T00:00:00Z'::timestamptz
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESERVATION_REQUIRED';END IF;
 IF coalesce(preserve_slot,false) THEN
  -- A suggestion does not move the current confirmed pointer or reserve the
  -- proposed time. The old slot retains its original operation/audit evidence;
  -- later overrides by other jobs do not rewrite its historical conflict set.
  IF latest.id=a.id OR latest.operation_id<>source_operation OR latest.created_by<>j.updated_by OR latest.customer_confirmation IS NOT NULL OR latest.confirmation_state IS DISTINCT FROM(CASE schedule_action WHEN 'propose' THEN 'proposed' ELSE 'withdrawn' END)
   OR latest.reason IS DISTINCT FROM event.reason OR crest_private.booking_text_required(to_jsonb(latest.reason),1000) IS NOT TRUE
   OR crest_private.valid_booking_contact(latest.contact_snapshot) IS NOT TRUE
   OR crest_private.valid_appointment_hold_payload(jsonb_build_object('customer_id',j.customer_id,'lead_id',NULL,'label','Reschedule time grammar','state','proposed','start_at',to_char(latest.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char(latest.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',latest.timezone,'local_start',to_char(latest.local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),'local_end',to_char(latest.local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),'start_offset_minutes',latest.start_offset_minutes,'end_offset_minutes',latest.end_offset_minutes,'notes',NULL,'reason',NULL)) IS NOT TRUE
   OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND appointment_id=latest.id)
   OR EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=source_operation AND entity_kind IN('schedule_reservations','allocation_plan_versions','allocation_plan_parts','schedule_overrides','schedule_override_conflicts'))
   OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events journal WHERE journal.business_id=business AND journal.operation_id=source_operation AND journal.entity_kind='jobs' AND journal.entity_id=j.id AND journal.entity_version=j.version AND(journal.delta->'before')-ARRAY['version','updated_at','updated_by','operation_id']=(journal.delta->'after')-ARRAY['version','updated_at','updated_by','operation_id'])
   OR reservation.operation_id<>a.operation_id OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events journal JOIN crest_private.operations original ON original.business_id=journal.business_id AND original.operation_id=journal.operation_id AND original.actor_id=journal.actor_id WHERE journal.business_id=business AND journal.operation_id=reservation.operation_id AND journal.entity_kind='schedule_reservations' AND journal.entity_id=reservation.id AND journal.entity_version=1 AND journal.action='create' AND journal.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.schedule_reservations_projection(reservation)) AND original.state='committed')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_PROPOSAL_SOURCE_REQUIRED';END IF;RETURN;
 END IF;
 review_snapshot:=crest_private.booking_slot_review(business,j.operator_actor_id,j.id,expected_range,a.travel_before_seconds,a.travel_after_seconds);
 SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO conflicts FROM jsonb_array_elements(review_snapshot->'conflictingAppointmentIds');unknown_travel:=(review_snapshot->>'unknownTravel')::boolean;
 IF reservation.unknown_travel IS DISTINCT FROM unknown_travel OR unknown_travel AND NOT a.unknown_travel_reviewed THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_TRAVEL_REVIEW_REQUIRED';END IF;
 IF cardinality(conflicts)=0 THEN
  IF reservation.override_id IS NOT NULL OR EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND appointment_id=a.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFLICT_EVIDENCE_REQUIRED';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM crest.schedule_overrides o WHERE o.business_id=business AND o.id=reservation.override_id AND o.appointment_id=a.id AND o.job_id=j.id AND crest_private.booking_text_required(to_jsonb(o.reason),1000)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFLICT_REVIEW_REQUIRED';END IF;
  SELECT coalesce(array_agg(conflicting_appointment_id ORDER BY conflicting_appointment_id),ARRAY[]::uuid[]) INTO recorded_conflicts FROM crest.schedule_override_conflicts WHERE business_id=business AND override_id=reservation.override_id;
  IF recorded_conflicts IS DISTINCT FROM conflicts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFLICT_EVIDENCE_REQUIRED';END IF;
 END IF;
END $job$;
CREATE FUNCTION crest_private.check_booking_job_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $source$
DECLARE target uuid;operation uuid;
BEGIN
 IF TG_TABLE_NAME='jobs' THEN target:=NEW.id;operation:=NEW.operation_id;
 ELSIF TG_OP='DELETE' THEN target:=OLD.job_id;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 ELSIF TG_TABLE_NAME='schedule_override_conflicts' THEN
  SELECT job_id INTO target FROM crest.schedule_overrides WHERE business_id=NEW.business_id AND id=NEW.override_id AND operation_id=NEW.operation_id;operation:=NEW.operation_id;
 ELSE target:=NEW.job_id;operation:=NEW.operation_id;END IF;
 PERFORM crest_private.check_booking_job_graph(CASE WHEN TG_OP='DELETE' THEN OLD.business_id ELSE NEW.business_id END,target,operation);RETURN NULL;
END $source$;
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT OR UPDATE ON crest.jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.job_vehicles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.job_encounters DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.appointments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT OR DELETE ON crest.schedule_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.schedule_overrides DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.schedule_override_conflicts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
CREATE CONSTRAINT TRIGGER booking_graph AFTER INSERT ON crest.job_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_job_source();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.booking_text_required(jsonb,integer) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.valid_booking_contact(jsonb) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.valid_booking_confirmation(jsonb,timestamptz) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.valid_booking_location(jsonb,uuid,uuid,boolean) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.validate_booking_reservation() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_job_source() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.booking_text_required(jsonb,integer),crest_private.valid_booking_contact(jsonb),crest_private.valid_booking_confirmation(jsonb,timestamptz),crest_private.valid_booking_location(jsonb,uuid,uuid,boolean),crest_private.validate_booking_reservation() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_private.check_booking_job_graph(uuid,uuid,uuid),crest_private.check_booking_job_source() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer) FROM PUBLIC;

RESET ROLE;
-- END REVIEWED confirmed-bookings-job-invariants.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-commands.sql
-- Unregistered owner booking RPC. crm.manage is the existing nonfinancial
-- owner authority. No finance posting, provider action or runtime activation.
DO $review$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner') OR to_regprocedure('crest_private.check_booking_job_graph(uuid,uuid,uuid)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_integrity_owner'::regrole OR member='crest_booking_integrity_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_SOURCE_REQUIRED';END IF;
 CREATE ROLE crest_booking_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_booking_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_booking_owner;
DO $grants$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'] LOOP
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);
  EXECUTE format('GRANT USAGE ON TYPE crest.%I TO crest_booking_owner',name);
  EXECUTE format('CREATE POLICY booking_command_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY booking_command_create ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid AND origin=''manual'')',name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION crest_private.%I_projection(crest.%I) TO crest_booking_owner',name,name);
 END LOOP;
END $grants$;
GRANT SELECT ON crest.current_scope_allocation_parts TO crest_booking_owner;
GRANT SELECT ON crest.customers,crest.vehicles,crest.addresses,crest.customer_vehicles,crest.memberships,crest.quote_families,crest.quote_family_commercial_state,crest.agreements,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions TO crest_booking_owner;
DO $read$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['customers','vehicles','addresses','customer_vehicles','memberships','quote_families','quote_family_commercial_state','agreements','scope_allocations','scope_entitlements','entitlement_versions'] LOOP
  EXECUTE format('CREATE POLICY booking_command_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
 END LOOP;
END $read$;
GRANT SELECT,INSERT ON crest.fulfillment_mode_versions TO crest_booking_owner;
GRANT USAGE ON TYPE crest.fulfillment_mode_versions TO crest_booking_owner;
CREATE POLICY booking_modes_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY booking_modes_initialize ON crest.fulfillment_mode_versions FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND sequence=1 AND origin='manual');
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_booking_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_booking_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_booking_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_booking_owner;
CREATE POLICY booking_command_operations_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel'));
CREATE POLICY booking_command_operations_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY booking_command_operations_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel'));
CREATE POLICY booking_command_audits_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events','fulfillment_modes'));
CREATE POLICY booking_command_audits_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL AND entity_kind IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events','fulfillment_modes'));
CREATE FUNCTION crest_private.booking_uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $uuid$
 SELECT coalesce(jsonb_typeof(v)='string' AND(v#>>'{}')~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$uuid$;
CREATE FUNCTION crest_private.append_booking_audit(kind text,entity uuid,revision bigint,verb text,before_row jsonb,after_row jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE result uuid;
BEGIN
 IF kind NOT IN('jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events','fulfillment_modes') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_AUDIT_KIND_REQUIRED';END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(nullif(current_setting('crest.business_id',true),'')::uuid,nullif(current_setting('crest.operation_id',true),'')::uuid,nullif(current_setting('crest.actor_id',true),'')::uuid,nullif(current_setting('crest.actor_id',true),'')::uuid,kind,entity,revision,verb,jsonb_build_object('schemaVersion',1,'before',coalesce(before_row,'null'::jsonb),'after',coalesce(after_row,'null'::jsonb)),'manual') RETURNING id INTO result;RETURN result;
END $audit$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions),crest_private.customer_projection(crest.customers),crest_private.vehicle_projection(crest.vehicles),crest_private.address_projection(crest.addresses),crest_private.lock_booking_family(uuid,uuid),crest_private.lock_booking_operator(uuid,uuid),crest_private.booking_text_required(jsonb,integer),crest_private.valid_booking_contact(jsonb),crest_private.valid_booking_confirmation(jsonb,timestamptz),crest_private.valid_booking_location(jsonb,uuid,uuid,boolean) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.booking_uuid(jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.append_booking_audit(text,uuid,bigint,text,jsonb,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.booking_uuid(jsonb),crest_private.append_booking_audit(text,uuid,bigint,text,jsonb,jsonb) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
-- Shared locks protect source snapshots through commit without permitting this
-- private command role to edit the underlying CRM records.
GRANT UPDATE(id) ON crest.customers,crest.vehicles,crest.addresses,crest.customer_vehicles,crest.memberships TO crest_booking_owner;
CREATE POLICY booking_command_lock ON crest.customers FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.vehicles FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.addresses FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.customer_vehicles FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY booking_command_lock ON crest.memberships FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(false);
CREATE FUNCTION crest_private.booked_job_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;original jsonb;body jsonb;mode crest.fulfillment_mode_versions;source_audit crest_private.audit_events;stored jsonb;table_name text;digest text;counted bigint;expected_count bigint;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.book';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text OR r->>'version' IS DISTINCT FROM '1' OR r->>'appointmentSequence' IS DISTINCT FROM '1' OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=1 AND action='create';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';body:=original->'payload';
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR original->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR journal.delta->'before' IS DISTINCT FROM 'null'::jsonb OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR journal.delta->'after'->>'customer_id' IS DISTINCT FROM body->>'customerId' OR journal.delta->'after'->>'operator_actor_id' IS DISTINCT FROM body->>'operatorId' OR journal.delta->'after'->>'fulfillment_mode' IS DISTINCT FROM body->>'fulfillmentMode' OR journal.delta->'after'->'work_location_snapshot' IS DISTINCT FROM body->'workLocation' OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedModeSequence',original->>'expectedModeSequence','payload',body)::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');
 SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds'));
 IF counted<>expected_count OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   -- Reservations are mutable projections; their immutable original is audited.
   stored:=source_audit.delta->'after';
   IF stored->>'job_id' IS DISTINCT FROM r->>'jobId' OR stored->>'appointment_id' IS DISTINCT FROM a.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  ELSIF table_name='fulfillment_modes' THEN
   SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=business AND id=(source_audit.delta->'after'->>'id')::uuid;
   stored:=crest_private.fulfillment_mode_projection(mode);
  ELSIF table_name IN('job_vehicles','job_encounters','appointments','operator_controls','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.action NOT IN('create','initialize') OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.booked_job_operation_result(uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.booked_job_operation_result(uuid,uuid,uuid) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.book_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_mode_sequence bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $book$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;mode crest.fulfillment_mode_versions;customer crest.customers;vehicle crest.vehicles;association crest.customer_vehicles;control crest.operator_controls;j crest.jobs;a crest.appointments;jv crest.job_vehicles;encounter crest.job_encounters;p crest.allocation_plan_versions;part crest.allocation_plan_parts;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;reservation crest.schedule_reservations;event crest.job_events;source_row crest.scope_allocations;source_entitlement crest.scope_entitlements;input_vehicle jsonb;input_plan jsonb;input_part jsonb;slot jsonb;review jsonb;family uuid;conflicting uuid;actual_conflicts uuid[];expected_conflicts uuid[];unknown_travel boolean;blocked tstzrange;current_sequence bigint;reason text;job_audit uuid;audit_ids jsonb:='[]'::jsonb;plan_ids jsonb:='[]'::jsonb;original jsonb;command_result jsonb;review_snapshot jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_mode_sequence IS NULL OR expected_mode_sequence<0 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>1048576 OR body-ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview']<>'{}'::jsonb OR NOT body ?& ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview'] OR NOT crest_private.booking_uuid(body->'customerId') OR NOT crest_private.booking_uuid(body->'operatorId') OR jsonb_typeof(body->'expectedCustomerVersion') IS DISTINCT FROM 'string' OR(body->>'expectedCustomerVersion')!~'^[1-9][0-9]{0,18}$' OR body->>'fulfillmentMode' NOT IN('mobile','dropoff','pickup_return') OR jsonb_typeof(body->'fulfillmentMode') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'vehicles') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'vehicles')=0 OR jsonb_typeof(body->'allocationPlans') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocationPlans')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 slot:=body->'appointment';review:=body->'conflictReview';
 IF jsonb_typeof(slot) IS DISTINCT FROM 'object' OR slot-ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed']<>'{}'::jsonb OR NOT slot ?& ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed'] OR jsonb_typeof(slot->'unknown_travel_reviewed') IS DISTINCT FROM 'boolean' OR crest_private.valid_booking_contact(slot->'contact_snapshot') IS NOT TRUE OR crest_private.valid_booking_confirmation(slot->'customer_confirmation',clock_timestamp()) IS NOT TRUE
  OR jsonb_typeof(review) IS DISTINCT FROM 'object' OR review-ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason']<>'{}'::jsonb OR NOT review ?& ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason'] OR jsonb_typeof(review->'expectedAppointmentIds') IS DISTINCT FROM 'array' OR jsonb_typeof(review->'expectedUnknownTravel') IS DISTINCT FROM 'boolean' OR(review->'overrideReason'<>'null'::jsonb AND crest_private.booking_text_required(review->'overrideReason',1000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(review->'expectedAppointmentIds') item WHERE NOT crest_private.booking_uuid(item)) OR(SELECT count(DISTINCT value) FROM jsonb_array_elements(review->'expectedAppointmentIds'))<>jsonb_array_length(review->'expectedAppointmentIds') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 FOREACH reason IN ARRAY ARRAY['travel_before_seconds','travel_after_seconds'] LOOP IF slot->reason<>'null'::jsonb AND(jsonb_typeof(slot->reason) IS DISTINCT FROM 'number' OR(slot->>reason)!~'^(0|[1-9][0-9]{0,9})$' OR(slot->>reason)::numeric>2147483647) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
 FOR input_vehicle IN SELECT value FROM jsonb_array_elements(body->'vehicles') LOOP
  IF jsonb_typeof(input_vehicle) IS DISTINCT FROM 'object' OR input_vehicle-ARRAY['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation']<>'{}'::jsonb OR NOT input_vehicle ?& ARRAY['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation'] OR NOT crest_private.booking_uuid(input_vehicle->'vehicleId') OR jsonb_typeof(input_vehicle->'expectedVersion') IS DISTINCT FROM 'string' OR(input_vehicle->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR(input_vehicle->'customerVehicleId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_vehicle->'customerVehicleId')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'vehicleId') FROM jsonb_array_elements(body->'vehicles'))<>jsonb_array_length(body->'vehicles') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
  IF jsonb_typeof(input_plan) IS DISTINCT FROM 'object' OR input_plan-ARRAY['sourceAllocationId','expectedSequence','reason','parts']<>'{}'::jsonb OR NOT input_plan ?& ARRAY['sourceAllocationId','expectedSequence','reason','parts'] OR NOT crest_private.booking_uuid(input_plan->'sourceAllocationId') OR jsonb_typeof(input_plan->'expectedSequence') IS DISTINCT FROM 'string' OR(input_plan->>'expectedSequence')!~'^(0|[1-9][0-9]{0,18})$' OR(input_plan->>'expectedSequence')::numeric>=9223372036854775807 OR jsonb_typeof(input_plan->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(input_plan->'parts')=0 OR(input_plan->'reason'<>'null'::jsonb AND crest_private.booking_text_required(input_plan->'reason',1000) IS NOT TRUE) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
  FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
   IF jsonb_typeof(input_part) IS DISTINCT FROM 'object' OR input_part-ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription']<>'{}'::jsonb OR NOT input_part ?& ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'] OR NOT crest_private.booking_uuid(input_part->'partitionId') OR(input_part->'jobId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_part->'jobId')) OR jsonb_typeof(input_part->'state') IS DISTINCT FROM 'string' OR input_part->>'state' NOT IN('unassigned','assigned','completed','cancelled') OR crest_private.booking_text_required(input_part->'scopeDescription',2000) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
   FOREACH reason IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP IF jsonb_typeof(input_part->reason) IS DISTINCT FROM 'string' OR(input_part->>reason)!~'^(0|[1-9][0-9]{0,18})$' OR(input_part->>reason)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
  END LOOP;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'sourceAllocationId') FROM jsonb_array_elements(body->'allocationPlans'))<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.book',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.book' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF mode.id IS NULL THEN
    IF expected_mode_sequence<>0 THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.fulfillment_mode_versions(business_id,sequence,replaces_sequence,mobile_enabled,dropoff_enabled,pickup_return_enabled,reason,created_by,operation_id) VALUES(requested_business,1,NULL,true,true,false,NULL,expected_actor,requested_operation) RETURNING * INTO mode;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('fulfillment_modes',requested_business,1,'initialize',NULL,crest_private.fulfillment_mode_projection(mode)));
   ELSIF mode.sequence<>expected_mode_sequence THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF NOT(CASE body->>'fulfillmentMode' WHEN 'mobile' THEN mode.mobile_enabled WHEN 'dropoff' THEN mode.dropoff_enabled WHEN 'pickup_return' THEN mode.pickup_return_enabled ELSE false END) THEN reason:='mode_disabled';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job) THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   SELECT * INTO customer FROM crest.customers WHERE business_id=requested_business AND id=(body->>'customerId')::uuid FOR SHARE;
   IF customer.id IS NULL OR customer.archived_at IS NOT NULL OR customer.version::text<>body->>'expectedCustomerVersion' THEN reason:='customer';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF crest_private.valid_booking_location(body->'workLocation',requested_business,customer.id,true) IS NOT TRUE THEN reason:='location';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   PERFORM 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=(body->>'operatorId')::uuid AND active FOR SHARE;
   IF NOT FOUND THEN reason:='operator';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   FOR family IN SELECT DISTINCT e.agreement_family_id FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.id IN(SELECT(value->>'sourceAllocationId')::uuid FROM jsonb_array_elements(body->'allocationPlans')) ORDER BY e.agreement_family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   INSERT INTO crest.operator_controls(business_id,operator_actor_id,created_by,operation_id) VALUES(requested_business,(body->>'operatorId')::uuid,expected_actor,requested_operation) ON CONFLICT(business_id,operator_actor_id) DO NOTHING RETURNING * INTO control;
   IF control.id IS NOT NULL THEN audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('operator_controls',control.id,1,'create',NULL,crest_private.operator_controls_projection(control)));END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,(body->>'operatorId')::uuid);
   INSERT INTO crest.jobs(id,business_id,customer_id,operator_actor_id,fulfillment_mode,mode_version_id,work_address_id,work_location_snapshot,state,current_appointment_id,created_by,updated_by,operation_id)
   VALUES(requested_job,requested_business,customer.id,(body->>'operatorId')::uuid,body->>'fulfillmentMode',mode.id,CASE WHEN body->'workLocation'->>'kind'='customer_address' THEN(body->'workLocation'->>'addressId')::uuid ELSE NULL END,body->'workLocation','scheduled',gen_random_uuid(),expected_actor,expected_actor,requested_operation) RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'create',NULL,crest_private.jobs_projection(j));audit_ids:=audit_ids||jsonb_build_array(job_audit);
   FOR input_vehicle IN SELECT value FROM jsonb_array_elements(body->'vehicles') ORDER BY value->>'vehicleId' LOOP
    SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=requested_business AND id=(input_vehicle->>'vehicleId')::uuid FOR SHARE;
    IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL OR vehicle.version::text<>input_vehicle->>'expectedVersion' THEN reason:='vehicle';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF input_vehicle->'customerVehicleId'<>'null'::jsonb THEN SELECT * INTO association FROM crest.customer_vehicles WHERE business_id=requested_business AND id=(input_vehicle->>'customerVehicleId')::uuid AND customer_id=customer.id AND vehicle_id=vehicle.id AND valid_to IS NULL FOR SHARE;IF association.id IS NULL THEN reason:='vehicle';RAISE EXCEPTION USING ERRCODE='P1601';END IF;END IF;
    INSERT INTO crest.job_vehicles(business_id,job_id,vehicle_id,customer_vehicle_id,vehicle_snapshot,customer_snapshot,pickup_address_id,return_address_id,pickup_location_snapshot,return_location_snapshot,created_by,operation_id)
    VALUES(requested_business,j.id,vehicle.id,(input_vehicle->>'customerVehicleId')::uuid,crest_private.vehicle_projection(vehicle),crest_private.customer_projection(customer),CASE WHEN input_vehicle->'pickupLocation'->>'kind'='customer_address' THEN(input_vehicle->'pickupLocation'->>'addressId')::uuid ELSE NULL END,CASE WHEN input_vehicle->'returnLocation'->>'kind'='customer_address' THEN(input_vehicle->'returnLocation'->>'addressId')::uuid ELSE NULL END,nullif(input_vehicle->'pickupLocation','null'::jsonb),nullif(input_vehicle->'returnLocation','null'::jsonb),expected_actor,requested_operation) RETURNING * INTO jv;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_vehicles',jv.id,1,'create',NULL,crest_private.job_vehicles_projection(jv)));
   END LOOP;
   FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
    SELECT * INTO source_row FROM crest.scope_allocations WHERE business_id=requested_business AND id=(input_plan->>'sourceAllocationId')::uuid;
    SELECT * INTO source_entitlement FROM crest.scope_entitlements WHERE business_id=requested_business AND id=source_row.entitlement_id;
    IF source_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state active JOIN crest.agreements agreement ON agreement.business_id=active.business_id AND agreement.id=active.current_agreement_id WHERE active.business_id=requested_business AND active.family_id=source_entitlement.agreement_family_id AND active.current_agreement_id=source_row.agreement_id AND agreement.customer_id=customer.id) THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF NOT EXISTS(SELECT 1 FROM crest.job_encounters WHERE business_id=requested_business AND job_id=j.id AND family_id=source_entitlement.agreement_family_id) THEN
     INSERT INTO crest.job_encounters(business_id,job_id,customer_id,family_id,agreement_id,encounter_id,created_by,operation_id) VALUES(requested_business,j.id,customer.id,source_entitlement.agreement_family_id,source_row.agreement_id,source_entitlement.agreement_family_id,expected_actor,requested_operation) RETURNING * INTO encounter;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_encounters',encounter.id,1,'create',NULL,crest_private.job_encounters_projection(encounter)));
    END IF;
    SELECT coalesce(max(sequence),0) INTO current_sequence FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id;
    IF current_sequence::text<>input_plan->>'expectedSequence' THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id) VALUES(requested_business,source_row.id,current_sequence+1,(SELECT id FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id AND sequence=current_sequence),input_plan->>'reason',expected_actor,requested_operation) RETURNING * INTO p;
    plan_ids:=plan_ids||jsonb_build_array(p.id);audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,(input_part->>'partitionId')::uuid,(input_part->>'jobId')::uuid,input_part->>'state',(input_part->>'grossInclusiveCents')::bigint,(input_part->>'discountInclusiveCents')::bigint,(input_part->>'amountCents')::bigint,input_part->>'scopeDescription',expected_actor,requested_operation) RETURNING * INTO part;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   INSERT INTO crest.appointments(id,business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(j.current_appointment_id,requested_business,j.id,1,NULL,(slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz,slot->>'timezone',(slot->>'local_start')::timestamp,(slot->>'local_end')::timestamp,(slot->>'start_offset_minutes')::integer,(slot->>'end_offset_minutes')::integer,(slot->>'travel_before_seconds')::integer,(slot->>'travel_after_seconds')::integer,'confirmed',slot->'customer_confirmation',slot->'contact_snapshot',(slot->>'unknown_travel_reviewed')::boolean,NULL,expected_actor,requested_operation) RETURNING * INTO a;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');
   review_snapshot:=crest_private.booking_slot_review(requested_business,j.operator_actor_id,j.id,blocked,a.travel_before_seconds,a.travel_after_seconds);
   SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO actual_conflicts FROM jsonb_array_elements(review_snapshot->'conflictingAppointmentIds');
   SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO expected_conflicts FROM jsonb_array_elements(review->'expectedAppointmentIds');
   unknown_travel:=(review_snapshot->>'unknownTravel')::boolean;
   IF actual_conflicts IS DISTINCT FROM expected_conflicts OR unknown_travel IS DISTINCT FROM(review->>'expectedUnknownTravel')::boolean OR unknown_travel AND NOT a.unknown_travel_reviewed THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF cardinality(actual_conflicts)>0 THEN
    IF review->'overrideReason'='null'::jsonb THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.schedule_overrides(business_id,job_id,appointment_id,reason,created_by,operation_id) VALUES(requested_business,j.id,a.id,review->>'overrideReason',expected_actor,requested_operation) RETURNING * INTO override_row;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_overrides',override_row.id,1,'create',NULL,crest_private.schedule_overrides_projection(override_row)));
    FOREACH conflicting IN ARRAY actual_conflicts LOOP INSERT INTO crest.schedule_override_conflicts(business_id,override_id,conflicting_appointment_id,created_by,operation_id) VALUES(requested_business,override_row.id,conflicting,expected_actor,requested_operation) RETURNING * INTO conflict_row;audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_override_conflicts',conflict_row.id,1,'create',NULL,crest_private.schedule_override_conflicts_projection(conflict_row)));END LOOP;
   END IF;
   INSERT INTO crest.schedule_reservations(business_id,job_id,appointment_id,operator_actor_id,blocked_interval,unknown_travel,override_id,created_by,operation_id) VALUES(requested_business,j.id,a.id,j.operator_actor_id,blocked,unknown_travel,override_row.id,expected_actor,requested_operation) RETURNING * INTO reservation;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,1,'create',NULL,crest_private.schedule_reservations_projection(reservation)));
   original:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,1,NULL,'scheduled',j.created_at,NULL,jsonb_build_object('request',original,'planIds',plan_ids,'confirmationDraft',crest_private.schedule_confirmation_draft(requested_business,j.id,a.id)),expected_actor,requested_operation) RETURNING * INTO event;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',audit_ids);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1601' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $book$;
CREATE FUNCTION crest_commands.lookup_booked_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.booking_slot_review(uuid,uuid,uuid,tstzrange,integer,integer) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED confirmed-bookings-commands.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-reads.sql
-- Unregistered authorized job reads. No direct table access or financial data.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.booked_job_operation_result(uuid,uuid,uuid)') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_READ_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_confirmed_jobs(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_from timestamptz,requested_until timestamptz,after_start timestamptz,after_job uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_from IS NULL OR requested_until IS NULL OR NOT isfinite(requested_from) OR NOT isfinite(requested_until) OR requested_from<'0001-01-01T00:00:00Z'::timestamptz OR requested_until>='10000-01-01T00:00:00Z'::timestamptz OR requested_until<=requested_from OR requested_until-requested_from>interval '93 days' OR(after_start IS NULL)<>(after_job IS NULL) OR after_start IS NOT NULL AND NOT isfinite(after_start) OR page_limit IS NULL OR page_limit<1 OR page_limit>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH candidates AS MATERIALIZED(
  SELECT j.*,a.id AS appointment_id,a.sequence AS appointment_sequence,a.start_at,a.end_at,a.timezone,a.confirmation_state,r.unknown_travel,c.display_name
  FROM crest.jobs j JOIN crest.appointments a ON a.business_id=j.business_id AND a.job_id=j.id AND a.id=j.current_appointment_id
  JOIN crest.customers c ON c.business_id=j.business_id AND c.id=j.customer_id
  LEFT JOIN crest.schedule_reservations r ON r.business_id=j.business_id AND r.job_id=j.id AND r.appointment_id=a.id
  WHERE j.business_id=requested_business AND a.end_at>requested_from AND a.start_at<requested_until AND(after_start IS NULL OR ROW(a.start_at,j.id)>ROW(after_start,after_job)) ORDER BY a.start_at,j.id LIMIT page_limit+1
 ), page AS(SELECT * FROM candidates ORDER BY start_at,id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobs',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'jobId',p.id,'version',p.version::text,'state',p.state,'customerId',p.customer_id,'customerName',p.display_name,'operatorId',p.operator_actor_id,'fulfillmentMode',p.fulfillment_mode,
  'appointmentId',p.appointment_id,'appointmentSequence',p.appointment_sequence::text,'startAt',to_char(p.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(p.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',p.timezone,'confirmationState',p.confirmation_state,'unknownTravel',p.unknown_travel,'workLocation',p.work_location_snapshot,
  'vehicleCount',(SELECT count(*)::integer FROM crest.job_vehicles v WHERE v.business_id=p.business_id AND v.job_id=p.id),
  'pendingAppointment',(SELECT CASE WHEN latest.confirmation_state='proposed' AND latest.sequence>p.appointment_sequence THEN jsonb_build_object('appointmentId',latest.id,'sequence',latest.sequence::text,'startAt',to_char(latest.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(latest.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',latest.timezone) ELSE NULL END FROM crest.appointments latest WHERE latest.business_id=p.business_id AND latest.job_id=p.id ORDER BY latest.sequence DESC LIMIT 1),
  'vehicleLabels',coalesce((SELECT jsonb_agg(v.label ORDER BY v.id) FROM(SELECT id,vehicle_snapshot->>'label' AS label FROM crest.job_vehicles WHERE business_id=p.business_id AND job_id=p.id ORDER BY id LIMIT 3)v),'[]'::jsonb)
 ) ORDER BY p.start_at,p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*) FROM candidates)>page_limit) INTO result;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $list$;
CREATE FUNCTION crest_commands.read_confirmed_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $detail$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'job',crest_private.jobs_projection(j),'appointment',crest_private.appointments_projection(a),
  'latestAppointment',(SELECT crest_private.appointments_projection(latest) FROM crest.appointments latest WHERE latest.business_id=j.business_id AND latest.job_id=j.id ORDER BY latest.sequence DESC LIMIT 1),
  'confirmationDraft',(SELECT e.evidence->'confirmationDraft' FROM crest.job_events e WHERE e.business_id=j.business_id AND e.job_id=j.id AND e.operation_id=(SELECT latest.operation_id FROM crest.appointments latest WHERE latest.business_id=j.business_id AND latest.job_id=j.id ORDER BY latest.sequence DESC LIMIT 1)),
  'vehicleCount',(SELECT count(*)::integer FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
  'encounterCount',(SELECT count(*)::integer FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
  'allocationCount',(SELECT count(*)::integer FROM crest.current_scope_allocation_parts p WHERE p.business_id=j.business_id AND p.job_id=j.id)) INTO result
 FROM crest.jobs j JOIN crest.appointments a ON a.business_id=j.business_id AND a.id=j.current_appointment_id AND a.job_id=j.id WHERE j.business_id=requested_business AND j.id=requested_job;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $detail$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_confirmed_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,timestamptz,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_confirmed_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,timestamptz,uuid,integer),crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_confirmed_jobs(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,timestamptz,uuid,integer),crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED confirmed-bookings-reads.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-enable.sql
-- Unregistered construction dependency: admit only the installed book command.
-- This does not register schema50 or activate the running owner database.
DO $review$
DECLARE name text;role_name text;
BEGIN
 FOREACH role_name IN ARRAY ARRAY['crest_booking_owner','crest_booking_integrity_owner'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
   OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=role_name::regrole OR member=role_name::regrole)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_booking_owner'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_job_graph(uuid,uuid,uuid)') AND proowner='crest_booking_integrity_owner'::regrole AND prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
 FOREACH name IN ARRAY ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('crest.'||name) AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_construction_closed' AND tgenabled='O' AND tgfoid='crest_private.booking_construction_closed()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_stamp' AND tgenabled='O' AND tgfoid='crest_private.stamp_booking_row()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_audit' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_row_audit()'::regprocedure)
   OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_retain_truncate' AND tgenabled='O' AND tgfoid='crest_private.retain_booking_history()'::regprocedure)
   OR has_table_privilege('crest_web','crest.'||name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
  IF name IN('jobs','job_vehicles','job_encounters','appointments','schedule_reservations','schedule_overrides','schedule_override_conflicts','job_events') AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('crest.'||name) AND tgname='booking_graph' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_job_source()'::regprocedure) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.allocation_plan_versions'::regclass AND tgname='booking_validate_plan' AND tgenabled='O' AND tgfoid='crest_private.validate_booking_plan_append()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.allocation_plan_versions'::regclass AND tgname='booking_plan_total' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_plan()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.allocation_plan_parts'::regclass AND tgname='booking_plan_part_total' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_plan()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.schedule_reservations'::regclass AND tgname='booking_validate_reservation' AND tgenabled='O' AND tgfoid='crest_private.validate_booking_reservation()'::regprocedure)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_GUARDS_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.authorize_booking_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
BEGIN
 IF current_user<>'crest_booking_owner' OR TG_OP<>'INSERT' OR NOT EXISTS(
  SELECT 1 FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND command_type='operations.job.book' AND schema_version=1 AND state='pending')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 RETURN NULL;
END $guard$;
REVOKE ALL ON FUNCTION crest_private.authorize_booking_statement() FROM PUBLIC;
DO $install$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['jobs','job_vehicles','job_encounters','appointments','operator_controls','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events'] LOOP
  EXECUTE format('DROP TRIGGER booking_construction_closed ON crest.%I',name);
  EXECUTE format('CREATE TRIGGER booking_command_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.authorize_booking_statement()',name);
 END LOOP;
END $install$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED confirmed-bookings-enable.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-cancel.sql
-- Unregistered BR06 cancellation, before any physical work. No fee, message
-- delivery, refund, financial posting or reopening of a terminal job occurs.
-- Communication records owner-observed facts: not_sent / sent / no_contact.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.authorize_booking_statement()') IS NULL OR to_regprocedure('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
  OR(SELECT count(*) FROM pg_trigger WHERE tgname='booking_command_guard' AND tgenabled='O' AND tgfoid='crest_private.authorize_booking_statement()'::regprocedure AND tgrelid IN('crest.jobs'::regclass,'crest.job_vehicles'::regclass,'crest.job_encounters'::regclass,'crest.appointments'::regclass,'crest.operator_controls'::regclass,'crest.schedule_reservations'::regclass,'crest.schedule_overrides'::regclass,'crest.schedule_override_conflicts'::regclass,'crest.allocation_plan_versions'::regclass,'crest.allocation_plan_parts'::regclass,'crest.job_events'::regclass))<>11
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CANCELLATION_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.valid_booking_communication(v jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $communication$
BEGIN
 IF v IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR v-ARRAY['state','channel','effectiveAt','evidenceNote']<>'{}'::jsonb OR NOT v ?& ARRAY['state','channel','effectiveAt','evidenceNote'] THEN RETURN false;END IF;
 IF v->>'state'='sent' THEN RETURN crest_private.valid_booking_confirmation(v-'state',recorded);END IF;
 RETURN v->>'state' IN('not_sent','no_contact') AND v->'channel'='null'::jsonb AND v->'effectiveAt'='null'::jsonb AND(CASE WHEN v->>'state'='no_contact' THEN crest_private.booking_text_required(v->'evidenceNote',2000) ELSE v->'evidenceNote'='null'::jsonb OR crest_private.booking_text_required(v->'evidenceNote',2000) END);
END $communication$;
GRANT UPDATE(state,current_appointment_id,version,updated_by,operation_id) ON crest.jobs TO crest_booking_owner;
CREATE POLICY booking_cancel_root ON crest.jobs FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='cancelled');
GRANT DELETE ON crest.schedule_reservations TO crest_booking_owner;
CREATE POLICY booking_cancel_reservation ON crest.schedule_reservations FOR DELETE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_private.cancelled_job_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;predecessor crest.appointments;original jsonb;source_audit crest_private.audit_events;stored jsonb;table_name text;expected_count bigint;counted bigint;prior_appointment uuid;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.cancel';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text OR jsonb_typeof(r->'version') IS DISTINCT FROM 'string' OR(r->>'version')!~'^[1-9][0-9]{0,18}$' OR(r->>'version')::numeric>9223372036854775807 OR jsonb_typeof(r->'appointmentSequence') IS DISTINCT FROM 'string' OR(r->>'appointmentSequence')!~'^[1-9][0-9]{0,18}$' OR(r->>'appointmentSequence')::numeric>9223372036854775807 OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=(r->>'version')::bigint AND action='revise';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'version')::bigint AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'appointmentSequence')::bigint AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';prior_appointment:=(journal.delta->'before'->>'current_appointment_id')::uuid;
 SELECT * INTO predecessor FROM crest.appointments WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND id=(event.evidence->>'historyPredecessorId')::uuid;
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR(original->>'expectedJobVersion')::numeric+1 IS DISTINCT FROM(r->>'version')::numeric
  OR journal.delta->'before'->>'state' IS DISTINCT FROM 'scheduled' OR journal.delta->'after'->>'state' IS DISTINCT FROM 'cancelled' OR journal.delta->'before'->>'version' IS DISTINCT FROM original->>'expectedJobVersion' OR journal.delta->'after'->>'version' IS DISTINCT FROM r->>'version' OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR predecessor.id IS NULL OR a.replaces_id IS DISTINCT FROM predecessor.id OR a.sequence<>predecessor.sequence+1 OR a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL OR a.reason IS DISTINCT FROM original->'payload'->>'reason' OR event.reason IS DISTINCT FROM a.reason OR event.from_state<>'scheduled' OR event.to_state<>'cancelled'
  OR crest_private.valid_booking_communication(original->'payload'->'customerCommunication',event.created_at) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid AND state='cancelled' AND version=(r->>'version')::bigint AND current_appointment_id=a.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedJobVersion',original->>'expectedJobVersion','payload',original->'payload')::text,'UTF8')),'hex');IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 counted:=0; FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  counted:=counted+1;table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN IF source_audit.id<>journal.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   IF source_audit.entity_version<>2 OR source_audit.action<>'release' OR source_audit.delta->'after' IS DISTINCT FROM 'null'::jsonb OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM r->>'jobId' OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM prior_appointment::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;CONTINUE;
  ELSIF table_name IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
   IF source_audit.action<>'create' OR source_audit.entity_version<>1 OR source_audit.delta->'before' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.delta->>'schemaVersion'<>'1' OR source_audit.delta->'after' IS DISTINCT FROM stored THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.valid_booking_communication(jsonb,timestamptz) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.cancelled_job_operation_result(uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.valid_booking_communication(jsonb,timestamptz),crest_private.cancelled_job_operation_result(uuid,uuid,uuid) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.cancel_scheduled_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $cancel$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;before_job crest.jobs;j crest.jobs;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;reservation crest.schedule_reservations;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;part crest.allocation_plan_parts;prior_part crest.allocation_plan_parts;event crest.job_events;family uuid;source uuid;reason text;source_audits jsonb:='[]'::jsonb;job_audit uuid;original jsonb;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['reason','customerCommunication']<>'{}'::jsonb OR NOT body ?& ARRAY['reason','customerCommunication'] OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.valid_booking_communication(body->'customerCommunication',clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.cancel',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.cancel' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF before_job.id IS NULL THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN reason:='version';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   IF before_job.state<>'scheduled' OR before_job.first_work_at IS NOT NULL THEN reason:='state';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=before_job.id;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=before_job.id ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR latest.id IS NULL OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
   INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(requested_business,before_job.id,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=before_job.id RETURNING * INTO reservation;
   IF reservation.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL));
   UPDATE crest.jobs SET state='cancelled',current_appointment_id=a.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=before_job.id RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));source_audits:=source_audits||jsonb_build_array(job_audit);
   FOR source IN SELECT DISTINCT source_allocation_id FROM crest.current_scope_allocation_parts WHERE business_id=requested_business AND job_id=j.id ORDER BY source_allocation_id LOOP
    SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source ORDER BY sequence DESC LIMIT 1;
    IF previous.id IS NULL OR previous.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id) VALUES(requested_business,source,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation) RETURNING * INTO p;
    source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id)
     VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=j.id THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;
     source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   original:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,'scheduled','cancelled',j.updated_at,body->>'reason',jsonb_build_object('request',original,'historyPredecessorId',latest.id),expected_actor,requested_operation) RETURNING * INTO event;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',source_audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1602' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $cancel$;
CREATE FUNCTION crest_commands.lookup_cancelled_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
DECLARE kind text;
BEGIN
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $guard$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED confirmed-bookings-cancel.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-reschedule.sql
-- Unregistered P06/BR06 lifecycle. A proposal/withdrawal retains the current
-- confirmed pointer and reservation. Only recorded customer confirmation swaps
-- them. Every version and generated draft is retained; no message is sent.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NULL
  OR to_regprocedure('crest_private.schedule_confirmation_draft(uuid,uuid,uuid)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_integrity_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole) OR member IN('crest_booking_integrity_owner'::regrole,'crest_booking_owner'::regrole))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RESCHEDULE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.schedule_confirmation_draft(business uuid,job uuid,appointment uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $draft$
DECLARE j crest.jobs;a crest.appointments;customer_name text;labels jsonb;scope_rows jsonb;location_text text;body_text text;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO a FROM crest.appointments WHERE business_id=business AND job_id=job AND id=appointment;
 SELECT display_name INTO customer_name FROM crest.customers WHERE business_id=business AND id=j.customer_id;
 IF j.id IS NULL OR a.id IS NULL OR customer_name IS NULL OR a.confirmation_state NOT IN('proposed','confirmed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_DRAFT_SOURCE_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('vehicleId',vehicle_id,'label',vehicle_snapshot->>'label') ORDER BY vehicle_id),'[]'::jsonb) INTO labels FROM crest.job_vehicles WHERE business_id=business AND job_id=job;
 SELECT coalesce(jsonb_agg(jsonb_build_object('sourceAllocationId',source_allocation_id,'partitionId',stable_partition_id,'scopeDescription',scope_description,'amountCents',amount_cents::text) ORDER BY source_allocation_id,stable_partition_id),'[]'::jsonb) INTO scope_rows FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state='assigned';
 location_text:=CASE WHEN j.work_location_snapshot->>'kind'='manual' THEN j.work_location_snapshot->>'locationText' ELSE coalesce(nullif(j.work_location_snapshot->'snapshot'->>'exact_location_text',''),concat_ws(', ',j.work_location_snapshot->'snapshot'->>'line1',j.work_location_snapshot->'snapshot'->>'line2',j.work_location_snapshot->'snapshot'->>'city',j.work_location_snapshot->'snapshot'->>'region',j.work_location_snapshot->'snapshot'->>'postal_code',j.work_location_snapshot->'snapshot'->>'country')) END;
 body_text:='Hi '||customer_name||CASE WHEN a.confirmation_state='confirmed' THEN ', your detailing appointment is confirmed for ' ELSE ', please confirm your updated detailing appointment for ' END||to_char(a.local_start,'YYYY-MM-DD HH24:MI')||' to '||to_char(a.local_end,'YYYY-MM-DD HH24:MI')||' ('||a.timezone||') at '||location_text||'.';
 RETURN jsonb_build_object('schemaVersion',1,'kind','appointment_confirmation','state','prepared','businessId',business,'jobId',j.id,'appointmentId',a.id,'confirmationState',a.confirmation_state,'customerId',j.customer_id,'customerName',customer_name,'fulfillmentMode',j.fulfillment_mode,'workLocation',j.work_location_snapshot,'startAt',to_char(a.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'endAt',to_char(a.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',a.timezone,'vehicles',labels,'scope',scope_rows,'bodyText',body_text);
END $draft$;
CREATE FUNCTION crest_private.validate_booking_appointment_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $append$
DECLARE latest crest.appointments;operator uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 SELECT operator_actor_id INTO operator FROM crest.jobs WHERE business_id=NEW.business_id AND id=NEW.job_id;PERFORM crest_private.lock_booking_operator(NEW.business_id,operator);
 SELECT * INTO latest FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id ORDER BY sequence DESC LIMIT 1;
 IF NEW.sequence<>coalesce(latest.sequence,0)+1 OR NEW.replaces_id IS DISTINCT FROM latest.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_APPOINTMENT_APPEND_CONFLICT';END IF;RETURN NEW;
END $append$;
CREATE TRIGGER booking_appointment_append BEFORE INSERT ON crest.appointments FOR EACH ROW EXECUTE FUNCTION crest_private.validate_booking_appointment_append();
CREATE FUNCTION crest_private.check_booking_schedule_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $event$
DECLARE kind text;action text;a crest.appointments;prior crest.appointments;old_current crest.appointments;before_row jsonb;after_row jsonb;review jsonb;blocked tstzrange;
BEGIN
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND state='committed';
 SELECT * INTO a FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND operation_id=NEW.operation_id;
 SELECT * INTO prior FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND id=a.replaces_id;
 SELECT delta->'before',delta->'after' INTO before_row,after_row FROM crest_private.audit_events WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND entity_kind='jobs' AND entity_id=NEW.job_id AND entity_version=NEW.sequence;
 IF a.id IS NULL OR after_row IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 IF kind='operations.job.book' THEN
  IF NEW.evidence->'confirmationDraft' IS DISTINCT FROM crest_private.schedule_confirmation_draft(NEW.business_id,NEW.job_id,a.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_DRAFT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF before_row IS NULL OR prior.id IS NULL OR a.sequence<>prior.sequence+1 OR a.reason IS DISTINCT FROM NEW.reason THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 SELECT * INTO old_current FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND id=(before_row->>'current_appointment_id')::uuid;
 IF kind='operations.job.cancel' THEN
  IF a.replaces_id IS DISTINCT FROM(NEW.evidence->>'historyPredecessorId')::uuid OR a.customer_confirmation IS NOT NULL OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(old_current.start_at,old_current.end_at,old_current.timezone,old_current.local_start,old_current.local_end,old_current.start_offset_minutes,old_current.end_offset_minutes,old_current.travel_before_seconds,old_current.travel_after_seconds,old_current.contact_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_APPOINTMENT_SOURCE_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF kind IS DISTINCT FROM 'operations.job.reschedule' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 action:=NEW.evidence->'request'->'payload'->>'action';
 IF action NOT IN('propose','confirm','withdraw') OR action IS NULL OR NEW.evidence->'request'->'payload'->>'latestAppointmentId' IS DISTINCT FROM prior.id::text
  OR(before_row-ARRAY['version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id']) IS DISTINCT FROM(after_row-ARRAY['version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id'])
  OR action<>'confirm' AND ROW(before_row->>'current_appointment_id',before_row->>'mode_version_id') IS DISTINCT FROM ROW(after_row->>'current_appointment_id',after_row->>'mode_version_id')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_EVENT_SOURCE_REQUIRED';END IF;
 IF action='confirm' THEN
  IF prior.confirmation_state<>'proposed' OR a.confirmation_state<>'confirmed' OR after_row->>'current_appointment_id' IS DISTINCT FROM a.id::text OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(prior.start_at,prior.end_at,prior.timezone,prior.local_start,prior.local_end,prior.start_offset_minutes,prior.end_offset_minutes,prior.travel_before_seconds,prior.travel_after_seconds,prior.contact_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_CONFIRMATION_SOURCE_REQUIRED';END IF;
 ELSIF action='withdraw' THEN
  IF prior.confirmation_state<>'proposed' OR a.confirmation_state<>'withdrawn' OR coalesce(NEW.evidence->'confirmationDraft','null'::jsonb)<>'null'::jsonb OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(prior.start_at,prior.end_at,prior.timezone,prior.local_start,prior.local_end,prior.start_offset_minutes,prior.end_offset_minutes,prior.travel_before_seconds,prior.travel_after_seconds,prior.contact_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_WITHDRAWAL_SOURCE_REQUIRED';END IF;RETURN NULL;
 ELSE
  IF a.confirmation_state<>'proposed' OR a.customer_confirmation IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_PROPOSAL_SOURCE_REQUIRED';END IF;
  blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');review:=crest_private.booking_slot_review(NEW.business_id,(after_row->>'operator_actor_id')::uuid,NEW.job_id,blocked,a.travel_before_seconds,a.travel_after_seconds);
  IF NEW.evidence->'slotReview' IS DISTINCT FROM review THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_REVIEW_SOURCE_REQUIRED';END IF;
 END IF;
 IF NEW.evidence->'confirmationDraft' IS DISTINCT FROM crest_private.schedule_confirmation_draft(NEW.business_id,NEW.job_id,a.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULE_DRAFT_REQUIRED';END IF;RETURN NULL;
END $event$;
CREATE CONSTRAINT TRIGGER booking_schedule_event AFTER INSERT ON crest.job_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_booking_schedule_event();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.schedule_confirmation_draft(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.validate_booking_appointment_append() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_booking_schedule_event() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.schedule_confirmation_draft(uuid,uuid,uuid),crest_private.validate_booking_appointment_append(),crest_private.check_booking_schedule_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.schedule_confirmation_draft(uuid,uuid,uuid) TO crest_booking_owner;

RESET ROLE;
-- END REVIEWED confirmed-bookings-reschedule.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-reschedule-commands.sql
-- Unregistered reschedule commands. All actions retain one job and its exact
-- accepted allocation plans. Proposals/withdrawals retain the confirmed slot.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.schedule_confirmation_draft(uuid,uuid,uuid)') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.appointments'::regclass AND tgname='booking_appointment_append' AND tgenabled='O' AND tgfoid='crest_private.validate_booking_appointment_append()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='crest.job_events'::regclass AND tgname='booking_schedule_event' AND tgenabled='O' AND tgdeferrable AND tginitdeferred AND tgfoid='crest_private.check_booking_schedule_event()'::regprocedure)
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RESCHEDULE_COMMAND_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT UPDATE(mode_version_id) ON crest.jobs TO crest_booking_owner;
CREATE POLICY booking_reschedule_root ON crest.jobs FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='scheduled');
CREATE FUNCTION crest_private.rescheduled_job_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;prior crest.appointments;original jsonb;source_audit crest_private.audit_events;stored jsonb;table_name text;action_name text;digest text;expected_count bigint;counted bigint;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.reschedule';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','latestAppointmentId','appointmentSequence','currentAppointmentId','confirmationState','action','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','latestAppointmentId','appointmentSequence','currentAppointmentId','confirmationState','action','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text OR jsonb_typeof(r->'version') IS DISTINCT FROM 'string' OR(r->>'version')!~'^[1-9][0-9]{0,18}$' OR(r->>'version')::numeric>9223372036854775807 OR jsonb_typeof(r->'appointmentSequence') IS DISTINCT FROM 'string' OR(r->>'appointmentSequence')!~'^[1-9][0-9]{0,18}$' OR(r->>'appointmentSequence')::numeric>9223372036854775807 OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'latestAppointmentId') OR NOT crest_private.booking_uuid(r->'currentAppointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') OR r->>'action' NOT IN('propose','confirm','withdraw') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=(r->>'version')::bigint AND action='revise';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'version')::bigint AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'latestAppointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'appointmentSequence')::bigint AND operation_id=operation AND created_by=actor;
 SELECT * INTO prior FROM crest.appointments WHERE business_id=business AND job_id=a.job_id AND id=a.replaces_id;original:=event.evidence->'request';action_name:=original->'payload'->>'action';
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR prior.id IS NULL OR a.sequence<>prior.sequence+1 OR original->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR(original->>'expectedJobVersion')::numeric+1 IS DISTINCT FROM(r->>'version')::numeric OR original->'payload'->>'latestAppointmentId' IS DISTINCT FROM prior.id::text OR action_name IS DISTINCT FROM r->>'action'
  OR journal.delta->'before'->>'state' IS DISTINCT FROM 'scheduled' OR journal.delta->'after'->>'state' IS DISTINCT FROM 'scheduled' OR journal.delta->'before'->>'version' IS DISTINCT FROM original->>'expectedJobVersion' OR journal.delta->'after'->>'version' IS DISTINCT FROM r->>'version' OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM r->>'currentAppointmentId' OR r->>'confirmationState' IS DISTINCT FROM a.confirmation_state OR a.reason IS DISTINCT FROM original->'payload'->>'reason' OR event.reason IS DISTINCT FROM a.reason OR event.from_state<>'scheduled' OR event.to_state<>'scheduled'
  OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 IF action_name='confirm' THEN
  IF a.confirmation_state<>'confirmed' OR prior.confirmation_state<>'proposed' OR r->>'currentAppointmentId' IS DISTINCT FROM a.id::text OR a.customer_confirmation IS DISTINCT FROM original->'payload'->'customerConfirmation' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 ELSE
  IF a.confirmation_state IS DISTINCT FROM(CASE action_name WHEN 'propose' THEN 'proposed' WHEN 'withdraw' THEN 'withdrawn' END) OR a.customer_confirmation IS NOT NULL OR journal.delta->'before'->>'current_appointment_id' IS DISTINCT FROM r->>'currentAppointmentId' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.reschedule','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedJobVersion',original->>'expectedJobVersion','payload',original->'payload')::text,'UTF8')),'hex');IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 counted:=0;FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  counted:=counted+1;table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN IF source_audit.id<>journal.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   IF action_name<>'confirm' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
   IF source_audit.action='release' THEN
    IF source_audit.entity_version<>2 OR source_audit.delta->'after' IS DISTINCT FROM 'null'::jsonb OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM r->>'jobId' OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM journal.delta->'before'->>'current_appointment_id' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;CONTINUE;
   END IF;
   stored:=source_audit.delta->'after';IF source_audit.action<>'create' OR source_audit.entity_version<>1 OR source_audit.delta->'before' IS DISTINCT FROM 'null'::jsonb OR stored->>'job_id' IS DISTINCT FROM r->>'jobId' OR stored->>'appointment_id' IS DISTINCT FROM a.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
  ELSIF table_name IN('appointments','job_events','schedule_overrides','schedule_override_conflicts') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
   IF source_audit.action<>'create' OR source_audit.entity_version<>1 OR source_audit.delta->'before' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.delta->>'schemaVersion'<>'1' OR source_audit.delta->'after' IS DISTINCT FROM stored THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_RESULT_REVIEW_REQUIRED';END IF;RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.rescheduled_job_operation_result(uuid,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.rescheduled_job_operation_result(uuid,uuid,uuid) FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.change_job_schedule(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $change$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;before_job crest.jobs;j crest.jobs;latest crest.appointments;a crest.appointments;mode crest.fulfillment_mode_versions;reservation crest.schedule_reservations;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;event crest.job_events;family uuid;conflicting uuid;action_name text;reason text;field text;slot jsonb;review jsonb;slot_review jsonb;blocked tstzrange;actual_conflicts uuid[];expected_conflicts uuid[];source_audits jsonb:='[]'::jsonb;job_audit uuid;original jsonb;command_result jsonb;draft jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>1048576 OR body-ARRAY['action','reason','latestAppointmentId','expectedModeSequence','appointment','customerConfirmation','conflictReview']<>'{}'::jsonb OR NOT body ?& ARRAY['action','reason','latestAppointmentId','expectedModeSequence','appointment','customerConfirmation','conflictReview'] OR jsonb_typeof(body->'action') IS DISTINCT FROM 'string' OR body->>'action' NOT IN('propose','confirm','withdraw') OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR NOT crest_private.booking_uuid(body->'latestAppointmentId') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;
 action_name:=body->>'action';slot:=body->'appointment';review:=body->'conflictReview';
 IF action_name='withdraw' THEN
  IF body->'expectedModeSequence'<>'null'::jsonb OR slot<>'null'::jsonb OR body->'customerConfirmation'<>'null'::jsonb OR review<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;
 ELSE
  IF jsonb_typeof(body->'expectedModeSequence') IS DISTINCT FROM 'string' OR(body->>'expectedModeSequence')!~'^[1-9][0-9]{0,18}$' OR(body->>'expectedModeSequence')::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;
  IF action_name='propose' THEN
   IF jsonb_typeof(slot) IS DISTINCT FROM 'object' OR slot-ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','contact_snapshot']<>'{}'::jsonb OR NOT slot ?& ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','contact_snapshot'] OR body->'customerConfirmation'<>'null'::jsonb OR review<>'null'::jsonb OR crest_private.valid_booking_contact(slot->'contact_snapshot') IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;
   FOREACH field IN ARRAY ARRAY['travel_before_seconds','travel_after_seconds'] LOOP IF slot->field<>'null'::jsonb AND(jsonb_typeof(slot->field) IS DISTINCT FROM 'number' OR(slot->>field)!~'^(0|[1-9][0-9]{0,9})$' OR(slot->>field)::numeric>2147483647) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;END LOOP;
  ELSE
   IF slot<>'null'::jsonb OR crest_private.valid_booking_confirmation(body->'customerConfirmation',clock_timestamp()) IS NOT TRUE OR jsonb_typeof(review) IS DISTINCT FROM 'object' OR review-ARRAY['expectedAppointmentIds','expectedUnknownTravel','unknownTravelReviewed','overrideReason']<>'{}'::jsonb OR NOT review ?& ARRAY['expectedAppointmentIds','expectedUnknownTravel','unknownTravelReviewed','overrideReason'] OR jsonb_typeof(review->'expectedAppointmentIds') IS DISTINCT FROM 'array' OR jsonb_typeof(review->'expectedUnknownTravel') IS DISTINCT FROM 'boolean' OR jsonb_typeof(review->'unknownTravelReviewed') IS DISTINCT FROM 'boolean' OR(review->'overrideReason'<>'null'::jsonb AND crest_private.booking_text_required(review->'overrideReason',1000) IS NOT TRUE) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(review->'expectedAppointmentIds') item WHERE NOT crest_private.booking_uuid(item)) OR(SELECT count(DISTINCT value) FROM jsonb_array_elements(review->'expectedAppointmentIds'))<>jsonb_array_length(review->'expectedAppointmentIds') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;
  END IF;
 END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.reschedule','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.reschedule',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.reschedule' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.rescheduled_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;IF before_job.id IS NULL THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
   IF action_name<>'withdraw' THEN
    PERFORM 1 FROM crest.customers WHERE business_id=requested_business AND id=before_job.customer_id AND archived_at IS NULL FOR SHARE;IF NOT FOUND THEN reason:='customer';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
    SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;IF mode.sequence::text IS DISTINCT FROM body->>'expectedModeSequence' OR NOT(CASE before_job.fulfillment_mode WHEN 'mobile' THEN mode.mobile_enabled WHEN 'dropoff' THEN mode.dropoff_enabled WHEN 'pickup_return' THEN mode.pickup_return_enabled ELSE false END) THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
    PERFORM v.id FROM crest.vehicles v JOIN crest.job_vehicles chosen ON chosen.business_id=v.business_id AND chosen.vehicle_id=v.id WHERE chosen.business_id=requested_business AND chosen.job_id=before_job.id AND v.archived_at IS NULL ORDER BY v.id FOR SHARE OF v;
   END IF;
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN reason:='version';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
   IF before_job.state<>'scheduled' OR before_job.first_work_at IS NOT NULL THEN reason:='state';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=requested_job ORDER BY sequence DESC LIMIT 1;
   IF latest.id::text IS DISTINCT FROM body->>'latestAppointmentId' THEN reason:='appointment';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
   IF latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_SOURCE_REQUIRED';END IF;
   IF action_name IN('confirm','withdraw') AND latest.confirmation_state<>'proposed' THEN reason:='proposal';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
   IF action_name<>'propose' THEN slot:=crest_private.appointments_projection(latest);END IF;
   INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(requested_business,requested_job,latest.sequence+1,latest.id,(slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz,slot->>'timezone',(slot->>'local_start')::timestamp,(slot->>'local_end')::timestamp,(slot->>'start_offset_minutes')::integer,(slot->>'end_offset_minutes')::integer,(slot->>'travel_before_seconds')::integer,(slot->>'travel_after_seconds')::integer,CASE action_name WHEN 'confirm' THEN 'confirmed' WHEN 'withdraw' THEN 'withdrawn' ELSE 'proposed' END,CASE WHEN action_name='confirm' THEN body->'customerConfirmation' ELSE NULL END,slot->'contact_snapshot',CASE WHEN action_name='confirm' THEN(review->>'unknownTravelReviewed')::boolean ELSE false END,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');slot_review:=crest_private.booking_slot_review(requested_business,before_job.operator_actor_id,requested_job,blocked,a.travel_before_seconds,a.travel_after_seconds);
   IF action_name='confirm' THEN
    SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO actual_conflicts FROM jsonb_array_elements(slot_review->'conflictingAppointmentIds');SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO expected_conflicts FROM jsonb_array_elements(review->'expectedAppointmentIds');
    IF actual_conflicts IS DISTINCT FROM expected_conflicts OR(slot_review->>'unknownTravel')::boolean IS DISTINCT FROM(review->>'expectedUnknownTravel')::boolean OR(slot_review->>'unknownTravel')::boolean AND NOT a.unknown_travel_reviewed OR cardinality(actual_conflicts)>0 AND review->'overrideReason'='null'::jsonb THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1603';END IF;
    DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=requested_job RETURNING * INTO reservation;IF reservation.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_RESCHEDULE_SOURCE_REQUIRED';END IF;
    source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL));
    IF cardinality(actual_conflicts)>0 THEN
     INSERT INTO crest.schedule_overrides(business_id,job_id,appointment_id,reason,created_by,operation_id) VALUES(requested_business,requested_job,a.id,review->>'overrideReason',expected_actor,requested_operation) RETURNING * INTO override_row;source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_overrides',override_row.id,1,'create',NULL,crest_private.schedule_overrides_projection(override_row)));
     FOREACH conflicting IN ARRAY actual_conflicts LOOP INSERT INTO crest.schedule_override_conflicts(business_id,override_id,conflicting_appointment_id,created_by,operation_id) VALUES(requested_business,override_row.id,conflicting,expected_actor,requested_operation) RETURNING * INTO conflict_row;source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_override_conflicts',conflict_row.id,1,'create',NULL,crest_private.schedule_override_conflicts_projection(conflict_row)));END LOOP;
    END IF;
    INSERT INTO crest.schedule_reservations(business_id,job_id,appointment_id,operator_actor_id,blocked_interval,unknown_travel,override_id,created_by,operation_id) VALUES(requested_business,requested_job,a.id,before_job.operator_actor_id,blocked,(slot_review->>'unknownTravel')::boolean,override_row.id,expected_actor,requested_operation) RETURNING * INTO reservation;source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,1,'create',NULL,crest_private.schedule_reservations_projection(reservation)));
   END IF;
   UPDATE crest.jobs SET version=version+1,current_appointment_id=CASE WHEN action_name='confirm' THEN a.id ELSE before_job.current_appointment_id END,mode_version_id=CASE WHEN action_name='confirm' THEN mode.id ELSE before_job.mode_version_id END,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));source_audits:=source_audits||jsonb_build_array(job_audit);
   original:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body);draft:=CASE WHEN action_name='withdraw' THEN 'null'::jsonb ELSE crest_private.schedule_confirmation_draft(requested_business,requested_job,a.id) END;
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,requested_job,j.version,'scheduled','scheduled',j.updated_at,body->>'reason',jsonb_build_object('request',original,'confirmationDraft',draft,'slotReview',CASE WHEN action_name='withdraw' THEN 'null'::jsonb ELSE slot_review END),expected_actor,requested_operation) RETURNING * INTO event;source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',requested_job,'version',j.version::text,'latestAppointmentId',a.id,'appointmentSequence',a.sequence::text,'currentAppointmentId',j.current_appointment_id,'confirmationState',a.confirmation_state,'action',action_name,'jobAuditEventId',job_audit,'sourceAuditIds',source_audits);UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.rescheduled_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1603' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $change$;
CREATE FUNCTION crest_commands.lookup_rescheduled_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RESCHEDULE_INPUT_REQUIRED';END IF;context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.rescheduled_job_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.change_job_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.change_job_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.change_job_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
DECLARE kind text;
BEGIN
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations') OR kind='operations.job.reschedule' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $guard$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED confirmed-bookings-reschedule-commands.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-history-reads.sql
-- Authorized immutable history prefixes, not bulk export or original hash data.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_HISTORY_READ_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_confirmed_job_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,through_version bigint,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;j crest.jobs;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL OR through_version IS NULL OR through_version<1 OR after_version IS NULL OR after_version<0 OR after_version>through_version OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_HISTORY_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;IF j.id IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 IF through_version>j.version THEN RETURN jsonb_build_object('state','conflict','currentVersion',j.version::text);END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_events WHERE business_id=requested_business AND job_id=requested_job AND sequence>after_version AND sequence<=through_version ORDER BY sequence LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',requested_job,'throughVersion',through_version::text,'observedVersion',j.version::text,
  'events',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'sequence',p.sequence::text,'operationId',p.operation_id,'actorId',p.created_by,'recordedAt',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'effectiveAt',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'fromState',p.from_state,'toState',p.to_state,'reason',p.reason,
   'action',CASE WHEN p.from_state IS NULL THEN 'book' WHEN p.to_state='cancelled' THEN 'cancel' WHEN p.from_state='scheduled' AND p.to_state='scheduled' AND p.evidence->'request'->'payload'->>'action' IN('propose','confirm','withdraw') THEN p.evidence->'request'->'payload'->>'action' ELSE 'state_change' END,
   'appointment',CASE WHEN a.id IS NULL THEN NULL ELSE crest_private.appointments_projection(a) END,
   'draft',CASE WHEN p.evidence->'confirmationDraft'->>'kind'='appointment_confirmation' THEN jsonb_build_object('state','prepared','appointmentId',p.evidence->'confirmationDraft'->>'appointmentId','confirmationState',p.evidence->'confirmationDraft'->>'confirmationState','bodyText',p.evidence->'confirmationDraft'->>'bodyText') ELSE NULL END,
   'customerCommunication',CASE WHEN p.to_state='cancelled' THEN p.evidence->'request'->'payload'->'customerCommunication' ELSE NULL END
  ) ORDER BY p.sequence),'[]'::jsonb),'hasMore',through_version-after_version>page_limit) INTO result FROM page p LEFT JOIN crest.appointments a ON a.business_id=p.business_id AND a.job_id=p.job_id AND a.operation_id=p.operation_id;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_HISTORY_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $history$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_confirmed_job_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_confirmed_job_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_confirmed_job_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) TO crest_web;

RESET ROLE;
-- END REVIEWED confirmed-bookings-history-reads.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-source.sql
-- Unregistered complete physical booking/mode source readers over49.
-- Export credential only, on one READ ONLY REPEATABLE READ transaction.
-- JSONB source columns are original SQL JSON text, never JS-reserialized values.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_booking_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member='crest_export'::regrole)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_booking_owner',oid,'CREATE'))
  OR to_regprocedure('crest_commands.quote_commercial_snapshot_context(uuid)') IS NULL OR to_regprocedure('crest_commands.business_history_export_context(uuid)') IS NULL
  OR to_regprocedure('crest_commands.booking_source_snapshot_context(uuid)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.fulfillment_mode_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','sequence','replaces_sequence','mobile_enabled','dropoff_enabled','pickup_return_enabled','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.jobs'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.jobs'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','customer_id','operator_actor_id','fulfillment_mode','mode_version_id','work_address_id','work_location_snapshot','state','current_appointment_id','first_work_at','completed_at','completion_outcome','version','updated_at','updated_by','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.jobs_projection(crest.jobs)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.job_vehicles'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.job_vehicles'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','vehicle_id','customer_vehicle_id','vehicle_snapshot','customer_snapshot','pickup_address_id','return_address_id','pickup_location_snapshot','return_location_snapshot','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.job_vehicles_projection(crest.job_vehicles)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.job_encounters'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.job_encounters'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','customer_id','family_id','agreement_id','encounter_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.job_encounters_projection(crest.job_encounters)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.appointments'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.appointments'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','sequence','replaces_id','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','confirmation_state','customer_confirmation','contact_snapshot','unknown_travel_reviewed','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.appointments_projection(crest.appointments)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.operator_controls'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.operator_controls'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','operator_actor_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operator_controls_projection(crest.operator_controls)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.schedule_reservations'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.schedule_reservations'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','appointment_id','operator_actor_id','blocked_interval','unknown_travel','override_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.schedule_reservations_projection(crest.schedule_reservations)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.schedule_overrides'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.schedule_overrides'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','appointment_id','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.schedule_overrides_projection(crest.schedule_overrides)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.schedule_override_conflicts'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.schedule_override_conflicts'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','override_id','conflicting_appointment_id','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.schedule_override_conflicts_projection(crest.schedule_override_conflicts)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.allocation_plan_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.allocation_plan_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','source_allocation_id','sequence','replaces_id','reason','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.allocation_plan_parts'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.allocation_plan_parts'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','plan_id','stable_partition_id','job_id','allocation_state','gross_inclusive_cents','discount_inclusive_cents','amount_cents','scope_description','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.allocation_plan_parts_projection(crest.allocation_plan_parts)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.job_events'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.job_events'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','job_id','sequence','from_state','to_state','effective_at','reason','evidence','created_at','created_by','operation_id','origin']
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.job_events_projection(crest.job_events)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_SOURCE_EXPORT_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_booking_owner;
CREATE POLICY booking_export_business ON crest.businesses FOR SELECT TO crest_booking_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.booking_source_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE commercial jsonb;history jsonb;counts jsonb;total numeric;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SCOPE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SCOPE_REQUIRED';END IF;
 commercial:=crest_commands.quote_commercial_snapshot_context(requested_business);history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 SELECT jsonb_build_object('fulfillment_mode_versions',(SELECT count(*)::text FROM crest.fulfillment_mode_versions WHERE business_id=requested_business),'jobs',(SELECT count(*)::text FROM crest.jobs WHERE business_id=requested_business),'job_vehicles',(SELECT count(*)::text FROM crest.job_vehicles WHERE business_id=requested_business),'job_encounters',(SELECT count(*)::text FROM crest.job_encounters WHERE business_id=requested_business),'appointments',(SELECT count(*)::text FROM crest.appointments WHERE business_id=requested_business),'operator_controls',(SELECT count(*)::text FROM crest.operator_controls WHERE business_id=requested_business),'schedule_reservations',(SELECT count(*)::text FROM crest.schedule_reservations WHERE business_id=requested_business),'schedule_overrides',(SELECT count(*)::text FROM crest.schedule_overrides WHERE business_id=requested_business),'schedule_override_conflicts',(SELECT count(*)::text FROM crest.schedule_override_conflicts WHERE business_id=requested_business),'allocation_plan_versions',(SELECT count(*)::text FROM crest.allocation_plan_versions WHERE business_id=requested_business),'allocation_plan_parts',(SELECT count(*)::text FROM crest.allocation_plan_parts WHERE business_id=requested_business),'job_events',(SELECT count(*)::text FROM crest.job_events WHERE business_id=requested_business)) INTO counts;
 SELECT sum((value#>>'{}')::numeric) INTO total FROM jsonb_each(counts);IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','confirmed_booking_sources','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.confirmed-booking.sources/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'commercialSnapshotToken',commercial->>'snapshotToken','historySnapshotToken',history->>'snapshotToken','expectedCounts',counts);
END $context$;
CREATE FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.fulfillment_mode_versions WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.fulfillment_mode_projection(p::crest.fulfillment_mode_versions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.fulfillment_mode_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_jobs(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.jobs WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.jobs_projection(p::crest.jobs)||jsonb_build_object('work_location_snapshot',p.work_location_snapshot::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.jobs later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_job_vehicles(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_vehicles WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.job_vehicles_projection(p::crest.job_vehicles)||jsonb_build_object('vehicle_snapshot',p.vehicle_snapshot::text,'customer_snapshot',p.customer_snapshot::text,'pickup_location_snapshot',p.pickup_location_snapshot::text,'return_location_snapshot',p.return_location_snapshot::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.job_vehicles later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_job_encounters(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_encounters WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.job_encounters_projection(p::crest.job_encounters) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.job_encounters later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_appointments(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.appointments WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.appointments_projection(p::crest.appointments)||jsonb_build_object('customer_confirmation',p.customer_confirmation::text,'contact_snapshot',p.contact_snapshot::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.appointments later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_operator_controls(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.operator_controls WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.operator_controls_projection(p::crest.operator_controls) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.operator_controls later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.schedule_reservations WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.schedule_reservations_projection(p::crest.schedule_reservations)||jsonb_build_object('blocked_interval',(crest_private.schedule_reservations_projection(p::crest.schedule_reservations)->'blocked_interval')::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.schedule_reservations later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.schedule_overrides WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.schedule_overrides_projection(p::crest.schedule_overrides) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.schedule_overrides later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.schedule_override_conflicts WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.schedule_override_conflicts_projection(p::crest.schedule_override_conflicts) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.schedule_override_conflicts later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.allocation_plan_versions WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.allocation_plan_versions_projection(p::crest.allocation_plan_versions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.allocation_plan_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.allocation_plan_parts_projection(p::crest.allocation_plan_parts) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.allocation_plan_parts later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.booking_source_snapshot_job_events(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.job_events WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.job_events_projection(p::crest.job_events)||jsonb_build_object('evidence',p.evidence::text) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.job_events later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.quote_commercial_snapshot_context(uuid),crest_commands.business_history_export_context(uuid) TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_context(uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_jobs(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_job_vehicles(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_job_encounters(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_appointments(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_operator_controls(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.booking_source_snapshot_job_events(uuid,text,uuid,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_context(uuid) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_fulfillment_mode_versions(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_jobs(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_jobs(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_job_vehicles(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_job_vehicles(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_job_encounters(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_job_encounters(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_appointments(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_appointments(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_operator_controls(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_operator_controls(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_schedule_reservations(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_schedule_overrides(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_schedule_override_conflicts(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_versions(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_allocation_plan_parts(uuid,text,uuid,integer) TO crest_export;
REVOKE ALL ON FUNCTION crest_commands.booking_source_snapshot_job_events(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.booking_source_snapshot_job_events(uuid,text,uuid,integer) TO crest_export;

RESET ROLE;
-- END REVIEWED confirmed-bookings-source.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-resolution.sql
-- Unregistered typed original-review targets over registered49 and booking.
-- Reuse unchanged owner/recent-MFA/recovery fences, unique operation key,
-- immutable retirement audit and separate financial capability requirements.
-- original_recorded is observation only; typed receipt lookup is still required.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND NOT proleakproof AND provolatile='i' AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='0e38544a80119ede57f93879839474ce04f08fb05884f4a5dd97af2cc3e14e0b')
 OR to_regprocedure('crest_commands.lookup_booked_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 OR to_regprocedure('crest_commands.lookup_cancelled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 OR to_regprocedure('crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 OR to_regprocedure('crest_commands.lock_financial_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 keys:=CASE kind
  WHEN 'bookkeeping.expense.save' THEN ARRAY['expenseId','expectedRevision']
  WHEN 'bookkeeping.receipt.reserve' THEN ARRAY['receiptId','expenseId','expenseRevision','expectedRevision']
  WHEN 'bookkeeping.receipt.publish' THEN ARRAY['receiptId','expenseId','expenseRevision','expectedRevision']
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
  WHEN 'quote.review.approve' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId']
 WHEN 'quote.manual.send' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','sendId','approvalId']
 WHEN 'quote.confirmation.accept' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId']
 WHEN 'operations.fulfillment_modes.initialize' THEN ARRAY['expectedSequence']
 WHEN 'operations.fulfillment_modes.save' THEN ARRAY['expectedSequence']
 WHEN 'operations.job.book' THEN ARRAY['jobId','expectedModeSequence']
 WHEN 'operations.job.cancel' THEN ARRAY['jobId','expectedJobVersion']
 WHEN 'operations.job.reschedule' THEN ARRAY['jobId','expectedJobVersion','action','latestAppointmentId']
 WHEN 'quote.replacement.create' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key='expectedJobVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key IN ('expectedSequence','expectedModeSequence','expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state','quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept')) THEN RETURN false;END IF;
  ELSIF key='expenseRevision' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.replacement.create' AND (r->>'expectedFamilyVersion'='0' OR r->>'expectedRevisionVersion'<>'0') THEN RETURN false;END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 IF kind='bookkeeping.receipt.reserve' AND r->>'expectedRevision'<>'0' OR kind='bookkeeping.receipt.publish' AND r->>'expectedRevision'<>'1' THEN RETURN false;END IF;
 IF kind='operations.job.reschedule' AND NOT coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN('propose','confirm','withdraw'),false) THEN RETURN false;END IF;
 IF kind='operations.fulfillment_modes.save' AND r->>'expectedSequence'='0' THEN RETURN false;END IF;
 IF kind='operations.fulfillment_modes.initialize' AND r->>'expectedSequence'<>'0' THEN RETURN false;END IF;
 RETURN true;
END $$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED confirmed-bookings-resolution.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-original.sql
-- Full typed original identity, separate from original_recorded observation.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='6bd9e6676c976a29d259056e2436337d1174fdb589ee2b8d83b9798c3ee67331')
 OR to_regprocedure('crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SCHEDULING_ORIGINAL_SOURCE_REQUIRED';END IF;
END $review$;
GRANT EXECUTE ON FUNCTION crest_private.original_operation_reference_valid(jsonb),crest_private.original_operation_uuid(jsonb),crest_private.original_operation_version(jsonb,boolean),crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_scheduling_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE context jsonb;kind text;result jsonb;request jsonb;reference jsonb;actual jsonb;operation uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF crest_private.original_operation_reference_valid(original) IS NOT TRUE OR original->>'businessId' IS DISTINCT FROM requested_business::text OR original->>'commandType' NOT IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book','operations.job.cancel','operations.job.reschedule') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SCHEDULING_ORIGINAL_INPUT_REQUIRED';END IF;
 kind:=original->>'commandType';operation:=(original->'reference'->>'operationId')::uuid;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 IF kind IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save') THEN
  result:=crest_commands.lookup_fulfillment_mode_operation($1,$2,$3,$4,$5,$6,$7,$8,operation);
 ELSE
  result:=CASE kind WHEN 'operations.job.book' THEN crest_commands.lookup_booked_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) WHEN 'operations.job.cancel' THEN crest_commands.lookup_cancelled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) ELSE crest_commands.lookup_rescheduled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) END;
 END IF;
 IF result->>'state'='absent' THEN RETURN result;END IF;
 IF kind IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save') THEN
  kind:=CASE WHEN result->'receipt'->>'sequence'='1' THEN 'operations.fulfillment_modes.initialize' ELSE 'operations.fulfillment_modes.save' END;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',result->>'recoveryEpoch','expectedSequence',((result->'receipt'->>'sequence')::bigint-1)::text);
 ELSE
  SELECT e.evidence->'request' INTO request FROM crest.job_events e WHERE e.business_id=requested_business AND e.operation_id=operation AND e.created_by=expected_actor;
  IF request IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULING_ORIGINAL_SOURCE_REQUIRED';END IF;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',request->>'recoveryEpoch','jobId',request->>'jobId')||CASE kind WHEN 'operations.job.book' THEN jsonb_build_object('expectedModeSequence',request->>'expectedModeSequence') WHEN 'operations.job.cancel' THEN jsonb_build_object('expectedJobVersion',request->>'expectedJobVersion') ELSE jsonb_build_object('expectedJobVersion',request->>'expectedJobVersion','action',request->'payload'->>'action','latestAppointmentId',request->'payload'->>'latestAppointmentId') END;
 END IF;
 actual:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'commandType',kind,'reference',reference);
 IF actual IS DISTINCT FROM original THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'original',actual,'result',result);
END $original$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;

RESET ROLE;
-- END REVIEWED confirmed-bookings-original.sql

RESET ROLE;
-- BEGIN REVIEWED confirmed-bookings-context.sql
-- Scoped construction reads for booking/field screens. Original commercial
-- packets remain historical; current assignments are a separate projection.
DO $review$ BEGIN
 IF to_regclass('crest.current_scope_allocation_parts') IS NULL OR to_regprocedure('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
 OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole) AND d.defaclobjtype='f' AND a.grantee NOT IN(d.defaclrole,0))
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_confirmed_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9651fa42beb41bdd30a4cbfd7679ba04937bae426ea40f29e2a0c2507cba64a3')
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 OR to_regprocedure('crest_private.booking_job_display_snapshot(crest.jobs)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,timezone) ON crest.businesses TO crest_booking_owner;
CREATE POLICY booking_workspace_business_read ON crest.businesses FOR SELECT TO crest_booking_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
-- STABLE/INVOKER is intentional: all nested resources in a caller SELECT use
-- that statement's snapshot and the caller's already authorized tenant RLS.
CREATE FUNCTION crest_private.booking_job_display_snapshot(j crest.jobs) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $display$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',(j).business_id,'job',crest_private.jobs_projection(j),'appointment',crest_private.appointments_projection(a),
  'latestAppointment',(SELECT crest_private.appointments_projection(latest) FROM crest.appointments latest WHERE latest.business_id=(j).business_id AND latest.job_id=(j).id ORDER BY latest.sequence DESC LIMIT 1),
  'confirmationDraft',(SELECT e.evidence->'confirmationDraft' FROM crest.job_events e WHERE e.business_id=(j).business_id AND e.job_id=(j).id AND e.operation_id=(SELECT latest.operation_id FROM crest.appointments latest WHERE latest.business_id=(j).business_id AND latest.job_id=(j).id ORDER BY latest.sequence DESC LIMIT 1)),
  'vehicleCount',(SELECT count(*)::integer FROM crest.job_vehicles v WHERE v.business_id=(j).business_id AND v.job_id=(j).id),
  'encounterCount',(SELECT count(*)::integer FROM crest.job_encounters e WHERE e.business_id=(j).business_id AND e.job_id=(j).id),
  'allocationCount',(SELECT count(*)::integer FROM crest.current_scope_allocation_parts p WHERE p.business_id=(j).business_id AND p.job_id=(j).id))
 FROM crest.appointments a WHERE a.business_id=(j).business_id AND a.id=(j).current_appointment_id AND a.job_id=(j).id
$display$;
REVOKE ALL ON FUNCTION crest_private.booking_job_display_snapshot(crest.jobs) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.booking_job_display_snapshot(crest.jobs) TO crest_booking_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_confirmed_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $detail$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT crest_private.booking_job_display_snapshot(j) INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_READ_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $detail$;
CREATE FUNCTION crest_commands.read_booking_workspace(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $workspace$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'operatorId',expected_actor,'timezone',b.timezone,'modeVersion',(SELECT crest_private.fulfillment_mode_projection(m) FROM crest.fulfillment_mode_versions m WHERE m.business_id=requested_business ORDER BY m.sequence DESC LIMIT 1)) INTO result FROM crest.businesses b WHERE b.id=requested_business;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $workspace$;
CREATE FUNCTION crest_commands.read_booking_agreement(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_family uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $agreement$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_family IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'agreementId',g.id,'agreementVersion',g.version_no::text,'customer',crest_private.customer_projection(c),
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'version',v.version::text,'archivedAt',to_char(v.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY v.id) FROM crest.vehicles v WHERE v.business_id=requested_business AND EXISTS(SELECT 1 FROM crest.scope_entitlements e JOIN crest.scope_allocations s ON s.business_id=e.business_id AND s.entitlement_id=e.id WHERE e.business_id=requested_business AND s.agreement_id=g.id AND e.vehicle_id=v.id)),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',s.id,'entitlementId',s.entitlement_id,'entitlementVersionId',s.entitlement_version_id,'agreementId',s.agreement_id,'sourcePartitionId',s.stable_partition_id,'vehicleId',e.vehicle_id,'jobWide',e.job_wide,'grossInclusiveCents',s.gross_inclusive_cents::text,'discountInclusiveCents',s.discount_inclusive_cents::text,'amountCents',s.amount_cents::text,'scopeDescription',s.scope_description,
 'planId',(SELECT p.id FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),
 'planSequence',coalesce((SELECT p.sequence::text FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),'0'),
 'parts',(SELECT jsonb_agg(jsonb_build_object('partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id)) ORDER BY s.id)
 FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.agreement_id=g.id),'[]'::jsonb)) INTO result
 FROM crest.quote_families f JOIN crest.quote_family_commercial_state control ON control.business_id=f.business_id AND control.family_id=f.id
 JOIN crest.agreements g ON g.business_id=f.business_id AND g.id=control.current_agreement_id AND g.family_id=f.id JOIN crest.customers c ON c.business_id=g.business_id AND c.id=g.customer_id
 WHERE f.business_id=requested_business AND f.id=requested_family;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $agreement$;
CREATE FUNCTION crest_commands.read_confirmed_job_resources(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $resources$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'head',crest_private.booking_job_display_snapshot(j),
 'vehicles',(SELECT jsonb_agg(crest_private.job_vehicles_projection(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
 'encounters',(SELECT jsonb_agg(crest_private.job_encounters_projection(e) ORDER BY e.id) FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
 'scopeParts',(SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',p.source_allocation_id,'entitlementId',p.entitlement_id,'entitlementVersionId',p.entitlement_version_id,'agreementId',p.agreement_id,'planId',p.plan_id,'planSequence',p.plan_sequence::text,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.source_allocation_id,p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=j.business_id AND p.job_id=j.id)) INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $resources$;
CREATE FUNCTION crest_commands.read_pending_job_changes(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_created timestamptz,after_appointment uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $pending$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (after_created IS NULL)<>(after_appointment IS NULL) OR after_created IS NOT NULL AND(NOT isfinite(after_created) OR after_created<'0001-01-01T00:00:00Z'::timestamptz OR after_created>='10000-01-01T00:00:00Z'::timestamptz) OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH candidates AS MATERIALIZED(
  SELECT j,a.created_at AS proposed_at,a.id AS proposed_id FROM crest.appointments a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.appointments current_ap ON current_ap.business_id=j.business_id AND current_ap.job_id=j.id AND current_ap.id=j.current_appointment_id
  WHERE a.business_id=requested_business AND a.confirmation_state='proposed' AND a.sequence>current_ap.sequence AND j.state NOT IN('completed','cancelled') AND NOT EXISTS(SELECT 1 FROM crest.appointments newer WHERE newer.business_id=a.business_id AND newer.job_id=a.job_id AND newer.sequence>a.sequence)
  AND(after_created IS NULL OR ROW(a.created_at,a.id)>ROW(after_created,after_appointment)) ORDER BY a.created_at,a.id LIMIT page_limit+1
 ),page AS(SELECT * FROM candidates ORDER BY proposed_at,proposed_id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'items',coalesce((SELECT jsonb_agg(jsonb_build_object('proposedAt',to_char(p.proposed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'head',crest_private.booking_job_display_snapshot(p.j)) ORDER BY p.proposed_at,p.proposed_id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*) FROM candidates)>page_limit) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_READ_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN result;
END $pending$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_booking_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.read_booking_agreement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_confirmed_job_resources(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_pending_job_changes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_booking_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.read_booking_agreement(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_confirmed_job_resources(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_pending_job_changes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid,integer) TO crest_web;

RESET ROLE;
-- END REVIEWED confirmed-bookings-context.sql
