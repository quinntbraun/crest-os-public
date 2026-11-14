-- Held BR10 review-message outcome command over registered schema 63.
-- The original draft remains immutable. Each observed outcome appends evidence.
DO $review$
BEGIN
 IF to_regprocedure('crest_commands.read_job_completion_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 OR to_regprocedure('crest_private.append_completion_audit(text,jsonb)') IS NULL
 OR has_function_privilege('crest_schema_owner','crest_private.stamp_completion_source()','EXECUTE')
 OR has_function_privilege('crest_schema_owner','crest_private.check_completion_source_audit()','EXECUTE')
 OR NOT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='crest.message_events'::regclass AND tgname='completion_stamp'
   AND tgfoid='crest_private.stamp_completion_source()'::regprocedure AND tgenabled='O'
 )
 OR NOT EXISTS (
  SELECT 1 FROM pg_trigger WHERE tgrelid='crest.message_events'::regclass AND tgname='completion_audit'
   AND tgfoid='crest_private.check_completion_source_audit()'::regprocedure AND tgenabled='O'
   AND tgdeferrable AND tginitdeferred
 )
 THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_REVIEW_OUTCOME_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE POLICY review_outcome_operations_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.message.record_outcome');
CREATE POLICY review_outcome_operations_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.message.record_outcome'
  AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY review_outcome_operations_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.message.record_outcome')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.message.record_outcome');
CREATE POLICY review_outcome_operations_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.message.record_outcome');

CREATE UNIQUE INDEX review_message_outcome_operation ON crest.message_events(business_id,operation_id)
 WHERE kind<>'prepared';
CREATE UNIQUE INDEX review_message_one_sent ON crest.message_events(business_id,message_id)
 WHERE kind='owner_confirmed_sent';
CREATE UNIQUE INDEX review_message_outcome_parent ON crest_private.operations(business_id,(result->'request'->>'priorEventId'))
 WHERE command_type='operations.message.record_outcome' AND state='committed';

CREATE FUNCTION crest_private.review_message_head(business uuid,job uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $head$
DECLARE draft crest.messages; head crest.message_events;
BEGIN
 IF business IS NULL OR business::text IS DISTINCT FROM current_setting('crest.business_id',true) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_REVIEW_OUTCOME_CONTEXT_REQUIRED';END IF;
 SELECT m.* INTO draft FROM crest.messages m
 JOIN crest.review_requests r ON r.business_id=m.business_id AND r.job_id=m.job_id AND r.id=m.request_id
  AND r.message_id=m.id AND r.is_primary
 JOIN crest.jobs j ON j.business_id=m.business_id AND j.id=m.job_id AND j.state='completed'
 WHERE m.business_id=business AND m.job_id=job AND m.purpose='review_request' AND m.state='prepared';
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT e.* INTO STRICT head FROM crest.message_events e
 WHERE e.business_id=business AND e.job_id=job AND e.message_id=draft.id
 AND NOT EXISTS (
  SELECT 1 FROM crest_private.operations o WHERE o.business_id=business AND o.command_type='operations.message.record_outcome'
   AND o.state='committed' AND o.result->'request'->>'priorEventId'=e.id::text
 );
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'jobId',job,'messageId',draft.id,
  'eventId',head.id,'kind',head.kind,'reason',head.reason,
  'effectiveAt',to_char(head.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
END $head$;
ALTER FUNCTION crest_private.review_message_head(uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.review_message_head(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.review_message_head(uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_private.review_message_outcome_receipt(business uuid,actor uuid,operation uuid,request jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
DECLARE event crest.message_events; prior crest.message_events; audit uuid;
BEGIN
 SELECT e.* INTO STRICT event FROM crest.message_events e
 WHERE e.business_id=business AND e.operation_id=operation AND e.created_by=actor AND e.kind<>'prepared';
 SELECT p.* INTO STRICT prior FROM crest.message_events p
 WHERE p.business_id=business AND p.job_id=event.job_id AND p.message_id=event.message_id AND p.id=(request->>'priorEventId')::uuid;
 IF prior.id=event.id OR prior.kind='owner_confirmed_sent' OR event.job_id::text IS DISTINCT FROM request->>'jobId'
  OR event.message_id::text IS DISTINCT FROM request->>'messageId' OR event.kind IS DISTINCT FROM request->>'kind'
  OR event.reason IS DISTINCT FROM request->>'reason'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_REVIEW_OUTCOME_SOURCE_REQUIRED';END IF;
 SELECT a.id INTO STRICT audit FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor
  AND a.entity_kind='message_events' AND a.entity_id=event.id AND a.entity_version=1 AND a.action='create'
  AND a.reason IS NOT DISTINCT FROM event.reason AND a.origin='manual' AND a.import_row_id IS NULL
  AND a.delta=jsonb_build_object('schemaVersion',1,'before','null'::jsonb,
   'after',crest_private.completion_projection('message_events',to_jsonb(event)));
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'actorId',actor,'operationId',operation,
  'recoveryEpoch',request->'recoveryEpoch','jobId',event.job_id,'messageId',event.message_id,'eventId',event.id,
  'priorEventId',prior.id,'kind',event.kind,
  'effectiveAt',to_char(event.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'auditIds',jsonb_build_array(audit));
END $receipt$;
ALTER FUNCTION crest_private.review_message_outcome_receipt(uuid,uuid,uuid,jsonb) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.review_message_outcome_receipt(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.review_message_outcome_receipt(uuid,uuid,uuid,jsonb) TO crest_booking_owner;

CREATE FUNCTION crest_private.stamp_review_message_outcome() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stamp$
BEGIN
 IF NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid
  OR NEW.created_by IS DISTINCT FROM nullif(current_setting('crest.actor_id',true),'')::uuid
  OR NEW.operation_id IS DISTINCT FROM nullif(current_setting('crest.operation_id',true),'')::uuid OR NEW.origin<>'manual'
  OR NEW.kind NOT IN('opened','owner_confirmed_sent','failed','skipped')
  OR (NEW.kind IN('failed','skipped') AND NEW.reason IS NULL)
  OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.actor_id=NEW.created_by
   AND o.operation_id=NEW.operation_id AND o.command_type='operations.message.record_outcome'
   AND o.schema_version=1 AND o.state='pending' AND o.origin='manual' AND o.import_row_id IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_REVIEW_OUTCOME_CONTEXT_REQUIRED';END IF;
 NEW.created_at:=clock_timestamp();
 NEW.effective_at:=NEW.created_at;
 RETURN NEW;
END $stamp$;

CREATE FUNCTION crest_private.review_message_outcome_result(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved record; request jsonb; receipt jsonb;
BEGIN
 SELECT o.business_id,o.operation_id,o.actor_id,o.command_type,o.recovery_epoch,o.payload_hash,o.result
 INTO saved FROM crest_private.operations o WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation
  AND o.command_type='operations.message.record_outcome' AND o.schema_version=1 AND o.state='committed'
  AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 request:=saved.result->'request';
 IF request->>'schemaVersion' IS DISTINCT FROM '1' OR request->>'commandType' IS DISTINCT FROM saved.command_type
  OR request->>'businessId' IS DISTINCT FROM saved.business_id::text OR request->>'actorId' IS DISTINCT FROM saved.actor_id::text
  OR request->>'operationId' IS DISTINCT FROM saved.operation_id::text OR request->>'recoveryEpoch' IS DISTINCT FROM saved.recovery_epoch::text
  OR encode(sha256(convert_to(request::text,'UTF8')),'hex') IS DISTINCT FROM saved.payload_hash
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_REVIEW_OUTCOME_RESULT_REQUIRED';END IF;
 receipt:=crest_private.review_message_outcome_receipt(saved.business_id,saved.actor_id,saved.operation_id,request);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_REVIEW_OUTCOME_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
ALTER FUNCTION crest_private.review_message_outcome_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.review_message_outcome_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.review_message_outcome_result(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_private.check_review_message_outcome() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.review_message_outcome_result(NEW.business_id,NEW.created_by,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_REVIEW_OUTCOME_RESULT_REQUIRED';END IF;
 RETURN NULL;
END $check$;

ALTER FUNCTION crest_private.stamp_review_message_outcome() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_review_message_outcome() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.stamp_review_message_outcome(),crest_private.check_review_message_outcome() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.stamp_review_message_outcome(),crest_private.check_review_message_outcome() TO crest_schema_owner;

-- PostgreSQL checks EXECUTE when the table owner installs its existing triggers.
GRANT EXECUTE ON FUNCTION crest_private.stamp_completion_source(),crest_private.check_completion_source_audit() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
DROP TRIGGER completion_stamp ON crest.message_events;
CREATE TRIGGER completion_stamp BEFORE INSERT ON crest.message_events
 FOR EACH ROW WHEN(NEW.kind='prepared') EXECUTE FUNCTION crest_private.stamp_completion_source();
DROP TRIGGER completion_audit ON crest.message_events;
CREATE CONSTRAINT TRIGGER completion_audit AFTER INSERT ON crest.message_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.kind='prepared') EXECUTE FUNCTION crest_private.check_completion_source_audit();
CREATE TRIGGER review_outcome_stamp BEFORE INSERT ON crest.message_events
 FOR EACH ROW WHEN(NEW.kind<>'prepared') EXECUTE FUNCTION crest_private.stamp_review_message_outcome();
CREATE CONSTRAINT TRIGGER review_outcome_audit AFTER INSERT ON crest.message_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.kind<>'prepared') EXECUTE FUNCTION crest_private.check_review_message_outcome();
CREATE CONSTRAINT TRIGGER review_outcome_result AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.message.record_outcome')
 EXECUTE FUNCTION crest_private.check_review_message_outcome();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.stamp_completion_source(),crest_private.check_completion_source_audit() FROM crest_schema_owner;

CREATE FUNCTION crest_commands.read_review_message_outcome(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_REVIEW_OUTCOME_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 result:=crest_private.review_message_head(requested_business,requested_job);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(result,jsonb_build_object('state','absent'));
END $read$;

CREATE FUNCTION crest_commands.record_review_message_outcome(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,requested_message uuid,prior_event uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; saved record;
 head jsonb; event crest.message_events; receipt jsonb; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR requested_message IS NULL OR prior_event IS NULL
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT(body ?& ARRAY['kind','reason']) OR body-ARRAY['kind','reason']<>'{}'::jsonb
  OR coalesce(body->>'kind','') NOT IN('opened','owner_confirmed_sent','failed','skipped')
  OR (body->'reason'<>'null'::jsonb AND crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE)
  OR (body->>'kind' IN('failed','skipped') AND body->'reason'='null'::jsonb)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_REVIEW_OUTCOME_INPUT_REQUIRED';END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.message.record_outcome','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'messageId',requested_message,'priorEventId',prior_event,'kind',body->'kind','reason',body->'reason');
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
   VALUES(requested_business,requested_operation,expected_actor,'operations.message.record_outcome',1,expected_epoch,digest,expected_actor,'manual')
   ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT o.actor_id,o.command_type,o.recovery_epoch,o.payload_hash,o.state INTO saved FROM crest_private.operations o
    WHERE o.business_id=requested_business AND o.operation_id=requested_operation;
   IF NOT FOUND OR saved.actor_id<>expected_actor OR saved.command_type<>'operations.message.record_outcome'
    OR saved.recovery_epoch<>expected_epoch OR saved.payload_hash<>digest OR saved.state<>'committed'
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.review-message/1:'||requested_business::text||':'||requested_message::text,0));
   head:=crest_private.review_message_head(requested_business,requested_job);
   IF head IS NULL OR head->>'messageId' IS DISTINCT FROM requested_message::text
   THEN RAISE EXCEPTION USING ERRCODE='P1950',MESSAGE='message';END IF;
   IF head->>'eventId' IS DISTINCT FROM prior_event::text
   THEN RAISE EXCEPTION USING ERRCODE='P1950',MESSAGE='version';END IF;
   IF head->>'kind'='owner_confirmed_sent'
   THEN RAISE EXCEPTION USING ERRCODE='P1950',MESSAGE='sent';END IF;
   INSERT INTO crest.message_events(business_id,job_id,message_id,kind,effective_at,reason,created_by,operation_id)
   VALUES(requested_business,requested_job,requested_message,body->>'kind',clock_timestamp(),body->>'reason',expected_actor,requested_operation)
   RETURNING * INTO event;
   PERFORM crest_private.append_completion_audit('message_events',to_jsonb(event));
   receipt:=crest_private.review_message_outcome_receipt(requested_business,expected_actor,requested_operation,request);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt)
    WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.review_message_outcome_result(requested_business,expected_actor,requested_operation);
  IF result->>'state' IS DISTINCT FROM 'committed'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_REVIEW_OUTCOME_RESULT_REQUIRED';END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1950' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $write$;

ALTER FUNCTION crest_commands.read_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.record_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.record_review_message_outcome(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,uuid,jsonb)
 FROM PUBLIC;

