-- P10/BR10 private dated maintenance reminders and retained source.

-- BEGIN REVIEWED planning/proposals/maintenance-follow-up-tasks.sql
-- P10/BR10 owner-selected maintenance follow-up. Held over registered schema 65.
-- A task's scope and original date are retained. Its state comes from the
-- newest immutable event. Booking never changes a follow-up by itself.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.follow_up_tasks (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 customer_id uuid NOT NULL,
 vehicle_id uuid,
 source_job_id uuid,
 due_at timestamptz NOT NULL CHECK (isfinite(due_at)),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL DEFAULT 'manual' CHECK (origin='manual'),
 UNIQUE (business_id,id),
 UNIQUE (business_id,operation_id),
 FOREIGN KEY (business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY (business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),
 FOREIGN KEY (business_id,source_job_id,customer_id) REFERENCES crest.jobs(business_id,id,customer_id),
 FOREIGN KEY (business_id,source_job_id,vehicle_id) REFERENCES crest.job_vehicles(business_id,job_id,vehicle_id),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.follow_up_task_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 task_id uuid NOT NULL,
 version bigint NOT NULL CHECK (version>0),
 prior_version bigint,
 kind text NOT NULL CHECK (kind IN ('created','snoozed','completed','dismissed')),
 snoozed_until timestamptz CHECK (isfinite(snoozed_until)),
 rebooking_job_id uuid,
 reason text CHECK (char_length(reason)<=1000 AND btrim(reason)<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
 created_by uuid NOT NULL,
 operation_id uuid NOT NULL,
 origin text NOT NULL DEFAULT 'manual' CHECK (origin='manual'),
 UNIQUE (business_id,id),
 UNIQUE (business_id,operation_id),
 UNIQUE (business_id,task_id,version),
 CHECK ((kind='created' AND version=1 AND prior_version IS NULL)
   OR (kind<>'created' AND version>1 AND prior_version IS NOT NULL AND prior_version=version-1)),
 CHECK ((kind='snoozed')=(snoozed_until IS NOT NULL)),
 CHECK (rebooking_job_id IS NULL OR kind IN ('snoozed','completed')),
 CHECK (kind<>'dismissed' OR reason IS NOT NULL),
 FOREIGN KEY (business_id,task_id) REFERENCES crest.follow_up_tasks(business_id,id),
 FOREIGN KEY (business_id,task_id,prior_version) REFERENCES crest.follow_up_task_events(business_id,task_id,version),
 FOREIGN KEY (business_id,rebooking_job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY (business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE INDEX follow_up_task_customer ON crest.follow_up_tasks(business_id,customer_id,due_at,id);
CREATE INDEX follow_up_task_source_job ON crest.follow_up_tasks(business_id,source_job_id,id) WHERE source_job_id IS NOT NULL;
CREATE INDEX follow_up_task_rebooking ON crest.follow_up_task_events(business_id,rebooking_job_id) WHERE rebooking_job_id IS NOT NULL;
CREATE UNIQUE INDEX follow_up_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version)
 WHERE entity_kind='follow_up_tasks';

DO $tables$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['follow_up_tasks','follow_up_task_events'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('GRANT SELECT,INSERT ON crest.%I TO crest_booking_owner',name);
  EXECUTE format('GRANT SELECT ON crest.%I TO crest_booking_integrity_owner',name);
  EXECUTE format('GRANT USAGE ON TYPE crest.%I TO crest_booking_owner,crest_booking_integrity_owner',name);
  EXECUTE format('CREATE POLICY follow_up_read ON crest.%I FOR SELECT TO crest_booking_owner USING(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY follow_up_insert ON crest.%I FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid AND created_by=nullif(current_setting(''crest.actor_id'',true),'''')::uuid AND operation_id=nullif(current_setting(''crest.operation_id'',true),'''')::uuid)',name);
  EXECUTE format('CREATE POLICY follow_up_integrity ON crest.%I FOR SELECT TO crest_booking_integrity_owner USING(true)',name);
  EXECUTE format('CREATE TRIGGER follow_up_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source()',name);
 END LOOP;
END $tables$;
CREATE POLICY follow_up_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.follow_up.save');
CREATE POLICY follow_up_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND command_type='operations.follow_up.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY follow_up_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.follow_up.save')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.follow_up.save');
CREATE POLICY follow_up_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.follow_up.save');
CREATE POLICY follow_up_audit_read ON crest_private.audit_events FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND entity_kind='follow_up_tasks');
CREATE POLICY follow_up_audit_create ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND entity_kind='follow_up_tasks' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY follow_up_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='follow_up_tasks');
RESET ROLE;

CREATE FUNCTION crest_private.follow_up_snapshot(task crest.follow_up_tasks,event crest.follow_up_task_events) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object('schemaVersion',1,'taskId',task.id,'customerId',task.customer_id,
  'vehicleId',task.vehicle_id,'sourceJobId',task.source_job_id,'dueAt',to_char(task.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'version',event.version::text,'eventId',event.id,'state',CASE event.kind WHEN 'created' THEN 'open' ELSE event.kind END,
  'snoozedUntil',to_char(event.snoozed_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rebookingJobId',event.rebooking_job_id,'reason',event.reason,
  'recordedAt',to_char(event.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$snapshot$;
REVOKE ALL ON FUNCTION crest_private.follow_up_snapshot(crest.follow_up_tasks,crest.follow_up_task_events) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.follow_up_snapshot(crest.follow_up_tasks,crest.follow_up_task_events)
 TO crest_booking_owner,crest_booking_integrity_owner;

CREATE FUNCTION crest_private.follow_up_receipt(business uuid,actor uuid,operation uuid,request jsonb) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
DECLARE task crest.follow_up_tasks; event crest.follow_up_task_events; prior crest.follow_up_task_events; audit uuid; before_row jsonb; after_row jsonb;
BEGIN
 SELECT e.* INTO STRICT event FROM crest.follow_up_task_events e
 WHERE e.business_id=business AND e.operation_id=operation AND e.created_by=actor;
 SELECT t.* INTO STRICT task FROM crest.follow_up_tasks t WHERE t.business_id=business AND t.id=event.task_id;
 IF event.task_id::text IS DISTINCT FROM request->>'taskId'
  OR (event.version-1)::text IS DISTINCT FROM request->>'expectedVersion'
  OR event.kind IS DISTINCT FROM request->'body'->>'kind'
  OR event.reason IS DISTINCT FROM request->'body'->>'reason'
  OR event.snoozed_until IS DISTINCT FROM (request->'body'->>'snoozedUntil')::timestamptz
  OR event.rebooking_job_id IS DISTINCT FROM (request->'body'->>'rebookingJobId')::uuid
 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
 IF event.version=1 THEN
  IF task.operation_id<>operation OR task.created_by<>actor
   OR task.customer_id IS DISTINCT FROM (request->'body'->>'customerId')::uuid
   OR task.vehicle_id IS DISTINCT FROM (request->'body'->>'vehicleId')::uuid
   OR task.source_job_id IS DISTINCT FROM (request->'body'->>'sourceJobId')::uuid
   OR task.due_at IS DISTINCT FROM (request->'body'->>'dueAt')::timestamptz
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
  before_row:='null'::jsonb;
 ELSE
  SELECT e.* INTO STRICT prior FROM crest.follow_up_task_events e
  WHERE e.business_id=business AND e.task_id=event.task_id AND e.version=event.prior_version;
  IF prior.kind NOT IN ('created','snoozed') OR event.created_at<prior.created_at
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
  before_row:=crest_private.follow_up_snapshot(task,prior);
 END IF;
 after_row:=crest_private.follow_up_snapshot(task,event);
 SELECT a.id INTO STRICT audit FROM crest_private.audit_events a WHERE a.business_id=business
  AND a.actor_id=actor AND a.operation_id=operation AND a.entity_kind='follow_up_tasks'
  AND a.entity_id=task.id AND a.entity_version=event.version AND a.action=event.kind
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row);
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'operationId',operation,'record',after_row,'auditId',audit);
END $receipt$;
ALTER FUNCTION crest_private.follow_up_receipt(uuid,uuid,uuid,jsonb) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.follow_up_receipt(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.follow_up_receipt(uuid,uuid,uuid,jsonb) TO crest_booking_owner;

CREATE FUNCTION crest_private.follow_up_result(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved record; request jsonb; receipt jsonb;
BEGIN
 SELECT o.business_id,o.operation_id,o.actor_id,o.recovery_epoch,o.payload_hash,o.result INTO saved
 FROM crest_private.operations o WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation
  AND o.command_type='operations.follow_up.save' AND o.schema_version=1 AND o.state='committed'
  AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 request:=saved.result->'request';
 IF request->>'schemaVersion' IS DISTINCT FROM '1' OR request->>'commandType' IS DISTINCT FROM 'operations.follow_up.save'
  OR request->>'businessId' IS DISTINCT FROM business::text OR request->>'actorId' IS DISTINCT FROM actor::text
  OR request->>'operationId' IS DISTINCT FROM operation::text OR request->>'recoveryEpoch' IS DISTINCT FROM saved.recovery_epoch::text
  OR encode(sha256(convert_to(request::text,'UTF8')),'hex') IS DISTINCT FROM saved.payload_hash
 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
 receipt:=crest_private.follow_up_receipt(business,actor,operation,request);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
ALTER FUNCTION crest_private.follow_up_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.follow_up_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.follow_up_result(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_private.check_follow_up_result() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.follow_up_result(NEW.business_id,NEW.created_by,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
 RETURN NULL;
END $check$;
ALTER FUNCTION crest_private.check_follow_up_result() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_follow_up_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_follow_up_result() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER follow_up_result AFTER INSERT ON crest.follow_up_tasks
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_follow_up_result();
CREATE CONSTRAINT TRIGGER follow_up_result AFTER INSERT ON crest.follow_up_task_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_follow_up_result();
CREATE CONSTRAINT TRIGGER follow_up_result AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.follow_up.save')
 EXECUTE FUNCTION crest_private.check_follow_up_result();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.check_follow_up_result() FROM crest_schema_owner;

CREATE FUNCTION crest_commands.save_maintenance_follow_up(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_task uuid,expected_version bigint,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; saved record;
 task crest.follow_up_tasks; previous crest.follow_up_task_events; event crest.follow_up_task_events;
 kind text:=body->>'kind'; customer uuid; vehicle uuid; source_job uuid; rebooking uuid; planned timestamptz;
 keys text[]; date_field text; conflict text; receipt jsonb; result jsonb; before_row jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_task IS NULL OR requested_operation IS NULL OR expected_version IS NULL
  OR expected_version<0 OR expected_version=9223372036854775807 OR jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR coalesce(kind,'') NOT IN ('created','snoozed','completed','dismissed')
  OR ((kind='created')<>(expected_version=0))
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_INPUT_REQUIRED';END IF;
 keys:=CASE WHEN kind='created' THEN ARRAY['kind','customerId','vehicleId','sourceJobId','dueAt','reason']
  ELSE ARRAY['kind','snoozedUntil','rebookingJobId','reason'] END;
 IF NOT(body ?& keys) OR body-keys<>'{}'::jsonb OR octet_length(body::text)>8192
  OR (body->'reason'<>'null'::jsonb AND crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE)
  OR (kind='dismissed' AND (body->'reason'='null'::jsonb OR body->'rebookingJobId'<>'null'::jsonb))
  OR (kind<>'created' AND (kind='snoozed')<>(body->'snoozedUntil'<>'null'::jsonb))
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_INPUT_REQUIRED';END IF;
 IF kind='created' THEN
  IF crest_private.booking_uuid(body->'customerId') IS NOT TRUE
   OR (body->'vehicleId'<>'null'::jsonb AND crest_private.booking_uuid(body->'vehicleId') IS NOT TRUE)
   OR (body->'sourceJobId'<>'null'::jsonb AND crest_private.booking_uuid(body->'sourceJobId') IS NOT TRUE)
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_INPUT_REQUIRED';END IF;
  customer:=(body->>'customerId')::uuid;vehicle:=(body->>'vehicleId')::uuid;source_job:=(body->>'sourceJobId')::uuid;
  date_field:='dueAt';
 ELSE
  IF body->'rebookingJobId'<>'null'::jsonb AND crest_private.booking_uuid(body->'rebookingJobId') IS NOT TRUE
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_INPUT_REQUIRED';END IF;
  rebooking:=(body->>'rebookingJobId')::uuid;
  IF kind='snoozed' THEN date_field:='snoozedUntil';END IF;
 END IF;
 IF date_field IS NOT NULL THEN
  IF jsonb_typeof(body->date_field) IS DISTINCT FROM 'string'
   OR (body->>date_field)!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$'
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_DATE_REQUIRED';END IF;
  planned:=(body->>date_field)::timestamptz;
  IF to_char(planned AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') IS DISTINCT FROM body->>date_field
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_DATE_REQUIRED';END IF;
 END IF;

 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.follow_up.save','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'taskId',requested_task,
  'expectedVersion',expected_version::text,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.follow_up.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT o.command_type,o.recovery_epoch,o.payload_hash,o.state INTO saved FROM crest_private.operations o
   WHERE o.business_id=requested_business AND o.operation_id=requested_operation AND o.actor_id=expected_actor;
   IF NOT FOUND OR saved.command_type<>'operations.follow_up.save' OR saved.recovery_epoch<>expected_epoch
    OR saved.payload_hash<>digest OR saved.state<>'committed' THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.follow-up/1:'||requested_business::text||':'||requested_task::text,0));
   SELECT t.* INTO task FROM crest.follow_up_tasks t WHERE t.business_id=requested_business AND t.id=requested_task;
   IF kind='created' THEN
    IF task.id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='version';END IF;
    PERFORM 1 FROM crest.customers c WHERE c.business_id=requested_business AND c.id=customer AND c.archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='scope';END IF;
    IF source_job IS NOT NULL THEN
     PERFORM 1 FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=source_job AND j.customer_id=customer AND j.state='completed' FOR SHARE;
     IF NOT FOUND OR (vehicle IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.job_id=source_job AND v.vehicle_id=vehicle))
     THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='scope';END IF;
    ELSIF vehicle IS NOT NULL THEN
     PERFORM 1 FROM crest.customer_vehicles link JOIN crest.vehicles v ON v.business_id=link.business_id AND v.id=link.vehicle_id
     WHERE link.business_id=requested_business AND link.customer_id=customer AND link.vehicle_id=vehicle
      AND link.valid_to IS NULL AND v.archived_at IS NULL FOR SHARE OF link,v;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='scope';END IF;
    END IF;
    INSERT INTO crest.follow_up_tasks(id,business_id,customer_id,vehicle_id,source_job_id,due_at,created_by,operation_id)
     VALUES(requested_task,requested_business,customer,vehicle,source_job,planned,expected_actor,requested_operation)
     ON CONFLICT(id) DO NOTHING RETURNING * INTO task;
    IF task.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='version';END IF;
   ELSE
    IF task.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='version';END IF;
    SELECT e.* INTO STRICT previous FROM crest.follow_up_task_events e WHERE e.business_id=requested_business AND e.task_id=requested_task
    ORDER BY e.version DESC LIMIT 1;
    IF previous.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='version';END IF;
    IF previous.kind NOT IN ('created','snoozed') THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='closed';END IF;
    IF kind='snoozed' AND planned<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='snooze';END IF;
    IF rebooking IS NOT NULL THEN
     PERFORM 1 FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=rebooking AND j.customer_id=task.customer_id
      AND j.state<>'cancelled' AND j.id IS DISTINCT FROM task.source_job_id FOR SHARE;
     IF NOT FOUND OR (task.vehicle_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.job_id=rebooking AND v.vehicle_id=task.vehicle_id))
     THEN RAISE EXCEPTION USING ERRCODE='P1970', MESSAGE='rebooking';END IF;
    END IF;
    before_row:=crest_private.follow_up_snapshot(task,previous);
   END IF;
   INSERT INTO crest.follow_up_task_events(business_id,task_id,version,prior_version,kind,snoozed_until,rebooking_job_id,reason,created_by,operation_id)
   VALUES(requested_business,requested_task,expected_version+1,nullif(expected_version,0),kind,
    CASE WHEN kind='snoozed' THEN planned END,rebooking,body->>'reason',expected_actor,requested_operation)
   RETURNING * INTO event;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'follow_up_tasks',task.id,event.version,event.kind,
    jsonb_build_object('schemaVersion',1,'before',coalesce(before_row,'null'::jsonb),'after',crest_private.follow_up_snapshot(task,event)),'manual');
   receipt:=crest_private.follow_up_receipt(requested_business,expected_actor,requested_operation,request);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.follow_up_result(requested_business,expected_actor,requested_operation);
  IF result->>'state' IS DISTINCT FROM 'committed'
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1970' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $save$;
ALTER FUNCTION crest_commands.save_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.save_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) FROM PUBLIC;

CREATE FUNCTION crest_commands.read_maintenance_follow_up(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 requested_task uuid,after_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; task crest.follow_up_tasks; page jsonb; head jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_task IS NULL OR after_version IS NULL OR after_version<0
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT t.* INTO task FROM crest.follow_up_tasks t WHERE t.business_id=requested_business AND t.id=requested_task;
 IF task.id IS NOT NULL THEN
  WITH bounded AS (
   SELECT e AS event,row_number() OVER (ORDER BY e.version) AS position
   FROM crest.follow_up_task_events e
   WHERE e.business_id=requested_business AND e.task_id=requested_task AND e.version>after_version
   ORDER BY e.version LIMIT 21
  )
  SELECT
   (SELECT crest_private.follow_up_snapshot(task,e) FROM crest.follow_up_task_events e
    WHERE e.business_id=requested_business AND e.task_id=requested_task ORDER BY e.version DESC LIMIT 1),
   jsonb_build_object('schemaVersion',1,'businessId',requested_business,'taskId',requested_task,
    'entries',coalesce(jsonb_agg(crest_private.follow_up_snapshot(task,b.event) ORDER BY b.position)
     FILTER (WHERE b.position<=20),'[]'::jsonb),
    'hasMore',count(*)=21)
   INTO head,page FROM bounded b;
  IF head IS NULL OR after_version>(head->>'version')::bigint
  THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_HISTORY_REQUIRED';END IF;
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN CASE WHEN task.id IS NULL THEN jsonb_build_object('state','absent') ELSE page||jsonb_build_object('current',head) END;
END $read$;
ALTER FUNCTION crest_commands.read_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
-- END REVIEWED planning/proposals/maintenance-follow-up-tasks.sql

-- BEGIN REVIEWED planning/proposals/maintenance-follow-up-reads.sql
-- P10/BR10 private task lists and exact lookup of a committed maintenance action.
-- Held reader. The ordinary runtime receives no grant until reviewed adoption.
CREATE FUNCTION crest_commands.list_maintenance_follow_ups(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 scope_kind text,scope_id uuid,through_at timestamptz,after_due_at timestamptz,after_task_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE authority jsonb; page jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF scope_kind IS NULL OR scope_kind NOT IN ('due','customer','job')
  OR ((scope_kind='due')<>(scope_id IS NULL)) OR ((scope_kind='due')<>(through_at IS NOT NULL))
  OR ((after_due_at IS NULL)<>(after_task_id IS NULL))
  OR (through_at IS NOT NULL AND NOT isfinite(through_at)) OR (after_due_at IS NOT NULL AND NOT isfinite(after_due_at))
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_LIST_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 WITH bounded AS MATERIALIZED (
  SELECT t.id,t AS task,head.event,c.display_name,v.label,coalesce(head.snoozed_until,t.due_at) AS due
  FROM crest.follow_up_tasks t
  JOIN crest.customers c ON c.business_id=t.business_id AND c.id=t.customer_id
  LEFT JOIN crest.vehicles v ON v.business_id=t.business_id AND v.id=t.vehicle_id
  JOIN LATERAL (
   SELECT e AS event,e.kind,e.snoozed_until FROM crest.follow_up_task_events e
   WHERE e.business_id=t.business_id AND e.task_id=t.id ORDER BY e.version DESC LIMIT 1
  ) head ON true
  WHERE t.business_id=requested_business
   AND ((scope_kind='due' AND head.kind IN ('created','snoozed') AND coalesce(head.snoozed_until,t.due_at)<through_at)
     OR (scope_kind='customer' AND t.customer_id=scope_id) OR (scope_kind='job' AND t.source_job_id=scope_id))
   AND (after_task_id IS NULL OR (coalesce(head.snoozed_until,t.due_at),t.id)>(after_due_at,after_task_id))
  ORDER BY due,t.id LIMIT 21
 ), ordered AS (
  SELECT b.*,row_number() OVER (ORDER BY b.due,b.id) AS position FROM bounded b
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'scopeKind',scope_kind,'scopeId',scope_id,
  'throughAt',to_char(through_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'entries',coalesce(jsonb_agg(jsonb_build_object(
    'record',crest_private.follow_up_snapshot(o.task,o.event),'customerName',o.display_name,'vehicleLabel',o.label,
    'effectiveDueAt',to_char(o.due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
   ) ORDER BY o.position) FILTER (WHERE o.position<=20),'[]'::jsonb),
  'next',CASE WHEN count(*)=21 THEN (
   SELECT jsonb_build_object('taskId',last.id,'effectiveDueAt',to_char(last.due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
   FROM ordered last WHERE last.position=20
  ) END)
 INTO page FROM ordered o;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN page;
END $list$;
ALTER FUNCTION crest_commands.list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid) FROM PUBLIC;

CREATE FUNCTION crest_commands.lookup_maintenance_follow_up(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_task uuid,expected_version bigint,expected_kind text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; saved record; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF expected_epoch IS NULL OR requested_operation IS NULL OR requested_task IS NULL
  OR expected_version IS NULL OR expected_version<0 OR expected_version=9223372036854775807
  OR coalesce(expected_kind,'') NOT IN ('created','snoozed','completed','dismissed') OR (expected_kind='created')<>(expected_version=0)
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_ORIGINAL_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT o.recovery_epoch,o.result->'request' AS request INTO saved
 FROM crest_private.operations o WHERE o.business_id=requested_business AND o.actor_id=expected_actor
  AND o.operation_id=requested_operation AND o.command_type='operations.follow_up.save' AND o.state='committed';
 IF FOUND AND saved.recovery_epoch=expected_epoch AND saved.request->>'taskId'=requested_task::text
  AND saved.request->>'expectedVersion'=expected_version::text AND saved.request->'body'->>'kind'=expected_kind
 THEN
  result:=crest_private.follow_up_result(requested_business,expected_actor,requested_operation);
  IF result->>'state' IS DISTINCT FROM 'committed'
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_FOLLOW_UP_RESULT_REQUIRED';END IF;
 END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text) FROM PUBLIC;
-- END REVIEWED planning/proposals/maintenance-follow-up-reads.sql

-- BEGIN REVIEWED planning/proposals/maintenance-follow-up-originals.sql
-- P10/BR10 reuse of Crest's exact interrupted-save lookup and retirement.
-- Opaque references carry no dates, notes, recipient information, or draft.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','53289985fd8e9cc20363d9281fcf038a051145e5fa724d9f3e04c3346bc11676'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','7d692ed409998217e608e6a418be8f12da0dd2120a17376367ba80b7cdc98e7b'),
  ('crest_private.operation_retirement_result(uuid,uuid,jsonb)','crest_schema_owner',false,'v','b4333c16f147af24b46b36652c0aea60f36a0e104e93c8f8ffff9e4aafd85100')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) OR to_regprocedure('crest_commands.lookup_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,text)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED';END IF;
END $review$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.follow_up.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','taskId','expectedVersion','action'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r ?& keys) OR r-keys<>'{}'::jsonb
   OR crest_private.original_operation_uuid(r->'operationId') IS NOT TRUE
   OR crest_private.original_operation_uuid(r->'recoveryEpoch') IS NOT TRUE
   OR crest_private.original_operation_uuid(r->'taskId') IS NOT TRUE
   OR crest_private.original_operation_version(r->'expectedVersion',true) IS NOT TRUE
   OR coalesce(r->>'action','') NOT IN ('created','snoozed','completed','dismissed')
  THEN RETURN false;END IF;
  RETURN (r->>'expectedVersion')::numeric<9223372036854775807
   AND (r->>'action'='created')=(r->>'expectedVersion'='0');
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_maintenance_follow_up_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.follow_up.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='CREST_FOLLOW_UP_ORIGINAL_REQUIRED';END IF;
 reference:=original->'reference';
 saved:=crest_commands.lookup_maintenance_follow_up($1,$2,$3,$4,$5,$6,$7,$8,
  (reference->>'recoveryEpoch')::uuid,(reference->>'operationId')::uuid,(reference->>'taskId')::uuid,
  (reference->>'expectedVersion')::bigint,reference->>'action');
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.follow_up.save','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'taskId','sourceRecordId',receipt->'record'->'eventId',
   'sourceVersion',receipt->'record'->'version','sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_maintenance_follow_up_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_maintenance_follow_up_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
 THEN RAISE EXCEPTION 'CREST_FOLLOW_UP_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.follow_up.save' THEN
  RETURN crest_commands.lookup_maintenance_follow_up_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
-- END REVIEWED planning/proposals/maintenance-follow-up-originals.sql

-- BEGIN REVIEWED planning/proposals/maintenance-follow-up-source.sql
-- Held maintenance source collector. Expose two fixed projections only in a
-- single repeatable-read, read-only export snapshot. Runtime roles stay closed.
DO $review$
BEGIN
 IF to_regprocedure('crest_commands.maintenance_follow_up_source_context(uuid)') IS NOT NULL
  OR to_regprocedure('crest_private.follow_up_result(uuid,uuid,uuid)') IS NULL
  OR to_regprocedure('crest_commands.business_history_export_context(uuid)') IS NULL
  OR EXISTS(
   SELECT 1 FROM (VALUES('crest.follow_up_tasks'),('crest.follow_up_task_events')) AS targets(name)
   LEFT JOIN pg_class c ON c.oid=to_regclass(targets.name)
   WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole
    OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
    OR has_table_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  )
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FOLLOW_UP_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE FUNCTION crest_commands.maintenance_follow_up_source_context(requested_business uuid) RETURNS jsonb
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE history jsonb; roots bigint; events bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_FOLLOW_UP_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FOLLOW_UP_SOURCE_SCOPE_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT count(*) INTO roots FROM crest.follow_up_tasks WHERE business_id=requested_business;
 SELECT count(*) INTO events FROM crest.follow_up_task_events WHERE business_id=requested_business;
 IF roots+events>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_FOLLOW_UP_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'profile','crest.maintenance-follow-up-source.v1',
  'businessId',requested_business,'snapshotToken',encode(sha256(convert_to(
   jsonb_build_array('crest.maintenance-follow-up-source/1',requested_business,pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'historySnapshotToken',history->>'snapshotToken','expectedCounts',
  jsonb_build_object('follow_up_tasks',roots::text,'follow_up_task_events',events::text));
END $context$;

CREATE FUNCTION crest_commands.maintenance_follow_up_source_page(
 requested_business uuid,expected_snapshot text,requested_group text,after_id uuid,page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; rows jsonb; last_id uuid; has_more boolean; invalid boolean;
BEGIN
 context:=crest_commands.maintenance_follow_up_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR requested_group IS NULL
  OR requested_group NOT IN ('follow_up_tasks','follow_up_task_events') OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FOLLOW_UP_SOURCE_PAGE_REQUIRED';END IF;
 IF requested_group='follow_up_tasks' THEN
  WITH page AS MATERIALIZED(
   SELECT * FROM crest.follow_up_tasks WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id)
   ORDER BY id LIMIT page_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'business_id',p.business_id,'customer_id',p.customer_id,'vehicle_id',p.vehicle_id,'source_job_id',p.source_job_id,
   'due_at',to_char(p.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'created_at',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'created_by',p.created_by,'operation_id',p.operation_id,'origin',p.origin) ORDER BY p.id),'[]'::jsonb),
   (SELECT id FROM page ORDER BY id DESC LIMIT 1),
   coalesce(bool_or(crest_private.follow_up_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed'),false)
  INTO rows,last_id,invalid FROM page p;
  SELECT EXISTS(SELECT 1 FROM crest.follow_up_tasks WHERE business_id=requested_business AND id>last_id) INTO has_more;
 ELSE
  WITH page AS MATERIALIZED(
   SELECT * FROM crest.follow_up_task_events WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id)
   ORDER BY id LIMIT page_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'business_id',p.business_id,'task_id',p.task_id,'version',p.version::text,'prior_version',p.prior_version::text,
   'kind',p.kind,'snoozed_until',to_char(p.snoozed_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'rebooking_job_id',p.rebooking_job_id,'reason',p.reason,
   'created_at',to_char(p.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'created_by',p.created_by,'operation_id',p.operation_id,'origin',p.origin) ORDER BY p.id),'[]'::jsonb),
   (SELECT id FROM page ORDER BY id DESC LIMIT 1),
   coalesce(bool_or(crest_private.follow_up_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed'),false)
  INTO rows,last_id,invalid FROM page p;
  SELECT EXISTS(SELECT 1 FROM crest.follow_up_task_events WHERE business_id=requested_business AND id>last_id) INTO has_more;
 END IF;
 IF invalid THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FOLLOW_UP_SOURCE_HISTORY_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,
  'group',requested_group,'rows',rows,'hasMore',has_more);
END $page$;

GRANT CREATE ON SCHEMA crest_commands TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.maintenance_follow_up_source_context(uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_commands.maintenance_follow_up_source_page(uuid,text,text,uuid,integer) OWNER TO crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_commands.maintenance_follow_up_source_context(uuid),
 crest_commands.maintenance_follow_up_source_page(uuid,text,text,uuid,integer) FROM PUBLIC;
-- END REVIEWED planning/proposals/maintenance-follow-up-source.sql

-- BEGIN REVIEWED planning/proposals/maintenance-follow-up-schema-compatibility.sql
-- Held schema66 compatibility. Advance the reviewed table/column identity
-- across the exact registered65 scheduling and source routines.
DO $maintenance_schema$
DECLARE
 previous_fingerprint constant text:='6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3';
 current_fingerprint constant text:='a7160694f52e09208525077e7d0bc0a2022f7258c0e30c207cbcf4a31294faab';
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
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED',DETAIL='Physical schema or routine inventory differs';END IF;

 FOR expected IN SELECT * FROM (VALUES
  ('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'c81aafac7dbd8e680d93212d516e556ca7496a499c997ccd384ed12259211dad'),
  ('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'85e1a1e67b92f4f90597af0d049f157e732dbcaa15cf0ebf7975263066b27530'),
  ('crest_commands.cancel_unfulfilled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'088f47c8b33bcc664ef2af0661d9b0589dff7b4ba582fe4abfea8f04c1fc59e0'),
  ('crest_commands.field_source_context(uuid)','crest_booking_integrity_owner',true,'6fc110b1bbab0fe1b2ff1038ba3b7fed73ba96d01699d74e0ea746e31a4935f7'),
  ('crest_commands.interrupt_mobile_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)','crest_booking_owner',true,'0484e5ec71112a38de64c656fb222a8c146a302db653f49a9080bf2383ebeaa8'),
  ('crest_commands.quote_amendment_accepted_source_context(uuid)','crest_quote_owner',true,'e4ace7bf41dbe5a6a447f66a322a41b9ea1beb647b31dc4d008454371010ff59'),
  ('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)','crest_booking_owner',true,'795ea0c718638fbe4521771825e2b3b0352df108571b9fc5176403c1eee63e85'),
  ('crest_commands.record_support_trip(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,jsonb)','crest_booking_owner',true,'1affd9e5adad73b9767a687848bf0dc8b11d539d22569a370970e44953a636c0'),
  ('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)','crest_quote_owner',false,'32f55c779b41c5211542610198f40710120a2bd2b678629510b1d4b253a014db')
 ) AS entries(signature,owner_name,security_definer,definition_sha256) LOOP
  routine:=to_regprocedure(expected.signature);
  SELECT r.rolname,p.prosecdef,p.proacl,pg_get_functiondef(p.oid) AS definition INTO installed
  FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine;
  IF NOT FOUND OR installed.rolname IS DISTINCT FROM expected.owner_name
   OR installed.prosecdef IS DISTINCT FROM expected.security_definer
   OR encode(sha256(convert_to(installed.definition,'UTF8')),'hex') IS DISTINCT FROM expected.definition_sha256
   OR (length(installed.definition)-length(replace(installed.definition,previous_fingerprint,'')))<>length(previous_fingerprint)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine predecessor differs: '||expected.signature;END IF;
  revised:=replace(installed.definition,previous_fingerprint,current_fingerprint);
  EXECUTE revised;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=routine
   AND r.rolname=installed.rolname AND p.prosecdef=installed.prosecdef
   AND p.proacl IS NOT DISTINCT FROM installed.proacl AND pg_get_functiondef(p.oid)=revised)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MAINTENANCE_SCHEMA_REVIEW_REQUIRED',DETAIL='Routine result differs: '||expected.signature;END IF;
 END LOOP;
END $maintenance_schema$;
-- END REVIEWED planning/proposals/maintenance-follow-up-schema-compatibility.sql

GRANT EXECUTE ON FUNCTION
 crest_commands.save_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),
 crest_commands.read_maintenance_follow_up(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint),
 crest_commands.list_maintenance_follow_ups(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,timestamptz,timestamptz,uuid)
 TO crest_web;
GRANT EXECUTE ON FUNCTION
 crest_commands.maintenance_follow_up_source_context(uuid),
 crest_commands.maintenance_follow_up_source_page(uuid,text,text,uuid,integer)
 TO crest_export;
