-- P20 fictional Google Calendar. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-outbox.sql
-- P20/BR21. Retained destination, consent, identity and intent only.
-- No OAuth secrets, runtime grants, dispatch or automatic backfill.
CREATE ROLE crest_calendar_intent_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.google_calendar_destinations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL UNIQUE REFERENCES crest.businesses(id),
 provider_calendar_id text NOT NULL UNIQUE
  CHECK (provider_calendar_id ~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group[.]calendar[.]google[.]com$'),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE TABLE crest.google_calendar_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 previous_generation bigint GENERATED ALWAYS AS (nullif(generation-1,0)) STORED,
 recovery_epoch uuid NOT NULL,
 state text NOT NULL CHECK(state IN('active','paused','disconnected')),
 client_name boolean NOT NULL,
 service_label boolean NOT NULL,
 work_address boolean NOT NULL,
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,destination_id,generation),
 UNIQUE(business_id,destination_id,generation,recovery_epoch),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,destination_id,previous_generation)
  REFERENCES crest.google_calendar_consents(business_id,destination_id,generation),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE TABLE crest.google_calendar_mappings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 job_id uuid NOT NULL,
 event_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
 correlation_marker uuid NOT NULL DEFAULT gen_random_uuid(),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,destination_id,job_id),
 UNIQUE(business_id,destination_id,job_id,id),
 UNIQUE(business_id,destination_id,event_uuid),
 UNIQUE(business_id,destination_id,correlation_marker),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY(business_id,job_id,operation_id) REFERENCES crest.job_events(business_id,job_id,operation_id),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(event_uuid<>correlation_marker AND event_uuid<>job_id AND event_uuid<>business_id AND event_uuid<>destination_id
  AND correlation_marker<>job_id AND correlation_marker<>business_id AND correlation_marker<>destination_id)
);
CREATE INDEX google_calendar_mapping_job ON crest.google_calendar_mappings(business_id,job_id);
CREATE INDEX google_calendar_mapping_operation ON crest.google_calendar_mappings(business_id,operation_id);

CREATE TABLE crest.google_calendar_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 connection_generation bigint NOT NULL,
 recovery_epoch uuid NOT NULL,
 job_id uuid NOT NULL,
 appointment_id uuid NOT NULL,
 appointment_sequence bigint NOT NULL,
 mapping_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('publish','remove')),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,destination_id,job_id,appointment_sequence),
 FOREIGN KEY(business_id,destination_id,connection_generation,recovery_epoch)
  REFERENCES crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch),
 FOREIGN KEY(business_id,destination_id,job_id,mapping_id)
  REFERENCES crest.google_calendar_mappings(business_id,destination_id,job_id,id),
 FOREIGN KEY(business_id,appointment_id,job_id,appointment_sequence)
  REFERENCES crest.appointments(business_id,id,job_id,sequence),
 FOREIGN KEY(business_id,job_id,operation_id) REFERENCES crest.job_events(business_id,job_id,operation_id),
 FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX google_calendar_outbox_appointment ON crest.google_calendar_outbox(business_id,appointment_id);
CREATE INDEX google_calendar_outbox_operation ON crest.google_calendar_outbox(business_id,operation_id);
CREATE INDEX google_calendar_outbox_generation
 ON crest.google_calendar_outbox(business_id,destination_id,connection_generation,recovery_epoch);
CREATE INDEX google_calendar_outbox_pending_order ON crest.google_calendar_outbox(business_id,created_at,id);

DO $calendar$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_destinations','google_calendar_consents','google_calendar_mappings','google_calendar_outbox']
 LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE TRIGGER calendar_history_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
 END LOOP;
END $calendar$;

GRANT USAGE ON SCHEMA crest,crest_private TO crest_calendar_intent_owner;
GRANT SELECT(business_id,id,current_appointment_id,state,operation_id) ON crest.jobs TO crest_calendar_intent_owner;
GRANT SELECT(business_id,id,job_id,sequence,confirmation_state,operation_id) ON crest.appointments TO crest_calendar_intent_owner;
GRANT SELECT(business_id,operation_id,actor_id,recovery_epoch) ON crest_private.operations TO crest_calendar_intent_owner;
GRANT SELECT(business_id,id) ON crest.google_calendar_destinations TO crest_calendar_intent_owner;
-- The role may share-lock a destination, never change it. Consent changes
-- must take the same destination lock exclusively before appending.
GRANT UPDATE(id) ON crest.google_calendar_destinations TO crest_calendar_intent_owner;
GRANT SELECT(business_id,destination_id,generation,recovery_epoch,state) ON crest.google_calendar_consents TO crest_calendar_intent_owner;
GRANT SELECT(business_id,destination_id,job_id,id),INSERT(business_id,destination_id,job_id,operation_id,created_by)
 ON crest.google_calendar_mappings TO crest_calendar_intent_owner;
GRANT INSERT(business_id,destination_id,connection_generation,recovery_epoch,job_id,appointment_id,
 appointment_sequence,mapping_id,action,operation_id,created_by) ON crest.google_calendar_outbox TO crest_calendar_intent_owner;
CREATE POLICY calendar_intent_job ON crest.jobs FOR SELECT TO crest_calendar_intent_owner USING(true);
CREATE POLICY calendar_intent_appointment ON crest.appointments FOR SELECT TO crest_calendar_intent_owner USING(true);
CREATE POLICY calendar_intent_operation ON crest_private.operations FOR SELECT TO crest_calendar_intent_owner USING(true);
CREATE POLICY calendar_intent_destination ON crest.google_calendar_destinations FOR SELECT TO crest_calendar_intent_owner USING(true);
CREATE POLICY calendar_intent_destination_lock ON crest.google_calendar_destinations FOR UPDATE TO crest_calendar_intent_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_intent_consent ON crest.google_calendar_consents FOR SELECT TO crest_calendar_intent_owner USING(true);
CREATE POLICY calendar_intent_mapping ON crest.google_calendar_mappings FOR SELECT TO crest_calendar_intent_owner USING(true);
CREATE POLICY calendar_intent_mapping_append ON crest.google_calendar_mappings FOR INSERT TO crest_calendar_intent_owner WITH CHECK(true);
CREATE POLICY calendar_intent_outbox_append ON crest.google_calendar_outbox FOR INSERT TO crest_calendar_intent_owner WITH CHECK(true);

CREATE FUNCTION crest_private.capture_google_calendar_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $calendar$
DECLARE current_slot record; destination uuid; consent record; original_epoch uuid; mapping uuid; intent text;
BEGIN
 -- A proposal or withdrawal writes history without changing the current
 -- confirmed appointment. Completion also preserves its existing appointment.
 SELECT a.id,a.sequence,a.confirmation_state INTO current_slot
 FROM crest.jobs j JOIN crest.appointments a
 ON (a.business_id,a.job_id,a.id)=(j.business_id,j.id,j.current_appointment_id)
 WHERE (j.business_id,j.id,j.operation_id,j.state)=(NEW.business_id,NEW.job_id,NEW.operation_id,NEW.to_state)
   AND a.operation_id=NEW.operation_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF current_slot.confirmation_state='confirmed' AND NEW.to_state='scheduled' THEN intent:='publish';
 ELSIF current_slot.confirmation_state='cancelled' AND NEW.to_state='cancelled' THEN intent:='remove';
 ELSE RETURN NULL; END IF;

 SELECT d.id INTO destination FROM crest.google_calendar_destinations d
 WHERE d.business_id=NEW.business_id FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT c.generation,c.recovery_epoch,c.state INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(NEW.business_id,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR consent.state<>'active' THEN RETURN NULL; END IF;
 SELECT o.recovery_epoch INTO STRICT original_epoch FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by);
 IF consent.recovery_epoch<>original_epoch THEN RETURN NULL; END IF;

 SELECT m.id INTO mapping FROM crest.google_calendar_mappings m
 WHERE (m.business_id,m.destination_id,m.job_id)=(NEW.business_id,destination,NEW.job_id);
 IF NOT FOUND THEN
  IF intent='remove' THEN RETURN NULL; END IF;
  INSERT INTO crest.google_calendar_mappings(business_id,destination_id,job_id,operation_id,created_by)
  VALUES(NEW.business_id,destination,NEW.job_id,NEW.operation_id,NEW.created_by) RETURNING id INTO mapping;
 END IF;
 INSERT INTO crest.google_calendar_outbox(business_id,destination_id,connection_generation,recovery_epoch,job_id,
  appointment_id,appointment_sequence,mapping_id,action,operation_id,created_by)
 VALUES(NEW.business_id,destination,consent.generation,original_epoch,NEW.job_id,
  current_slot.id,current_slot.sequence,mapping,intent,NEW.operation_id,NEW.created_by);
 RETURN NULL;
END $calendar$;

CREATE TRIGGER calendar_capture_confirmed_appointment AFTER INSERT ON crest.job_events
 FOR EACH ROW EXECUTE FUNCTION crest_private.capture_google_calendar_intent();

RESET ROLE;
ALTER FUNCTION crest_private.capture_google_calendar_intent() OWNER TO crest_calendar_intent_owner;
REVOKE ALL ON FUNCTION crest_private.capture_google_calendar_intent() FROM PUBLIC;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-outbox.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-dispatch.sql
-- P20/BR21. Closed durable worker boundary over google-calendar-outbox.sql.
-- No login, runtime binding, token access, provider I/O or restore replay.
CREATE ROLE crest_calendar_dispatch_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crest_calendar_dispatch NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.google_calendar_worker_principals (
 business_id uuid PRIMARY KEY REFERENCES crest.businesses(id),
 principal name NOT NULL UNIQUE
);

CREATE TABLE crest.google_calendar_dispatch_leases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 outbox_id uuid NOT NULL,
 attempt_no integer NOT NULL CHECK(attempt_no BETWEEN 1 AND 5),
 mode text NOT NULL CHECK(mode IN('dispatch','reconcile')),
 worker_principal name NOT NULL,
 leased_at timestamptz NOT NULL CHECK(isfinite(leased_at)),
 lease_until timestamptz NOT NULL CHECK(lease_until=leased_at+interval '60 seconds'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,outbox_id,attempt_no),
 FOREIGN KEY(business_id,outbox_id) REFERENCES crest.google_calendar_outbox(business_id,id)
);

CREATE TABLE crest.google_calendar_dispatch_sends (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 lease_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('insert','update','delete')),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 request_body text NOT NULL CHECK(octet_length(request_body)<=8192),
 prior_etag text CHECK(char_length(prior_etag)<=258 AND prior_etag COLLATE "C" ~ '^"[!#-~]+"$'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,lease_id),
 FOREIGN KEY(business_id,lease_id) REFERENCES crest.google_calendar_dispatch_leases(business_id,id),
 CHECK((action='insert')=(prior_etag IS NULL)),
 CHECK(CASE WHEN action='delete' THEN request_body=''
  ELSE jsonb_typeof(request_body::jsonb)='object' END),
 CHECK(request_sha256=encode(sha256(convert_to(request_body,'UTF8')),'hex'))
);

-- A PostgreSQL row serializes the dedicated project's rolling quotas across
-- businesses, leases and worker processes. Each admitted request is retained.
CREATE TABLE crest_private.google_calendar_request_budget (
 singleton boolean PRIMARY KEY CHECK(singleton)
);
CREATE TABLE crest.google_calendar_request_admissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 lease_id uuid,
 setup_attempt_id uuid,
 creation_attempt_id uuid,
 kind text NOT NULL CHECK(kind IN('read_event','verify_destination','insert','update','delete','verify_setup_destination','create_secondary')),
 admitted_at timestamptz NOT NULL CHECK(isfinite(admitted_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,setup_attempt_id),
 UNIQUE(business_id,creation_attempt_id),
 CHECK((kind='verify_setup_destination')=(setup_attempt_id IS NOT NULL)),
 CHECK((kind='create_secondary')=(creation_attempt_id IS NOT NULL)),
 CHECK(num_nonnulls(lease_id,setup_attempt_id,creation_attempt_id)=1),
 FOREIGN KEY(business_id,lease_id) REFERENCES crest.google_calendar_dispatch_leases(business_id,id)
);
CREATE UNIQUE INDEX calendar_one_write_admission ON crest.google_calendar_request_admissions(business_id,lease_id)
 WHERE kind IN('insert','update','delete');
CREATE INDEX calendar_request_admitted_at ON crest.google_calendar_request_admissions(admitted_at);
INSERT INTO crest_private.google_calendar_request_budget(singleton) VALUES(true);

CREATE TABLE crest.google_calendar_dispatch_results (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 lease_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('published','removed','no_effect','delayed','reconnect','review','uncertain')),
 provider_etag text CHECK(char_length(provider_etag)<=258 AND provider_etag COLLATE "C" ~ '^"[!#-~]+"$'),
 source_current boolean NOT NULL,
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 retry_at timestamptz CHECK(retry_at>=recorded_at),
 UNIQUE(business_id,id),
 UNIQUE(business_id,lease_id),
 FOREIGN KEY(business_id,lease_id) REFERENCES crest.google_calendar_dispatch_leases(business_id,id),
 CHECK((outcome='published')=(provider_etag IS NOT NULL)),
 CHECK((outcome IN('delayed','uncertain'))=(retry_at IS NOT NULL))
);

DO $calendar$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_dispatch_leases','google_calendar_dispatch_sends','google_calendar_dispatch_results',
  'google_calendar_request_admissions']
 LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE TRIGGER calendar_dispatch_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_calendar_dispatch_owner',relation);
  EXECUTE format('CREATE POLICY calendar_dispatch_read ON crest.%I FOR SELECT TO crest_calendar_dispatch_owner USING(true)',relation);
  EXECUTE format('CREATE POLICY calendar_dispatch_append ON crest.%I FOR INSERT TO crest_calendar_dispatch_owner WITH CHECK(true)',relation);
 END LOOP;
END $calendar$;
ALTER TABLE crest_private.google_calendar_worker_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_worker_principals FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_request_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_request_budget FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_budget_read ON crest_private.google_calendar_request_budget FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_budget_lock ON crest_private.google_calendar_request_budget FOR UPDATE TO crest_calendar_dispatch_owner USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_request_budget TO crest_calendar_dispatch_owner;
CREATE POLICY calendar_dispatch_principal ON crest_private.google_calendar_worker_principals FOR SELECT TO crest_calendar_dispatch_owner
 USING(principal=session_user);
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_calendar_dispatch_owner;
GRANT USAGE ON SCHEMA crest_commands TO crest_calendar_dispatch;
GRANT SELECT ON crest_private.google_calendar_worker_principals TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,active_epoch,writes_enabled),UPDATE(id) ON crest_private.business_recovery_authorities TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,current_appointment_id),UPDATE(id) ON crest.jobs TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,provider_calendar_id),UPDATE(id) ON crest.google_calendar_destinations TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,destination_id,generation,recovery_epoch,state,client_name,service_label,work_address)
 ON crest.google_calendar_consents TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,job_id,start_at,end_at,timezone) ON crest.appointments TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,destination_id,job_id,event_uuid,correlation_marker),UPDATE(id) ON crest.google_calendar_mappings TO crest_calendar_dispatch_owner;
GRANT SELECT ON crest.google_calendar_outbox TO crest_calendar_dispatch_owner;
GRANT SELECT(work_location_snapshot) ON crest.jobs TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,job_id,customer_snapshot) ON crest.job_vehicles TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,job_id,operation_id,sequence) ON crest.job_events TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,job_id,plan_id,operation_id,allocation_state) ON crest.allocation_plan_parts TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,source_allocation_id) ON crest.allocation_plan_versions TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,entitlement_version_id) ON crest.scope_allocations TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,source_quote_item_id) ON crest.entitlement_versions TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,service_version_id) ON crest.quote_items TO crest_calendar_dispatch_owner;
GRANT SELECT(business_id,id,name) ON crest.service_versions TO crest_calendar_dispatch_owner;
DO $disclosure$
DECLARE source text;
BEGIN
 FOREACH source IN ARRAY ARRAY['job_vehicles','job_events','allocation_plan_parts','allocation_plan_versions',
  'scope_allocations','entitlement_versions','quote_items','service_versions'] LOOP
  EXECUTE format('CREATE POLICY calendar_disclosure_source ON crest.%I FOR SELECT TO crest_calendar_dispatch_owner
    USING(business_id=nullif(current_setting(''crest.calendar_disclosure_business'',true),'''')::uuid)',source);
 END LOOP;
END $disclosure$;
CREATE POLICY calendar_dispatch_recovery_read ON crest_private.business_recovery_authorities FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_dispatch_recovery_lock ON crest_private.business_recovery_authorities FOR UPDATE TO crest_calendar_dispatch_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_dispatch_job_read ON crest.jobs FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_dispatch_job_lock ON crest.jobs FOR UPDATE TO crest_calendar_dispatch_owner USING(true) WITH CHECK(false);
CREATE POLICY calendar_dispatch_destination_read ON crest.google_calendar_destinations FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_dispatch_destination_lock ON crest.google_calendar_destinations FOR UPDATE TO crest_calendar_dispatch_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_dispatch_consent_read ON crest.google_calendar_consents FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_dispatch_appointment_read ON crest.appointments FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_dispatch_mapping_read ON crest.google_calendar_mappings FOR SELECT TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_dispatch_mapping_lock ON crest.google_calendar_mappings FOR UPDATE TO crest_calendar_dispatch_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_dispatch_outbox_read ON crest.google_calendar_outbox FOR SELECT TO crest_calendar_dispatch_owner USING(true);

CREATE FUNCTION crest_private.lock_google_calendar_request_budget() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $budget$
DECLARE stamp timestamptz;
BEGIN
 PERFORM singleton FROM crest_private.google_calendar_request_budget FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF (SELECT count(*) FROM crest.google_calendar_request_admissions a WHERE a.admitted_at>stamp-interval '1 minute')>=60
  OR (SELECT count(*) FROM crest.google_calendar_request_admissions a WHERE a.admitted_at>stamp-interval '24 hours')>=5000 THEN
  RETURN NULL;
 END IF;
 RETURN stamp;
END $budget$;

-- Lock order matches scheduling: recovery, job, destination, mapping.
-- A lease is meaningful only in the authenticated worker's own business.
CREATE FUNCTION crest_private.lock_google_calendar_dispatch(
 business uuid, destination uuid, job uuid, generation bigint, epoch uuid
) RETURNS TABLE(mapping_id uuid,appointment_id uuid,provider_id text,event_uuid uuid,marker uuid,
 share_client boolean,share_service boolean,share_address boolean)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
DECLARE active_epoch uuid; enabled boolean; current_slot uuid; calendar_id text; current_consent record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_FRESH_TRANSACTION_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p WHERE p.business_id=business AND p.principal=session_user) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED';
 END IF;
 SELECT r.active_epoch,r.writes_enabled INTO active_epoch,enabled FROM crest_private.business_recovery_authorities r
 WHERE r.business_id=business FOR SHARE;
 IF NOT FOUND OR NOT enabled OR active_epoch IS DISTINCT FROM epoch THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_FENCE_CLOSED';
 END IF;
 SELECT j.current_appointment_id INTO current_slot FROM crest.jobs j WHERE (j.business_id,j.id)=(business,job) FOR SHARE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT d.provider_calendar_id INTO calendar_id FROM crest.google_calendar_destinations d
 WHERE (d.business_id,d.id)=(business,destination) FOR SHARE;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT c.generation,c.recovery_epoch,c.state,c.client_name,c.service_label,c.work_address INTO current_consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR current_consent.state<>'active' OR (current_consent.generation,current_consent.recovery_epoch)
  IS DISTINCT FROM (generation,epoch) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_FENCE_CLOSED';
 END IF;
 RETURN QUERY SELECT m.id,current_slot,calendar_id,m.event_uuid,m.correlation_marker,
  current_consent.client_name,current_consent.service_label,current_consent.work_address FROM crest.google_calendar_mappings m
 WHERE (m.business_id,m.destination_id,m.job_id)=(business,destination,job) FOR NO KEY UPDATE SKIP LOCKED;
END $lock$;

-- Reuse booking-time evidence, never the current CRM/service editor or
-- free-form quote scope. A missing/ambiguous catalog service is omitted.
CREATE FUNCTION crest_private.google_calendar_disclosed_fields(
 business uuid,job uuid,share_client boolean,share_service boolean,share_address boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $disclosed$
DECLARE client_name text; service_label text; address_label text; location jsonb;
 whitespace constant text:=E'\t\n\r\u000b\u000c \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
BEGIN
 PERFORM set_config('crest.calendar_disclosure_business',business::text,true);
 IF share_client THEN
  SELECT CASE WHEN count(DISTINCT v.customer_snapshot->>'display_name')=1
    THEN min(v.customer_snapshot->>'display_name') END INTO client_name
  FROM crest.job_vehicles v WHERE (v.business_id,v.job_id)=(business,job);
 END IF;
 IF share_service THEN
  SELECT CASE WHEN count(*)=count(s.id) AND count(DISTINCT s.id)=1 THEN min(s.name) END INTO service_label
  FROM crest.job_events e
  JOIN crest.allocation_plan_parts p ON (p.business_id,p.job_id,p.operation_id)=(e.business_id,e.job_id,e.operation_id)
  JOIN crest.allocation_plan_versions v ON (v.business_id,v.id)=(p.business_id,p.plan_id)
  JOIN crest.scope_allocations a ON (a.business_id,a.id)=(v.business_id,v.source_allocation_id)
  JOIN crest.entitlement_versions t ON (t.business_id,t.id)=(a.business_id,a.entitlement_version_id)
  JOIN crest.quote_items q ON (q.business_id,q.id)=(t.business_id,t.source_quote_item_id)
  LEFT JOIN crest.service_versions s ON (s.business_id,s.id)=(q.business_id,q.service_version_id)
  WHERE (e.business_id,e.job_id)=(business,job) AND e.sequence=1 AND p.allocation_state='assigned';
 END IF;
 IF share_address THEN
  SELECT j.work_location_snapshot INTO location FROM crest.jobs j WHERE (j.business_id,j.id)=(business,job);
  address_label:=CASE location->>'kind' WHEN 'manual' THEN location->>'locationText' WHEN 'customer_address' THEN
   concat_ws(', ',nullif(location->'snapshot'->>'line1',''),nullif(location->'snapshot'->>'line2',''),
    nullif(concat_ws(' ',nullif(location->'snapshot'->>'city',''),nullif(location->'snapshot'->>'region',''),
     nullif(location->'snapshot'->>'postal_code','')),''),nullif(location->'snapshot'->>'country','')) END;
 END IF;
 RETURN jsonb_build_object('clientName',nullif(normalize(btrim(client_name,whitespace),NFC),''),
  'serviceLabel',nullif(normalize(btrim(service_label,whitespace),NFC),''),
  'workAddress',nullif(normalize(btrim(address_label,whitespace),NFC),''));
END $disclosed$;
REVOKE ALL ON FUNCTION crest_private.google_calendar_disclosed_fields(uuid,uuid,boolean,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.google_calendar_disclosed_fields(uuid,uuid,boolean,boolean,boolean) TO crest_calendar_dispatch_owner;

CREATE FUNCTION crest_private.google_calendar_safe_display(value text,maximum integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $safe$
 SELECT value IS NULL OR (char_length(value)<=maximum
  AND value !~ '[[:cntrl:]]'
  AND value !~ E'[\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069<>]'
  AND value !~* '(https?:|javascript:|data:|www[.])'
  AND value !~ '[^[:space:]]+@[^[:space:]]+[.][[:alpha:]]{2,}'
  AND value !~ '([0-9][[:space:]().-]*){9,}[0-9]'
  AND value !~ E'[$\u00a2-\u00a5\u058f\u060b\u07fe\u07ff\u09f2\u09f3\u09fb\u0af1\u0bf9\u0e3f\u17db\u20a0-\u20c0\ua838\ufdfc\ufe69\uff04\uffe0\uffe1\uffe5\uffe6][[:space:]]*[0-9]');
$safe$;
REVOKE ALL ON FUNCTION crest_private.google_calendar_safe_display(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.google_calendar_safe_display(text,integer) TO crest_calendar_dispatch_owner;

CREATE FUNCTION crest_commands.claim_google_calendar_dispatch(
 business uuid, destination uuid, job uuid, generation bigint, epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
DECLARE boundary record; pending crest.google_calendar_outbox; current_intent crest.google_calendar_outbox;
 prior record; original_send record; lease crest.google_calendar_dispatch_leases; mode text; stamp timestamptz;
 unresolved boolean;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_dispatch(business,destination,job,generation,epoch);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 stamp:=clock_timestamp();
 -- An unresolved or ambiguous send must be reconciled ahead of new work,
 -- including when a newer appointment has become authoritative.
 SELECT o.* INTO pending FROM crest.google_calendar_outbox o
 WHERE (o.business_id,o.mapping_id)=(business,boundary.mapping_id)
 AND EXISTS(
  SELECT FROM crest.google_calendar_dispatch_leases l
  JOIN crest.google_calendar_request_admissions s ON (s.business_id,s.lease_id)=(l.business_id,l.id) AND s.kind IN('insert','update','delete')
  LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  WHERE (l.business_id,l.outbox_id)=(business,o.id) AND (r.id IS NULL OR r.outcome='uncertain')
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_leases later
   JOIN crest.google_calendar_dispatch_results done ON (done.business_id,done.lease_id)=(later.business_id,later.id)
   WHERE (later.business_id,later.outbox_id)=(business,o.id) AND later.attempt_no>l.attempt_no
    AND done.outcome IN('published','removed','no_effect'))
 )
 ORDER BY o.appointment_sequence LIMIT 1;
 unresolved:=FOUND;
 IF NOT unresolved THEN
  SELECT o.* INTO pending FROM crest.google_calendar_outbox o
  WHERE (o.business_id,o.mapping_id,o.appointment_id)=(business,boundary.mapping_id,boundary.appointment_id);
 END IF;
 IF pending.id IS NULL THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 IF (pending.connection_generation,pending.recovery_epoch) IS DISTINCT FROM (generation,epoch) THEN
  RETURN jsonb_build_object('state','review');
 END IF;
 SELECT l.attempt_no,l.lease_until,l.mode,r.outcome,r.retry_at INTO prior
 FROM crest.google_calendar_dispatch_leases l
 LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
 WHERE (l.business_id,l.outbox_id)=(business,pending.id) ORDER BY l.attempt_no DESC LIMIT 1;
 IF prior.outcome IN('published','removed','no_effect') THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 IF prior.outcome='reconnect' THEN RETURN jsonb_build_object('state','reconnect'); END IF;
 IF prior.outcome='review' OR coalesce(prior.attempt_no,0)>=5 THEN RETURN jsonb_build_object('state','review'); END IF;
 IF prior.outcome IS NULL AND prior.lease_until>stamp OR prior.retry_at>stamp THEN RETURN jsonb_build_object('state','busy'); END IF;
 -- Even a lease which died before sending must first expire across the whole
 -- mapping, so a newer job can never overlap its provider admission.
 IF EXISTS(SELECT FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o
  ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
  WHERE (o.business_id,o.mapping_id)=(business,boundary.mapping_id) AND l.lease_until>stamp
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id))) THEN
  RETURN jsonb_build_object('state','busy');
 END IF;
 SELECT s.action,s.request_sha256,s.request_body,s.prior_etag INTO original_send
 FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_dispatch_sends s
 ON (s.business_id,s.lease_id)=(l.business_id,l.id)
 JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id,a.kind)=(s.business_id,s.lease_id,s.action)
 WHERE (l.business_id,l.outbox_id)=(business,pending.id) ORDER BY l.attempt_no DESC LIMIT 1;
 mode:=CASE WHEN unresolved THEN 'reconcile' ELSE 'dispatch' END;
 IF mode='dispatch' AND pending.appointment_id<>boundary.appointment_id THEN RETURN jsonb_build_object('state','review'); END IF;
 SELECT o.* INTO current_intent FROM crest.google_calendar_outbox o
 WHERE (o.business_id,o.mapping_id,o.appointment_id)=(business,boundary.mapping_id,boundary.appointment_id);
 INSERT INTO crest.google_calendar_dispatch_leases(business_id,outbox_id,attempt_no,mode,worker_principal,leased_at,lease_until)
 VALUES(business,pending.id,coalesce(prior.attempt_no,0)+1,mode,session_user,stamp,stamp+interval '60 seconds') RETURNING * INTO lease;
 RETURN jsonb_build_object('state','leased','leaseId',lease.id,'leaseUntil',lease.lease_until,'outboxId',pending.id,
  'appointmentId',pending.appointment_id,'appointmentSequence',pending.appointment_sequence::text,'action',pending.action,
  'sourceCurrent',pending.id=current_intent.id,'mode',mode,'attempt',lease.attempt_no,
  'providerCalendarId',boundary.provider_id,'eventId',replace(boundary.event_uuid::text,'-',''),'marker',boundary.marker,
  'previousSend',CASE WHEN original_send.action IS NOT NULL THEN jsonb_build_object(
   'action',original_send.action,'requestSha256',original_send.request_sha256,'requestBody',original_send.request_body,'priorEtag',original_send.prior_etag) END);
END $claim$;

CREATE FUNCTION crest_commands.record_google_calendar_send(
 business uuid,destination uuid,job uuid,generation bigint,epoch uuid,requested_lease uuid,
 requested_action text,request_body text,expected_etag text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $send$
DECLARE boundary record; leased record; retained record; sent uuid; body jsonb; raw_body json; request_digest text; slot record; fields jsonb;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_dispatch(business,destination,job,generation,epoch);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 SELECT l.id,l.mode,l.outbox_id,l.leased_at,o.action,o.appointment_id INTO leased
 FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.mapping_id,o.connection_generation,o.recovery_epoch)=(boundary.mapping_id,generation,epoch)
  AND l.lease_until>clock_timestamp()+interval '15 seconds'
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id))
  AND o.appointment_id=boundary.appointment_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 IF NOT ((leased.action='publish' AND requested_action IN('insert','update')) OR
  (leased.action='remove' AND requested_action='delete')) OR requested_action IS NULL THEN
  RETURN jsonb_build_object('state','review');
 END IF;
 IF request_body IS NULL OR octet_length(request_body)>8192 OR (requested_action='delete' AND request_body<>'') THEN
  RETURN jsonb_build_object('state','review');
 END IF;
 IF (requested_action='insert') IS DISTINCT FROM (expected_etag IS NULL)
  OR (expected_etag IS NOT NULL AND (char_length(expected_etag)>258 OR expected_etag COLLATE "C" !~ '^"[!#-~]+"$')) THEN
  RETURN jsonb_build_object('state','review');
 END IF;
 IF requested_action<>'delete' THEN
  BEGIN raw_body:=request_body::json; body:=raw_body::jsonb;
  EXCEPTION WHEN invalid_text_representation OR untranslatable_character THEN RETURN jsonb_build_object('state','review'); END;
  IF jsonb_typeof(body) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','review'); END IF;
  IF (SELECT array_agg(k ORDER BY k COLLATE "C") FROM json_object_keys(raw_body) k) IS DISTINCT FROM
    ARRAY['description','end','extendedProperties','id','location','reminders','start','status','summary','transparency','visibility']
   OR body->>'id' IS DISTINCT FROM replace(boundary.event_uuid::text,'-','')
   OR body->'extendedProperties' IS DISTINCT FROM jsonb_build_object('private',jsonb_build_object('crestMapping',boundary.marker))
   OR body->'reminders' IS DISTINCT FROM '{"useDefault":false,"overrides":[]}'::jsonb
   OR (body->>'status',body->>'visibility',body->>'transparency') IS DISTINCT FROM ('confirmed','private','opaque')
   THEN RETURN jsonb_build_object('state','review'); END IF;
  SELECT a.start_at,a.end_at,a.timezone INTO STRICT slot FROM crest.appointments a
  WHERE (a.business_id,a.id,a.job_id)=(business,leased.appointment_id,job);
  fields:=crest_private.google_calendar_disclosed_fields(business,job,boundary.share_client,boundary.share_service,boundary.share_address);
  IF NOT (crest_private.google_calendar_safe_display(fields->>'clientName',200)
   AND crest_private.google_calendar_safe_display(fields->>'serviceLabel',200)
   AND crest_private.google_calendar_safe_display(fields->>'workAddress',512))
   THEN RETURN jsonb_build_object('state','review'); END IF;
  IF body->'start' IS DISTINCT FROM jsonb_build_object('dateTime',
    to_char(slot.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',slot.timezone)
   OR body->'end' IS DISTINCT FROM jsonb_build_object('dateTime',
    to_char(slot.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timeZone',slot.timezone)
   OR jsonb_typeof(body->'summary') IS DISTINCT FROM 'string'
   OR jsonb_typeof(body->'location') IS DISTINCT FROM 'string'
   OR jsonb_typeof(body->'description') IS DISTINCT FROM 'string'
   OR body->>'summary' IS DISTINCT FROM concat_ws(' · ','Crest job',fields->>'serviceLabel',fields->>'clientName')
   OR body->>'location' IS DISTINCT FROM coalesce(fields->>'workAddress','')
   OR NOT ((body->>'description') COLLATE "C" ~
    ('^View the saved appointment in Crest OS: https://([A-Za-z0-9.-]+|\[[a-fA-F0-9:]+\])(:[0-9]{1,5})?/schedule[?]job='||job::text||'$'))
   THEN RETURN jsonb_build_object('state','review'); END IF;
  -- Canonical JSON removes ambiguous nested duplicates and retains exactly
  -- the bytes the future worker must use as its provider body.
  request_body:=body::text;
 END IF;
 request_digest:=encode(sha256(convert_to(request_body,'UTF8')),'hex');
 IF leased.mode='reconcile' THEN
  SELECT s.action,s.request_sha256,s.prior_etag INTO retained FROM crest.google_calendar_dispatch_sends s
  JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.id)=(s.business_id,s.lease_id)
  JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id,a.kind)=(s.business_id,s.lease_id,s.action)
  WHERE (l.business_id,l.outbox_id)=(business,leased.outbox_id) AND l.leased_at<leased.leased_at
  ORDER BY l.attempt_no DESC LIMIT 1;
  IF NOT FOUND OR (requested_action,request_digest,expected_etag) IS DISTINCT FROM
   (retained.action,retained.request_sha256,retained.prior_etag) THEN
   RETURN jsonb_build_object('state','review');
  END IF;
 END IF;
 INSERT INTO crest.google_calendar_dispatch_sends(business_id,lease_id,action,request_sha256,request_body,prior_etag)
 VALUES(business,requested_lease,requested_action,request_digest,request_body,expected_etag)
 ON CONFLICT(business_id,lease_id) DO NOTHING RETURNING id INTO sent;
 IF sent IS NULL THEN RETURN jsonb_build_object('state','already_recorded'); END IF;
 RETURN jsonb_build_object('state','recorded','sendId',sent,'requestBody',request_body,'requestSha256',request_digest);
END $send$;

CREATE FUNCTION crest_commands.admit_google_calendar_request(
 business uuid,destination uuid,job uuid,generation bigint,epoch uuid,requested_lease uuid,request_kind text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; leased record; send_action text; stamp timestamptz; admitted uuid;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_dispatch(business,destination,job,generation,epoch);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 SELECT l.id,l.mode,o.appointment_id INTO leased
 FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.mapping_id,o.connection_generation,o.recovery_epoch)=(boundary.mapping_id,generation,epoch)
  AND l.lease_until>clock_timestamp()+interval '15 seconds'
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id));
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 IF request_kind IN('insert','update','delete') THEN
  SELECT s.action INTO send_action FROM crest.google_calendar_dispatch_sends s WHERE (s.business_id,s.lease_id)=(business,requested_lease);
  IF send_action IS DISTINCT FROM request_kind OR leased.appointment_id<>boundary.appointment_id THEN
   RETURN jsonb_build_object('state','unavailable');
  END IF;
 ELSIF request_kind NOT IN('read_event','verify_destination') OR request_kind IS NULL
  OR (leased.mode<>'reconcile' AND leased.appointment_id<>boundary.appointment_id) THEN
  RETURN jsonb_build_object('state','unavailable');
 END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL THEN RETURN jsonb_build_object('state','delayed'); END IF;
 INSERT INTO crest.google_calendar_request_admissions(business_id,lease_id,kind,admitted_at)
 VALUES(business,requested_lease,request_kind,stamp) ON CONFLICT DO NOTHING RETURNING id INTO admitted;
 IF admitted IS NULL THEN RETURN jsonb_build_object('state','already_admitted'); END IF;
 RETURN jsonb_build_object('state','admitted','admissionId',admitted);
END $admit$;

CREATE FUNCTION crest_commands.finish_google_calendar_dispatch(
 business uuid,destination uuid,job uuid,generation bigint,epoch uuid,requested_lease uuid,reported_outcome text,etag text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE boundary record; leased record; recorded_send boolean; read_event boolean; verified_destination boolean;
 current_source boolean; stamp timestamptz; effective_outcome text;
 result crest.google_calendar_dispatch_results; backoff interval;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_dispatch(business,destination,job,generation,epoch);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 SELECT l.attempt_no,l.mode,o.action,o.appointment_id INTO leased
 FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.mapping_id,o.connection_generation,o.recovery_epoch)=(boundary.mapping_id,generation,epoch)
  AND l.lease_until>clock_timestamp();
 IF NOT FOUND THEN RETURN jsonb_build_object('state','unavailable'); END IF;
 SELECT coalesce(bool_or(a.kind IN('insert','update','delete')),false),
  coalesce(bool_or(a.kind='read_event'),false),coalesce(bool_or(a.kind='verify_destination'),false)
 INTO recorded_send,read_event,verified_destination FROM crest.google_calendar_request_admissions a
 WHERE (a.business_id,a.lease_id)=(business,requested_lease);
 effective_outcome:=reported_outcome;
 -- A failed read while resolving a previous uncertain write leaves it
 -- uncertain. Only verified absence or a confirmed remote effect resolves it.
 IF (leased.mode='reconcile' OR recorded_send) AND reported_outcome='delayed' THEN effective_outcome:='uncertain'; END IF;
 SELECT r.* INTO result FROM crest.google_calendar_dispatch_results r
 WHERE (r.business_id,r.lease_id)=(business,requested_lease);
 IF FOUND THEN
  IF (result.outcome,result.provider_etag) IS DISTINCT FROM (effective_outcome,etag) THEN RETURN jsonb_build_object('state','review'); END IF;
  RETURN jsonb_build_object('state','recorded','outcome',result.outcome,'sourceCurrent',result.source_current);
 END IF;
 IF reported_outcome IS NULL OR reported_outcome NOT IN('published','removed','no_effect','delayed','reconnect','review','uncertain')
  OR (reported_outcome='published')<>(etag IS NOT NULL)
  OR (etag IS NOT NULL AND (char_length(etag)>258 OR etag COLLATE "C" !~ '^"[!#-~]+"$'))
  OR (reported_outcome='published' AND leased.action<>'publish') OR (reported_outcome='removed' AND leased.action<>'remove')
  OR (reported_outcome='published' AND NOT recorded_send AND NOT read_event)
  OR (reported_outcome='removed' AND NOT recorded_send AND NOT (leased.mode='reconcile' AND read_event AND verified_destination))
  OR (reported_outcome='uncertain' AND NOT recorded_send AND leased.mode<>'reconcile')
  OR (reported_outcome='no_effect' AND (recorded_send OR NOT (read_event AND verified_destination)))
  THEN RETURN jsonb_build_object('state','review');
 END IF;
 current_source:=leased.appointment_id=boundary.appointment_id;
 stamp:=clock_timestamp();
 backoff:=CASE leased.attempt_no WHEN 1 THEN interval '15 seconds' WHEN 2 THEN interval '30 seconds'
  WHEN 3 THEN interval '60 seconds' ELSE interval '120 seconds' END
  + random()*interval '5 seconds';
 INSERT INTO crest.google_calendar_dispatch_results(business_id,lease_id,outcome,provider_etag,source_current,recorded_at,retry_at)
 VALUES(business,requested_lease,effective_outcome,etag,current_source,stamp,
  CASE WHEN effective_outcome IN('delayed','uncertain') THEN stamp+backoff END) RETURNING * INTO result;
 RETURN jsonb_build_object('state','recorded','outcome',result.outcome,'sourceCurrent',result.source_current);
END $finish$;

RESET ROLE;
ALTER FUNCTION crest_private.lock_google_calendar_request_budget() OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_request_budget() FROM PUBLIC;
ALTER FUNCTION crest_private.lock_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.claim_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.record_google_calendar_send(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_request(uuid,uuid,uuid,bigint,uuid,uuid,text) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid,uuid,text,text) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid),
 crest_commands.claim_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid),
 crest_commands.record_google_calendar_send(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text),
 crest_commands.admit_google_calendar_request(uuid,uuid,uuid,bigint,uuid,uuid,text),
 crest_commands.finish_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.claim_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid),
 crest_commands.record_google_calendar_send(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text),
 crest_commands.admit_google_calendar_request(uuid,uuid,uuid,bigint,uuid,uuid,text),
 crest_commands.finish_google_calendar_dispatch(uuid,uuid,uuid,bigint,uuid,uuid,text,text) TO crest_calendar_dispatch;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-dispatch.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-oauth-attempt.sql
-- P20/BR21. Held pre-consent state only; no web login, token exchange,
-- Google account data, configured client, or connection activation.
CREATE ROLE crest_calendar_oauth_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crest_calendar_oauth NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.google_calendar_oauth_client (
 singleton boolean PRIMARY KEY CHECK(singleton),
 issuer text NOT NULL CHECK(issuer='https://accounts.google.com'),
 client_id text NOT NULL CHECK(char_length(client_id)<=200 AND client_id COLLATE "C" ~ '^[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$'),
 callback_uri text NOT NULL CHECK(char_length(callback_uri)<=300 AND callback_uri COLLATE "C" ~
  '^https://([A-Za-z0-9.-]+|\[[a-fA-F0-9:]+\])(:[0-9]{1,5})?/api/google-calendar/callback$'),
 verifier_key_id text NOT NULL CHECK(verifier_key_id COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$')
);

-- Ephemeral server-only security state. Exclude this relation from product
-- exports and invalidate it on restore. No raw state, code, verifier or token.
CREATE TABLE crest_private.google_calendar_oauth_attempts (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 destination_id uuid,
 connection_generation bigint NOT NULL CHECK(connection_generation>=0),
 issuer text NOT NULL,
 client_id text NOT NULL,
 callback_uri text NOT NULL,
 state_digest bytea NOT NULL UNIQUE CHECK(octet_length(state_digest)=32),
 verifier_key_id text NOT NULL,
 verifier_envelope jsonb,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 expires_at timestamptz NOT NULL CHECK(expires_at=created_at+interval '5 minutes'),
 retired_at timestamptz CHECK(isfinite(retired_at) AND retired_at>=created_at),
 consumed_at timestamptz CHECK(consumed_at IS NULL OR
  (retired_at IS NOT NULL AND consumed_at=retired_at AND consumed_at<expires_at)),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 CHECK(connection_generation=0 OR destination_id IS NOT NULL),
 CHECK((retired_at IS NULL)=(verifier_envelope IS NOT NULL))
);
CREATE INDEX google_calendar_oauth_attempt_window ON crest_private.google_calendar_oauth_attempts(business_id,created_at,id);
CREATE UNIQUE INDEX google_calendar_oauth_one_pending ON crest_private.google_calendar_oauth_attempts(business_id) WHERE retired_at IS NULL;

ALTER TABLE crest_private.google_calendar_oauth_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_oauth_client FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_oauth_attempts FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_calendar_oauth_owner;
GRANT USAGE ON SCHEMA crest_commands TO crest_calendar_oauth;
GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_oauth_client TO crest_calendar_oauth_owner;
GRANT SELECT,INSERT,DELETE,UPDATE(retired_at,consumed_at,verifier_envelope) ON crest_private.google_calendar_oauth_attempts TO crest_calendar_oauth_owner;
GRANT SELECT(business_id,id),UPDATE(id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
GRANT SELECT(business_id,destination_id,generation) ON crest.google_calendar_consents TO crest_calendar_oauth_owner;
CREATE POLICY calendar_oauth_client_read ON crest_private.google_calendar_oauth_client FOR SELECT TO crest_calendar_oauth_owner USING(true);
CREATE POLICY calendar_oauth_client_lock ON crest_private.google_calendar_oauth_client FOR UPDATE TO crest_calendar_oauth_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_oauth_destination_read ON crest.google_calendar_destinations FOR SELECT TO crest_calendar_oauth_owner USING(true);
CREATE POLICY calendar_oauth_destination_lock ON crest.google_calendar_destinations FOR UPDATE TO crest_calendar_oauth_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_oauth_consent_read ON crest.google_calendar_consents FOR SELECT TO crest_calendar_oauth_owner USING(true);
CREATE POLICY calendar_oauth_attempt_read ON crest_private.google_calendar_oauth_attempts FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_oauth_attempt_insert ON crest_private.google_calendar_oauth_attempts FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid AND retired_at IS NULL AND consumed_at IS NULL);
CREATE POLICY calendar_oauth_attempt_retire ON crest_private.google_calendar_oauth_attempts FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND retired_at IS NULL)
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND retired_at IS NOT NULL AND verifier_envelope IS NULL);
CREATE POLICY calendar_oauth_attempt_expire ON crest_private.google_calendar_oauth_attempts FOR DELETE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND expires_at<=clock_timestamp()-interval '10 minutes');

-- An as-yet unconnected business has no destination row to lock. Serialize
-- creation of that first row with the same business lock as start/consume.
CREATE FUNCTION crest_private.lock_google_calendar_first_destination() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $destination$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||NEW.business_id::text,0));
 RETURN NEW;
END $destination$;
CREATE TRIGGER calendar_oauth_first_destination BEFORE INSERT ON crest.google_calendar_destinations
 FOR EACH ROW EXECUTE FUNCTION crest_private.lock_google_calendar_first_destination();

CREATE FUNCTION crest_private.lock_google_calendar_oauth_attempt(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text
) RETURNS TABLE(verifier_key text,destination_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $boundary$
DECLARE configured crest_private.google_calendar_oauth_client; destination uuid; current_generation bigint;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||business::text,0));
 SELECT c.* INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 IF NOT FOUND OR (configured.issuer,configured.client_id,configured.callback_uri) IS DISTINCT FROM (google_issuer,google_client,callback) THEN
  RETURN;
 END IF;
 SELECT d.id INTO destination FROM crest.google_calendar_destinations d WHERE d.business_id=business FOR SHARE;
 SELECT coalesce(max(c.generation),0) INTO current_generation FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination);
 IF current_generation IS DISTINCT FROM generation THEN RETURN; END IF;
 -- All other locks are already held. Check that owner/provider freshness
 -- did not expire while waiting for the business or destination.
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 RETURN QUERY SELECT configured.verifier_key_id,destination;
END $boundary$;

CREATE FUNCTION crest_private.google_calendar_oauth_base64url(value bytea) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $encoding$
 SELECT translate(encode(value,'base64'),E'+/=\n','-_')
$encoding$;

CREATE FUNCTION crest_commands.begin_google_calendar_oauth_attempt(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,
 attempt uuid,digest bytea,key_id text,envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $start$
DECLARE scope record; stamp timestamptz; inserted uuid; protected_header text; binding text;
BEGIN
 SELECT * INTO scope FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR attempt IS NULL OR attempt='00000000-0000-0000-0000-000000000000'
  OR digest IS NULL OR octet_length(digest)<>32 OR scope.verifier_key IS DISTINCT FROM key_id
  OR jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR octet_length(envelope::text)>1400
 THEN RETURN NULL; END IF;
 -- Match the server's flattened dir/A256GCM JWE format. The application
 -- still owns authenticated decryption and must use a distinct Calendar key.
 -- The associated data binds the exact attempt, owner, session and OAuth client.
 protected_header:='{"alg":"dir","enc":"A256GCM","kid":"' || key_id ||
  '","typ":"application/vnd.crest.google-calendar-pkce.v1"}';
 binding:=concat_ws(E'\n','crest.google-calendar-pkce.v1',attempt,business,actor,app_session,epoch,generation,google_issuer,google_client,callback);
 IF (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(envelope) k) IS DISTINCT FROM
    ARRAY['aad','ciphertext','iv','protected','tag']
  OR envelope->>'protected' IS DISTINCT FROM crest_private.google_calendar_oauth_base64url(convert_to(protected_header,'UTF8'))
  OR envelope->>'aad' IS DISTINCT FROM crest_private.google_calendar_oauth_base64url(convert_to(binding,'UTF8'))
  OR jsonb_typeof(envelope->'iv') IS DISTINCT FROM 'string' OR envelope->>'iv' COLLATE "C" !~ '^[A-Za-z0-9_-]{16}$'
  OR jsonb_typeof(envelope->'tag') IS DISTINCT FROM 'string' OR envelope->>'tag' COLLATE "C" !~ '^[A-Za-z0-9_-]{22}$'
  OR jsonb_typeof(envelope->'ciphertext') IS DISTINCT FROM 'string'
  OR envelope->>'ciphertext' COLLATE "C" !~ '^[A-Za-z0-9_-]{58,171}$'
 THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 DELETE FROM crest_private.google_calendar_oauth_attempts a WHERE a.business_id=business AND a.expires_at<=stamp-interval '10 minutes';
 IF EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a WHERE a.business_id=business AND (a.id=attempt OR a.state_digest=digest))
  OR (SELECT count(*) FROM crest_private.google_calendar_oauth_attempts a
      WHERE a.business_id=business AND a.created_at>stamp-interval '10 minutes')>=5
 THEN RETURN NULL; END IF;
 -- A savepoint also rolls back supersession if a concurrent global digest or
 -- UUID collision made this start unusable.
 BEGIN
  UPDATE crest_private.google_calendar_oauth_attempts a SET retired_at=greatest(stamp,a.created_at),verifier_envelope=NULL
  WHERE a.business_id=business AND a.retired_at IS NULL;
  INSERT INTO crest_private.google_calendar_oauth_attempts(
   id,business_id,actor_id,session_id,recovery_epoch,destination_id,connection_generation,issuer,client_id,callback_uri,
   state_digest,verifier_key_id,verifier_envelope,created_at,expires_at)
  VALUES(attempt,business,actor,app_session,epoch,scope.destination_id,generation,google_issuer,google_client,callback,
   digest,key_id,envelope,stamp,stamp+interval '5 minutes') RETURNING id INTO inserted;
 EXCEPTION WHEN unique_violation THEN RETURN NULL; END;
 RETURN jsonb_build_object('attemptId',inserted,'expiresAt',stamp+interval '5 minutes');
END $start$;

CREATE FUNCTION crest_commands.consume_google_calendar_oauth_attempt(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid,digest bytea
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $consume$
DECLARE scope record; stamp timestamptz; encrypted jsonb;
BEGIN
 SELECT * INTO scope FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR attempt IS NULL OR digest IS NULL OR octet_length(digest)<>32 THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT a.verifier_envelope INTO encrypted FROM crest_private.google_calendar_oauth_attempts a
 WHERE (a.business_id,a.actor_id,a.session_id,a.id,a.state_digest)=(business,actor,app_session,attempt,digest)
  AND (a.recovery_epoch,a.connection_generation,a.issuer,a.client_id,a.callback_uri,a.verifier_key_id)
   =(epoch,generation,google_issuer,google_client,callback,scope.verifier_key)
  AND a.destination_id IS NOT DISTINCT FROM scope.destination_id
  AND a.retired_at IS NULL AND a.created_at<=stamp AND a.expires_at>stamp;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE crest_private.google_calendar_oauth_attempts a SET retired_at=stamp,consumed_at=stamp,verifier_envelope=NULL
 WHERE a.business_id=business AND a.id=attempt AND a.retired_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- The server commits before code exchange and may open only this envelope.
 -- A lost consume result requires a new start; it cannot re-release the envelope.
 RETURN jsonb_build_object('attemptId',attempt,'verifierKeyId',scope.verifier_key,'verifierEnvelope',encrypted);
END $consume$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)
 TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.lock_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.google_calendar_oauth_base64url(bytea) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.begin_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea,text,jsonb)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.consume_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_first_destination(),crest_private.google_calendar_oauth_base64url(bytea),
 crest_private.lock_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text),
 crest_commands.begin_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea,text,jsonb),
 crest_commands.consume_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.begin_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea,text,jsonb),
 crest_commands.consume_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea)
 TO crest_calendar_oauth;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-oauth-attempt.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-disconnect.sql
-- P20/BR21. Local disconnect and redacted revocation evidence only.
-- Requires the held outbox, dispatch and OAuth-attempt proposals.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.google_calendar_disconnects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 disconnected_generation bigint NOT NULL CHECK(disconnected_generation>1),
 prior_generation bigint GENERATED ALWAYS AS (disconnected_generation-1) STORED,
 fenced_at timestamptz NOT NULL CHECK(isfinite(fenced_at)),
 drain_until timestamptz NOT NULL CHECK(drain_until BETWEEN fenced_at AND fenced_at+interval '60 seconds'),
 actor_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,destination_id,disconnected_generation),
 FOREIGN KEY(business_id,destination_id,disconnected_generation,recovery_epoch)
  REFERENCES crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch),
 FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE TABLE crest.google_calendar_revocation_events (
 business_id uuid NOT NULL,
 disconnect_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN('admitted','revoked','uncertain')),
 admission_phase text GENERATED ALWAYS AS (CASE WHEN phase<>'admitted' THEN 'admitted' END) STORED,
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 deadline timestamptz CHECK(deadline=recorded_at+interval '30 seconds'),
 actor_id uuid NOT NULL,
 PRIMARY KEY(business_id,disconnect_id,phase),
 UNIQUE(business_id,disconnect_id,attempt_id,phase),
 FOREIGN KEY(business_id,disconnect_id) REFERENCES crest.google_calendar_disconnects(business_id,id),
 FOREIGN KEY(business_id,disconnect_id,attempt_id,admission_phase)
  REFERENCES crest.google_calendar_revocation_events(business_id,disconnect_id,attempt_id,phase),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 CHECK((phase='admitted')=(deadline IS NOT NULL))
);
CREATE UNIQUE INDEX calendar_revocation_one_result ON crest.google_calendar_revocation_events(business_id,disconnect_id)
 WHERE phase<>'admitted';

ALTER TABLE crest.google_calendar_disconnects ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.google_calendar_disconnects FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.google_calendar_revocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.google_calendar_revocation_events FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_disconnect_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.google_calendar_disconnects
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER calendar_revocation_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.google_calendar_revocation_events
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.google_calendar_disconnects,crest.google_calendar_revocation_events TO crest_calendar_oauth_owner;
GRANT SELECT ON crest.google_calendar_disconnects TO crest_calendar_dispatch_owner;
GRANT SELECT ON crest.google_calendar_outbox,crest.google_calendar_dispatch_leases,crest.google_calendar_request_admissions,
 crest.google_calendar_dispatch_results TO crest_calendar_oauth_owner;
CREATE POLICY calendar_disconnect_owner_read ON crest.google_calendar_disconnects FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_disconnect_owner_append ON crest.google_calendar_disconnects FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_disconnect_worker_read ON crest.google_calendar_disconnects FOR SELECT TO crest_calendar_dispatch_owner
 USING(EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p
  WHERE (p.business_id,p.principal)=(google_calendar_disconnects.business_id,session_user)));
CREATE POLICY calendar_revocation_owner_read ON crest.google_calendar_revocation_events FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_revocation_owner_append ON crest.google_calendar_revocation_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);

DO $disconnect$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_outbox','google_calendar_dispatch_leases',
  'google_calendar_request_admissions','google_calendar_dispatch_results'] LOOP
  EXECUTE format('CREATE POLICY calendar_disconnect_source ON crest.%I FOR SELECT TO crest_calendar_oauth_owner
   USING(business_id=nullif(current_setting(''crest.calendar_oauth_business'',true),'''')::uuid)',relation);
 END LOOP;
END $disconnect$;

GRANT SELECT(recovery_epoch,state,client_name,service_label,work_address),
 INSERT(business_id,destination_id,generation,recovery_epoch,state,client_name,service_label,work_address,created_by,operation_id)
 ON crest.google_calendar_consents TO crest_calendar_oauth_owner;
CREATE POLICY calendar_disconnect_consent_append ON crest.google_calendar_consents FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND state='disconnected'
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid);
GRANT SELECT ON crest_private.operations TO crest_calendar_oauth_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin),
 UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_calendar_oauth_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 ON crest_private.audit_events TO crest_calendar_oauth_owner;
CREATE POLICY calendar_disconnect_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.disconnect');
CREATE POLICY calendar_disconnect_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.disconnect' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_disconnect_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.disconnect' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.disconnect' AND state='committed');
CREATE POLICY calendar_disconnect_audit_append ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND entity_kind='google_calendar_connections' AND action='disconnect' AND origin='manual');

CREATE FUNCTION crest_private.lock_google_calendar_disconnect(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM d.id FROM crest.google_calendar_destinations d WHERE (d.business_id,d.id)=(business,destination) FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 RETURN true;
END $lock$;

CREATE FUNCTION crest_commands.begin_google_calendar_disconnect(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,generation bigint,requested_operation uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $begin$
DECLARE consent record; stamp timestamptz; drain timestamptz; decision jsonb; fingerprint text; prior record; disconnect uuid;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) OR generation IS NULL OR generation<=0 OR requested_operation IS NULL
 THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_disconnect_operation',requested_operation::text,true);
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(destination,generation,epoch)::text,'UTF8')),'hex');
 SELECT o.payload_hash,o.result INTO prior FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(business,requested_operation,actor)
  AND o.command_type='calendar.connection.disconnect';
 IF FOUND THEN
  IF prior.payload_hash=fingerprint THEN RETURN prior.result; END IF;
  RETURN NULL;
 END IF;
 SELECT c.generation,c.recovery_epoch,c.state,c.client_name,c.service_label,c.work_address INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR (consent.generation,consent.recovery_epoch) IS DISTINCT FROM (generation,epoch)
  OR consent.state NOT IN('active','paused') THEN RETURN NULL; END IF;
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,requested_operation,actor,'calendar.connection.disconnect',1,epoch,fingerprint,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT greatest(stamp,max(l.lease_until)) INTO drain
 FROM crest.google_calendar_outbox o JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(o.business_id,o.id)
 WHERE (o.business_id,o.destination_id,o.recovery_epoch)=(business,destination,epoch)
  AND o.connection_generation<=generation AND l.lease_until>stamp
  AND EXISTS(SELECT FROM crest.google_calendar_request_admissions a WHERE (a.business_id,a.lease_id)=(l.business_id,l.id))
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id));
 INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
  client_name,service_label,work_address,created_by,operation_id)
 VALUES(business,destination,generation+1,epoch,'disconnected',consent.client_name,consent.service_label,consent.work_address,actor,requested_operation);
 INSERT INTO crest.google_calendar_disconnects(business_id,destination_id,recovery_epoch,disconnected_generation,
  fenced_at,drain_until,actor_id,operation_id)
 VALUES(business,destination,epoch,generation+1,stamp,drain,actor,requested_operation) RETURNING id,drain_until INTO disconnect,drain;
 decision:=jsonb_build_object('schemaVersion',1,'disconnectId',disconnect,'destinationId',destination,'generation',(generation+1)::text,
  'fencedAt',stamp,'drainUntil',drain);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,requested_operation,actor,actor,'google_calendar_connections',destination,generation+1,'disconnect',
  jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('generation',generation::text,'state',consent.state),
   'after',decision||jsonb_build_object('state','disconnected')),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=decision
 WHERE (o.business_id,o.operation_id)=(business,requested_operation);
 RETURN decision;
END $begin$;

-- This path records only the outcome of a previously admitted mutation.
-- It cannot obtain a fresh lease, request admission or current-sync receipt.
CREATE FUNCTION crest_commands.record_google_calendar_drained_send(
 business uuid,destination uuid,job uuid,epoch uuid,requested_lease uuid,outcome text,etag text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $drained$
DECLARE active_epoch uuid; enabled boolean; fence record; sent text; prior record; stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_FRESH_TRANSACTION_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p WHERE (p.business_id,p.principal)=(business,session_user)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED';
 END IF;
 SELECT r.active_epoch,r.writes_enabled INTO active_epoch,enabled FROM crest_private.business_recovery_authorities r
 WHERE r.business_id=business FOR SHARE;
 IF NOT FOUND OR (active_epoch,enabled) IS DISTINCT FROM (epoch,true) THEN RETURN false; END IF;
 PERFORM d.id FROM crest.google_calendar_destinations d WHERE (d.business_id,d.id)=(business,destination) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT d.prior_generation,d.fenced_at,d.drain_until INTO fence FROM crest.google_calendar_disconnects d
 WHERE (d.business_id,d.destination_id,d.recovery_epoch)=(business,destination,epoch)
  AND d.disconnected_generation=(SELECT max(c.generation) FROM crest.google_calendar_consents c
   WHERE (c.business_id,c.destination_id)=(business,destination));
 IF NOT FOUND THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 SELECT a.kind INTO sent FROM crest.google_calendar_dispatch_leases l
 JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id)=(l.business_id,l.id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.destination_id,o.job_id,o.recovery_epoch)=(destination,job,epoch) AND o.connection_generation<=fence.prior_generation
  AND a.kind IN('insert','update','delete') AND a.admitted_at<=fence.fenced_at
  AND a.admitted_at>=l.leased_at AND stamp<least(l.lease_until,fence.drain_until);
 IF NOT FOUND OR outcome IS NULL OR outcome NOT IN('published','removed','uncertain')
  OR (outcome='published')<>(etag IS NOT NULL)
  OR (outcome='published' AND sent NOT IN('insert','update')) OR (outcome='removed' AND sent<>'delete')
  OR (etag IS NOT NULL AND (char_length(etag)>258 OR etag COLLATE "C" !~ '^"[!#-~]+"$'))
 THEN RETURN false; END IF;
 INSERT INTO crest.google_calendar_dispatch_results(business_id,lease_id,outcome,provider_etag,source_current,recorded_at,retry_at)
 VALUES(business,requested_lease,outcome,etag,false,stamp,CASE WHEN outcome='uncertain' THEN stamp END)
 ON CONFLICT(business_id,lease_id) DO NOTHING;
 IF FOUND THEN RETURN true; END IF;
 SELECT r.outcome,r.provider_etag,r.source_current INTO prior FROM crest.google_calendar_dispatch_results r
 WHERE (r.business_id,r.lease_id)=(business,requested_lease);
 RETURN (prior.outcome,prior.provider_etag,prior.source_current) IS NOT DISTINCT FROM (outcome,etag,false);
END $drained$;

-- The owner-only executor must commit admission before any token revocation.
-- A lost response leaves a visible uncertainty and does not permit a retry.
CREATE FUNCTION crest_commands.google_calendar_disconnect_status(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,disconnect uuid,request text DEFAULT 'read',revocation_attempt uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE fence record; admitted record; recorded text; stamp timestamptz; unresolved bigint; status text;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) OR request IS NULL OR request NOT IN('read','admit','revoked','uncertain')
  OR ((request='read')<>(revocation_attempt IS NULL)) THEN RETURN NULL; END IF;
 SELECT d.prior_generation,d.fenced_at,d.drain_until INTO fence FROM crest.google_calendar_disconnects d
 WHERE (d.business_id,d.destination_id,d.id,d.recovery_epoch)=(business,destination,disconnect,epoch)
  AND d.disconnected_generation=(SELECT max(c.generation) FROM crest.google_calendar_consents c
   WHERE (c.business_id,c.destination_id)=(business,destination));
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT v.attempt_id,v.deadline INTO admitted FROM crest.google_calendar_revocation_events v
 WHERE (v.business_id,v.disconnect_id,v.phase)=(business,disconnect,'admitted');
 SELECT v.phase INTO recorded FROM crest.google_calendar_revocation_events v
 WHERE (v.business_id,v.disconnect_id)=(business,disconnect) AND v.phase<>'admitted';
 IF request='admit' AND stamp>=fence.drain_until AND admitted.attempt_id IS NULL THEN
  INSERT INTO crest.google_calendar_revocation_events(business_id,disconnect_id,attempt_id,phase,recorded_at,deadline,actor_id)
  VALUES(business,disconnect,revocation_attempt,'admitted',stamp,stamp+interval '30 seconds',actor);
  RETURN jsonb_build_object('state','revocation_admitted','disconnectId',disconnect,'attemptId',revocation_attempt,
   'deadline',stamp+interval '30 seconds');
 ELSIF request IN('revoked','uncertain') THEN
  IF admitted.attempt_id IS DISTINCT FROM revocation_attempt OR (recorded IS NOT NULL AND recorded<>request)
   OR (recorded IS NULL AND request='revoked' AND admitted.deadline<=stamp) THEN RETURN NULL; END IF;
  IF recorded IS NULL THEN
   INSERT INTO crest.google_calendar_revocation_events(business_id,disconnect_id,attempt_id,phase,recorded_at,actor_id)
   VALUES(business,disconnect,revocation_attempt,request,stamp,actor);
   recorded:=request;
  END IF;
 END IF;
 SELECT count(*) INTO unresolved FROM crest.google_calendar_outbox o
 WHERE (o.business_id,o.destination_id,o.recovery_epoch)=(business,destination,epoch) AND o.connection_generation<=fence.prior_generation
  AND EXISTS(SELECT FROM crest.google_calendar_dispatch_leases l
   JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id)=(l.business_id,l.id) AND a.kind IN('insert','update','delete')
   LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
   WHERE (l.business_id,l.outbox_id)=(o.business_id,o.id) AND (r.id IS NULL OR r.outcome IN('uncertain','review','reconnect'))
    AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_leases newer
     JOIN crest.google_calendar_dispatch_results done ON (done.business_id,done.lease_id)=(newer.business_id,newer.id)
     WHERE (newer.business_id,newer.outbox_id)=(o.business_id,o.id) AND newer.attempt_no>l.attempt_no
      AND done.outcome IN('published','removed','no_effect')));
 status:=CASE WHEN recorded='revoked' THEN 'disconnected' WHEN recorded='uncertain' OR admitted.deadline<=stamp THEN 'revocation_uncertain'
  WHEN stamp<fence.drain_until THEN 'draining' WHEN admitted.attempt_id IS NOT NULL THEN 'revoking' ELSE 'ready_to_revoke' END;
 RETURN jsonb_build_object('state',status,'disconnectId',disconnect,'drainUntil',fence.drain_until,
  'unresolvedMutations',unresolved,'reviewRequired',unresolved>0 OR status='revocation_uncertain');
END $status$;

RESET ROLE;
ALTER FUNCTION crest_private.lock_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.begin_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.record_google_calendar_drained_send(uuid,uuid,uuid,uuid,uuid,text,text)
 OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.begin_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,uuid),
 crest_commands.google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid),
 crest_commands.record_google_calendar_drained_send(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.begin_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,uuid),
 crest_commands.google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid)
 TO crest_calendar_oauth;
GRANT EXECUTE ON FUNCTION crest_commands.record_google_calendar_drained_send(uuid,uuid,uuid,uuid,uuid,text,text)
 TO crest_calendar_dispatch;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-disconnect.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-credentials.sql
-- P20/BR21. Held encrypted credential storage and refresh fencing.
-- No secrets, configured key, provisioned login, provider I/O or activation.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.google_calendar_credential_key (
 singleton boolean PRIMARY KEY CHECK(singleton),
 key_id text NOT NULL CHECK(key_id COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$')
);

CREATE TABLE crest_private.google_calendar_code_exchanges (
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 attempt_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 generation bigint NOT NULL CHECK(generation>=0),
 destination_id uuid,
 admitted_at timestamptz NOT NULL CHECK(isfinite(admitted_at)),
 deadline timestamptz NOT NULL CHECK(deadline=admitted_at+interval '30 seconds'),
 PRIMARY KEY(business_id,attempt_id),
 UNIQUE(business_id,recovery_epoch,generation),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id)
);

ALTER TABLE crest.google_calendar_request_admissions ADD FOREIGN KEY(business_id,setup_attempt_id)
 REFERENCES crest_private.google_calendar_code_exchanges(business_id,attempt_id);

CREATE TABLE crest_private.google_calendar_destination_reviews (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>=0),
 client_id text NOT NULL,
 provider_calendar_id text NOT NULL,
 calendar_owner text NOT NULL CHECK(char_length(calendar_owner)<=254 AND calendar_owner COLLATE "C" ~
  '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'),
 reviewed_at timestamptz NOT NULL CHECK(isfinite(reviewed_at)),
 expires_at timestamptz NOT NULL CHECK(expires_at=reviewed_at+interval '10 minutes'),
 PRIMARY KEY(business_id,id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE INDEX calendar_destination_reviews_scope ON crest_private.google_calendar_destination_reviews
 (business_id,app_session_id,destination_id,generation,recovery_epoch,reviewed_at DESC);
CREATE TABLE crest_private.google_calendar_destination_verifications (
 business_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 review_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 verified_at timestamptz NOT NULL CHECK(isfinite(verified_at)),
 PRIMARY KEY(business_id,attempt_id),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest.google_calendar_request_admissions(business_id,setup_attempt_id),
 FOREIGN KEY(business_id,review_id) REFERENCES crest_private.google_calendar_destination_reviews(business_id,id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id)
);

-- Isolated from ordinary exports. The initial row names the intended next
-- generation but grants nothing until a separate reviewed consent activates it.
CREATE TABLE crest_private.google_calendar_credentials (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 connection_generation bigint NOT NULL CHECK(connection_generation>0),
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 key_id text NOT NULL,
 scope text NOT NULL CHECK(scope='https://www.googleapis.com/auth/calendar.app.created'),
 envelope jsonb NOT NULL CHECK(jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=12300),
 version bigint NOT NULL CHECK(version>0),
 source_exchange uuid,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 updated_at timestamptz NOT NULL CHECK(isfinite(updated_at) AND updated_at>=created_at),
 UNIQUE(business_id,id),
 UNIQUE(business_id,destination_id,connection_generation),
 UNIQUE(business_id,source_exchange),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,source_exchange) REFERENCES crest_private.google_calendar_code_exchanges(business_id,attempt_id),
 CHECK(source_exchange IS NOT NULL)
);

CREATE TABLE crest_private.google_calendar_refresh_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 credential_version bigint NOT NULL CHECK(credential_version>0),
 worker_principal name NOT NULL,
 admitted_at timestamptz NOT NULL CHECK(isfinite(admitted_at)),
 deadline timestamptz NOT NULL CHECK(deadline=admitted_at+interval '30 seconds'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,credential_id,credential_version),
 FOREIGN KEY(business_id,credential_id) REFERENCES crest_private.google_calendar_credentials(business_id,id)
);

CREATE TABLE crest_private.google_calendar_refresh_results (
 business_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('rotated','reconnect','uncertain')),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 PRIMARY KEY(business_id,claim_id),
 FOREIGN KEY(business_id,claim_id) REFERENCES crest_private.google_calendar_refresh_claims(business_id,id)
);

DO $roles$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_credential_key','google_calendar_code_exchanges','google_calendar_destination_reviews',
   'google_calendar_destination_verifications','google_calendar_credentials',
   'google_calendar_refresh_claims','google_calendar_refresh_results'] LOOP
  EXECUTE format('ALTER TABLE crest_private.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest_private.%I FORCE ROW LEVEL SECURITY',relation);
  IF relation IN ('google_calendar_code_exchanges','google_calendar_destination_reviews','google_calendar_destination_verifications',
    'google_calendar_refresh_claims','google_calendar_refresh_results') THEN
   EXECUTE format('CREATE TRIGGER calendar_credentials_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
  END IF;
 END LOOP;
END $roles$;
CREATE TRIGGER calendar_credentials_not_deleted BEFORE DELETE OR TRUNCATE ON crest_private.google_calendar_credentials
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_credential_key TO crest_calendar_oauth_owner,crest_calendar_dispatch_owner;
CREATE POLICY calendar_credential_key_read ON crest_private.google_calendar_credential_key FOR SELECT
 TO crest_calendar_oauth_owner,crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_credential_key_lock ON crest_private.google_calendar_credential_key FOR UPDATE
 TO crest_calendar_oauth_owner,crest_calendar_dispatch_owner USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_oauth_client TO crest_calendar_dispatch_owner;
CREATE POLICY calendar_credential_client_read ON crest_private.google_calendar_oauth_client FOR SELECT
 TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_credential_client_lock ON crest_private.google_calendar_oauth_client FOR UPDATE
 TO crest_calendar_dispatch_owner USING(true) WITH CHECK(false);
GRANT SELECT,INSERT ON crest_private.google_calendar_code_exchanges,crest_private.google_calendar_credentials TO crest_calendar_oauth_owner;
GRANT SELECT,INSERT ON crest_private.google_calendar_destination_reviews,crest_private.google_calendar_destination_verifications TO crest_calendar_oauth_owner;
GRANT SELECT(provider_calendar_id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
GRANT INSERT(business_id,setup_attempt_id,kind,admitted_at) ON crest.google_calendar_request_admissions TO crest_calendar_oauth_owner;
CREATE POLICY calendar_setup_admission_insert ON crest.google_calendar_request_admissions FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND lease_id IS NULL AND setup_attempt_id IS NOT NULL AND kind='verify_setup_destination');
CREATE POLICY calendar_destination_review_read ON crest_private.google_calendar_destination_reviews FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid);
CREATE POLICY calendar_destination_review_insert ON crest_private.google_calendar_destination_reviews FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_destination_verification_read ON crest_private.google_calendar_destination_verifications FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_destination_verification_insert ON crest_private.google_calendar_destination_verifications FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_code_read ON crest_private.google_calendar_code_exchanges FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_code_append ON crest_private.google_calendar_code_exchanges FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_credential_owner_read ON crest_private.google_calendar_credentials FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_credential_owner_stage ON crest_private.google_calendar_credentials FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND version=1);
GRANT SELECT(business_id,credential_id,credential_version,deadline) ON crest_private.google_calendar_refresh_claims TO crest_calendar_oauth_owner;
GRANT SELECT(business_id,claim_id) ON crest_private.google_calendar_refresh_results TO crest_calendar_oauth_owner;
GRANT SELECT(id) ON crest_private.google_calendar_refresh_claims TO crest_calendar_oauth_owner;
CREATE POLICY calendar_refresh_owner_read ON crest_private.google_calendar_refresh_claims FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_refresh_result_owner_read ON crest_private.google_calendar_refresh_results FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);

GRANT SELECT,UPDATE(key_id,envelope,version,updated_at) ON crest_private.google_calendar_credentials TO crest_calendar_dispatch_owner;
GRANT SELECT,INSERT ON crest_private.google_calendar_refresh_claims,crest_private.google_calendar_refresh_results TO crest_calendar_dispatch_owner;
DO $worker$
DECLARE relation text;
DECLARE tenant text:='business_id=nullif(current_setting(''crest.calendar_credential_business'',true),'''')::uuid';
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_credentials','google_calendar_refresh_claims','google_calendar_refresh_results'] LOOP
  EXECUTE format('CREATE POLICY calendar_credential_worker_read ON crest_private.%I FOR SELECT TO crest_calendar_dispatch_owner USING(%s)',relation,tenant);
  IF relation<>'google_calendar_credentials' THEN
   EXECUTE format('CREATE POLICY calendar_credential_worker_append ON crest_private.%I FOR INSERT TO crest_calendar_dispatch_owner WITH CHECK(%s)',relation,tenant);
  END IF;
 END LOOP;
 EXECUTE format('CREATE POLICY calendar_credential_worker_rotate ON crest_private.google_calendar_credentials
  FOR UPDATE TO crest_calendar_dispatch_owner USING(%s) WITH CHECK(%s)',tenant,tenant);
END $worker$;

-- Disconnect takes the exclusive destination lock before inserting the
-- fence, so every concurrent refresh either contributes here or is refused.
CREATE FUNCTION crest_private.drain_google_calendar_refresh_on_disconnect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $drain$
DECLARE refresh_deadline timestamptz;
BEGIN
 SELECT max(a.deadline) INTO refresh_deadline
 FROM crest_private.google_calendar_credentials c JOIN crest_private.google_calendar_refresh_claims a
 ON (a.business_id,a.credential_id,a.credential_version)=(c.business_id,c.id,c.version)
 WHERE (c.business_id,c.destination_id,c.recovery_epoch)=(NEW.business_id,NEW.destination_id,NEW.recovery_epoch)
  AND c.connection_generation<NEW.disconnected_generation
  AND NOT EXISTS(SELECT FROM crest_private.google_calendar_refresh_results r WHERE (r.business_id,r.claim_id)=(a.business_id,a.id));
 NEW.drain_until:=greatest(NEW.drain_until,refresh_deadline);
 RETURN NEW;
END $drain$;
CREATE TRIGGER calendar_disconnect_refresh_drain BEFORE INSERT ON crest.google_calendar_disconnects
 FOR EACH ROW EXECUTE FUNCTION crest_private.drain_google_calendar_refresh_on_disconnect();

CREATE FUNCTION crest_private.valid_google_calendar_credential(
 envelope jsonb, key_id text, business uuid, destination uuid, generation bigint, epoch uuid, client_id text, credential uuid, version bigint
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $validate$
 SELECT CASE WHEN jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR octet_length(envelope::text)>12300 THEN false ELSE
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(envelope) k)=ARRAY['aad','ciphertext','iv','protected','tag']
  AND envelope->>'protected'=crest_private.google_calendar_oauth_base64url(convert_to(
    '{"alg":"dir","enc":"A256GCM","kid":"' || key_id || '","typ":"application/vnd.crest.google-calendar-credentials.v1"}','UTF8'))
  AND envelope->>'aad'=crest_private.google_calendar_oauth_base64url(convert_to(concat_ws(E'\n',
    'crest.google-calendar-credentials.v1',business,destination,generation,epoch,client_id,
    'https://www.googleapis.com/auth/calendar.app.created',credential,version),'UTF8'))
  AND jsonb_typeof(envelope->'iv')='string' AND envelope->>'iv' COLLATE "C" ~ '^[A-Za-z0-9_-]{16}$'
  AND jsonb_typeof(envelope->'tag')='string' AND envelope->>'tag' COLLATE "C" ~ '^[A-Za-z0-9_-]{22}$'
  AND jsonb_typeof(envelope->'ciphertext')='string' AND char_length(envelope->>'ciphertext') BETWEEN 2 AND 11600
  AND envelope->>'ciphertext' COLLATE "C" ~ '^[A-Za-z0-9_-]+$'
 END
$validate$;

CREATE FUNCTION crest_commands.admit_google_calendar_code_exchange(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; stamp timestamptz; inserted uuid;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR attempt IS NULL THEN RETURN NULL; END IF;
 IF boundary.destination_id IS NULL OR NOT EXISTS(SELECT FROM crest_private.google_calendar_destination_reviews r
  WHERE (r.business_id,r.app_session_id,r.actor_id,r.recovery_epoch,r.generation,r.client_id,r.destination_id)
   =(business,app_session,actor,epoch,admit_google_calendar_code_exchange.generation,google_client,boundary.destination_id)
   AND r.reviewed_at<=clock_timestamp() AND r.expires_at>clock_timestamp())
 THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a
  WHERE (a.business_id,a.id,a.session_id,a.actor_id)=(business,attempt,app_session,actor)
   AND (a.recovery_epoch,a.connection_generation,a.issuer,a.client_id,a.callback_uri,a.verifier_key_id)
    =(epoch,generation,google_issuer,google_client,callback,boundary.verifier_key)
   AND a.destination_id IS NOT DISTINCT FROM boundary.destination_id
   AND a.consumed_at IS NOT NULL AND a.consumed_at<=stamp AND a.expires_at>stamp)
 THEN RETURN NULL; END IF;
 IF EXISTS(SELECT FROM crest.google_calendar_disconnects d
   WHERE (d.business_id,d.destination_id,d.disconnected_generation)=(business,boundary.destination_id,generation)
   AND NOT EXISTS(SELECT FROM crest.google_calendar_revocation_events v
    WHERE (v.business_id,v.disconnect_id,v.phase)=(business,d.id,'revoked')))
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_code_exchanges(business_id,attempt_id,app_session_id,actor_id,recovery_epoch,client_id,
  generation,destination_id,admitted_at,deadline)
 VALUES(business,attempt,app_session,actor,epoch,google_client,generation,boundary.destination_id,stamp,stamp+interval '30 seconds')
 ON CONFLICT DO NOTHING RETURNING attempt_id INTO inserted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',inserted,'deadline',stamp+interval '30 seconds');
END $admit$;

CREATE FUNCTION crest_commands.confirm_google_calendar_setup_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,
 destination uuid,provider_id text,reviewed_owner text,confirmed boolean
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE boundary record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR confirmed IS DISTINCT FROM true OR destination IS NULL OR boundary.destination_id IS DISTINCT FROM destination
  OR reviewed_owner IS NULL OR char_length(reviewed_owner)>254 OR reviewed_owner COLLATE "C" !~
   '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'
  OR NOT EXISTS(SELECT FROM crest.google_calendar_destinations d
    WHERE (d.business_id,d.id,d.provider_calendar_id)=(business,destination,provider_id))
 THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e
  WHERE (e.business_id,e.recovery_epoch,e.generation)=(business,epoch,confirm_google_calendar_setup_destination.generation)) THEN RETURN false; END IF;
 -- An explicit reviewed value can be superseded before exchange, but never
 -- replaced while a code exchange or metadata request is in flight.
 IF EXISTS(SELECT FROM crest_private.google_calendar_destination_reviews r
  WHERE (r.business_id,r.app_session_id,r.destination_id,r.generation,r.recovery_epoch)
   =(business,app_session,destination,confirm_google_calendar_setup_destination.generation,epoch)
   AND r.reviewed_at>stamp-interval '1 second') THEN RETURN false; END IF;
 INSERT INTO crest_private.google_calendar_destination_reviews(business_id,destination_id,app_session_id,actor_id,
  recovery_epoch,generation,client_id,provider_calendar_id,calendar_owner,reviewed_at,expires_at)
 VALUES(business,destination,app_session,actor,epoch,generation,google_client,provider_id,reviewed_owner,stamp,stamp+interval '10 minutes');
 RETURN true;
END $confirm$;

CREATE FUNCTION crest_private.current_google_calendar_destination_review(
 business uuid,app_session uuid,actor uuid,epoch uuid,generation bigint,client text,destination uuid
) RETURNS crest_private.google_calendar_destination_reviews LANGUAGE sql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
 SELECT r FROM crest_private.google_calendar_destination_reviews r
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id,d.provider_calendar_id)=(r.business_id,r.destination_id,r.provider_calendar_id)
 WHERE (r.business_id,r.app_session_id,r.actor_id,r.recovery_epoch,r.generation,r.client_id,r.destination_id)
  =($1,$2,$3,$4,$5,$6,$7)
 AND r.reviewed_at<=clock_timestamp() AND r.expires_at>clock_timestamp()
 ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1
$review$;

-- The combined read/admit provides the exact reviewed target only after the
-- database has reserved one provider request in the shared quota window.
CREATE FUNCTION crest_commands.admit_google_calendar_setup_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; reviewed crest_private.google_calendar_destination_reviews; exchange record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NULL THEN RETURN NULL; END IF;
 SELECT e.deadline,e.admitted_at INTO exchange FROM crest_private.google_calendar_code_exchanges e
 WHERE (e.business_id,e.attempt_id,e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id,e.generation,e.destination_id)
  =(business,attempt,app_session,actor,epoch,google_client,admit_google_calendar_setup_destination.generation,boundary.destination_id);
 IF NOT FOUND THEN RETURN NULL; END IF;
 reviewed:=crest_private.current_google_calendar_destination_review(business,app_session,actor,epoch,generation,google_client,boundary.destination_id);
 IF reviewed.id IS NULL OR reviewed.reviewed_at>exchange.admitted_at THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR exchange.deadline<=stamp OR reviewed.expires_at<=stamp OR provider_valid_until<=stamp THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_request_admissions(business_id,setup_attempt_id,kind,admitted_at)
 VALUES(business,attempt,'verify_setup_destination',stamp) ON CONFLICT(business_id,setup_attempt_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('destinationId',reviewed.destination_id,'providerCalendarId',reviewed.provider_calendar_id,
  'reviewedCalendarOwner',reviewed.calendar_owner);
END $admit$;

CREATE FUNCTION crest_commands.finish_google_calendar_setup_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid,destination uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE boundary record; reviewed crest_private.google_calendar_destination_reviews; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR destination IS NULL OR boundary.destination_id IS DISTINCT FROM destination THEN RETURN false; END IF;
 reviewed:=crest_private.current_google_calendar_destination_review(business,app_session,actor,epoch,generation,google_client,destination);
 IF reviewed.id IS NULL THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e JOIN crest.google_calendar_request_admissions a
  ON (a.business_id,a.setup_attempt_id)=(e.business_id,e.attempt_id)
  WHERE (e.business_id,e.attempt_id,e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id,e.generation,e.destination_id)
   =(business,attempt,app_session,actor,epoch,google_client,finish_google_calendar_setup_destination.generation,destination)
   AND a.kind='verify_setup_destination' AND a.admitted_at<=stamp AND e.deadline>stamp AND reviewed.reviewed_at<=e.admitted_at)
 THEN RETURN false; END IF;
 INSERT INTO crest_private.google_calendar_destination_verifications(business_id,attempt_id,review_id,destination_id,verified_at)
 VALUES(business,attempt,reviewed.id,destination,stamp) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $finish$;

CREATE FUNCTION crest_commands.stage_google_calendar_credential(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,attempt uuid,new_credential uuid,key text,envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stage$
DECLARE configured record; exchange record; generation bigint; active_key text; stamp timestamptz; inserted uuid;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR configured.client_id IS NULL OR active_key IS DISTINCT FROM key OR key=configured.verifier_key_id
  OR new_credential IS NULL OR new_credential='00000000-0000-0000-0000-000000000000' THEN RETURN NULL; END IF;
 SELECT e.* INTO exchange FROM crest_private.google_calendar_code_exchanges e WHERE (e.business_id,e.attempt_id,e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id)
  =(business,attempt,app_session,actor,epoch,configured.client_id);
 IF NOT FOUND OR exchange.destination_id IS DISTINCT FROM destination
  OR NOT EXISTS(SELECT FROM crest_private.google_calendar_destination_verifications v
   WHERE (v.business_id,v.attempt_id,v.destination_id)=(business,attempt,destination))
 THEN RETURN NULL; END IF;
 SELECT coalesce(max(c.generation),0) INTO generation FROM crest.google_calendar_consents c WHERE (c.business_id,c.destination_id)=(business,destination);
 stamp:=clock_timestamp();
 IF generation<>exchange.generation OR generation>=9223372036854775807 OR stamp>=exchange.deadline OR stamp<exchange.admitted_at
  OR crest_private.valid_google_calendar_credential(envelope,key,business,destination,generation+1,epoch,configured.client_id,new_credential,1) IS DISTINCT FROM true
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_credentials(id,business_id,destination_id,connection_generation,recovery_epoch,
  client_id,key_id,scope,envelope,version,source_exchange,created_at,updated_at)
 VALUES(new_credential,business,destination,generation+1,epoch,configured.client_id,key,
  'https://www.googleapis.com/auth/calendar.app.created',envelope,1,attempt,stamp,stamp)
 ON CONFLICT DO NOTHING RETURNING id INTO inserted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('credentialId',inserted,'generation',(generation+1)::text,'version','1');
END $stage$;

CREATE FUNCTION crest_private.lock_google_calendar_credential(
 business uuid,destination uuid,epoch uuid,generation bigint
) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
DECLARE authority record; consent record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_FRESH_TRANSACTION_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p WHERE (p.business_id,p.principal)=(business,session_user)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED';
 END IF;
 SELECT r.active_epoch,r.writes_enabled INTO authority FROM crest_private.business_recovery_authorities r WHERE r.business_id=business FOR SHARE;
 IF NOT FOUND OR (authority.active_epoch,authority.writes_enabled) IS DISTINCT FROM (epoch,true) THEN RETURN false; END IF;
 PERFORM d.id FROM crest.google_calendar_destinations d WHERE (d.business_id,d.id)=(business,destination) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT c.generation,c.recovery_epoch,c.state INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR (consent.generation,consent.recovery_epoch,consent.state) IS DISTINCT FROM (generation,epoch,'active') THEN RETURN false; END IF;
 PERFORM set_config('crest.calendar_credential_business',business::text,true);
 RETURN true;
END $lock$;

CREATE FUNCTION crest_commands.claim_google_calendar_refresh(
 business uuid,destination uuid,epoch uuid,generation bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
DECLARE current_row record; prior record; configured record; active_key text; stamp timestamptz; claim uuid;
BEGIN
 IF NOT crest_private.lock_google_calendar_credential(business,destination,epoch,generation) THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key=configured.verifier_key_id THEN RETURN NULL; END IF;
 SELECT c.id,c.version,c.key_id,c.envelope INTO current_row FROM crest_private.google_calendar_credentials c
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch,c.client_id,c.key_id)
  =(business,destination,generation,epoch,configured.client_id,active_key) FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT a.deadline,r.outcome INTO prior FROM crest_private.google_calendar_refresh_claims a
 LEFT JOIN crest_private.google_calendar_refresh_results r ON (r.business_id,r.claim_id)=(a.business_id,a.id)
 WHERE (a.business_id,a.credential_id,a.credential_version)=(business,current_row.id,current_row.version);
 IF FOUND THEN RETURN jsonb_build_object('state',CASE WHEN prior.outcome='reconnect' THEN 'reconnect'
  WHEN prior.outcome IS NOT NULL OR prior.deadline<=stamp THEN 'uncertain' ELSE 'busy' END); END IF;
 INSERT INTO crest_private.google_calendar_refresh_claims(business_id,credential_id,credential_version,worker_principal,admitted_at,deadline)
 VALUES(business,current_row.id,current_row.version,session_user,stamp,stamp+interval '30 seconds') RETURNING id INTO claim;
 RETURN jsonb_build_object('state','claimed','claimId',claim,'deadline',stamp+interval '30 seconds',
  'credentialId',current_row.id,'version',current_row.version::text,'keyId',current_row.key_id,'envelope',current_row.envelope);
END $claim$;

CREATE FUNCTION crest_commands.finish_google_calendar_refresh(
 business uuid,destination uuid,epoch uuid,generation bigint,claim uuid,outcome text,replacement_key text,replacement jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE current_row record; admitted record; prior text; configured record; active_key text; stamp timestamptz;
BEGIN
 IF NOT crest_private.lock_google_calendar_credential(business,destination,epoch,generation) THEN RETURN NULL; END IF;
 IF outcome IS NULL OR outcome NOT IN('rotated','reconnect','uncertain') OR
  ((outcome='rotated')<>(replacement_key IS NOT NULL AND replacement IS NOT NULL)) OR
  (outcome<>'rotated' AND (replacement_key IS NOT NULL OR replacement IS NOT NULL))
 THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key=configured.verifier_key_id THEN RETURN NULL; END IF;
 SELECT c.id,c.version INTO current_row FROM crest_private.google_calendar_credentials c
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch,c.client_id)
  =(business,destination,generation,epoch,configured.client_id) FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT a.id,a.deadline,a.credential_version INTO admitted FROM crest_private.google_calendar_refresh_claims a
 WHERE (a.business_id,a.id,a.credential_id,a.worker_principal)=(business,claim,current_row.id,session_user);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.outcome INTO prior FROM crest_private.google_calendar_refresh_results r WHERE (r.business_id,r.claim_id)=(business,claim);
 IF FOUND THEN
  IF prior=outcome AND prior<>'rotated' THEN RETURN jsonb_build_object('state',prior); END IF;
  RETURN NULL;
 END IF;
 stamp:=clock_timestamp();
 IF current_row.version<>admitted.credential_version OR (outcome<>'uncertain' AND stamp>=admitted.deadline) THEN RETURN NULL; END IF;
 IF outcome='rotated' THEN
  IF active_key IS DISTINCT FROM replacement_key OR current_row.version>=9223372036854775807
   OR crest_private.valid_google_calendar_credential(replacement,active_key,business,destination,generation,epoch,configured.client_id,
    current_row.id,current_row.version+1) IS DISTINCT FROM true
  THEN RETURN NULL; END IF;
  UPDATE crest_private.google_calendar_credentials c SET envelope=replacement,key_id=active_key,version=c.version+1,updated_at=stamp
  WHERE (c.business_id,c.id)=(business,current_row.id);
 END IF;
 INSERT INTO crest_private.google_calendar_refresh_results(business_id,claim_id,outcome,recorded_at) VALUES(business,claim,outcome,stamp);
 RETURN jsonb_build_object('state',outcome);
END $finish$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.lock_google_calendar_request_budget() TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.confirm_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,text,text,boolean)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.current_google_calendar_destination_review(uuid,uuid,uuid,uuid,bigint,text,uuid) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION
 crest_commands.confirm_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,text,text,boolean),
 crest_private.current_google_calendar_destination_review(uuid,uuid,uuid,uuid,bigint,text,uuid),
 crest_commands.admit_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.finish_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.confirm_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,text,text,boolean),
 crest_commands.admit_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.finish_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,uuid) TO crest_calendar_oauth;
ALTER FUNCTION crest_private.valid_google_calendar_credential(jsonb,text,uuid,uuid,bigint,uuid,text,uuid,bigint) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.drain_google_calendar_refresh_on_disconnect() OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.lock_google_calendar_credential(uuid,uuid,uuid,bigint) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.stage_google_calendar_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.claim_google_calendar_refresh(uuid,uuid,uuid,bigint) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_refresh(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_private.valid_google_calendar_credential(jsonb,text,uuid,uuid,bigint,uuid,text,uuid,bigint),
 crest_private.drain_google_calendar_refresh_on_disconnect(),
 crest_private.lock_google_calendar_credential(uuid,uuid,uuid,bigint),
 crest_commands.admit_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.stage_google_calendar_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb),
 crest_commands.claim_google_calendar_refresh(uuid,uuid,uuid,bigint),
 crest_commands.finish_google_calendar_refresh(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_google_calendar_credential(jsonb,text,uuid,uuid,bigint,uuid,text,uuid,bigint),
 crest_private.google_calendar_oauth_base64url(bytea) TO crest_calendar_dispatch_owner;
GRANT EXECUTE ON FUNCTION
 crest_commands.admit_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.stage_google_calendar_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb)
 TO crest_calendar_oauth;
GRANT EXECUTE ON FUNCTION crest_commands.claim_google_calendar_refresh(uuid,uuid,uuid,bigint),
 crest_commands.finish_google_calendar_refresh(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) TO crest_calendar_dispatch;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-credentials.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-destination-creation.sql
-- P20/BR21 held, initial creation only. An unresolved insert remains blocked
-- across later OAuth attempts and recovery epochs. No blind retry or adoption.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.google_calendar_creation_intents (
 business_id uuid PRIMARY KEY REFERENCES crest.businesses(id),
 attempt_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 reviewed_google_owner text NOT NULL CHECK(char_length(reviewed_google_owner)<=254 AND reviewed_google_owner COLLATE "C" ~
  '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'),
 correlation_marker uuid NOT NULL DEFAULT gen_random_uuid(),
 confirmed_at timestamptz NOT NULL CHECK(isfinite(confirmed_at)),
 UNIQUE(business_id,attempt_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE TABLE crest_private.google_calendar_creation_results (
 business_id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 outcome text NOT NULL CHECK(outcome IN('created','review','uncertain')),
 provider_calendar_id text UNIQUE CHECK(provider_calendar_id COLLATE "C" ~
  '^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group[.]calendar[.]google[.]com$'),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest.google_calendar_request_admissions(business_id,creation_attempt_id),
 CHECK((outcome='created')=(provider_calendar_id IS NOT NULL))
);
ALTER TABLE crest.google_calendar_request_admissions ADD FOREIGN KEY(business_id,creation_attempt_id)
 REFERENCES crest_private.google_calendar_creation_intents(business_id,attempt_id);

DO $roles$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_creation_intents','google_calendar_creation_results'] LOOP
  EXECUTE format('ALTER TABLE crest_private.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest_private.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE TRIGGER calendar_creation_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
  EXECUTE format('GRANT SELECT,INSERT ON crest_private.%I TO crest_calendar_oauth_owner',relation);
  EXECUTE format('CREATE POLICY calendar_creation_read ON crest_private.%I FOR SELECT TO crest_calendar_oauth_owner
    USING(business_id=nullif(current_setting(''crest.calendar_oauth_business'',true),'''')::uuid)',relation);
  EXECUTE format('CREATE POLICY calendar_creation_append ON crest_private.%I FOR INSERT TO crest_calendar_oauth_owner
    WITH CHECK(business_id=nullif(current_setting(''crest.calendar_oauth_business'',true),'''')::uuid)',relation);
 END LOOP;
END $roles$;
GRANT SELECT(creation_attempt_id),INSERT(creation_attempt_id) ON crest.google_calendar_request_admissions TO crest_calendar_oauth_owner;
CREATE POLICY calendar_creation_admit ON crest.google_calendar_request_admissions FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND kind='create_secondary'
  AND creation_attempt_id IS NOT NULL AND lease_id IS NULL AND setup_attempt_id IS NULL);

GRANT INSERT(id,business_id,provider_calendar_id,created_by,operation_id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
CREATE POLICY calendar_creation_destination_insert ON crest.google_calendar_destinations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.google_calendar_creation_results r
   WHERE r.business_id=google_calendar_destinations.business_id AND r.outcome='created'
    AND r.provider_calendar_id=google_calendar_destinations.provider_calendar_id));
CREATE POLICY calendar_creation_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.create');
CREATE POLICY calendar_creation_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND command_type='calendar.connection.create' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_creation_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND command_type='calendar.connection.create' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND command_type='calendar.connection.create' AND state='committed');
CREATE POLICY calendar_creation_audit_append ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND entity_kind='google_calendar_connections' AND action='stage_creation' AND origin='manual');

-- A later OAuth grant may have access to the same calendar through sharing.
-- Until provider-subject proof is added, it cannot replace the original grant.
CREATE FUNCTION crest_private.refuse_unproved_google_calendar_reconnect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $reconnect$
BEGIN
 IF NEW.destination_id IS NOT NULL AND EXISTS(SELECT FROM crest_private.google_calendar_creation_results r
  JOIN crest.google_calendar_destinations d ON (d.business_id,d.provider_calendar_id)=(r.business_id,r.provider_calendar_id)
  WHERE r.outcome='created' AND (d.business_id,d.id)=(NEW.business_id,NEW.destination_id)) THEN RETURN NULL; END IF;
 RETURN NEW;
END $reconnect$;
CREATE TRIGGER calendar_creation_reconnect_fence BEFORE INSERT ON crest_private.google_calendar_code_exchanges
 FOR EACH ROW EXECUTE FUNCTION crest_private.refuse_unproved_google_calendar_reconnect();

-- Pin a reviewed Google owner in the same current Crest session that started
-- the still-live attempt. No external request is made by this command.
CREATE FUNCTION crest_commands.confirm_google_calendar_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,reviewed_google_owner text,confirmed boolean
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE boundary record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL OR confirmed IS DISTINCT FROM true OR reviewed_google_owner IS NULL
  OR char_length(reviewed_google_owner)>254 OR reviewed_google_owner COLLATE "C" !~
   '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$' THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a
  WHERE (a.business_id,a.id,a.session_id,a.actor_id,a.recovery_epoch,a.connection_generation,a.client_id,a.verifier_key_id)
   =(business,attempt,app_session,actor,epoch,0,google_client,boundary.verifier_key)
   AND a.destination_id IS NULL AND a.retired_at IS NULL AND a.created_at<=stamp AND a.expires_at>stamp)
 THEN RETURN false; END IF;
 INSERT INTO crest_private.google_calendar_creation_intents(business_id,attempt_id,actor_id,app_session_id,recovery_epoch,
  client_id,reviewed_google_owner,confirmed_at)
 VALUES(business,attempt,actor,app_session,epoch,google_client,reviewed_google_owner,stamp)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $confirm$;

CREATE FUNCTION crest_commands.admit_google_calendar_creation_exchange(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $exchange$
DECLARE boundary record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_intents i
  JOIN crest_private.google_calendar_oauth_attempts a ON (a.business_id,a.id)=(i.business_id,i.attempt_id)
  WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
   =(business,attempt,app_session,actor,epoch,google_client)
   AND a.connection_generation=0 AND a.destination_id IS NULL AND a.verifier_key_id=boundary.verifier_key
   AND a.consumed_at>=i.confirmed_at AND a.consumed_at<=stamp AND a.expires_at>stamp)
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_code_exchanges(business_id,attempt_id,app_session_id,actor_id,recovery_epoch,
  client_id,generation,admitted_at,deadline)
 VALUES(business,attempt,app_session,actor,epoch,google_client,0,stamp,stamp+interval '30 seconds')
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',attempt,'deadline',stamp+interval '30 seconds');
END $exchange$;

CREATE FUNCTION crest_commands.admit_google_calendar_secondary_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; retained record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL THEN RETURN NULL; END IF;
 SELECT i.correlation_marker,i.reviewed_google_owner,e.deadline INTO retained
 FROM crest_private.google_calendar_creation_intents i JOIN crest_private.google_calendar_code_exchanges e
  ON (e.business_id,e.attempt_id)=(i.business_id,i.attempt_id)
 WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
  =(business,attempt,app_session,actor,epoch,google_client) AND e.generation=0 AND e.destination_id IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR retained.deadline<=stamp OR provider_valid_until<=stamp THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_request_admissions(business_id,creation_attempt_id,kind,admitted_at)
 VALUES(business,attempt,'create_secondary',stamp) ON CONFLICT(business_id,creation_attempt_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('correlationMarker',retained.correlation_marker,'reviewedGoogleOwner',retained.reviewed_google_owner);
END $admit$;

-- Records only what the trusted provider adapter observed. The creation
-- response proves the caller's account email for this operation. It does not
-- identify a later grant or establish sharing/ACL state.
CREATE FUNCTION crest_commands.finish_google_calendar_secondary_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,
 reported_outcome text,provider_id text,observed_owner text,observed_marker uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE boundary record; retained record; stamp timestamptz; outcome text;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL OR reported_outcome IS NULL
  OR reported_outcome NOT IN('created','review','uncertain') THEN RETURN false; END IF;
 SELECT i.reviewed_google_owner,i.correlation_marker,e.deadline,a.admitted_at INTO retained
 FROM crest_private.google_calendar_creation_intents i JOIN crest_private.google_calendar_code_exchanges e
  ON (e.business_id,e.attempt_id)=(i.business_id,i.attempt_id)
 JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.creation_attempt_id)=(i.business_id,i.attempt_id)
 WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
  =(business,attempt,app_session,actor,epoch,google_client) AND e.generation=0 AND e.destination_id IS NULL AND a.kind='create_secondary';
 IF NOT FOUND THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF stamp<retained.admitted_at OR (reported_outcome<>'uncertain' AND stamp>=retained.deadline) THEN RETURN false; END IF;
 outcome:=reported_outcome;
 IF outcome='created' AND (observed_owner IS DISTINCT FROM retained.reviewed_google_owner
  OR observed_marker IS DISTINCT FROM retained.correlation_marker OR provider_id IS NULL OR provider_id COLLATE "C" !~
   '^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group[.]calendar[.]google[.]com$') THEN outcome:='review'; END IF;
 INSERT INTO crest_private.google_calendar_creation_results(business_id,attempt_id,recorded_at,outcome,provider_calendar_id)
 VALUES(business,attempt,stamp,outcome,CASE WHEN outcome='created' THEN provider_id END) ON CONFLICT DO NOTHING;
 RETURN FOUND AND outcome=reported_outcome;
END $finish$;

-- Called only from the original server callback while it still holds the
-- grant used for creation. The operation records redacted provenance and
-- atomically stages the destination and credential without activating consent.
CREATE FUNCTION crest_commands.promote_google_calendar_initial_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,
 destination uuid,new_credential uuid,key text,envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $promote$
DECLARE boundary record; evidence record; active_key text; stamp timestamptz; receipt jsonb; fingerprint text;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL OR destination IS NULL OR new_credential IS NULL
  OR destination='00000000-0000-0000-0000-000000000000' OR new_credential='00000000-0000-0000-0000-000000000000'
  OR destination=new_credential THEN RETURN NULL; END IF;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key IS DISTINCT FROM key OR active_key=boundary.verifier_key THEN RETURN NULL; END IF;
 SELECT r.provider_calendar_id,r.recorded_at,e.deadline INTO evidence
 FROM crest_private.google_calendar_creation_results r JOIN crest_private.google_calendar_creation_intents i
 ON (i.business_id,i.attempt_id)=(r.business_id,r.attempt_id)
 JOIN crest_private.google_calendar_code_exchanges e ON (e.business_id,e.attempt_id)=(r.business_id,r.attempt_id)
 WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
  =(business,attempt,app_session,actor,epoch,google_client) AND r.outcome='created'
  AND (e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id,e.generation)=(app_session,actor,epoch,google_client,0)
  AND e.destination_id IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF evidence.recorded_at>stamp OR evidence.deadline<=stamp OR
  crest_private.valid_google_calendar_credential(envelope,key,business,destination,1,epoch,google_client,new_credential,1) IS DISTINCT FROM true
 THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_creation_operation',attempt::text,true);
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(attempt,destination,new_credential,epoch)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,attempt,actor,'calendar.connection.create',1,epoch,fingerprint,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
 VALUES(destination,business,evidence.provider_calendar_id,actor,attempt);
 INSERT INTO crest_private.google_calendar_credentials(id,business_id,destination_id,connection_generation,recovery_epoch,
  client_id,key_id,scope,envelope,version,source_exchange,created_at,updated_at)
 VALUES(new_credential,business,destination,1,epoch,google_client,key,
  'https://www.googleapis.com/auth/calendar.app.created',envelope,1,attempt,stamp,stamp);
 receipt:=jsonb_build_object('schemaVersion',1,'destinationId',destination,'credentialId',new_credential,'generation','1','version','1');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,attempt,actor,actor,'google_calendar_connections',destination,1,'stage_creation',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('destinationId',destination,'generation','1','state','staged')),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
 WHERE (o.business_id,o.operation_id)=(business,attempt);
 RETURN receipt;
END $promote$;

RESET ROLE;
ALTER FUNCTION crest_private.refuse_unproved_google_calendar_reconnect() OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.promote_google_calendar_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_private.refuse_unproved_google_calendar_reconnect(),
 crest_commands.promote_google_calendar_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.promote_google_calendar_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb)
 TO crest_calendar_oauth;
ALTER FUNCTION crest_commands.confirm_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,boolean) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,text,text,uuid) OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION
 crest_commands.confirm_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,boolean),
 crest_commands.admit_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.admit_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.finish_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.confirm_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,boolean),
 crest_commands.admit_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.admit_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.finish_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,text,text,uuid) TO crest_calendar_oauth;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-destination-creation.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-initial-consent.sql
-- P20/BR21. Held initial explicit consent over the exact staged creation.
-- No automatic backfill, provider request, session grant, or runtime mount.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.google_calendar_initial_consent_reviews (
 business_id uuid NOT NULL,
 id uuid NOT NULL,
 destination_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 client_name boolean NOT NULL,
 service_label boolean NOT NULL,
 work_address boolean NOT NULL,
 payload_version integer NOT NULL CHECK(payload_version=1),
 reviewed_at timestamptz NOT NULL CHECK(isfinite(reviewed_at)),
 expires_at timestamptz NOT NULL CHECK(expires_at=reviewed_at+interval '10 minutes'),
 PRIMARY KEY(business_id,id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,credential_id) REFERENCES crest_private.google_calendar_credentials(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE INDEX calendar_initial_review_session ON crest_private.google_calendar_initial_consent_reviews(business_id,app_session_id,reviewed_at DESC);
ALTER TABLE crest_private.google_calendar_initial_consent_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_initial_consent_reviews FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_initial_consent_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.google_calendar_initial_consent_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest_private.google_calendar_initial_consent_reviews TO crest_calendar_oauth_owner;
CREATE POLICY calendar_initial_review_read ON crest_private.google_calendar_initial_consent_reviews FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid);
CREATE POLICY calendar_initial_review_append ON crest_private.google_calendar_initial_consent_reviews FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_initial_consent_append ON crest.google_calendar_consents FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND generation=1 AND state='active'
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid);
GRANT SELECT(id) ON crest.google_calendar_consents TO crest_calendar_oauth_owner;
GRANT SELECT(operation_id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
CREATE POLICY calendar_initial_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.consent.activate');
CREATE POLICY calendar_initial_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND command_type='calendar.consent.activate' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_initial_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND command_type='calendar.consent.activate' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND command_type='calendar.consent.activate' AND state='committed');
CREATE POLICY calendar_initial_audit_append ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND entity_kind='google_calendar_connections' AND action='activate' AND origin='manual');

CREATE FUNCTION crest_private.lock_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid
) RETURNS TABLE(google_client text,google_owner text,provider_calendar text)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 -- Activation requires the proven original provider response and the same
 -- connection/session/epoch that staged its grant. No seed or later token.
 RETURN QUERY SELECT c.client_id,i.reviewed_google_owner,r.provider_calendar_id
 FROM crest_private.google_calendar_credentials c
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id,d.operation_id)=(c.business_id,c.destination_id,c.source_exchange)
 JOIN crest_private.google_calendar_creation_results r ON (r.business_id,r.attempt_id,r.provider_calendar_id)=(d.business_id,d.operation_id,d.provider_calendar_id)
 JOIN crest_private.google_calendar_creation_intents i ON (i.business_id,i.attempt_id)=(r.business_id,r.attempt_id)
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id AND o.verifier_key_id<>k.key_id
 WHERE (c.business_id,c.destination_id,c.id,c.recovery_epoch)=(business,destination,staged_grant,epoch)
  AND (i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)=(app_session,actor,epoch,c.client_id)
  AND c.connection_generation=1 AND c.version=1 AND r.outcome='created' AND i.confirmed_at<=r.recorded_at
  AND NOT EXISTS(SELECT FROM crest.google_calendar_consents consent WHERE (consent.business_id,consent.destination_id)=(business,destination))
 FOR SHARE OF k,o;
END $lock$;

CREATE FUNCTION crest_commands.prepare_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid,client_name boolean,service_label boolean,work_address boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $prepare$
DECLARE binding record; stamp timestamptz;
BEGIN
 SELECT * INTO binding FROM crest_private.lock_google_calendar_initial_consent(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination,staged_grant);
 IF NOT FOUND OR review IS NULL OR client_name IS NULL OR service_label IS NULL OR work_address IS NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF (SELECT count(*) FROM crest_private.google_calendar_initial_consent_reviews v
  WHERE (v.business_id,v.app_session_id)=(business,app_session) AND v.reviewed_at>stamp-interval '10 minutes')>=20
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_initial_consent_reviews(business_id,id,destination_id,credential_id,actor_id,app_session_id,
  recovery_epoch,client_id,client_name,service_label,work_address,payload_version,reviewed_at,expires_at)
 VALUES(business,review,destination,staged_grant,actor,app_session,epoch,binding.google_client,client_name,service_label,work_address,1,stamp,
  stamp+interval '10 minutes') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('reviewId',review,'destinationId',destination,'providerCalendarId',binding.provider_calendar,
  'googleOwner',binding.google_owner,'credentialId',staged_grant,'payloadVersion',1,'expiresAt',stamp+interval '10 minutes',
  'disclosure',jsonb_build_object('clientName',client_name,'serviceLabel',service_label,'workAddress',work_address));
END $prepare$;

CREATE FUNCTION crest_commands.confirm_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid,client_name boolean,service_label boolean,work_address boolean,
 reviewed_payload boolean,reviewed_sharing boolean,reviewed_notifications boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE binding record; selected record; receipt jsonb; consent uuid;
BEGIN
 IF reviewed_payload IS DISTINCT FROM true OR reviewed_sharing IS DISTINCT FROM true OR reviewed_notifications IS DISTINCT FROM true
  OR review IS NULL OR client_name IS NULL OR service_label IS NULL OR work_address IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO binding FROM crest_private.lock_google_calendar_initial_consent(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination,staged_grant);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT v.* INTO selected FROM crest_private.google_calendar_initial_consent_reviews v
 WHERE (v.business_id,v.id,v.destination_id,v.credential_id,v.actor_id,v.app_session_id,v.recovery_epoch,v.client_id)
  =(business,review,destination,staged_grant,actor,app_session,epoch,binding.google_client)
  AND v.payload_version=1 AND (v.client_name,v.service_label,v.work_address)
   =(confirm_google_calendar_initial_consent.client_name,confirm_google_calendar_initial_consent.service_label,
    confirm_google_calendar_initial_consent.work_address)
  AND v.reviewed_at<=clock_timestamp() AND v.expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_initial_consent_operation',review::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,review,actor,'calendar.consent.activate',1,epoch,encode(sha256(convert_to(jsonb_build_array(review,destination,staged_grant,
  selected.payload_version,selected.client_name,selected.service_label,selected.work_address,reviewed_payload,reviewed_sharing,reviewed_notifications)::text,
  'UTF8')),'hex'),actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,client_name,service_label,work_address,created_by,operation_id)
 VALUES(business,destination,1,epoch,'active',selected.client_name,selected.service_label,selected.work_address,actor,review) RETURNING id INTO consent;
 receipt:=jsonb_build_object('schemaVersion',1,'state','active','destinationId',destination,'consentId',consent,'generation','1',
  'payloadVersion',selected.payload_version,'disclosure',jsonb_build_object('clientName',selected.client_name,
   'serviceLabel',selected.service_label,'workAddress',selected.work_address));
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,review,actor,actor,'google_calendar_connections',destination,1,'activate',
  jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('state','staged'),'after',receipt||
   jsonb_build_object('sharingReviewed',true,'notificationsReviewed',true,'payloadReviewed',true)),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
 WHERE (o.business_id,o.operation_id)=(business,review);
 RETURN receipt;
END $confirm$;

CREATE FUNCTION crest_commands.lookup_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE result jsonb; selected record; current_consent record;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 SELECT v.id INTO selected FROM crest_private.google_calendar_initial_consent_reviews v
 WHERE (v.business_id,v.id,v.destination_id,v.credential_id,v.actor_id,v.app_session_id,v.recovery_epoch)
  =(business,review,destination,staged_grant,actor,app_session,epoch);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.result INTO result FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id,o.recovery_epoch)=(business,review,actor,epoch)
  AND o.command_type='calendar.consent.activate' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT c.id,c.generation,c.state INTO current_consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR current_consent.generation<>1 OR current_consent.state<>'active'
  OR current_consent.id::text IS DISTINCT FROM result->>'consentId'
 THEN RETURN jsonb_build_object('state','changed'); END IF;
 RETURN result;
END $lookup$;

RESET ROLE;
ALTER FUNCTION crest_private.lock_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.prepare_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.confirm_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.lookup_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.prepare_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean),
 crest_commands.confirm_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean),
 crest_commands.lookup_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.prepare_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean),
 crest_commands.confirm_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean),
 crest_commands.lookup_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 TO crest_calendar_oauth;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-initial-consent.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-setup-state.sql
-- P20/BR21. Read the owner's current setup under the existing authority fence.
-- Retained state contains no token, OAuth state, PKCE verifier or private key.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_google_calendar_setup_state(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $state$
DECLARE destination uuid; consent record; staged uuid; creation boolean;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||business::text,0));
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 SELECT d.id INTO destination FROM crest.google_calendar_destinations d WHERE d.business_id=business FOR SHARE;
 IF destination IS NULL THEN
  SELECT EXISTS(SELECT FROM crest_private.google_calendar_creation_intents i WHERE i.business_id=business) INTO creation;
  RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN creation THEN 'review' ELSE 'ready' END);
 END IF;
 SELECT c.state,c.recovery_epoch INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF FOUND AND (consent.recovery_epoch<>epoch OR consent.state<>'active') THEN
  RETURN jsonb_build_object('schemaVersion',1,'state','review');
 END IF;
 SELECT c.id INTO staged FROM crest_private.google_calendar_credentials c
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id,d.operation_id)=(c.business_id,c.destination_id,c.source_exchange)
 JOIN crest_private.google_calendar_creation_results r ON (r.business_id,r.attempt_id,r.provider_calendar_id)=(d.business_id,d.operation_id,d.provider_calendar_id)
 JOIN crest_private.google_calendar_creation_intents i ON (i.business_id,i.attempt_id)=(r.business_id,r.attempt_id)
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id
 WHERE (c.business_id,c.destination_id,c.recovery_epoch,i.app_session_id,i.actor_id,i.recovery_epoch)
  =(business,destination,epoch,app_session,actor,epoch)
  AND c.connection_generation=1 AND r.outcome='created' AND (consent.state='active' OR c.version=1);
 IF staged IS NOT NULL THEN
  RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN consent.state='active' THEN 'active' ELSE 'staged' END,
   'destinationId',destination,'credentialId',staged,'recoveryEpoch',epoch);
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN consent.state='active' THEN 'active' ELSE 'review' END);
END $state$;
RESET ROLE;
ALTER FUNCTION crest_commands.read_google_calendar_setup_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_setup_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_setup_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_calendar_oauth;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-setup-state.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-worker-material.sql
-- P20/BR21. Read the retained appointment, exact previous evidence, sealed
-- grant and only the individually consented display fields.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(local_start,local_end,start_offset_minutes,end_offset_minutes) ON crest.appointments TO crest_calendar_dispatch_owner;

CREATE FUNCTION crest_commands.read_google_calendar_worker_material(
 business uuid,destination uuid,job uuid,generation bigint,epoch uuid,requested_lease uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $material$
DECLARE boundary record; source record; prior record; prior_body text; prior_digest text; credential record;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_dispatch(business,destination,job,generation,epoch);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.id,o.action,o.appointment_sequence,l.mode,a.start_at,a.end_at,a.timezone,a.local_start,a.local_end,
  a.start_offset_minutes,a.end_offset_minutes INTO source
 FROM crest.google_calendar_dispatch_leases l
 JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 JOIN crest.appointments a ON (a.business_id,a.job_id,a.id)=(o.business_id,o.job_id,o.appointment_id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.mapping_id,o.connection_generation,o.recovery_epoch)=(boundary.mapping_id,generation,epoch)
  AND l.lease_until>clock_timestamp()+interval '15 seconds'
  AND (l.mode='reconcile' OR o.appointment_id=boundary.appointment_id)
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id));
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.id,r.outcome,r.provider_etag INTO prior
 FROM crest.google_calendar_outbox o
 JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(o.business_id,o.id)
 JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
 WHERE (o.business_id,o.mapping_id,o.connection_generation,o.recovery_epoch)=(business,boundary.mapping_id,generation,epoch)
  AND o.appointment_sequence<source.appointment_sequence AND r.outcome IN ('published','removed','no_effect')
 ORDER BY o.appointment_sequence DESC,l.attempt_no DESC LIMIT 1;
 IF prior.outcome='published' THEN
  SELECT s.request_body,s.request_sha256 INTO prior_body,prior_digest FROM crest.google_calendar_dispatch_leases l
  JOIN crest.google_calendar_dispatch_sends s ON (s.business_id,s.lease_id)=(l.business_id,l.id)
  JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id,a.kind)=(s.business_id,s.lease_id,s.action)
  WHERE (l.business_id,l.outbox_id)=(business,prior.id) ORDER BY l.attempt_no DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','review'); END IF;
 END IF;
 -- The same generation and the exact dedicated worker are pinned by the
 -- dispatch boundary above. RLS admits only the worker's business here.
 PERFORM set_config('crest.calendar_credential_business',business::text,true);
 SELECT c.id,c.client_id,c.key_id,c.version,c.envelope INTO credential FROM crest_private.google_calendar_credentials c
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id AND k.key_id<>o.verifier_key_id
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch)=(business,destination,generation,epoch);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','reconnect'); END IF;
 RETURN jsonb_build_object('state','ready','outboxId',source.id,
  'disclosure',jsonb_build_object('clientName',boundary.share_client,'serviceLabel',boundary.share_service,'workAddress',boundary.share_address),
  'fields',CASE WHEN source.action='publish' AND source.mode='dispatch' THEN
   crest_private.google_calendar_disclosed_fields(business,job,boundary.share_client,boundary.share_service,boundary.share_address)
   ELSE jsonb_build_object('clientName',null,'serviceLabel',null,'workAddress',null) END,
  'time',CASE WHEN source.action='publish' THEN jsonb_build_object(
    'start_at',to_char(source.start_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'end_at',to_char(source.end_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'timezone',source.timezone,
    'local_start',to_char(source.local_start,'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'local_end',to_char(source.local_end,'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'start_offset_minutes',source.start_offset_minutes,'end_offset_minutes',source.end_offset_minutes) END,
  'previous',CASE WHEN prior.outcome='published' THEN jsonb_build_object(
    'etag',prior.provider_etag,'body',prior_body,'sha256',prior_digest) END,
  'credential',jsonb_build_object('credentialId',credential.id,'clientId',credential.client_id,'keyId',credential.key_id,
    'version',credential.version::text,'envelope',credential.envelope));
END $material$;
RESET ROLE;
ALTER FUNCTION crest_commands.read_google_calendar_worker_material(uuid,uuid,uuid,bigint,uuid,uuid) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_worker_material(uuid,uuid,uuid,bigint,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_worker_material(uuid,uuid,uuid,bigint,uuid,uuid) TO crest_calendar_dispatch;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-worker-material.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-job-status.sql
-- P20/BR21. Owner-only status for one saved job. No provider requests or
-- event identifiers, request bodies, credentials or customer fields leave SQL.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id,id,current_appointment_id) ON crest.jobs TO crest_calendar_oauth_owner;
CREATE POLICY calendar_status_job ON crest.jobs FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
GRANT SELECT(business_id,id,job_id,sequence) ON crest.appointments TO crest_calendar_oauth_owner;
CREATE POLICY calendar_status_appointment ON crest.appointments FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);

CREATE FUNCTION crest_commands.read_google_calendar_job_status(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE result jsonb;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',false);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);

 -- One snapshot binds the current Crest appointment to the latest consent,
 -- lease and acknowledged result. A proposal does not change current_appointment_id.
 WITH source AS (
  SELECT a.id,a.sequence FROM crest.jobs j JOIN crest.appointments a
   ON (a.business_id,a.job_id,a.id)=(j.business_id,j.id,j.current_appointment_id)
  WHERE (j.business_id,j.id)=(business,job)
 ), consent AS (
  SELECT d.id,c.generation,c.recovery_epoch,c.state FROM crest.google_calendar_destinations d
  JOIN crest.google_calendar_consents c ON (c.business_id,c.destination_id)=(d.business_id,d.id)
  WHERE d.business_id=business ORDER BY c.generation DESC LIMIT 1
 ), current_intent AS (
  SELECT o.id,o.action,o.connection_generation,o.recovery_epoch FROM crest.google_calendar_outbox o
  JOIN source a ON o.appointment_id=a.id JOIN consent c ON o.destination_id=c.id
  WHERE (o.business_id,o.job_id)=(business,job)
 ), last_attempt AS (
  SELECT l.lease_until,l.attempt_no,r.outcome FROM current_intent o
  JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(business,o.id)
  LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  ORDER BY l.attempt_no DESC LIMIT 1
 ), last_confirmation AS (
  SELECT o.appointment_sequence,r.recorded_at FROM crest.google_calendar_outbox o
  JOIN consent c ON (o.destination_id,o.connection_generation,o.recovery_epoch)=(c.id,c.generation,c.recovery_epoch)
  JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(o.business_id,o.id)
  JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  WHERE (o.business_id,o.job_id)=(business,job) AND c.state='active' AND c.recovery_epoch=epoch
   AND r.outcome IN('published','removed','no_effect')
  ORDER BY o.appointment_sequence DESC,l.attempt_no DESC LIMIT 1
 )
 SELECT jsonb_build_object('schemaVersion',1,'jobId',job,'appointmentVersion',a.sequence::text,
  'state',CASE
   WHEN c.id IS NULL THEN 'disconnected'
   WHEN c.recovery_epoch<>epoch OR c.state='paused' THEN 'review'
   WHEN c.state='disconnected' THEN 'disconnected'
   WHEN o.id IS NULL THEN 'not_queued'
   WHEN (o.connection_generation,o.recovery_epoch) IS DISTINCT FROM (c.generation,c.recovery_epoch) THEN 'review'
   WHEN last_attempt.outcome='published' AND o.action='publish' THEN 'synced'
   WHEN last_attempt.outcome IN('removed','no_effect') AND o.action='remove' THEN 'removed'
   WHEN last_attempt.outcome='reconnect' THEN 'reconnect'
   WHEN last_attempt.outcome='review' OR last_attempt.attempt_no>=5 THEN 'review'
   WHEN last_attempt.outcome IN('delayed','uncertain') THEN 'delayed'
   WHEN last_attempt.lease_until>statement_timestamp() THEN 'in_progress'
   ELSE 'pending' END,
  'lastConfirmedVersion',last_confirmation.appointment_sequence::text,
  'lastConfirmedAt',to_char(last_confirmation.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
 INTO result FROM source a LEFT JOIN consent c ON true LEFT JOIN current_intent o ON true
 LEFT JOIN last_attempt ON true LEFT JOIN last_confirmation ON true;
 RETURN result;
END $status$;
RESET ROLE;
ALTER FUNCTION crest_commands.read_google_calendar_job_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_job_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_job_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_calendar_oauth;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-job-status.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-portable-source.sql
-- P20/BR21. Read only the portable Calendar metadata and redacted history.
-- Credential and OAuth proof tables, raw provider bodies and host worker names
-- are deliberately outside the SQL grant as well as the exported dictionary.
CREATE ROLE crest_calendar_export_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_calendar_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_calendar_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_configuration_export_context(uuid) TO crest_calendar_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.google_calendar_source_dictionary()
RETURNS TABLE(source_group text,source_schema text,source_table text,key_column text,fields text[],predicate text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('destinations','crest','google_calendar_destinations','id',
  ARRAY['id','business_id','provider_calendar_id','created_by','operation_id','created_at'],'true'),
 ('consents','crest','google_calendar_consents','id',
  ARRAY['id','business_id','destination_id','generation','previous_generation','recovery_epoch','state',
   'client_name','service_label','work_address','created_by','operation_id','created_at'],'true'),
 ('mappings','crest','google_calendar_mappings','id',
  ARRAY['id','business_id','destination_id','job_id','event_uuid','correlation_marker','created_by','operation_id','created_at'],'true'),
 ('outbox','crest','google_calendar_outbox','id',
  ARRAY['id','business_id','destination_id','connection_generation','recovery_epoch','job_id','appointment_id',
   'appointment_sequence','mapping_id','action','created_by','operation_id','created_at'],'true'),
 ('dispatch_leases','crest','google_calendar_dispatch_leases','id',
  ARRAY['id','business_id','outbox_id','attempt_no','mode','leased_at','lease_until'],'true'),
 ('dispatch_sends','crest','google_calendar_dispatch_sends','id',
  ARRAY['id','business_id','lease_id','action','request_sha256','prior_etag','recorded_at'],'true'),
 ('request_admissions','crest','google_calendar_request_admissions','id',
  ARRAY['id','business_id','lease_id','setup_attempt_id','creation_attempt_id','kind','admitted_at'],'true'),
 ('dispatch_results','crest','google_calendar_dispatch_results','id',
  ARRAY['id','business_id','lease_id','outcome','provider_etag','source_current','recorded_at','retry_at'],'true'),
 ('disconnects','crest','google_calendar_disconnects','id',
  ARRAY['id','business_id','destination_id','recovery_epoch','disconnected_generation','prior_generation',
   'fenced_at','drain_until','actor_id','operation_id'],'true'),
 ('revocation_admissions','crest','google_calendar_revocation_events','disconnect_id',
  ARRAY['business_id','disconnect_id','attempt_id','phase','recorded_at','deadline','actor_id'],'t.phase=''admitted'''),
 ('revocation_outcomes','crest','google_calendar_revocation_events','disconnect_id',
  ARRAY['business_id','disconnect_id','attempt_id','phase','recorded_at','actor_id'],'t.phase<>''admitted'''),
 ('creation_intents','crest_private','google_calendar_creation_intents','attempt_id',
  ARRAY['business_id','attempt_id','actor_id','recovery_epoch','correlation_marker','confirmed_at'],'true'),
 ('creation_results','crest_private','google_calendar_creation_results','attempt_id',
  ARRAY['business_id','attempt_id','recorded_at','outcome','provider_calendar_id'],'true');
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.google_calendar_source_dictionary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.google_calendar_source_dictionary() TO crest_calendar_export_owner;

DO $grant$
DECLARE t record; cols text;
BEGIN
 FOR t IN SELECT source_schema,source_table,array_agg(DISTINCT field) AS columns
  FROM crest_private.google_calendar_source_dictionary() d CROSS JOIN LATERAL unnest(d.fields) field
  GROUP BY source_schema,source_table
 LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname,c.relname)=(t.source_schema,t.source_table) AND c.relkind='r'
    AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO cols FROM unnest(t.columns) field;
  EXECUTE format('GRANT SELECT(%s) ON %I.%I TO crest_calendar_export_owner',cols,t.source_schema,t.source_table);
  EXECUTE format('CREATE POLICY calendar_export_scope ON %I.%I FOR SELECT TO crest_calendar_export_owner
   USING(business_id=nullif(current_setting(''crest.calendar_source_business'',true),'''')::uuid)',t.source_schema,t.source_table);
 END LOOP;
END $grant$;

CREATE FUNCTION crest_commands.google_calendar_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE d record; projection text; rows jsonb; groups jsonb:='{}'::jsonb; total integer:=0; snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.calendar_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='GOOGLE_CALENDAR_SOURCE_LIMIT'; END IF;
 FOR d IN SELECT * FROM crest_private.google_calendar_source_dictionary() LOOP
  SELECT string_agg(format('%L,%s',name,CASE
   WHEN name LIKE '%\_at' OR name IN('lease_until','deadline','drain_until') THEN
    format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
  INTO projection FROM unnest(d.fields) WITH ORDINALITY AS f(name,position);
  IF d.key_column<>'id' THEN projection:=projection||format(',''id'',t.%I::text',d.key_column); END IF;
  EXECUTE format($rows$
   SELECT coalesce(jsonb_agg(value ORDER BY key),'[]'::jsonb)
   FROM (SELECT t.%I AS key,jsonb_build_object(%s) AS value FROM %I.%I t
    WHERE t.business_id=$1 AND %s ORDER BY t.%I LIMIT $2) bounded
  $rows$,d.key_column,projection,d.source_schema,d.source_table,d.predicate,d.key_column)
  INTO rows USING requested_business,1001-total;
  total:=total+jsonb_array_length(rows);
  IF total>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='GOOGLE_CALENDAR_SOURCE_LIMIT'; END IF;
  groups:=groups||jsonb_build_object(d.source_group,rows);
 END LOOP;
 IF octet_length(groups::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='GOOGLE_CALENDAR_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'groups',groups,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.google.calendar.source/1',requested_business,
   pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex'));
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.google_calendar_source_snapshot(uuid) OWNER TO crest_calendar_export_owner;
REVOKE ALL ON FUNCTION crest_commands.google_calendar_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.google_calendar_source_snapshot(uuid) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-portable-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/google-calendar-runner.sql
-- P20/BR21. Bounded due work for the fictional application runner only.
-- Discovery has no write grant. Claim/admit/finish remain authoritative and
-- independently fence workers after a concurrent recovery or consent change.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.next_fictional_google_calendar_job(business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $due$
DECLARE due jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR NOT EXISTS(
  SELECT FROM crest_private.google_calendar_worker_principals p WHERE (p.business_id,p.principal)=(business,session_user)
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED'; END IF;

 SELECT jsonb_build_object('businessId',business,'destinationId',d.id,'jobId',j.id,'generation',c.generation::text,'recoveryEpoch',c.recovery_epoch)
 INTO due
 FROM crest_private.business_recovery_authorities b
 JOIN crest.google_calendar_destinations d ON d.business_id=b.business_id
 JOIN LATERAL (SELECT x.generation,x.state,x.recovery_epoch FROM crest.google_calendar_consents x
  WHERE (x.business_id,x.destination_id)=(business,d.id) ORDER BY x.generation DESC LIMIT 1) c ON true
 JOIN crest.google_calendar_mappings m ON (m.business_id,m.destination_id)=(business,d.id)
 JOIN crest.jobs j ON (j.business_id,j.id)=(business,m.job_id)
 JOIN LATERAL (
  -- Earliest admitted but unconfirmed write wins over current work. Keep
  -- terminal unresolved attempts in the ordering so later intents wait.
  SELECT o.id,o.created_at,o.connection_generation,o.recovery_epoch
  FROM crest.google_calendar_outbox o
  WHERE (o.business_id,o.mapping_id)=(business,m.id)
   AND (o.appointment_id=j.current_appointment_id OR EXISTS(
    SELECT FROM crest.google_calendar_dispatch_leases l
    JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id)=(l.business_id,l.id)
     AND a.kind IN('insert','update','delete')
    LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
    WHERE (l.business_id,l.outbox_id)=(business,o.id) AND (r.id IS NULL OR r.outcome='uncertain')
     AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_leases later
      JOIN crest.google_calendar_dispatch_results done ON (done.business_id,done.lease_id)=(later.business_id,later.id)
      WHERE (later.business_id,later.outbox_id)=(business,o.id) AND later.attempt_no>l.attempt_no
       AND done.outcome IN('published','removed','no_effect'))
   ))
  ORDER BY o.appointment_sequence LIMIT 1
 ) intent ON (intent.connection_generation,intent.recovery_epoch)=(c.generation,c.recovery_epoch)
 LEFT JOIN LATERAL (
  SELECT l.attempt_no,l.lease_until,r.outcome,r.retry_at FROM crest.google_calendar_dispatch_leases l
  LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
  WHERE (l.business_id,l.outbox_id)=(business,intent.id) ORDER BY l.attempt_no DESC LIMIT 1
 ) last ON true
 WHERE b.business_id=business AND b.writes_enabled AND c.state='active' AND c.recovery_epoch=b.active_epoch
  AND d.provider_calendar_id='crest-fictional-appointments@group.calendar.google.com'
  AND (last.attempt_no IS NULL OR (last.attempt_no<5 AND (
   (last.outcome IS NULL AND last.lease_until<=statement_timestamp())
   OR (last.outcome IN('delayed','uncertain') AND last.retry_at<=statement_timestamp()))))
  AND NOT EXISTS(
   SELECT FROM crest.google_calendar_dispatch_leases l JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
   WHERE (o.business_id,o.mapping_id)=(business,m.id) AND l.lease_until>statement_timestamp()
    AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id))
  )
 ORDER BY intent.created_at,intent.id LIMIT 1;
 RETURN due;
END $due$;
RESET ROLE;
ALTER FUNCTION crest_commands.next_fictional_google_calendar_job(uuid) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_commands.next_fictional_google_calendar_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.next_fictional_google_calendar_job(uuid) TO crest_calendar_dispatch;

RESET ROLE;
-- END REVIEWED planning/proposals/google-calendar-runner.sql
