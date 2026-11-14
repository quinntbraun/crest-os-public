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
