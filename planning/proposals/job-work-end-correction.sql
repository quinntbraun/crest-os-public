-- Held BR07 completion-time correction over registered61 and the reviewed
-- final-interval lookup. No web grant. The original completion, scope and
-- follow-up evidence remain immutable.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.authorize_booking_statement()','crest_schema_owner',false,'038f03a89564f85042c77af9b71faccb66036387261a5d6be9e9d7bafb462f4b'),
  ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','crest_booking_integrity_owner',true,'c0a2843e23190dc983109d2cd167cf094d607ade688f5e3759fd53486b66d833'),
  ('crest_private.check_booking_row_audit()','crest_booking_integrity_owner',true,'102ff3cb29ea22598ee697a692ce86e60e62b376459d26ae60a7a0e420120fc3'),
  ('crest_private.check_booking_schedule_event()','crest_booking_integrity_owner',true,'436706fc7b13845fe44fd4e34509cad012f3cb3e7bee1b6b49c8bab27620cf2a'),
  ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'8839707b1713b734c0e68a516391151fe7566bf402e644b9daa3f8bab13a1985'),
  ('crest_private.stamp_booking_row()','crest_booking_integrity_owner',true,'51f82eb95eac6cb62ce89286f2300919ce98e7edd2cc860027c8fac35701c978')
 ) expected(signature,owner,definer,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=expected.owner::regrole
   AND p.prosecdef=expected.definer AND p.provolatile='v' AND NOT p.proleakproof AND l.lanname='plpgsql'
   AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_END_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE POLICY work_end_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_end.correct');
CREATE POLICY work_end_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.job.work_end.correct' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY work_end_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_end.correct')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_end.correct'
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY work_end_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.job.work_end.correct' AND schema_version=1);
CREATE POLICY work_end_job_change ON crest.jobs FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND operator_actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND fulfillment_mode='mobile' AND state='completed')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND operator_actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=operator_actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND fulfillment_mode='mobile' AND state='completed' AND first_work_at IS NOT NULL AND completed_at>=first_work_at
  AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=jobs.business_id AND o.operation_id=jobs.operation_id
   AND o.actor_id=jobs.updated_by AND o.command_type='operations.job.work_end.correct' AND o.schema_version=1 AND o.state='pending'));

CREATE FUNCTION crest_private.work_end_receipt(business uuid,actor uuid,operation uuid,request jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
DECLARE
 completion crest.job_events; event crest.job_events;
 closed_work crest.work_intervals; prior_work crest.work_intervals; saved_work crest.work_intervals;
 before_job jsonb; after_job jsonb; audits jsonb;
 corrected timestamptz:=(request->>'correctedAt')::timestamptz;
 job uuid:=(request->>'jobId')::uuid;
BEGIN
 SELECT e.* INTO STRICT completion FROM crest.job_events e WHERE e.business_id=business AND e.job_id=job
  AND e.id=(request->>'completionEventId')::uuid AND e.created_by=actor
  AND e.from_state IN('in_progress','paused') AND e.to_state='completed' AND e.evidence->>'action'='complete';
 SELECT w.* INTO STRICT closed_work FROM crest.work_intervals w WHERE w.business_id=business AND w.job_id=job
  AND w.operator_actor_id=actor AND w.id=(completion.evidence->>'closedWorkIntervalId')::uuid
  AND w.operation_id=completion.operation_id AND w.change_kind='close' AND w.ended_at=completion.effective_at;
 SELECT w.* INTO STRICT prior_work FROM crest.work_intervals w WHERE w.business_id=business AND w.job_id=job
  AND w.operator_actor_id=actor AND w.id=(request->>'workVersionId')::uuid AND w.logical_id=closed_work.logical_id
  AND w.kind=closed_work.kind AND w.ended_at IS NOT NULL;
 SELECT w.* INTO STRICT saved_work FROM crest.work_intervals w WHERE w.business_id=business AND w.operation_id=operation;
 SELECT e.* INTO STRICT event FROM crest.job_events e WHERE e.business_id=business AND e.job_id=job
  AND e.operation_id=operation AND e.created_by=actor;

 IF crest_private.field_work_projection(saved_work)-ARRAY['id','sequence','replaces_id','ended_at','change_kind','reason','created_at','operation_id']
  IS DISTINCT FROM crest_private.field_work_projection(prior_work)-ARRAY['id','sequence','replaces_id','ended_at','change_kind','reason','created_at','operation_id']
  OR saved_work.replaces_id IS DISTINCT FROM prior_work.id OR saved_work.sequence<>prior_work.sequence+1
  OR saved_work.change_kind<>'correct' OR saved_work.reason IS DISTINCT FROM request->>'reason'
  OR saved_work.ended_at IS DISTINCT FROM corrected OR corrected=prior_work.ended_at
  OR corrected<prior_work.started_at OR corrected>event.created_at
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_GRAPH_REQUIRED';END IF;

 SELECT a.delta->'before',a.delta->'after' INTO STRICT before_job,after_job FROM crest_private.audit_events a
  WHERE a.business_id=business AND a.actor_id=actor AND a.operation_id=operation AND a.entity_kind='jobs'
   AND a.entity_id=job AND a.entity_version=event.sequence AND a.action='revise';
 IF before_job->>'completed_at' IS NULL OR (before_job->>'completed_at')::timestamptz<>prior_work.ended_at
  OR before_job->>'first_work_at' IS NULL OR corrected<(before_job->>'first_work_at')::timestamptz
  OR before_job->>'state' IS DISTINCT FROM 'completed' OR before_job->>'fulfillment_mode' IS DISTINCT FROM 'mobile'
  OR before_job->>'completion_outcome' IS NULL OR before_job->>'completion_outcome' NOT IN('full','partial')
  OR before_job->>'operator_actor_id' IS DISTINCT FROM actor::text
  OR after_job->>'completed_at' IS DISTINCT FROM request->>'correctedAt'
  OR before_job->>'version' IS DISTINCT FROM request->>'expectedJobVersion'
  OR event.sequence IS DISTINCT FROM (before_job->>'version')::bigint+1 OR after_job->>'version' IS DISTINCT FROM event.sequence::text
  OR event.from_state IS DISTINCT FROM 'completed' OR event.to_state IS DISTINCT FROM 'completed'
  OR before_job-ARRAY['completed_at','version','updated_by','updated_at','operation_id']
   IS DISTINCT FROM after_job-ARRAY['completed_at','version','updated_by','updated_at','operation_id']
  OR after_job->>'updated_by' IS DISTINCT FROM actor::text OR after_job->>'operation_id' IS DISTINCT FROM operation::text
  OR event.effective_at IS DISTINCT FROM corrected OR event.reason IS DISTINCT FROM request->>'reason'
  OR event.evidence IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'action','correct_completion_time',
   'completionEventId',completion.id,'workVersionId',saved_work.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_GRAPH_REQUIRED';END IF;

 SELECT jsonb_agg(a.id ORDER BY a.id) INTO audits FROM crest_private.audit_events a
  WHERE a.business_id=business AND a.actor_id=actor AND a.operation_id=operation
   AND (a.entity_kind='jobs' AND a.entity_id=job AND a.entity_version=event.sequence AND a.action='revise'
    OR a.entity_kind='job_events' AND a.entity_id=event.id AND a.entity_version=1 AND a.action='create'
     AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.job_events_projection(event))
    OR a.entity_kind='work_intervals' AND a.entity_id=saved_work.logical_id AND a.entity_version=saved_work.sequence
     AND a.action='correct' AND a.reason=request->>'reason' AND a.delta=jsonb_build_object('schemaVersion',1,
      'before',crest_private.field_work_projection(prior_work),'after',crest_private.field_work_projection(saved_work)));
 IF jsonb_array_length(audits) IS DISTINCT FROM 3
  OR (SELECT count(*) FROM crest_private.audit_events a WHERE a.business_id=business AND a.operation_id=operation)<>3
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_AUDITS_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_end.correct','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',request->'recoveryEpoch','jobId',job,'jobVersion',event.sequence::text,
  'completionEventId',completion.id,'eventId',event.id,'completionOutcome',before_job->'completion_outcome',
  'previousCompletedAt',before_job->'completed_at','correctedAt',request->'correctedAt','reason',request->'reason',
  'work',crest_private.field_work_projection(saved_work),'auditIds',audits);
EXCEPTION WHEN no_data_found OR too_many_rows THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_GRAPH_REQUIRED';
END $receipt$;

CREATE FUNCTION crest_private.work_end_result(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved record; request jsonb; receipt jsonb;
BEGIN
 SELECT state,result_schema_version,result,payload_hash,recovery_epoch INTO saved
  FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation
   AND command_type='operations.job.work_end.correct' AND schema_version=1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 request:=saved.result->'request';
 IF saved.state<>'committed' OR saved.result_schema_version IS DISTINCT FROM 1
  OR request->>'businessId' IS DISTINCT FROM business::text OR request->>'actorId' IS DISTINCT FROM actor::text
  OR request->>'operationId' IS DISTINCT FROM operation::text OR request->>'recoveryEpoch' IS DISTINCT FROM saved.recovery_epoch::text
  OR request->>'commandType' IS DISTINCT FROM 'operations.job.work_end.correct' OR request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_RESULT_REQUIRED';END IF;
 receipt:=crest_private.work_end_receipt(business,actor,operation,request);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;

CREATE FUNCTION crest_private.check_work_end_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.work_end_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_RESULT_REQUIRED';END IF;
 RETURN NULL;
END $check$;

ALTER FUNCTION crest_private.work_end_receipt(uuid,uuid,uuid,jsonb) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.work_end_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_work_end_result() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.work_end_receipt(uuid,uuid,uuid,jsonb),crest_private.work_end_result(uuid,uuid,uuid),crest_private.check_work_end_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.work_end_receipt(uuid,uuid,uuid,jsonb),crest_private.work_end_result(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_work_end_result() TO crest_schema_owner;
CREATE CONSTRAINT TRIGGER work_end_original AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.job.work_end.correct')
 EXECUTE FUNCTION crest_private.check_work_end_result();

DO $extend$
DECLARE signature text; source text; marker text; branch text;
BEGIN
 FOR signature,marker,branch IN SELECT * FROM (VALUES
  ('crest_private.authorize_booking_statement()','IF kind=''operations.job.work_start.correct'' AND', $branch$
    IF kind='operations.job.work_end.correct' AND (TG_TABLE_NAME='jobs' AND TG_OP='UPDATE'
     OR TG_TABLE_NAME='job_events' AND TG_OP='INSERT') THEN RETURN NULL;END IF;
    $branch$),
  ('crest_private.stamp_booking_row()','IF kind=''operations.job.work_start.correct'' THEN', $branch$
    IF kind='operations.job.work_end.correct' THEN
     IF TG_TABLE_NAME='jobs' AND TG_OP='UPDATE' THEN
      IF OLD.fulfillment_mode<>'mobile' OR OLD.state<>'completed' OR OLD.first_work_at IS NULL
       OR OLD.completed_at IS NULL OR NEW.completed_at IS NULL OR NEW.completed_at=OLD.completed_at
       OR NEW.completed_at<OLD.first_work_at OR NEW.completed_at>stamp OR OLD.operator_actor_id<>actor
       OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor
       OR to_jsonb(NEW)-ARRAY['version','updated_at','updated_by','operation_id','completed_at']
        IS DISTINCT FROM to_jsonb(OLD)-ARRAY['version','updated_at','updated_by','operation_id','completed_at']
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_JOB_REQUIRED';END IF;
      NEW.updated_at:=stamp;RETURN NEW;
     ELSIF TG_TABLE_NAME='job_events' AND TG_OP='INSERT' AND NEW.created_by=actor THEN
      NEW.created_at:=stamp;RETURN NEW;
     ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_JOB_REQUIRED';END IF;
    END IF;
    $branch$),
  ('crest_private.field_source_stamp()','IF command=''operations.job.work_start.correct'' THEN', $branch$
    IF command='operations.job.work_end.correct' THEN
     IF TG_TABLE_NAME<>'work_intervals' OR NEW.change_kind<>'correct' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_END_SOURCE_REQUIRED';END IF;
     command:='operations.time.correct';
    END IF;
    $branch$),
  ('crest_private.check_booking_job_graph(uuid,uuid,uuid)','IF kind=''operations.job.work_start.correct'' THEN', $branch$
    IF kind='operations.job.work_end.correct' THEN
     IF NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=business AND o.operation_id=source_operation
       AND o.command_type=kind AND o.result->'request'->>'jobId'=job::text)
     THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_JOB_REQUIRED';END IF;
     RETURN;
    END IF;
    $branch$),
  ('crest_private.check_booking_schedule_event()','IF kind=''operations.job.work_start.correct'' THEN', $branch$
    IF kind='operations.job.work_end.correct' THEN
     IF crest_private.work_end_result(NEW.business_id,NEW.created_by,NEW.operation_id)->'receipt'->>'eventId'
       IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_END_EVENT_REQUIRED';END IF;
     RETURN NULL;
    END IF;
    $branch$)
 ) changes(signature,marker,branch) LOOP
  source:=pg_get_functiondef(signature::regprocedure);
  IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_END_EXTENSION_REQUIRED',DETAIL=signature;END IF;
  EXECUTE replace(source,marker,branch||marker);
 END LOOP;
 source:=pg_get_functiondef('crest_private.check_booking_row_audit()'::regprocedure);
 marker:='o.command_type IN(''operations.job.field'',''operations.job.work_start.correct'') AND TG_TABLE_NAME IN(''jobs'',''job_events'')';
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_END_EXTENSION_REQUIRED',DETAIL='check_booking_row_audit';END IF;
 EXECUTE replace(source,marker,'o.command_type IN(''operations.job.field'',''operations.job.work_start.correct'',''operations.job.work_end.correct'') AND TG_TABLE_NAME IN(''jobs'',''job_events'')');
END $extend$;

CREATE FUNCTION crest_commands.correct_job_work_end(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,
 work_version uuid,completion_event uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE
 authority jsonb; context jsonb; request jsonb; digest text; claim uuid; existing record;
 j crest.jobs; prior_job jsonb; event crest.job_events;
 work crest.work_intervals; revised_work crest.work_intervals;
 corrected timestamptz; reason text; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL
  OR expected_version IS NULL OR expected_version<=0 OR work_version IS NULL OR completion_event IS NULL
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['correctedAt','reason']<>'{}'::jsonb
  OR crest_private.valid_support_instant(body->'correctedAt',clock_timestamp()) IS NOT TRUE
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_END_INPUT_REQUIRED';END IF;
 corrected:=(body->>'correctedAt')::timestamptz;reason:=body->>'reason';
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_end.correct',
  'businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,
  'jobId',requested_job,'expectedJobVersion',expected_version::text,'workVersionId',work_version,'completionEventId',completion_event,
  'correctedAt',to_char(corrected AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reason',reason);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
   VALUES(requested_business,requested_operation,expected_actor,'operations.job.work_end.correct',1,expected_epoch,digest,expected_actor,'manual')
   ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT o.actor_id,o.command_type,o.recovery_epoch,o.payload_hash INTO existing FROM crest_private.operations o
    WHERE o.business_id=requested_business AND o.operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.work_end.correct'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   PERFORM crest_private.lock_booking_operator(requested_business,expected_actor);
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job
    AND operator_actor_id=expected_actor FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1944',MESSAGE='job';END IF;
   IF j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1944',MESSAGE='version';END IF;
   context:=crest_private.job_work_end_context(requested_business,expected_actor,requested_job);
   IF context IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1944',MESSAGE='state';END IF;
   IF context->'currentWork'->>'id' IS DISTINCT FROM work_version::text
    OR context->>'completionEventId' IS DISTINCT FROM completion_event::text
   THEN RAISE EXCEPTION USING ERRCODE='P1944',MESSAGE='version';END IF;
   SELECT * INTO STRICT work FROM crest.work_intervals WHERE business_id=requested_business AND id=work_version;
   IF j.version=9223372036854775807 OR work.sequence=9223372036854775807 OR corrected=work.ended_at
    OR corrected<work.started_at OR corrected<j.first_work_at
   THEN RAISE EXCEPTION USING ERRCODE='P1944',MESSAGE='boundary';END IF;

   INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,
    started_at,ended_at,pause_reason,change_kind,reason,created_by,operation_id)
   VALUES(requested_business,work.logical_id,work.sequence+1,work.id,requested_job,expected_actor,work.kind,
    work.started_at,corrected,work.pause_reason,'correct',reason,expected_actor,requested_operation) RETURNING * INTO revised_work;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',revised_work.logical_id,revised_work.sequence,
    'correct',reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(work),'after',crest_private.field_work_projection(revised_work)),'manual');
   prior_job:=crest_private.jobs_projection(j);
   UPDATE crest.jobs SET completed_at=corrected,version=version+1,updated_by=expected_actor,operation_id=requested_operation
    WHERE business_id=requested_business AND id=requested_job RETURNING * INTO j;
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id)
    VALUES(requested_business,requested_job,j.version,'completed','completed',corrected,reason,jsonb_build_object('schemaVersion',1,
     'action','correct_completion_time','completionEventId',completion_event,'workVersionId',revised_work.id),expected_actor,requested_operation)
    RETURNING * INTO event;
   PERFORM crest_private.append_booking_audit('jobs',j.id,j.version,'revise',prior_job,crest_private.jobs_projection(j));
   PERFORM crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',
     crest_private.work_end_receipt(requested_business,expected_actor,requested_operation,request))
    WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.work_end_result(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1944' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN exclusion_violation THEN
  GET STACKED DIAGNOSTICS conflict=CONSTRAINT_NAME;
  IF conflict NOT IN('operator_physical_time_exclusion','operator_work_session_exclusion') THEN RAISE;END IF;
  RETURN jsonb_build_object('state','conflict','reason','occupancy');
 END;
END $write$;

ALTER FUNCTION crest_commands.correct_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.correct_job_work_end(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 FROM PUBLIC;
