-- P08/BR08 per-vehicle Drop-Off custody, work, collection and retained source.
-- The migration coordinator owns one atomic transaction.
RESET ROLE;

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-storage.sql
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

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-storage.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-photos.sql
-- Held over the Drop-Off policy candidate. Storage only. No upload, browser
-- read, publication authority or production activation is granted here.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.custody_photo_attempts (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 job_vehicle_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 -- The receipt attempt can precede creation of this case. Publication and
 -- handoff must recheck the live case and job under their existing lock.
 case_id uuid NOT NULL,
 handoff_version smallint NOT NULL CHECK (handoff_version IN (1,2)),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 dispatch_id uuid NOT NULL UNIQUE,
 declared_type text NOT NULL CHECK (declared_type IN ('image/jpeg','image/png','image/heic')),
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(reserved_at)),
 UNIQUE (business_id,id),
 UNIQUE (business_id,id,declared_type,byte_size),
 FOREIGN KEY (business_id,job_vehicle_id,job_id,vehicle_id)
  REFERENCES crest.job_vehicles(business_id,id,job_id,vehicle_id),
 FOREIGN KEY (business_id,job_id,actor_id) REFERENCES crest.jobs(business_id,id,operator_actor_id),
 FOREIGN KEY (business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);

CREATE TABLE crest.custody_photo_originals (
 business_id uuid NOT NULL,
 photo_id uuid NOT NULL,
 detected_type text NOT NULL,
 byte_size integer NOT NULL,
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 validation_version text NOT NULL,
 width integer NOT NULL CHECK (width > 0),
 height integer NOT NULL CHECK (height > 0),
 display_width integer,
 display_height integer,
 bit_depth integer,
 preview_sha256 text NOT NULL CHECK (preview_sha256 ~ '^[a-f0-9]{64}$'),
 preview_byte_size integer NOT NULL CHECK (preview_byte_size BETWEEN 1 AND 8388608),
 preview_width integer NOT NULL CHECK (preview_width BETWEEN 1 AND 2048),
 preview_height integer NOT NULL CHECK (preview_height BETWEEN 1 AND 2048),
 verified_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(verified_at)),
 PRIMARY KEY (business_id,photo_id),
 FOREIGN KEY (business_id,photo_id,detected_type,byte_size)
  REFERENCES crest.custody_photo_attempts(business_id,id,declared_type,byte_size),
 CHECK (width::bigint * height <= 60000000),
 CHECK (CASE WHEN detected_type='image/heic' THEN
  (display_width > 0 AND display_height > 0 AND display_width::bigint * display_height <= 60000000
   AND bit_depth BETWEEN 8 AND 16) IS TRUE
  ELSE display_width IS NULL AND display_height IS NULL AND bit_depth IS NULL END),
 CHECK (validation_version = CASE detected_type
  WHEN 'image/heic' THEN 'crest-heic-v1-libheif-1.23.6-libde265-1.1.3-sharp-0.35.5'
  ELSE 'crest-image-v1-sharp-0.35.5' END)
);

ALTER TABLE crest.custody_photo_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_photo_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_photo_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_photo_originals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON crest.custody_photo_attempts,crest.custody_photo_originals
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;

CREATE TRIGGER custody_photo_attempt_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_photo_attempts
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
CREATE TRIGGER custody_photo_original_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_photo_originals
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();

GRANT SELECT ON crest.custody_photo_attempts,crest.custody_photo_originals TO crest_booking_integrity_owner;
CREATE POLICY custody_photo_attempt_check ON crest.custody_photo_attempts
 FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_photo_original_check ON crest.custody_photo_originals
 FOR SELECT TO crest_booking_integrity_owner USING(true);
RESET ROLE;

-- Use from the protected custody save and event guard only. A photo reserved
-- or verified for a different job, case, handoff or recovery epoch never
-- satisfies the requirement. Historical photo reads are a separate contract.
CREATE FUNCTION crest_private.verified_dropoff_photo(
 business uuid, photo uuid, job_vehicle uuid, custody_case uuid,
 handoff integer, epoch uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $photo$
 SELECT EXISTS(
  SELECT 1 FROM crest.custody_photo_attempts a
  JOIN crest.custody_photo_originals o ON (o.business_id,o.photo_id)=(a.business_id,a.id)
  WHERE (a.business_id,a.id,a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch)
       =(business,photo,job_vehicle,custody_case,handoff,epoch)
    AND o.verified_at>=a.reserved_at
 )
$photo$;
ALTER FUNCTION crest_private.verified_dropoff_photo(uuid,uuid,uuid,uuid,integer,uuid)
 OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.verified_dropoff_photo(uuid,uuid,uuid,uuid,integer,uuid)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_private.verified_dropoff_photo(uuid,uuid,uuid,uuid,integer,uuid)
 TO crest_booking_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-photos.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-commands.sql
-- P08/BR08 held command candidate. Apply after Drop-Off storage and photo storage
-- in a disposable synthetic workspace. No owner configuration writer or runtime
-- route is enabled by this proposal.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.custody_authorization_configs (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 mode_version_id uuid NOT NULL,
 acknowledgement_text text,
 condition_photo_required boolean NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,mode_version_id),
 FOREIGN KEY(business_id,mode_version_id) REFERENCES crest.fulfillment_mode_versions(business_id,id),
 CHECK (char_length(acknowledgement_text)<=2000),
 CHECK (btrim(acknowledgement_text,E' \t\n\r')<>'')
);
ALTER TABLE crest.custody_authorization_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_authorization_configs FORCE ROW LEVEL SECURITY;
CREATE TRIGGER custody_config_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_authorization_configs
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();

ALTER TABLE crest.custody_cases ADD COLUMN authorization_config_id uuid NOT NULL,
 ADD CONSTRAINT custody_case_config FOREIGN KEY(business_id,authorization_config_id)
 REFERENCES crest.custody_authorization_configs(business_id,id);
ALTER TABLE crest.custody_events ADD COLUMN acknowledgement_confirmed boolean CHECK(acknowledgement_confirmed IS TRUE OR acknowledgement_confirmed IS NULL);
ALTER TABLE crest.custody_events
 ALTER COLUMN missing_photo_reason DROP NOT NULL,
 ADD COLUMN condition_photo_id uuid,
 ADD CONSTRAINT custody_photo_or_reason CHECK ((condition_photo_id IS NULL) <> (missing_photo_reason IS NULL)),
 ADD CONSTRAINT custody_photo_once UNIQUE(business_id,condition_photo_id),
 ADD CONSTRAINT custody_photo_original FOREIGN KEY(business_id,condition_photo_id)
  REFERENCES crest.custody_photo_originals(business_id,photo_id);

GRANT USAGE ON TYPE crest.custody_authorization_configs,crest.custody_cases,crest.custody_events TO crest_booking_owner,crest_booking_integrity_owner;
GRANT SELECT ON crest.custody_authorization_configs,crest.custody_cases,crest.custody_events TO crest_booking_owner,crest_booking_integrity_owner;
GRANT INSERT ON crest.custody_cases,crest.custody_events TO crest_booking_owner;
GRANT UPDATE(state,version,current_event_id) ON crest.custody_cases TO crest_booking_owner;
GRANT INSERT(effective_at) ON crest_private.audit_events TO crest_booking_owner;
GRANT SELECT(effective_at) ON crest_private.audit_events TO crest_booking_integrity_owner;

CREATE POLICY custody_config_scope ON crest.custody_authorization_configs FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_case_scope ON crest.custody_cases FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_event_scope ON crest.custody_events FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_case_insert ON crest.custody_cases FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND state='held' AND version=1);
CREATE POLICY custody_case_release ON crest.custody_cases FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND state='held')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND state='released' AND version=2);
CREATE POLICY custody_event_insert ON crest.custody_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE POLICY custody_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.custody.save');
CREATE POLICY custody_operation_insert ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.custody.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.save' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.save' AND state='committed');
CREATE POLICY custody_audit_insert ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='custody_cases' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_case_integrity ON crest.custody_cases FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_event_integrity ON crest.custody_events FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_config_integrity ON crest.custody_authorization_configs FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.custody.save');
CREATE POLICY custody_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='custody_cases');

CREATE OR REPLACE FUNCTION crest_private.dropoff_custody_snapshot(c crest.custody_cases,e crest.custody_events) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object(
  'schemaVersion',1,'caseId',c.id,'jobId',c.job_id,'jobVehicleId',c.job_vehicle_id,'vehicleId',c.vehicle_id,
  'eventId',e.id,'version',e.version::text,'action',e.action,
  'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person',e.person_snapshot,'location',e.location_snapshot,'notes',e.notes,'missingPhotoReason',e.missing_photo_reason,
  'authorizationConfigId',c.authorization_config_id,'acknowledgementConfirmed',e.acknowledgement_confirmed
 ) || CASE WHEN e.condition_photo_id IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('conditionPhotoId',e.condition_photo_id) END
$snapshot$;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_custody_snapshot(crest.custody_cases,crest.custody_events)
 TO crest_booking_owner,crest_booking_integrity_owner;
RESET ROLE;

-- Keep the existing exact audit verification when the protected write has
-- returned, including if another statement in the transaction changes context.
ALTER FUNCTION crest_private.check_dropoff_custody_audit() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_dropoff_custody_audit() SECURITY DEFINER;
ALTER FUNCTION crest_private.check_dropoff_custody_audit() SET row_security=on;
ALTER FUNCTION crest_private.check_dropoff_custody_head() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_dropoff_custody_head() SECURITY DEFINER;
ALTER FUNCTION crest_private.check_dropoff_custody_head() SET row_security=on;

CREATE FUNCTION crest_private.check_dropoff_authorization() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE config crest.custody_authorization_configs; booked_mode uuid; booked_vehicle uuid; epoch uuid;
BEGIN
 SELECT a.* INTO config FROM crest.custody_cases c JOIN crest.custody_authorization_configs a
  ON a.business_id=c.business_id AND a.id=c.authorization_config_id
 WHERE c.business_id=NEW.business_id AND c.id=NEW.case_id;
 SELECT j.mode_version_id,c.job_vehicle_id INTO booked_mode,booked_vehicle FROM crest.custody_cases c
 JOIN crest.jobs j ON j.business_id=c.business_id AND j.id=c.job_id
 WHERE c.business_id=NEW.business_id AND c.id=NEW.case_id;
 IF config.id IS NULL OR (NEW.version=1 AND config.mode_version_id IS DISTINCT FROM booked_mode)
  OR (config.condition_photo_required AND NEW.condition_photo_id IS NULL)
  OR NEW.acknowledgement_confirmed IS DISTINCT FROM (CASE WHEN config.acknowledgement_text IS NULL THEN NULL::boolean ELSE true END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_AUTHORIZATION_REQUIRED';END IF;
 IF NEW.condition_photo_id IS NOT NULL THEN
  SELECT o.recovery_epoch INTO epoch FROM crest_private.operations o
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.created_by
    AND o.command_type='operations.custody.save';
  IF NOT crest_private.verified_dropoff_photo(NEW.business_id,NEW.condition_photo_id,booked_vehicle,
    NEW.case_id,NEW.version::integer,epoch) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_REQUIRED';
  END IF;
 END IF;
 RETURN NEW;
END $check$;
ALTER FUNCTION crest_private.check_dropoff_authorization() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_dropoff_authorization() FROM PUBLIC;
CREATE TRIGGER custody_event_authorization BEFORE INSERT ON crest.custody_events
 FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_authorization();

CREATE FUNCTION crest_commands.save_dropoff_handoff(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job_vehicle uuid,requested_case uuid,
 expected_version integer,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; saved record; booked crest.job_vehicles;
 job crest.jobs; current_case crest.custody_cases; prior crest.custody_events; event crest.custody_events;
 policy crest.custody_authorization_configs; config_id uuid; event_id uuid; acknowledgement boolean; before_row jsonb;
 receipt jsonb; conflict text; violated_constraint text; photo_id uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_job_vehicle IS NULL OR requested_case IS NULL OR requested_operation IS NULL
  OR expected_version IS NULL OR expected_version NOT IN(0,1)
  OR jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR NOT(body ?& ARRAY['authorizationConfigId','effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed'])
  OR body-ARRAY['authorizationConfigId','effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed','conditionPhotoId']<>'{}'::jsonb
  OR octet_length(body::text)>16384 OR crest_private.booking_uuid(body->'authorizationConfigId') IS NOT TRUE
  OR crest_private.valid_support_instant(body->'effectiveAt',clock_timestamp()) IS NOT TRUE
  OR body->'acknowledgementConfirmed' NOT IN('null'::jsonb,'true'::jsonb)
  OR (body->'notes'<>'null'::jsonb AND jsonb_typeof(body->'notes') IS DISTINCT FROM 'string')
  OR (CASE WHEN body ? 'conditionPhotoId' THEN
       crest_private.booking_uuid(body->'conditionPhotoId') IS TRUE AND body->'missingPhotoReason'='null'::jsonb
      ELSE jsonb_typeof(body->'missingPhotoReason')='string' END) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_INPUT_REQUIRED';END IF;
 config_id:=(body->>'authorizationConfigId')::uuid;
 photo_id:=(body->>'conditionPhotoId')::uuid;
 acknowledgement:=(body->>'acknowledgementConfirmed')::boolean;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.custody.save','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobVehicleId',requested_job_vehicle,
  'caseId',requested_case,'expectedVersion',expected_version::text,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.custody.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT o.recovery_epoch,o.payload_hash,o.state,o.result INTO saved FROM crest_private.operations o
   WHERE o.business_id=requested_business AND o.actor_id=expected_actor AND o.operation_id=requested_operation
    AND o.command_type='operations.custody.save' AND o.schema_version=1 AND o.result_schema_version=1;
   IF NOT FOUND OR saved.recovery_epoch<>expected_epoch OR saved.payload_hash<>digest OR saved.state<>'committed'
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   receipt:=saved.result;
  ELSE
   SELECT v.* INTO booked FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.id=requested_job_vehicle;
   SELECT j.* INTO job FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=booked.job_id FOR SHARE;
   IF job.id IS NULL OR job.fulfillment_mode<>'dropoff' OR job.operator_actor_id IS DISTINCT FROM expected_actor
    OR (expected_version=0 AND job.state<>'scheduled') OR (expected_version=1 AND job.state NOT IN('completed','cancelled'))
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='job';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.dropoff/1:'||requested_business::text||':'||requested_job_vehicle::text,0));
   SELECT c.* INTO current_case FROM crest.custody_cases c
    WHERE c.business_id=requested_business AND c.job_vehicle_id=requested_job_vehicle;
   IF (expected_version=0 AND current_case.id IS NOT NULL) OR
    (expected_version=1 AND (current_case.id IS DISTINCT FROM requested_case OR current_case.state<>'held'))
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='version';END IF;
   SELECT a.* INTO policy FROM crest.custody_authorization_configs a WHERE a.business_id=requested_business AND a.id=config_id
    AND ((expected_version=0 AND a.mode_version_id=job.mode_version_id) OR a.id=current_case.authorization_config_id);
   IF policy.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='policy';END IF;
   IF (photo_id IS NULL AND policy.condition_photo_required)
    OR (photo_id IS NOT NULL AND NOT crest_private.verified_dropoff_photo(requested_business,photo_id,
         booked.id,requested_case,expected_version+1,expected_epoch))
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='photo';END IF;
   IF acknowledgement IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NULL THEN NULL::boolean ELSE true END)
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='acknowledgement';END IF;

   event_id:=gen_random_uuid();
   IF expected_version=0 THEN
    INSERT INTO crest.custody_cases(id,business_id,job_id,job_vehicle_id,vehicle_id,mode,version,state,current_event_id,authorization_config_id)
    VALUES(requested_case,requested_business,job.id,booked.id,booked.vehicle_id,'dropoff',1,'held',event_id,config_id)
    RETURNING * INTO current_case;
   ELSE
    SELECT e.* INTO STRICT prior FROM crest.custody_events e WHERE e.business_id=requested_business AND e.id=current_case.current_event_id;
    before_row:=crest_private.dropoff_custody_snapshot(current_case,prior);
   END IF;
   INSERT INTO crest.custody_events(id,business_id,case_id,version,prior_version,action,effective_at,person_snapshot,location_snapshot,
    notes,missing_photo_reason,created_by,operation_id,acknowledgement_confirmed,condition_photo_id)
   VALUES(event_id,requested_business,requested_case,expected_version+1,nullif(expected_version,0),
    CASE expected_version WHEN 0 THEN 'received' ELSE 'released' END,(body->>'effectiveAt')::timestamptz,
    body->'person',body->'location',body->>'notes',body->>'missingPhotoReason',expected_actor,requested_operation,acknowledgement,photo_id)
   RETURNING * INTO event;
   IF expected_version=1 THEN
    UPDATE crest.custody_cases SET state='released',version=2,current_event_id=event.id
    WHERE business_id=requested_business AND id=requested_case AND version=1 RETURNING * INTO current_case;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='version';END IF;
   END IF;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'custody_cases',requested_case,event.version,event.action,event.effective_at,
    jsonb_build_object('schemaVersion',1,'before',coalesce(before_row,'null'::jsonb),'after',crest_private.dropoff_custody_snapshot(current_case,event)),'manual');
   receipt:=jsonb_build_object('schemaVersion',1,'caseId',requested_case,'eventId',event.id,'version',event.version::text);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN jsonb_build_object('state','committed','receipt',receipt);
 EXCEPTION WHEN SQLSTATE 'P1980' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME;
  IF violated_constraint='custody_one_held_case_per_vehicle' THEN
   RETURN jsonb_build_object('state','conflict','reason','vehicle_held');
  ELSIF violated_constraint='custody_cases_pkey' THEN
   RETURN jsonb_build_object('state','conflict','reason','version');
  END IF;
  RAISE;
 END;
END $write$;
ALTER FUNCTION crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb) TO crest_web;

CREATE FUNCTION crest_private.dropoff_custody_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; event crest.custody_events; custody crest.custody_cases; prior crest.custody_events;
 audit_id uuid; before_row jsonb:='null'::jsonb; receipt jsonb;
BEGIN
 SELECT o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.custody.save'
  AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT e.* INTO STRICT event FROM crest.custody_events e
 WHERE e.business_id=business AND e.operation_id=operation AND e.created_by=actor;
 SELECT c.* INTO STRICT custody FROM crest.custody_cases c WHERE c.business_id=business AND c.id=event.case_id;
 IF event.prior_version IS NOT NULL THEN
  SELECT e.* INTO STRICT prior FROM crest.custody_events e
  WHERE e.business_id=business AND e.case_id=event.case_id AND e.version=event.prior_version;
  before_row:=crest_private.dropoff_custody_snapshot(custody,prior);
 END IF;
 SELECT a.id INTO STRICT audit_id FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor
  AND a.entity_kind='custody_cases' AND a.entity_id=custody.id AND a.entity_version=event.version
  AND a.action=event.action AND a.effective_at=event.effective_at AND a.origin='manual' AND a.import_row_id IS NULL
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.dropoff_custody_snapshot(custody,event));
 receipt:=jsonb_build_object('schemaVersion',1,'caseId',event.case_id,'eventId',event.id,'version',event.version::text);
 IF saved.result IS DISTINCT FROM receipt THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_ORIGINAL_REQUIRED';
 END IF;
 RETURN jsonb_build_object('recoveryEpoch',saved.recovery_epoch,'jobVehicleId',custody.job_vehicle_id,
  'receipt',receipt,'auditId',audit_id);
END $original$;
ALTER FUNCTION crest_private.dropoff_custody_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_custody_original(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_custody_original(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_commands.read_dropoff_handoff_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,requested_operation uuid,request_schema integer,requested_job_vehicle uuid,requested_case uuid,
 expected_version integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE original jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR original_epoch IS NULL OR requested_operation IS NULL
  OR requested_job_vehicle IS NULL OR requested_case IS NULL OR expected_version IS NULL OR expected_version NOT IN(0,1)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 original:=crest_private.dropoff_custody_original(requested_business,expected_actor,requested_operation);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF original->>'recoveryEpoch' IS DISTINCT FROM original_epoch::text
  OR original->>'jobVehicleId' IS DISTINCT FROM requested_job_vehicle::text
  OR original->'receipt'->>'caseId' IS DISTINCT FROM requested_case::text
  OR original->'receipt'->>'version' IS DISTINCT FROM (expected_version+1)::text
 THEN RETURN jsonb_build_object('state','absent');END IF;
 RETURN jsonb_build_object('state','committed','receipt',original->'receipt','auditId',original->'auditId');
END $read$;
ALTER FUNCTION crest_commands.read_dropoff_handoff_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_dropoff_handoff_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.read_dropoff_handoff_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer) TO crest_web;

CREATE FUNCTION crest_private.check_dropoff_custody_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.dropoff_custody_original(NEW.business_id,NEW.actor_id,NEW.operation_id) IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_ORIGINAL_REQUIRED';END IF;
 RETURN NULL;
END $check$;
ALTER FUNCTION crest_private.check_dropoff_custody_original() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_dropoff_custody_original() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER custody_original_verified AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.custody.save')
 EXECUTE FUNCTION crest_private.check_dropoff_custody_original();

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-commands.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-reads.sql
-- Private per-vehicle read for the held Drop-Off command candidate.
-- The saved booking is the scope. No raw table access is granted.
CREATE FUNCTION crest_commands.read_dropoff_job_custody(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,requested_job uuid,requested_job_vehicle uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL OR requested_job_vehicle IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT jsonb_build_object('schemaVersion',1,'businessId',j.business_id,'jobId',j.id,'jobState',j.state,
   'jobVehicleId',v.id,'vehicleId',v.vehicle_id,'caseId',c.id,'version',coalesce(c.version,0)::text,
   'state',CASE
    WHEN c.state='released' THEN 'released'
    WHEN c.state='held' AND j.state='cancelled' THEN 'return_required'
    WHEN c.state='held' AND j.state='completed' THEN 'awaiting_collection'
    WHEN c.state='held' THEN 'in_custody'
    WHEN j.state='scheduled' THEN 'expected'
    ELSE 'not_received' END,
   'policy',CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,
    'acknowledgementText',a.acknowledgement_text,'conditionPhotoRequired',a.condition_photo_required) END,
   'events',coalesce((SELECT jsonb_agg(crest_private.dropoff_custody_snapshot(c,e) ORDER BY e.version)
     FROM crest.custody_events e WHERE e.business_id=c.business_id AND e.case_id=c.id),'[]'::jsonb))
 INTO result
 FROM crest.jobs j
 JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id AND v.id=requested_job_vehicle
 LEFT JOIN crest.custody_cases c ON c.business_id=v.business_id AND c.job_vehicle_id=v.id
 LEFT JOIN crest.custody_authorization_configs a ON a.business_id=v.business_id AND
  (CASE WHEN c.id IS NULL THEN a.mode_version_id=j.mode_version_id ELSE a.id=c.authorization_config_id END)
 WHERE j.business_id=requested_business AND j.id=requested_job AND j.operator_actor_id=expected_actor AND j.fulfillment_mode='dropoff';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;
ALTER FUNCTION crest_commands.read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.read_dropoff_job_custody(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-reads.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-policy.sql
-- P08/BR08: the owner explicitly sets one immutable policy for a saved
-- Drop-Off-enabled arrangement. Its UUID is the original operation UUID.
SET LOCAL ROLE crest_schema_owner;
GRANT INSERT(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required) ON crest.custody_authorization_configs TO crest_booking_owner;
CREATE POLICY custody_policy_setup ON crest.custody_authorization_configs FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY custody_policy_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.custody.policy.save');
CREATE POLICY custody_policy_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.custody.policy.save' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_policy_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.policy.save' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.policy.save' AND state='committed');
CREATE POLICY custody_policy_audit_append ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND entity_kind='custody_authorization_configs' AND entity_id=operation_id AND entity_version=1 AND action='create'
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_policy_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.custody.policy.save');
CREATE POLICY custody_policy_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='custody_authorization_configs');
RESET ROLE;

CREATE FUNCTION crest_private.dropoff_policy_projection(v crest.custody_authorization_configs) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('id',v.id,'modeVersionId',v.mode_version_id,'acknowledgementText',v.acknowledgement_text,
  'conditionPhotoRequired',v.condition_photo_required)
$projection$;
REVOKE ALL ON FUNCTION crest_private.dropoff_policy_projection(crest.custody_authorization_configs) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_policy_projection(crest.custody_authorization_configs) TO crest_booking_owner,crest_booking_integrity_owner;

CREATE FUNCTION crest_private.dropoff_policy_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; policy crest.custody_authorization_configs; evidence uuid; receipt jsonb;
BEGIN
 SELECT o.recovery_epoch,o.result,o.payload_hash INTO saved FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.custody.policy.save'
  AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT c.* INTO STRICT policy FROM crest.custody_authorization_configs c WHERE c.business_id=business AND c.id=operation;
 receipt:=crest_private.dropoff_policy_projection(policy);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'policy',receipt) OR saved.payload_hash IS DISTINCT FROM
  encode(sha256(convert_to(receipt::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
 SELECT a.id INTO STRICT evidence FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.actor_id=actor AND a.created_by=actor AND a.operation_id=operation
  AND a.entity_kind='custody_authorization_configs' AND a.entity_id=operation AND a.entity_version=1
  AND a.action='create' AND a.origin='manual' AND a.import_row_id IS NULL
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',null,'after',receipt);
 RETURN jsonb_build_object('recoveryEpoch',saved.recovery_epoch,'policy',receipt,'auditId',evidence);
END $original$;
ALTER FUNCTION crest_private.dropoff_policy_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_policy_original(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_policy_original(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_private.check_dropoff_policy_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE operation uuid; actor uuid;
BEGIN
 IF TG_TABLE_NAME='operations' THEN
  operation:=NEW.operation_id;actor:=NEW.actor_id;
 ELSE
  operation:=NEW.id;
  SELECT o.actor_id INTO actor FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=operation
   AND o.command_type='operations.custody.policy.save';
 END IF;
 IF crest_private.dropoff_policy_original(NEW.business_id,actor,operation) IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
 RETURN NULL;
END $check$;
ALTER FUNCTION crest_private.check_dropoff_policy_original() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_dropoff_policy_original() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER custody_policy_verified AFTER INSERT ON crest.custody_authorization_configs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_policy_original();
CREATE CONSTRAINT TRIGGER custody_policy_operation_verified AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.custody.policy.save')
 EXECUTE FUNCTION crest_private.check_dropoff_policy_original();

CREATE FUNCTION crest_commands.save_dropoff_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_mode uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE authority jsonb; claim uuid; stored jsonb; receipt jsonb; digest text; policy crest.custody_authorization_configs;
 conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_mode IS NULL OR requested_operation IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR NOT(body ?& ARRAY['acknowledgementText','conditionPhotoRequired']) OR body-ARRAY['acknowledgementText','conditionPhotoRequired']<>'{}'::jsonb
  OR octet_length(body::text)>8192 OR jsonb_typeof(body->'conditionPhotoRequired') IS DISTINCT FROM 'boolean'
  OR (body->'acknowledgementText'<>'null'::jsonb AND crest_private.booking_text_required(body->'acknowledgementText',2000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_POLICY_INPUT_REQUIRED';END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 receipt:=jsonb_build_object('id',requested_operation,'modeVersionId',requested_mode,
  'acknowledgementText',body->'acknowledgementText','conditionPhotoRequired',body->'conditionPhotoRequired');
 digest:=encode(sha256(convert_to(receipt::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.custody.policy.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   stored:=crest_private.dropoff_policy_original(requested_business,expected_actor,requested_operation);
   IF stored->>'recoveryEpoch' IS DISTINCT FROM expected_epoch::text OR stored->'policy' IS DISTINCT FROM receipt
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM crest.fulfillment_mode_versions v WHERE v.business_id=requested_business AND v.id=requested_mode AND v.dropoff_enabled)
   THEN RAISE EXCEPTION USING ERRCODE='P1981',MESSAGE='mode';END IF;
   INSERT INTO crest.custody_authorization_configs(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required)
   VALUES(requested_operation,requested_business,requested_mode,body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean)
   ON CONFLICT(business_id,mode_version_id) DO NOTHING RETURNING * INTO policy;
   IF policy.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1981',MESSAGE='configured';END IF;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'custody_authorization_configs',policy.id,1,'create',
    jsonb_build_object('schemaVersion',1,'before',null,'after',receipt),'manual');
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'policy',receipt)
   WHERE business_id=requested_business AND operation_id=requested_operation;
   stored:=crest_private.dropoff_policy_original(requested_business,expected_actor,requested_operation);
   IF stored IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN jsonb_build_object('state','committed','policy',stored->'policy','auditId',stored->'auditId');
 EXCEPTION WHEN SQLSTATE 'P1981' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $save$;
ALTER FUNCTION crest_commands.save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) TO crest_web;

CREATE FUNCTION crest_commands.read_dropoff_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_mode uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; policy jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_mode IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_POLICY_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT crest_private.dropoff_policy_projection(c) INTO policy FROM crest.custody_authorization_configs c
 WHERE c.business_id=requested_business AND c.mode_version_id=requested_mode;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(policy,jsonb_build_object('state','absent'));
END $read$;
ALTER FUNCTION crest_commands.read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-policy.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-originals.sql
-- Extend the held custody candidate with Crest's existing original-operation
-- lookup and retirement. The reference contains only opaque IDs and a version.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','96b958cd341204473e998ada2397f6e687782f295a150cc6a26ba7cd7c3ab86d'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','ad0a4283c6e1ebc4a3537647a680dca6e7a4262e83960d687c754890a3237263'),
  ('crest_private.operation_retirement_result(uuid,uuid,jsonb)','crest_schema_owner',false,'v','b4333c16f147af24b46b36652c0aea60f36a0e104e93c8f8ffff9e4aafd85100')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_REVIEW_REQUIRED';END IF;
END $review$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
  OR position('operations.follow_up.save' in source)=0 OR position('operations.custody.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_CUSTODY_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.custody.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobVehicleId','caseId','expectedVersion'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobVehicleId') IS TRUE
   AND crest_private.original_operation_uuid(r->'caseId') IS TRUE
   AND r->'expectedVersion' IN ('"0"'::jsonb,'"1"'::jsonb),false);
 END IF;
 IF kind='operations.custody.policy.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','modeVersionId'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'modeVersionId') IS TRUE,false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_dropoff_custody_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.custody.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_ORIGINAL_REQUIRED';END IF;
 reference:=original->'reference';
 saved:=crest_commands.read_dropoff_handoff_original($1,$2,$3,$4,$5,$6,$7,$8,
  (reference->>'recoveryEpoch')::uuid,(reference->>'operationId')::uuid,1,
  (reference->>'jobVehicleId')::uuid,(reference->>'caseId')::uuid,(reference->>'expectedVersion')::integer);
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.custody.save','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',receipt->'caseId','sourceRecordId',receipt->'eventId',
   'sourceVersion',receipt->'version','sourceAuditIds',jsonb_build_array(saved->'auditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_dropoff_custody_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_dropoff_custody_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION crest_commands.lookup_dropoff_policy_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.custody.policy.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.dropoff_policy_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'recoveryEpoch' IS DISTINCT FROM reference->>'recoveryEpoch'
  OR saved->'policy'->>'modeVersionId' IS DISTINCT FROM reference->>'modeVersionId'
 THEN RETURN jsonb_build_object('state','absent');END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.custody.policy.save','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'modeVersionId','sourceRecordId',saved->'policy'->'id',
   'sourceVersion','1','sourceAuditIds',jsonb_build_array(saved->'auditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_dropoff_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_dropoff_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
  OR position('operations.follow_up.save' in source)=0 OR position('operations.custody.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_CUSTODY_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.custody.save' THEN
  RETURN crest_commands.lookup_dropoff_custody_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
 IF original->>'commandType'='operations.custody.policy.save' THEN
  RETURN crest_commands.lookup_dropoff_policy_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-originals.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-photo-commands.sql
-- Held Drop-Off photo authority. Apply after the custody policy candidate.
-- The isolated validator's connection alone can submit verified metadata.
CREATE ROLE crest_custody_photo_dispatch NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA crest_commands TO crest_custody_photo_dispatch;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT,INSERT ON crest.custody_photo_attempts,crest.custody_photo_originals TO crest_booking_owner;
CREATE POLICY custody_photo_attempt_owner_read ON crest.custody_photo_attempts FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY custody_photo_attempt_owner_insert ON crest.custody_photo_attempts FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY custody_photo_original_owner_read ON crest.custody_photo_originals FOR SELECT TO crest_booking_owner
 USING(EXISTS(SELECT 1 FROM crest.custody_photo_attempts a WHERE a.business_id=custody_photo_originals.business_id
  AND a.id=custody_photo_originals.photo_id));
CREATE POLICY custody_photo_original_owner_insert ON crest.custody_photo_originals FOR INSERT TO crest_booking_owner
 WITH CHECK(EXISTS(SELECT 1 FROM crest.custody_photo_attempts a WHERE a.business_id=custody_photo_originals.business_id
  AND a.id=custody_photo_originals.photo_id));

CREATE POLICY custody_photo_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish'));
CREATE POLICY custody_photo_operation_insert ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish')
 AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_photo_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type IN('operations.custody.photo.reserve','operations.custody.photo.publish') AND state='committed');
CREATE POLICY custody_photo_audit_insert ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND entity_kind='custody_photos' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;

-- Serialize against job changes and the exact handoff, in the same order as
-- save_dropoff_handoff. No operation can attach a photo to a closed slot.
CREATE FUNCTION crest_private.lock_dropoff_photo_slot(
 business uuid, actor uuid, booked_vehicle uuid, custody_case uuid, handoff integer
) RETURNS crest.job_vehicles LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $slot$
DECLARE booked crest.job_vehicles; job crest.jobs; current_case crest.custody_cases;
BEGIN
 SELECT v.* INTO booked FROM crest.job_vehicles v WHERE v.business_id=business AND v.id=booked_vehicle;
 SELECT j.* INTO job FROM crest.jobs j WHERE j.business_id=business AND j.id=booked.job_id FOR SHARE;
 IF job.id IS NULL OR job.operator_actor_id IS DISTINCT FROM actor OR job.fulfillment_mode<>'dropoff'
  OR (handoff=1 AND job.state<>'scheduled') OR (handoff=2 AND job.state NOT IN('completed','cancelled')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_SLOT_UNAVAILABLE';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.dropoff/1:'||business::text||':'||booked_vehicle::text,0));
 SELECT c.* INTO current_case FROM crest.custody_cases c WHERE c.business_id=business AND c.job_vehicle_id=booked_vehicle;
 IF (handoff=1 AND current_case.id IS NOT NULL)
  OR (handoff=2 AND (current_case.id IS DISTINCT FROM custody_case OR current_case.state<>'held'))
  OR NOT EXISTS(SELECT 1 FROM crest.custody_authorization_configs a WHERE a.business_id=business
    AND (CASE WHEN handoff=1 THEN a.mode_version_id=job.mode_version_id ELSE a.id=current_case.authorization_config_id END)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_SLOT_UNAVAILABLE';
 END IF;
 RETURN booked;
END $slot$;

CREATE FUNCTION crest_private.record_dropoff_photo_change(
 a crest.custody_photo_attempts, o crest.custody_photo_originals
) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $audit$
DECLARE publication boolean:=o.photo_id IS NOT NULL;
 original uuid:=CASE WHEN publication THEN a.dispatch_id ELSE a.id END;
 snapshot jsonb:=jsonb_build_object('photoId',a.id,'jobId',a.job_id,'jobVehicleId',a.job_vehicle_id,
  'caseId',a.case_id,'handoffVersion',a.handoff_version,'declaredType',a.declared_type,'byteSize',a.byte_size);
 after_row jsonb;
BEGIN
 after_row:=CASE WHEN publication THEN snapshot||jsonb_build_object('sha256',o.sha256,
  'previewSha256',o.preview_sha256,'validationVersion',o.validation_version) ELSE snapshot END;
 PERFORM set_config('crest.operation_id',original::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,
  payload_hash,created_by,origin)
 VALUES(a.business_id,original,a.actor_id,CASE WHEN publication THEN 'operations.custody.photo.publish'
  ELSE 'operations.custody.photo.reserve' END,1,a.recovery_epoch,
  encode(sha256(convert_to(after_row::text,'UTF8')),'hex'),a.actor_id,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(a.business_id,original,a.actor_id,a.actor_id,'custody_photos',a.id,CASE WHEN publication THEN 2 ELSE 1 END,
  CASE WHEN publication THEN 'publish' ELSE 'reserve' END,jsonb_build_object('schemaVersion',1,'before',
  CASE WHEN publication THEN snapshot ELSE 'null'::jsonb END,'after',after_row),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,
  result=jsonb_build_object('schemaVersion',1,'photoId',a.id,'status',CASE WHEN publication THEN 'verified' ELSE 'reserved' END)
 WHERE business_id=a.business_id AND operation_id=original;
END $audit$;

CREATE FUNCTION crest_commands.reserve_dropoff_photo(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, photo uuid, booked_vehicle uuid, custody_case uuid, handoff integer,
 content_type text, size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE authority jsonb; a crest.custody_photo_attempts; v crest.job_vehicles; stamp timestamptz;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF photo IS NULL OR booked_vehicle IS NULL OR custody_case IS NULL OR handoff IS NULL OR handoff NOT IN(1,2)
  OR content_type IS NULL OR content_type NOT IN('image/jpeg','image/png','image/heic')
  OR size IS NULL OR size NOT BETWEEN 1 AND 26214400 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_PHOTO_INPUT_REQUIRED';
 END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.owner/1:'||requested_business::text||':'||expected_actor::text,0));
 SELECT * INTO a FROM crest.custody_photo_attempts WHERE business_id=requested_business AND id=photo;
 IF a.id IS NOT NULL THEN
  IF (a.job_vehicle_id,a.case_id,a.handoff_version,a.recovery_epoch,a.declared_type,a.byte_size)
   IS DISTINCT FROM (booked_vehicle,custody_case,handoff,expected_epoch,content_type,size) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_RESERVATION_CHANGED';
  END IF;
 ELSE
  v:=crest_private.lock_dropoff_photo_slot(requested_business,expected_actor,booked_vehicle,custody_case,handoff);
  stamp:=clock_timestamp();
  -- V1 is single owner. Count across that owner's sessions so a second
  -- device cannot multiply the documented upload allowance.
  IF (SELECT count(*) FROM crest.custody_photo_attempts s WHERE s.business_id=requested_business
    AND s.actor_id=expected_actor AND s.reserved_at>stamp-interval '1 hour')>=100
   OR (SELECT count(*) FROM crest.custody_photo_attempts s WHERE s.business_id=requested_business
    AND s.actor_id=expected_actor AND s.reserved_at>stamp-interval '10 minutes'
    AND NOT EXISTS(SELECT 1 FROM crest.custody_photo_originals o WHERE (o.business_id,o.photo_id)=(s.business_id,s.id)))>=3 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_LIMIT_REACHED';
  END IF;
  INSERT INTO crest.custody_photo_attempts(id,business_id,job_id,job_vehicle_id,vehicle_id,case_id,handoff_version,
   actor_id,recovery_epoch,dispatch_id,declared_type,byte_size,reserved_at)
  VALUES(photo,requested_business,v.job_id,v.id,v.vehicle_id,custody_case,handoff,expected_actor,expected_epoch,
   gen_random_uuid(),content_type,size,stamp) RETURNING * INTO a;
  PERFORM crest_private.record_dropoff_photo_change(a,NULL::crest.custody_photo_originals);
 END IF;
 PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,a.id);
 RETURN to_jsonb(a);
END $reserve$;

CREATE FUNCTION crest_commands.read_dropoff_photo(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, photo uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT jsonb_build_object('reservation',to_jsonb(a),'original',to_jsonb(o),'linked',EXISTS(
   SELECT 1 FROM crest.custody_events e WHERE e.business_id=a.business_id AND e.condition_photo_id=a.id))
 INTO result FROM crest.custody_photo_attempts a
 JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id AND j.operator_actor_id=expected_actor
 LEFT JOIN crest.custody_photo_originals o ON o.business_id=a.business_id AND o.photo_id=a.id
 WHERE a.business_id=requested_business AND a.id=photo AND a.actor_id=expected_actor;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $read$;

CREATE FUNCTION crest_commands.check_dropoff_photo_upload(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid, expected_epoch uuid, photo uuid
) RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $upload$
DECLARE authority jsonb; a crest.custody_photo_attempts; seconds integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT * INTO a FROM crest.custody_photo_attempts WHERE business_id=requested_business AND id=photo AND recovery_epoch=expected_epoch;
 IF a.id IS NULL OR EXISTS(SELECT 1 FROM crest.custody_photo_originals WHERE business_id=requested_business AND photo_id=photo) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_NOT_PENDING';
 END IF;
 PERFORM crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version);
 seconds:=floor(extract(epoch FROM a.reserved_at+interval '10 minutes'-clock_timestamp()))::integer;
 IF seconds<1 OR seconds>600 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_EXPIRED'; END IF;
 RETURN seconds;
END $upload$;

CREATE FUNCTION crest_commands.publish_dropoff_photo(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, photo uuid, candidate jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $publish$
DECLARE authority jsonb; a crest.custody_photo_attempts; o crest.custody_photo_originals;
 keys constant text[]:=ARRAY['detected_type','byte_size','sha256','validation_version','width','height',
  'display_width','display_height','bit_depth','preview_sha256','preview_byte_size','preview_width','preview_height'];
 incoming crest.custody_photo_originals;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF photo IS NULL OR jsonb_typeof(candidate) IS DISTINCT FROM 'object' OR NOT candidate ?& keys
  OR candidate-keys<>'{}'::jsonb OR octet_length(candidate::text)>4096 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_PHOTO_INPUT_REQUIRED';
 END IF;
 incoming:=jsonb_populate_record(NULL::crest.custody_photo_originals,candidate);
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT * INTO a FROM crest.custody_photo_attempts WHERE business_id=requested_business AND id=photo AND recovery_epoch=expected_epoch;
 IF a.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_RESERVATION_REQUIRED'; END IF;
 -- Publication of a photo ID is single-use, even with concurrent dispatchers.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.custody.photo.publish/1:'||photo::text,0));
 SELECT * INTO o FROM crest.custody_photo_originals WHERE business_id=requested_business AND photo_id=photo;
 IF o.photo_id IS NOT NULL THEN
  IF to_jsonb(o)-ARRAY['business_id','photo_id','verified_at'] IS DISTINCT FROM
     to_jsonb(incoming)-ARRAY['business_id','photo_id','verified_at'] THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_ORIGINAL_CHANGED';
  END IF;
 ELSE
  PERFORM crest_private.lock_dropoff_photo_slot(a.business_id,a.actor_id,a.job_vehicle_id,a.case_id,a.handoff_version);
  IF clock_timestamp()>=a.reserved_at+interval '10 minutes' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_EXPIRED';
  END IF;
  incoming.business_id:=a.business_id; incoming.photo_id:=a.id; incoming.verified_at:=clock_timestamp();
  INSERT INTO crest.custody_photo_originals SELECT incoming.* RETURNING * INTO o;
  PERFORM crest_private.record_dropoff_photo_change(a,o);
 END IF;
 PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,a.dispatch_id);
 RETURN to_jsonb(o);
END $publish$;

REVOKE ALL ON FUNCTION
 crest_private.lock_dropoff_photo_slot(uuid,uuid,uuid,uuid,integer),
 crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals),
 crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer),
 crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,crest_web,crest_worker,crest_export;
ALTER FUNCTION crest_private.lock_dropoff_photo_slot(uuid,uuid,uuid,uuid,integer) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_private.record_dropoff_photo_change(crest.custody_photo_attempts,crest.custody_photo_originals) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer)
 OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION
 crest_commands.reserve_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,integer,text,integer),
 crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_web;
GRANT EXECUTE ON FUNCTION
 crest_commands.read_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.check_dropoff_photo_upload(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.publish_dropoff_photo(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb)
 TO crest_custody_photo_dispatch;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-photo-commands.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-photo-access.sql
-- Held authority for a sensitive original handoff, applied after photo commands.
-- This records an authorized response, never a completed browser download.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY custody_original_access_operation ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access');
CREATE POLICY custody_original_access_claim ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_original_access_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND command_type='operations.custody.photo.access' AND state='committed');
CREATE POLICY custody_original_access_audit_return ON crest_private.audit_events FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND entity_kind='custody_photo_accesses');
CREATE POLICY custody_original_access_audit ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
 AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
 AND entity_kind='custody_photo_accesses' AND entity_id=operation_id AND entity_version=1
 AND action='authorized_handoff' AND origin='manual' AND import_row_id IS NULL
 AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
  AND o.actor_id=audit_events.actor_id AND o.operation_id=audit_events.operation_id
  AND o.command_type='operations.custody.photo.access' AND o.state='pending'));
RESET ROLE;

CREATE FUNCTION crest_commands.record_dropoff_original_access(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid,
 expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 expected_epoch uuid, booked_vehicle uuid, photo uuid, expected_sha256 text, expected_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $access$
DECLARE current_record jsonb; handoff_id uuid; custody_case uuid; operation uuid:=gen_random_uuid(); audit_id uuid;
 evidence jsonb; receipt jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF booked_vehicle IS NULL OR photo IS NULL OR expected_sha256 IS NULL OR expected_sha256 !~ '^[a-f0-9]{64}$'
  OR expected_size IS NULL OR expected_size NOT BETWEEN 1 AND 26214400 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_PHOTO_INPUT_REQUIRED';
 END IF;
 -- Take the existing write fence before the shared read locks. The audit and
 -- the verified handoff must both be current before the server releases bytes.
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 current_record:=crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,photo);
 IF current_record->'linked' IS DISTINCT FROM 'true'::jsonb
  OR current_record->'reservation'->>'job_vehicle_id' IS DISTINCT FROM booked_vehicle::text
  OR current_record->'original'->>'sha256' IS DISTINCT FROM expected_sha256
  OR current_record->'original'->'byte_size' IS DISTINCT FROM to_jsonb(expected_size) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_UNAVAILABLE';
 END IF;
 custody_case:=(current_record->'reservation'->>'case_id')::uuid;
 SELECT e.id INTO handoff_id FROM crest.custody_events e JOIN crest.custody_cases c
  ON c.business_id=e.business_id AND c.id=e.case_id
 WHERE e.business_id=requested_business AND e.condition_photo_id=photo AND e.case_id=custody_case
  AND e.version=(current_record->'reservation'->>'handoff_version')::integer
  AND c.job_vehicle_id=booked_vehicle AND c.job_id=(current_record->'reservation'->>'job_id')::uuid;
 IF handoff_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_UNAVAILABLE';END IF;
 evidence:=jsonb_build_object('photoId',photo,'jobVehicleId',booked_vehicle,'caseId',custody_case,
  'handoffEventId',handoff_id,'sha256',expected_sha256,'byteSize',expected_size,
  'contentType',current_record->'original'->>'detected_type');
 PERFORM set_config('crest.operation_id',operation::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'operations.custody.photo.access',1,expected_epoch,
  encode(sha256(convert_to(evidence::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'custody_photo_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',evidence),'manual') RETURNING id INTO audit_id;
 receipt:=jsonb_build_object('schemaVersion',1,'operationId',operation,'auditEventId',audit_id,'scope',evidence);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation;
 PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,operation);
 IF crest_commands.read_dropoff_photo($1,$2,$3,$4,$5,$6,$7,$8,photo) IS DISTINCT FROM current_record THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_UNAVAILABLE';
 END IF;
 RETURN receipt;
END $access$;
ALTER FUNCTION crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export,crest_custody_photo_dispatch;
GRANT EXECUTE ON FUNCTION crest_commands.record_dropoff_original_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer)
 TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-photo-access.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-work.sql
-- Held schema66 extension. A handoff and an explicit start are separate events.
-- Use the existing work intervals, operator occupancy, and original-save receipts.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.valid_field_session_body(jsonb)','crest_schema_owner',false,'i','0f67989eafedf35f150dc1d81804e98bb4629c50d6852ef0fe35a69250767ca6'),
  ('crest_private.check_field_session_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'v','12123eda2a3e6f7edeee94995d4fb9b9f006d8b12fb1cb1d3e0e614a19488c43'),
  ('crest_private.field_session_result(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'s','d1c52d2bf3d8e4011a48bb72590caa1873162a3cabbda8f4a5d6c2ae07330081'),
  ('crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'v','da5b9cee0b3ebdf8829947ee56feab5dbb51eba61815af39d4d6bea468c7817f'),
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','cd7545acc7b8f1fd277aee8cbd4a137c8b0aeba551914e97639e20baf50a9950')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_WORK_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_private.dropoff_work_ready(business uuid,job uuid,stamp timestamptz)
 RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $ready$
 SELECT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=business AND v.job_id=job)
  AND NOT EXISTS(
   SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=business AND v.job_id=job AND NOT EXISTS(
    SELECT 1 FROM crest.custody_cases c JOIN crest.custody_events e
     ON (e.business_id,e.case_id,e.id,e.version)=(c.business_id,c.id,c.current_event_id,c.version)
    WHERE (c.business_id,c.job_id,c.job_vehicle_id,c.vehicle_id)=(v.business_id,v.job_id,v.id,v.vehicle_id)
     AND c.mode='dropoff' AND c.state='held' AND e.action='received' AND e.effective_at<=stamp
   )
  )
$ready$;
ALTER FUNCTION crest_private.dropoff_work_ready(uuid,uuid,timestamptz) OWNER TO crest_schema_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_work_ready(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_work_ready(uuid,uuid,timestamptz) TO crest_booking_owner,crest_booking_integrity_owner;

DO $extend$
DECLARE source text; definition text;
 action_list constant text:=$text$'depart','arrive','direct_arrive','pause','resume'$text$;
 start_actions constant text:=$text$action IN('direct_arrive','arrive')$text$;
 field_state constant text:=$text$   IF j.fulfillment_mode<>'mobile' OR NOT(action IN('depart','direct_arrive') AND j.state='scheduled' AND j.first_work_at IS NULL OR action='arrive' AND j.state='en_route' AND j.first_work_at IS NULL OR action='pause' AND j.state='in_progress' OR action='resume' AND j.state='paused') THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='state';END IF;$text$;
 field_stamp constant text:=$text$   stamp:=clock_timestamp();before_job:=crest_private.jobs_projection(j);$text$;
BEGIN
 source:=pg_get_functiondef('crest_private.valid_field_session_body(jsonb)'::regprocedure);
 definition:=replace(replace(source,action_list,action_list||$text$,'start_dropoff'$text$),
  $text$'depart','arrive','resume'$text$,$text$'depart','arrive','resume','start_dropoff'$text$);
 EXECUTE definition;

 source:=pg_get_functiondef('crest_private.check_field_session_graph(uuid,uuid,uuid)'::regprocedure);
 definition:=replace(source,
  $text$  OR j.fulfillment_mode<>'mobile' OR j.state NOT IN('en_route','in_progress','paused')$text$,
  $text$  OR NOT(j.fulfillment_mode='mobile' AND action IN('depart','arrive','direct_arrive','pause','resume')
     OR j.fulfillment_mode='dropoff' AND action IN('start_dropoff','pause','resume'))
  OR j.state NOT IN('en_route','in_progress','paused')$text$);
 definition:=replace(definition,start_actions,$text$action IN('direct_arrive','arrive','start_dropoff')$text$);
 definition:=replace(definition,$text$  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_START_GRAPH_REQUIRED';END IF;$text$,
  $text$   OR action='start_dropoff' AND NOT crest_private.dropoff_work_ready(business,job,e.effective_at)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_START_GRAPH_REQUIRED';END IF;$text$);
 EXECUTE definition;

 source:=pg_get_functiondef('crest_private.field_session_result(uuid,uuid,uuid)'::regprocedure);
 EXECUTE replace(source,$text$'direct_arrive','depart'$text$,$text$'direct_arrive','depart','start_dropoff'$text$);

 source:=pg_get_functiondef('crest_commands.change_field_session(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)'::regprocedure);
 definition:=replace(source,field_state,$text$   IF NOT(
    j.fulfillment_mode='mobile' AND (action IN('depart','direct_arrive') AND j.state='scheduled' AND j.first_work_at IS NULL
      OR action='arrive' AND j.state='en_route' AND j.first_work_at IS NULL)
    OR j.fulfillment_mode='dropoff' AND action='start_dropoff' AND j.state='scheduled' AND j.first_work_at IS NULL
    OR j.fulfillment_mode IN('mobile','dropoff') AND (action='pause' AND j.state='in_progress' OR action='resume' AND j.state='paused')
   ) THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='state';END IF;$text$);
 definition:=replace(definition,field_stamp,field_stamp||$text$
   IF action='start_dropoff' AND NOT crest_private.dropoff_work_ready(requested_business,j.id,stamp)
   THEN RAISE EXCEPTION USING ERRCODE='P1801',MESSAGE='custody';END IF;$text$);
 EXECUTE definition;

 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 EXECUTE replace(source,action_list,action_list||$text$,'start_dropoff'$text$);
END $extend$;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-work.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-completion.sql
-- Held schema66 extension after the Drop-Off custody and work overlays.
-- End the existing work interval and retain scope, review and finalization
-- evidence. Vehicle custody still changes only through its handoff command.
DO $review$
DECLARE entry record; function_id regprocedure; definition text;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_private.check_completed_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner','1d27a4e7ba8d7a56485be8c2157447cd616def74c99eb405df0340b8cd4f03ee',
   $mode$j.fulfillment_mode<>'mobile'$mode$,$mode$j.fulfillment_mode NOT IN('mobile','dropoff')$mode$,1),
  ('crest_commands.complete_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','5f120de35b3cc421cc441813a2fdb7005afec57a7ec45a47e3a846541dbcad1c',
   $mode$j.fulfillment_mode<>'mobile'$mode$,$mode$j.fulfillment_mode NOT IN('mobile','dropoff')$mode$,1),
  ('crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','crest_booking_owner','81a7b0637eec01ae6bbdc4bd92293efe88a22fe1cff6287ea4b1d7d233773e60',
   $mode$j.fulfillment_mode='mobile'$mode$,$mode$j.fulfillment_mode IN('mobile','dropoff')$mode$,2)
 ) expected(signature,owner,body_hash,marker,replacement,occurrences) LOOP
  function_id:=to_regprocedure(entry.signature);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=function_id AND p.proowner=entry.owner::regrole AND p.prosecdef AND NOT p.proleakproof
    AND p.provolatile='v' AND l.lanname='plpgsql' AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.body_hash
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_COMPLETION_SOURCE_REVIEW_REQUIRED';END IF;
  definition:=pg_get_functiondef(function_id);
  IF (length(definition)-length(replace(definition,entry.marker,'')))/length(entry.marker)<>entry.occurrences
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_COMPLETION_SOURCE_REVIEW_REQUIRED';END IF;
  EXECUTE replace(definition,entry.marker,entry.replacement);
 END LOOP;
END $review$;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-completion.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-queue.sql
-- Held collection queue. Reuse the custody projection and the existing
-- owner read authority. The queue is independent of calendar date filters.
GRANT SELECT ON crest_private.dropoff_custody_collection_queue TO crest_booking_owner;

CREATE FUNCTION crest_commands.list_dropoff_collections(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
 requested_business uuid,after_received_at timestamptz,after_case_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $queue$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (after_received_at IS NULL)<>(after_case_id IS NULL) OR after_received_at IS NOT NULL AND NOT isfinite(after_received_at)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_DROPOFF_COLLECTION_CURSOR_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH page AS MATERIALIZED (
  SELECT q.case_id,q.job_id,q.job_vehicle_id,q.received_at,q.collection_state,
   v.vehicle_snapshot->>'label' AS vehicle_label,v.customer_snapshot->>'display_name' AS customer_name
  FROM crest_private.dropoff_custody_collection_queue q
  JOIN crest.jobs j ON j.business_id=q.business_id AND j.id=q.job_id
  JOIN crest.job_vehicles v ON (v.business_id,v.job_id,v.id)=(q.business_id,q.job_id,q.job_vehicle_id)
  WHERE q.business_id=requested_business AND j.operator_actor_id=expected_actor
   AND (after_received_at IS NULL OR (q.received_at,q.case_id)>(after_received_at,after_case_id))
  ORDER BY q.received_at,q.case_id LIMIT 26
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'hasMore',(SELECT count(*) FROM page)>25,
  'rows',coalesce(jsonb_agg(jsonb_build_object('caseId',case_id,'jobId',job_id,'jobVehicleId',job_vehicle_id,
   'receivedAt',to_char(received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'state',collection_state,'vehicleLabel',vehicle_label,'customerName',customer_name) ORDER BY received_at,case_id),'[]'::jsonb))
 INTO result FROM (SELECT * FROM page ORDER BY received_at,case_id LIMIT 25) shown;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN result;
END $queue$;

ALTER FUNCTION crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_dropoff_collections(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,timestamptz,uuid) TO crest_web;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-queue.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-source.sql
-- Held custody source reader. Fixed physical columns, original JSON text and
-- exact timestamps are exposed only inside a repeatable-read read-only snapshot.
-- Runtime and general export roles receive no entry point in this proposal.
DO $review$
BEGIN
 IF to_regprocedure('crest_private.dropoff_custody_source_rows(uuid,text)') IS NOT NULL
  OR to_regprocedure('crest_commands.business_history_export_context(uuid)') IS NULL
  OR EXISTS(SELECT 1 FROM (VALUES ('crest.custody_authorization_configs'),('crest.custody_cases'),('crest.custody_events'),('crest.custody_photo_attempts'),('crest.custody_photo_originals')) expected(name)
   LEFT JOIN pg_class c ON c.oid=to_regclass(expected.name)
   WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_private.dropoff_custody_source_rows(requested_business uuid,requested_group text)
 RETURNS TABLE(row_id uuid,row_value jsonb) LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $rows$
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'mode_version_id',p.mode_version_id,
  'acknowledgement_text',p.acknowledgement_text,
  'condition_photo_required',p.condition_photo_required
 ) FROM crest.custody_authorization_configs p WHERE requested_group='custody_authorization_configs' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'job_id',p.job_id,
  'job_vehicle_id',p.job_vehicle_id,
  'vehicle_id',p.vehicle_id,
  'mode',p.mode,
  'version',p.version::text,
  'state',p.state,
  'current_event_id',p.current_event_id,
  'authorization_config_id',p.authorization_config_id
 ) FROM crest.custody_cases p WHERE requested_group='custody_cases' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'case_id',p.case_id,
  'version',p.version::text,
  'prior_version',p.prior_version::text,
  'action',p.action,
  'effective_at',to_char(p.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person_snapshot',p.person_snapshot::text,
  'location_snapshot',p.location_snapshot::text,
  'notes',p.notes,
  'missing_photo_reason',p.missing_photo_reason,
  'created_by',p.created_by,
  'operation_id',p.operation_id,
  'origin',p.origin,
  'acknowledgement_confirmed',p.acknowledgement_confirmed,
  'condition_photo_id',p.condition_photo_id
 ) FROM crest.custody_events p WHERE requested_group='custody_events' AND p.business_id=requested_business
 UNION ALL
 SELECT p.id,jsonb_build_object(
  'id',p.id,
  'business_id',p.business_id,
  'job_id',p.job_id,
  'job_vehicle_id',p.job_vehicle_id,
  'vehicle_id',p.vehicle_id,
  'case_id',p.case_id,
  'handoff_version',p.handoff_version,
  'actor_id',p.actor_id,
  'recovery_epoch',p.recovery_epoch,
  'dispatch_id',p.dispatch_id,
  'declared_type',p.declared_type,
  'byte_size',p.byte_size,
  'reserved_at',to_char(p.reserved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 ) FROM crest.custody_photo_attempts p WHERE requested_group='custody_photo_attempts' AND p.business_id=requested_business
 UNION ALL
 SELECT p.photo_id,jsonb_build_object(
  'business_id',p.business_id,
  'photo_id',p.photo_id,
  'detected_type',p.detected_type,
  'byte_size',p.byte_size,
  'sha256',p.sha256,
  'validation_version',p.validation_version,
  'width',p.width,
  'height',p.height,
  'display_width',p.display_width,
  'display_height',p.display_height,
  'bit_depth',p.bit_depth,
  'preview_sha256',p.preview_sha256,
  'preview_byte_size',p.preview_byte_size,
  'preview_width',p.preview_width,
  'preview_height',p.preview_height,
  'verified_at',to_char(p.verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
 ) FROM crest.custody_photo_originals p WHERE requested_group='custody_photo_originals' AND p.business_id=requested_business
$rows$;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.dropoff_custody_source_rows(uuid,text) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_custody_source_rows(uuid,text) FROM PUBLIC;

CREATE FUNCTION crest_commands.dropoff_custody_source_context(requested_business uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb; counts jsonb; total bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CUSTODY_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_SOURCE_SCOPE_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT jsonb_object_agg(name,rows::text),sum(rows) INTO counts,total FROM (
  SELECT 'custody_authorization_configs' AS name,count(*) AS rows FROM crest.custody_authorization_configs WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_cases' AS name,count(*) AS rows FROM crest.custody_cases WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_events' AS name,count(*) AS rows FROM crest.custody_events WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_photo_attempts' AS name,count(*) AS rows FROM crest.custody_photo_attempts WHERE business_id=requested_business
  UNION ALL
  SELECT 'custody_photo_originals' AS name,count(*) AS rows FROM crest.custody_photo_originals WHERE business_id=requested_business
 ) counted;
 IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CUSTODY_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.dropoff-custody-source.v1','businessId',requested_business,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.dropoff-custody-source/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'historySnapshotToken',history->>'snapshotToken','expectedCounts',counts);
END $context$;

CREATE FUNCTION crest_commands.dropoff_custody_source_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.dropoff_custody_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL
  OR requested_group NOT IN('custody_authorization_configs','custody_cases','custody_events','custody_photo_attempts','custody_photo_originals') OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_SOURCE_PAGE_REQUIRED';END IF;
 WITH page AS MATERIALIZED(
  SELECT row_id,row_value FROM crest_private.dropoff_custody_source_rows(requested_business,requested_group)
  WHERE after_id IS NULL OR row_id>after_id ORDER BY row_id LIMIT page_limit+1
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'group',requested_group,
  'hasMore',(SELECT count(*)>page_limit FROM page),'rows',coalesce(jsonb_agg(row_value ORDER BY row_id),'[]'::jsonb))
 INTO result FROM (SELECT * FROM page ORDER BY row_id LIMIT page_limit) shown;
 RETURN result;
END $page$;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.dropoff_custody_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.dropoff_custody_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_commands.dropoff_custody_source_context(uuid),
 crest_commands.dropoff_custody_source_page(uuid,text,text,uuid,integer) FROM PUBLIC;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-cancellation.sql
-- Held schema66 extension after custody work/completion, before schema compatibility.
-- Reuse the existing explicit no-fulfilled-work cancellation. Close only the work
-- interval; vehicle custody and its separate return obligation remain unchanged.
DO $review$
DECLARE entry record; routine regprocedure; definition text; old_acl aclitem[];
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner','v','5d15ddc9cc24047ed838296197a45a313591550b60f2cf87cd1e236c36910d2c','before_job.fulfillment_mode<>''mobile''','before_job.fulfillment_mode NOT IN(''mobile'',''dropoff'')'),
  ('crest_private.field_source_stamp()','crest_booking_integrity_owner','v','592a9dc66724f982336d603fe6615918891e5e317a8972926d4be66d777406a7','state IN(''in_progress'',''paused'') AND fulfillment_mode=''mobile'' AND first_work_at IS NOT NULL','state IN(''in_progress'',''paused'') AND fulfillment_mode IN(''mobile'',''dropoff'') AND first_work_at IS NOT NULL'),
  ('crest_commands.read_unfulfilled_cancellation_context(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)','crest_booking_owner','v','71f1f21cf227607c36c27c402bbf715836c3668b37a76ccfc001a9f1af14fece','j.fulfillment_mode=''mobile''','j.fulfillment_mode IN(''mobile'',''dropoff'')'),
  ('crest_private.stamp_booking_row()','crest_booking_integrity_owner','v','0f21a0a7c4696194dc353b162873e26b0af6efd2880055c404a73c195251926c','OLD.state NOT IN(''in_progress'',''paused'') OR OLD.fulfillment_mode<>''mobile'' OR OLD.first_work_at IS NULL','OLD.state NOT IN(''in_progress'',''paused'') OR OLD.fulfillment_mode NOT IN(''mobile'',''dropoff'') OR OLD.first_work_at IS NULL'),
  ('crest_private.unfulfilled_job_result(uuid,uuid,uuid)','crest_booking_integrity_owner','s','6f302d90e567be829cc0fbcf7f98ce39adbcb4a7079f69fff1b8aa3a513ccd97','before_job->>''fulfillment_mode''<>''mobile'' OR after_job->>''fulfillment_mode''<>''mobile''','before_job->>''fulfillment_mode'' NOT IN(''mobile'',''dropoff'') OR after_job->>''fulfillment_mode'' IS DISTINCT FROM before_job->>''fulfillment_mode''')
 ) expected(signature,owner_name,volatility,body_hash,marker,replacement) LOOP
  routine:=to_regprocedure(entry.signature);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=routine AND p.proowner=entry.owner_name::regrole AND p.prosecdef AND NOT p.proleakproof
    AND p.provolatile::text=entry.volatility AND l.lanname='plpgsql'
    AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
    AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=entry.body_hash
    AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_CANCELLATION_SOURCE_REVIEW_REQUIRED';END IF;
  SELECT pg_get_functiondef(p.oid),p.proacl INTO definition,old_acl FROM pg_proc p WHERE p.oid=routine;
  IF (length(definition)-length(replace(definition,entry.marker,'')))/length(entry.marker)<>1
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_CANCELLATION_SOURCE_REVIEW_REQUIRED';END IF;
  EXECUTE replace(definition,entry.marker,entry.replacement);
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=routine AND p.proowner=entry.owner_name::regrole
   AND p.prosecdef AND p.provolatile::text=entry.volatility AND p.proacl IS NOT DISTINCT FROM old_acl
   AND pg_get_functiondef(p.oid)=replace(definition,entry.marker,entry.replacement))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_DROPOFF_CANCELLATION_SOURCE_REVIEW_REQUIRED';END IF;
 END LOOP;
END $review$;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-cancellation.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/dropoff-custody-schema-compatibility.sql
-- Held custody compatibility over registered schema66. Preserve the exact
-- routine bodies, ownership and permissions while admitting only the reviewed
-- physical columns. The accepted schema66 fingerprint remains immutable.
DO $custody_schema$
DECLARE
 previous_fingerprint constant text:='a7160694f52e09208525077e7d0bc0a2022f7258c0e30c207cbcf4a31294faab';
 current_fingerprint constant text:='afcc9a7a4ad42648c2f29067aaa86fdb755b59d66b11256c6e1f162d96b2901b';
 expected record; routine oid; installed record; revised text;
BEGIN
 IF (SELECT encode(sha256(convert_to(string_agg(
   n.nspname||'.'||c.relname||'.'||a.attname,chr(10) ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"
  ),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
  JOIN pg_attribute a ON a.attrelid=c.oid
  WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM current_fingerprint
  OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname IN ('crest_commands','crest_private') AND p.prokind IN ('f','p')
   AND position(previous_fingerprint in pg_get_functiondef(p.oid))>0)<>9
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED',DETAIL='Physical schema or routine inventory differs';END IF;

 FOR expected IN SELECT * FROM (VALUES
  ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'4fee367302d8a1b12bd4bf3078bccdbe0a8e4cfebfa19acc4973050087fe53fb'),
  ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'afd5cac09841dc5dca69b54889389b03dca41a24c6774f4af273d5680edbfaa5'),
  ('crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'423bccc63f483bf9a6ce576bacadf42551120505033ea920ccd21e0b81df4185'),
  ('crest_commands.field_source_context(uuid)','crest_booking_integrity_owner',true,'bb0865ed5d13213e2c0368e9cb7b6dd9f7ef8a8aa1968d9ed7c446cb931b01be'),
  ('crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'7e4fdf7bf202b11be2a597ae91465aa3fe9affde7e927ebdf81620db21598c25'),
  ('crest_commands.quote_amendment_accepted_source_context(uuid)','crest_quote_owner',true,'7bc2d47487f4f9ecb9b2176abe89ad3fc46826e57a072544eb33411db51076ac'),
  ('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)','crest_booking_owner',true,'a46cb4e80427b2a6d5edc0b06b5aa0d339fb7e295bfd6cd0fc7038035b8efb63'),
  ('crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,jsonb)','crest_booking_owner',true,'bdcea9c8405831a9fdbfd288171b9b1cfa637b21d46c1cc9512629bc7982bd7f'),
  ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'13db83c7d3cd0298e60569d3a6c197a52cdaa82ee9b5a1cbe9d028824232f3d0')
 ) AS entries(signature,owner_name,security_definer,definition_sha256) LOOP
  routine:=to_regprocedure(expected.signature);
  SELECT r.rolname,p.prosecdef,p.proacl,pg_get_functiondef(p.oid) AS definition INTO installed
  FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine;
  IF NOT FOUND OR installed.rolname IS DISTINCT FROM expected.owner_name
   OR installed.prosecdef IS DISTINCT FROM expected.security_definer
   OR encode(sha256(convert_to(installed.definition,'UTF8')),'hex') IS DISTINCT FROM expected.definition_sha256
   OR (length(installed.definition)-length(replace(installed.definition,previous_fingerprint,'')))<>length(previous_fingerprint)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine predecessor differs: '||expected.signature;END IF;
  revised:=replace(installed.definition,previous_fingerprint,current_fingerprint);
  EXECUTE revised;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine
   AND r.rolname=installed.rolname AND p.prosecdef=installed.prosecdef
   AND p.proacl IS NOT DISTINCT FROM installed.proacl AND pg_get_functiondef(p.oid)=revised)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine result differs: '||expected.signature;END IF;
 END LOOP;
END $custody_schema$;

RESET ROLE;
-- END REVIEWED planning/proposals/dropoff-custody-schema-compatibility.sql
