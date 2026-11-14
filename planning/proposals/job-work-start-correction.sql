-- Held BR07 command over registered60 and job-work-start-context.sql.
-- No web execute grant. Write the actual first interval and its linked trip
-- together, and preserve the original start event and job state.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'ff9840ed9116fca49c354c0e7bda90064b2b7661f4c036f2df393625bfb1d894'),
  ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'fa66ec1d62c53708df2ea9a2da1f69c36a4281ccf5f8e42b284980e4c15d4d64'),
  ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'cf674d6411c3293da64d2a175801d280686603c64ef066448866c9de051b504c'),
  ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'239106390bdff8bfec26a010417fbd4f73d53d791d447c6586d8e2da898791be'),
  ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'9ca7daece57e3b85d5d8de45156cbe016ffe6de1845556c95d48a040872b237f'),
  ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'cde50ad27a9c1c5282e979ba599ac4df70c294b8be807188784f83d38e141ed5')
 ) expected(signature,owner,definer,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=expected.owner::regrole
   AND p.prosecdef=expected.definer AND p.provolatile='v' AND NOT p.proleakproof AND l.lanname='plpgsql'
   AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_START_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE POLICY work_start_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_start.correct');
CREATE POLICY work_start_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.job.work_start.correct' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY work_start_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_start.correct')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_start.correct'
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY work_start_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.job.work_start.correct' AND schema_version=1);
CREATE POLICY work_start_job_change ON crest.jobs FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND operator_actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND fulfillment_mode='mobile' AND state IN('in_progress','paused','completed','cancelled') AND first_work_at IS NOT NULL)
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND operator_actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=operator_actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND fulfillment_mode='mobile' AND state IN('in_progress','paused','completed','cancelled') AND first_work_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=jobs.business_id AND o.operation_id=jobs.operation_id
   AND o.actor_id=jobs.updated_by AND o.command_type='operations.job.work_start.correct' AND o.schema_version=1 AND o.state='pending'));

CREATE FUNCTION crest_private.work_start_receipt(business uuid,actor uuid,operation uuid,request jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
DECLARE
 initial crest.job_events; event crest.job_events;
 prior_work crest.work_intervals; saved_work crest.work_intervals;
 initial_trip crest.travel_legs; prior_trip crest.travel_legs; saved_trip crest.travel_legs;
 before_job jsonb; after_job jsonb; audits jsonb;
 corrected timestamptz:=(request->>'correctedAt')::timestamptz;
 job uuid:=(request->>'jobId')::uuid;
BEGIN
 SELECT e.* INTO STRICT initial FROM crest.job_events e
  WHERE e.business_id=business AND e.job_id=job AND e.created_by=actor AND e.id=(request->>'initialEventId')::uuid
   AND e.to_state='in_progress' AND (e.from_state='en_route' AND e.evidence->>'action'='arrive'
    OR e.from_state='scheduled' AND e.evidence->>'action'='direct_arrive');
 SELECT e.* INTO STRICT event FROM crest.job_events e WHERE e.business_id=business AND e.job_id=job
  AND e.operation_id=operation AND e.created_by=actor;
 SELECT w.* INTO STRICT prior_work FROM crest.work_intervals w WHERE w.business_id=business AND w.job_id=job
  AND w.operator_actor_id=actor AND w.id=(request->>'workVersionId')::uuid
  AND w.logical_id=(initial.evidence->>'workIntervalId')::uuid AND w.kind='active';
 SELECT w.* INTO STRICT saved_work FROM crest.work_intervals w WHERE w.business_id=business AND w.operation_id=operation;
 IF crest_private.field_work_projection(saved_work)-ARRAY['id','sequence','replaces_id','started_at','change_kind','reason','created_at','operation_id']
   IS DISTINCT FROM crest_private.field_work_projection(prior_work)-ARRAY['id','sequence','replaces_id','started_at','change_kind','reason','created_at','operation_id']
  OR saved_work.replaces_id IS DISTINCT FROM prior_work.id OR saved_work.sequence<>prior_work.sequence+1
  OR saved_work.change_kind<>'correct' OR saved_work.reason IS DISTINCT FROM request->>'reason'
  OR saved_work.started_at<>corrected OR corrected=prior_work.started_at OR corrected>event.created_at
  OR (prior_work.ended_at IS NOT NULL AND corrected>prior_work.ended_at)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_GRAPH_REQUIRED';END IF;

 IF initial.from_state='en_route' THEN
  SELECT l.* INTO STRICT initial_trip FROM crest.travel_legs l WHERE l.business_id=business
   AND l.job_context_id=job AND l.operator_actor_id=actor AND l.id=(initial.evidence->>'travelLegId')::uuid
   AND l.operation_id=initial.operation_id AND l.purpose='mobile_work_site' AND l.change_kind='arrive' AND l.arrived_at=initial.effective_at;
  SELECT l.* INTO STRICT prior_trip FROM crest.travel_legs l WHERE l.business_id=business
   AND l.logical_id=initial_trip.logical_id AND l.id=(request->>'arrivalVersionId')::uuid AND l.state='closed'
   AND l.job_context_id=job AND l.operator_actor_id=actor AND l.arrived_at=prior_work.started_at;
  SELECT l.* INTO STRICT saved_trip FROM crest.travel_legs l WHERE l.business_id=business AND l.operation_id=operation;
  IF crest_private.field_travel_projection(saved_trip)-ARRAY['id','sequence','replaces_id','arrived_at','change_kind','reason','created_at','operation_id']
    IS DISTINCT FROM crest_private.field_travel_projection(prior_trip)-ARRAY['id','sequence','replaces_id','arrived_at','change_kind','reason','created_at','operation_id']
   OR saved_trip.replaces_id IS DISTINCT FROM prior_trip.id OR saved_trip.sequence<>prior_trip.sequence+1
   OR saved_trip.change_kind<>'correct' OR saved_trip.reason IS DISTINCT FROM request->>'reason'
   OR saved_trip.arrived_at<>corrected OR corrected<prior_trip.departed_at
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_GRAPH_REQUIRED';END IF;
 ELSIF request->'arrivalVersionId' IS DISTINCT FROM 'null'::jsonb
  OR initial.evidence->'travelOmissionRecorded' IS DISTINCT FROM 'true'::jsonb
  OR EXISTS(SELECT 1 FROM crest.travel_legs WHERE business_id=business AND operation_id=operation)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_GRAPH_REQUIRED';END IF;

 SELECT a.delta->'before',a.delta->'after' INTO STRICT before_job,after_job FROM crest_private.audit_events a
  WHERE a.business_id=business AND a.actor_id=actor AND a.operation_id=operation AND a.entity_kind='jobs'
   AND a.entity_id=job AND a.entity_version=event.sequence AND a.action='revise';
 IF before_job->>'first_work_at' IS NULL OR (before_job->>'first_work_at')::timestamptz<>prior_work.started_at
  OR after_job->>'first_work_at' IS DISTINCT FROM request->>'correctedAt'
  OR before_job->>'version' IS DISTINCT FROM request->>'expectedJobVersion'
  OR event.sequence IS DISTINCT FROM (before_job->>'version')::bigint+1 OR after_job->>'version' IS DISTINCT FROM event.sequence::text
  OR before_job->>'state' NOT IN('in_progress','paused','completed','cancelled')
  OR event.from_state IS DISTINCT FROM before_job->>'state' OR event.to_state IS DISTINCT FROM event.from_state
  OR before_job-ARRAY['first_work_at','version','updated_by','updated_at','operation_id']
   IS DISTINCT FROM after_job-ARRAY['first_work_at','version','updated_by','updated_at','operation_id']
  OR after_job->>'updated_by' IS DISTINCT FROM actor::text OR after_job->>'operation_id' IS DISTINCT FROM operation::text
  OR event.effective_at<>corrected OR event.reason IS DISTINCT FROM request->>'reason'
  OR event.evidence IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'action','correct_first_start',
   'initialEventId',initial.id,'workVersionId',saved_work.id,'arrivalVersionId',saved_trip.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_GRAPH_REQUIRED';END IF;

 SELECT jsonb_agg(a.id ORDER BY a.id) INTO audits FROM crest_private.audit_events a
  WHERE a.business_id=business AND a.actor_id=actor AND a.operation_id=operation
   AND (a.entity_kind='jobs' AND a.entity_id=job AND a.entity_version=event.sequence AND a.action='revise'
    OR a.entity_kind='job_events' AND a.entity_id=event.id AND a.entity_version=1 AND a.action='create'
     AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.job_events_projection(event))
    OR a.entity_kind='work_intervals' AND a.entity_id=saved_work.logical_id AND a.entity_version=saved_work.sequence
     AND a.action='correct' AND a.reason=request->>'reason' AND a.delta=jsonb_build_object('schemaVersion',1,
      'before',crest_private.field_work_projection(prior_work),'after',crest_private.field_work_projection(saved_work))
    OR a.entity_kind='travel_legs' AND a.entity_id=saved_trip.logical_id AND a.entity_version=saved_trip.sequence
     AND a.action='correct' AND a.reason=request->>'reason' AND a.delta=jsonb_build_object('schemaVersion',1,
      'before',crest_private.field_travel_projection(prior_trip),'after',crest_private.field_travel_projection(saved_trip)));
 IF jsonb_array_length(audits) IS DISTINCT FROM (CASE WHEN saved_trip.id IS NULL THEN 3 ELSE 4 END)
  OR jsonb_array_length(audits) IS DISTINCT FROM (SELECT count(*) FROM crest_private.audit_events a WHERE a.business_id=business AND a.operation_id=operation)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_AUDITS_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_start.correct','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',request->'recoveryEpoch','jobId',job,'jobVersion',event.sequence::text,
  'state',event.to_state,'initialEventId',initial.id,'eventId',event.id,'previousStartedAt',before_job->'first_work_at',
  'correctedAt',request->'correctedAt','reason',request->'reason','work',crest_private.field_work_projection(saved_work),
  'arrival',CASE WHEN saved_trip.id IS NOT NULL THEN crest_private.field_travel_projection(saved_trip) END,'auditIds',audits);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_GRAPH_REQUIRED';
END $receipt$;

CREATE FUNCTION crest_private.work_start_result(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved record; request jsonb; receipt jsonb;
BEGIN
 SELECT state,result_schema_version,result,payload_hash,recovery_epoch INTO saved
  FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation
   AND command_type='operations.job.work_start.correct' AND schema_version=1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 request:=saved.result->'request';
 IF saved.state<>'committed' OR saved.result_schema_version IS DISTINCT FROM 1
  OR request->>'businessId' IS DISTINCT FROM business::text OR request->>'actorId' IS DISTINCT FROM actor::text
  OR request->>'operationId' IS DISTINCT FROM operation::text OR request->>'recoveryEpoch' IS DISTINCT FROM saved.recovery_epoch::text
  OR request->>'commandType' IS DISTINCT FROM 'operations.job.work_start.correct' OR request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_RESULT_REQUIRED';END IF;
 receipt:=crest_private.work_start_receipt(business,actor,operation,request);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_RESULT_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;

CREATE FUNCTION crest_private.check_work_start_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.work_start_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_RESULT_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;

ALTER FUNCTION crest_private.work_start_receipt(uuid,uuid,uuid,jsonb) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.work_start_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_work_start_result() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.work_start_receipt(uuid,uuid,uuid,jsonb),crest_private.work_start_result(uuid,uuid,uuid),crest_private.check_work_start_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.work_start_receipt(uuid,uuid,uuid,jsonb),crest_private.work_start_result(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_work_start_result() TO crest_schema_owner;
CREATE CONSTRAINT TRIGGER work_start_original AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.job.work_start.correct')
 EXECUTE FUNCTION crest_private.check_work_start_result();

DO $extend$
DECLARE signature text; source text; updated text; marker text; branch text;
BEGIN
 FOR signature,marker,branch IN SELECT * FROM (VALUES
  ('crest_private.authorize_booking_statement()','IF NOT coalesce(', $branch$
    IF kind='operations.job.work_start.correct' AND (TG_TABLE_NAME='jobs' AND TG_OP='UPDATE'
     OR TG_TABLE_NAME='job_events' AND TG_OP='INSERT') THEN RETURN NULL;END IF;
    $branch$),
  ('crest_private.stamp_booking_row()','IF kind IS NULL OR kind NOT IN(', $branch$
    IF kind='operations.job.work_start.correct' THEN
     IF TG_TABLE_NAME='jobs' AND TG_OP='UPDATE' THEN
      IF OLD.fulfillment_mode<>'mobile' OR OLD.state NOT IN('in_progress','paused','completed','cancelled')
       OR OLD.first_work_at IS NULL OR NEW.first_work_at IS NULL OR NEW.first_work_at=OLD.first_work_at
       OR NEW.first_work_at>stamp OR OLD.operator_actor_id<>actor OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor
       OR to_jsonb(NEW)-ARRAY['version','updated_at','updated_by','operation_id','first_work_at']
        IS DISTINCT FROM to_jsonb(OLD)-ARRAY['version','updated_at','updated_by','operation_id','first_work_at']
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_JOB_REQUIRED';END IF;
      NEW.updated_at:=stamp;RETURN NEW;
     ELSIF TG_TABLE_NAME='job_events' AND TG_OP='INSERT' AND NEW.created_by=actor THEN
      NEW.created_at:=stamp;RETURN NEW;
     ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_JOB_REQUIRED';END IF;
    END IF;
    $branch$),
  ('crest_private.field_source_stamp()','IF command IS NULL OR command NOT IN(', $branch$
    IF command='operations.job.work_start.correct' THEN
     IF NEW.change_kind<>'correct' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_START_SOURCE_REQUIRED';END IF;
     command:='operations.time.correct';
    END IF;
    $branch$),
  ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','IF kind=''operations.job.cancel_unfulfilled'' THEN', $branch$
    IF kind='operations.job.work_start.correct' THEN
     IF NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=business AND o.operation_id=source_operation
       AND o.command_type=kind AND o.result->'request'->>'jobId'=job::text)
     THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_JOB_REQUIRED';END IF;
     RETURN;
    END IF;
    $branch$),
  ('crest_private.check_booking_schedule_event()','IF kind=''operations.job.cancel_unfulfilled'' THEN', $branch$
    IF kind='operations.job.work_start.correct' THEN
     IF crest_private.work_start_result(NEW.business_id,NEW.created_by,NEW.operation_id)->'receipt'->>'eventId'
       IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_START_EVENT_REQUIRED';END IF;
     RETURN NULL;
    END IF;
    $branch$)
 ) changes(signature,marker,branch) LOOP
  source:=pg_get_functiondef(signature::regprocedure);
  IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_START_EXTENSION_REQUIRED',DETAIL=signature;END IF;
  EXECUTE replace(source,marker,branch||marker);
 END LOOP;
 source:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 marker:='o.command_type=''operations.job.field'' AND TG_TABLE_NAME IN(''jobs'',''job_events'')';
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_START_EXTENSION_REQUIRED',DETAIL='check_booking_row_audit';END IF;
 updated:=replace(source,marker,'o.command_type IN(''operations.job.field'',''operations.job.work_start.correct'') AND TG_TABLE_NAME IN(''jobs'',''job_events'')');
 EXECUTE updated;
END $extend$;

CREATE FUNCTION crest_commands.correct_job_work_start(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,
 work_version uuid,arrival_version uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE
 authority jsonb; context jsonb; request jsonb; digest text; claim uuid; existing record;
 j crest.jobs; prior_job jsonb; event crest.job_events;
 work crest.work_intervals; revised_work crest.work_intervals;
 trip crest.travel_legs; revised_trip crest.travel_legs;
 corrected timestamptz; reason text; result jsonb; conflict text; piece text; pieces text[];
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL
  OR expected_version IS NULL OR expected_version<=0 OR work_version IS NULL
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['correctedAt','reason']<>'{}'::jsonb
  OR crest_private.valid_support_instant(body->'correctedAt',clock_timestamp()) IS NOT TRUE
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_START_INPUT_REQUIRED';END IF;
 corrected:=(body->>'correctedAt')::timestamptz;reason:=body->>'reason';
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_start.correct',
  'businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,
  'jobId',requested_job,'expectedJobVersion',expected_version::text,'workVersionId',work_version,'arrivalVersionId',arrival_version,
  'correctedAt',to_char(corrected AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reason',reason);
 BEGIN
  -- Lock the operation key before the common scheduling lock order. A replay
  -- reads its saved event and source versions, regardless of the current job.
  PERFORM pg_advisory_xact_lock(hashtextextended('crest.work-start/1:'||requested_business::text||':'||requested_operation::text,0));
  SELECT o.actor_id,o.recovery_epoch,o.result,o.payload_hash INTO existing FROM crest_private.operations o
   WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.command_type='operations.job.work_start.correct';
  IF FOUND THEN
   request:=request||jsonb_build_object('initialEventId',existing.result->'request'->'initialEventId');
   digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
   IF existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN
    RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   PERFORM crest_private.lock_booking_operator(requested_business,expected_actor);
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job
    AND operator_actor_id=expected_actor FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='job';END IF;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='version';END IF;
   context:=crest_private.job_work_start_context(requested_business,expected_actor,requested_job);
   IF context IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='state';END IF;
   IF context->'currentWork'->>'id' IS DISTINCT FROM work_version::text
    OR context->'currentArrivalTrip'->>'id' IS DISTINCT FROM arrival_version::text
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='version';END IF;
   SELECT * INTO STRICT work FROM crest.work_intervals WHERE business_id=requested_business AND id=work_version;
   IF arrival_version IS NOT NULL THEN
    SELECT * INTO STRICT trip FROM crest.travel_legs WHERE business_id=requested_business AND id=arrival_version;
   END IF;
   IF j.version=9223372036854775807 OR work.sequence=9223372036854775807 OR trip.sequence=9223372036854775807
    OR corrected=work.started_at OR (work.ended_at IS NOT NULL AND corrected>work.ended_at)
    OR (trip.id IS NOT NULL AND corrected<trip.departed_at)
   THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='boundary';END IF;
   request:=request||jsonb_build_object('initialEventId',context->'initialEventId');
   digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
   INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
    VALUES(requested_business,requested_operation,expected_actor,'operations.job.work_start.correct',1,expected_epoch,digest,expected_actor,'manual')
    ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
   IF claim IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1943',MESSAGE='operation';END IF;
   -- Shrink the occupied side first, then extend its neighbor.
   pieces:=CASE WHEN trip.id IS NULL THEN ARRAY['work'] WHEN corrected<work.started_at THEN ARRAY['trip','work'] ELSE ARRAY['work','trip'] END;
   FOREACH piece IN ARRAY pieces LOOP
    IF piece='work' THEN
     INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,
      started_at,ended_at,pause_reason,change_kind,reason,created_by,operation_id)
     VALUES(requested_business,work.logical_id,work.sequence+1,work.id,requested_job,expected_actor,work.kind,
      corrected,work.ended_at,work.pause_reason,'correct',reason,expected_actor,requested_operation) RETURNING * INTO revised_work;
     INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
     VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',revised_work.logical_id,revised_work.sequence,
      'correct',reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(work),'after',crest_private.field_work_projection(revised_work)),'manual');
    ELSE
     INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,
      origin_snapshot,destination_snapshot,departed_at,arrived_at,state,eta_at,eta_source,eta_calculated_at,notes,change_kind,reason,created_by,operation_id)
     VALUES(requested_business,trip.logical_id,trip.sequence+1,trip.id,expected_actor,trip.driven_vehicle_id,trip.job_context_id,trip.purpose,
      trip.origin_snapshot,trip.destination_snapshot,trip.departed_at,corrected,trip.state,trip.eta_at,trip.eta_source,trip.eta_calculated_at,
      trip.notes,'correct',reason,expected_actor,requested_operation) RETURNING * INTO revised_trip;
     INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
     VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',revised_trip.logical_id,revised_trip.sequence,
      'correct',reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(trip),'after',crest_private.field_travel_projection(revised_trip)),'manual');
    END IF;
   END LOOP;
   prior_job:=crest_private.jobs_projection(j);
   UPDATE crest.jobs SET first_work_at=corrected,version=version+1,updated_by=expected_actor,operation_id=requested_operation
    WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id)
    VALUES(requested_business,requested_job,j.version,j.state,j.state,corrected,reason,jsonb_build_object('schemaVersion',1,
     'action','correct_first_start','initialEventId',context->'initialEventId','workVersionId',revised_work.id,'arrivalVersionId',revised_trip.id),
     expected_actor,requested_operation) RETURNING * INTO event;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',prior_job,crest_private.jobs_projection(j));
   PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',
     crest_private.work_start_receipt(requested_business,expected_actor,requested_operation,request))
    WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.work_start_result(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1943' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN exclusion_violation THEN
  GET STACKED DIAGNOSTICS conflict=CONSTRAINT_NAME;
  IF conflict NOT IN('operator_physical_time_exclusion','operator_work_session_exclusion') THEN RAISE;END IF;
  RETURN jsonb_build_object('state','conflict','reason','occupancy');
 END;
END $write$;

ALTER FUNCTION crest_commands.correct_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.correct_job_work_start(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 FROM PUBLIC;
