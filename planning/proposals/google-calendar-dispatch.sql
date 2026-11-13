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
