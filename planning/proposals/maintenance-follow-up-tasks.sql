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
