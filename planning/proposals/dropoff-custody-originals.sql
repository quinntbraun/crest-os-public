-- Extend the held custody candidate with Crest's existing original-operation
-- lookup and retirement. The reference contains only opaque IDs and a version.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','96b958cd341204473e998ada2397f6e687782f295a150cc6a26ba7cd7c3ab86d'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','ad0a4283c6e1ebc4a3537647a680dca6e7a4262e83960d687c754890a3237263'),
  ('crest_private.operation_retirement_result(uuid,uuid,jsonb)','crest_schema_owner',false,'v','b4333c16f147af24b46b36652c0aea60f36a0e104e93c8f8ffff9e4aafd85100')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CUSTODY_ORIGINAL_REVIEW_REQUIRED';END IF;
END $review$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
  OR position('operations.follow_up.save' in source)=0 OR position('operations.custody.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_CUSTODY_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.custody.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobVehicleId','caseId','expectedVersion'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'jobVehicleId') IS TRUE
   AND crest_private.original_operation_uuid(r->'caseId') IS TRUE
   AND r->'expectedVersion' IN ('"0"'::jsonb,'"1"'::jsonb),false);
 END IF;
 IF kind='operations.custody.policy.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','modeVersionId'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'modeVersionId') IS TRUE,false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_dropoff_custody_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.custody.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_ORIGINAL_REQUIRED';END IF;
 reference:=original->'reference';
 saved:=crest_commands.read_dropoff_handoff_original($1,$2,$3,$4,$5,$6,$7,$8,
  (reference->>'recoveryEpoch')::uuid,(reference->>'operationId')::uuid,1,
  (reference->>'jobVehicleId')::uuid,(reference->>'caseId')::uuid,(reference->>'expectedVersion')::integer);
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.custody.save','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',receipt->'caseId','sourceRecordId',receipt->'eventId',
   'sourceVersion',receipt->'version','sourceAuditIds',jsonb_build_array(saved->'auditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_dropoff_custody_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_dropoff_custody_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION crest_commands.lookup_dropoff_policy_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.custody.policy.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.dropoff_policy_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'recoveryEpoch' IS DISTINCT FROM reference->>'recoveryEpoch'
  OR saved->'policy'->>'modeVersionId' IS DISTINCT FROM reference->>'modeVersionId'
 THEN RETURN jsonb_build_object('state','absent');END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.custody.policy.save','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'modeVersionId','sourceRecordId',saved->'policy'->'id',
   'sourceVersion','1','sourceAuditIds',jsonb_build_array(saved->'auditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_dropoff_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_dropoff_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
  OR position('operations.follow_up.save' in source)=0 OR position('operations.custody.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_CUSTODY_ORIGINAL_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.custody.save' THEN
  RETURN crest_commands.lookup_dropoff_custody_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
 IF original->>'commandType'='operations.custody.policy.save' THEN
  RETURN crest_commands.lookup_dropoff_policy_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;
