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
