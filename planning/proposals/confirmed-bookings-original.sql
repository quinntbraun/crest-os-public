-- Full typed original identity, separate from original_recorded observation.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='6bd9e6676c976a29d259056e2436337d1174fdb589ee2b8d83b9798c3ee67331')
 OR to_regprocedure('crest_commands.lookup_rescheduled_job_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_booking_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_booking_owner'::regrole OR member='crest_booking_owner'::regrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SCHEDULING_ORIGINAL_SOURCE_REQUIRED';END IF;
END $review$;
GRANT EXECUTE ON FUNCTION crest_private.original_operation_reference_valid(jsonb),crest_private.original_operation_uuid(jsonb),crest_private.original_operation_version(jsonb,boolean),crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_scheduling_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE context jsonb;kind text;result jsonb;request jsonb;reference jsonb;actual jsonb;operation uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF crest_private.original_operation_reference_valid(original) IS NOT TRUE OR original->>'businessId' IS DISTINCT FROM requested_business::text OR original->>'commandType' NOT IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save','operations.job.book','operations.job.cancel','operations.job.reschedule') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SCHEDULING_ORIGINAL_INPUT_REQUIRED';END IF;
 kind:=original->>'commandType';operation:=(original->'reference'->>'operationId')::uuid;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 IF kind IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save') THEN
  result:=crest_commands.lookup_fulfillment_mode_operation($1,$2,$3,$4,$5,$6,$7,$8,operation);
 ELSE
  result:=CASE kind WHEN 'operations.job.book' THEN crest_commands.lookup_booked_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) WHEN 'operations.job.cancel' THEN crest_commands.lookup_cancelled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) ELSE crest_commands.lookup_rescheduled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) END;
 END IF;
 IF result->>'state'='absent' THEN RETURN result;END IF;
 IF kind IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save') THEN
  kind:=CASE WHEN result->'receipt'->>'sequence'='1' THEN 'operations.fulfillment_modes.initialize' ELSE 'operations.fulfillment_modes.save' END;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',result->>'recoveryEpoch','expectedSequence',((result->'receipt'->>'sequence')::bigint-1)::text);
 ELSE
  SELECT e.evidence->'request' INTO request FROM crest.job_events e WHERE e.business_id=requested_business AND e.operation_id=operation AND e.created_by=expected_actor;
  IF request IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SCHEDULING_ORIGINAL_SOURCE_REQUIRED';END IF;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',request->>'recoveryEpoch','jobId',request->>'jobId')||CASE kind WHEN 'operations.job.book' THEN jsonb_build_object('expectedModeSequence',request->>'expectedModeSequence') WHEN 'operations.job.cancel' THEN jsonb_build_object('expectedJobVersion',request->>'expectedJobVersion') ELSE jsonb_build_object('expectedJobVersion',request->>'expectedJobVersion','action',request->'payload'->>'action','latestAppointmentId',request->'payload'->>'latestAppointmentId') END;
 END IF;
 actual:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'commandType',kind,'reference',reference);
 IF actual IS DISTINCT FROM original THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'original',actual,'result',result);
END $original$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;
