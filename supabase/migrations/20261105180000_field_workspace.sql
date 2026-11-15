-- Synthetic field workspace schema54 candidate; not repository registration.
-- Coordinator owns one atomic transaction; original source history is retained.
RESET ROLE;

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/field-time-storage.sql
-- P07/BR07/BR08 construction over registered53. Append-only source versions;
-- a rebuildable projection enforces physical occupancy and work-session spans.
-- No web/worker write/read grants, registered migration or runtime activation.
DO $review$ BEGIN
 -- Fixed predecessors were measured on fresh coordinator-verified registered53.
 -- Never derive acceptance hashes from the database receiving this proposal.
 IF EXISTS(
  SELECT 1 FROM (VALUES
   ('crest_private.lock_booking_operator(uuid,uuid)','crest_booking_integrity_owner',true,'dcdda72bd64412f639d1cf5641cc18977a54cd5abbd614bf361c3044511279af'),
   ('crest_private.prepare_command_audit()','crest_schema_owner',false,'3ce9a5af199d192d13f3ca17cd144f77f0db75c34b91fab6b81b209b1f2f0482'),
   ('crest_private.check_operation_completion()','crest_integrity_owner',true,'0fac1bbd7f084beaf10a72f2042c229995ffa069557960a0f2560f507008ac42')
  ) expected(signature,owner,security_definer,sha256)
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
  LEFT JOIN pg_roles r ON r.oid=p.proowner
  WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM expected.owner
   OR p.prosecdef IS DISTINCT FROM expected.security_definer
   OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM expected.sha256
 ) OR EXISTS(
  SELECT 1 FROM (VALUES('crest.businesses'),('crest.memberships'),('crest.vehicles'),('crest.jobs'),('crest.operator_controls'),('crest_private.operations'),('crest_private.audit_events')) expected(name)
  LEFT JOIN pg_class c ON c.oid=to_regclass(expected.name)
  WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_SOURCE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>53
  OR to_regprocedure('crest_private.lock_booking_operator(uuid,uuid)') IS NULL
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crest' AND c.relname=ANY(ARRAY['work_intervals','travel_legs','operator_occupancy','current_work_intervals','current_travel_legs']))
  OR NOT EXISTS(SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='btree_gist' AND n.nspname='extensions')
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_integrity_owner'))<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR has_schema_privilege('crest_booking_integrity_owner','crest_private','CREATE')
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_schema_owner'::regrole AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole='crest_schema_owner'::regrole AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f','crest_schema_owner'::regrole))) a WHERE a.grantee<>'crest_schema_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.work_intervals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 logical_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,
 job_id uuid NOT NULL,operator_actor_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('active','pause')),
 started_at timestamptz NOT NULL CHECK(isfinite(started_at)),ended_at timestamptz CHECK(isfinite(ended_at) AND ended_at>=started_at),
 pause_reason text CHECK(char_length(pause_reason)<=1000 AND btrim(pause_reason,E' \t\n\r')<>''),
 change_kind text NOT NULL CHECK(change_kind IN('open','record','close','correct')),
 reason text CHECK(char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>''),
 CHECK((kind='pause')=(pause_reason IS NOT NULL)),
 CHECK(sequence=1 AND replaces_id IS NULL AND logical_id=id AND change_kind IN('open','record') OR sequence>1 AND replaces_id IS NOT NULL AND change_kind IN('close','correct')),
 CHECK(change_kind<>'open' OR ended_at IS NULL),CHECK(change_kind<>'close' OR ended_at IS NOT NULL),
 CHECK(change_kind NOT IN('record','correct') OR reason IS NOT NULL),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,logical_id,sequence),UNIQUE(business_id,replaces_id),
 UNIQUE(business_id,id,logical_id,job_id,operator_actor_id),UNIQUE(business_id,id,operator_actor_id,job_id),
 FOREIGN KEY(business_id,job_id,operator_actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),
 FOREIGN KEY(business_id,replaces_id,logical_id,job_id,operator_actor_id) REFERENCES crest.work_intervals(business_id,id,logical_id,job_id,operator_actor_id),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.travel_legs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 logical_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,operator_actor_id uuid NOT NULL,
 driven_vehicle_id uuid NOT NULL,job_context_id uuid,
 purpose text NOT NULL CHECK(purpose IN('mobile_work_site','supply','between_jobs','return_to_base','pickup','to_work_site','return_to_customer','other')),
 origin_snapshot jsonb NOT NULL CHECK(jsonb_typeof(origin_snapshot)='object' AND octet_length(origin_snapshot::text)<=16384),
 destination_snapshot jsonb NOT NULL CHECK(jsonb_typeof(destination_snapshot)='object' AND octet_length(destination_snapshot::text)<=16384),
 departed_at timestamptz NOT NULL CHECK(isfinite(departed_at)),arrived_at timestamptz CHECK(isfinite(arrived_at) AND arrived_at>=departed_at),
 state text NOT NULL CHECK(state IN('open','closed','cancelled')),CHECK((state='open')=(arrived_at IS NULL)),
 eta_at timestamptz CHECK(isfinite(eta_at)),eta_source text CHECK(char_length(eta_source)<=1000 AND btrim(eta_source,E' \t\n\r')<>''),eta_calculated_at timestamptz CHECK(isfinite(eta_calculated_at)),
 CHECK(eta_at IS NULL AND eta_source IS NULL AND eta_calculated_at IS NULL OR eta_at IS NOT NULL AND eta_source IS NOT NULL AND eta_calculated_at IS NOT NULL),
 notes text CHECK(char_length(notes)<=2000),
 change_kind text NOT NULL CHECK(change_kind IN('depart','record','arrive','cancel','correct')),
 reason text CHECK(char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>''),
 CHECK(sequence=1 AND replaces_id IS NULL AND logical_id=id AND change_kind IN('depart','record') OR sequence>1 AND replaces_id IS NOT NULL AND change_kind IN('arrive','cancel','correct')),
 CHECK(change_kind<>'depart' OR state='open'),CHECK(change_kind<>'arrive' OR state='closed'),CHECK(change_kind<>'cancel' OR state='cancelled'),
 CHECK(change_kind NOT IN('record','cancel','correct') OR reason IS NOT NULL),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,logical_id,sequence),UNIQUE(business_id,replaces_id),
 UNIQUE(business_id,id,logical_id,operator_actor_id),UNIQUE(business_id,id,operator_actor_id),
 FOREIGN KEY(business_id,operator_actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,job_context_id,operator_actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),
 FOREIGN KEY(business_id,driven_vehicle_id) REFERENCES crest.vehicles(business_id,id),
 FOREIGN KEY(business_id,replaces_id,logical_id,operator_actor_id) REFERENCES crest.travel_legs(business_id,id,logical_id,operator_actor_id),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.operator_occupancy(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),
 source_kind text NOT NULL CHECK(source_kind IN('work','travel')),logical_id uuid NOT NULL,
 operator_actor_id uuid NOT NULL,job_id uuid,work_interval_id uuid,travel_leg_id uuid,
 started_at timestamptz NOT NULL CHECK(isfinite(started_at)),ended_at timestamptz CHECK(isfinite(ended_at) AND ended_at>=started_at),
 occupied tstzrange NOT NULL,work_span tstzrange NOT NULL,
 CHECK(source_kind='work' AND work_interval_id IS NOT NULL AND travel_leg_id IS NULL AND job_id IS NOT NULL OR source_kind='travel' AND travel_leg_id IS NOT NULL AND work_interval_id IS NULL AND job_id IS NULL),
 UNIQUE(business_id,id),UNIQUE(business_id,source_kind,logical_id),UNIQUE(business_id,work_interval_id),UNIQUE(business_id,travel_leg_id),
 FOREIGN KEY(business_id,work_interval_id,operator_actor_id,job_id) REFERENCES crest.work_intervals(business_id,id,operator_actor_id,job_id),
 FOREIGN KEY(business_id,travel_leg_id,operator_actor_id) REFERENCES crest.travel_legs(business_id,id,operator_actor_id),
 CONSTRAINT operator_physical_time_exclusion EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,operator_actor_id extensions.gist_uuid_ops WITH =,occupied WITH &&) DEFERRABLE INITIALLY IMMEDIATE,
 CONSTRAINT operator_work_session_exclusion EXCLUDE USING gist(business_id extensions.gist_uuid_ops WITH =,operator_actor_id extensions.gist_uuid_ops WITH =,work_span WITH &&) DEFERRABLE INITIALLY IMMEDIATE
);
CREATE UNIQUE INDEX operator_one_open_work ON crest.operator_occupancy(business_id,operator_actor_id) WHERE source_kind='work' AND ended_at IS NULL;
CREATE UNIQUE INDEX job_one_open_work ON crest.operator_occupancy(business_id,job_id) WHERE source_kind='work' AND ended_at IS NULL;
CREATE UNIQUE INDEX operator_one_open_leg ON crest.operator_occupancy(business_id,operator_actor_id) WHERE source_kind='travel' AND ended_at IS NULL;
-- The legacy53 job guards still refuse field transitions. This additional
-- invariant will also protect the coherent field commands when installed.
CREATE UNIQUE INDEX operator_one_unfinished_job ON crest.jobs(business_id,operator_actor_id) WHERE state IN('en_route','in_progress','paused');
CREATE VIEW crest.current_work_intervals WITH(security_invoker=true,security_barrier=true) AS SELECT w.* FROM crest.work_intervals w WHERE NOT EXISTS(SELECT 1 FROM crest.work_intervals n WHERE n.business_id=w.business_id AND n.replaces_id=w.id);
CREATE VIEW crest.current_travel_legs WITH(security_invoker=true,security_barrier=true) AS SELECT l.* FROM crest.travel_legs l WHERE NOT EXISTS(SELECT 1 FROM crest.travel_legs n WHERE n.business_id=l.business_id AND n.replaces_id=l.id);
DO $tables$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['work_intervals','travel_legs','operator_occupancy'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_booking_integrity_owner',n);
  EXECUTE format('CREATE POLICY field_integrity_read ON crest.%I FOR SELECT TO crest_booking_integrity_owner USING(true)',n);
 END LOOP;
END $tables$;
GRANT USAGE ON TYPE crest.work_intervals,crest.travel_legs,crest.operator_occupancy TO crest_booking_integrity_owner;
GRANT SELECT ON crest.current_work_intervals,crest.current_travel_legs TO crest_booking_integrity_owner;
GRANT INSERT,UPDATE ON crest.operator_occupancy TO crest_booking_integrity_owner;
CREATE POLICY field_projection_create ON crest.operator_occupancy FOR INSERT TO crest_booking_integrity_owner WITH CHECK(true);
CREATE POLICY field_projection_update ON crest.operator_occupancy FOR UPDATE TO crest_booking_integrity_owner USING(true) WITH CHECK(true);
CREATE POLICY field_integrity_operations ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type IN('operations.job.field','operations.travel.record','operations.time.correct'));
CREATE POLICY field_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(entity_kind IN('work_intervals','travel_legs'));
-- Existing booking verification intentionally lacks this column. Field-time
-- corrections must additionally bind the exact retained correction reason.
GRANT SELECT(reason) ON crest_private.audit_events TO crest_booking_integrity_owner;
CREATE UNIQUE INDEX field_source_audit_version ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN('work_intervals','travel_legs');
CREATE FUNCTION crest_private.field_work_projection(w crest.work_intervals) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $p$
 SELECT to_jsonb(w)||jsonb_build_object('sequence',w.sequence::text,'started_at',to_char(w.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'ended_at',CASE WHEN w.ended_at IS NULL THEN NULL ELSE to_char(w.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_at',to_char(w.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $p$;
CREATE FUNCTION crest_private.field_travel_projection(l crest.travel_legs) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $p$
 SELECT to_jsonb(l)||jsonb_build_object('sequence',l.sequence::text,'departed_at',to_char(l.departed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'arrived_at',CASE WHEN l.arrived_at IS NULL THEN NULL ELSE to_char(l.arrived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'eta_at',CASE WHEN l.eta_at IS NULL THEN NULL ELSE to_char(l.eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'eta_calculated_at',CASE WHEN l.eta_calculated_at IS NULL THEN NULL ELSE to_char(l.eta_calculated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_at',to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $p$;
CREATE FUNCTION crest_private.field_source_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
DECLARE actor uuid;operation uuid;command text;stamp timestamptz:=clock_timestamp();w crest.work_intervals;l crest.travel_legs;
BEGIN
 actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 IF actor IS NULL OR operation IS NULL OR NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.created_by IS DISTINCT FROM actor OR NEW.operation_id IS DISTINCT FROM operation OR NEW.origin<>'manual' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_CONTEXT_REQUIRED';END IF;
 SELECT command_type INTO command FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL;
 IF command IS NULL OR command NOT IN('operations.job.field','operations.travel.record','operations.time.correct') OR NEW.change_kind IN('record','correct') AND command<>'operations.time.correct' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_OPERATION_REQUIRED';END IF;
 PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);
 IF TG_TABLE_NAME='work_intervals' THEN
  IF command='operations.travel.record' OR NEW.started_at>stamp OR NEW.ended_at>stamp THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_TIME_REQUIRED';END IF;
  IF NEW.replaces_id IS NOT NULL THEN
   SELECT * INTO w FROM crest.work_intervals WHERE business_id=NEW.business_id AND id=NEW.replaces_id;
   IF w.id IS NULL OR NEW.sequence<>w.sequence+1 OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=NEW.business_id AND replaces_id=w.id) OR w.ended_at IS NOT NULL AND NEW.ended_at IS NULL
    OR NEW.change_kind='close' AND(w.ended_at IS NOT NULL OR ROW(NEW.kind,NEW.started_at,NEW.pause_reason) IS DISTINCT FROM ROW(w.kind,w.started_at,w.pause_reason)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_PREDECESSOR_REQUIRED';END IF;
  END IF;
 ELSE
  IF NEW.departed_at>stamp OR NEW.arrived_at>stamp OR NEW.eta_calculated_at>stamp THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_TIME_REQUIRED';END IF;
  IF NEW.replaces_id IS NOT NULL THEN
   SELECT * INTO l FROM crest.travel_legs WHERE business_id=NEW.business_id AND id=NEW.replaces_id;
   IF l.id IS NULL OR NEW.sequence<>l.sequence+1 OR EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=NEW.business_id AND replaces_id=l.id) OR l.arrived_at IS NOT NULL AND NEW.arrived_at IS NULL
    OR NEW.change_kind IN('arrive','cancel') AND(l.arrived_at IS NOT NULL OR ROW(NEW.driven_vehicle_id,NEW.job_context_id,NEW.purpose,NEW.origin_snapshot,NEW.departed_at,NEW.eta_at,NEW.eta_source,NEW.eta_calculated_at,NEW.notes) IS DISTINCT FROM ROW(l.driven_vehicle_id,l.job_context_id,l.purpose,l.origin_snapshot,l.departed_at,l.eta_at,l.eta_source,l.eta_calculated_at,l.notes))
    OR NEW.change_kind='arrive' AND NEW.destination_snapshot IS DISTINCT FROM l.destination_snapshot THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_PREDECESSOR_REQUIRED';END IF;
  END IF;
 END IF;
 NEW.created_at:=stamp;RETURN NEW;
END $stamp$;
CREATE FUNCTION crest_private.field_project_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $project$
DECLARE physical tstzrange;work_range tstzrange;job uuid;ending timestamptz;starting timestamptz;work_id uuid;leg_id uuid;kind text;
BEGIN
 IF TG_TABLE_NAME='work_intervals' THEN
  kind:='work';work_id:=NEW.id;job:=NEW.job_id;starting:=NEW.started_at;ending:=NEW.ended_at;work_range:=tstzrange(starting,ending,'[)');physical:=CASE WHEN NEW.kind='active' THEN work_range ELSE 'empty'::tstzrange END;
 ELSE kind:='travel';leg_id:=NEW.id;starting:=NEW.departed_at;ending:=NEW.arrived_at;physical:=tstzrange(starting,ending,'[)');work_range:='empty'::tstzrange;END IF;
 INSERT INTO crest.operator_occupancy(business_id,source_kind,logical_id,operator_actor_id,job_id,work_interval_id,travel_leg_id,started_at,ended_at,occupied,work_span)
 VALUES(NEW.business_id,kind,NEW.logical_id,NEW.operator_actor_id,job,work_id,leg_id,starting,ending,physical,work_range)
 ON CONFLICT(business_id,source_kind,logical_id) DO UPDATE SET work_interval_id=EXCLUDED.work_interval_id,travel_leg_id=EXCLUDED.travel_leg_id,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,occupied=EXCLUDED.occupied,work_span=EXCLUDED.work_span;
 RETURN NULL;
END $project$;
CREATE FUNCTION crest_private.field_check_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE o crest.operator_occupancy;w crest.work_intervals;l crest.travel_legs;expected timestamptz;physical tstzrange;work_range tstzrange;
BEGIN
 SELECT * INTO o FROM crest.operator_occupancy WHERE business_id=NEW.business_id AND id=NEW.id;
 IF o.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_PROJECTION_REQUIRED';END IF;
 IF o.source_kind='work' THEN
  SELECT * INTO w FROM crest.current_work_intervals WHERE business_id=o.business_id AND logical_id=o.logical_id;
  work_range:=tstzrange(w.started_at,w.ended_at,'[)');physical:=CASE WHEN w.kind='active' THEN work_range ELSE 'empty'::tstzrange END;
  IF w.id IS NULL OR ROW(o.work_interval_id,o.job_id,o.operator_actor_id,o.started_at,o.ended_at) IS DISTINCT FROM ROW(w.id,w.job_id,w.operator_actor_id,w.started_at,w.ended_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_PROJECTION_REQUIRED';END IF;
 ELSE
  SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=o.business_id AND logical_id=o.logical_id;work_range:='empty'::tstzrange;physical:=tstzrange(l.departed_at,l.arrived_at,'[)');
  IF l.id IS NULL OR ROW(o.travel_leg_id,o.operator_actor_id,o.started_at,o.ended_at) IS DISTINCT FROM ROW(l.id,l.operator_actor_id,l.departed_at,l.arrived_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_PROJECTION_REQUIRED';END IF;
 END IF;
 IF o.occupied IS DISTINCT FROM physical OR o.work_span IS DISTINCT FROM work_range THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_PROJECTION_REQUIRED';END IF;RETURN NULL;
END $check$;
CREATE FUNCTION crest_private.field_check_source_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE before_row jsonb:='null'::jsonb;after_row jsonb;w crest.work_intervals;l crest.travel_legs;
BEGIN
 IF TG_TABLE_NAME='work_intervals' THEN
  after_row:=crest_private.field_work_projection(NEW);IF NEW.replaces_id IS NOT NULL THEN SELECT * INTO w FROM crest.work_intervals WHERE business_id=NEW.business_id AND id=NEW.replaces_id;before_row:=crest_private.field_work_projection(w);END IF;
 ELSE after_row:=crest_private.field_travel_projection(NEW);IF NEW.replaces_id IS NOT NULL THEN SELECT * INTO l FROM crest.travel_legs WHERE business_id=NEW.business_id AND id=NEW.replaces_id;before_row:=crest_private.field_travel_projection(l);END IF;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND state='committed')
  OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=NEW.logical_id AND a.entity_version=NEW.sequence AND a.action=CASE WHEN NEW.sequence=1 THEN 'create' ELSE NEW.change_kind END AND a.origin='manual' AND a.import_row_id IS NULL AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row) AND a.reason IS NOT DISTINCT FROM NEW.reason)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_AUDIT_REQUIRED';END IF;RETURN NULL;
END $audit$;
CREATE FUNCTION crest_private.field_retain_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retain$ BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_FIELD_HISTORY_RETAINED';END $retain$;
CREATE TRIGGER field_work_stamp BEFORE INSERT ON crest.work_intervals FOR EACH ROW EXECUTE FUNCTION crest_private.field_source_stamp();
CREATE TRIGGER field_travel_stamp BEFORE INSERT ON crest.travel_legs FOR EACH ROW EXECUTE FUNCTION crest_private.field_source_stamp();
CREATE TRIGGER field_work_projection AFTER INSERT ON crest.work_intervals FOR EACH ROW EXECUTE FUNCTION crest_private.field_project_source();
CREATE TRIGGER field_travel_projection AFTER INSERT ON crest.travel_legs FOR EACH ROW EXECUTE FUNCTION crest_private.field_project_source();
CREATE CONSTRAINT TRIGGER field_projection_check AFTER INSERT OR UPDATE ON crest.operator_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.field_check_projection();
CREATE CONSTRAINT TRIGGER field_work_audit AFTER INSERT ON crest.work_intervals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.field_check_source_audit();
CREATE CONSTRAINT TRIGGER field_travel_audit AFTER INSERT ON crest.travel_legs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.field_check_source_audit();
DO $retain$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['work_intervals','travel_legs'] LOOP EXECUTE format('CREATE TRIGGER field_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source()',n);END LOOP;
END $retain$;
CREATE TRIGGER field_retain BEFORE DELETE OR TRUNCATE ON crest.operator_occupancy FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_source_stamp() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_project_source() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_check_projection() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_check_source_audit() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_work_projection(crest.work_intervals) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_travel_projection(crest.travel_legs) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.field_source_stamp(),crest_private.field_project_source(),crest_private.field_check_projection(),crest_private.field_check_source_audit(),crest_private.field_retain_source(),crest_private.field_work_projection(crest.work_intervals),crest_private.field_travel_projection(crest.travel_legs) FROM PUBLIC;

RESET ROLE;
-- END REVIEWED planning/proposals/field-time-storage.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/field-session-commands.sql
-- P07/BR07/BR09: genuine atomic Mobile travel and field session construction.
-- Held until travel/custody/completion, original retirement, complete field
-- retrieval/recovery and the connected product journey are integrated.
-- This is not a registered migration or an instruction to activate field work.
DO $review$
BEGIN
 IF to_regprocedure('crest_private.field_source_stamp()') IS NULL
  OR to_regprocedure('crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.authorize_booking_statement()') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='abb6cfb4f912e9c61b5fb4d7ebba6edcb87291119dbc063cd7e925f8143a8e8b')
  -- This unchanged predecessor body is pinned from registered50 source bytes,
  -- not from the receiving database; owner/definer/config are checked too.
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_schedule_event()') AND proowner='crest_booking_integrity_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='e2c702b6774a74f7cf56376b709a38d631961f0d7a7ba7f84493f038042c6d61')
  OR EXISTS(SELECT 1 FROM (VALUES
   ('crest_private.stamp_booking_row()','946c95452493bb864737cdddaeefe74980eba7258e594f7967013675dc570c0a'),
   ('crest_private.check_booking_row_audit()','c888b999e42d6b6d31ab08904cc9240151d9dd35eb32c858afa6cf21c95974f2'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','02500565c83e68f1b983d280c23ecb390959858272557eedb9fe0715d7a8d266')
  ) e(signature,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
   WHERE p.oid IS NULL OR p.proowner<>'crest_booking_integrity_owner'::regrole OR NOT p.prosecdef
    OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT,INSERT ON crest.work_intervals TO crest_booking_owner;
GRANT USAGE ON TYPE crest.work_intervals TO crest_booking_owner;
GRANT SELECT ON crest.current_work_intervals,crest.current_travel_legs TO crest_booking_owner;
GRANT SELECT,INSERT ON crest.travel_legs TO crest_booking_owner;
GRANT USAGE ON TYPE crest.travel_legs TO crest_booking_owner;
GRANT UPDATE(first_work_at) ON crest.jobs TO crest_booking_owner;
GRANT INSERT(reason) ON crest_private.audit_events TO crest_booking_owner;
GRANT SELECT(payload_hash,recovery_epoch,result) ON crest_private.operations TO crest_booking_integrity_owner;
GRANT SELECT(id) ON crest_private.audit_events TO crest_booking_integrity_owner;
CREATE POLICY field_session_jobs_change ON crest.jobs FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND (state='en_route' AND first_work_at IS NULL OR state IN('in_progress','paused') AND first_work_at IS NOT NULL) AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=jobs.business_id AND o.operation_id=jobs.operation_id AND o.actor_id=jobs.updated_by AND o.command_type='operations.job.field' AND o.schema_version=1 AND o.state='pending'));
CREATE POLICY field_session_read ON crest.work_intervals FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY field_session_create ON crest.work_intervals FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
CREATE POLICY field_session_travel_read ON crest.travel_legs FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY field_session_travel_create ON crest.travel_legs FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
CREATE POLICY field_session_operations_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.field');
CREATE POLICY field_session_operations_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.field' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY field_session_operations_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.field') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.field');
CREATE POLICY field_session_audits_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND entity_kind IN('work_intervals','travel_legs'));
CREATE POLICY field_session_audits_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL AND entity_kind IN('work_intervals','travel_legs'));
CREATE FUNCTION crest_private.valid_field_session_body(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE trip jsonb;location jsonb;eta timestamptz;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT body ?& ARRAY['action','reason'] OR body->>'action' IS NULL OR body->>'action' NOT IN('depart','arrive','direct_arrive','pause','resume')
  OR NOT coalesce(body->'reason'='null'::jsonb AND body->>'action' IN('depart','arrive','resume') OR jsonb_typeof(body->'reason')='string' AND char_length(body->>'reason') BETWEEN 1 AND 1000 AND btrim(body->>'reason',E' \t\r\n')<>'',false) THEN RETURN false;END IF;
 IF body->>'action'<>'depart' THEN RETURN body-ARRAY['action','reason']='{}'::jsonb;END IF;
 IF body-ARRAY['action','reason','trip']<>'{}'::jsonb OR NOT body ? 'trip' THEN RETURN false;END IF;
 trip:=body->'trip';location:=trip->'origin';
 IF jsonb_typeof(trip) IS DISTINCT FROM 'object' OR trip-ARRAY['drivenVehicleId','origin','etaAt','notes']<>'{}'::jsonb OR NOT trip ?& ARRAY['drivenVehicleId','origin','etaAt','notes']
  OR jsonb_typeof(trip->'drivenVehicleId') IS DISTINCT FROM 'string' OR (trip->>'drivenVehicleId')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR jsonb_typeof(location) IS DISTINCT FROM 'object' OR location-ARRAY['schemaVersion','kind','locationText','instructions']<>'{}'::jsonb OR NOT location ?& ARRAY['schemaVersion','kind','locationText','instructions'] OR location->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR location->>'kind' IS DISTINCT FROM 'manual'
  OR jsonb_typeof(location->'locationText') IS DISTINCT FROM 'string' OR char_length(location->>'locationText') NOT BETWEEN 1 AND 2000 OR btrim(location->>'locationText',E' \t\r\n')=''
  OR NOT coalesce(location->'instructions'='null'::jsonb OR jsonb_typeof(location->'instructions')='string' AND char_length(location->>'instructions') BETWEEN 1 AND 2000 AND btrim(location->>'instructions',E' \t\r\n')<>'',false)
  OR NOT coalesce(trip->'notes'='null'::jsonb OR jsonb_typeof(trip->'notes')='string' AND char_length(trip->>'notes') BETWEEN 1 AND 2000 AND btrim(trip->>'notes',E' \t\r\n')<>'',false)
 THEN RETURN false;END IF;
 IF trip->'etaAt'='null'::jsonb THEN RETURN true;END IF;
 IF jsonb_typeof(trip->'etaAt') IS DISTINCT FROM 'string' OR (trip->>'etaAt')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN false;END IF;
 eta:=(trip->>'etaAt')::timestamptz;RETURN isfinite(eta) AND to_char(eta AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=trip->>'etaAt';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END
$body$;
CREATE FUNCTION crest_private.mobile_eta_draft(leg crest.travel_legs,appointment crest.appointments,customer crest.customers) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $draft$
 SELECT jsonb_build_object('schemaVersion',1,'kind','mobile_arrival_eta','templateVersion',1,'state',CASE WHEN customer.outreach_opt_out OR appointment.contact_snapshot->>'kind'='no_contact' THEN 'skipped' ELSE 'prepared' END,'suppressionReason',CASE WHEN customer.outreach_opt_out THEN 'outreach_opt_out' WHEN appointment.contact_snapshot->>'kind'='no_contact' THEN 'no_contact' END,'jobId',leg.job_context_id,'travelLegId',leg.id,'recipientSnapshot',appointment.contact_snapshot,'etaAt',CASE WHEN leg.eta_at IS NOT NULL THEN to_char(leg.eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'timezone',appointment.timezone,'bodyText',CASE WHEN customer.outreach_opt_out OR appointment.contact_snapshot->>'kind'='no_contact' THEN NULL WHEN leg.eta_at IS NULL THEN 'I''m on the way for your detailing appointment. I''ll update you when I have an arrival estimate.' ELSE 'I''m on the way for your detailing appointment. Estimated arrival: '||to_char(leg.eta_at AT TIME ZONE appointment.timezone,'Mon DD, YYYY HH24:MI')||' ('||appointment.timezone||'). This is approximate.' END)
$draft$;
REVOKE ALL ON FUNCTION crest_private.mobile_eta_draft(crest.travel_legs,crest.appointments,crest.customers) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.mobile_eta_draft(crest.travel_legs,crest.appointments,crest.customers) TO crest_booking_owner,crest_booking_integrity_owner;
CREATE FUNCTION crest_private.check_field_session_graph(business uuid,job uuid,source_operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;w crest.work_intervals;closed crest.work_intervals;previous crest.work_intervals;l crest.travel_legs;prior_leg crest.travel_legs;a crest.appointments;c crest.customers;before_job jsonb;after_job jsonb;action text;body jsonb;first_at timestamptz;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=source_operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 body:=e.evidence->'request'->'payload';action:=body->>'action';
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM source_operation OR e.id IS NULL OR e.operation_id<>source_operation OR e.created_by<>j.updated_by OR e.to_state<>j.state
  OR e.from_state IS DISTINCT FROM before_job->>'state' OR e.reason IS DISTINCT FROM body->>'reason' OR NOT crest_private.valid_field_session_body(body)
  OR e.effective_at>e.created_at OR e.evidence->>'action' IS DISTINCT FROM action
  OR after_job IS DISTINCT FROM crest_private.jobs_projection(j)
  OR before_job IS NULL OR before_job-ARRAY['state','version','updated_at','updated_by','operation_id','first_work_at'] IS DISTINCT FROM after_job-ARRAY['state','version','updated_at','updated_by','operation_id','first_work_at']
  OR e.evidence->'request' IS DISTINCT FROM jsonb_build_object('commandType','operations.job.field','schemaVersion',1,'businessId',business,'actorId',j.updated_by,'recoveryEpoch',(SELECT recovery_epoch FROM crest_private.operations WHERE business_id=business AND operation_id=source_operation),'jobId',job,'expectedVersion',(j.version-1)::text,'payload',body)
  OR (before_job->>'version')::bigint+1<>j.version OR (SELECT max(sequence) FROM crest.job_events WHERE business_id=business AND job_id=job)<>j.version
  OR j.fulfillment_mode<>'mobile' OR j.state NOT IN('en_route','in_progress','paused') OR j.completed_at IS NOT NULL OR j.completion_outcome IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_JOB_GRAPH_REQUIRED';END IF;
 IF action IN('depart','arrive') THEN
  SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=(e.evidence->>'travelLegId')::uuid;
  SELECT * INTO a FROM crest.appointments WHERE business_id=business AND job_id=job AND id=j.current_appointment_id;
  IF l.id IS NULL OR l.operation_id<>source_operation OR l.job_context_id<>job OR l.operator_actor_id<>j.operator_actor_id OR l.purpose<>'mobile_work_site' OR l.destination_snapshot IS DISTINCT FROM j.work_location_snapshot
   OR a.id IS NULL OR a.confirmation_state<>'confirmed' OR e.evidence->>'mileageStatus' IS DISTINCT FROM 'unresolved'
   OR e.evidence->'travelOmissionRecorded' IS DISTINCT FROM 'false'::jsonb OR e.evidence->'closedWorkIntervalId' IS DISTINCT FROM 'null'::jsonb
   OR (SELECT count(*) FROM crest.travel_legs WHERE business_id=business AND operation_id=source_operation)<>1
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_TRAVEL_GRAPH_REQUIRED';END IF;
  IF action='depart' THEN
   SELECT * INTO c FROM crest.customers WHERE business_id=business AND id=j.customer_id;
   IF e.from_state<>'scheduled' OR j.state<>'en_route' OR before_job->'first_work_at' IS DISTINCT FROM 'null'::jsonb OR j.first_work_at IS NOT NULL
    OR l.change_kind<>'depart' OR l.sequence<>1 OR l.replaces_id IS NOT NULL OR l.state<>'open' OR l.departed_at<>e.effective_at OR l.arrived_at IS NOT NULL
    OR l.driven_vehicle_id::text IS DISTINCT FROM body->'trip'->>'drivenVehicleId' OR l.origin_snapshot IS DISTINCT FROM body->'trip'->'origin' OR l.notes IS DISTINCT FROM body->'trip'->>'notes'
    OR l.eta_at IS DISTINCT FROM (body->'trip'->>'etaAt')::timestamptz
    OR l.eta_source IS DISTINCT FROM (CASE WHEN l.eta_at IS NOT NULL THEN 'owner_entered' END) OR l.eta_calculated_at IS DISTINCT FROM(CASE WHEN l.eta_at IS NOT NULL THEN e.effective_at END)
    OR c.id IS NULL OR e.evidence->'etaDraft' IS DISTINCT FROM crest_private.mobile_eta_draft(l,a,c) OR e.evidence->'workIntervalId' IS DISTINCT FROM 'null'::jsonb
    OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND job_id=job)
    OR (SELECT count(*) FROM crest.current_travel_legs WHERE business_id=business AND operator_actor_id=j.operator_actor_id AND state='open')<>1
    OR NOT EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND id=l.id)
    OR NOT EXISTS(SELECT 1 FROM crest.vehicles WHERE business_id=business AND id=l.driven_vehicle_id AND archived_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state='assigned')
    OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state<>'assigned')
    OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=source_operation)
    OR EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=source_operation AND entity_kind NOT IN('jobs','job_events','travel_legs'))
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_DEPARTURE_REQUIRED';END IF;RETURN;
  END IF;
  SELECT * INTO prior_leg FROM crest.travel_legs WHERE business_id=business AND id=l.replaces_id;
  IF prior_leg.id IS NULL OR prior_leg.state<>'open' OR l.change_kind<>'arrive' OR l.state<>'closed' OR l.arrived_at<>e.effective_at OR e.evidence->'etaDraft' IS DISTINCT FROM 'null'::jsonb
   OR NOT EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND id=l.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_ARRIVAL_REQUIRED';END IF;
 ELSIF e.evidence->'travelLegId' IS DISTINCT FROM 'null'::jsonb OR e.evidence->'mileageStatus' IS DISTINCT FROM 'null'::jsonb OR e.evidence->'etaDraft' IS DISTINCT FROM 'null'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_EXACT_SOURCE_REQUIRED';
 END IF;
 SELECT * INTO w FROM crest.current_work_intervals WHERE business_id=business AND job_id=job AND ended_at IS NULL;
 IF w.id IS NULL OR w.id::text IS DISTINCT FROM e.evidence->>'workIntervalId' OR w.operation_id<>source_operation OR w.operator_actor_id<>j.operator_actor_id OR w.started_at<>e.effective_at OR w.change_kind<>'open' OR w.replaces_id IS NOT NULL
  OR w.kind IS DISTINCT FROM(CASE action WHEN 'pause' THEN 'pause' ELSE 'active' END) OR w.pause_reason IS DISTINCT FROM(CASE WHEN action='pause' THEN e.reason END)
  OR (SELECT count(*) FROM crest.current_work_intervals WHERE business_id=business AND job_id=job AND ended_at IS NULL)<>1
  OR EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND operator_actor_id=j.operator_actor_id AND state='open')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_INTERVAL_GRAPH_REQUIRED';END IF;
 IF action IN('direct_arrive','arrive') THEN
  IF e.from_state IS DISTINCT FROM(CASE action WHEN 'arrive' THEN 'en_route' ELSE 'scheduled' END) OR j.state<>'in_progress' OR before_job->'first_work_at'<>'null'::jsonb OR j.first_work_at<>e.effective_at
   OR e.evidence->'travelOmissionRecorded' IS DISTINCT FROM to_jsonb(action='direct_arrive') OR e.evidence->'closedWorkIntervalId' IS DISTINCT FROM 'null'::jsonb
   OR (SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND job_id=job)<>1
   OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state='assigned')
   OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state<>'assigned')
   OR NOT EXISTS(SELECT 1 FROM crest.appointments WHERE business_id=business AND job_id=job AND id=j.current_appointment_id AND confirmation_state='confirmed')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_START_GRAPH_REQUIRED';END IF;
 ELSE
  first_at:=(before_job->>'first_work_at')::timestamptz;
  SELECT * INTO closed FROM crest.work_intervals WHERE business_id=business AND id=(e.evidence->>'closedWorkIntervalId')::uuid;
  SELECT * INTO previous FROM crest.work_intervals WHERE business_id=business AND id=closed.replaces_id;
  IF NOT(action='pause' AND e.from_state='in_progress' AND j.state='paused' OR action='resume' AND e.from_state='paused' AND j.state='in_progress')
   OR first_at IS NULL OR j.first_work_at IS DISTINCT FROM first_at OR e.evidence->'travelOmissionRecorded' IS DISTINCT FROM 'false'::jsonb
   OR closed.id IS NULL OR closed.operation_id<>source_operation OR closed.job_id<>job OR closed.change_kind<>'close' OR closed.ended_at<>e.effective_at
   OR previous.id IS NULL OR previous.ended_at IS NOT NULL OR previous.kind IS DISTINCT FROM(CASE action WHEN 'pause' THEN 'active' ELSE 'pause' END)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_CONTINUITY_REQUIRED';END IF;
 END IF;
 IF (SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND operation_id=source_operation)<>(CASE WHEN action IN('direct_arrive','arrive') THEN 1 ELSE 2 END)
  OR (SELECT count(*) FROM crest.travel_legs WHERE business_id=business AND operation_id=source_operation)<>(CASE WHEN action='arrive' THEN 1 ELSE 0 END)
  OR EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=source_operation AND entity_kind NOT IN('jobs','job_events','work_intervals','travel_legs'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_EXACT_SOURCE_REQUIRED';END IF;
END $graph$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_field_session_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_field_session_graph(uuid,uuid,uuid),crest_private.valid_field_session_body(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_field_session_body(jsonb) TO crest_booking_integrity_owner,crest_booking_owner;

-- Preserve each original booking branch; insert only the separately checked,
-- fixed field operation branch into the measured registered53 predecessors.
DO $extend$
DECLARE definition text;updated text;
BEGIN
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'SELECT * INTO a FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND operation_id=NEW.operation_id;', $branch$
 IF kind='operations.job.field' THEN PERFORM crest_private.check_field_session_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF;
 SELECT * INTO a FROM crest.appointments WHERE business_id=NEW.business_id AND job_id=NEW.job_id AND operation_id=NEW.operation_id;$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_EXTENSION_REVIEW_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.book''', 'IF NOT coalesce(kind=''operations.job.field'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME=''job_events'') OR kind=''operations.job.book''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_EXTENSION_REVIEW_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'IF TG_OP=''INSERT'' THEN', $branch$
 IF kind='operations.job.field' THEN
  IF TG_TABLE_NAME='jobs' AND TG_OP='UPDATE' THEN
   IF NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','first_work_at'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','first_work_at']
    OR NOT(OLD.state='scheduled' AND NEW.state='en_route' AND OLD.first_work_at IS NULL AND NEW.first_work_at IS NULL OR OLD.state IN('scheduled','en_route') AND NEW.state='in_progress' AND OLD.first_work_at IS NULL AND NEW.first_work_at IS NOT NULL OR OLD.state='in_progress' AND NEW.state='paused' AND NEW.first_work_at IS NOT DISTINCT FROM OLD.first_work_at OR OLD.state='paused' AND NEW.state='in_progress' AND NEW.first_work_at IS NOT DISTINCT FROM OLD.first_work_at)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_JOB_GRAPH_REQUIRED';END IF;
   NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_TABLE_NAME='job_events' AND TG_OP='INSERT' AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_EXACT_SOURCE_REQUIRED';END IF;
 END IF;
 IF TG_OP='INSERT' THEN$branch$);
 updated:=replace(updated,'''operations.job.cancel'',''quote.amendment.accept'')','''operations.job.cancel'',''quote.amendment.accept'',''operations.job.field'')');
 IF updated=definition OR position('IF kind=''operations.job.field'' THEN' IN updated)=0 THEN RAISE EXCEPTION 'CREST_FIELD_EXTENSION_REVIEW_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'')','(o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'') OR o.command_type=''operations.job.field'' AND TG_TABLE_NAME IN(''jobs'',''job_events''))');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_EXTENSION_REVIEW_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=business AND operation_id=source_operation;', $branch$
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=business AND operation_id=source_operation;
 IF kind='operations.job.field' THEN PERFORM crest_private.check_field_session_graph(business,job,source_operation);RETURN;END IF;$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_EXTENSION_REVIEW_REQUIRED';END IF;EXECUTE updated;
END $extend$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.field_session_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;journal record;audits jsonb;expected jsonb;digest text;
BEGIN
 SELECT state,payload_hash,recovery_epoch,result_schema_version,schema_version,result INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.field';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT id,delta INTO journal FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 digest:=encode(sha256(convert_to((e.evidence->'request')::text,'UTF8')),'hex');
 expected:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.field','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'state',e.to_state,'action',e.evidence->>'action','effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'workIntervalId',e.evidence->'workIntervalId','closedWorkIntervalId',e.evidence->'closedWorkIntervalId','travelOmissionRecorded',e.evidence->'travelOmissionRecorded','travelLegId',e.evidence->'travelLegId','mileageStatus',e.evidence->'mileageStatus','etaDraft',e.evidence->'etaDraft','auditIds',audits);
 IF e.id IS NULL OR journal.id IS NULL OR o.payload_hash<>digest OR o.result_schema_version<>1 OR o.schema_version<>1 OR o.result IS DISTINCT FROM expected
  OR journal.delta->'after'->>'state' IS DISTINCT FROM e.to_state OR journal.delta->'after'->>'version' IS DISTINCT FROM e.sequence::text
  OR jsonb_array_length(audits)<>(CASE WHEN e.evidence->>'action' IN('direct_arrive','depart') THEN 3 ELSE 4 END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',expected);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.field_session_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.field_session_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_session_result(uuid,uuid,uuid),crest_private.field_work_projection(crest.work_intervals),crest_private.field_travel_projection(crest.travel_legs),crest_private.check_field_session_graph(uuid,uuid,uuid) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.check_field_session_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
DECLARE checked jsonb;
BEGIN
 checked:=crest_private.field_session_result(NEW.business_id,NEW.actor_id,NEW.operation_id);
 IF checked->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_RESULT_REQUIRED';END IF;RETURN NULL;
END $guard$;
CREATE CONSTRAINT TRIGGER field_session_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.job.field') EXECUTE FUNCTION crest_private.check_field_session_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_field_session_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_field_session_result() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.change_field_session(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $change$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing crest_private.operations;j crest.jobs;before_job jsonb;open_work crest.work_intervals;closed_work crest.work_intervals;next_work crest.work_intervals;l crest.travel_legs;prior_leg crest.travel_legs;a crest.appointments;c crest.customers;eta_draft jsonb;e crest.job_events;family uuid;stamp timestamptz;action text;reason text;audits jsonb;receipt jsonb;result jsonb;constraint_name text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_version IS NULL OR expected_version<1 OR NOT crest_private.valid_field_session_body(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.field','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',expected_version::text,'payload',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');action:=body->>'action';reason:=body->>'reason';
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.field',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.field' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.field_session_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,j.operator_actor_id);
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='version';END IF;
   IF j.fulfillment_mode<>'mobile' OR NOT(action IN('depart','direct_arrive') AND j.state='scheduled' AND j.first_work_at IS NULL OR action='arrive' AND j.state='en_route' AND j.first_work_at IS NULL OR action='pause' AND j.state='in_progress' OR action='resume' AND j.state='paused') THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='state';END IF;
   IF action<>'arrive' AND EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=requested_business AND operator_actor_id=j.operator_actor_id AND state='open') THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='travel';END IF;
   stamp:=clock_timestamp();before_job:=crest_private.jobs_projection(j);
   IF action='depart' THEN
    PERFORM 1 FROM crest.vehicles WHERE business_id=requested_business AND id=(body->'trip'->>'drivenVehicleId')::uuid AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='vehicle';END IF;
    l.id:=gen_random_uuid();
    INSERT INTO crest.travel_legs(id,business_id,logical_id,sequence,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,state,eta_at,eta_source,eta_calculated_at,notes,change_kind,reason,created_by,operation_id)
    VALUES(l.id,requested_business,l.id,1,j.operator_actor_id,(body->'trip'->>'drivenVehicleId')::uuid,j.id,'mobile_work_site',body->'trip'->'origin',j.work_location_snapshot,stamp,'open',(body->'trip'->>'etaAt')::timestamptz,CASE WHEN body->'trip'->'etaAt'<>'null'::jsonb THEN 'owner_entered' END,CASE WHEN body->'trip'->'etaAt'<>'null'::jsonb THEN stamp END,body->'trip'->>'notes','depart',reason,expected_actor,requested_operation) RETURNING * INTO l;
    SELECT * INTO a FROM crest.appointments WHERE business_id=requested_business AND id=j.current_appointment_id;
    SELECT * INTO c FROM crest.customers WHERE business_id=requested_business AND id=j.customer_id FOR SHARE;
    eta_draft:=crest_private.mobile_eta_draft(l,a,c);
   ELSIF action='arrive' THEN
    SELECT * INTO prior_leg FROM crest.current_travel_legs WHERE business_id=requested_business AND operator_actor_id=j.operator_actor_id AND job_context_id=j.id AND purpose='mobile_work_site' AND state='open';
    IF prior_leg.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='travel';END IF;
    INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,eta_at,eta_source,eta_calculated_at,notes,change_kind,reason,created_by,operation_id)
    VALUES(requested_business,prior_leg.logical_id,prior_leg.sequence+1,prior_leg.id,j.operator_actor_id,prior_leg.driven_vehicle_id,j.id,prior_leg.purpose,prior_leg.origin_snapshot,prior_leg.destination_snapshot,prior_leg.departed_at,stamp,'closed',prior_leg.eta_at,prior_leg.eta_source,prior_leg.eta_calculated_at,prior_leg.notes,'arrive',reason,expected_actor,requested_operation) RETURNING * INTO l;
   END IF;
   IF l.id IS NOT NULL THEN
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',l.logical_id,l.sequence,CASE action WHEN 'depart' THEN 'create' ELSE 'arrive' END,l.reason,jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior_leg.id IS NULL THEN 'null'::jsonb ELSE crest_private.field_travel_projection(prior_leg) END,'after',crest_private.field_travel_projection(l)),'manual');
   END IF;
   IF action IN('pause','resume') THEN
    SELECT * INTO open_work FROM crest.current_work_intervals WHERE business_id=requested_business AND job_id=requested_job AND ended_at IS NULL;
    IF open_work.id IS NULL OR open_work.kind IS DISTINCT FROM(CASE action WHEN 'pause' THEN 'active' ELSE 'pause' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_CONTINUITY_REQUIRED';END IF;
    INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,started_at,ended_at,pause_reason,change_kind,created_by,operation_id)
    VALUES(requested_business,open_work.logical_id,open_work.sequence+1,open_work.id,j.id,j.operator_actor_id,open_work.kind,open_work.started_at,stamp,open_work.pause_reason,'close',expected_actor,requested_operation) RETURNING * INTO closed_work;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',closed_work.logical_id,closed_work.sequence,'close',jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(open_work),'after',crest_private.field_work_projection(closed_work)),'manual');
   END IF;
   IF action<>'depart' THEN
   next_work.id:=gen_random_uuid();
   INSERT INTO crest.work_intervals(id,business_id,logical_id,sequence,job_id,operator_actor_id,kind,started_at,pause_reason,change_kind,created_by,operation_id)
   VALUES(next_work.id,requested_business,next_work.id,1,j.id,j.operator_actor_id,CASE action WHEN 'pause' THEN 'pause' ELSE 'active' END,stamp,CASE WHEN action='pause' THEN reason END,'open',expected_actor,requested_operation) RETURNING * INTO next_work;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',next_work.logical_id,1,'create',jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.field_work_projection(next_work)),'manual');
   END IF;
   UPDATE crest.jobs SET state=CASE action WHEN 'depart' THEN 'en_route' WHEN 'pause' THEN 'paused' ELSE 'in_progress' END,first_work_at=CASE WHEN action='depart' THEN NULL ELSE coalesce(first_work_at,stamp) END,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',before_job,crest_private.jobs_projection(j));
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,before_job->>'state',j.state,stamp,reason,jsonb_build_object('schemaVersion',1,'action',action,'request',request,'workIntervalId',next_work.id,'closedWorkIntervalId',closed_work.id,'travelOmissionRecorded',action='direct_arrive','travelLegId',l.id,'mileageStatus',CASE WHEN l.id IS NOT NULL THEN 'unresolved' END,'etaDraft',eta_draft),expected_actor,requested_operation) RETURNING * INTO e;
   PERFORM crest_private.append_booking_audit('job_events',e.id,1,'create',NULL,crest_private.job_events_projection(e));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.field','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'state',j.state,'action',action,'effectiveAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'workIntervalId',next_work.id,'closedWorkIntervalId',closed_work.id,'travelOmissionRecorded',action='direct_arrive','travelLegId',l.id,'mileageStatus',CASE WHEN l.id IS NOT NULL THEN 'unresolved' END,'etaDraft',eta_draft,'auditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_private.check_field_session_graph(requested_business,j.id,requested_operation);
   result:=crest_private.field_session_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1801' THEN GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',reason);
 WHEN exclusion_violation THEN RETURN jsonb_build_object('state','conflict','reason','occupancy');
 WHEN unique_violation THEN GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;IF constraint_name IN('operator_one_unfinished_job','operator_one_open_work','job_one_open_work','operator_one_open_leg') THEN RETURN jsonb_build_object('state','conflict','reason','occupancy');END IF;RAISE;
 END;
END $change$;
CREATE FUNCTION crest_commands.lookup_field_session_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.field_session_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_field_session_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_field_session_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_field_session_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/field-session-commands.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/work-completion-plan.sql
-- BR06/BR07 operational completion planning over real, locked allocations.
-- Private construction only: no web grant, source writes, completion, invoice,
-- customer-obligation change or posting is authorized by these functions.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.field_session_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_private.load_completion_plans(uuid,uuid)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner') AND a.grantee<>r.oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.load_completion_plans(business uuid,job uuid,requested_plans uuid[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plans$
 SELECT coalesce(jsonb_agg(row_value ORDER BY source_allocation_id),'[]'::jsonb) FROM(
  SELECT v.source_allocation_id,jsonb_build_object('sourceAllocationId',v.source_allocation_id,'planId',v.id,'planSequence',v.sequence::text,'grossInclusiveCents',sum(p.gross_inclusive_cents::numeric)::text,'discountInclusiveCents',sum(p.discount_inclusive_cents::numeric)::text,'amountCents',sum(p.amount_cents::numeric)::text,
   'parts',jsonb_agg(jsonb_build_object('id',p.id,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.stable_partition_id)) AS row_value
  FROM crest.allocation_plan_versions v JOIN crest.allocation_plan_parts p ON p.business_id=v.business_id AND p.plan_id=v.id
  WHERE v.business_id=business AND (requested_plans IS NULL AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_versions later WHERE later.business_id=v.business_id AND later.source_allocation_id=v.source_allocation_id AND later.sequence>v.sequence) OR requested_plans IS NOT NULL AND v.id=ANY(requested_plans))
   AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts assigned WHERE assigned.business_id=v.business_id AND assigned.plan_id=v.id AND assigned.job_id=job AND assigned.allocation_state='assigned')
  GROUP BY v.source_allocation_id,v.id,v.sequence
 ) plans
$plans$;
CREATE FUNCTION crest_private.load_completion_plans(business uuid,job uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $latest$ SELECT crest_private.load_completion_plans(business,job,NULL::uuid[]) $latest$;
CREATE FUNCTION crest_private.calculate_completed_scope(business uuid,job uuid,plans jsonb,proposed jsonb,allowed_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $plan$
DECLARE plan jsonb;part jsonb;entry jsonb;piece jsonb;entries jsonb:='{}'::jsonb;used uuid[]:=ARRAY[]::uuid[];known_ids uuid[]:=ARRAY[]::uuid[];all_ids uuid[]:=ARRAY[]::uuid[];new_partition uuid;parts jsonb;new_part jsonb;new_plans jsonb:='[]'::jsonb;outcomes jsonb:='[]'::jsonb;gross numeric;discount numeric;amount numeric;fulfilled bigint:=0;unfulfilled bigint:=0;completed numeric:=0;field text;changed boolean;retained boolean;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRED';END IF;
 IF proposed IS NULL OR jsonb_typeof(proposed) IS DISTINCT FROM 'array' OR jsonb_array_length(proposed)=0 OR octet_length(proposed::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(proposed) LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['assignedPartId','expectedPlanId','expectedPlanSequence','pieces']<>'{}'::jsonb OR NOT entry ?& ARRAY['assignedPartId','expectedPlanId','expectedPlanSequence','pieces']
   OR crest_private.booking_uuid(entry->'assignedPartId') IS NOT TRUE OR crest_private.booking_uuid(entry->'expectedPlanId') IS NOT TRUE OR jsonb_typeof(entry->'expectedPlanSequence') IS DISTINCT FROM 'string' OR (entry->>'expectedPlanSequence')!~'^[1-9][0-9]{0,18}$' OR (entry->>'expectedPlanSequence')::numeric>9223372036854775807
   OR jsonb_typeof(entry->'pieces') IS DISTINCT FROM 'array' OR jsonb_array_length(entry->'pieces')=0 OR entries ? (entry->>'assignedPartId')
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  entries:=entries||jsonb_build_object(entry->>'assignedPartId',entry);
 END LOOP;
 IF plans IS NULL OR jsonb_typeof(plans) IS DISTINCT FROM 'array' OR jsonb_array_length(plans)=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
  FOR part IN SELECT value FROM jsonb_array_elements(plan->'parts') LOOP known_ids:=array_append(known_ids,(part->>'partitionId')::uuid);END LOOP;
 END LOOP;all_ids:=known_ids;
 FOR plan IN SELECT value FROM jsonb_array_elements(plans) LOOP
  IF (plan->>'planSequence')::numeric>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  parts:='[]'::jsonb;changed:=false;
  FOR part IN SELECT value FROM jsonb_array_elements(plan->'parts') LOOP
   IF part->>'jobId' IS DISTINCT FROM job::text OR part->>'state'<>'assigned' THEN parts:=parts||jsonb_build_array(part-'id');CONTINUE;END IF;
   entry:=entries->(part->>'id');
   IF entry IS NULL OR entry->>'expectedPlanId' IS DISTINCT FROM plan->>'planId' OR entry->>'expectedPlanSequence' IS DISTINCT FROM plan->>'planSequence' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
   used:=array_append(used,(part->>'id')::uuid);gross:=0;discount:=0;amount:=0;retained:=false;changed:=true;
   FOR piece IN SELECT value FROM jsonb_array_elements(entry->'pieces') LOOP
    IF jsonb_typeof(piece) IS DISTINCT FROM 'object' OR piece-ARRAY['partitionId','outcome','scopeDescription','grossInclusiveCents','discountInclusiveCents','amountCents','reason']<>'{}'::jsonb OR NOT piece ?& ARRAY['partitionId','outcome','scopeDescription','grossInclusiveCents','discountInclusiveCents','amountCents','reason']
     OR crest_private.booking_uuid(piece->'partitionId') IS NOT TRUE OR piece->>'outcome' IS NULL OR piece->>'outcome' NOT IN('completed','unfulfilled','cancelled') OR crest_private.booking_text_required(piece->'scopeDescription',2000) IS NOT TRUE
     OR translate(piece->>'scopeDescription',E'\t\n\r','')~'[[:cntrl:]]'
     OR (piece->'reason'<>'null'::jsonb AND(crest_private.booking_text_required(piece->'reason',1000) IS NOT TRUE OR translate(piece->>'reason',E'\t\n\r','')~'[[:cntrl:]]')) OR piece->>'outcome'<>'completed' AND piece->'reason'='null'::jsonb
    THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
    FOREACH field IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP
     IF jsonb_typeof(piece->field) IS DISTINCT FROM 'string' OR (piece->>field)!~'^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
     IF (piece->>field)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
    END LOOP;
    IF (piece->>'grossInclusiveCents')::numeric-(piece->>'discountInclusiveCents')::numeric<>(piece->>'amountCents')::numeric THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
    new_partition:=(piece->>'partitionId')::uuid;
    IF new_partition=(part->>'partitionId')::uuid THEN IF retained THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;retained:=true;
    ELSIF new_partition=ANY(all_ids) OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts historical WHERE historical.business_id=business AND historical.stable_partition_id=new_partition AND (allowed_operation IS NULL OR historical.operation_id<>allowed_operation)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';
    ELSE all_ids:=array_append(all_ids,new_partition);END IF;
    gross:=gross+(piece->>'grossInclusiveCents')::numeric;discount:=discount+(piece->>'discountInclusiveCents')::numeric;amount:=amount+(piece->>'amountCents')::numeric;
    IF piece->>'outcome'='completed' THEN fulfilled:=fulfilled+1;completed:=completed+(piece->>'amountCents')::numeric;ELSE unfulfilled:=unfulfilled+1;END IF;
    new_part:=jsonb_build_object('partitionId',new_partition,'jobId',job,'state',CASE WHEN piece->>'outcome'='completed' THEN 'completed' ELSE 'cancelled' END,'grossInclusiveCents',piece->'grossInclusiveCents','discountInclusiveCents',piece->'discountInclusiveCents','amountCents',piece->'amountCents','scopeDescription',piece->'scopeDescription');parts:=parts||jsonb_build_array(new_part);
    outcomes:=outcomes||jsonb_build_array(jsonb_build_object('assignedPartId',part->>'id','partitionId',new_partition,'outcome',piece->>'outcome','scopeDescription',piece->>'scopeDescription','completedCents',CASE WHEN piece->>'outcome'='completed' THEN piece->>'amountCents' ELSE '0' END,'reason',piece->'reason'));
   END LOOP;
   IF NOT retained OR gross<>(part->>'grossInclusiveCents')::numeric OR discount<>(part->>'discountInclusiveCents')::numeric OR amount<>(part->>'amountCents')::numeric THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  END LOOP;
  IF NOT changed THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
  new_plans:=new_plans||jsonb_build_array(jsonb_build_object('sourceAllocationId',plan->'sourceAllocationId','expectedPlanId',plan->'planId','expectedPlanSequence',plan->'planSequence','parts',parts));
 END LOOP;
 IF cardinality(used)<>jsonb_array_length(proposed) OR fulfilled=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('completionOutcome',CASE WHEN unfulfilled>0 THEN 'partial' ELSE 'full' END,'needsCommercialResolution',unfulfilled>0,'completedCents',completed::text,'fulfilledPortions',fulfilled,'unfulfilledPortions',unfulfilled,'plans',new_plans,'outcomes',outcomes);
END $plan$;
CREATE FUNCTION crest_private.plan_completed_scope(business uuid,job uuid,expected_version bigint,proposed jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $locked$
DECLARE j crest.jobs;family uuid;
BEGIN
 IF business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR nullif(current_setting('crest.actor_id',true),'') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRED';END IF;
 IF expected_version IS NULL OR expected_version<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||business::text,0));
 FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=business AND job_id=job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(business,family);END LOOP;
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;
 IF j.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 PERFORM crest_private.lock_booking_operator(business,j.operator_actor_id);
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job FOR UPDATE;
 IF j.version<>expected_version OR j.state NOT IN('in_progress','paused') OR j.first_work_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 RETURN crest_private.calculate_completed_scope(business,job,crest_private.load_completion_plans(business,job),proposed,NULL);
END $locked$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.load_completion_plans(uuid,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.load_completion_plans(uuid,uuid,uuid[]) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.plan_completed_scope(uuid,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.load_completion_plans(uuid,uuid),crest_private.plan_completed_scope(uuid,uuid,bigint,jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION crest_private.load_completion_plans(uuid,uuid,uuid[]),crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.load_completion_plans(uuid,uuid,uuid[]),crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid) TO crest_booking_integrity_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/work-completion-plan.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/work-completion-commands.sql
-- Unregistered Phase6 construction. Complete actual Mobile work atomically;
-- retain accepted prices, independent outreach evidence and pending finance.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.calculate_completed_scope(uuid,uuid,jsonb,jsonb,uuid)') IS NULL
  OR to_regclass('crest.work_scope_outcomes') IS NOT NULL
  OR EXISTS(SELECT 1 FROM (VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'c7f6b92b673a1f7441490b46ee29baefb58037f9405b451754d0e54d1c4e2564'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'1e7f0cbaf8248c12ce596f88bc108ba4cc63874f988e3307a93729cb34a5b800'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'fe965adc6fe02d42d1955daff19dfd7f1ddc3fe63406f655dd8d64c29086130a'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'0fe228bc9625b8e05710c773ec2e098d2dce6065b5c26ba995303344932df799'),
   ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'a6d6ebd7ffec5adcd07e18611fe1fc69f72c84cdc7a01e278c1688a620b03f76'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'c5c5fecccd1436b2be1597fa5310f8f58563239be4309a1a45abdc0e2c75f9af'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'e827568ac64b734a25441646237896745772b65843b2a42bf21eb58d5634ebad')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner') AND a.grantee<>r.oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_WRITE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.work_scope_outcomes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,
 assigned_part_id uuid NOT NULL,completion_part_id uuid NOT NULL,partition_id uuid NOT NULL,outcome text NOT NULL CHECK(outcome IN('completed','unfulfilled','cancelled')),
 scope_description text NOT NULL CHECK(char_length(scope_description)>=1 AND char_length(scope_description)<=2000 AND btrim(scope_description,E' \t\n\r')<>''),completed_cents bigint NOT NULL CHECK(completed_cents>=0),reason text,
 CHECK(outcome='completed' OR completed_cents=0 AND reason IS NOT NULL),UNIQUE(business_id,completion_part_id),UNIQUE(business_id,job_id,partition_id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),FOREIGN KEY(business_id,assigned_part_id) REFERENCES crest.allocation_plan_parts(business_id,id),FOREIGN KEY(business_id,completion_part_id) REFERENCES crest.allocation_plan_parts(business_id,id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.message_templates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),purpose text NOT NULL CHECK(purpose IN('review_request','mobile_arrival_eta')),sequence bigint NOT NULL CHECK(sequence>0),body_template text NOT NULL CHECK(char_length(body_template) BETWEEN 1 AND 10000),active boolean NOT NULL,reason text,
 UNIQUE(business_id,purpose,sequence),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.review_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,customer_id uuid NOT NULL,is_primary boolean NOT NULL DEFAULT true,message_id uuid,
 state text NOT NULL CHECK(state IN('prepared','pending','skipped')),suppression_reason text CHECK(suppression_reason IN('owner_skipped','outreach_opt_out','no_contact','missing_review_url','contact_review_required','duplicate_encounter','template_disabled')),reason text,additional_request_reason text,duplicate_count bigint NOT NULL CHECK(duplicate_count>=0),customer_version bigint NOT NULL CHECK(customer_version>0),
 CHECK((state='prepared')=(message_id IS NOT NULL)),CHECK(state='prepared' AND suppression_reason IS NULL OR state<>'prepared' AND suppression_reason IS NOT NULL),
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),UNIQUE(business_id,id,job_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE UNIQUE INDEX review_one_primary_per_job ON crest.review_requests(business_id,job_id,customer_id) WHERE is_primary;
CREATE TABLE crest.messages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,customer_id uuid NOT NULL,request_id uuid NOT NULL,template_version_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose='review_request'),state text NOT NULL CHECK(state='prepared'),channel text NOT NULL CHECK(channel IN('text','email')),recipient_snapshot jsonb NOT NULL CHECK(jsonb_typeof(recipient_snapshot)='object'),body_snapshot text NOT NULL CHECK(char_length(body_snapshot) BETWEEN 1 AND 10000),reason text,
 FOREIGN KEY(business_id,job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),FOREIGN KEY(business_id,request_id,job_id) REFERENCES crest.review_requests(business_id,id,job_id),FOREIGN KEY(business_id,template_version_id) REFERENCES crest.message_templates(business_id,id),UNIQUE(business_id,id,job_id),UNIQUE(business_id,request_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.review_requests ADD CONSTRAINT review_initial_message FOREIGN KEY(business_id,message_id,job_id) REFERENCES crest.messages(business_id,id,job_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE crest.message_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,message_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('prepared','opened','owner_confirmed_sent','failed','skipped')),effective_at timestamptz NOT NULL CHECK(isfinite(effective_at)),reason text,
 FOREIGN KEY(business_id,message_id,job_id) REFERENCES crest.messages(business_id,id,job_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.review_request_encounters(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,request_id uuid NOT NULL,job_encounter_id uuid NOT NULL,reason text,
 FOREIGN KEY(business_id,request_id,job_id) REFERENCES crest.review_requests(business_id,id,job_id),FOREIGN KEY(business_id,job_encounter_id) REFERENCES crest.job_encounters(business_id,id),UNIQUE(business_id,request_id,job_encounter_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.job_finalization_tasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),job_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('invoice_finalization','commercial_resolution')),state text NOT NULL DEFAULT 'open' CHECK(state='open'),reason text,
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),UNIQUE(business_id,job_id,kind),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),UNIQUE(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE FUNCTION crest_private.completion_projection(kind text,row_value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $projection$
BEGIN
 IF kind NOT IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks') THEN RAISE EXCEPTION 'CREST_COMPLETION_SOURCE_REQUIRED';END IF;
 row_value:=row_value||jsonb_build_object('created_at',to_char((row_value->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF kind='work_scope_outcomes' THEN row_value:=row_value||jsonb_build_object('completed_cents',row_value->>'completed_cents');END IF;
 IF kind='message_templates' THEN row_value:=row_value||jsonb_build_object('sequence',row_value->>'sequence');END IF;
 IF kind='review_requests' THEN row_value:=row_value||jsonb_build_object('customer_version',row_value->>'customer_version','duplicate_count',row_value->>'duplicate_count');END IF;
 IF kind='message_events' THEN row_value:=row_value||jsonb_build_object('effective_at',to_char((row_value->>'effective_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));END IF;RETURN row_value;
END $projection$;
CREATE FUNCTION crest_private.stamp_completion_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
BEGIN
 IF NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.created_by IS DISTINCT FROM nullif(current_setting('crest.actor_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM nullif(current_setting('crest.operation_id',true),'')::uuid OR NEW.origin<>'manual'
  OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND command_type='operations.job.complete' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_COMPLETION_CONTEXT_REQUIRED';END IF;NEW.created_at:=clock_timestamp();RETURN NEW;
END $stamp$;
CREATE FUNCTION crest_private.check_completion_source_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=NEW.id AND a.entity_version=1 AND a.action='create' AND a.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.completion_projection(TG_TABLE_NAME,to_jsonb(NEW))) AND a.origin='manual' AND a.import_row_id IS NULL AND o.command_type='operations.job.complete' AND o.schema_version=1 AND o.state='committed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_AUDIT_REQUIRED';END IF;RETURN NULL;
END $audit$;
DO $tables$ DECLARE name text;BEGIN
 FOREACH name IN ARRAY ARRAY['work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE crest.%I ADD CONSTRAINT completion_created_finite CHECK(isfinite(created_at))',name);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);EXECUTE format('GRANT SELECT ON crest.%I TO crest_booking_integrity_owner',name);EXECUTE format('GRANT USAGE ON TYPE crest.%I TO crest_booking_owner,crest_booking_integrity_owner',name);
  EXECUTE format('CREATE POLICY completion_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY completion_insert ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY completion_integrity ON crest.%I FOR SELECT TO crest_booking_integrity_owner USING(true)',name);
  EXECUTE format('CREATE TRIGGER completion_stamp BEFORE INSERT ON crest.%I FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_completion_source()',name);
  EXECUTE format('CREATE CONSTRAINT TRIGGER completion_audit AFTER INSERT ON crest.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_completion_source_audit()',name);
  EXECUTE format('CREATE TRIGGER completion_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source()',name);
  EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,operation_id,created_by)',name||'_operation',name);EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,created_by)',name||'_actor',name);EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,created_at,id)',name||'_timeline',name);
  IF name<>'message_templates' THEN EXECUTE format('CREATE INDEX %I ON crest.%I(business_id,job_id)',name||'_job',name);END IF;
 END LOOP;
END $tables$;
CREATE INDEX work_outcome_assigned ON crest.work_scope_outcomes(business_id,assigned_part_id);
CREATE INDEX review_customer ON crest.review_requests(business_id,customer_id);
CREATE INDEX messages_customer ON crest.messages(business_id,customer_id);
CREATE INDEX messages_template ON crest.messages(business_id,template_version_id);
CREATE INDEX message_event_parent ON crest.message_events(business_id,message_id);
CREATE INDEX review_encounter_parent ON crest.review_request_encounters(business_id,job_encounter_id);
GRANT UPDATE(completed_at,completion_outcome) ON crest.jobs TO crest_booking_owner;
CREATE POLICY completion_jobs_update ON crest.jobs FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='completed' AND first_work_at IS NOT NULL AND completed_at IS NOT NULL AND completion_outcome IS NOT NULL);
CREATE POLICY completion_operations_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.complete');
CREATE POLICY completion_operations_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.complete' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY completion_operations_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.complete') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.complete');
CREATE POLICY completion_integrity_operations ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.job.complete');
CREATE POLICY completion_audits_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND entity_kind IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'));
CREATE POLICY completion_audits_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL AND entity_kind IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'));
CREATE POLICY completion_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(entity_kind IN('work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'));
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.stamp_completion_source() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completion_source_audit() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.stamp_completion_source(),crest_private.check_completion_source_audit(),crest_private.completion_projection(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.completion_projection(text,jsonb) TO crest_booking_owner,crest_booking_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE INDEX review_message_parent ON crest.review_requests(business_id,message_id);
ALTER TABLE crest.review_requests ADD COLUMN recipient_snapshot jsonb NOT NULL CHECK(jsonb_typeof(recipient_snapshot)='object');
CREATE POLICY completion_integrity_all_audits ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id AND o.command_type='operations.job.complete'));
CREATE FUNCTION crest_private.valid_completion_body(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE w jsonb;r jsonb;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['scope','walkthrough','reason','review']<>'{}'::jsonb OR NOT body ?& ARRAY['scope','walkthrough','reason','review'] OR octet_length(body::text)>1048576 OR jsonb_typeof(body->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'scope')=0 OR NOT coalesce(body->'reason'='null'::jsonb OR crest_private.booking_text_required(body->'reason',1000),false) THEN RETURN false;END IF;
 w:=body->'walkthrough';r:=body->'review';
 IF jsonb_typeof(w) IS DISTINCT FROM 'object' OR w-ARRAY['state','reason']<>'{}'::jsonb OR NOT w ?& ARRAY['state','reason'] OR w->>'state' IS NULL OR w->>'state' NOT IN('done','unavailable') OR NOT coalesce(w->'reason'='null'::jsonb AND w->>'state'='done' OR crest_private.booking_text_required(w->'reason',1000),false) THEN RETURN false;END IF;
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['reviewUrl','skipReason','additionalRequestReason','expectedDuplicateRequestIds','expectedCustomerVersion','contactReviewReason']<>'{}'::jsonb OR NOT r ?& ARRAY['reviewUrl','skipReason','additionalRequestReason','expectedDuplicateRequestIds','expectedCustomerVersion','contactReviewReason'] OR jsonb_typeof(r->'expectedDuplicateRequestIds') IS DISTINCT FROM 'array' OR jsonb_typeof(r->'expectedCustomerVersion') IS DISTINCT FROM 'string' OR (r->>'expectedCustomerVersion')!~'^[1-9][0-9]{0,18}$' OR (r->>'expectedCustomerVersion')::numeric>9223372036854775807 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'expectedDuplicateRequestIds') value WHERE crest_private.booking_uuid(value) IS NOT TRUE) OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(r->'expectedDuplicateRequestIds'))<>jsonb_array_length(r->'expectedDuplicateRequestIds') THEN RETURN false;END IF;
 IF NOT coalesce(r->'skipReason'='null'::jsonb OR crest_private.booking_text_required(r->'skipReason',1000),false) OR NOT coalesce(r->'additionalRequestReason'='null'::jsonb OR crest_private.booking_text_required(r->'additionalRequestReason',1000),false) OR NOT coalesce(r->'contactReviewReason'='null'::jsonb OR crest_private.booking_text_required(r->'contactReviewReason',1000),false) THEN RETURN false;END IF;
 RETURN r->'reviewUrl'='null'::jsonb OR jsonb_typeof(r->'reviewUrl')='string' AND char_length(r->>'reviewUrl')<=2048;
END $body$;
CREATE FUNCTION crest_private.completion_review_details(business uuid,job uuid,review jsonb,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE j crest.jobs;c crest.customers;a crest.appointments;duplicates jsonb;observed jsonb;suppressed text;note text;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO c FROM crest.customers WHERE business_id=business AND id=j.customer_id;SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=j.current_appointment_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO duplicates FROM(SELECT DISTINCT r.id FROM crest.review_requests r JOIN crest.review_request_encounters b ON b.business_id=r.business_id AND b.request_id=r.id JOIN crest.job_encounters old_encounter ON old_encounter.business_id=b.business_id AND old_encounter.id=b.job_encounter_id JOIN crest.job_encounters encounter ON encounter.business_id=old_encounter.business_id AND encounter.encounter_id=old_encounter.encounter_id WHERE r.business_id=business AND r.customer_id=j.customer_id AND r.job_id<>job AND encounter.job_id=job AND r.operation_id<>operation) previous;
 SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO observed FROM jsonb_array_elements(review->'expectedDuplicateRequestIds') value;
 IF review->'skipReason'<>'null'::jsonb THEN suppressed:='owner_skipped';note:=review->>'skipReason';
 ELSIF c.outreach_opt_out THEN suppressed:='outreach_opt_out';note:='Customer outreach is opted out';
 ELSIF a.contact_snapshot->>'kind'='no_contact' THEN suppressed:='no_contact';note:=a.contact_snapshot->>'reason';
 ELSIF review->'reviewUrl'='null'::jsonb OR (review->>'reviewUrl')!~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' THEN suppressed:='missing_review_url';note:='A valid HTTPS review link is not configured';
 ELSIF review->>'expectedCustomerVersion' IS DISTINCT FROM c.version::text OR c.contact_preference IS NOT NULL AND review->'contactReviewReason'='null'::jsonb THEN suppressed:='contact_review_required';note:='Review current customer contact preferences';
 ELSIF duplicates<>'[]'::jsonb AND(observed IS DISTINCT FROM duplicates OR review->'additionalRequestReason'='null'::jsonb) THEN suppressed:='duplicate_encounter';note:='An encounter already has a review request; explicit additional-request review is required';END IF;
 RETURN jsonb_build_object('state',CASE WHEN suppressed IS NULL THEN 'prepared' WHEN suppressed IN('owner_skipped','outreach_opt_out') THEN 'skipped' ELSE 'pending' END,'suppressionReason',suppressed,'reason',note,'duplicateIds',duplicates,'customerVersion',c.version::text,'recipientSnapshot',a.contact_snapshot);
END $review$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.completion_review_details(uuid,uuid,jsonb,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.valid_completion_body(jsonb),crest_private.completion_review_details(uuid,uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_completion_body(jsonb),crest_private.completion_review_details(uuid,uuid,jsonb,uuid) TO crest_booking_owner,crest_booking_integrity_owner;
-- Deferred completion verification reuses the same pure input validators as
-- the command. The closed verifier receives execution; ordinary roles do not.
GRANT EXECUTE ON FUNCTION crest_private.booking_uuid(jsonb),crest_private.booking_text_required(jsonb,integer) TO crest_booking_integrity_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.check_completed_job_graph(business uuid,job uuid,operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;before_job jsonb;after_job jsonb;body jsonb;expected jsonb;entry jsonb;p crest.allocation_plan_versions;actual jsonb;old_ids uuid[];w crest.work_intervals;previous crest.work_intervals;r crest.review_requests;m crest.messages;t crest.message_templates;review jsonb;counted bigint;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 body:=e.evidence->'request'->'body';
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM operation OR e.id IS NULL OR e.operation_id<>operation OR (SELECT count(*) FROM crest.job_events WHERE business_id=business AND operation_id=operation)<>1 OR e.created_by<>j.updated_by OR e.from_state NOT IN('in_progress','paused') OR e.to_state<>'completed' OR j.state<>'completed' OR j.fulfillment_mode<>'mobile'
  OR before_job IS NULL OR e.from_state IS DISTINCT FROM before_job->>'state' OR after_job IS DISTINCT FROM crest_private.jobs_projection(j) OR (before_job->>'version')::bigint+1<>j.version
  OR before_job-ARRAY['state','version','completed_at','completion_outcome','updated_at','updated_by','operation_id'] IS DISTINCT FROM after_job-ARRAY['state','version','completed_at','completion_outcome','updated_at','updated_by','operation_id']
  OR j.first_work_at IS NULL OR j.completed_at<>e.effective_at OR e.effective_at>e.created_at OR e.reason IS DISTINCT FROM body->>'reason' OR crest_private.valid_completion_body(body) IS NOT TRUE
  OR e.evidence->'request' IS DISTINCT FROM jsonb_build_object('commandType','operations.job.complete','schemaVersion',1,'businessId',business,'actorId',j.updated_by,'recoveryEpoch',(SELECT recovery_epoch FROM crest_private.operations WHERE business_id=business AND operation_id=operation),'jobId',job,'expectedVersion',(j.version-1)::text,'body',body)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_JOB_GRAPH_REQUIRED';END IF;
 SELECT * INTO w FROM crest.work_intervals WHERE business_id=business AND id=(e.evidence->>'closedWorkIntervalId')::uuid;SELECT * INTO previous FROM crest.work_intervals WHERE business_id=business AND id=w.replaces_id;
 IF w.id IS NULL OR previous.id IS NULL OR w.job_id<>job OR w.operation_id<>operation OR w.change_kind<>'close' OR w.ended_at<>j.completed_at OR previous.ended_at IS NOT NULL OR w.kind IS DISTINCT FROM(CASE e.from_state WHEN 'paused' THEN 'pause' ELSE 'active' END)
  OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND job_id=job AND ended_at IS NULL) OR (SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_TIME_REQUIRED';END IF;
 SELECT array_agg(replaces_id ORDER BY source_allocation_id),count(*) INTO old_ids,counted FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation;
 IF counted=0 OR (SELECT count(DISTINCT source_allocation_id) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation)<>counted OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state='assigned') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
 expected:=crest_private.calculate_completed_scope(business,job,crest_private.load_completion_plans(business,job,old_ids),body->'scope',operation);
 IF expected IS DISTINCT FROM e.evidence->'scopePlan' OR expected->>'completionOutcome' IS DISTINCT FROM j.completion_outcome OR jsonb_array_length(expected->'plans')<>counted THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(expected->'plans') LOOP
  SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND source_allocation_id=(entry->>'sourceAllocationId')::uuid;
  SELECT jsonb_agg(jsonb_build_object('partitionId',stable_partition_id,'jobId',job_id,'state',allocation_state,'grossInclusiveCents',gross_inclusive_cents::text,'discountInclusiveCents',discount_inclusive_cents::text,'amountCents',amount_cents::text,'scopeDescription',scope_description) ORDER BY stable_partition_id) INTO actual FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id;
  IF p.replaces_id::text IS DISTINCT FROM entry->>'expectedPlanId' OR p.sequence<>(entry->>'expectedPlanSequence')::bigint+1 OR actual IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY value->>'partitionId') FROM jsonb_array_elements(entry->'parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
 END LOOP;
 IF (SELECT count(*) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(expected->'outcomes') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_OUTCOMES_REQUIRED';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(expected->'outcomes') LOOP
  IF NOT EXISTS(SELECT 1 FROM crest.work_scope_outcomes o JOIN crest.allocation_plan_parts part ON part.business_id=o.business_id AND part.id=o.completion_part_id JOIN crest.allocation_plan_versions plan ON plan.business_id=part.business_id AND plan.id=part.plan_id WHERE o.business_id=business AND o.operation_id=operation AND o.job_id=job AND o.assigned_part_id::text=entry->>'assignedPartId' AND o.partition_id::text=entry->>'partitionId' AND o.outcome=entry->>'outcome' AND o.completed_cents::text=entry->>'completedCents' AND o.scope_description=entry->>'scopeDescription' AND o.reason IS NOT DISTINCT FROM entry->>'reason' AND part.stable_partition_id=o.partition_id AND part.job_id=job AND plan.operation_id=operation AND part.operation_id=operation)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_OUTCOMES_REQUIRED';END IF;
 END LOOP;
 SELECT * INTO r FROM crest.review_requests WHERE business_id=business AND operation_id=operation AND job_id=job;
 review:=crest_private.completion_review_details(business,job,body->'review',operation);
 IF r.id IS NULL OR NOT r.is_primary OR (SELECT count(*) FROM crest.review_requests WHERE business_id=business AND operation_id=operation)<>1 OR r.customer_id<>j.customer_id OR r.customer_version::text IS DISTINCT FROM review->>'customerVersion' OR r.duplicate_count<>jsonb_array_length(review->'duplicateIds') OR r.recipient_snapshot IS DISTINCT FROM review->'recipientSnapshot' OR r.additional_request_reason IS DISTINCT FROM body->'review'->>'additionalRequestReason'
  OR EXISTS(SELECT 1 FROM crest.review_request_encounters b JOIN crest.job_encounters encounter ON encounter.business_id=b.business_id AND encounter.id=b.job_encounter_id WHERE b.business_id=business AND b.request_id=r.id AND(encounter.job_id<>job OR b.operation_id<>operation OR b.job_id<>job))
  OR (SELECT count(*) FROM crest.review_request_encounters WHERE business_id=business AND request_id=r.id)<>(SELECT count(*) FROM crest.job_encounters WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.review_request_encounters WHERE business_id=business AND operation_id=operation AND(request_id<>r.id OR job_id<>job))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 IF r.message_id IS NULL THEN
  IF review->>'state'='prepared' THEN SELECT * INTO t FROM crest.message_templates WHERE business_id=business AND purpose='review_request' ORDER BY sequence DESC LIMIT 1;IF t.id IS NOT NULL AND NOT t.active THEN review:=review||jsonb_build_object('state','pending','suppressionReason','template_disabled','reason','Review template is disabled');END IF;END IF;
  IF r.state IS DISTINCT FROM review->>'state' OR r.suppression_reason IS DISTINCT FROM review->>'suppressionReason' OR r.reason IS DISTINCT FROM review->>'reason' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_REVIEW_REQUIRED';END IF;
 ELSE
  SELECT * INTO m FROM crest.messages WHERE business_id=business AND id=r.message_id;SELECT * INTO t FROM crest.message_templates WHERE business_id=business AND id=m.template_version_id;
  IF review->>'state'<>'prepared' OR r.state<>'prepared' OR r.suppression_reason IS NOT NULL OR m.id IS NULL OR m.operation_id<>operation OR m.request_id<>r.id OR m.job_id<>job OR m.customer_id<>j.customer_id OR m.state<>'prepared' OR m.recipient_snapshot IS DISTINCT FROM review->'recipientSnapshot' OR m.channel IS DISTINCT FROM(CASE m.recipient_snapshot->>'kind' WHEN 'phone' THEN 'text' ELSE 'email' END)
   OR t.id IS NULL OR t.purpose<>'review_request' OR NOT t.active OR m.body_snapshot IS DISTINCT FROM replace(t.body_template,'{review_url}',body->'review'->>'reviewUrl')
   OR NOT EXISTS(SELECT 1 FROM crest.message_events WHERE business_id=business AND message_id=m.id AND job_id=job AND operation_id=operation AND kind='prepared' AND effective_at=j.completed_at)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_MESSAGE_REQUIRED';END IF;
 END IF;
 IF (SELECT count(*) FROM crest.messages WHERE business_id=business AND operation_id=operation)<>(CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END) OR (SELECT count(*) FROM crest.message_events WHERE business_id=business AND operation_id=operation)<>(CASE WHEN r.message_id IS NULL THEN 0 ELSE 1 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_MESSAGE_REQUIRED';END IF;
 IF (SELECT count(*) FROM crest.message_templates WHERE business_id=business AND operation_id=operation)>1 OR EXISTS(SELECT 1 FROM crest.message_templates WHERE business_id=business AND operation_id=operation AND(purpose<>'review_request' OR sequence<>1 OR NOT active OR body_template<>'Thank you for choosing Crest Detailing. We would appreciate an honest review: {review_url}' OR r.message_id IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_TEMPLATE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest.job_finalization_tasks WHERE business_id=business AND job_id=job AND operation_id=operation AND kind='invoice_finalization' AND state='open')
  OR (SELECT count(*) FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation)<>(CASE WHEN j.completion_outcome='partial' THEN 2 ELSE 1 END)
  OR (j.completion_outcome='partial') IS DISTINCT FROM EXISTS(SELECT 1 FROM crest.job_finalization_tasks WHERE business_id=business AND job_id=job AND operation_id=operation AND kind='commercial_resolution' AND state='open')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_FINALIZATION_REQUIRED';END IF;
END $graph$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completed_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_completed_job_graph(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_completed_job_graph(uuid,uuid,uuid) TO crest_booking_owner;

-- Exact measured predecessor branches; old booking/field paths stay intact.
DO $extend$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.field''','IF NOT coalesce(kind=''operations.job.complete'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME IN(''job_events'',''allocation_plan_versions'',''allocation_plan_parts'')) OR kind=''operations.job.field''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.field'' THEN',$branch$
 IF kind='operations.job.complete' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' THEN
   IF OLD.state NOT IN('in_progress','paused') OR NEW.state<>'completed' OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR NEW.completed_at IS NULL OR NEW.completed_at<OLD.first_work_at OR NEW.completion_outcome NOT IN('full','partial')
    OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','completed_at','completion_outcome'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','completed_at','completion_outcome'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_JOB_GRAPH_REQUIRED';END IF;
   NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME IN('job_events','allocation_plan_versions','allocation_plan_parts') AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_SOURCE_REQUIRED';END IF;
 END IF;
 IF kind='operations.job.field' THEN$branch$);
 updated:=replace(updated,'''quote.amendment.accept'',''operations.job.field'')','''quote.amendment.accept'',''operations.job.field'',''operations.job.complete'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type=''operations.job.field'' AND TG_TABLE_NAME IN(''jobs'',''job_events'')','(o.command_type=''operations.job.field'' AND TG_TABLE_NAME IN(''jobs'',''job_events'') OR o.command_type=''operations.job.complete'' AND TG_TABLE_NAME IN(''jobs'',''job_events'',''allocation_plan_versions'',''allocation_plan_parts''))');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.field'' THEN','IF kind=''operations.job.complete'' THEN PERFORM crest_private.check_completed_job_graph(business,job,source_operation);RETURN;END IF; IF kind=''operations.job.field'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.field'' THEN','IF kind=''operations.job.complete'' THEN PERFORM crest_private.check_completed_job_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF; IF kind=''operations.job.field'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'DECLARE p crest.allocation_plan_versions;','DECLARE completion_job uuid;p crest.allocation_plan_versions;');
 updated:=replace(updated,'kind NOT IN(''operations.job.book'',''operations.job.cancel'')','kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'')');
 updated:=replace(updated,'-- Existing assigned work stays intact when booking another visit;', $branch$
 IF kind='operations.job.complete' THEN
  SELECT job_id INTO completion_job FROM crest.job_events WHERE business_id=p.business_id AND operation_id=p.operation_id;
  IF completion_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_REQUIRED';END IF;
  PERFORM crest_private.check_completed_job_graph(p.business_id,completion_job,p.operation_id);RETURN NULL;
 END IF;
 -- Existing assigned work stays intact when booking another visit;$branch$);
 IF updated=definition OR position('DECLARE completion_job uuid;' IN updated)=0 THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 updated:=replace(definition,'''operations.travel.record'',''operations.time.correct'')','''operations.travel.record'',''operations.time.correct'',''operations.job.complete'')');
 updated:=replace(updated,'PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);', 'IF command=''operations.job.complete'' AND (TG_TABLE_NAME<>''work_intervals'' OR NEW.change_kind<>''close'') THEN RAISE EXCEPTION USING ERRCODE=''42501'',MESSAGE=''CREST_COMPLETION_TIME_REQUIRED'';END IF; PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_COMPLETION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.append_completion_audit(kind text,row_value jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE result uuid;
BEGIN
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES((row_value->>'business_id')::uuid,(row_value->>'operation_id')::uuid,(row_value->>'created_by')::uuid,(row_value->>'created_by')::uuid,kind,(row_value->>'id')::uuid,1,'create',row_value->>'reason',jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.completion_projection(kind,row_value)),'manual') RETURNING id INTO result;RETURN result;
END $audit$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
ALTER FUNCTION crest_private.append_completion_audit(text,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_private.append_completion_audit(text,jsonb) FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.completed_job_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;r jsonb;audits jsonb;saved_job jsonb;actual_ids jsonb;kind text;expected_count bigint;actual_count bigint;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.complete';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT delta->'after' INTO saved_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 r:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.complete','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'completedAt',saved_job->>'completed_at','completionOutcome',saved_job->>'completion_outcome','closedWorkIntervalId',e.evidence->'closedWorkIntervalId','allocationPlanIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation),'outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation),'reviewRequestId',(SELECT id FROM crest.review_requests WHERE business_id=business AND operation_id=operation),'messageId',(SELECT message_id FROM crest.review_requests WHERE business_id=business AND operation_id=operation),'finalizationTaskIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation),'auditIds',audits);
 IF e.id IS NULL OR r IS NULL OR saved_job IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM r OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to((e.evidence->'request')::text,'UTF8')),'hex')
  OR r->>'businessId' IS DISTINCT FROM business::text OR r->>'actorId' IS DISTINCT FROM actor::text OR r->>'operationId' IS DISTINCT FROM operation::text OR r->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR r->>'jobId' IS DISTINCT FROM e.job_id::text OR r->>'jobVersion' IS DISTINCT FROM e.sequence::text OR r->>'commandType' IS DISTINCT FROM 'operations.job.complete' OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->'auditIds' IS DISTINCT FROM audits
  OR saved_job->>'state'<>'completed' OR r->>'completedAt' IS DISTINCT FROM saved_job->>'completed_at' OR r->>'completionOutcome' IS DISTINCT FROM saved_job->>'completion_outcome'
  OR NOT EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=operation AND id=(r->>'closedWorkIntervalId')::uuid AND ended_at=e.effective_at AND change_kind='close')
  OR NOT EXISTS(SELECT 1 FROM crest.review_requests WHERE business_id=business AND operation_id=operation AND id=(r->>'reviewRequestId')::uuid AND job_id=e.job_id AND message_id IS NOT DISTINCT FROM(r->>'messageId')::uuid)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO actual_ids FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation;IF actual_ids IS DISTINCT FROM r->'allocationPlanIds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO actual_ids FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation;IF actual_ids IS DISTINCT FROM r->'outcomeIds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO actual_ids FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation;IF actual_ids IS DISTINCT FROM r->'finalizationTaskIds' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 -- Every audit is one real source row, including the two mutable/event parents.
 expected_count:=3;FOREACH kind IN ARRAY ARRAY['allocation_plan_versions','allocation_plan_parts','work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks'] LOOP EXECUTE format('SELECT count(*) FROM crest.%I WHERE business_id=$1 AND operation_id=$2',kind) INTO actual_count USING business,operation;expected_count:=expected_count+actual_count;END LOOP;
 IF jsonb_array_length(audits)<>expected_count OR EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind NOT IN('jobs','job_events','work_intervals','allocation_plan_versions','allocation_plan_parts','work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',r);
END $result$;
CREATE FUNCTION crest_private.check_completed_job_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $guard$
BEGIN IF crest_private.completed_job_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETION_RESULT_REQUIRED';END IF;RETURN NULL;END $guard$;
CREATE CONSTRAINT TRIGGER completed_job_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.job.complete') EXECUTE FUNCTION crest_private.check_completed_job_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.completed_job_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completed_job_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.completed_job_result(uuid,uuid,uuid),crest_private.check_completed_job_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.completed_job_result(uuid,uuid,uuid) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.complete_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $complete$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing crest_private.operations;j crest.jobs;before_job jsonb;old_work crest.work_intervals;closed_work crest.work_intervals;scope_plan jsonb;plan_entry jsonb;piece jsonb;outcome jsonb;prior_plan crest.allocation_plan_versions;new_plan crest.allocation_plan_versions;part crest.allocation_plan_parts;scope_row crest.work_scope_outcomes;review_row crest.review_requests;template crest.message_templates;message crest.messages;message_event crest.message_events;binding crest.review_request_encounters;encounter crest.job_encounters;task crest.job_finalization_tasks;c crest.customers;event crest.job_events;review jsonb;stamp timestamptz;review_id uuid:=gen_random_uuid();message_id uuid;audits jsonb;receipt jsonb;result jsonb;reason text;family uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_version IS NULL OR expected_version<1 OR crest_private.valid_completion_body(body) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.complete','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',expected_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.complete',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.complete' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;result:=crest_private.completed_job_result(requested_business,expected_actor,requested_operation);
  ELSE
   -- The planner takes the canonical mode/family/operator locks and checks the
   -- actual source/version. Invalid scope never changes the terminal state.
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF j.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,j.operator_actor_id);
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='version';END IF;
   IF j.state NOT IN('in_progress','paused') OR j.fulfillment_mode<>'mobile' THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='state';END IF;
   scope_plan:=crest_private.plan_completed_scope(requested_business,requested_job,expected_version,body->'scope');
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1901',MESSAGE='version';END IF;
   SELECT * INTO c FROM crest.customers WHERE business_id=requested_business AND id=j.customer_id FOR SHARE;
   stamp:=clock_timestamp();before_job:=crest_private.jobs_projection(j);
   SELECT * INTO old_work FROM crest.current_work_intervals WHERE business_id=requested_business AND job_id=requested_job AND ended_at IS NULL;
   IF old_work.id IS NULL OR old_work.kind IS DISTINCT FROM(CASE j.state WHEN 'paused' THEN 'pause' ELSE 'active' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_TIME_REQUIRED';END IF;
   INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,started_at,ended_at,pause_reason,change_kind,created_by,operation_id) VALUES(requested_business,old_work.logical_id,old_work.sequence+1,old_work.id,j.id,j.operator_actor_id,old_work.kind,old_work.started_at,stamp,old_work.pause_reason,'close',expected_actor,requested_operation) RETURNING * INTO closed_work;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',closed_work.logical_id,closed_work.sequence,'close',jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(old_work),'after',crest_private.field_work_projection(closed_work)),'manual');
   UPDATE crest.jobs SET state='completed',completed_at=stamp,completion_outcome=scope_plan->>'completionOutcome',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',before_job,crest_private.jobs_projection(j));
   FOR plan_entry IN SELECT value FROM jsonb_array_elements(scope_plan->'plans') LOOP
    SELECT * INTO prior_plan FROM crest.allocation_plan_versions WHERE business_id=requested_business AND id=(plan_entry->>'expectedPlanId')::uuid;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,prior_plan.source_allocation_id,prior_plan.sequence+1,prior_plan.id,coalesce(body->>'reason','Recorded work completion'),expected_actor,requested_operation,prior_plan.entitlement_version_id,prior_plan.authorization_state) RETURNING * INTO new_plan;
    PERFORM crest_private.append_booking_audit('allocation_plan_versions',new_plan.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(new_plan));
    FOR piece IN SELECT value FROM jsonb_array_elements(plan_entry->'parts') LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,new_plan.id,(piece->>'partitionId')::uuid,(piece->>'jobId')::uuid,piece->>'state',(piece->>'grossInclusiveCents')::bigint,(piece->>'discountInclusiveCents')::bigint,(piece->>'amountCents')::bigint,piece->>'scopeDescription',expected_actor,requested_operation) RETURNING * INTO part;
     PERFORM crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part));
     IF part.job_id=j.id THEN
      SELECT value INTO outcome FROM jsonb_array_elements(scope_plan->'outcomes') value WHERE value->>'partitionId'=part.stable_partition_id::text;
      IF outcome IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_OUTCOMES_REQUIRED';END IF;
      INSERT INTO crest.work_scope_outcomes(business_id,job_id,assigned_part_id,completion_part_id,partition_id,outcome,scope_description,completed_cents,reason,created_by,operation_id) VALUES(requested_business,j.id,(outcome->>'assignedPartId')::uuid,part.id,part.stable_partition_id,outcome->>'outcome',outcome->>'scopeDescription',(outcome->>'completedCents')::bigint,outcome->>'reason',expected_actor,requested_operation) RETURNING * INTO scope_row;
      PERFORM crest_private.append_completion_audit('work_scope_outcomes',to_jsonb(scope_row));
     END IF;
    END LOOP;
   END LOOP;
   review:=crest_private.completion_review_details(requested_business,j.id,body->'review',requested_operation);
   IF review->>'state'='prepared' THEN
    SELECT * INTO template FROM crest.message_templates WHERE business_id=requested_business AND purpose='review_request' ORDER BY sequence DESC LIMIT 1;
    IF template.id IS NULL THEN
     INSERT INTO crest.message_templates(business_id,purpose,sequence,body_template,active,created_by,operation_id) VALUES(requested_business,'review_request',1,'Thank you for choosing Crest Detailing. We would appreciate an honest review: {review_url}',true,expected_actor,requested_operation) RETURNING * INTO template;PERFORM crest_private.append_completion_audit('message_templates',to_jsonb(template));
    END IF;
    IF NOT template.active THEN review:=review||jsonb_build_object('state','pending','suppressionReason','template_disabled','reason','Review template is disabled');ELSE message_id:=gen_random_uuid();END IF;
   END IF;
   INSERT INTO crest.review_requests(id,business_id,job_id,customer_id,is_primary,message_id,state,suppression_reason,reason,additional_request_reason,duplicate_count,customer_version,recipient_snapshot,created_by,operation_id) VALUES(review_id,requested_business,j.id,j.customer_id,true,message_id,review->>'state',review->>'suppressionReason',review->>'reason',body->'review'->>'additionalRequestReason',jsonb_array_length(review->'duplicateIds'),c.version,review->'recipientSnapshot',expected_actor,requested_operation) RETURNING * INTO review_row;
   PERFORM crest_private.append_completion_audit('review_requests',to_jsonb(review_row));
   FOR encounter IN SELECT * FROM crest.job_encounters WHERE business_id=requested_business AND job_id=j.id ORDER BY id LOOP
    INSERT INTO crest.review_request_encounters(business_id,job_id,request_id,job_encounter_id,created_by,operation_id) VALUES(requested_business,j.id,review_row.id,encounter.id,expected_actor,requested_operation) RETURNING * INTO binding;PERFORM crest_private.append_completion_audit('review_request_encounters',to_jsonb(binding));
   END LOOP;
   IF message_id IS NOT NULL THEN
    INSERT INTO crest.messages(id,business_id,job_id,customer_id,request_id,template_version_id,purpose,state,channel,recipient_snapshot,body_snapshot,created_by,operation_id) VALUES(message_id,requested_business,j.id,j.customer_id,review_row.id,template.id,'review_request','prepared',CASE review_row.recipient_snapshot->>'kind' WHEN 'phone' THEN 'text' ELSE 'email' END,review_row.recipient_snapshot,replace(template.body_template,'{review_url}',body->'review'->>'reviewUrl'),expected_actor,requested_operation) RETURNING * INTO message;PERFORM crest_private.append_completion_audit('messages',to_jsonb(message));
    INSERT INTO crest.message_events(business_id,job_id,message_id,kind,effective_at,created_by,operation_id) VALUES(requested_business,j.id,message.id,'prepared',stamp,expected_actor,requested_operation) RETURNING * INTO message_event;PERFORM crest_private.append_completion_audit('message_events',to_jsonb(message_event));
   END IF;
   INSERT INTO crest.job_finalization_tasks(business_id,job_id,kind,reason,created_by,operation_id) VALUES(requested_business,j.id,'invoice_finalization','Review fulfilled accepted scope, tax and issuance before billing',expected_actor,requested_operation) RETURNING * INTO task;PERFORM crest_private.append_completion_audit('job_finalization_tasks',to_jsonb(task));
   IF j.completion_outcome='partial' THEN INSERT INTO crest.job_finalization_tasks(business_id,job_id,kind,reason,created_by,operation_id) VALUES(requested_business,j.id,'commercial_resolution','Partial work does not change accepted customer obligations',expected_actor,requested_operation) RETURNING * INTO task;PERFORM crest_private.append_completion_audit('job_finalization_tasks',to_jsonb(task));END IF;
   -- Reserve the event ID before constructing its immutable result; its audit
   -- joins the same transaction, never a post-commit success repair.
   event.id:=gen_random_uuid();
   INSERT INTO crest.job_events(id,business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(event.id,requested_business,j.id,j.version,before_job->>'state','completed',stamp,body->>'reason',jsonb_build_object('schemaVersion',1,'action','complete','request',request,'scopePlan',scope_plan,'closedWorkIntervalId',closed_work.id,'reviewDetails',review,'photoEvidenceStatus','not_integrated'),expected_actor,requested_operation) RETURNING * INTO event;
   -- Evidence/result must be frozen on INSERT. Compute the complete receipt
   -- from actual rows, then include it in the pending operation; the getter
   -- reconstructs it independently from immutable source, not event rewriting.
   PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.complete','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'completedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'completionOutcome',j.completion_outcome,'closedWorkIntervalId',closed_work.id,'allocationPlanIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.allocation_plan_versions WHERE business_id=requested_business AND operation_id=requested_operation),'outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=requested_business AND operation_id=requested_operation),'reviewRequestId',review_row.id,'messageId',message_id,'finalizationTaskIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.job_finalization_tasks WHERE business_id=requested_business AND operation_id=requested_operation),'auditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_private.check_completed_job_graph(requested_business,j.id,requested_operation);result:=crest_private.completed_job_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1901' THEN GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',reason);
 END;
END $complete$;
CREATE FUNCTION crest_commands.lookup_completed_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_COMPLETION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.completed_job_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_completed_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_completed_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_completed_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/work-completion-commands.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/field-scope-floor.sql
-- Unregistered Phase6 construction. Preserve actual fulfilled portions through
-- later commercial/booking plans. This authorizes no financial consumption.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.completed_job_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_private.check_completed_scope_floor(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.amendment_accept_result(uuid,uuid,uuid)','crest_quote_owner',true,'367adbfce356da6671c1bb328a5089c09ada5a54d5c0023a14314b999dfc7758'),
   ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'14a6c72922999a32e5e2cd398f54ebdca27469c0a5e66e3e6761e32ecb1b43d1'),
   ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'bb24d3913d30194af74cd4ab53ef4c40d849a66a8c9270d1339a14bbce49a83e'),
   ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'679c95e0e89ac8418b36a61981c0f0a3f829888db0eef684823554fd463f3005'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'1c55cdf246af977128c774b5e68341cae6b181ca97466797c132a8c3af254fa7'),
   ('crest_private.check_quote_amendment_accept_operation()','crest_booking_integrity_owner',true,'7276908984cef333f476fd4cdd9fa7929d2bf18d2cf81ba62aa1258856bc7bd5'),
   ('crest_private.check_amendment_allocation_binding()','crest_booking_integrity_owner',true,'c5662c263dfd81142b52a2dfb18e5788f0e066ada9eb36e7e963bbc9deceff5b')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_quote_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_quote_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_quote_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole,'crest_quote_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_quote_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM(VALUES('work_intervals'),('travel_legs'),('operator_occupancy'),('work_scope_outcomes'),('message_templates'),('review_requests'),('messages'),('message_events'),('review_request_encounters'),('job_finalization_tasks')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass('crest.'||e.name) WHERE c.oid IS NULL OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '7d59758a46a631d2ddb9db8df7825aeb77745ba121655b85b4acb87b2748d56b'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_SCOPE_FLOOR_SOURCE_REQUIRED';END IF;
END $review$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.check_completed_scope_floor(business uuid,source_id uuid,target_plan uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $floor$
DECLARE target crest.allocation_plan_versions;
BEGIN
 SELECT * INTO target FROM crest.allocation_plan_versions WHERE business_id=business AND id=target_plan AND source_allocation_id=source_id;
 IF target.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_FLOOR_REQUIRED';END IF;
 -- A completed portion must originate in actual typed completion evidence,
 -- not a copied price, a customer acceptance or a plan's self-asserted state.
 IF EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts part WHERE part.business_id=business AND part.plan_id=target.id AND part.allocation_state='completed' AND NOT EXISTS(
   SELECT 1 FROM crest.work_scope_outcomes outcome
   JOIN crest.allocation_plan_parts original ON original.business_id=outcome.business_id AND original.id=outcome.completion_part_id
   JOIN crest.allocation_plan_versions plan ON plan.business_id=original.business_id AND plan.id=original.plan_id
   JOIN crest_private.operations operation ON operation.business_id=outcome.business_id AND operation.operation_id=outcome.operation_id AND operation.actor_id=outcome.created_by
   WHERE outcome.business_id=business AND outcome.outcome='completed' AND plan.source_allocation_id=source_id AND plan.sequence<=target.sequence
    AND original.allocation_state='completed' AND original.operation_id=outcome.operation_id AND plan.operation_id=outcome.operation_id
    AND original.job_id=outcome.job_id AND original.stable_partition_id=outcome.partition_id AND original.scope_description=outcome.scope_description AND original.amount_cents=outcome.completed_cents
    AND operation.command_type='operations.job.complete' AND operation.state='committed'
    AND ROW(part.stable_partition_id,part.job_id,part.gross_inclusive_cents,part.discount_inclusive_cents,part.amount_cents,part.scope_description)
     IS NOT DISTINCT FROM ROW(original.stable_partition_id,original.job_id,original.gross_inclusive_cents,original.discount_inclusive_cents,original.amount_cents,original.scope_description)
  )
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_FLOOR_REQUIRED';END IF;
 -- Every fulfilled portion in this immutable plan prefix remains present and
 -- exact, including zero-price identity. Later completions must not invalidate
 -- an older plan/original receipt, so never compare with the latest plan here.
 IF EXISTS(
  SELECT 1 FROM crest.work_scope_outcomes outcome
  JOIN crest.allocation_plan_parts original ON original.business_id=outcome.business_id AND original.id=outcome.completion_part_id
  JOIN crest.allocation_plan_versions plan ON plan.business_id=original.business_id AND plan.id=original.plan_id
  WHERE outcome.business_id=business AND outcome.outcome='completed' AND plan.source_allocation_id=source_id AND plan.sequence<=target.sequence AND NOT EXISTS(
   SELECT 1 FROM crest.allocation_plan_parts part WHERE part.business_id=business AND part.plan_id=target.id AND part.allocation_state='completed'
    AND ROW(part.stable_partition_id,part.job_id,part.gross_inclusive_cents,part.discount_inclusive_cents,part.amount_cents,part.scope_description)
     IS NOT DISTINCT FROM ROW(original.stable_partition_id,original.job_id,original.gross_inclusive_cents,original.discount_inclusive_cents,original.amount_cents,original.scope_description)
  )
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_COMPLETED_SCOPE_FLOOR_REQUIRED';END IF;
END $floor$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_completed_scope_floor(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_completed_scope_floor(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_completed_scope_floor(uuid,uuid,uuid) TO crest_quote_owner;

DO $extend$ DECLARE signature regprocedure;definition text;updated text;BEGIN
 -- This deliberately fixed field-only profile still refuses every unknown
 -- future table/column, including finance ledgers not yet integrated. It does
 -- not loosen the independent source/export profiles, which remain closed.
 FOREACH signature IN ARRAY ARRAY[
  'crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)'::regprocedure,
  'crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure,
  'crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(signature);
  updated:=replace(definition,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','7d59758a46a631d2ddb9db8df7825aeb77745ba121655b85b4acb87b2748d56b');
  IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 END LOOP;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;',
  'PERFORM crest_private.check_completed_scope_floor(p.business_id,p.source_allocation_id,p.id); SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.amendment_accept_result(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'  IF (SELECT count(*) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=plan_row.id)',
  '  PERFORM crest_private.check_completed_scope_floor(business,source.id,plan_row.id); IF (SELECT count(*) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=plan_row.id)');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_quote_amendment_accept_operation()'::regprocedure);
 updated:=replace(definition,'DECLARE original jsonb;','DECLARE field_original jsonb;original jsonb;');
 updated:=replace(updated,'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'')',
  'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'')');
 updated:=replace(updated,'ELSIF retained_job.state=''cancelled'' THEN',$branch$
  ELSIF retained_job.state IN('en_route','in_progress','paused','completed') THEN
   IF retained_job.fulfillment_mode<>'mobile' OR retained_appointment.confirmation_state<>'confirmed'
    OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations reservation WHERE reservation.business_id=NEW.business_id AND reservation.job_id=retained_job.id AND reservation.appointment_id=retained_appointment.id AND reservation.operator_actor_id=retained_job.operator_actor_id AND reservation.blocked_interval=tstzrange(retained_appointment.start_at-coalesce(retained_appointment.travel_before_seconds,0)*interval '1 second',retained_appointment.end_at+coalesce(retained_appointment.travel_after_seconds,0)*interval '1 second','[)'))
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_SLOT_REQUIRED';END IF;
   IF retained_job.state='completed' THEN
    field_original:=crest_private.completed_job_result(NEW.business_id,retained_job.updated_by,retained_job.operation_id);
    IF retained_job.first_work_at IS NULL OR retained_job.completed_at IS NULL OR retained_job.completion_outcome NOT IN('full','partial')
     OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state='completed')
     OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state NOT IN('completed','cancelled'))
     OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=NEW.business_id AND job_id=retained_job.id AND ended_at IS NULL)
    THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_COMPLETION_REQUIRED';END IF;
   ELSE
    field_original:=crest_private.field_session_result(NEW.business_id,retained_job.updated_by,retained_job.operation_id);
    IF NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state='assigned')
     OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state<>'assigned')
    THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_FIELD_REQUIRED';END IF;
   END IF;
   IF field_original->>'state' IS DISTINCT FROM 'committed' OR field_original->'receipt'->>'jobId' IS DISTINCT FROM retained_job.id::text OR field_original->'receipt'->>'jobVersion' IS DISTINCT FROM retained_job.version::text
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_FIELD_REQUIRED';END IF;
  ELSIF retained_job.state='cancelled' THEN$branch$);
 IF updated=definition OR position('DECLARE field_original jsonb;' IN updated)=0 OR position('CREST_AMENDMENT_RETAINED_COMPLETION_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_amendment_allocation_binding()'::regprocedure);
 updated:=replace(definition,'o.command_type=''quote.amendment.accept'' AND o.schema_version=1 OR',$branch$
  o.command_type='quote.amendment.accept' AND o.schema_version=1 OR
  NEW.authorization_state='active' AND o.command_type='operations.job.complete' AND o.schema_version=1
   AND EXISTS(SELECT 1 FROM crest.allocation_plan_versions prior WHERE prior.business_id=NEW.business_id AND prior.id=NEW.replaces_id AND prior.source_allocation_id=NEW.source_allocation_id AND prior.entitlement_version_id=NEW.entitlement_version_id AND prior.authorization_state=NEW.authorization_state)
  OR$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_SCOPE_FLOOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/field-scope-floor.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/mileage-evidence.sql
-- Unregistered BR09/DATABASE §1 construction. Actual/estimated mileage and
-- explicit job attribution over real immutable trips; never financial posting.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.completed_job_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_private.check_completed_scope_floor(uuid,uuid,uuid)') IS NULL
  OR to_regclass('crest.mileage_evidence') IS NOT NULL
  OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>53
  OR EXISTS(SELECT 1 FROM(VALUES('travel_legs'),('jobs'),('memberships')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass('crest.'||e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MILEAGE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.mileage_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),leg_id uuid NOT NULL,leg_version_id uuid NOT NULL,operator_actor_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),replaces_id uuid,source text NOT NULL CHECK(source IN('odometer','manual_actual','route_estimate')),
 movement_kind text NOT NULL CHECK(movement_kind IN('business_rig','customer_vehicle','personal','unclassified')),
 actual_miles numeric(14,4) CHECK(actual_miles>=0),estimate_miles numeric(14,4) CHECK(estimate_miles>=0),estimate_source text,
 odometer_start numeric(14,4) CHECK(odometer_start>=0),odometer_end numeric(14,4) CHECK(odometer_end>=odometer_start),
 allocation_state text NOT NULL CHECK(allocation_state IN('unallocated','draft','allocated')),notes text,reason text,
 confirmed_at timestamptz CHECK(isfinite(confirmed_at)),confirmed_by uuid,
 CHECK((actual_miles IS NULL)=(confirmed_at IS NULL) AND(actual_miles IS NULL)=(confirmed_by IS NULL)),
 CHECK((estimate_miles IS NULL)=(estimate_source IS NULL)),CHECK((odometer_start IS NULL)=(odometer_end IS NULL)),
 CHECK(source='route_estimate' AND actual_miles IS NULL AND estimate_miles IS NOT NULL AND odometer_start IS NULL OR source='manual_actual' AND actual_miles IS NOT NULL OR source='odometer' AND actual_miles IS NOT NULL AND odometer_start IS NOT NULL AND actual_miles=odometer_end-odometer_start),
 CHECK(sequence=1 AND replaces_id IS NULL OR sequence>1 AND replaces_id IS NOT NULL AND reason IS NOT NULL),
 CHECK(notes IS NULL OR char_length(notes)<=2000),CHECK(reason IS NULL OR char_length(reason)>=1 AND char_length(reason)<=1000 AND btrim(reason,E' \t\n\r')<>''),CHECK(estimate_source IS NULL OR char_length(estimate_source)>=1 AND char_length(estimate_source)<=1000 AND btrim(estimate_source,E' \t\n\r')<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,id,leg_id),UNIQUE(business_id,leg_id,sequence),UNIQUE(business_id,replaces_id),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,leg_version_id,leg_id,operator_actor_id) REFERENCES crest.travel_legs(business_id,id,logical_id,operator_actor_id),
 FOREIGN KEY(business_id,replaces_id,leg_id) REFERENCES crest.mileage_evidence(business_id,id,leg_id),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,confirmed_by) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.leg_job_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id),evidence_id uuid NOT NULL,leg_id uuid NOT NULL,job_id uuid NOT NULL,
 fraction numeric(12,8) NOT NULL CHECK(fraction>=0 AND fraction<=1),reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),created_by uuid NOT NULL,operation_id uuid NOT NULL,origin text NOT NULL DEFAULT 'manual' CHECK(origin='manual'),
 UNIQUE(business_id,id),UNIQUE(business_id,evidence_id,job_id),FOREIGN KEY(business_id,evidence_id,leg_id) REFERENCES crest.mileage_evidence(business_id,id,leg_id),FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX mileage_leg_version_parent ON crest.mileage_evidence(business_id,leg_version_id);
CREATE INDEX mileage_operator_parent ON crest.mileage_evidence(business_id,operator_actor_id);
CREATE INDEX mileage_actor_parent ON crest.mileage_evidence(business_id,created_by);
CREATE INDEX mileage_confirmed_actor_parent ON crest.mileage_evidence(business_id,confirmed_by);
CREATE INDEX mileage_job_parent ON crest.leg_job_allocations(business_id,job_id);
CREATE INDEX mileage_allocation_operation ON crest.leg_job_allocations(business_id,operation_id);
CREATE INDEX mileage_allocation_actor ON crest.leg_job_allocations(business_id,created_by);
CREATE VIEW crest.current_mileage_evidence WITH(security_invoker=true,security_barrier=true) AS
 SELECT e.*,CASE WHEN l.id IS DISTINCT FROM e.leg_version_id THEN 'needs_review' WHEN e.actual_miles IS NOT NULL THEN 'confirmed_actual' ELSE 'estimated' END AS distance_status
 FROM crest.mileage_evidence e JOIN crest.current_travel_legs l ON l.business_id=e.business_id AND l.logical_id=e.leg_id
 WHERE NOT EXISTS(SELECT 1 FROM crest.mileage_evidence later WHERE later.business_id=e.business_id AND later.replaces_id=e.id);
DO $tables$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['mileage_evidence','leg_job_allocations'] LOOP
 EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
 EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);EXECUTE format('GRANT SELECT ON crest.%I TO crest_booking_integrity_owner',name);
 EXECUTE format('CREATE POLICY mileage_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
 EXECUTE format('CREATE POLICY mileage_create ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid AND origin=''manual'')',name);
 EXECUTE format('CREATE POLICY mileage_integrity_read ON crest.%I FOR SELECT TO crest_booking_integrity_owner USING(true)',name);
 EXECUTE format('CREATE TRIGGER mileage_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source()',name);
END LOOP;END $tables$;
GRANT USAGE ON TYPE crest.mileage_evidence,crest.leg_job_allocations TO crest_booking_owner,crest_booking_integrity_owner;
GRANT SELECT ON crest.current_mileage_evidence TO crest_booking_owner,crest_booking_integrity_owner;
CREATE POLICY mileage_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mileage.record');
CREATE POLICY mileage_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.mileage.record' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mileage_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mileage.record') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mileage.record' AND schema_version=1);
CREATE POLICY mileage_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.mileage.record');
CREATE POLICY mileage_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND entity_kind IN('mileage_evidence','leg_job_allocations'));
CREATE POLICY mileage_audit_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('mileage_evidence','leg_job_allocations') AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mileage_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner USING(entity_kind IN('mileage_evidence','leg_job_allocations'));
CREATE UNIQUE INDEX mileage_source_audit ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN('mileage_evidence','leg_job_allocations');

CREATE FUNCTION crest_private.valid_mileage_body(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $body$
DECLARE key text;part jsonb;total numeric:=0;previous text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['source','movementKind','actualMiles','estimateMiles','estimateSource','odometerStart','odometerEnd','notes','reason','allocationState','allocations']<>'{}'::jsonb OR NOT body ?& ARRAY['source','movementKind','actualMiles','estimateMiles','estimateSource','odometerStart','odometerEnd','notes','reason','allocationState','allocations'] OR octet_length(body::text)>1048576
  OR body->>'source' IS NULL OR body->>'source' NOT IN('odometer','manual_actual','route_estimate') OR body->>'movementKind' IS NULL OR body->>'movementKind' NOT IN('business_rig','customer_vehicle','personal','unclassified') OR body->>'allocationState' IS NULL OR body->>'allocationState' NOT IN('unallocated','draft','allocated') OR jsonb_typeof(body->'allocations') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocations')>1000 THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['actualMiles','estimateMiles','odometerStart','odometerEnd'] LOOP IF body->key<>'null'::jsonb AND(jsonb_typeof(body->key) IS DISTINCT FROM 'string' OR(body->>key)!~'^(0|[1-9][0-9]{0,9})\.[0-9]{4}$') THEN RETURN false;END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['estimateSource','notes','reason'] LOOP IF body->key<>'null'::jsonb AND(jsonb_typeof(body->key) IS DISTINCT FROM 'string' OR char_length(body->>key) NOT BETWEEN 1 AND CASE key WHEN 'notes' THEN 2000 ELSE 1000 END OR btrim(body->>key,E' \t\n\r')='' OR translate(body->>key,E'\t\n\r','')~'[[:cntrl:]]') THEN RETURN false;END IF;END LOOP;
 IF(body->'estimateMiles'='null'::jsonb) IS DISTINCT FROM(body->'estimateSource'='null'::jsonb) OR(body->'odometerStart'='null'::jsonb) IS DISTINCT FROM(body->'odometerEnd'='null'::jsonb) OR(body->>'odometerEnd')::numeric<(body->>'odometerStart')::numeric THEN RETURN false;END IF;
 IF body->>'source'='odometer' THEN IF body->'odometerStart'='null'::jsonb OR body->'actualMiles'='null'::jsonb OR(body->>'actualMiles')::numeric IS DISTINCT FROM(body->>'odometerEnd')::numeric-(body->>'odometerStart')::numeric THEN RETURN false;END IF;
 ELSIF body->>'source'='manual_actual' THEN IF body->'actualMiles'='null'::jsonb THEN RETURN false;END IF;
 ELSE IF body->'actualMiles'<>'null'::jsonb OR body->'estimateMiles'='null'::jsonb OR body->'odometerStart'<>'null'::jsonb THEN RETURN false;END IF;END IF;
 FOR part IN SELECT value FROM jsonb_array_elements(body->'allocations') LOOP
  IF jsonb_typeof(part) IS DISTINCT FROM 'object' OR part-ARRAY['jobId','fraction']<>'{}'::jsonb OR NOT part ?& ARRAY['jobId','fraction'] OR crest_private.booking_uuid(part->'jobId') IS NOT TRUE OR jsonb_typeof(part->'fraction') IS DISTINCT FROM 'string' OR(part->>'fraction')!~'^[01]\.[0-9]{8}$' OR(part->>'fraction')::numeric>1 OR previous IS NOT NULL AND previous>=part->>'jobId' THEN RETURN false;END IF;
  total:=total+(part->>'fraction')::numeric;previous:=part->>'jobId';
 END LOOP;
 RETURN total<=1 AND CASE body->>'allocationState' WHEN 'unallocated' THEN jsonb_array_length(body->'allocations')=0 WHEN 'draft' THEN jsonb_array_length(body->'allocations')>0 ELSE jsonb_array_length(body->'allocations')>0 AND total=1 END;
END $body$;
CREATE FUNCTION crest_private.mileage_projection(kind text,row_value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $projection$
DECLARE key text;
BEGIN
 IF kind NOT IN('mileage_evidence','leg_job_allocations') THEN RAISE EXCEPTION 'CREST_MILEAGE_SOURCE_REQUIRED';END IF;
 row_value:=row_value||jsonb_build_object('created_at',to_char((row_value->>'created_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 IF kind='mileage_evidence' THEN
  FOREACH key IN ARRAY ARRAY['sequence','actual_miles','estimate_miles','odometer_start','odometer_end'] LOOP row_value:=row_value||jsonb_build_object(key,row_value->>key);END LOOP;
  row_value:=row_value||jsonb_build_object('confirmed_at',CASE WHEN row_value->>'confirmed_at' IS NULL THEN NULL ELSE to_char((row_value->>'confirmed_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
 ELSE row_value:=row_value||jsonb_build_object('fraction',row_value->>'fraction');END IF;RETURN row_value;
END $projection$;
CREATE FUNCTION crest_private.mileage_body(e crest.mileage_evidence) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $body$
 SELECT jsonb_build_object('source',e.source,'movementKind',e.movement_kind,'actualMiles',e.actual_miles::text,'estimateMiles',e.estimate_miles::text,'estimateSource',e.estimate_source,'odometerStart',e.odometer_start::text,'odometerEnd',e.odometer_end::text,'notes',e.notes,'reason',e.reason,'allocationState',e.allocation_state,'allocations',(SELECT coalesce(jsonb_agg(jsonb_build_object('jobId',job_id,'fraction',fraction::text) ORDER BY job_id),'[]'::jsonb) FROM crest.leg_job_allocations WHERE business_id=e.business_id AND evidence_id=e.id))
$body$;
CREATE FUNCTION crest_private.stamp_mileage_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
DECLARE e crest.mileage_evidence;l crest.travel_legs;stamp timestamptz:=clock_timestamp();
BEGIN
 IF NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.created_by IS DISTINCT FROM nullif(current_setting('crest.actor_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM nullif(current_setting('crest.operation_id',true),'')::uuid OR NEW.origin<>'manual'
  OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by AND command_type='operations.mileage.record' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MILEAGE_CONTEXT_REQUIRED';END IF;
 IF TG_TABLE_NAME='mileage_evidence' THEN
  SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=NEW.business_id AND logical_id=NEW.leg_id;
  IF l.id IS NULL OR l.id<>NEW.leg_version_id OR l.operator_actor_id<>NEW.operator_actor_id OR NEW.actual_miles IS NOT NULL AND l.state='open' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_LEG_REQUIRED';END IF;
  PERFORM crest_private.lock_booking_operator(NEW.business_id,l.operator_actor_id);
  SELECT * INTO e FROM crest.mileage_evidence WHERE business_id=NEW.business_id AND leg_id=NEW.leg_id ORDER BY sequence DESC LIMIT 1;
  IF e.id IS NULL AND(NEW.sequence<>1 OR NEW.replaces_id IS NOT NULL) OR e.id IS NOT NULL AND(NEW.sequence<>e.sequence+1 OR NEW.replaces_id IS DISTINCT FROM e.id OR NEW.reason IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_PREDECESSOR_REQUIRED';END IF;
  NEW.confirmed_at:=CASE WHEN NEW.actual_miles IS NOT NULL THEN stamp ELSE NULL END;NEW.confirmed_by:=CASE WHEN NEW.actual_miles IS NOT NULL THEN NEW.created_by ELSE NULL END;
 ELSE
  SELECT * INTO e FROM crest.mileage_evidence WHERE business_id=NEW.business_id AND id=NEW.evidence_id;
  IF e.id IS NULL OR e.operation_id<>NEW.operation_id OR e.created_by<>NEW.created_by OR e.leg_id<>NEW.leg_id OR NEW.reason IS DISTINCT FROM e.reason THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_ALLOCATION_REQUIRED';END IF;
 END IF;
 NEW.created_at:=stamp;RETURN NEW;
END $stamp$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.stamp_mileage_source() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.valid_mileage_body(jsonb),crest_private.mileage_projection(text,jsonb),crest_private.mileage_body(crest.mileage_evidence),crest_private.stamp_mileage_source() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.stamp_mileage_source() TO crest_schema_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_mileage_body(jsonb),crest_private.mileage_projection(text,jsonb),crest_private.mileage_body(crest.mileage_evidence) TO crest_booking_owner,crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER mileage_stamp BEFORE INSERT ON crest.mileage_evidence FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_mileage_source();
CREATE TRIGGER mileage_stamp BEFORE INSERT ON crest.leg_job_allocations FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_mileage_source();
CREATE FUNCTION crest_private.mileage_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.mileage_evidence;previous crest.mileage_evidence;l crest.travel_legs;body jsonb;request jsonb;receipt jsonb;audits jsonb;alloc_ids jsonb;part crest.leg_job_allocations;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.mileage.record';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.mileage_evidence WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT * INTO previous FROM crest.mileage_evidence WHERE business_id=business AND id=e.replaces_id;
 SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=e.leg_version_id;
 body:=crest_private.mileage_body(e);request:=jsonb_build_object('commandType','operations.mileage.record','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'legId',e.leg_id,'legVersionId',e.leg_version_id,'expectedVersion',(e.sequence-1)::text,'body',body);
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO alloc_ids FROM crest.leg_job_allocations WHERE business_id=business AND operation_id=operation;
 receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.mileage.record','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'legId',e.leg_id,'legVersionId',e.leg_version_id,'evidenceId',e.id,'evidenceSequence',e.sequence::text,'source',e.source,'actualMiles',e.actual_miles::text,'estimateMiles',e.estimate_miles::text,'allocationState',e.allocation_state,'allocationIds',alloc_ids,'auditIds',audits);
 IF e.id IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM receipt OR crest_private.valid_mileage_body(body) IS NOT TRUE OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR l.id IS NULL OR l.logical_id<>e.leg_id OR l.operator_actor_id<>e.operator_actor_id OR e.actual_miles IS NOT NULL AND(l.state='open' OR e.confirmed_by IS DISTINCT FROM actor OR e.confirmed_at IS DISTINCT FROM e.created_at) OR e.actual_miles IS NULL AND(e.confirmed_by IS NOT NULL OR e.confirmed_at IS NOT NULL)
  OR e.sequence=1 AND e.replaces_id IS NOT NULL OR e.sequence>1 AND(previous.id IS NULL OR previous.leg_id<>e.leg_id OR previous.sequence+1<>e.sequence OR e.reason IS NULL)
  OR jsonb_array_length(audits)<>1+jsonb_array_length(alloc_ids)
  OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='mileage_evidence' AND entity_id=e.leg_id AND entity_version=e.sequence AND action=(CASE e.sequence WHEN 1 THEN 'create' ELSE 'correct' END) AND reason IS NOT DISTINCT FROM e.reason AND delta=jsonb_build_object('schemaVersion',1,'before',CASE WHEN previous.id IS NULL THEN 'null'::jsonb ELSE crest_private.mileage_projection('mileage_evidence',to_jsonb(previous)) END,'after',crest_private.mileage_projection('mileage_evidence',to_jsonb(e))))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_RESULT_REQUIRED';END IF;
 FOR part IN SELECT * FROM crest.leg_job_allocations WHERE business_id=business AND operation_id=operation LOOP
  IF part.evidence_id<>e.id OR part.leg_id<>e.leg_id OR part.created_by<>actor OR part.reason IS DISTINCT FROM e.reason OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='leg_job_allocations' AND entity_id=part.id AND entity_version=1 AND action='create' AND reason IS NOT DISTINCT FROM e.reason AND delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.mileage_projection('leg_job_allocations',to_jsonb(part)))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_RESULT_REQUIRED';END IF;
 END LOOP;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
CREATE FUNCTION crest_private.check_mileage_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE actor uuid;
BEGIN
 IF TG_TABLE_NAME='operations' THEN IF NEW.command_type<>'operations.mileage.record' THEN RETURN NULL;END IF;actor:=NEW.actor_id;ELSE actor:=NEW.created_by;END IF;
 IF crest_private.mileage_result(NEW.business_id,actor,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MILEAGE_RESULT_REQUIRED';END IF;RETURN NULL;
END $check$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.mileage_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_mileage_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.mileage_result(uuid,uuid,uuid),crest_private.check_mileage_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_mileage_result() TO crest_schema_owner;
GRANT EXECUTE ON FUNCTION crest_private.mileage_result(uuid,uuid,uuid) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER mileage_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_mileage_result();
CREATE CONSTRAINT TRIGGER mileage_result AFTER INSERT ON crest.mileage_evidence DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_mileage_result();
CREATE CONSTRAINT TRIGGER mileage_result AFTER INSERT ON crest.leg_job_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_mileage_result();

CREATE FUNCTION crest_commands.record_mileage(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_leg uuid,expected_leg_version uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;l crest.travel_legs;previous crest.mileage_evidence;e crest.mileage_evidence;a crest.leg_job_allocations;part jsonb;family uuid;audits jsonb;receipt jsonb;result jsonb;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_leg IS NULL OR expected_leg_version IS NULL OR expected_version IS NULL OR expected_version<0 OR expected_version>=9223372036854775807 OR crest_private.valid_mileage_body(body) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.mileage.record','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'legId',requested_leg,'legVersionId',expected_leg_version,'expectedVersion',expected_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.mileage.record',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.mileage.record' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.mileage_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   IF l.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='leg';END IF;
   FOR family IN SELECT DISTINCT family_id FROM crest.job_encounters WHERE business_id=requested_business AND(job_id=l.job_context_id OR job_id IN(SELECT(value->>'jobId')::uuid FROM jsonb_array_elements(body->'allocations'))) ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   PERFORM crest_private.lock_booking_operator(requested_business,l.operator_actor_id);
   -- Immutable sources need SELECT only. The canonical operator lock protects
   -- latest-version observations; never grant UPDATE merely to lock a read.
   SELECT * INTO l FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   IF l.id IS DISTINCT FROM expected_leg_version THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='leg_version';END IF;
   IF l.state='open' AND body->'actualMiles'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='open_leg';END IF;
   SELECT * INTO previous FROM crest.mileage_evidence WHERE business_id=requested_business AND leg_id=requested_leg ORDER BY sequence DESC LIMIT 1;
   IF coalesce(previous.sequence,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='version';END IF;
   IF previous.id IS NOT NULL AND body->'reason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_CORRECTION_REASON_REQUIRED';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'allocations') p WHERE NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=(p->>'jobId')::uuid)) THEN RAISE EXCEPTION USING ERRCODE='P1911',MESSAGE='job';END IF;
   INSERT INTO crest.mileage_evidence(business_id,leg_id,leg_version_id,operator_actor_id,sequence,replaces_id,source,movement_kind,actual_miles,estimate_miles,estimate_source,odometer_start,odometer_end,allocation_state,notes,reason,created_by,operation_id) VALUES(requested_business,l.logical_id,l.id,l.operator_actor_id,expected_version+1,previous.id,body->>'source',body->>'movementKind',(body->>'actualMiles')::numeric,(body->>'estimateMiles')::numeric,body->>'estimateSource',(body->>'odometerStart')::numeric,(body->>'odometerEnd')::numeric,body->>'allocationState',body->>'notes',body->>'reason',expected_actor,requested_operation) RETURNING * INTO e;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'mileage_evidence',e.leg_id,e.sequence,CASE e.sequence WHEN 1 THEN 'create' ELSE 'correct' END,e.reason,jsonb_build_object('schemaVersion',1,'before',CASE WHEN previous.id IS NULL THEN 'null'::jsonb ELSE crest_private.mileage_projection('mileage_evidence',to_jsonb(previous)) END,'after',crest_private.mileage_projection('mileage_evidence',to_jsonb(e))),'manual');
   FOR part IN SELECT value FROM jsonb_array_elements(body->'allocations') LOOP
    INSERT INTO crest.leg_job_allocations(business_id,evidence_id,leg_id,job_id,fraction,reason,created_by,operation_id) VALUES(requested_business,e.id,e.leg_id,(part->>'jobId')::uuid,(part->>'fraction')::numeric,e.reason,expected_actor,requested_operation) RETURNING * INTO a;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'leg_job_allocations',a.id,1,'create',e.reason,jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.mileage_projection('leg_job_allocations',to_jsonb(a))),'manual');
   END LOOP;
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.mileage.record','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'legId',e.leg_id,'legVersionId',e.leg_version_id,'evidenceId',e.id,'evidenceSequence',e.sequence::text,'source',e.source,'actualMiles',e.actual_miles::text,'estimateMiles',e.estimate_miles::text,'allocationState',e.allocation_state,'allocationIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM crest.leg_job_allocations WHERE business_id=requested_business AND evidence_id=e.id),'auditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   result:=crest_private.mileage_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1911' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $command$;
CREATE FUNCTION crest_commands.lookup_mileage_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.mileage_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.record_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_mileage_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_mileage_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_mileage(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_mileage_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(recorded_at) ON crest_private.audit_events TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.mileage_history_page(business uuid,leg uuid,after_version bigint,through_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE latest bigint;boundary bigint;result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND logical_id=leg) THEN RETURN jsonb_build_object('state','not_found');END IF;
 SELECT coalesce(max(sequence),0) INTO latest FROM crest.mileage_evidence WHERE business_id=business AND leg_id=leg;boundary:=coalesce(through_version,latest);
 IF boundary>latest OR after_version>boundary THEN RETURN jsonb_build_object('state','conflict','reason','history_boundary');END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.mileage_evidence WHERE business_id=business AND leg_id=leg AND sequence>after_version AND sequence<=boundary ORDER BY sequence LIMIT page_limit),
 more AS(SELECT EXISTS(SELECT 1 FROM crest.mileage_evidence WHERE business_id=business AND leg_id=leg AND sequence>coalesce((SELECT max(sequence) FROM page),after_version) AND sequence<=boundary) value)
 SELECT jsonb_build_object('schemaVersion',1,'state','loaded','businessId',business,'legId',leg,'throughVersion',boundary::text,'afterVersion',after_version::text,'observedLegVersionId',(SELECT id FROM crest.current_travel_legs WHERE business_id=business AND logical_id=leg),
  'evidence',coalesce((SELECT jsonb_agg(crest_private.mileage_projection('mileage_evidence',to_jsonb(p)) ORDER BY p.sequence) FROM page p),'[]'::jsonb),
  'allocations',coalesce((SELECT jsonb_agg(crest_private.mileage_projection('leg_job_allocations',to_jsonb(a)) ORDER BY a.id) FROM crest.leg_job_allocations a JOIN page p ON p.business_id=a.business_id AND p.id=a.evidence_id),'[]'::jsonb),
  'audits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'business_id',a.business_id,'operation_id',a.operation_id,'actor_id',a.actor_id,'entity_kind',a.entity_kind,'entity_id',a.entity_id,'entity_version',a.entity_version::text,'action',a.action,'reason',a.reason,'delta',a.delta,'recorded_at',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'origin',a.origin) ORDER BY a.id) FROM crest_private.audit_events a JOIN page p ON p.business_id=a.business_id AND p.operation_id=a.operation_id WHERE a.entity_kind IN('mileage_evidence','leg_job_allocations')),'[]'::jsonb),
  'hasMore',(SELECT value FROM more),'nextAfterVersion',CASE WHEN(SELECT value FROM more) THEN(SELECT max(sequence)::text FROM page) ELSE NULL END) INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_MILEAGE_HISTORY_PAGE_TOO_LARGE';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.mileage_history_page(uuid,uuid,bigint,bigint,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.mileage_history_page(uuid,uuid,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.mileage_history_page(uuid,uuid,bigint,bigint,integer) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_mileage_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_leg uuid,after_version bigint,through_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_leg IS NULL OR after_version IS NULL OR after_version<0 OR through_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MILEAGE_HISTORY_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.mileage_history_page(requested_business,requested_leg,after_version,through_version,page_limit);
END $history$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_mileage_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_mileage_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_mileage_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,bigint,integer) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/mileage-evidence.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/mileage-field-profile.sql
-- Unregistered joint field/mileage construction. The fixed write profile is
-- measured from fresh reviewed sources, never derived from the receiving DB.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.mileage_result(uuid,uuid,uuid)') IS NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'b23cc705afeb9ffc71c0be57c9786343d1be1b0b24f313ba6b7f550b946ad679'),
   ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'5b60aeda274eb5863718dba61e3a062298641c256784d407db36255d8d7d43a8'),
   ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'ac9fceaf4c3ff38f6e921705dfc516646e856ee1f031a586e2866213b951a906')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_quote_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_quote_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_quote_owner'::regrole))
  OR EXISTS(SELECT 1 FROM(VALUES('mileage_evidence'),('leg_job_allocations')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass('crest.'||e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MILEAGE_PROFILE_REVIEW_REQUIRED';END IF;
END $review$;
DO $extend$ DECLARE signature regprocedure;definition text;updated text;BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)'::regprocedure,
  'crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure,
  'crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure
 ] LOOP
  definition:=pg_get_functiondef(signature);
  updated:=replace(definition,'7d59758a46a631d2ddb9db8df7825aeb77745ba121655b85b4acb87b2748d56b','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3');
  IF updated=definition THEN RAISE EXCEPTION 'CREST_MILEAGE_PROFILE_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 END LOOP;
END $extend$;
-- Unknown future fields/ledgers still refuse. This does not open the separate
-- source/export/recovery profiles or authorize financial consumption/posting.

RESET ROLE;
-- END REVIEWED planning/proposals/mileage-field-profile.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/mobile-trip-interruption.sql
-- Unregistered BR06/BR07/BR09 construction. One atomic en-route interruption:
-- retain the actual stopped trip and either cancel or confirm a replacement.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.mileage_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_private.interrupted_job_result(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'883b4149d624796464f80dcf03d20dd5ec94aee462571da962d2e3f3ead63ae6'),
   ('crest_private.check_amendment_allocation_binding()','crest_booking_integrity_owner',true,'5c5a9119e072ab8faa2d4092d5627ccae6df8568c0738565e6a2881c83a72a15'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'9cfdbe04d5fc296c66719f7587cdca86c9910685c680424257da1e1b597bf349'),
   ('crest_private.check_booking_job_source()','crest_booking_integrity_owner',true,'5ff80ed99a520c9f51bbcb2744f25feaa2770d28b0195a292c0cb94a442abe7c'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'61d69370164ba5c83806b2b8f471b68797070e150f70e6b63ae25a7f9af0fa64'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'e50a92eb0e0713c9ffcc0387d3d5b18384dfc17f62106b139fef6eb3d9cb6f7e'),
   ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'760e50cbfd114af1018fdd1f8af8a2c2960abeeb39703afa7204f2c421a440d2'),
   ('crest_private.check_quote_amendment_accept_operation()','crest_booking_integrity_owner',true,'04e500297f016bee15406831c107655b4760c458b5915305ad7bc846aed3d06b'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'a3e53b0bb2d7ee91fb93a4c0f957962bda50176f1acd852b8132a979705b8b2a'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'73b3f0d38cfb65245ec8b2382025cd4948cb3e91b7e8903e16f77e725bddad04'),
   ('crest_private.validate_booking_reservation()','crest_booking_integrity_owner',true,'95556ce1f71ced7a22d3192ea524258eb43afcce4b8cf63f4c436e180b3fa27d')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INTERRUPTION_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY interruption_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.interrupt');
CREATE POLICY interruption_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.interrupt' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY interruption_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.interrupt') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.interrupt' AND schema_version=1);
CREATE POLICY interruption_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.job.interrupt' AND schema_version=1);
CREATE FUNCTION crest_private.valid_interrupt_body(body jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE trip jsonb;stop jsonb;slot jsonb;review jsonb;entry jsonb;key text;previous text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['action','reason','trip','expectedAppointmentId','expectedModeSequence','appointment','conflictReview','customerCommunication','scope']<>'{}'::jsonb OR NOT body ?& ARRAY['action','reason','trip','expectedAppointmentId','expectedModeSequence','appointment','conflictReview','customerCommunication','scope'] OR octet_length(body::text)>1048576 OR body->>'action' IS NULL OR body->>'action' NOT IN('cancel','reschedule') OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.booking_uuid(body->'expectedAppointmentId') IS NOT TRUE OR jsonb_typeof(body->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'scope') NOT BETWEEN 1 AND 1000 THEN RETURN false;END IF;
 trip:=body->'trip';stop:=trip->'actualStop';
 IF jsonb_typeof(trip) IS DISTINCT FROM 'object' OR trip-ARRAY['legId','expectedLegVersionId','actualStop']<>'{}'::jsonb OR NOT trip ?& ARRAY['legId','expectedLegVersionId','actualStop'] OR crest_private.booking_uuid(trip->'legId') IS NOT TRUE OR crest_private.booking_uuid(trip->'expectedLegVersionId') IS NOT TRUE
  OR jsonb_typeof(stop) IS DISTINCT FROM 'object' OR stop-ARRAY['schemaVersion','kind','locationText','instructions']<>'{}'::jsonb OR NOT stop ?& ARRAY['schemaVersion','kind','locationText','instructions'] OR stop->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR stop->>'kind' IS DISTINCT FROM 'manual' OR crest_private.booking_text_required(stop->'locationText',2000) IS NOT TRUE OR NOT coalesce(stop->'instructions'='null'::jsonb OR crest_private.booking_text_required(stop->'instructions',2000),false) THEN RETURN false;END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId']<>'{}'::jsonb OR NOT entry ?& ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId'] OR crest_private.booking_uuid(entry->'sourceAllocationId') IS NOT TRUE OR crest_private.booking_uuid(entry->'expectedPlanId') IS NOT TRUE OR crest_private.booking_uuid(entry->'entitlementVersionId') IS NOT TRUE OR jsonb_typeof(entry->'expectedSequence') IS DISTINCT FROM 'string' OR(entry->>'expectedSequence')!~'^[1-9][0-9]{0,18}$' OR(entry->>'expectedSequence')::numeric>=9223372036854775807 OR previous IS NOT NULL AND previous>=entry->>'sourceAllocationId' THEN RETURN false;END IF;previous:=entry->>'sourceAllocationId';
 END LOOP;
 IF body->>'action'='cancel' THEN RETURN body->'expectedModeSequence'='null'::jsonb AND body->'appointment'='null'::jsonb AND body->'conflictReview'='null'::jsonb AND crest_private.valid_booking_communication(body->'customerCommunication',recorded);END IF;
 slot:=body->'appointment';review:=body->'conflictReview';
 IF jsonb_typeof(body->'expectedModeSequence') IS DISTINCT FROM 'string' OR(body->>'expectedModeSequence')!~'^[1-9][0-9]{0,18}$' OR(body->>'expectedModeSequence')::numeric>9223372036854775807 OR body->'customerCommunication'<>'null'::jsonb
  OR jsonb_typeof(slot) IS DISTINCT FROM 'object' OR slot-ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','contact_snapshot','customer_confirmation','unknown_travel_reviewed']<>'{}'::jsonb OR NOT slot ?& ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','contact_snapshot','customer_confirmation','unknown_travel_reviewed'] OR crest_private.valid_booking_contact(slot->'contact_snapshot') IS NOT TRUE OR crest_private.valid_booking_confirmation(slot->'customer_confirmation',recorded) IS NOT TRUE OR jsonb_typeof(slot->'unknown_travel_reviewed') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(review) IS DISTINCT FROM 'object' OR review-ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason']<>'{}'::jsonb OR NOT review ?& ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason'] OR jsonb_typeof(review->'expectedAppointmentIds') IS DISTINCT FROM 'array' OR jsonb_array_length(review->'expectedAppointmentIds')>1000 OR jsonb_typeof(review->'expectedUnknownTravel') IS DISTINCT FROM 'boolean' OR NOT coalesce(review->'overrideReason'='null'::jsonb OR crest_private.booking_text_required(review->'overrideReason',1000),false) THEN RETURN false;END IF;
 FOREACH key IN ARRAY ARRAY['start_at','end_at','timezone','local_start','local_end'] LOOP IF jsonb_typeof(slot->key) IS DISTINCT FROM 'string' THEN RETURN false;END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['start_offset_minutes','end_offset_minutes'] LOOP IF jsonb_typeof(slot->key) IS DISTINCT FROM 'number' OR(slot->>key)!~'^-?(0|[1-9][0-9]{0,3})$' THEN RETURN false;END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['travel_before_seconds','travel_after_seconds'] LOOP IF slot->key<>'null'::jsonb AND(jsonb_typeof(slot->key) IS DISTINCT FROM 'number' OR(slot->>key)!~'^(0|[1-9][0-9]{0,9})$' OR(slot->>key)::numeric>2147483647) THEN RETURN false;END IF;END LOOP;
 previous:=NULL;FOR entry IN SELECT value FROM jsonb_array_elements(review->'expectedAppointmentIds') LOOP IF crest_private.booking_uuid(entry) IS NOT TRUE OR previous IS NOT NULL AND previous>=entry#>>'{}' THEN RETURN false;END IF;previous:=entry#>>'{}';END LOOP;
 RETURN true;
END $valid$;
REVOKE ALL ON FUNCTION crest_private.valid_interrupt_body(jsonb,timestamptz) FROM PUBLIC;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.valid_interrupt_body(jsonb,timestamptz),crest_private.valid_booking_communication(jsonb,timestamptz),crest_private.valid_booking_confirmation(jsonb,timestamptz),crest_private.valid_booking_contact(jsonb),crest_private.valid_appointment_hold_payload(jsonb) TO crest_booking_owner,crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.interruption_scope_valid(business uuid,job uuid,scope jsonb,current_required boolean) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $scope$
DECLARE entry jsonb;p crest.allocation_plan_versions;s crest.scope_allocations;v crest.entitlement_versions;
BEGIN
 FOR entry IN SELECT value FROM jsonb_array_elements(scope) LOOP
  SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND id=(entry->>'expectedPlanId')::uuid AND source_allocation_id=(entry->>'sourceAllocationId')::uuid;
  SELECT * INTO s FROM crest.scope_allocations WHERE business_id=business AND id=p.source_allocation_id;
  SELECT * INTO v FROM crest.entitlement_versions WHERE business_id=business AND id=coalesce(p.entitlement_version_id,s.entitlement_version_id);
  IF p.id IS NULL OR s.id IS NULL OR v.id IS NULL OR p.sequence::text IS DISTINCT FROM entry->>'expectedSequence' OR v.id::text IS DISTINCT FROM entry->>'entitlementVersionId'
   OR NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id AND job_id=job AND allocation_state='assigned')
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id AND job_id=job AND allocation_state<>'assigned')
   OR current_required AND(EXISTS(SELECT 1 FROM crest.allocation_plan_versions WHERE business_id=business AND source_allocation_id=s.id AND sequence>p.sequence) OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state control WHERE control.business_id=business AND control.family_id=v.family_id AND control.current_agreement_id=v.agreement_id)) THEN RETURN false;END IF;
 END LOOP;
 RETURN NOT current_required OR (SELECT count(DISTINCT source_allocation_id) FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job)=jsonb_array_length(scope);
END $scope$;
CREATE FUNCTION crest_private.interruption_resources_valid(j crest.jobs,slot jsonb) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $resources$
DECLARE vehicle crest.vehicles;chosen crest.job_vehicles;
BEGIN
 PERFORM 1 FROM crest.customers WHERE business_id=j.business_id AND id=j.customer_id AND archived_at IS NULL FOR SHARE;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM crest.memberships WHERE business_id=j.business_id AND actor_id=j.operator_actor_id AND active FOR SHARE;IF NOT FOUND THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest.job_vehicles WHERE business_id=j.business_id AND job_id=j.id) OR crest_private.valid_booking_location(j.work_location_snapshot,j.business_id,j.customer_id,true) IS NOT TRUE THEN RETURN false;END IF;
 FOR chosen IN SELECT * FROM crest.job_vehicles WHERE business_id=j.business_id AND job_id=j.id ORDER BY vehicle_id LOOP
  SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=j.business_id AND id=chosen.vehicle_id FOR SHARE;
  IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL OR chosen.customer_vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.customer_vehicles WHERE business_id=j.business_id AND id=chosen.customer_vehicle_id AND customer_id=j.customer_id AND vehicle_id=chosen.vehicle_id AND valid_to IS NULL) THEN RETURN false;END IF;
 END LOOP;
 RETURN crest_private.valid_appointment_hold_payload(jsonb_build_object('customer_id',j.customer_id,'lead_id',NULL,'label','Interrupted Mobile replacement time','state','proposed','start_at',slot->'start_at','end_at',slot->'end_at','timezone',slot->'timezone','local_start',slot->'local_start','local_end',slot->'local_end','start_offset_minutes',slot->'start_offset_minutes','end_offset_minutes',slot->'end_offset_minutes','notes',NULL,'reason',NULL));
END $resources$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.interruption_scope_valid(uuid,uuid,jsonb,boolean) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.interruption_resources_valid(crest.jobs,jsonb) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.interruption_scope_valid(uuid,uuid,jsonb,boolean),crest_private.interruption_resources_valid(crest.jobs,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.interruption_scope_valid(uuid,uuid,jsonb,boolean),crest_private.interruption_resources_valid(crest.jobs,jsonb) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.interrupt_mobile_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;j crest.jobs;before_job crest.jobs;old_leg crest.travel_legs;l crest.travel_legs;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;mode crest.fulfillment_mode_versions;reservation crest.schedule_reservations;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;event crest.job_events;family uuid;conflicting uuid;observed jsonb;previous crest.allocation_plan_versions;p crest.allocation_plan_versions;part crest.allocation_plan_parts;prior_part crest.allocation_plan_parts;slot jsonb;review jsonb;slot_review jsonb;blocked tstzrange;actual_conflicts jsonb;audits jsonb;receipt jsonb;result jsonb;stamp timestamptz;conflict text;draft jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR crest_private.valid_interrupt_body(body,clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INTERRUPTION_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.interrupt','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.interrupt',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.interrupt' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.interrupted_job_result(requested_business,expected_actor,requested_operation);
  ELSE
   IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||at.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||at.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute at ON at.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND at.attnum>0 AND NOT at.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INTERRUPTION_SCHEMA_REVIEW_REQUIRED';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF before_job.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='version';END IF;
   IF before_job.state<>'en_route' OR before_job.fulfillment_mode<>'mobile' OR before_job.first_work_at IS NOT NULL OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=requested_business AND job_id=requested_job) OR EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=requested_business AND job_id=requested_job) THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='state';END IF;
   IF crest_private.interruption_scope_valid(requested_business,requested_job,body->'scope',true) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='allocation';END IF;
   SELECT * INTO old_leg FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=(body->'trip'->>'legId')::uuid;
   IF old_leg.id IS NULL OR old_leg.id::text IS DISTINCT FROM body->'trip'->>'expectedLegVersionId' OR old_leg.job_context_id<>requested_job OR old_leg.operator_actor_id<>before_job.operator_actor_id OR old_leg.purpose<>'mobile_work_site' OR old_leg.state<>'open' THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='travel';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=requested_job;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=requested_job ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR old_appointment.confirmation_state<>'confirmed' OR latest.id::text IS DISTINCT FROM body->>'expectedAppointmentId' OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='appointment';END IF;
   slot:=body->'appointment';review:=body->'conflictReview';
   IF body->>'action'='reschedule' THEN
    SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
    IF mode.id IS NULL OR NOT mode.mobile_enabled OR mode.sequence::text IS DISTINCT FROM body->>'expectedModeSequence' THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='mode';END IF;
    IF crest_private.interruption_resources_valid(before_job,slot) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='resources';END IF;
   END IF;
   stamp:=clock_timestamp();
   INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,eta_at,eta_source,eta_calculated_at,notes,change_kind,reason,created_by,operation_id)
   VALUES(requested_business,old_leg.logical_id,old_leg.sequence+1,old_leg.id,old_leg.operator_actor_id,old_leg.driven_vehicle_id,old_leg.job_context_id,old_leg.purpose,old_leg.origin_snapshot,body->'trip'->'actualStop',old_leg.departed_at,stamp,'cancelled',old_leg.eta_at,old_leg.eta_source,old_leg.eta_calculated_at,old_leg.notes,'cancel',body->>'reason',expected_actor,requested_operation) RETURNING * INTO l;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',l.logical_id,l.sequence,'cancel',l.reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(old_leg),'after',crest_private.field_travel_projection(l)),'manual');
   IF body->>'action'='cancel' THEN
    INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
    VALUES(requested_business,requested_job,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   ELSE
    INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
    VALUES(requested_business,requested_job,latest.sequence+1,latest.id,(slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz,slot->>'timezone',(slot->>'local_start')::timestamp,(slot->>'local_end')::timestamp,(slot->>'start_offset_minutes')::integer,(slot->>'end_offset_minutes')::integer,(slot->>'travel_before_seconds')::integer,(slot->>'travel_after_seconds')::integer,'confirmed',slot->'customer_confirmation',slot->'contact_snapshot',(slot->>'unknown_travel_reviewed')::boolean,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   END IF;
   PERFORM crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=requested_job RETURNING * INTO reservation;
   IF reservation.id IS NULL OR reservation.appointment_id<>old_appointment.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;
   PERFORM crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL);
   IF body->>'action'='reschedule' THEN
    blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');slot_review:=crest_private.booking_slot_review(requested_business,before_job.operator_actor_id,requested_job,blocked,a.travel_before_seconds,a.travel_after_seconds);
    SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO actual_conflicts FROM jsonb_array_elements(slot_review->'conflictingAppointmentIds');
    IF actual_conflicts IS DISTINCT FROM review->'expectedAppointmentIds' OR slot_review->'unknownTravel' IS DISTINCT FROM review->'expectedUnknownTravel' OR(slot_review->>'unknownTravel')::boolean AND NOT a.unknown_travel_reviewed THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='review';END IF;
    IF actual_conflicts<>'[]'::jsonb THEN
     IF review->'overrideReason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1921',MESSAGE='review';END IF;
     INSERT INTO crest.schedule_overrides(business_id,job_id,appointment_id,reason,created_by,operation_id) VALUES(requested_business,requested_job,a.id,review->>'overrideReason',expected_actor,requested_operation) RETURNING * INTO override_row;PERFORM crest_private.append_booking_audit('schedule_overrides',override_row.id,1,'create',NULL,crest_private.schedule_overrides_projection(override_row));
     FOR conflicting IN SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(actual_conflicts) LOOP INSERT INTO crest.schedule_override_conflicts(business_id,override_id,conflicting_appointment_id,created_by,operation_id) VALUES(requested_business,override_row.id,conflicting,expected_actor,requested_operation) RETURNING * INTO conflict_row;PERFORM crest_private.append_booking_audit('schedule_override_conflicts',conflict_row.id,1,'create',NULL,crest_private.schedule_override_conflicts_projection(conflict_row));END LOOP;
    END IF;
    INSERT INTO crest.schedule_reservations(business_id,job_id,appointment_id,operator_actor_id,blocked_interval,unknown_travel,override_id,created_by,operation_id) VALUES(requested_business,requested_job,a.id,before_job.operator_actor_id,blocked,(slot_review->>'unknownTravel')::boolean,override_row.id,expected_actor,requested_operation) RETURNING * INTO reservation;PERFORM crest_private.append_booking_audit('schedule_reservations',reservation.id,1,'create',NULL,crest_private.schedule_reservations_projection(reservation));
   ELSE
    FOR observed IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
     SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND id=(observed->>'expectedPlanId')::uuid;
     INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,previous.source_allocation_id,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation,previous.entitlement_version_id,previous.authorization_state) RETURNING * INTO p;PERFORM crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p));
     FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
      INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=requested_job THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;PERFORM crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part));
     END LOOP;
    END LOOP;
   END IF;
   UPDATE crest.jobs SET state=CASE WHEN body->>'action'='cancel' THEN 'cancelled' ELSE 'scheduled' END,current_appointment_id=a.id,mode_version_id=CASE WHEN body->>'action'='reschedule' THEN mode.id ELSE before_job.mode_version_id END,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));
   draft:=CASE WHEN body->>'action'='reschedule' THEN crest_private.schedule_confirmation_draft(requested_business,j.id,a.id) ELSE 'null'::jsonb END;
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,'en_route',j.state,j.updated_at,body->>'reason',jsonb_build_object('schemaVersion',1,'request',request,'closedLegVersionId',l.id,'historyPredecessorId',latest.id,'slotReview',slot_review,'confirmationDraft',draft),expected_actor,requested_operation) RETURNING * INTO event;PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.interrupt','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'action',body->>'action','state',j.state,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'legId',l.logical_id,'closedLegVersionId',l.id,'effectiveAt',to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmationDraft',draft,'sourceAuditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_private.check_interrupted_job_graph(requested_business,requested_job,requested_operation);result:=crest_private.interrupted_job_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1921' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $command$;

CREATE FUNCTION crest_private.interrupted_job_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;l crest.travel_legs;old_leg crest.travel_legs;a crest.appointments;old_appointment crest.appointments;latest crest.appointments;before_job jsonb;after_job jsonb;request jsonb;body jsonb;audits jsonb;receipt jsonb;source_audit record;stored jsonb;plan_entry jsonb;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;actual_parts jsonb;expected_parts jsonb;expected_count bigint;counted bigint:=0;blocked jsonb;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.interrupt';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 request:=e.evidence->'request';body:=request->'body';
 SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=(e.evidence->>'closedLegVersionId')::uuid AND operation_id=operation AND created_by=actor;
 SELECT * INTO old_leg FROM crest.travel_legs WHERE business_id=business AND id=l.replaces_id;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(after_job->>'current_appointment_id')::uuid AND operation_id=operation AND created_by=actor;
 SELECT * INTO latest FROM crest.appointments WHERE business_id=business AND id=a.replaces_id;
 SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=business AND id=(before_job->>'current_appointment_id')::uuid AND job_id=e.job_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.interrupt','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'action',body->>'action','state',after_job->>'state','appointmentId',a.id,'appointmentSequence',a.sequence::text,'legId',l.logical_id,'closedLegVersionId',l.id,'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmationDraft',e.evidence->'confirmationDraft','sourceAuditIds',audits);
 IF e.id IS NULL OR l.id IS NULL OR old_leg.id IS NULL OR a.id IS NULL OR latest.id IS NULL OR old_appointment.id IS NULL OR before_job IS NULL OR after_job IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM receipt OR crest_private.valid_interrupt_body(body,e.created_at) IS NOT TRUE
  OR e.evidence-ARRAY['schemaVersion','request','closedLegVersionId','historyPredecessorId','slotReview','confirmationDraft']<>'{}'::jsonb OR NOT e.evidence ?& ARRAY['schemaVersion','request','closedLegVersionId','historyPredecessorId','slotReview','confirmationDraft'] OR e.evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR request IS DISTINCT FROM jsonb_build_object('commandType','operations.job.interrupt','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'expectedJobVersion',(e.sequence-1)::text,'body',body) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR e.from_state<>'en_route' OR e.to_state IS DISTINCT FROM(CASE WHEN body->>'action'='cancel' THEN 'cancelled' ELSE 'scheduled' END) OR before_job->>'state'<>'en_route' OR after_job->>'state' IS DISTINCT FROM e.to_state OR before_job->>'fulfillment_mode'<>'mobile' OR after_job->>'fulfillment_mode'<>'mobile'
  OR before_job->'first_work_at'<>'null'::jsonb OR after_job->'first_work_at'<>'null'::jsonb OR after_job->'completed_at'<>'null'::jsonb OR after_job->'completion_outcome'<>'null'::jsonb OR(before_job->>'version')::bigint+1<>e.sequence OR after_job->>'version' IS DISTINCT FROM e.sequence::text OR after_job->>'updated_by' IS DISTINCT FROM actor::text OR after_job->>'operation_id' IS DISTINCT FROM operation::text
  OR before_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id'] IS DISTINCT FROM after_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id']
  OR e.reason IS DISTINCT FROM body->>'reason' OR l.reason IS DISTINCT FROM e.reason OR a.reason IS DISTINCT FROM e.reason OR e.effective_at IS DISTINCT FROM l.arrived_at OR(after_job->>'updated_at')::timestamptz IS DISTINCT FROM l.arrived_at OR(before_job->>'updated_at')::timestamptz>l.arrived_at OR e.effective_at>e.created_at
  OR old_leg.logical_id::text IS DISTINCT FROM body->'trip'->>'legId' OR old_leg.id::text IS DISTINCT FROM body->'trip'->>'expectedLegVersionId' OR old_leg.state<>'open' OR l.state<>'cancelled' OR l.change_kind<>'cancel' OR l.sequence<>old_leg.sequence+1 OR l.job_context_id<>e.job_id OR l.operator_actor_id::text IS DISTINCT FROM before_job->>'operator_actor_id' OR l.purpose<>'mobile_work_site' OR l.destination_snapshot IS DISTINCT FROM body->'trip'->'actualStop'
  OR ROW(l.logical_id,l.operator_actor_id,l.driven_vehicle_id,l.job_context_id,l.purpose,l.origin_snapshot,l.departed_at,l.eta_at,l.eta_source,l.eta_calculated_at,l.notes) IS DISTINCT FROM ROW(old_leg.logical_id,old_leg.operator_actor_id,old_leg.driven_vehicle_id,old_leg.job_context_id,old_leg.purpose,old_leg.origin_snapshot,old_leg.departed_at,old_leg.eta_at,old_leg.eta_source,old_leg.eta_calculated_at,old_leg.notes)
  OR a.job_id<>e.job_id OR a.sequence<>latest.sequence+1 OR latest.id::text IS DISTINCT FROM body->>'expectedAppointmentId' OR e.evidence->>'historyPredecessorId' IS DISTINCT FROM latest.id::text OR old_appointment.confirmation_state<>'confirmed'
  OR (SELECT count(*) FROM crest.job_events WHERE business_id=business AND operation_id=operation)<>1 OR (SELECT count(*) FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)<>1 OR (SELECT count(*) FROM crest.appointments WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)
  OR crest_private.interruption_scope_valid(business,e.job_id,body->'scope',false) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_RESULT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='jobs' AND prior.entity_id=e.job_id AND prior.entity_version=e.sequence-1 AND prior.delta->'after'=before_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_HISTORY_REQUIRED';END IF;
 IF body->>'action'='cancel' THEN
  IF a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL OR e.evidence->'confirmationDraft'<>'null'::jsonb OR e.evidence->'slotReview'<>'null'::jsonb OR after_job->'mode_version_id' IS DISTINCT FROM before_job->'mode_version_id'
   OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,old_appointment.contact_snapshot)
   OR(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(body->'scope') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CANCELLATION_REQUIRED';END IF;
  FOR plan_entry IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
   SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=business AND id=(plan_entry->>'expectedPlanId')::uuid;
   SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND source_allocation_id=previous.source_allocation_id;
   IF p.id IS NULL OR p.replaces_id<>previous.id OR p.sequence<>previous.sequence+1 OR p.entitlement_version_id IS DISTINCT FROM previous.entitlement_version_id OR p.authorization_state IS DISTINCT FROM previous.authorization_state THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SCOPE_REQUIRED';END IF;
   SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',CASE WHEN job_id=e.job_id THEN 'cancelled' ELSE allocation_state END,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO expected_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=previous.id;
   SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',allocation_state,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO actual_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id;
   IF actual_parts IS DISTINCT FROM expected_parts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SCOPE_REQUIRED';END IF;PERFORM crest_private.check_completed_scope_floor(business,p.source_allocation_id,p.id);
  END LOOP;
 ELSE
  IF a.confirmation_state<>'confirmed' OR a.customer_confirmation IS DISTINCT FROM body->'appointment'->'customer_confirmation' OR a.contact_snapshot IS DISTINCT FROM body->'appointment'->'contact_snapshot' OR a.unknown_travel_reviewed IS DISTINCT FROM(body->'appointment'->>'unknown_travel_reviewed')::boolean
   OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds) IS DISTINCT FROM ROW((body->'appointment'->>'start_at')::timestamptz,(body->'appointment'->>'end_at')::timestamptz,body->'appointment'->>'timezone',(body->'appointment'->>'local_start')::timestamp,(body->'appointment'->>'local_end')::timestamp,(body->'appointment'->>'start_offset_minutes')::integer,(body->'appointment'->>'end_offset_minutes')::integer,(body->'appointment'->>'travel_before_seconds')::integer,(body->'appointment'->>'travel_after_seconds')::integer)
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=business AND operation_id=operation)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CONFIRMATION_REQUIRED';END IF;
 END IF;
 expected_count:=jsonb_array_length(audits);
 FOR source_audit IN SELECT id,entity_kind,entity_id,entity_version,action,delta,origin,import_row_id,created_by FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor LOOP
  counted:=counted+1;stored:=NULL;
  IF source_audit.origin<>'manual' OR source_audit.import_row_id IS NOT NULL OR source_audit.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
  IF source_audit.entity_kind='jobs' THEN IF source_audit.entity_id<>e.job_id OR source_audit.entity_version<>e.sequence OR source_audit.action<>'revise' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_job,'after',after_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='travel_legs' THEN IF source_audit.entity_id<>l.logical_id OR source_audit.entity_version<>l.sequence OR source_audit.action<>'cancel' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(old_leg),'after',crest_private.field_travel_projection(l)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='schedule_reservations' THEN
   IF source_audit.action='release' THEN
    IF source_audit.entity_version<>2 OR source_audit.delta->'after'<>'null'::jsonb OR source_audit.delta->'before'->>'id' IS DISTINCT FROM source_audit.entity_id::text OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM e.job_id::text OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM old_appointment.id::text
     OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='schedule_reservations' AND prior.entity_id=source_audit.entity_id AND prior.action='create' AND prior.delta->'after'=source_audit.delta->'before') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;CONTINUE;
   END IF;
   stored:=source_audit.delta->'after';blocked:=jsonb_build_object('start_at',to_char((a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'end_at',to_char((a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'lower_inclusive',true,'upper_inclusive',false);
   IF body->>'action'<>'reschedule' OR stored->>'id' IS DISTINCT FROM source_audit.entity_id::text OR stored->>'job_id' IS DISTINCT FROM e.job_id::text OR stored->>'appointment_id' IS DISTINCT FROM a.id::text OR stored->'blocked_interval' IS DISTINCT FROM blocked OR stored->'unknown_travel' IS DISTINCT FROM body->'conflictReview'->'expectedUnknownTravel' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;
  ELSIF source_audit.entity_kind IN('appointments','job_events','allocation_plan_versions','allocation_plan_parts','schedule_overrides','schedule_override_conflicts') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',source_audit.entity_kind,source_audit.entity_kind) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.entity_version<>1 OR source_audit.action<>'create' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
 END LOOP;
 IF counted<>expected_count OR(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='schedule_reservations' AND action='release')<>1 OR(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='schedule_reservations' AND action='create')<>(CASE WHEN body->>'action'='reschedule' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_AUDIT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;

CREATE FUNCTION crest_private.check_interrupted_job_graph(business uuid,job uuid,operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;a crest.appointments;l crest.travel_legs;mode crest.fulfillment_mode_versions;body jsonb;saved jsonb;after_job jsonb;review jsonb;blocked tstzrange;conflicts jsonb;override_row crest.schedule_overrides;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM operation OR e.operation_id IS DISTINCT FROM operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_GRAPH_REQUIRED';END IF;
 saved:=crest_private.interrupted_job_result(business,j.updated_by,operation);body:=e.evidence->'request'->'body';
 SELECT delta->'after' INTO after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=j.current_appointment_id;SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND id=(saved->'receipt'->>'closedLegVersionId')::uuid;
 IF saved->>'state' IS DISTINCT FROM 'committed' OR crest_private.jobs_projection(j) IS DISTINCT FROM after_job OR a.id IS NULL OR l.id IS NULL OR a.sequence IS DISTINCT FROM(SELECT max(sequence) FROM crest.appointments WHERE business_id=business AND job_id=job)
  OR NOT EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND id=l.id) OR EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=business AND job_context_id=job AND state='open')
  OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=business AND job_id=job)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_GRAPH_REQUIRED';END IF;
 IF body->>'action'='cancel' THEN
  IF j.state<>'cancelled' OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job) OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state<>'cancelled') OR EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CANCELLATION_REQUIRED';END IF;
 ELSE
  SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=business ORDER BY sequence DESC LIMIT 1;
  IF j.state<>'scheduled' OR mode.id IS DISTINCT FROM j.mode_version_id OR NOT mode.mobile_enabled OR mode.sequence::text IS DISTINCT FROM body->>'expectedModeSequence' OR crest_private.interruption_resources_valid(j,body->'appointment') IS NOT TRUE OR crest_private.interruption_scope_valid(business,job,body->'scope',true) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_CONFIRMATION_REQUIRED';END IF;
  blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');review:=crest_private.booking_slot_review(business,j.operator_actor_id,job,blocked,a.travel_before_seconds,a.travel_after_seconds);
  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO conflicts FROM jsonb_array_elements(review->'conflictingAppointmentIds');
  IF review IS DISTINCT FROM e.evidence->'slotReview' OR conflicts IS DISTINCT FROM body->'conflictReview'->'expectedAppointmentIds' OR review->'unknownTravel' IS DISTINCT FROM body->'conflictReview'->'expectedUnknownTravel' OR(review->>'unknownTravel')::boolean AND NOT a.unknown_travel_reviewed
   OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job AND appointment_id=a.id AND operator_actor_id=j.operator_actor_id AND blocked_interval=blocked AND unknown_travel=(review->>'unknownTravel')::boolean AND operation_id=operation)
   OR e.evidence->'confirmationDraft' IS DISTINCT FROM crest_private.schedule_confirmation_draft(business,job,a.id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SLOT_REQUIRED';END IF;
  IF conflicts='[]'::jsonb THEN IF EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job AND override_id IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_OVERRIDE_REQUIRED';END IF;
  ELSE
   SELECT * INTO override_row FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation AND job_id=job AND appointment_id=a.id;
   IF override_row.id IS NULL OR override_row.reason IS DISTINCT FROM body->'conflictReview'->>'overrideReason' OR(SELECT count(*) FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation)<>1 OR(SELECT count(*) FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(conflicts)
    OR(SELECT coalesce(jsonb_agg(conflicting_appointment_id ORDER BY conflicting_appointment_id),'[]'::jsonb) FROM crest.schedule_override_conflicts WHERE business_id=business AND override_id=override_row.id AND operation_id=operation) IS DISTINCT FROM conflicts OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job AND override_id=override_row.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_OVERRIDE_REQUIRED';END IF;
  END IF;
 END IF;
END $graph$;
CREATE FUNCTION crest_private.check_interrupted_job_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NEW.command_type<>'operations.job.interrupt' THEN RETURN NULL;END IF;
 IF crest_private.interrupted_job_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_RESULT_REQUIRED';END IF;RETURN NULL;
END $check$;
CREATE FUNCTION crest_commands.lookup_interrupted_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INTERRUPTION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.interrupted_job_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.interrupted_job_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_interrupted_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_interrupted_job_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.interrupted_job_result(uuid,uuid,uuid),crest_private.check_interrupted_job_graph(uuid,uuid,uuid),crest_private.check_interrupted_job_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.interrupted_job_result(uuid,uuid,uuid),crest_private.check_interrupted_job_graph(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_interrupted_job_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER interruption_original AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_interrupted_job_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_interrupted_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_interrupted_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_interrupted_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

-- Only reviewed fixed predecessor branches are extended. Existing ordinary
-- scheduling/cancellation/field/completion paths keep their original checks.
DO $extend$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.complete''',
  'IF NOT coalesce(kind=''operations.job.interrupt'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''DELETE'' AND TG_TABLE_NAME=''schedule_reservations'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME IN(''appointments'',''job_events'',''schedule_reservations'',''schedule_overrides'',''schedule_override_conflicts'',''allocation_plan_versions'',''allocation_plan_parts'')) OR kind=''operations.job.complete''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'''operations.job.field'',''operations.job.complete'')','''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'')');
 updated:=replace(updated,'IF kind=''operations.job.complete'' THEN',$branch$
 IF kind='operations.job.interrupt' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' THEN
   IF OLD.state<>'en_route' OR OLD.fulfillment_mode<>'mobile' OR OLD.first_work_at IS NOT NULL OR NEW.state NOT IN('scheduled','cancelled') OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor
    OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id','mode_version_id']
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_GRAPH_REQUIRED';END IF;
   SELECT arrived_at INTO stamp FROM crest.travel_legs WHERE business_id=NEW.business_id AND operation_id=operation AND job_context_id=NEW.id AND state='cancelled' AND change_kind='cancel';
   IF stamp IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_TRAVEL_REQUIRED';END IF;NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts') AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SOURCE_REQUIRED';END IF;
 END IF;
 IF kind='operations.job.complete' THEN$branch$);
 IF updated=definition OR position('CREST_INTERRUPTION_TRAVEL_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'')','o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')');
 updated:=replace(updated,'o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'')','o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.complete'' THEN','IF kind=''operations.job.interrupt'' THEN PERFORM crest_private.check_interrupted_job_graph(business,job,source_operation);RETURN;END IF; IF kind=''operations.job.complete'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.complete'' THEN','IF kind=''operations.job.interrupt'' THEN PERFORM crest_private.check_interrupted_job_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF; IF kind=''operations.job.complete'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'')','kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'',''operations.job.interrupt'')');
 updated:=replace(updated,'IF kind=''operations.job.complete'' THEN',$branch$
 IF kind='operations.job.interrupt' THEN
  SELECT job_id INTO completion_job FROM crest.job_events WHERE business_id=p.business_id AND operation_id=p.operation_id;
  IF completion_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_SCOPE_REQUIRED';END IF;
  PERFORM crest_private.check_interrupted_job_graph(p.business_id,completion_job,p.operation_id);RETURN NULL;
 END IF;
 IF kind='operations.job.complete' THEN$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 updated:=replace(definition,'''operations.time.correct'',''operations.job.complete'')','''operations.time.correct'',''operations.job.complete'',''operations.job.interrupt'')');
 updated:=replace(updated,'IF command=''operations.job.complete'' AND',$branch$
 IF command='operations.job.interrupt' THEN
  IF TG_TABLE_NAME<>'travel_legs' OR NEW.change_kind<>'cancel' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INTERRUPTION_TRAVEL_REQUIRED';END IF;
  PERFORM 1 FROM crest.jobs WHERE business_id=NEW.business_id AND id=NEW.job_context_id AND operator_actor_id=NEW.operator_actor_id AND state='en_route' AND fulfillment_mode='mobile' AND first_work_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_INTERRUPTION_TRAVEL_REQUIRED';END IF;
 END IF;
 IF command='operations.job.complete' AND$branch$);
 IF updated=definition OR position('CREST_INTERRUPTION_TRAVEL_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.validate_booking_reservation()'::regprocedure);
 updated:=replace(definition,'command_type IN(''operations.job.reschedule'',''operations.job.cancel'')','command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_amendment_allocation_binding()'::regprocedure);
 updated:=replace(definition,'o.command_type=''operations.job.complete'' AND o.schema_version=1','o.command_type IN(''operations.job.complete'',''operations.job.interrupt'') AND o.schema_version=1');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_quote_amendment_accept_operation()'::regprocedure);
 updated:=replace(definition,'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'')','old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_INTERRUPTION_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/mobile-trip-interruption.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/unfulfilled-work-cancellation.sql
-- Unregistered BR07: cancel started/paused Mobile work only with an explicit
-- no-fulfilled-scope declaration. Retain actual time, travel and obligations.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.interrupted_job_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_private.unfulfilled_job_result(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'0ce826b3fac30d86c6078c6820cba09b01a0a21c3c632e8de554eb404ac0c90c'),
   ('crest_private.check_amendment_allocation_binding()','crest_booking_integrity_owner',true,'0a7bb6f68ea49031cd2c07ef9e4eec0e41b711d450e91f5fd048017123b37da5'),
   ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'73359dddca4a7d105fcc42a20cbd523c00ce8ad2a3d387829acded0e24043b08'),
   ('crest_private.check_booking_job_source()','crest_booking_integrity_owner',true,'5ff80ed99a520c9f51bbcb2744f25feaa2770d28b0195a292c0cb94a442abe7c'),
   ('crest_private.check_booking_plan()','crest_booking_integrity_owner',true,'70075416bafc6cf7979e149ddbad4c46c237a7fcc7b17cca9b53bb5bac2b8d13'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'3d7cf6e5d177f420cd4175ee5f1514d903d01f7e9cb3419a7c6284f18b918014'),
   ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'497421bbf9a44e4431163cb24e47d8923bdb67b740b2b253eb75b566d7c3d9a1'),
   ('crest_private.check_completion_source_audit()','crest_booking_integrity_owner',true,'81795ef2364f1b3378b20bbc5247ecca85991c9ea26d6d12740d4769a339c88c'),
   ('crest_private.check_quote_amendment_accept_operation()','crest_booking_integrity_owner',true,'ee433c24dcdbcb296a0e45c50a0e6df39907b2065693681e8e58b5d3a42bf295'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'f19524e6caee787c38db422232dc15f58aa32d87a6fcf8d5244b784326c2d951'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'72ea5eb9a84b01f74f4f5851b2d74e9d99d9cde606fbf9a045d9c34977638259'),
   ('crest_private.stamp_completion_source()','crest_booking_integrity_owner',true,'08dd3f66588aa784e811a54a4c3d96df180e5c225174b1fc1b880c07ff489274'),
   ('crest_private.validate_booking_reservation()','crest_booking_integrity_owner',true,'03905cce01181e150deb7238483b42884c11446ea2c5c810d9d6141d7b41605c')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNFULFILLED_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY unfulfilled_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled');
CREATE POLICY unfulfilled_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY unfulfilled_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.cancel_unfulfilled' AND schema_version=1);
CREATE POLICY unfulfilled_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type='operations.job.cancel_unfulfilled' AND schema_version=1);
CREATE FUNCTION crest_private.valid_unfulfilled_cancel_body(body jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE entry jsonb;previous text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['reason','noFulfilledScopeConfirmed','expectedWorkIntervalId','expectedOpenTravelLegVersionIds','customerCommunication','scope']<>'{}'::jsonb OR NOT body ?& ARRAY['reason','noFulfilledScopeConfirmed','expectedWorkIntervalId','expectedOpenTravelLegVersionIds','customerCommunication','scope'] OR octet_length(body::text)>1048576 OR body->'noFulfilledScopeConfirmed' IS DISTINCT FROM 'true'::jsonb
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.booking_uuid(body->'expectedWorkIntervalId') IS NOT TRUE OR crest_private.valid_booking_communication(body->'customerCommunication',recorded) IS NOT TRUE OR jsonb_typeof(body->'expectedOpenTravelLegVersionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'expectedOpenTravelLegVersionIds')>1 OR jsonb_typeof(body->'scope') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'scope') NOT BETWEEN 1 AND 1000 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'expectedOpenTravelLegVersionIds') value WHERE crest_private.booking_uuid(value) IS NOT TRUE) THEN RETURN false;END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' OR entry-ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId']<>'{}'::jsonb OR NOT entry ?& ARRAY['sourceAllocationId','expectedPlanId','expectedSequence','entitlementVersionId'] OR crest_private.booking_uuid(entry->'sourceAllocationId') IS NOT TRUE OR crest_private.booking_uuid(entry->'expectedPlanId') IS NOT TRUE OR crest_private.booking_uuid(entry->'entitlementVersionId') IS NOT TRUE OR jsonb_typeof(entry->'expectedSequence') IS DISTINCT FROM 'string' OR(entry->>'expectedSequence')!~'^[1-9][0-9]{0,18}$' OR(entry->>'expectedSequence')::numeric>=9223372036854775807 OR previous IS NOT NULL AND previous>=entry->>'sourceAllocationId' THEN RETURN false;END IF;previous:=entry->>'sourceAllocationId';
 END LOOP;RETURN true;
END $valid$;
REVOKE ALL ON FUNCTION crest_private.valid_unfulfilled_cancel_body(jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_unfulfilled_cancel_body(jsonb,timestamptz) TO crest_booking_owner,crest_booking_integrity_owner;

CREATE FUNCTION crest_commands.cancel_unfulfilled_job(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_job_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;j crest.jobs;before_job crest.jobs;old_work crest.work_intervals;closed_work crest.work_intervals;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;reservation crest.schedule_reservations;observed jsonb;previous crest.allocation_plan_versions;p crest.allocation_plan_versions;prior_part crest.allocation_plan_parts;part crest.allocation_plan_parts;outcome crest.work_scope_outcomes;event crest.job_events;family uuid;travel_ids jsonb;audits jsonb;receipt jsonb;result jsonb;stamp timestamptz;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR crest_private.valid_unfulfilled_cancel_body(body,clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNFULFILLED_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType','operations.job.cancel_unfulfilled','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.cancel_unfulfilled',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.cancel_unfulfilled' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.unfulfilled_job_result(requested_business,expected_actor,requested_operation);
  ELSE
   IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||at.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||at.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute at ON at.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND at.attnum>0 AND NOT at.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNFULFILLED_SCHEMA_REVIEW_REQUIRED';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;IF before_job.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='version';END IF;
   IF before_job.state NOT IN('in_progress','paused') OR before_job.fulfillment_mode<>'mobile' OR before_job.first_work_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='state';END IF;
   IF EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=requested_business AND job_id=requested_job) OR crest_private.interruption_scope_valid(requested_business,requested_job,body->'scope',true) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='scope';END IF;
   SELECT * INTO old_work FROM crest.current_work_intervals WHERE business_id=requested_business AND job_id=requested_job AND ended_at IS NULL;
   IF old_work.id IS NULL OR old_work.id::text IS DISTINCT FROM body->>'expectedWorkIntervalId' OR old_work.kind IS DISTINCT FROM(CASE before_job.state WHEN 'paused' THEN 'pause' ELSE 'active' END) THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='work';END IF;
   SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO travel_ids FROM crest.current_travel_legs WHERE business_id=requested_business AND operator_actor_id=before_job.operator_actor_id AND state='open';
   IF travel_ids IS DISTINCT FROM body->'expectedOpenTravelLegVersionIds' THEN RAISE EXCEPTION USING ERRCODE='P1931',MESSAGE='travel';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=requested_job;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=requested_job ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR old_appointment.confirmation_state<>'confirmed' OR latest.id IS NULL OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_APPOINTMENT_REQUIRED';END IF;
   stamp:=clock_timestamp();
   INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,started_at,ended_at,pause_reason,change_kind,reason,created_by,operation_id) VALUES(requested_business,old_work.logical_id,old_work.sequence+1,old_work.id,requested_job,old_work.operator_actor_id,old_work.kind,old_work.started_at,stamp,old_work.pause_reason,'close',body->>'reason',expected_actor,requested_operation) RETURNING * INTO closed_work;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',closed_work.logical_id,closed_work.sequence,'close',closed_work.reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(old_work),'after',crest_private.field_work_projection(closed_work)),'manual');
   INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id) VALUES(requested_business,requested_job,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;PERFORM crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=requested_job RETURNING * INTO reservation;
   IF reservation.id IS NULL OR reservation.appointment_id<>old_appointment.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SLOT_REQUIRED';END IF;PERFORM crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL);
   FOR observed IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
    SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND id=(observed->>'expectedPlanId')::uuid;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,previous.source_allocation_id,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation,previous.entitlement_version_id,previous.authorization_state) RETURNING * INTO p;PERFORM crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p));
    FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=requested_job THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;PERFORM crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part));
     IF prior_part.job_id=requested_job THEN INSERT INTO crest.work_scope_outcomes(business_id,job_id,assigned_part_id,completion_part_id,partition_id,outcome,scope_description,completed_cents,reason,created_by,operation_id) VALUES(requested_business,requested_job,prior_part.id,part.id,part.stable_partition_id,'cancelled',part.scope_description,0,body->>'reason',expected_actor,requested_operation) RETURNING * INTO outcome;PERFORM crest_private.append_completion_audit('work_scope_outcomes',to_jsonb(outcome));END IF;
    END LOOP;
   END LOOP;
   UPDATE crest.jobs SET state='cancelled',current_appointment_id=a.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,before_job.state,'cancelled',j.updated_at,body->>'reason',jsonb_build_object('schemaVersion',1,'request',request,'closedWorkIntervalId',closed_work.id,'historyPredecessorId',latest.id,'unresolvedTravelLegVersionIds',travel_ids),expected_actor,requested_operation) RETURNING * INTO event;PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.cancel_unfulfilled','businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',j.id,'jobVersion',j.version::text,'state','cancelled','appointmentId',a.id,'appointmentSequence',a.sequence::text,'closedWorkIntervalId',closed_work.id,'effectiveAt',to_char(j.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'unresolvedTravelLegVersionIds',travel_ids,'outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=requested_business AND operation_id=requested_operation),'sourceAuditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;PERFORM crest_private.check_unfulfilled_job_graph(requested_business,requested_job,requested_operation);result:=crest_private.unfulfilled_job_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1931' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $command$;

CREATE FUNCTION crest_private.unfulfilled_job_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.job_events;w crest.work_intervals;old_work crest.work_intervals;a crest.appointments;old_appointment crest.appointments;latest crest.appointments;before_job jsonb;after_job jsonb;request jsonb;body jsonb;audits jsonb;receipt jsonb;source_audit record;stored jsonb;observed jsonb;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;prior_part crest.allocation_plan_parts;part crest.allocation_plan_parts;outcome crest.work_scope_outcomes;expected_parts jsonb;actual_parts jsonb;outcome_count bigint:=0;travel_id uuid;
BEGIN
 SELECT state,schema_version,result_schema_version,result,payload_hash,recovery_epoch INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.cancel_unfulfilled';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO e FROM crest.job_events WHERE business_id=business AND operation_id=operation AND created_by=actor;
 SELECT delta->'before',delta->'after' INTO before_job,after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=e.job_id AND entity_version=e.sequence;
 request:=e.evidence->'request';body:=request->'body';
 SELECT * INTO w FROM crest.work_intervals WHERE business_id=business AND id=(e.evidence->>'closedWorkIntervalId')::uuid AND operation_id=operation AND created_by=actor;SELECT * INTO old_work FROM crest.work_intervals WHERE business_id=business AND id=w.replaces_id;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(after_job->>'current_appointment_id')::uuid AND operation_id=operation AND created_by=actor;SELECT * INTO latest FROM crest.appointments WHERE business_id=business AND id=a.replaces_id;SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=business AND id=(before_job->>'current_appointment_id')::uuid AND job_id=e.job_id;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 receipt:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.cancel_unfulfilled','businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'jobVersion',e.sequence::text,'state','cancelled','appointmentId',a.id,'appointmentSequence',a.sequence::text,'closedWorkIntervalId',w.id,'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'unresolvedTravelLegVersionIds',body->'expectedOpenTravelLegVersionIds','outcomeIds',(SELECT jsonb_agg(id ORDER BY id) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation),'sourceAuditIds',audits);
 IF e.id IS NULL OR w.id IS NULL OR old_work.id IS NULL OR a.id IS NULL OR latest.id IS NULL OR old_appointment.id IS NULL OR before_job IS NULL OR after_job IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM receipt OR crest_private.valid_unfulfilled_cancel_body(body,e.created_at) IS NOT TRUE
  OR e.evidence-ARRAY['schemaVersion','request','closedWorkIntervalId','historyPredecessorId','unresolvedTravelLegVersionIds']<>'{}'::jsonb OR NOT e.evidence ?& ARRAY['schemaVersion','request','closedWorkIntervalId','historyPredecessorId','unresolvedTravelLegVersionIds'] OR e.evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR e.evidence->'unresolvedTravelLegVersionIds' IS DISTINCT FROM body->'expectedOpenTravelLegVersionIds'
  OR request IS DISTINCT FROM jsonb_build_object('commandType','operations.job.cancel_unfulfilled','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',e.job_id,'expectedJobVersion',(e.sequence-1)::text,'body',body) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR e.from_state NOT IN('in_progress','paused') OR e.from_state IS DISTINCT FROM before_job->>'state' OR e.to_state<>'cancelled' OR after_job->>'state'<>'cancelled' OR before_job->>'fulfillment_mode'<>'mobile' OR after_job->>'fulfillment_mode'<>'mobile' OR before_job->>'first_work_at' IS NULL OR after_job->>'first_work_at' IS DISTINCT FROM before_job->>'first_work_at'
  OR after_job->'completed_at'<>'null'::jsonb OR after_job->'completion_outcome'<>'null'::jsonb OR(before_job->>'version')::bigint+1<>e.sequence OR after_job->>'version' IS DISTINCT FROM e.sequence::text OR after_job->>'updated_by' IS DISTINCT FROM actor::text OR after_job->>'operation_id' IS DISTINCT FROM operation::text
  OR before_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id'] IS DISTINCT FROM after_job-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id']
  OR e.reason IS DISTINCT FROM body->>'reason' OR w.reason IS DISTINCT FROM e.reason OR a.reason IS DISTINCT FROM e.reason OR e.effective_at IS DISTINCT FROM w.ended_at OR(after_job->>'updated_at')::timestamptz IS DISTINCT FROM w.ended_at OR e.effective_at>e.created_at OR w.ended_at<(before_job->>'first_work_at')::timestamptz
  OR old_work.id::text IS DISTINCT FROM body->>'expectedWorkIntervalId' OR old_work.ended_at IS NOT NULL OR w.change_kind<>'close' OR w.sequence<>old_work.sequence+1 OR w.job_id<>e.job_id OR w.operator_actor_id::text IS DISTINCT FROM before_job->>'operator_actor_id' OR w.kind IS DISTINCT FROM(CASE e.from_state WHEN 'paused' THEN 'pause' ELSE 'active' END)
  OR ROW(w.logical_id,w.job_id,w.operator_actor_id,w.kind,w.started_at,w.pause_reason) IS DISTINCT FROM ROW(old_work.logical_id,old_work.job_id,old_work.operator_actor_id,old_work.kind,old_work.started_at,old_work.pause_reason)
  OR a.job_id<>e.job_id OR a.sequence<>latest.sequence+1 OR e.evidence->>'historyPredecessorId' IS DISTINCT FROM latest.id::text OR old_appointment.confirmation_state<>'confirmed' OR a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL
  OR ROW(a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,a.start_offset_minutes,a.end_offset_minutes,a.travel_before_seconds,a.travel_after_seconds,a.contact_snapshot) IS DISTINCT FROM ROW(old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,old_appointment.contact_snapshot)
  OR(SELECT count(*) FROM crest.job_events WHERE business_id=business AND operation_id=operation)<>1 OR(SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)<>1 OR(SELECT count(*) FROM crest.appointments WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)
  OR crest_private.interruption_scope_valid(business,e.job_id,body->'scope',false) IS NOT TRUE OR(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation)<>jsonb_array_length(body->'scope')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_RESULT_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='jobs' AND prior.entity_id=e.job_id AND prior.entity_version=e.sequence-1 AND prior.delta->'after'=before_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_HISTORY_REQUIRED';END IF;
 FOR travel_id IN SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(body->'expectedOpenTravelLegVersionIds') LOOP
  IF NOT EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND id=travel_id AND operator_actor_id=w.operator_actor_id AND state='open' AND departed_at<=e.effective_at) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_TRAVEL_REQUIRED';END IF;
 END LOOP;
 FOR observed IN SELECT value FROM jsonb_array_elements(body->'scope') LOOP
  SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=business AND id=(observed->>'expectedPlanId')::uuid;SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND source_allocation_id=previous.source_allocation_id;
  IF p.id IS NULL OR p.replaces_id<>previous.id OR p.sequence<>previous.sequence+1 OR p.entitlement_version_id IS DISTINCT FROM previous.entitlement_version_id OR p.authorization_state IS DISTINCT FROM previous.authorization_state THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SCOPE_REQUIRED';END IF;
  SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',CASE WHEN job_id=e.job_id THEN 'cancelled' ELSE allocation_state END,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO expected_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=previous.id;
  SELECT jsonb_agg(jsonb_build_object('partition',stable_partition_id,'job',job_id,'state',allocation_state,'gross',gross_inclusive_cents::text,'discount',discount_inclusive_cents::text,'amount',amount_cents::text,'scope',scope_description) ORDER BY stable_partition_id) INTO actual_parts FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id;
  IF actual_parts IS DISTINCT FROM expected_parts THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SCOPE_REQUIRED';END IF;PERFORM crest_private.check_completed_scope_floor(business,p.source_allocation_id,p.id);
  FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=previous.id AND job_id=e.job_id LOOP
   outcome_count:=outcome_count+1;SELECT * INTO part FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=p.id AND stable_partition_id=prior_part.stable_partition_id;
   SELECT * INTO outcome FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation AND assigned_part_id=prior_part.id;
   IF part.id IS NULL OR outcome.id IS NULL OR outcome.job_id<>e.job_id OR outcome.completion_part_id<>part.id OR outcome.partition_id<>part.stable_partition_id OR outcome.outcome<>'cancelled' OR outcome.completed_cents<>0 OR outcome.scope_description IS DISTINCT FROM part.scope_description OR outcome.reason IS DISTINCT FROM body->>'reason' OR outcome.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_OUTCOMES_REQUIRED';END IF;
  END LOOP;
 END LOOP;
 IF outcome_count=0 OR(SELECT count(*) FROM crest.work_scope_outcomes WHERE business_id=business AND operation_id=operation)<>outcome_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_OUTCOMES_REQUIRED';END IF;
 FOR source_audit IN SELECT id,entity_kind,entity_id,entity_version,action,reason,delta,origin,import_row_id,created_by FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor LOOP
  stored:=NULL;IF source_audit.origin<>'manual' OR source_audit.import_row_id IS NOT NULL OR source_audit.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
  IF source_audit.entity_kind='jobs' THEN IF source_audit.entity_id<>e.job_id OR source_audit.entity_version<>e.sequence OR source_audit.action<>'revise' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_job,'after',after_job) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='work_intervals' THEN IF source_audit.entity_id<>w.logical_id OR source_audit.entity_version<>w.sequence OR source_audit.action<>'close' OR source_audit.reason IS DISTINCT FROM w.reason OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(old_work),'after',crest_private.field_work_projection(w)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='schedule_reservations' THEN
   IF source_audit.action<>'release' OR source_audit.entity_version<>2 OR source_audit.delta->'after'<>'null'::jsonb OR source_audit.delta->'before'->>'id' IS DISTINCT FROM source_audit.entity_id::text OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM e.job_id::text OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM old_appointment.id::text OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events prior WHERE prior.business_id=business AND prior.entity_kind='schedule_reservations' AND prior.entity_id=source_audit.entity_id AND prior.action='create' AND prior.delta->'after'=source_audit.delta->'before') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SLOT_REQUIRED';END IF;CONTINUE;
  ELSIF source_audit.entity_kind='work_scope_outcomes' THEN
   SELECT crest_private.completion_projection('work_scope_outcomes',to_jsonb(v)) INTO stored FROM crest.work_scope_outcomes v WHERE business_id=business AND id=source_audit.entity_id AND operation_id=operation AND created_by=actor;
   IF source_audit.reason IS DISTINCT FROM body->>'reason' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
  ELSIF source_audit.entity_kind IN('appointments','job_events','allocation_plan_versions','allocation_plan_parts') THEN EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',source_audit.entity_kind,source_audit.entity_kind) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.entity_version<>1 OR source_audit.action<>'create' OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
 END LOOP;
 IF(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='schedule_reservations')<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_AUDIT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
CREATE FUNCTION crest_private.check_unfulfilled_job_graph(business uuid,job uuid,operation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $graph$
DECLARE j crest.jobs;e crest.job_events;w crest.work_intervals;after_job jsonb;body jsonb;travel_ids jsonb;saved jsonb;
BEGIN
 SELECT * INTO j FROM crest.jobs WHERE business_id=business AND id=job;SELECT * INTO e FROM crest.job_events WHERE business_id=business AND job_id=job AND sequence=j.version;
 IF j.id IS NULL OR j.operation_id IS DISTINCT FROM operation OR e.operation_id IS DISTINCT FROM operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_GRAPH_REQUIRED';END IF;
 saved:=crest_private.unfulfilled_job_result(business,j.updated_by,operation);body:=e.evidence->'request'->'body';SELECT delta->'after' INTO after_job FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND entity_kind='jobs' AND entity_id=job AND entity_version=j.version;
 SELECT * INTO w FROM crest.work_intervals WHERE business_id=business AND id=(saved->'receipt'->>'closedWorkIntervalId')::uuid;
 SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) INTO travel_ids FROM crest.current_travel_legs WHERE business_id=business AND operator_actor_id=j.operator_actor_id AND state='open';
 IF saved->>'state' IS DISTINCT FROM 'committed' OR crest_private.jobs_projection(j) IS DISTINCT FROM after_job OR j.state<>'cancelled' OR j.first_work_at IS NULL OR j.completed_at IS NOT NULL OR j.completion_outcome IS NOT NULL OR travel_ids IS DISTINCT FROM body->'expectedOpenTravelLegVersionIds'
  OR NOT EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND id=w.id) OR EXISTS(SELECT 1 FROM crest.current_work_intervals WHERE business_id=business AND job_id=job AND ended_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job) OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=business AND job_id=job AND allocation_state<>'cancelled')
  OR EXISTS(SELECT 1 FROM crest.work_scope_outcomes WHERE business_id=business AND job_id=job AND(operation_id<>operation OR outcome<>'cancelled' OR completed_cents<>0))
  OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=business AND job_id=job)
  OR EXISTS(SELECT 1 FROM crest.review_requests WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.messages WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.message_events WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.message_templates WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.review_request_encounters WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.job_finalization_tasks WHERE business_id=business AND operation_id=operation)
  OR EXISTS(SELECT 1 FROM crest.schedule_overrides WHERE business_id=business AND operation_id=operation) OR EXISTS(SELECT 1 FROM crest.schedule_override_conflicts WHERE business_id=business AND operation_id=operation)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_GRAPH_REQUIRED';END IF;
END $graph$;
CREATE FUNCTION crest_private.check_unfulfilled_job_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN IF NEW.command_type<>'operations.job.cancel_unfulfilled' THEN RETURN NULL;END IF;IF crest_private.unfulfilled_job_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_RESULT_REQUIRED';END IF;RETURN NULL;END $check$;
CREATE FUNCTION crest_commands.lookup_unfulfilled_job_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNFULFILLED_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.unfulfilled_job_result(requested_business,expected_actor,requested_operation);
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.unfulfilled_job_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_unfulfilled_job_graph(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_unfulfilled_job_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.unfulfilled_job_result(uuid,uuid,uuid),crest_private.check_unfulfilled_job_graph(uuid,uuid,uuid),crest_private.check_unfulfilled_job_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.unfulfilled_job_result(uuid,uuid,uuid),crest_private.check_unfulfilled_job_graph(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_unfulfilled_job_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER unfulfilled_original AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_unfulfilled_job_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_unfulfilled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_unfulfilled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_unfulfilled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

DO $extend$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.interrupt''',
  'IF NOT coalesce(kind=''operations.job.cancel_unfulfilled'' AND(TG_OP=''UPDATE'' AND TG_TABLE_NAME=''jobs'' OR TG_OP=''DELETE'' AND TG_TABLE_NAME=''schedule_reservations'' OR TG_OP=''INSERT'' AND TG_TABLE_NAME IN(''appointments'',''job_events'',''allocation_plan_versions'',''allocation_plan_parts'')) OR kind=''operations.job.interrupt''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,'''operations.job.complete'',''operations.job.interrupt'')','''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'IF kind=''operations.job.interrupt'' THEN',$branch$
 IF kind='operations.job.cancel_unfulfilled' THEN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' THEN
   IF OLD.state NOT IN('in_progress','paused') OR OLD.fulfillment_mode<>'mobile' OR OLD.first_work_at IS NULL OR NEW.state<>'cancelled' OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor
    OR to_jsonb(NEW)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id'] IS DISTINCT FROM to_jsonb(OLD)-ARRAY['state','version','updated_at','updated_by','operation_id','current_appointment_id'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_GRAPH_REQUIRED';END IF;
   SELECT ended_at INTO stamp FROM crest.work_intervals WHERE business_id=NEW.business_id AND operation_id=operation AND job_id=NEW.id AND change_kind='close';
   IF stamp IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_TIME_REQUIRED';END IF;NEW.updated_at:=stamp;RETURN NEW;
  ELSIF TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','allocation_plan_versions','allocation_plan_parts') AND NEW.created_by=actor THEN NEW.created_at:=stamp;RETURN NEW;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SOURCE_REQUIRED';END IF;
 END IF;
 IF kind='operations.job.interrupt' THEN$branch$);
 IF updated=definition OR position('CREST_UNFULFILLED_TIME_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')','o.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')','o.command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_job_graph(uuid,uuid,uuid)'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.interrupt'' THEN','IF kind=''operations.job.cancel_unfulfilled'' THEN PERFORM crest_private.check_unfulfilled_job_graph(business,job,source_operation);RETURN;END IF; IF kind=''operations.job.interrupt'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_schedule_event()'::regprocedure);
 updated:=replace(definition,'IF kind=''operations.job.interrupt'' THEN','IF kind=''operations.job.cancel_unfulfilled'' THEN PERFORM crest_private.check_unfulfilled_job_graph(NEW.business_id,NEW.job_id,NEW.operation_id);RETURN NULL;END IF; IF kind=''operations.job.interrupt'' THEN');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_plan()'::regprocedure);
 updated:=replace(definition,'kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'',''operations.job.interrupt'')','kind NOT IN(''operations.job.book'',''operations.job.cancel'',''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'IF kind=''operations.job.interrupt'' THEN',$branch$
 IF kind='operations.job.cancel_unfulfilled' THEN
  SELECT job_id INTO completion_job FROM crest.job_events WHERE business_id=p.business_id AND operation_id=p.operation_id;
  IF completion_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_SCOPE_REQUIRED';END IF;
  PERFORM crest_private.check_unfulfilled_job_graph(p.business_id,completion_job,p.operation_id);RETURN NULL;
 END IF;
 IF kind='operations.job.interrupt' THEN$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 updated:=replace(definition,'''operations.job.complete'',''operations.job.interrupt'')','''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 updated:=replace(updated,'IF command=''operations.job.interrupt'' THEN',$branch$
 IF command='operations.job.cancel_unfulfilled' THEN
  IF TG_TABLE_NAME<>'work_intervals' OR NEW.change_kind<>'close' OR NEW.reason IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_UNFULFILLED_TIME_REQUIRED';END IF;
  PERFORM 1 FROM crest.jobs WHERE business_id=NEW.business_id AND id=NEW.job_id AND operator_actor_id=NEW.operator_actor_id AND state IN('in_progress','paused') AND fulfillment_mode='mobile' AND first_work_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_UNFULFILLED_TIME_REQUIRED';END IF;
 END IF;
 IF command='operations.job.interrupt' THEN$branch$);
 IF updated=definition OR position('CREST_UNFULFILLED_TIME_REQUIRED' IN updated)=0 THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.validate_booking_reservation()'::regprocedure);
 updated:=replace(definition,'command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'')','command_type IN(''operations.job.reschedule'',''operations.job.cancel'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_amendment_allocation_binding()'::regprocedure);
 updated:=replace(definition,'o.command_type IN(''operations.job.complete'',''operations.job.interrupt'')','o.command_type IN(''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_quote_amendment_accept_operation()'::regprocedure);
 updated:=replace(definition,'old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'')','old_operation.command_type IN(''operations.job.book'',''operations.job.reschedule'',''operations.job.cancel'',''operations.job.field'',''operations.job.complete'',''operations.job.interrupt'',''operations.job.cancel_unfulfilled'')');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_completion_source()'::regprocedure);
 updated:=replace(definition,'AND command_type=''operations.job.complete'' AND schema_version=1','AND(command_type=''operations.job.complete'' OR command_type=''operations.job.cancel_unfulfilled'' AND TG_TABLE_NAME=''work_scope_outcomes'') AND schema_version=1');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_completion_source_audit()'::regprocedure);
 updated:=replace(definition,'AND o.command_type=''operations.job.complete'' AND o.schema_version=1','AND(o.command_type=''operations.job.complete'' OR o.command_type=''operations.job.cancel_unfulfilled'' AND TG_TABLE_NAME=''work_scope_outcomes'') AND o.schema_version=1');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_UNFULFILLED_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/unfulfilled-work-cancellation.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/support-trip-commands.sql
-- BR07/BR09: explicit support trips, independent of work/custody/finance.
-- Held construction over registered53 plus the reviewed field proposals.
-- No registered migration, owner activation or complete export/recovery claim.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.unfulfilled_job_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_private.support_trip_result(uuid,uuid,uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'baa7e8ad3f6b2e1a8087391b691c1a33d16cd32caf9489a5a2f7da437c320233'),
   ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'416267706a70e59b2e7ecec29c5feafbb3dfc0092033b0a6d18d6f52e747395d'),
   ('crest_private.field_check_projection()','crest_booking_integrity_owner',true,'cc140fdbafbbc44d75a8ba22c262e3567d31697d6d849e468b06e3d748bb54ab'),
   ('crest_private.field_check_source_audit()','crest_booking_integrity_owner',true,'3ef64b7f5372eb9a567521d626f13c0611400cb778e69640e82005f4a310977a'),
   ('crest_private.field_project_source()','crest_booking_integrity_owner',true,'e44469795a08c9961b241118761ca1cf0f8f9f2f06d6ca6960fb1d7c4d314320'),
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'ec29bdbaf71de87c49e5d4e1ecc1804486775517a93634173cc8c2eeb0e25acd'),
   ('crest_private.field_travel_projection(crest.travel_legs)','crest_booking_integrity_owner',false,'2335d1a4f81e8c0042ab757314dfe758d98bbced80a07850d9c62a67ccc3985d'),
   ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'762fd122ccdb954a9f48278cf9081687d91838bb66bb00f77304b5d2cdf31bd4')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.operator_controls'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SUPPORT_SOURCE_REQUIRED';END IF;
END $review$;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY support_trip_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct'));
CREATE POLICY support_trip_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY support_trip_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.support_trip.record','operations.support_trip.correct'));
CREATE POLICY support_trip_integrity_read ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner USING(command_type IN('operations.support_trip.record','operations.support_trip.correct') AND schema_version=1);
GRANT SELECT(created_at) ON crest_private.operations TO crest_booking_integrity_owner;

CREATE FUNCTION crest_private.valid_support_location(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(jsonb_typeof(value)='object' AND value-ARRAY['schemaVersion','kind','locationText','instructions']='{}'::jsonb AND value ?& ARRAY['schemaVersion','kind','locationText','instructions'] AND value->'schemaVersion'='1'::jsonb AND value->>'kind'='manual' AND crest_private.booking_text_required(value->'locationText',2000) AND (value->'instructions'='null'::jsonb OR crest_private.booking_text_required(value->'instructions',2000)),false)
$valid$;
CREATE FUNCTION crest_private.valid_support_instant(value jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE instant timestamptz;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'string' OR (value#>>'{}')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' THEN RETURN false;END IF;
 instant:=(value#>>'{}')::timestamptz;
 RETURN isfinite(instant) AND instant<=recorded AND to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=value#>>'{}';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $valid$;
CREATE FUNCTION crest_private.valid_support_trip_body(body jsonb,recorded timestamptz) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE action text;trip jsonb;keys text[];
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['action','reason','trip']<>'{}'::jsonb OR NOT body ?& ARRAY['action','reason','trip'] OR octet_length(body::text)>32768 THEN RETURN false;END IF;
 action:=body->>'action';trip:=body->'trip';
 IF action IS NULL OR action NOT IN('depart','arrive','cancel','record','correct') OR NOT coalesce(body->'reason'='null'::jsonb OR crest_private.booking_text_required(body->'reason',1000),false) OR action IN('cancel','record','correct') AND body->'reason'='null'::jsonb THEN RETURN false;END IF;
 IF action='arrive' THEN RETURN trip='null'::jsonb;END IF;
 IF action='cancel' THEN RETURN jsonb_typeof(trip)='object' AND trip-ARRAY['actualStop']='{}'::jsonb AND trip ? 'actualStop' AND crest_private.valid_support_location(trip->'actualStop');END IF;
 keys:=ARRAY['drivenVehicleId','jobId','purpose','origin','destination','notes'];IF action IN('record','correct') THEN keys:=keys||ARRAY['departedAt','arrivedAt','state'];END IF;
 IF jsonb_typeof(trip) IS DISTINCT FROM 'object' OR trip-keys<>'{}'::jsonb OR NOT trip ?& keys OR crest_private.booking_uuid(trip->'drivenVehicleId') IS NOT TRUE OR NOT coalesce(trip->'jobId'='null'::jsonb OR crest_private.booking_uuid(trip->'jobId'),false) OR trip->>'purpose' IS NULL OR trip->>'purpose' NOT IN('supply','between_jobs','return_to_base','other') OR crest_private.valid_support_location(trip->'origin') IS NOT TRUE OR crest_private.valid_support_location(trip->'destination') IS NOT TRUE OR NOT coalesce(trip->'notes'='null'::jsonb OR crest_private.booking_text_required(trip->'notes',2000),false) THEN RETURN false;END IF;
 IF action='depart' THEN RETURN true;END IF;
 IF trip->>'state' IS NULL OR trip->>'state' NOT IN('open','closed','cancelled') OR crest_private.valid_support_instant(trip->'departedAt',recorded) IS NOT TRUE THEN RETURN false;END IF;
 RETURN CASE WHEN trip->>'state'='open' THEN trip->'arrivedAt'='null'::jsonb ELSE crest_private.valid_support_instant(trip->'arrivedAt',recorded) AND (trip->>'arrivedAt')::timestamptz>=(trip->>'departedAt')::timestamptz END;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $valid$;
RESET ROLE;
REVOKE ALL ON FUNCTION crest_private.valid_support_location(jsonb),crest_private.valid_support_instant(jsonb,timestamptz),crest_private.valid_support_trip_body(jsonb,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_support_location(jsonb),crest_private.valid_support_instant(jsonb,timestamptz),crest_private.valid_support_trip_body(jsonb,timestamptz) TO crest_booking_owner,crest_booking_integrity_owner;

-- Narrowly map the two new command kinds into the unchanged source invariant.
-- Work intervals and mobile/custody legs cannot use this command.
DO $extend$ DECLARE definition text;updated text;marker text;BEGIN
 definition:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 marker:=' IF command IS NULL OR command NOT IN(''operations.job.field''';
 updated:=replace(definition,marker,$mapping$
 IF command IN('operations.support_trip.record','operations.support_trip.correct') THEN
  IF TG_TABLE_NAME<>'travel_legs' OR NEW.purpose NOT IN('supply','between_jobs','return_to_base','other') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SUPPORT_TRIP_ONLY';END IF;
  command:=CASE command WHEN 'operations.support_trip.correct' THEN 'operations.time.correct' ELSE 'operations.travel.record' END;
 END IF;
$mapping$||marker);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_SOURCE_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;

-- Reuse the existing immutable operator lock row for a first-ever trip.
-- This permits only its audited INSERT, never a job or financial mutation.
DO $operator$ DECLARE definition text;updated text;BEGIN
 definition:=pg_get_functiondef('crest_private.authorize_booking_statement()'::regprocedure);
 updated:=replace(definition,'IF NOT coalesce(kind=''operations.job.cancel_unfulfilled''','IF NOT coalesce(kind IN(''operations.support_trip.record'',''operations.support_trip.correct'') AND TG_OP=''INSERT'' AND TG_TABLE_NAME=''operator_controls'' OR kind=''operations.job.cancel_unfulfilled''');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_OPERATOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.stamp_booking_row()'::regprocedure);
 updated:=replace(definition,' IF kind IS NULL OR kind NOT IN(',$branch$
 IF kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
  IF TG_OP<>'INSERT' OR TG_TABLE_NAME<>'operator_controls' OR NEW.created_by<>actor OR NEW.operator_actor_id<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_OPERATOR_REQUIRED';END IF;
  NEW.created_at:=stamp;RETURN NEW;
 END IF;
$branch$||' IF kind IS NULL OR kind NOT IN(');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_OPERATOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
 definition:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 updated:=replace(definition,'AND ((o.command_type IN(','AND ((o.command_type IN(''operations.support_trip.record'',''operations.support_trip.correct'') AND TG_OP=''INSERT'' AND TG_TABLE_NAME=''operator_controls'' OR o.command_type IN(');
 IF updated=definition THEN RAISE EXCEPTION 'CREST_SUPPORT_OPERATOR_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $operator$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.support_trip_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;l crest.travel_legs;old crest.travel_legs;control crest.operator_controls;a record;request jsonb;body jsonb;trip jsonb;action text;receipt jsonb;audits jsonb;before_row jsonb:='null'::jsonb;
BEGIN
 SELECT state,command_type,schema_version,result_schema_version,result,payload_hash,recovery_epoch,created_at INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('operations.support_trip.record','operations.support_trip.correct');
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;IF o.state<>'committed' THEN RETURN jsonb_build_object('state','unresolved');END IF;
 SELECT * INTO l FROM crest.travel_legs WHERE business_id=business AND operation_id=operation AND created_by=actor;
 IF l.replaces_id IS NOT NULL THEN SELECT * INTO old FROM crest.travel_legs WHERE business_id=business AND id=l.replaces_id;before_row:=crest_private.field_travel_projection(old);END IF;
 SELECT ev.id,ev.entity_kind,ev.entity_id,ev.entity_version,ev.action,ev.reason,ev.delta,ev.origin,ev.import_row_id,ev.created_by INTO a FROM crest_private.audit_events ev WHERE ev.business_id=business AND ev.operation_id=operation AND ev.actor_id=actor AND ev.entity_kind='travel_legs';
 SELECT * INTO control FROM crest.operator_controls WHERE business_id=business AND operator_actor_id=actor;
 SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 request:=o.result->'request';body:=request->'body';trip:=body->'trip';action:=body->>'action';
 receipt:=jsonb_build_object('schemaVersion',1,'commandType',o.command_type,'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',o.recovery_epoch,'legId',l.logical_id,'legVersionId',l.id,'legSequence',l.sequence::text,'legState',l.state,'leg',crest_private.field_travel_projection(l),'operatorControlId',control.id,'mileageReviewRequired',true,'sourceAuditIds',audits);
 IF l.id IS NULL OR a.id IS NULL OR control.id IS NULL OR o.schema_version<>1 OR o.result_schema_version<>1 OR o.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) OR crest_private.valid_support_trip_body(body,l.created_at) IS NOT TRUE
  OR request IS DISTINCT FROM jsonb_build_object('commandType',o.command_type,'schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'legId',l.logical_id,'expectedLegVersionId',l.replaces_id,'body',body) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
  OR o.command_type IS DISTINCT FROM(CASE WHEN action IN('record','correct') THEN 'operations.support_trip.correct' ELSE 'operations.support_trip.record' END)
  OR l.operator_actor_id<>actor OR l.purpose NOT IN('supply','between_jobs','return_to_base','other') OR l.reason IS DISTINCT FROM body->>'reason' OR l.eta_at IS NOT NULL OR l.eta_source IS NOT NULL OR l.eta_calculated_at IS NOT NULL
  OR l.change_kind IS DISTINCT FROM(CASE action WHEN 'depart' THEN 'depart' WHEN 'arrive' THEN 'arrive' WHEN 'cancel' THEN 'cancel' WHEN 'record' THEN 'record' ELSE 'correct' END)
  OR (SELECT count(*) FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)
  OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation)<>1+(CASE WHEN control.operation_id=operation THEN 1 ELSE 0 END)
  OR a.entity_kind<>'travel_legs' OR a.entity_id<>l.logical_id OR a.entity_version<>l.sequence OR a.action IS DISTINCT FROM(CASE WHEN l.sequence=1 THEN 'create' ELSE l.change_kind END) OR a.reason IS DISTINCT FROM l.reason OR a.origin<>'manual' OR a.import_row_id IS NOT NULL OR a.created_by<>actor
  OR a.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.field_travel_projection(l))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_RESULT_REQUIRED';END IF;
 IF control.operation_id=operation AND NOT EXISTS(SELECT 1 FROM crest_private.audit_events ev WHERE ev.business_id=business AND ev.operation_id=operation AND ev.actor_id=actor AND ev.created_by=actor AND ev.entity_kind='operator_controls' AND ev.entity_id=control.id AND ev.entity_version=1 AND ev.action='create' AND ev.reason IS NULL AND ev.origin='manual' AND ev.import_row_id IS NULL AND ev.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.operator_controls_projection(control))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_OPERATOR_REQUIRED';END IF;
 IF action IN('depart','record') THEN
  IF l.sequence<>1 OR l.replaces_id IS NOT NULL OR l.logical_id<>l.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_PREDECESSOR_REQUIRED';END IF;
 ELSE
  IF old.id IS NULL OR old.purpose NOT IN('supply','between_jobs','return_to_base','other') OR old.logical_id<>l.logical_id OR old.operator_actor_id<>actor OR l.sequence<>old.sequence+1 OR old.arrived_at IS NOT NULL AND l.arrived_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_PREDECESSOR_REQUIRED';END IF;
 END IF;
 IF action IN('depart','record','correct') THEN
  IF l.driven_vehicle_id::text IS DISTINCT FROM trip->>'drivenVehicleId' OR l.job_context_id::text IS DISTINCT FROM trip->>'jobId' OR l.purpose IS DISTINCT FROM trip->>'purpose' OR l.origin_snapshot IS DISTINCT FROM trip->'origin' OR l.destination_snapshot IS DISTINCT FROM trip->'destination' OR l.notes IS DISTINCT FROM trip->>'notes' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_BODY_REQUIRED';END IF;
 END IF;
 IF action IN('record','correct') THEN
  IF l.departed_at IS DISTINCT FROM(trip->>'departedAt')::timestamptz OR l.arrived_at IS DISTINCT FROM(trip->>'arrivedAt')::timestamptz OR l.state IS DISTINCT FROM trip->>'state' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_TIME_REQUIRED';END IF;
 ELSIF action='depart' THEN
  IF l.state<>'open' OR l.departed_at<o.created_at OR l.departed_at>l.created_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_TIME_REQUIRED';END IF;
 ELSE
  IF old.state<>'open' OR ROW(l.driven_vehicle_id,l.job_context_id,l.purpose,l.origin_snapshot,l.departed_at,l.notes) IS DISTINCT FROM ROW(old.driven_vehicle_id,old.job_context_id,old.purpose,old.origin_snapshot,old.departed_at,old.notes) OR l.arrived_at<o.created_at OR l.arrived_at>l.created_at
   OR action='arrive' AND(l.state<>'closed' OR l.destination_snapshot IS DISTINCT FROM old.destination_snapshot) OR action='cancel' AND(l.state<>'cancelled' OR l.destination_snapshot IS DISTINCT FROM trip->'actualStop') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_TIME_REQUIRED';END IF;
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.support_trip_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.support_trip_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.support_trip_result(uuid,uuid,uuid) TO crest_booking_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.record_support_trip(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_leg uuid,expected_leg_version uuid,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
DECLARE context jsonb;request jsonb;digest text;claim uuid;existing record;old crest.travel_legs;l crest.travel_legs;control crest.operator_controls;trip jsonb;action text;kind text;family uuid;requested_job uuid;stamp timestamptz;before_row jsonb:='null'::jsonb;audit_id uuid;audits jsonb;receipt jsonb;result jsonb;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_leg IS NULL OR crest_private.valid_support_trip_body(body,clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_INPUT_REQUIRED';END IF;
 action:=body->>'action';trip:=body->'trip';kind:=CASE WHEN action IN('record','correct') THEN 'operations.support_trip.correct' ELSE 'operations.support_trip.record' END;
 IF (action IN('depart','record')) IS DISTINCT FROM(expected_leg_version IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('commandType',kind,'schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'legId',requested_leg,'expectedLegVersionId',expected_leg_version,'body',body);digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,kind,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>kind OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.support_trip_result(requested_business,expected_actor,requested_operation);
  ELSE
   IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||at.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||at.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute at ON at.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND at.attnum>0 AND NOT at.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SUPPORT_SCHEMA_REVIEW_REQUIRED';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO old FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   requested_job:=(trip->>'jobId')::uuid;
   FOR family IN SELECT DISTINCT e.family_id FROM crest.job_encounters e WHERE e.business_id=requested_business AND(e.job_id=requested_job OR e.job_id=old.job_context_id) ORDER BY e.family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   INSERT INTO crest.operator_controls(business_id,operator_actor_id,created_by,operation_id) VALUES(requested_business,expected_actor,expected_actor,requested_operation) ON CONFLICT(business_id,operator_actor_id) DO NOTHING RETURNING * INTO control;
   IF control.id IS NOT NULL THEN PERFORM crest_private.append_booking_audit('operator_controls',control.id,1,'create',NULL,crest_private.operator_controls_projection(control));END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,expected_actor);
   SELECT * INTO control FROM crest.operator_controls WHERE business_id=requested_business AND operator_actor_id=expected_actor;
   SELECT * INTO old FROM crest.current_travel_legs WHERE business_id=requested_business AND logical_id=requested_leg;
   IF expected_leg_version IS NULL AND old.id IS NOT NULL OR expected_leg_version IS NOT NULL AND(old.id IS NULL OR old.id<>expected_leg_version) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='version';END IF;
   IF old.id IS NOT NULL AND(old.operator_actor_id<>expected_actor OR old.purpose NOT IN('supply','between_jobs','return_to_base','other') OR old.sequence>=9223372036854775807) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='leg';END IF;
   IF action IN('arrive','cancel') AND old.state<>'open' OR action='correct' AND old.arrived_at IS NOT NULL AND trip->>'state'='open' THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='state';END IF;
   IF (action='depart' OR action IN('record','correct') AND trip->>'state'='open') AND EXISTS(SELECT 1 FROM crest.current_travel_legs WHERE business_id=requested_business AND operator_actor_id=expected_actor AND state='open' AND logical_id<>requested_leg) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='occupancy';END IF;
   IF action IN('depart','record','correct') THEN
    IF NOT EXISTS(SELECT 1 FROM crest.vehicles WHERE business_id=requested_business AND id=(trip->>'drivenVehicleId')::uuid AND(archived_at IS NULL OR old.id IS NOT NULL AND id=old.driven_vehicle_id)) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='vehicle';END IF;
    IF requested_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job AND operator_actor_id=expected_actor) THEN RAISE EXCEPTION USING ERRCODE='P1941',MESSAGE='job';END IF;
   END IF;
   stamp:=clock_timestamp();
   IF action IN('depart','record','correct') THEN
    INSERT INTO crest.travel_legs(id,business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,notes,change_kind,reason,created_by,operation_id)
    VALUES(CASE WHEN old.id IS NULL THEN requested_leg ELSE gen_random_uuid() END,requested_business,requested_leg,coalesce(old.sequence,0)+1,old.id,expected_actor,(trip->>'drivenVehicleId')::uuid,requested_job,trip->>'purpose',trip->'origin',trip->'destination',CASE WHEN action='depart' THEN stamp ELSE(trip->>'departedAt')::timestamptz END,CASE WHEN action='depart' THEN NULL ELSE(trip->>'arrivedAt')::timestamptz END,CASE WHEN action='depart' THEN 'open' ELSE trip->>'state' END,trip->>'notes',CASE WHEN action='depart' THEN 'depart' WHEN action='record' THEN 'record' ELSE 'correct' END,body->>'reason',expected_actor,requested_operation) RETURNING * INTO l;
   ELSE
    INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,origin_snapshot,destination_snapshot,departed_at,arrived_at,state,notes,change_kind,reason,created_by,operation_id)
    VALUES(requested_business,requested_leg,old.sequence+1,old.id,old.operator_actor_id,old.driven_vehicle_id,old.job_context_id,old.purpose,old.origin_snapshot,CASE WHEN action='cancel' THEN trip->'actualStop' ELSE old.destination_snapshot END,old.departed_at,stamp,CASE WHEN action='cancel' THEN 'cancelled' ELSE 'closed' END,old.notes,action,body->>'reason',expected_actor,requested_operation) RETURNING * INTO l;
   END IF;
   IF old.id IS NOT NULL THEN before_row:=crest_private.field_travel_projection(old);END IF;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',l.logical_id,l.sequence,CASE WHEN l.sequence=1 THEN 'create' ELSE l.change_kind END,l.reason,jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.field_travel_projection(l)),'manual') RETURNING id INTO audit_id;
   SELECT jsonb_agg(id ORDER BY id) INTO audits FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   receipt:=jsonb_build_object('schemaVersion',1,'commandType',kind,'businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'legId',l.logical_id,'legVersionId',l.id,'legSequence',l.sequence::text,'legState',l.state,'leg',crest_private.field_travel_projection(l),'operatorControlId',control.id,'mileageReviewRequired',true,'sourceAuditIds',audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) WHERE business_id=requested_business AND operation_id=requested_operation;
   result:=crest_private.support_trip_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1941' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;RETURN jsonb_build_object('state','conflict','reason',conflict);
  WHEN exclusion_violation THEN RETURN jsonb_build_object('state','conflict','reason','occupancy');
 END;
END $command$;
CREATE FUNCTION crest_commands.lookup_support_trip_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SUPPORT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.support_trip_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_private.check_support_trip_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF NEW.command_type IN('operations.support_trip.record','operations.support_trip.correct') AND crest_private.support_trip_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SUPPORT_RESULT_REQUIRED';END IF;RETURN NULL;
END $check$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_support_trip_result() OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_support_trip_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_support_trip_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER support_trip_original AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_support_trip_result();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_support_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,jsonb),crest_commands.lookup_support_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,jsonb),crest_commands.lookup_support_trip_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/support-trip-commands.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/field-originals.sql
-- Held Phase6 recovery composition. Original identity contains IDs, versions
-- and fixed action names only; never payload hashes, locations or draft values.
-- Reuse the existing fresh-auth retirement and scheduling HTTP boundary.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.support_trip_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,jsonb)','crest_booking_owner',true,'1a6b61ef1fe8c40f537ced5ea9901eb9a88795c0ff743c96bb9eb2284eaed14c'),
   ('crest_private.operation_retirement_result(uuid,uuid,jsonb)','crest_schema_owner',false,'8cf8a2253a531d9335293f89c0b993f4f03ca0c368ec2fdc00749ea56e5586d2'),
   ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'29d98a384b88a6bf066c5b961290bedd1df4aab4bda53186a98ccf697087cf42')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.operator_controls'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_ORIGINAL_SOURCE_REQUIRED';END IF;
END $review$;

DO $extend$ DECLARE definition text;updated text;marker text;BEGIN
 definition:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 marker:=' kind:=v->>''commandType'';r:=v->''reference'';';
 updated:=replace(definition,marker,marker||$branch$
 IF kind IN('operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct') THEN
  keys:=ARRAY['operationId','recoveryEpoch']||(CASE
   WHEN kind='operations.job.field' OR kind='operations.job.interrupt' THEN ARRAY['jobId','expectedJobVersion','action']
   WHEN kind='operations.job.complete' OR kind='operations.job.cancel_unfulfilled' THEN ARRAY['jobId','expectedJobVersion']
   WHEN kind='operations.mileage.record' THEN ARRAY['legId','expectedLegVersionId','expectedEvidenceVersion']
   ELSE ARRAY['legId','expectedLegVersionId','action'] END);
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
  FOREACH key IN ARRAY keys LOOP
   IF key IN('expectedJobVersion','expectedEvidenceVersion') THEN
    IF crest_private.original_operation_version(r->key,key='expectedEvidenceVersion') IS NOT TRUE OR (r->>key)::numeric>=9223372036854775807 THEN RETURN false;END IF;
   ELSIF key='expectedLegVersionId' AND kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
    IF NOT coalesce(r->key='null'::jsonb OR crest_private.original_operation_uuid(r->key),false) THEN RETURN false;END IF;
   ELSIF key<>'action' AND crest_private.original_operation_uuid(r->key) IS NOT TRUE THEN RETURN false;END IF;
  END LOOP;
  IF kind='operations.job.field' THEN RETURN coalesce(r->>'action' IN('depart','arrive','direct_arrive','pause','resume'),false);END IF;
  IF kind='operations.job.interrupt' THEN RETURN coalesce(r->>'action' IN('cancel','reschedule'),false);END IF;
  IF kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
   RETURN coalesce((kind='operations.support_trip.record' AND r->>'action' IN('depart','arrive','cancel') OR kind='operations.support_trip.correct' AND r->>'action' IN('record','correct')) AND ((r->>'action' IN('depart','record'))=(r->'expectedLegVersionId'='null'::jsonb)),false);
  END IF;
  RETURN true;
 END IF;
$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_ORIGINAL_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;

GRANT EXECUTE ON FUNCTION crest_private.original_operation_reference_valid(jsonb),crest_private.original_operation_uuid(jsonb),crest_private.original_operation_version(jsonb,boolean) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_field_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE context jsonb;kind text;operation uuid;result jsonb;receipt jsonb;request jsonb;reference jsonb;actual jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF crest_private.original_operation_reference_valid(original) IS NOT TRUE OR original->>'businessId' IS DISTINCT FROM requested_business::text OR original->>'commandType' NOT IN('operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_ORIGINAL_INPUT_REQUIRED';END IF;
 kind:=original->>'commandType';operation:=(original->'reference'->>'operationId')::uuid;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 result:=CASE kind
  WHEN 'operations.job.field' THEN crest_commands.lookup_field_session_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.job.complete' THEN crest_commands.lookup_completed_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.job.interrupt' THEN crest_commands.lookup_interrupted_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.job.cancel_unfulfilled' THEN crest_commands.lookup_unfulfilled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.mileage.record' THEN crest_commands.lookup_mileage_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  ELSE crest_commands.lookup_support_trip_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) END;
 IF result->>'state'='absent' THEN RETURN result;END IF;
 IF result->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_ORIGINAL_RESULT_REQUIRED';END IF;
 receipt:=result->'receipt';
 IF receipt->>'commandType' IS DISTINCT FROM kind THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 IF kind='operations.mileage.record' THEN
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',receipt->>'recoveryEpoch','legId',receipt->>'legId','expectedLegVersionId',receipt->>'legVersionId','expectedEvidenceVersion',((receipt->>'evidenceSequence')::bigint-1)::text);
 ELSIF kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
  SELECT o.result->'request' INTO request FROM crest_private.operations o WHERE o.business_id=requested_business AND o.operation_id=operation AND o.actor_id=expected_actor AND o.command_type=kind;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',request->>'recoveryEpoch','legId',request->>'legId','expectedLegVersionId',request->'expectedLegVersionId','action',request->'body'->>'action');
 ELSE
  SELECT e.evidence->'request' INTO request FROM crest.job_events e WHERE e.business_id=requested_business AND e.operation_id=operation AND e.created_by=expected_actor;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',request->>'recoveryEpoch','jobId',request->>'jobId','expectedJobVersion',CASE WHEN kind IN('operations.job.field','operations.job.complete') THEN request->>'expectedVersion' ELSE request->>'expectedJobVersion' END);
  IF kind IN('operations.job.field','operations.job.interrupt') THEN reference:=reference||jsonb_build_object('action',CASE WHEN kind='operations.job.field' THEN request->'payload'->>'action' ELSE request->'body'->>'action' END);END IF;
 END IF;
 actual:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'commandType',kind,'reference',reference);
 IF crest_private.original_operation_reference_valid(actual) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_ORIGINAL_SOURCE_REQUIRED';END IF;
 IF actual IS DISTINCT FROM original THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 -- Minimize the recovery response only after the complete typed domain receipt
 -- and its immutable source graph have been verified above. Domain lookups and
 -- history still retain their full original receipt; this is not an export.
 receipt:=jsonb_build_object('schemaVersion',1,'commandType',kind,'businessId',requested_business,'actorId',expected_actor,'operationId',operation,'recoveryEpoch',reference->>'recoveryEpoch',
  'subjectId',CASE WHEN kind LIKE 'operations.job.%' THEN reference->>'jobId' ELSE reference->>'legId' END,
  'sourceRecordId',CASE WHEN kind LIKE 'operations.job.%' THEN receipt->>'jobId' WHEN kind='operations.mileage.record' THEN receipt->>'evidenceId' ELSE receipt->>'legVersionId' END,
  'sourceVersion',CASE WHEN kind LIKE 'operations.job.%' THEN receipt->>'jobVersion' WHEN kind='operations.mileage.record' THEN receipt->>'evidenceSequence' ELSE receipt->>'legSequence' END,
  'sourceAuditIds',coalesce(receipt->'sourceAuditIds',receipt->'auditIds'));
 RETURN jsonb_build_object('schemaVersion',1,'original',actual,'result',jsonb_build_object('state','committed','receipt',receipt));
END $original$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;

-- Keep the existing route/CSRF/rate/auth/error contract. The original scheduling
-- branch remains unchanged; only the seven new typed kinds delegate here.
DO $route$ DECLARE definition text;updated text;marker text;BEGIN
 definition:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 marker:=E'BEGIN\n';
 updated:=replace(definition,marker,marker||$branch$
 IF original->>'commandType' IN('operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct') THEN
  RETURN crest_commands.lookup_field_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_ORIGINAL_ROUTE_REQUIRED';END IF;EXECUTE updated;
END $route$;

RESET ROLE;
-- END REVIEWED planning/proposals/field-originals.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/field-source.sql
-- Held private field source profile. All eleven authoritative tables;
-- same held RR READ ONLY snapshot, fixed dictionary and separate export role.
-- Parent-domain closure/full backup/registered54 are separate required gates.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') IS NULL OR to_regprocedure('crest_commands.field_source_context(uuid)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_private.completion_projection(text,jsonb)','crest_schema_owner',false,'2c93412de606a38d9c294f5634d38be0e722d3cb2183c9aa5ccd9f704b26fe43'),
   ('crest_private.field_travel_projection(crest.travel_legs)','crest_booking_integrity_owner',false,'2335d1a4f81e8c0042ab757314dfe758d98bbced80a07850d9c62a67ccc3985d'),
   ('crest_private.field_work_projection(crest.work_intervals)','crest_booking_integrity_owner',false,'f05335953731b7b1f836ae7e28aa804163874b42a0cf7305938788ad002efcbe'),
   ('crest_private.mileage_projection(text,jsonb)','crest_schema_owner',false,'3b593f3622fbd7e59c2d31e2ac240bed737fe3c9c3f06136074e0cbb61ebe54d')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.message_templates'),('crest.review_requests'),('crest.messages'),('crest.message_events'),('crest.review_request_encounters'),('crest.job_finalization_tasks'),('crest.mileage_evidence'),('crest.leg_job_allocations'),('crest.operator_controls'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_export' AND NOT(rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['crest.work_intervals','crest.travel_legs','crest.work_scope_outcomes','crest.message_templates','crest.review_requests','crest.messages','crest.message_events','crest.review_request_encounters','crest.job_finalization_tasks','crest.mileage_evidence','crest.leg_job_allocations']) t(name) WHERE has_table_privilege('crest_export',t.name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;


SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_booking_integrity_owner;
CREATE POLICY field_source_business_read ON crest.businesses FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE FUNCTION crest_private.field_source_work_intervals_projection(s crest.work_intervals) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'logical_id',s.logical_id::text,'sequence',s.sequence::text,'replaces_id',s.replaces_id::text,'job_id',s.job_id::text,'operator_actor_id',s.operator_actor_id::text,'kind',s.kind::text,'started_at',CASE WHEN s.started_at IS NULL THEN NULL ELSE to_char(s.started_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'ended_at',CASE WHEN s.ended_at IS NULL THEN NULL ELSE to_char(s.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'pause_reason',s.pause_reason::text,'change_kind',s.change_kind::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_work_intervals_projection(crest.work_intervals) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_work_intervals_projection(crest.work_intervals) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_travel_legs_projection(s crest.travel_legs) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'logical_id',s.logical_id::text,'sequence',s.sequence::text,'replaces_id',s.replaces_id::text,'operator_actor_id',s.operator_actor_id::text,'driven_vehicle_id',s.driven_vehicle_id::text,'job_context_id',s.job_context_id::text,'purpose',s.purpose::text,'origin_snapshot',s.origin_snapshot::text,'destination_snapshot',s.destination_snapshot::text,'departed_at',CASE WHEN s.departed_at IS NULL THEN NULL ELSE to_char(s.departed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'arrived_at',CASE WHEN s.arrived_at IS NULL THEN NULL ELSE to_char(s.arrived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'state',s.state::text,'eta_at',CASE WHEN s.eta_at IS NULL THEN NULL ELSE to_char(s.eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'eta_source',s.eta_source::text,'eta_calculated_at',CASE WHEN s.eta_calculated_at IS NULL THEN NULL ELSE to_char(s.eta_calculated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'notes',s.notes::text,'change_kind',s.change_kind::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_travel_legs_projection(crest.travel_legs) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_travel_legs_projection(crest.travel_legs) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_work_scope_outcomes_projection(s crest.work_scope_outcomes) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'job_id',s.job_id::text,'assigned_part_id',s.assigned_part_id::text,'completion_part_id',s.completion_part_id::text,'partition_id',s.partition_id::text,'outcome',s.outcome::text,'scope_description',s.scope_description::text,'completed_cents',s.completed_cents::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_work_scope_outcomes_projection(crest.work_scope_outcomes) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_work_scope_outcomes_projection(crest.work_scope_outcomes) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_message_templates_projection(s crest.message_templates) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'purpose',s.purpose::text,'sequence',s.sequence::text,'body_template',s.body_template::text,'active',s.active,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_message_templates_projection(crest.message_templates) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_message_templates_projection(crest.message_templates) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_review_requests_projection(s crest.review_requests) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'job_id',s.job_id::text,'customer_id',s.customer_id::text,'is_primary',s.is_primary,'message_id',s.message_id::text,'state',s.state::text,'suppression_reason',s.suppression_reason::text,'reason',s.reason::text,'additional_request_reason',s.additional_request_reason::text,'duplicate_count',s.duplicate_count::text,'customer_version',s.customer_version::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text,'recipient_snapshot',s.recipient_snapshot::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_review_requests_projection(crest.review_requests) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_review_requests_projection(crest.review_requests) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_messages_projection(s crest.messages) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'job_id',s.job_id::text,'customer_id',s.customer_id::text,'request_id',s.request_id::text,'template_version_id',s.template_version_id::text,'purpose',s.purpose::text,'state',s.state::text,'channel',s.channel::text,'recipient_snapshot',s.recipient_snapshot::text,'body_snapshot',s.body_snapshot::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_messages_projection(crest.messages) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_messages_projection(crest.messages) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_message_events_projection(s crest.message_events) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'job_id',s.job_id::text,'message_id',s.message_id::text,'kind',s.kind::text,'effective_at',CASE WHEN s.effective_at IS NULL THEN NULL ELSE to_char(s.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_message_events_projection(crest.message_events) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_message_events_projection(crest.message_events) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_review_request_encounters_projection(s crest.review_request_encounters) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'job_id',s.job_id::text,'request_id',s.request_id::text,'job_encounter_id',s.job_encounter_id::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_review_request_encounters_projection(crest.review_request_encounters) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_review_request_encounters_projection(crest.review_request_encounters) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_job_finalization_tasks_projection(s crest.job_finalization_tasks) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'job_id',s.job_id::text,'kind',s.kind::text,'state',s.state::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_job_finalization_tasks_projection(crest.job_finalization_tasks) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_job_finalization_tasks_projection(crest.job_finalization_tasks) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_mileage_evidence_projection(s crest.mileage_evidence) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'leg_id',s.leg_id::text,'leg_version_id',s.leg_version_id::text,'operator_actor_id',s.operator_actor_id::text,'sequence',s.sequence::text,'replaces_id',s.replaces_id::text,'source',s.source::text,'movement_kind',s.movement_kind::text,'actual_miles',s.actual_miles::text,'estimate_miles',s.estimate_miles::text,'estimate_source',s.estimate_source::text,'odometer_start',s.odometer_start::text,'odometer_end',s.odometer_end::text,'allocation_state',s.allocation_state::text,'notes',s.notes::text,'reason',s.reason::text,'confirmed_at',CASE WHEN s.confirmed_at IS NULL THEN NULL ELSE to_char(s.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'confirmed_by',s.confirmed_by::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_mileage_evidence_projection(crest.mileage_evidence) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_mileage_evidence_projection(crest.mileage_evidence) TO crest_booking_integrity_owner;
CREATE FUNCTION crest_private.field_source_leg_job_allocations_projection(s crest.leg_job_allocations) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $p$ SELECT jsonb_build_object('id',s.id::text,'business_id',s.business_id::text,'evidence_id',s.evidence_id::text,'leg_id',s.leg_id::text,'job_id',s.job_id::text,'fraction',s.fraction::text,'reason',s.reason::text,'created_at',CASE WHEN s.created_at IS NULL THEN NULL ELSE to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_by',s.created_by::text,'operation_id',s.operation_id::text,'origin',s.origin::text) $p$;
REVOKE ALL ON FUNCTION crest_private.field_source_leg_job_allocations_projection(crest.leg_job_allocations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.field_source_leg_job_allocations_projection(crest.leg_job_allocations) TO crest_booking_integrity_owner;
RESET ROLE;
GRANT USAGE ON SCHEMA crest_commands TO crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid) TO crest_booking_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.field_source_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb;counts jsonb;total numeric;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_FIELD_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_SOURCE_SCOPE_REQUIRED';END IF;
 IF(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_SOURCE_SCOPE_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT jsonb_build_object('work_intervals',(SELECT count(*)::text FROM crest.work_intervals WHERE business_id=requested_business),'travel_legs',(SELECT count(*)::text FROM crest.travel_legs WHERE business_id=requested_business),'work_scope_outcomes',(SELECT count(*)::text FROM crest.work_scope_outcomes WHERE business_id=requested_business),'message_templates',(SELECT count(*)::text FROM crest.message_templates WHERE business_id=requested_business),'review_requests',(SELECT count(*)::text FROM crest.review_requests WHERE business_id=requested_business),'messages',(SELECT count(*)::text FROM crest.messages WHERE business_id=requested_business),'message_events',(SELECT count(*)::text FROM crest.message_events WHERE business_id=requested_business),'review_request_encounters',(SELECT count(*)::text FROM crest.review_request_encounters WHERE business_id=requested_business),'job_finalization_tasks',(SELECT count(*)::text FROM crest.job_finalization_tasks WHERE business_id=requested_business),'mileage_evidence',(SELECT count(*)::text FROM crest.mileage_evidence WHERE business_id=requested_business),'leg_job_allocations',(SELECT count(*)::text FROM crest.leg_job_allocations WHERE business_id=requested_business)) INTO counts;
 SELECT sum((value#>>'{}')::numeric) INTO total FROM jsonb_each(counts);IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_FIELD_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.field-sources.v1','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.field.sources/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),'historySnapshotToken',history->>'snapshotToken','observedAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expectedCounts',counts);
END $context$;
CREATE FUNCTION crest_commands.field_source_page(requested_business uuid,expected_snapshot text,requested_group text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.field_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL OR requested_group NOT IN('work_intervals','travel_legs','work_scope_outcomes','message_templates','review_requests','messages','message_events','review_request_encounters','job_finalization_tasks','mileage_evidence','leg_job_allocations') OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_SOURCE_PAGE_REQUIRED';END IF;
 EXECUTE format('WITH page AS MATERIALIZED(SELECT * FROM crest.%I WHERE business_id=$1 AND($2 IS NULL OR id>$2) ORDER BY id LIMIT $3) SELECT jsonb_build_object(''schemaVersion'',1,''businessId'',$1,''snapshotToken'',$4,''group'',$5,''rows'',coalesce((SELECT jsonb_agg(crest_private.%I(p::crest.%I) ORDER BY p.id) FROM page p),''[]''::jsonb),''hasMore'',EXISTS(SELECT 1 FROM crest.%I later WHERE later.business_id=$1 AND later.id>(SELECT id FROM page ORDER BY id DESC LIMIT 1)))',requested_group,'field_source_'||requested_group||'_projection',requested_group,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_FIELD_SOURCE_PAGE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.field_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.field_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_commands.field_source_context(uuid),crest_commands.field_source_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.field_source_context(uuid),crest_commands.field_source_page(uuid,text,text,uuid,integer) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/field-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/field-parent-source.sql
-- Held field-inclusive parent source profile. Frozen registered53 bytes stay
-- unchanged. Only the two reviewed accepted-source schema fingerprints
-- advances; all read-only snapshot, scope, count and export-role checks remain.
DO $review$
BEGIN
 IF to_regprocedure('crest_commands.field_source_context(uuid)') IS NULL
  OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>53
  OR EXISTS(SELECT 1 FROM (VALUES
   ('crest_commands.booking_source_snapshot_context(uuid)','crest_booking_owner','6cec477914b0a3ed7b97ba5349dfbe14021e9e0fbc4339d24345ee88ad4cb072'),
   ('crest_commands.field_source_context(uuid)','crest_booking_integrity_owner','6fc110b1bbab0fe1b2ff1038ba3b7fed73ba96d01699d74e0ea746e31a4935f7'),
   ('crest_commands.quote_amendment_accepted_source_context(uuid)','crest_quote_owner','3affd285717ad8920f00816c3063ad468382af1083e445164e77c4dc1344a641'),
   ('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)','crest_booking_owner','98327c579ee89fa08e35aeeefd854e72d29edb03030249b65325627e517bdf45'),
   ('crest_commands.quote_commercial_snapshot_context(uuid)','crest_quote_owner','9da5f41d56e7afa4421a4e8fbf6e5e7879e5a6193d3772e7b82dbae270e9bce7'),
   ('crest_commands.quote_review_snapshot_context(uuid)','crest_quote_owner','ed01a02fa6ce128b370ae288ba5b43c99a86a45856ca2129ae85b78e815706d3')
  ) e(signature,owner,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
   LEFT JOIN pg_roles r ON r.oid=p.proowner
   WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR NOT p.prosecdef OR p.proleakproof
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
    OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_booking_owner','crest_booking_integrity_owner')
   AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole)
   OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a
   WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('crest','crest_private') AND c.relkind IN('r','p') AND (c.relowner<>'crest_schema_owner'::regrole OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND (has_schema_privilege('crest_quote_owner',oid,'CREATE') OR has_schema_privilege('crest_booking_owner',oid,'CREATE')))
  OR (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY (n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex')
   FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid
   WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped)
    IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner,crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
DO $replace$
DECLARE original text;updated text;
BEGIN
 original:=pg_get_functiondef('crest_commands.quote_amendment_accepted_source_context(uuid)'::regprocedure);
 IF (length(original)-length(replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','')))/64<>1
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED';END IF;
 updated:=replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3');
 EXECUTE updated;
END $replace$;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
DO $replace$
DECLARE original text;updated text;
BEGIN
 original:=pg_get_functiondef('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)'::regprocedure);
 IF (length(original)-length(replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','')))/64<>1
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_PARENT_SOURCE_REVIEW_REQUIRED';END IF;
 updated:=replace(original,'88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7','6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3');
 EXECUTE updated;
END $replace$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner,crest_booking_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/field-parent-source.sql
