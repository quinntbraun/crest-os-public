-- Dated retained customer/vehicle relationships. No production activation.
-- PostgreSQL's supplied UUID GiST classes enforce period exclusion at every
-- isolation level, including writes outside the application command.
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION crest_schema_owner;
-- Refuse untrusted extension-schema creators before installing trusted code.
DO $extension_schema$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('crest_web','anon','authenticated','service_role') AND has_schema_privilege(oid,'extensions','CREATE'))
  OR EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='extensions' AND a.grantee=0 AND a.privilege_type='CREATE') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ASSOCIATION_EXTENSION_SCHEMA_REVIEW_REQUIRED';
 END IF;
END
$extension_schema$;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
DO $review$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist' AND n.nspname='extensions')
    OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('crest_web','anon','authenticated','service_role') AND has_schema_privilege(oid,'extensions','CREATE'))
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_vehicle_owner','crest_vehicle_integrity_owner','crest_session_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_schema_owner','crest_vehicle_owner','crest_vehicle_integrity_owner','crest_session_owner'))
    OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest.customers'::regclass,'crest.vehicles'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ASSOCIATION_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
GRANT USAGE ON SCHEMA extensions TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.customer_vehicles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 customer_id uuid NOT NULL,vehicle_id uuid NOT NULL,valid_from timestamptz NOT NULL,valid_to timestamptz,
 relationship text NOT NULL CHECK(relationship IN ('owner','keeper')),is_billing boolean NOT NULL,
 evidence text CHECK(evidence IS NULL OR char_length(evidence)<=2000 AND translate(evidence,E'\t\n\r','')!~'[[:cntrl:]]'),
 close_reason text,closed_at timestamptz,closed_by uuid,version bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,updated_by uuid NOT NULL,origin text NOT NULL CHECK(origin IN ('manual','import','system')),operation_id uuid NOT NULL,import_row_id uuid,
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,closed_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(isfinite(valid_from) AND valid_from>='0001-01-01T00:00:00Z'::timestamptz AND valid_from<'10000-01-01T00:00:00Z'::timestamptz AND (valid_to IS NULL OR isfinite(valid_to) AND valid_to>=valid_from AND valid_to<'10000-01-01T00:00:00Z'::timestamptz)),
 CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at),
 CHECK(valid_to IS NULL AND version=1 AND closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL AND updated_at=created_at AND updated_by=created_by
   OR valid_to IS NOT NULL AND version=2 AND closed_at IS NOT NULL AND isfinite(closed_at) AND closed_at=updated_at AND closed_by IS NOT NULL AND closed_by=updated_by AND close_reason IS NOT NULL AND char_length(close_reason)>=1 AND char_length(close_reason)<=1000
      AND btrim(close_reason,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(close_reason,E'\t\n\r','')!~'[[:cntrl:]]'),
 CONSTRAINT association_owner_period EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,vehicle_id extensions.gist_uuid_ops WITH =,tstzrange(valid_from,valid_to,'[)') WITH &&) WHERE(relationship='owner'),
 CONSTRAINT association_billing_period EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,vehicle_id extensions.gist_uuid_ops WITH =,tstzrange(valid_from,valid_to,'[)') WITH &&) WHERE(is_billing)
);
CREATE INDEX association_customer ON crest.customer_vehicles(business_id,customer_id,id);
CREATE INDEX association_vehicle ON crest.customer_vehicles(business_id,vehicle_id,id);
CREATE INDEX association_creator ON crest.customer_vehicles(business_id,created_by);
CREATE INDEX association_updater ON crest.customer_vehicles(business_id,updated_by);
CREATE INDEX association_closer ON crest.customer_vehicles(business_id,closed_by);
CREATE INDEX association_operation ON crest.customer_vehicles(business_id,operation_id,updated_by);
ALTER TABLE crest.customer_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.customer_vehicles FORCE ROW LEVEL SECURITY;
GRANT USAGE ON TYPE crest.customer_vehicles TO crest_vehicle_owner,crest_vehicle_integrity_owner;
CREATE FUNCTION crest_private.association_projection(c crest.customer_vehicles) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'customer_id',(c).customer_id,'vehicle_id',(c).vehicle_id,'valid_from',to_char((c).valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'valid_to',to_char((c).valid_to AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'relationship',(c).relationship,'is_billing',(c).is_billing,'evidence',(c).evidence,'close_reason',(c).close_reason,'closed_at',to_char((c).closed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'closed_by',(c).closed_by,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$projection$;
REVOKE ALL ON FUNCTION crest_private.association_projection(crest.customer_vehicles) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.association_projection(crest.customer_vehicles) TO crest_vehicle_owner,crest_vehicle_integrity_owner;
CREATE FUNCTION crest_private.validate_association_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.vehicle_id,NEW.valid_from,NEW.relationship,NEW.is_billing,NEW.evidence,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id)
     IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.vehicle_id,OLD.valid_from,OLD.relationship,OLD.is_billing,OLD.evidence,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id)
     OR OLD.valid_to IS NOT NULL OR OLD.version<>1 OR NEW.valid_to IS NULL OR NEW.version<>2 OR NEW.operation_id=OLD.operation_id THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_ASSOCIATION_PERIOD';
  END IF;
  NEW.closed_at:=stamp;
 ELSE
  IF NEW.valid_to IS NOT NULL OR NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_OPEN_REQUIRED'; END IF;
  NEW.created_at:=stamp;
 END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_association_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='customer_vehicles' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.action=CASE WHEN TG_OP='INSERT' THEN 'open' ELSE 'close' END AND a.delta->'after'=crest_private.association_projection(NEW::crest.customer_vehicles) AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.association_projection(OLD::crest.customer_vehicles) END) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_AUDIT_REQUIRED';
 END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER association_change BEFORE INSERT OR UPDATE ON crest.customer_vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.validate_association_change();
CREATE CONSTRAINT TRIGGER association_audit AFTER INSERT OR UPDATE ON crest.customer_vehicles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_association_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.customer_vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.customer_vehicles FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.customer_vehicles TO crest_vehicle_owner;
GRANT INSERT(id,business_id,customer_id,vehicle_id,valid_from,relationship,is_billing,evidence,created_by,updated_by,origin,operation_id) ON crest.customer_vehicles TO crest_vehicle_owner;
GRANT UPDATE(valid_to,close_reason,closed_at,closed_by,version,updated_at,updated_by,operation_id) ON crest.customer_vehicles TO crest_vehicle_owner;
CREATE POLICY association_read ON crest.customer_vehicles FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY association_create ON crest.customer_vehicles FOR INSERT TO crest_vehicle_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY association_close ON crest.customer_vehicles FOR UPDATE TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT(id,business_id) ON crest.customers TO crest_vehicle_owner;
CREATE POLICY association_parent ON crest.customers FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY association_operations_read ON crest_private.operations FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.vehicle.association');
CREATE POLICY association_operations_create ON crest_private.operations FOR INSERT TO crest_vehicle_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.vehicle.association' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY association_operations_finish ON crest_private.operations FOR UPDATE TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.vehicle.association') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.vehicle.association');
CREATE POLICY association_audits_read ON crest_private.audit_events FOR SELECT TO crest_vehicle_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='customer_vehicles');
CREATE POLICY association_audits_create ON crest_private.audit_events FOR INSERT TO crest_vehicle_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='customer_vehicles' AND origin='manual' AND import_row_id IS NULL);
GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta) ON crest_private.audit_events TO crest_vehicle_integrity_owner;
CREATE POLICY association_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_vehicle_integrity_owner USING(entity_kind='customer_vehicles');
CREATE UNIQUE INDEX association_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='customer_vehicles';
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_vehicle_integrity_owner;
ALTER FUNCTION crest_private.check_association_audit() OWNER TO crest_vehicle_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_vehicle_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_association_audit() FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.association_body(body jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE name text; effective timestamptz;
BEGIN
 IF body IS NULL OR jsonb_typeof(body)<>'object' OR body-ARRAY['action','associationId','customerId','vehicleId','effectiveAt','relationship','isBilling','evidence','reason','nextAssociationId']<>'{}'::jsonb OR NOT(body ?& ARRAY['action','associationId','customerId','vehicleId','effectiveAt','relationship','isBilling','evidence','reason','nextAssociationId']) OR octet_length(body::text)>32768 THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 FOREACH name IN ARRAY ARRAY['associationId','customerId','vehicleId'] LOOP
  IF jsonb_typeof(body->name)<>'string' OR (body->>name)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 END LOOP;
 IF jsonb_typeof(body->'action')<>'string' OR body->>'action' NOT IN ('open','close','transfer') OR jsonb_typeof(body->'effectiveAt')<>'string' OR (body->>'effectiveAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{6}Z$' THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 effective:=(body->>'effectiveAt')::timestamptz;
 IF NOT isfinite(effective) OR to_char(effective AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>body->>'effectiveAt' THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 IF body->>'action'='close' THEN
  IF body->'relationship'<>'null'::jsonb OR body->'isBilling'<>'null'::jsonb OR body->'evidence'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 ELSE
  IF jsonb_typeof(body->'relationship')<>'string' OR body->>'relationship' NOT IN ('owner','keeper') OR jsonb_typeof(body->'isBilling')<>'boolean' OR jsonb_typeof(body->'evidence') NOT IN ('null','string') OR char_length(body->>'evidence')>2000 OR translate(body->>'evidence',E'\t\n\r','')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 END IF;
 IF body->>'action'='open' THEN
  IF body->'reason'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 ELSE
  IF jsonb_typeof(body->'reason')<>'string' OR char_length(body->>'reason')<1 OR char_length(body->>'reason')>1000 OR btrim(body->>'reason',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR translate(body->>'reason',E'\t\n\r','')~'[[:cntrl:]]' THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 END IF;
 IF body->>'action'='transfer' THEN
  IF jsonb_typeof(body->'nextAssociationId')<>'string' OR (body->>'nextAssociationId')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR body->>'nextAssociationId'=body->>'associationId' THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 ELSIF body->'nextAssociationId'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
 RETURN body;
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED';
END
$body$;
REVOKE ALL ON FUNCTION crest_private.association_body(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.association_body(jsonb) TO crest_vehicle_owner;
CREATE FUNCTION crest_private.association_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record; receipt jsonb; opened record; closed record; before_row jsonb; after_row jsonb; body jsonb; expected_version text; digest text; source_row crest.customer_vehicles; event record; name text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND command_type='crm.vehicle.association';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 receipt:=o.result;
 IF jsonb_typeof(receipt->'action') IS DISTINCT FROM 'string' OR jsonb_typeof(receipt->'associationVersion') IS DISTINCT FROM 'string' OR receipt->>'associationVersion' NOT IN ('1','2') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
 FOREACH name IN ARRAY ARRAY['vehicleId','associationId','closedAuditId','openedAssociationId','openedAuditId'] LOOP
  IF name IN ('vehicleId','associationId') AND jsonb_typeof(receipt->name) IS DISTINCT FROM 'string' OR jsonb_typeof(receipt->name) NOT IN ('string','null') OR jsonb_typeof(receipt->name)='string' AND (receipt->>name)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
 END LOOP;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR receipt-ARRAY['schemaVersion','businessId','action','vehicleId','associationId','associationVersion','closedAuditId','openedAssociationId','openedAuditId']<>'{}'::jsonb OR NOT(receipt ?& ARRAY['schemaVersion','businessId','action','vehicleId','associationId','associationVersion','closedAuditId','openedAssociationId','openedAuditId']) OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId' IS DISTINCT FROM requested_business::text OR receipt->>'action' NOT IN ('open','close','transfer') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
 IF (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>(CASE WHEN receipt->>'action'='transfer' THEN 2 ELSE 1 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
 -- Reparse every full projection and bind original audit/actor/source/version;
 -- current directory changes can never replace original receipt evidence.
 FOR event IN SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation LOOP
  IF event.delta-ARRAY['schemaVersion','before','after']<>'{}'::jsonb OR NOT(event.delta ?& ARRAY['schemaVersion','before','after']) OR event.delta->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR event.created_by IS DISTINCT FROM requested_actor OR event.origin IS DISTINCT FROM 'manual' OR event.import_row_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  after_row:=event.delta->'after';before_row:=event.delta->'before';
  source_row:=jsonb_populate_record(NULL::crest.customer_vehicles,after_row);
  IF event.entity_kind<>'customer_vehicles' OR event.actor_id<>requested_actor OR event.entity_id<>source_row.id OR event.entity_version<>source_row.version OR source_row.business_id<>requested_business OR source_row.vehicle_id::text<>receipt->>'vehicleId' OR source_row.operation_id<>requested_operation OR source_row.updated_by<>requested_actor OR crest_private.association_projection(source_row) IS DISTINCT FROM after_row THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  IF event.action='open' THEN
   IF event.id::text IS DISTINCT FROM receipt->>'openedAuditId' OR event.entity_id::text IS DISTINCT FROM receipt->>'openedAssociationId' OR source_row.version<>1 OR source_row.valid_to IS NOT NULL OR source_row.created_by<>requested_actor OR before_row IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  ELSIF event.action='close' THEN
   IF event.id::text IS DISTINCT FROM receipt->>'closedAuditId' OR event.entity_id::text IS DISTINCT FROM receipt->>'associationId' OR source_row.version<>2 OR source_row.valid_to IS NULL OR source_row.closed_by IS DISTINCT FROM requested_actor OR before_row->>'version' IS DISTINCT FROM '1' OR before_row->'valid_to' IS DISTINCT FROM 'null'::jsonb OR (after_row-ARRAY['valid_to','close_reason','closed_at','closed_by','version','updated_at','updated_by','operation_id']) IS DISTINCT FROM (before_row-ARRAY['valid_to','close_reason','closed_at','closed_by','version','updated_at','updated_by','operation_id']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
   source_row:=jsonb_populate_record(NULL::crest.customer_vehicles,before_row);
   IF crest_private.association_projection(source_row) IS DISTINCT FROM before_row OR source_row.updated_by<>source_row.created_by OR source_row.updated_at<>source_row.created_at OR source_row.closed_at IS NOT NULL OR source_row.closed_by IS NOT NULL OR source_row.close_reason IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.entity_kind='customer_vehicles' AND a.entity_id=source_row.id AND a.entity_version=1 AND a.action='open' AND a.operation_id=source_row.operation_id AND a.actor_id=source_row.created_by AND a.delta->'after'=before_row) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
 END LOOP;
 SELECT * INTO opened FROM crest_private.audit_events WHERE business_id=requested_business AND id=(receipt->>'openedAuditId')::uuid AND operation_id=requested_operation;
 SELECT * INTO closed FROM crest_private.audit_events WHERE business_id=requested_business AND id=(receipt->>'closedAuditId')::uuid AND operation_id=requested_operation;
 IF receipt->>'action'='open' THEN
  IF receipt->'closedAuditId'<>'null'::jsonb OR receipt->>'associationVersion'<>'1' OR receipt->>'openedAssociationId'<>receipt->>'associationId' OR opened.action IS DISTINCT FROM 'open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  expected_version:='0';after_row:=opened.delta->'after';
 ELSIF receipt->>'action'='close' THEN
  IF receipt->'openedAuditId'<>'null'::jsonb OR receipt->'openedAssociationId'<>'null'::jsonb OR receipt->>'associationVersion'<>'2' OR closed.action IS DISTINCT FROM 'close' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  expected_version:='1';after_row:=closed.delta->'after';
 ELSE
  IF receipt->>'associationVersion'<>'2' OR opened.action IS DISTINCT FROM 'open' OR closed.action IS DISTINCT FROM 'close' OR receipt->>'openedAssociationId'=receipt->>'associationId' OR opened.delta->'after'->>'valid_from' IS DISTINCT FROM closed.delta->'after'->>'valid_to' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
  expected_version:='1';after_row:=opened.delta->'after';
 END IF;
 body:=jsonb_build_object('action',receipt->'action','associationId',receipt->'associationId','customerId',after_row->'customer_id','vehicleId',receipt->'vehicleId','effectiveAt',CASE WHEN receipt->>'action'='close' THEN after_row->'valid_to' ELSE after_row->'valid_from' END,'relationship',CASE WHEN receipt->>'action'='close' THEN 'null'::jsonb ELSE after_row->'relationship' END,'isBilling',CASE WHEN receipt->>'action'='close' THEN 'null'::jsonb ELSE after_row->'is_billing' END,'evidence',CASE WHEN receipt->>'action'='close' THEN 'null'::jsonb ELSE after_row->'evidence' END,'reason',CASE WHEN receipt->>'action'='open' THEN 'null'::jsonb ELSE closed.delta->'after'->'close_reason' END,'nextAssociationId',CASE WHEN receipt->>'action'='transfer' THEN receipt->'openedAssociationId' ELSE 'null'::jsonb END);
 body:=crest_private.association_body(body);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.vehicle.association','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
 IF digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ASSOCIATION_RESULT_REVIEW_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
END
$result$;
CREATE FUNCTION crest_commands.change_vehicle_association(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,expected_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb; digest text; claimed uuid; existing record; previous crest.customer_vehicles; changed crest.customer_vehicles; opened crest.customer_vehicles; closed_audit uuid; opened_audit uuid; command_result jsonb; effective timestamptz; vehicle uuid; customer uuid; association uuid; next_id uuid; violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 body:=crest_private.association_body(body);
 IF requested_operation IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<>(CASE WHEN body->>'action'='open' THEN 0 ELSE 1 END) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED'; END IF;
 vehicle:=(body->>'vehicleId')::uuid;customer:=(body->>'customerId')::uuid;association:=(body->>'associationId')::uuid;next_id:=(body->>'nextAssociationId')::uuid;effective:=(body->>'effectiveAt')::timestamptz;
 BEGIN
  context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  PERFORM crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_VEHICLE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied'); END IF;RAISE;
 END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.vehicle.association','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.vehicle.association',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
   command_result:=crest_private.association_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   -- Serialize the ordinary aggregate path; exclusions also protect raw and
   -- repeatable-read writers independently of this lock/snapshot ordering.
   PERFORM id FROM crest.vehicles WHERE business_id=requested_business AND id=vehicle FOR UPDATE;
   IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM crest.customers WHERE business_id=requested_business AND id=customer) THEN RAISE EXCEPTION USING ERRCODE='P1002'; END IF;
   IF body->>'action'<>'open' THEN
    SELECT * INTO previous FROM crest.customer_vehicles WHERE business_id=requested_business AND id=association FOR UPDATE;
    IF NOT FOUND OR previous.vehicle_id<>vehicle OR body->>'action'='close' AND previous.customer_id<>customer THEN RAISE EXCEPTION USING ERRCODE='P1003'; END IF;
    IF previous.version<>expected_version OR previous.valid_to IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P1001'; END IF;
    IF effective<previous.valid_from THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED'; END IF;
    UPDATE crest.customer_vehicles SET valid_to=effective,close_reason=body->>'reason',closed_by=expected_actor,version=2,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=association RETURNING * INTO changed;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'customer_vehicles',changed.id,2,'close',jsonb_build_object('schemaVersion',1,'before',crest_private.association_projection(previous),'after',crest_private.association_projection(changed)),'manual') RETURNING id INTO closed_audit;
   END IF;
   IF body->>'action'<>'close' THEN
    INSERT INTO crest.customer_vehicles(id,business_id,customer_id,vehicle_id,valid_from,relationship,is_billing,evidence,created_by,updated_by,origin,operation_id) VALUES(CASE WHEN body->>'action'='transfer' THEN next_id ELSE association END,requested_business,customer,vehicle,effective,body->>'relationship',(body->>'isBilling')::boolean,body->>'evidence',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO opened;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'customer_vehicles',opened.id,1,'open',jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.association_projection(opened)),'manual') RETURNING id INTO opened_audit;
   END IF;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'action',body->'action','vehicleId',vehicle,'associationId',association,'associationVersion',CASE WHEN body->>'action'='open' THEN '1' ELSE '2' END,'closedAuditId',closed_audit,'openedAssociationId',opened.id,'openedAuditId',opened_audit));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_vehicle_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);
  RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',previous.version::text);
  WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','parent');
  WHEN SQLSTATE 'P1003' THEN RETURN jsonb_build_object('state','conflict','reason','association');
  WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated='customer_vehicles_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','association'); END IF;RAISE;
  WHEN exclusion_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;
   IF violated='association_owner_period' THEN RETURN jsonb_build_object('state','conflict','reason','owner_period'); END IF;
   IF violated='association_billing_period' THEN RETURN jsonb_build_object('state','conflict','reason','billing_period'); END IF;RAISE;
 END;
END
$command$;
CREATE FUNCTION crest_commands.lookup_vehicle_association_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED'; END IF;
 context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.association_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_vehicle_associations(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_vehicle uuid,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE context jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_vehicle IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED'; END IF;
 context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH matches AS MATERIALIZED(SELECT c.* FROM crest.customer_vehicles c WHERE c.business_id=requested_business AND c.vehicle_id=requested_vehicle AND (after_id IS NULL OR c.id>after_id) ORDER BY c.id LIMIT page_limit+1),page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'vehicleId',requested_vehicle,'associations',coalesce((SELECT jsonb_agg(crest_private.association_projection(p::crest.customer_vehicles) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ASSOCIATION_PAGE_LIMIT'; END IF;RETURN result;
END
$list$;
CREATE FUNCTION crest_commands.read_vehicle_association_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_association uuid,after_version bigint,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; source crest.customer_vehicles; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_association IS NULL OR after_version IS NULL OR after_version<0 OR after_version>2 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED'; END IF;
 context:=crest_commands.authorize_vehicle_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO source FROM crest.customer_vehicles WHERE business_id=requested_business AND id=requested_association;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 WITH matches AS MATERIALIZED(SELECT a.* FROM crest_private.audit_events a WHERE a.business_id=requested_business AND a.entity_kind='customer_vehicles' AND a.entity_id=requested_association AND a.entity_version>after_version ORDER BY a.entity_version LIMIT page_limit+1),page AS(SELECT * FROM matches ORDER BY entity_version LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'association',crest_private.association_projection(source),'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ASSOCIATION_PAGE_LIMIT'; END IF;RETURN result;
END
$history$;

CREATE FUNCTION crest_commands.association_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_ASSOCIATION_SNAPSHOT_REQUIRED'; END IF;
  IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_INPUT_REQUIRED'; END IF;
  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_SCOPE_REQUIRED'; END IF;
  SELECT count(*) INTO n FROM crest.customer_vehicles WHERE business_id=requested_business;
  IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ASSOCIATION_SNAPSHOT_LIMIT'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','vehicle_associations','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.vehicle.associations.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.association_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
  context:=crest_commands.association_snapshot_context(requested_business);
  IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ASSOCIATION_SNAPSHOT_REQUIRED'; END IF;
  WITH page AS(SELECT * FROM crest.customer_vehicles WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'associations',coalesce(jsonb_agg(crest_private.association_projection(p::crest.customer_vehicles) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
  IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ASSOCIATION_PAGE_LIMIT'; END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_vehicle_owner;
ALTER FUNCTION crest_private.association_operation_result(uuid,uuid,uuid) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.change_vehicle_association(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.lookup_vehicle_association_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.read_vehicle_associations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.read_vehicle_association_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.association_snapshot_context(uuid) OWNER TO crest_vehicle_owner;
ALTER FUNCTION crest_commands.association_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_vehicle_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_vehicle_owner;
REVOKE ALL ON FUNCTION crest_private.association_operation_result(uuid,uuid,uuid),crest_commands.change_vehicle_association(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb),crest_commands.lookup_vehicle_association_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_vehicle_associations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer),crest_commands.read_vehicle_association_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),crest_commands.association_snapshot_context(uuid),crest_commands.association_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.change_vehicle_association(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb),crest_commands.lookup_vehicle_association_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_vehicle_associations(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer),crest_commands.read_vehicle_association_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.association_snapshot_context(uuid),crest_commands.association_snapshot_page(uuid,text,uuid,integer) TO crest_export;
