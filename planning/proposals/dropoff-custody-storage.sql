-- P08/BR08 storage candidate for per-vehicle Customer Drop-Off handoffs.
-- Held for command, audit, attachment, portability and restore integration.
-- This candidate exercises explicit missing-photo evidence in the fixture.
-- The authorization and verified-photo paths are prerequisites to activation.

SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest.job_vehicles ADD CONSTRAINT custody_job_vehicle_identity
 UNIQUE (business_id,id,job_id,vehicle_id);

CREATE TABLE crest.custody_cases (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 mode text NOT NULL CHECK (mode='dropoff'),
 version bigint NOT NULL,
 state text NOT NULL,
 current_event_id uuid NOT NULL,
 UNIQUE (business_id,id),
 UNIQUE (business_id,job_vehicle_id),
 CHECK ((version=1 AND state='held') OR (version=2 AND state='released')),
 FOREIGN KEY (business_id,job_vehicle_id,job_id,vehicle_id)
  REFERENCES crest.job_vehicles(business_id,id,job_id,vehicle_id)
);

CREATE UNIQUE INDEX custody_one_held_case_per_vehicle
 ON crest.custody_cases(business_id,vehicle_id) WHERE state='held';

CREATE TABLE crest.custody_events (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 case_id uuid NOT NULL,
 version bigint NOT NULL,
 prior_version bigint,
 action text NOT NULL,
 effective_at timestamptz NOT NULL CHECK (isfinite(effective_at)),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(recorded_at)),
 person_snapshot jsonb NOT NULL,
 location_snapshot jsonb NOT NULL,
 notes text,
 missing_photo_reason text NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL DEFAULT 'manual' CHECK (origin='manual'),
 UNIQUE (business_id,case_id,version),
 UNIQUE (business_id,case_id,id,version),
 UNIQUE (business_id,operation_id),
 CHECK ((version=1 AND prior_version IS NULL AND action='received')
   OR (version=2 AND prior_version IS NOT NULL AND prior_version=1 AND action='released')),
 CHECK (effective_at<=recorded_at),
 FOREIGN KEY (business_id,case_id) REFERENCES crest.custody_cases(business_id,id),
 FOREIGN KEY (business_id,case_id,prior_version) REFERENCES crest.custody_events(business_id,case_id,version),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

ALTER TABLE crest.custody_cases ADD CONSTRAINT custody_case_current_event
 FOREIGN KEY (business_id,id,current_event_id,version)
 REFERENCES crest.custody_events(business_id,case_id,id,version)
 DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE crest.custody_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON crest.custody_cases,crest.custody_events
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;

CREATE VIEW crest_private.dropoff_custody_collection_queue WITH (security_invoker=true,security_barrier=true) AS
 SELECT c.business_id,c.id AS case_id,c.job_id,c.job_vehicle_id,c.vehicle_id,e.effective_at AS received_at,
  CASE j.state WHEN 'cancelled' THEN 'return_required' ELSE 'awaiting_collection' END AS collection_state
 FROM crest.custody_cases c
 JOIN crest.jobs j ON j.business_id=c.business_id AND j.id=c.job_id
 JOIN crest.custody_events e ON e.business_id=c.business_id AND e.case_id=c.id AND e.id=c.current_event_id
 WHERE c.state='held' AND j.state IN ('completed','cancelled');
REVOKE ALL ON crest_private.dropoff_custody_collection_queue FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;

CREATE FUNCTION crest_private.guard_dropoff_custody_case() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $case$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.version=1 AND NEW.state='held' THEN RETURN NEW; END IF;
 ELSIF OLD.state='held' AND NEW.state='released' AND NEW.version=2
  AND NEW.current_event_id<>OLD.current_event_id
  AND (to_jsonb(NEW)-ARRAY['state','version','current_event_id'])
    =(to_jsonb(OLD)-ARRAY['state','version','current_event_id']) THEN
  RETURN NEW;
 END IF;
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_CASE_TRANSITION_REQUIRED';
END $case$;

CREATE FUNCTION crest_private.guard_dropoff_custody_event() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $event$
DECLARE c crest.custody_cases; job crest.jobs; intake crest.custody_events;
BEGIN
 -- These restricted validators depend on private schema grants. Apply them
 -- to writes, after the dump has restored data and its final schema grants.
 IF (jsonb_typeof(NEW.person_snapshot)='object'
   AND NEW.person_snapshot ?& ARRAY['schemaVersion','displayName']
   AND NEW.person_snapshot-ARRAY['schemaVersion','displayName']='{}'::jsonb
   AND NEW.person_snapshot->'schemaVersion'='1'::jsonb
   AND crest_private.booking_text_required(NEW.person_snapshot->'displayName',200)) IS NOT TRUE
  OR crest_private.valid_support_location(NEW.location_snapshot) IS NOT TRUE
  OR (NEW.notes IS NOT NULL AND NOT crest_private.booking_text_required(to_jsonb(NEW.notes),1000))
  OR (NEW.missing_photo_reason IS NOT NULL
    AND crest_private.booking_text_required(to_jsonb(NEW.missing_photo_reason),1000) IS NOT TRUE) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_HANDOFF_EVIDENCE_INVALID';
 END IF;
 SELECT * INTO c FROM crest.custody_cases
 WHERE business_id=NEW.business_id AND id=NEW.case_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_CUSTODY_CASE_REQUIRED'; END IF;

 -- Job state is only a prerequisite. Custody actions never start labor or
 -- create travel. The share lock serializes this check with a work-state write.
 SELECT * INTO job FROM crest.jobs
 WHERE business_id=c.business_id AND id=c.job_id FOR SHARE;
 SELECT * INTO STRICT c FROM crest.custody_cases
 WHERE business_id=NEW.business_id AND id=NEW.case_id FOR UPDATE;
 IF job.id IS NULL OR job.fulfillment_mode<>c.mode OR c.state<>'held' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_DROP_OFF_REQUIRED';
 END IF;

 NEW.recorded_at:=clock_timestamp();
 IF NEW.action='received' THEN
  IF job.state='scheduled' AND c.version=1 AND c.current_event_id=NEW.id THEN RETURN NEW; END IF;
 ELSIF NEW.action='released' THEN
  SELECT * INTO intake FROM crest.custody_events
  WHERE business_id=c.business_id AND case_id=c.id AND version=1;
  IF FOUND AND job.state IN ('completed','cancelled') AND NEW.effective_at>=intake.effective_at
   AND (job.state='cancelled' OR NEW.effective_at>=job.completed_at)
   AND NEW.recorded_at>=intake.recorded_at THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_HANDOFF_EVIDENCE_REQUIRED';
END $event$;

CREATE FUNCTION crest_private.check_dropoff_custody_head() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $head$
DECLARE c crest.custody_cases; event crest.custody_events;
BEGIN
 SELECT * INTO c FROM crest.custody_cases
 WHERE business_id=NEW.business_id AND id=(to_jsonb(NEW)->>CASE TG_TABLE_NAME
  WHEN 'custody_cases' THEN 'id' ELSE 'case_id' END)::uuid;
 SELECT * INTO event FROM crest.custody_events
 WHERE business_id=c.business_id AND case_id=c.id ORDER BY version DESC LIMIT 1;
 IF NOT FOUND OR event.id IS DISTINCT FROM c.current_event_id OR event.version IS DISTINCT FROM c.version THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_HEAD_MISMATCH';
 END IF;
 RETURN NULL;
END $head$;

CREATE TRIGGER custody_case_transition BEFORE INSERT OR UPDATE ON crest.custody_cases
 FOR EACH ROW EXECUTE FUNCTION crest_private.guard_dropoff_custody_case();
CREATE TRIGGER custody_event_validate BEFORE INSERT ON crest.custody_events
 FOR EACH ROW EXECUTE FUNCTION crest_private.guard_dropoff_custody_event();
CREATE TRIGGER custody_case_retain BEFORE DELETE OR TRUNCATE ON crest.custody_cases
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
CREATE TRIGGER custody_event_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_events
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
CREATE CONSTRAINT TRIGGER custody_case_head AFTER INSERT OR UPDATE ON crest.custody_cases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_custody_head();
CREATE CONSTRAINT TRIGGER custody_event_head AFTER INSERT ON crest.custody_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_custody_head();


CREATE FUNCTION crest_private.dropoff_custody_snapshot(c crest.custody_cases,e crest.custody_events) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object(
  'schemaVersion',1,'caseId',c.id,'jobId',c.job_id,'jobVehicleId',c.job_vehicle_id,'vehicleId',c.vehicle_id,
  'eventId',e.id,'version',e.version::text,'action',e.action,
  'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person',e.person_snapshot,'location',e.location_snapshot,'notes',e.notes,'missingPhotoReason',e.missing_photo_reason
 )
$snapshot$;

CREATE UNIQUE INDEX custody_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version)
 WHERE entity_kind='custody_cases';

CREATE FUNCTION crest_private.check_dropoff_custody_audit() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $audit$
DECLARE c crest.custody_cases; prior crest.custody_events; before_row jsonb:='null'::jsonb;
BEGIN
 SELECT * INTO STRICT c FROM crest.custody_cases WHERE business_id=NEW.business_id AND id=NEW.case_id;
 IF NEW.prior_version IS NOT NULL THEN
  SELECT * INTO STRICT prior FROM crest.custody_events
  WHERE business_id=NEW.business_id AND case_id=NEW.case_id AND version=NEW.prior_version;
  before_row:=crest_private.dropoff_custody_snapshot(c,prior);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.operations o
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.created_by
    AND o.command_type='operations.custody.save' AND o.state='committed' AND o.schema_version=1
    AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL
    AND o.result=jsonb_build_object('schemaVersion',1,'caseId',NEW.case_id,'eventId',NEW.id,'version',NEW.version::text))
  OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by
    AND a.entity_kind='custody_cases' AND a.entity_id=NEW.case_id AND a.entity_version=NEW.version
    AND a.action=NEW.action AND a.effective_at=NEW.effective_at AND a.origin='manual' AND a.import_row_id IS NULL
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.dropoff_custody_snapshot(c,NEW)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $audit$;

CREATE CONSTRAINT TRIGGER custody_event_verified_audit AFTER INSERT ON crest.custody_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_custody_audit();

REVOKE ALL ON FUNCTION crest_private.guard_dropoff_custody_case(),
 crest_private.guard_dropoff_custody_event(),crest_private.check_dropoff_custody_head(),
 crest_private.dropoff_custody_snapshot(crest.custody_cases,crest.custody_events),crest_private.check_dropoff_custody_audit() FROM PUBLIC;

RESET ROLE;
