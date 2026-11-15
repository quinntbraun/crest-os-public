-- Held BR07/BR09 write. Correct the time on one immutable Mobile leg chain.
-- An existing arrival, actual stop, ETA evidence, and job state remain as recorded.
DO $review$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure('crest_private.field_source_stamp()')
   AND p.proowner='crest_booking_integrity_owner'::regrole AND p.prosecdef
   AND p.provolatile='v' AND NOT p.proleakproof AND l.lanname='plpgsql'
   AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b8327a57cb59e485b26c5d3c6a901eaffdfcd0700a8b8ec80cf3285684fce85f'
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 ) OR EXISTS(SELECT 1 FROM (VALUES('crest.travel_legs'),('crest.operator_occupancy'),('crest_private.operations'),('crest_private.audit_events')) required(name)
  WHERE NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass(required.name)
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MOBILE_DEPARTURE_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE POLICY mobile_departure_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mobile_departure.correct');
CREATE POLICY mobile_departure_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.mobile_departure.correct' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mobile_departure_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mobile_departure.correct')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.mobile_departure.correct'
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY mobile_departure_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.mobile_departure.correct' AND schema_version=1);

DO $extend$
DECLARE source text; marker constant text:='IF command=''operations.job.work_end.correct'' THEN';
BEGIN
 source:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MOBILE_DEPARTURE_SOURCE_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,$branch$
    IF command='operations.mobile_departure.correct' THEN
     IF TG_TABLE_NAME<>'travel_legs' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MOBILE_DEPARTURE_SOURCE_REQUIRED';END IF;
     IF NEW.purpose<>'mobile_work_site' OR NEW.change_kind<>'correct' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MOBILE_DEPARTURE_SOURCE_REQUIRED';END IF;
     command:='operations.time.correct';
    END IF;
    $branch$||marker);
END $extend$;

CREATE FUNCTION crest_private.mobile_departure_receipt(business uuid,actor uuid,operation uuid,request jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
DECLARE
 departure crest.job_events; initial crest.travel_legs; prior crest.travel_legs; saved crest.travel_legs; audit_id uuid;
 job uuid:=(request->>'jobId')::uuid; leg uuid:=(request->>'legId')::uuid;
BEGIN
 SELECT l.* INTO STRICT initial FROM crest.travel_legs l WHERE l.business_id=business AND l.id=leg AND l.logical_id=leg
  AND l.operator_actor_id=actor AND l.created_by=actor AND l.job_context_id=job AND l.purpose='mobile_work_site'
  AND l.sequence=1 AND l.change_kind='depart' AND l.state='open';
 SELECT e.* INTO STRICT departure FROM crest.job_events e WHERE e.business_id=business AND e.id=(request->>'departureEventId')::uuid
  AND e.job_id=job AND e.operation_id=initial.operation_id AND e.created_by=actor AND e.from_state='scheduled'
  AND e.to_state='en_route' AND e.effective_at=initial.departed_at AND e.evidence->>'action'='depart'
  AND e.evidence->>'travelLegId'=leg::text;
 SELECT l.* INTO STRICT prior FROM crest.travel_legs l WHERE l.business_id=business
  AND l.id=(request->>'legVersionId')::uuid AND l.logical_id=initial.logical_id;
 SELECT l.* INTO STRICT saved FROM crest.travel_legs l WHERE l.business_id=business AND l.operation_id=operation;
 IF crest_private.field_travel_projection(saved)-ARRAY['id','sequence','replaces_id','departed_at','change_kind','reason','created_at','operation_id']
  IS DISTINCT FROM crest_private.field_travel_projection(prior)-ARRAY['id','sequence','replaces_id','departed_at','change_kind','reason','created_at','operation_id']
  OR saved.replaces_id IS DISTINCT FROM prior.id OR saved.sequence<>prior.sequence+1 OR saved.logical_id<>leg
  OR saved.operator_actor_id<>actor OR saved.created_by<>actor OR saved.job_context_id<>job OR saved.purpose<>'mobile_work_site'
  OR saved.change_kind<>'correct' OR saved.reason IS DISTINCT FROM request->>'reason'
  OR saved.departed_at=prior.departed_at OR saved.departed_at IS DISTINCT FROM (request->>'correctedAt')::timestamptz
  OR crest_private.valid_support_instant(request->'correctedAt',saved.created_at) IS NOT TRUE
  OR crest_private.booking_text_required(request->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_GRAPH_REQUIRED';END IF;

 SELECT a.id INTO STRICT audit_id FROM crest_private.audit_events a WHERE a.business_id=business AND a.operation_id=operation
  AND a.actor_id=actor AND a.created_by=actor AND a.entity_kind='travel_legs' AND a.entity_id=leg
  AND a.entity_version=saved.sequence AND a.action='correct' AND a.reason=saved.reason AND a.origin='manual' AND a.import_row_id IS NULL
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(prior),'after',crest_private.field_travel_projection(saved));
 IF (SELECT count(*) FROM crest_private.audit_events a WHERE a.business_id=business AND a.operation_id=operation)<>1
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_AUDIT_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandType','operations.mobile_departure.correct','businessId',business,
  'actorId',actor,'operationId',operation,'recoveryEpoch',request->'recoveryEpoch','jobId',job,'jobVersion',request->'expectedJobVersion',
  'legId',leg,'departureEventId',departure.id,'previousDepartedAt',crest_private.field_travel_projection(prior)->'departed_at',
  'correctedAt',request->'correctedAt','reason',request->'reason','leg',crest_private.field_travel_projection(saved),
  'mileageReviewRequired',true,'auditIds',jsonb_build_array(audit_id));
EXCEPTION WHEN no_data_found OR too_many_rows THEN
 RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_GRAPH_REQUIRED';
END $receipt$;

CREATE FUNCTION crest_private.mobile_departure_result(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved record; request jsonb; receipt jsonb;
BEGIN
 SELECT o.state,o.result_schema_version,o.result,o.payload_hash,o.recovery_epoch INTO saved FROM crest_private.operations o
  WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.mobile_departure.correct'
   AND o.schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 request:=saved.result->'request';
 IF saved.state<>'committed' OR saved.result_schema_version IS DISTINCT FROM 1
  OR request->>'businessId' IS DISTINCT FROM business::text OR request->>'actorId' IS DISTINCT FROM actor::text
  OR request->>'operationId' IS DISTINCT FROM operation::text OR request->>'recoveryEpoch' IS DISTINCT FROM saved.recovery_epoch::text
  OR request->>'commandType' IS DISTINCT FROM 'operations.mobile_departure.correct' OR request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR NOT coalesce(request ?& ARRAY['jobId','expectedJobVersion','legId','legVersionId','departureEventId','correctedAt','reason'],false)
  OR request-ARRAY['schemaVersion','commandType','businessId','actorId','operationId','recoveryEpoch','jobId','expectedJobVersion',
   'legId','legVersionId','departureEventId','correctedAt','reason']<>'{}'::jsonb
  OR NOT coalesce((request->>'expectedJobVersion')::bigint>0,false)
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_RESULT_REQUIRED';END IF;
 receipt:=crest_private.mobile_departure_receipt(business,actor,operation,request);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;

CREATE FUNCTION crest_private.check_mobile_departure_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.mobile_departure_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MOBILE_DEPARTURE_RESULT_REQUIRED';END IF;
 RETURN NULL;
END $check$;

ALTER FUNCTION crest_private.mobile_departure_receipt(uuid,uuid,uuid,jsonb) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.mobile_departure_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_mobile_departure_result() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.mobile_departure_receipt(uuid,uuid,uuid,jsonb),crest_private.mobile_departure_result(uuid,uuid,uuid),
 crest_private.check_mobile_departure_result() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.mobile_departure_receipt(uuid,uuid,uuid,jsonb),crest_private.mobile_departure_result(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_private.check_mobile_departure_result() TO crest_schema_owner;
CREATE CONSTRAINT TRIGGER mobile_departure_original AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.mobile_departure.correct')
 EXECUTE FUNCTION crest_private.check_mobile_departure_result();

CREATE FUNCTION crest_commands.correct_mobile_departure(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,
 requested_leg uuid,leg_version uuid,departure_event uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE
 authority jsonb; context jsonb; request jsonb; digest text; claim uuid; existing record;
 prior crest.travel_legs; saved crest.travel_legs; corrected timestamptz; reason text; result jsonb; conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL OR expected_version IS NULL
  OR expected_version<=0 OR requested_leg IS NULL OR leg_version IS NULL OR departure_event IS NULL
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['correctedAt','reason']<>'{}'::jsonb
  OR crest_private.valid_support_instant(body->'correctedAt',clock_timestamp()) IS NOT TRUE
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MOBILE_DEPARTURE_INPUT_REQUIRED';END IF;
 corrected:=(body->>'correctedAt')::timestamptz;reason:=body->>'reason';
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.mobile_departure.correct','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,
  'expectedJobVersion',expected_version::text,'legId',requested_leg,'legVersionId',leg_version,'departureEventId',departure_event,
  'correctedAt',body->>'correctedAt','reason',reason);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
   VALUES(requested_business,requested_operation,expected_actor,'operations.mobile_departure.correct',1,expected_epoch,digest,expected_actor,'manual')
   ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT o.actor_id,o.command_type,o.recovery_epoch,o.payload_hash INTO existing FROM crest_private.operations o
    WHERE o.business_id=requested_business AND o.operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.mobile_departure.correct'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   PERFORM crest_private.lock_booking_operator(requested_business,expected_actor);
   context:=crest_private.mobile_trip_departure_context(requested_business,expected_actor,requested_job,requested_leg);
   IF context IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1945',MESSAGE='trip';END IF;
   IF context->>'jobVersion' IS DISTINCT FROM expected_version::text OR context->>'departureEventId' IS DISTINCT FROM departure_event::text
    OR context->'currentTrip'->>'id' IS DISTINCT FROM leg_version::text
   THEN RAISE EXCEPTION USING ERRCODE='P1945',MESSAGE='version';END IF;
   SELECT l.* INTO STRICT prior FROM crest.travel_legs l WHERE l.business_id=requested_business AND l.id=leg_version;
   IF prior.sequence=9223372036854775807 OR corrected=prior.departed_at OR corrected>prior.arrived_at
   THEN RAISE EXCEPTION USING ERRCODE='P1945',MESSAGE='boundary';END IF;

   INSERT INTO crest.travel_legs(business_id,logical_id,sequence,replaces_id,operator_actor_id,driven_vehicle_id,job_context_id,purpose,
    origin_snapshot,destination_snapshot,departed_at,arrived_at,state,eta_at,eta_source,eta_calculated_at,notes,change_kind,reason,created_by,operation_id)
   VALUES(requested_business,prior.logical_id,prior.sequence+1,prior.id,prior.operator_actor_id,prior.driven_vehicle_id,prior.job_context_id,
    prior.purpose,prior.origin_snapshot,prior.destination_snapshot,corrected,prior.arrived_at,prior.state,prior.eta_at,prior.eta_source,
    prior.eta_calculated_at,prior.notes,'correct',reason,expected_actor,requested_operation) RETURNING * INTO saved;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'travel_legs',saved.logical_id,saved.sequence,'correct',reason,
    jsonb_build_object('schemaVersion',1,'before',crest_private.field_travel_projection(prior),'after',crest_private.field_travel_projection(saved)),'manual');
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',
     crest_private.mobile_departure_receipt(requested_business,expected_actor,requested_operation,request))
    WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.mobile_departure_result(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1945' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN exclusion_violation THEN
  GET STACKED DIAGNOSTICS conflict=CONSTRAINT_NAME;
  IF conflict<>'operator_physical_time_exclusion' THEN RAISE;END IF;
  RETURN jsonb_build_object('state','conflict','reason','occupancy');
 END;
END $write$;

ALTER FUNCTION crest_commands.correct_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.correct_mobile_departure(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,uuid,jsonb)
 FROM PUBLIC;
