-- Held BR10 access for the immutable original of a review-message outcome.
DO $review$
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
  ('crest_private.original_operation_reference_valid(jsonb)','crest_schema_owner',false,'i','f9418bff62e2ab8bd7d0ca879a64436f1141f260b6a0b9d6bd613256baa6a5b6'),
  ('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)','crest_booking_owner',true,'v','88dd70ff3bf5a53194b7f5e2ef690f0e448468b4c13354e1e0e5709e0f5e2f22')
 ) expected(signature,owner,definer,volatility,body_hash) WHERE NOT EXISTS(
  SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature)
   AND p.proowner=expected.owner::regrole AND p.prosecdef=expected.definer AND p.provolatile::text=expected.volatility
   AND NOT p.proleakproof AND l.lanname='plpgsql' AND p.proconfig=CASE WHEN expected.definer
    THEN ARRAY['search_path=pg_catalog, pg_temp','row_security=on'] ELSE ARRAY['search_path=pg_catalog, pg_temp'] END
   AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.body_hash
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)
 )) OR to_regprocedure('crest_private.review_message_outcome_result(uuid,uuid,uuid)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_REVIEW_OUTCOME_ACCESS_REVIEW_REQUIRED';END IF;
END $review$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_REVIEW_OUTCOME_ACCESS_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.message.record_outcome' THEN
  keys:=ARRAY['operationId','recoveryEpoch','jobId','messageId','priorEventId','action'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') AND crest_private.original_operation_uuid(r->'recoveryEpoch')
   AND crest_private.original_operation_uuid(r->'jobId') AND crest_private.original_operation_uuid(r->'messageId')
   AND crest_private.original_operation_uuid(r->'priorEventId')
   AND r->>'action' IN('opened','owner_confirmed_sent','failed','skipped'),false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_review_message_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; reference jsonb; saved jsonb; receipt jsonb; operation uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF original->>'commandType' IS DISTINCT FROM 'operations.message.record_outcome'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_REVIEW_OUTCOME_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 reference:=original->'reference';operation:=(reference->>'operationId')::uuid;
 saved:=crest_private.review_message_outcome_result(requested_business,expected_actor,operation);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved;END IF;
 receipt:=saved->'receipt';
 IF receipt->'recoveryEpoch' IS DISTINCT FROM reference->'recoveryEpoch' OR receipt->'jobId' IS DISTINCT FROM reference->'jobId'
  OR receipt->'messageId' IS DISTINCT FROM reference->'messageId' OR receipt->'priorEventId' IS DISTINCT FROM reference->'priorEventId'
  OR receipt->'kind' IS DISTINCT FROM reference->'action'
 THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.message.record_outcome','businessId',requested_business,
   'actorId',expected_actor,'operationId',operation,'recoveryEpoch',reference->'recoveryEpoch','subjectId',reference->'messageId',
   'sourceRecordId',receipt->'eventId','sourceVersion','1','sourceAuditIds',receipt->'auditIds')));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_review_message_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_review_message_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
BEGIN
 source:=pg_get_functiondef('crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1 THEN
  RAISE EXCEPTION 'CREST_REVIEW_OUTCOME_ACCESS_REVIEW_REQUIRED';END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.message.record_outcome' THEN
  RETURN crest_commands.lookup_review_message_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;

