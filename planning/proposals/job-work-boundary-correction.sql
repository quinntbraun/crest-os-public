-- BR07: move a shared active/pause boundary. First work, final completion
-- and travel endpoints require their own coupled corrections.
DO $review$
BEGIN
 IF EXISTS(
  SELECT 1 FROM (VALUES
   ('crest_private.field_source_stamp()','crest_booking_integrity_owner',true,'v','a03915bb7d95709e473d8893a7c402f5bb88be8dcc7db14473d86449f9ab9866'),
   ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','4261186a9556635ff4d60f6e5b0737d2eeeb6358b216e917315d7d46983cda93'),
   ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','8b09e65bde19591158863f5cea88901580386e7252a662ed25ae7cb1e64af5fc')
  ) AS expected(signature,owner,definer,volatility,body_hash)
  WHERE NOT EXISTS(
   SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
    WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=expected.owner::regrole
     AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility AND NOT p.proleakproof
     AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
      THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
     AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
     AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
  )
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_BOUNDARY_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;

CREATE POLICY work_boundary_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_boundary.correct');
CREATE POLICY work_boundary_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.job.work_boundary.correct' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY work_boundary_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_boundary.correct')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.job.work_boundary.correct'
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY work_boundary_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.job.work_boundary.correct' AND schema_version=1);

DO $extend$
DECLARE source text; marker constant text:=' IF command IS NULL OR command NOT IN(''operations.job.field''';
BEGIN
 source:=pg_get_functiondef('crest_private.field_source_stamp()'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_WORK_BOUNDARY_SOURCE_REVIEW_REQUIRED';
 END IF;
 EXECUTE replace(source,marker,$map$
 IF command='operations.job.work_boundary.correct' THEN
  IF TG_TABLE_NAME<>'work_intervals' OR NEW.change_kind<>'correct' THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_WORK_BOUNDARY_ONLY';
  END IF;
  command:='operations.time.correct';
 END IF;
$map$||marker);
END $extend$;

CREATE FUNCTION crest_private.work_boundary_receipt(business uuid,actor uuid,operation uuid,request jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $receipt$
DECLARE
 prior_left crest.work_intervals;
 prior_right crest.work_intervals;
 saved_left crest.work_intervals;
 saved_right crest.work_intervals;
 corrected timestamptz;
 audit_ids jsonb;
BEGIN
 SELECT * INTO prior_left FROM crest.work_intervals
  WHERE business_id=business AND id=(request->>'leftVersionId')::uuid;
 SELECT * INTO prior_right FROM crest.work_intervals
  WHERE business_id=business AND id=(request->>'rightVersionId')::uuid;
 SELECT * INTO saved_left FROM crest.work_intervals
  WHERE business_id=business AND operation_id=operation AND replaces_id=prior_left.id;
 SELECT * INTO saved_right FROM crest.work_intervals
  WHERE business_id=business AND operation_id=operation AND replaces_id=prior_right.id;
 corrected:=(request->>'correctedAt')::timestamptz;
 IF prior_left.id IS NULL OR prior_right.id IS NULL OR saved_left.id IS NULL OR saved_right.id IS NULL
  OR prior_left.job_id IS DISTINCT FROM (request->>'jobId')::uuid OR prior_right.job_id<>prior_left.job_id
  OR prior_left.operator_actor_id<>actor OR prior_right.operator_actor_id<>actor
  OR prior_left.kind=prior_right.kind OR prior_left.ended_at IS NULL
  OR prior_left.ended_at<>prior_right.started_at OR corrected=prior_left.ended_at
  OR corrected<=prior_left.started_at OR corrected>=prior_right.ended_at
  OR ROW(saved_left.started_at,saved_left.ended_at,saved_left.kind,saved_left.pause_reason)
     IS DISTINCT FROM ROW(prior_left.started_at,corrected,prior_left.kind,prior_left.pause_reason)
  OR ROW(saved_right.started_at,saved_right.ended_at,saved_right.kind,saved_right.pause_reason)
     IS DISTINCT FROM ROW(corrected,prior_right.ended_at,prior_right.kind,prior_right.pause_reason)
  OR saved_left.change_kind<>'correct' OR saved_right.change_kind<>'correct'
  OR saved_left.reason IS DISTINCT FROM request->>'reason' OR saved_right.reason IS DISTINCT FROM request->>'reason'
  OR (SELECT count(*) FROM crest.work_intervals WHERE business_id=business AND operation_id=operation)<>2
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_BOUNDARY_RECEIPT_REQUIRED';END IF;
 SELECT jsonb_agg(id ORDER BY id) INTO audit_ids FROM crest_private.audit_events
  WHERE business_id=business AND actor_id=actor AND operation_id=operation
   AND entity_kind='work_intervals' AND action='correct' AND reason=request->>'reason'
   AND ((entity_id=saved_left.logical_id AND entity_version=saved_left.sequence
     AND delta=jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(prior_left),'after',crest_private.field_work_projection(saved_left)))
    OR (entity_id=saved_right.logical_id AND entity_version=saved_right.sequence
     AND delta=jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(prior_right),'after',crest_private.field_work_projection(saved_right))));
 IF jsonb_array_length(audit_ids) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_BOUNDARY_AUDITS_REQUIRED';
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_boundary.correct',
  'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',request->'recoveryEpoch',
  'jobId',prior_left.job_id,'expectedJobVersion',request->'expectedJobVersion',
  'previousBoundaryAt',to_char(prior_left.ended_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'correctedAt',request->'correctedAt','reason',request->'reason','left',crest_private.field_work_projection(saved_left),
  'right',crest_private.field_work_projection(saved_right),'auditIds',audit_ids);
END $receipt$;
ALTER FUNCTION crest_private.work_boundary_receipt(uuid,uuid,uuid,jsonb) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.work_boundary_receipt(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.work_boundary_receipt(uuid,uuid,uuid,jsonb) TO crest_booking_owner;

CREATE FUNCTION crest_private.work_boundary_result(business uuid,actor uuid,operation uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE saved record; request jsonb; receipt jsonb;
BEGIN
 SELECT state,result_schema_version,result,payload_hash,recovery_epoch INTO saved
  FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation
   AND command_type='operations.job.work_boundary.correct' AND schema_version=1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 request:=saved.result->'request';
 IF saved.state<>'committed' OR saved.result_schema_version IS DISTINCT FROM 1
  OR request->>'businessId' IS DISTINCT FROM business::text OR request->>'actorId' IS DISTINCT FROM actor::text
  OR request->>'operationId' IS DISTINCT FROM operation::text OR request->>'recoveryEpoch' IS DISTINCT FROM saved.recovery_epoch::text
  OR request->>'commandType' IS DISTINCT FROM 'operations.job.work_boundary.correct'
  OR request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_BOUNDARY_RESULT_REQUIRED';END IF;
 receipt:=crest_private.work_boundary_receipt(business,actor,operation,request);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'request',request,'receipt',receipt) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_BOUNDARY_RESULT_REQUIRED';
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $result$;
ALTER FUNCTION crest_private.work_boundary_result(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.work_boundary_result(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.work_boundary_result(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_private.check_work_boundary_result() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.work_boundary_result(NEW.business_id,NEW.actor_id,NEW.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_WORK_BOUNDARY_RESULT_REQUIRED';
 END IF;
 RETURN NULL;
END $check$;
ALTER FUNCTION crest_private.check_work_boundary_result() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_work_boundary_result() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER work_boundary_original AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.job.work_boundary.correct')
 EXECUTE FUNCTION crest_private.check_work_boundary_result();

CREATE FUNCTION crest_commands.correct_job_work_boundary(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job uuid,expected_version bigint,
 left_version uuid,right_version uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE
 authority jsonb;request jsonb;digest text;claim uuid;existing record;
 j crest.jobs;earlier crest.work_intervals;later crest.work_intervals;
 original crest.work_intervals;corrected crest.work_intervals; originals crest.work_intervals[];
 corrected_at timestamptz;reason text;result jsonb;conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_job IS NULL
  OR expected_version IS NULL OR expected_version<=0 OR left_version IS NULL OR right_version IS NULL OR left_version=right_version
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-ARRAY['correctedAt','reason']<>'{}'::jsonb
  OR crest_private.valid_support_instant(body->'correctedAt',clock_timestamp()) IS NOT TRUE
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_BOUNDARY_INPUT_REQUIRED';END IF;
 corrected_at:=(body->>'correctedAt')::timestamptz;reason:=body->>'reason';
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_boundary.correct',
  'businessId',requested_business,'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,
  'jobId',requested_job,'expectedJobVersion',expected_version::text,'leftVersionId',left_version,'rightVersionId',right_version,
  'correctedAt',body->'correctedAt','reason',reason);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
   VALUES(requested_business,requested_operation,expected_actor,'operations.job.work_boundary.correct',1,expected_epoch,digest,expected_actor,'manual')
   ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT actor_id,command_type,recovery_epoch,payload_hash INTO existing FROM crest_private.operations
    WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.work_boundary.correct'
    OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO j FROM crest.jobs WHERE business_id=requested_business AND id=requested_job AND operator_actor_id=expected_actor;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1942',MESSAGE='job';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,expected_actor);
   SELECT * INTO j FROM crest.jobs
    WHERE business_id=requested_business AND id=requested_job AND operator_actor_id=expected_actor FOR UPDATE;
   IF NOT FOUND OR j.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1942',MESSAGE='version';END IF;
   IF j.fulfillment_mode<>'mobile' OR j.state NOT IN('in_progress','paused','completed','cancelled') THEN
    RAISE EXCEPTION USING ERRCODE='P1942',MESSAGE='state';
   END IF;
   SELECT * INTO earlier FROM crest.current_work_intervals
    WHERE business_id=requested_business AND id=left_version AND job_id=requested_job AND operator_actor_id=expected_actor;
   SELECT * INTO later FROM crest.current_work_intervals
    WHERE business_id=requested_business AND id=right_version AND job_id=requested_job AND operator_actor_id=expected_actor;
   IF earlier.id IS NULL OR later.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1942',MESSAGE='version';END IF;
   IF earlier.kind=later.kind OR earlier.ended_at IS NULL OR earlier.ended_at<>later.started_at
    OR earlier.sequence=9223372036854775807 OR later.sequence=9223372036854775807
    OR corrected_at<=earlier.started_at OR corrected_at>=later.ended_at OR corrected_at=earlier.ended_at
    OR EXISTS(SELECT 1 FROM crest.current_work_intervals w WHERE w.business_id=requested_business AND w.job_id=requested_job
      AND w.id NOT IN(earlier.id,later.id) AND w.started_at=earlier.ended_at)
   THEN RAISE EXCEPTION USING ERRCODE='P1942',MESSAGE='boundary';END IF;
   -- First shrink the source interval, then extend its neighbor. The existing
   -- immediate exclusion constraints protect every intermediate projection.
   originals:=CASE WHEN corrected_at<earlier.ended_at THEN ARRAY[earlier,later] ELSE ARRAY[later,earlier] END;
   FOREACH original IN ARRAY originals LOOP
    INSERT INTO crest.work_intervals(business_id,logical_id,sequence,replaces_id,job_id,operator_actor_id,kind,
     started_at,ended_at,pause_reason,change_kind,reason,created_by,operation_id)
    VALUES(requested_business,original.logical_id,original.sequence+1,original.id,requested_job,expected_actor,original.kind,
     CASE WHEN original.id=right_version THEN corrected_at ELSE original.started_at END,
     CASE WHEN original.id=left_version THEN corrected_at ELSE original.ended_at END,
     original.pause_reason,'correct',reason,expected_actor,requested_operation) RETURNING * INTO corrected;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
    VALUES(requested_business,requested_operation,expected_actor,expected_actor,'work_intervals',corrected.logical_id,corrected.sequence,
     'correct',reason,jsonb_build_object('schemaVersion',1,'before',crest_private.field_work_projection(original),
      'after',crest_private.field_work_projection(corrected)),'manual');
   END LOOP;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'request',request,'receipt',
     crest_private.work_boundary_receipt(requested_business,expected_actor,requested_operation,request))
    WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  result:=crest_private.work_boundary_result(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P1942' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN exclusion_violation THEN
  GET STACKED DIAGNOSTICS conflict=CONSTRAINT_NAME;
  IF conflict NOT IN('operator_physical_time_exclusion','operator_work_session_exclusion') THEN RAISE;END IF;
  RETURN jsonb_build_object('state','conflict','reason','occupancy');
 END;
END $write$;
ALTER FUNCTION crest_commands.correct_job_work_boundary(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.correct_job_work_boundary(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.correct_job_work_boundary(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,uuid,uuid,jsonb)
 TO crest_web;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_WORK_BOUNDARY_REFERENCE_REVIEW_REQUIRED';
 END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.job.work_boundary.correct' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','expectedJobVersion','leftVersionId','rightVersionId'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') AND crest_private.original_operation_uuid(r->'recoveryEpoch')
   AND crest_private.original_operation_uuid(r->'jobId') AND crest_private.original_operation_version(r->'expectedJobVersion',false)
   AND crest_private.original_operation_uuid(r->'leftVersionId') AND crest_private.original_operation_uuid(r->'rightVersionId')
   AND r->'leftVersionId'<>r->'rightVersionId',false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_work_boundary_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; reference jsonb; saved jsonb; receipt jsonb; operation uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF original->>'commandType' IS DISTINCT FROM 'operations.job.work_boundary.correct'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_WORK_BOUNDARY_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 reference:=original->'reference';operation:=(reference->>'operationId')::uuid;
 saved:=crest_private.work_boundary_result(requested_business,expected_actor,operation);
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 IF receipt->'recoveryEpoch' IS DISTINCT FROM reference->'recoveryEpoch'
  OR receipt->'jobId' IS DISTINCT FROM reference->'jobId'
  OR receipt->'expectedJobVersion' IS DISTINCT FROM reference->'expectedJobVersion'
  OR receipt->'left'->'replaces_id' IS DISTINCT FROM reference->'leftVersionId'
  OR receipt->'right'->'replaces_id' IS DISTINCT FROM reference->'rightVersionId'
 THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.job.work_boundary.correct','businessId',requested_business,
   'actorId',expected_actor,'operationId',operation,'recoveryEpoch',reference->'recoveryEpoch','subjectId',reference->'jobId',
   'sourceRecordId',reference->'jobId','sourceVersion',reference->'expectedJobVersion','sourceAuditIds',receipt->'auditIds')));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_work_boundary_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_work_boundary_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_WORK_BOUNDARY_LOOKUP_REVIEW_REQUIRED';
 END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.job.work_boundary.correct' THEN
  RETURN crest_commands.lookup_work_boundary_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
