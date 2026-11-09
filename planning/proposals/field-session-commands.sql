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
