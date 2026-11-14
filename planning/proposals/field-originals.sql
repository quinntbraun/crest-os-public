-- Held Phase6 recovery composition. Original identity contains IDs, versions
-- and fixed action names only; never payload hashes, locations or draft values.
-- Reuse the existing fresh-auth retirement and scheduling HTTP boundary.
DO $review$ BEGIN
 IF to_regprocedure('crest_private.support_trip_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') IS NOT NULL
  OR EXISTS(SELECT 1 FROM(VALUES
   ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,jsonb)','crest_booking_owner',true,'1a6b61ef1fe8c40f537ced5ea9901eb9a88795c0ff743c96bb9eb2284eaed14c'),
   ('crest_private.operation_retirement_result(uuid,uuid,jsonb)','crest_schema_owner',false,'8cf8a2253a531d9335293f89c0b993f4f03ca0c368ec2fdc00749ea56e5586d2'),
   ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'29d98a384b88a6bf066c5b961290bedd1df4aab4bda53186a98ccf697087cf42')
  ) e(signature,owner,definer,digest) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IS NULL OR r.rolname IS DISTINCT FROM e.owner OR p.prosecdef IS DISTINCT FROM e.definer OR encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') IS DISTINCT FROM e.digest)
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM(VALUES('crest.jobs'),('crest.appointments'),('crest.job_vehicles'),('crest.job_encounters'),('crest.travel_legs'),('crest.work_intervals'),('crest.work_scope_outcomes'),('crest.operator_controls'),('crest.operator_occupancy'),('crest.schedule_reservations'),('crest.schedule_overrides'),('crest.schedule_override_conflicts'),('crest.allocation_plan_versions'),('crest.allocation_plan_parts'),('crest.customers'),('crest.vehicles'),('crest.addresses'),('crest.memberships'),('crest_private.operations'),('crest_private.audit_events')) e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) WHERE c.oid IS NULL OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR(SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY(n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '6040b02b93bd928108261376362a910f3e0c60dc463eae0a05b3ca2282d6ddc3'
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_FIELD_ORIGINAL_SOURCE_REQUIRED';END IF;
END $review$;

DO $extend$ DECLARE definition text;updated text;marker text;BEGIN
 definition:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 marker:=' kind:=v->>''commandType'';r:=v->''reference'';';
 updated:=replace(definition,marker,marker||$branch$
 IF kind IN('operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct') THEN
  keys:=ARRAY['operationId','recoveryEpoch']||(CASE
   WHEN kind='operations.job.field' OR kind='operations.job.interrupt' THEN ARRAY['jobId','expectedJobVersion','action']
   WHEN kind='operations.job.complete' OR kind='operations.job.cancel_unfulfilled' THEN ARRAY['jobId','expectedJobVersion']
   WHEN kind='operations.mileage.record' THEN ARRAY['legId','expectedLegVersionId','expectedEvidenceVersion']
   ELSE ARRAY['legId','expectedLegVersionId','action'] END);
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
  FOREACH key IN ARRAY keys LOOP
   IF key IN('expectedJobVersion','expectedEvidenceVersion') THEN
    IF crest_private.original_operation_version(r->key,key='expectedEvidenceVersion') IS NOT TRUE OR (r->>key)::numeric>=9223372036854775807 THEN RETURN false;END IF;
   ELSIF key='expectedLegVersionId' AND kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
    IF NOT coalesce(r->key='null'::jsonb OR crest_private.original_operation_uuid(r->key),false) THEN RETURN false;END IF;
   ELSIF key<>'action' AND crest_private.original_operation_uuid(r->key) IS NOT TRUE THEN RETURN false;END IF;
  END LOOP;
  IF kind='operations.job.field' THEN RETURN coalesce(r->>'action' IN('depart','arrive','direct_arrive','pause','resume'),false);END IF;
  IF kind='operations.job.interrupt' THEN RETURN coalesce(r->>'action' IN('cancel','reschedule'),false);END IF;
  IF kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
   RETURN coalesce((kind='operations.support_trip.record' AND r->>'action' IN('depart','arrive','cancel') OR kind='operations.support_trip.correct' AND r->>'action' IN('record','correct')) AND ((r->>'action' IN('depart','record'))=(r->'expectedLegVersionId'='null'::jsonb)),false);
  END IF;
  RETURN true;
 END IF;
$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_ORIGINAL_EXTENSION_REQUIRED';END IF;EXECUTE updated;
END $extend$;

GRANT EXECUTE ON FUNCTION crest_private.original_operation_reference_valid(jsonb),crest_private.original_operation_uuid(jsonb),crest_private.original_operation_version(jsonb,boolean) TO crest_booking_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_field_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE context jsonb;kind text;operation uuid;result jsonb;receipt jsonb;request jsonb;reference jsonb;actual jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF crest_private.original_operation_reference_valid(original) IS NOT TRUE OR original->>'businessId' IS DISTINCT FROM requested_business::text OR original->>'commandType' NOT IN('operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_FIELD_ORIGINAL_INPUT_REQUIRED';END IF;
 kind:=original->>'commandType';operation:=(original->'reference'->>'operationId')::uuid;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 result:=CASE kind
  WHEN 'operations.job.field' THEN crest_commands.lookup_field_session_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.job.complete' THEN crest_commands.lookup_completed_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.job.interrupt' THEN crest_commands.lookup_interrupted_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.job.cancel_unfulfilled' THEN crest_commands.lookup_unfulfilled_job_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  WHEN 'operations.mileage.record' THEN crest_commands.lookup_mileage_operation($1,$2,$3,$4,$5,$6,$7,$8,operation)
  ELSE crest_commands.lookup_support_trip_operation($1,$2,$3,$4,$5,$6,$7,$8,operation) END;
 IF result->>'state'='absent' THEN RETURN result;END IF;
 IF result->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_ORIGINAL_RESULT_REQUIRED';END IF;
 receipt:=result->'receipt';
 IF receipt->>'commandType' IS DISTINCT FROM kind THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 IF kind='operations.mileage.record' THEN
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',receipt->>'recoveryEpoch','legId',receipt->>'legId','expectedLegVersionId',receipt->>'legVersionId','expectedEvidenceVersion',((receipt->>'evidenceSequence')::bigint-1)::text);
 ELSIF kind IN('operations.support_trip.record','operations.support_trip.correct') THEN
  SELECT o.result->'request' INTO request FROM crest_private.operations o WHERE o.business_id=requested_business AND o.operation_id=operation AND o.actor_id=expected_actor AND o.command_type=kind;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',request->>'recoveryEpoch','legId',request->>'legId','expectedLegVersionId',request->'expectedLegVersionId','action',request->'body'->>'action');
 ELSE
  SELECT e.evidence->'request' INTO request FROM crest.job_events e WHERE e.business_id=requested_business AND e.operation_id=operation AND e.created_by=expected_actor;
  reference:=jsonb_build_object('operationId',operation,'recoveryEpoch',request->>'recoveryEpoch','jobId',request->>'jobId','expectedJobVersion',CASE WHEN kind IN('operations.job.field','operations.job.complete') THEN request->>'expectedVersion' ELSE request->>'expectedJobVersion' END);
  IF kind IN('operations.job.field','operations.job.interrupt') THEN reference:=reference||jsonb_build_object('action',CASE WHEN kind='operations.job.field' THEN request->'payload'->>'action' ELSE request->'body'->>'action' END);END IF;
 END IF;
 actual:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'commandType',kind,'reference',reference);
 IF crest_private.original_operation_reference_valid(actual) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_FIELD_ORIGINAL_SOURCE_REQUIRED';END IF;
 IF actual IS DISTINCT FROM original THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 -- Minimize the recovery response only after the complete typed domain receipt
 -- and its immutable source graph have been verified above. Domain lookups and
 -- history still retain their full original receipt; this is not an export.
 receipt:=jsonb_build_object('schemaVersion',1,'commandType',kind,'businessId',requested_business,'actorId',expected_actor,'operationId',operation,'recoveryEpoch',reference->>'recoveryEpoch',
  'subjectId',CASE WHEN kind LIKE 'operations.job.%' THEN reference->>'jobId' ELSE reference->>'legId' END,
  'sourceRecordId',CASE WHEN kind LIKE 'operations.job.%' THEN receipt->>'jobId' WHEN kind='operations.mileage.record' THEN receipt->>'evidenceId' ELSE receipt->>'legVersionId' END,
  'sourceVersion',CASE WHEN kind LIKE 'operations.job.%' THEN receipt->>'jobVersion' WHEN kind='operations.mileage.record' THEN receipt->>'evidenceSequence' ELSE receipt->>'legSequence' END,
  'sourceAuditIds',coalesce(receipt->'sourceAuditIds',receipt->'auditIds'));
 RETURN jsonb_build_object('schemaVersion',1,'original',actual,'result',jsonb_build_object('state','committed','receipt',receipt));
END $original$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_field_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;

-- Keep the existing route/CSRF/rate/auth/error contract. The original scheduling
-- branch remains unchanged; only the seven new typed kinds delegate here.
DO $route$ DECLARE definition text;updated text;marker text;BEGIN
 definition:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 marker:=E'BEGIN\n';
 updated:=replace(definition,marker,marker||$branch$
 IF original->>'commandType' IN('operations.job.field','operations.job.complete','operations.job.interrupt','operations.job.cancel_unfulfilled','operations.mileage.record','operations.support_trip.record','operations.support_trip.correct') THEN
  RETURN crest_commands.lookup_field_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$branch$);
 IF updated=definition THEN RAISE EXCEPTION 'CREST_FIELD_ORIGINAL_ROUTE_REQUIRED';END IF;EXECUTE updated;
END $route$;
