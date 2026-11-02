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
