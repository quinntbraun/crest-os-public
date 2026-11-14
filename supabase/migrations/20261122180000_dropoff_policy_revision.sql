RESET ROLE;
-- P08/BR08. One policy revision appends an arrangement and a handoff policy
-- together. The booking command already serializes against this arrangement
-- chain and binds each new job to the version it sees.
SET LOCAL ROLE crest_schema_owner;

CREATE POLICY dropoff_revision_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(command_type='operations.custody.policy.revise'
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY dropoff_revision_claim ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(command_type='operations.custody.policy.revise' AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL AND created_by=actor_id
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY dropoff_revision_commit ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(command_type='operations.custody.policy.revise' AND state='pending'
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid)
 WITH CHECK(command_type='operations.custody.policy.revise' AND state='committed'
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY dropoff_revision_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner,crest_mode_integrity_owner
 USING(command_type='operations.custody.policy.revise');
CREATE POLICY dropoff_revision_mode ON crest.fulfillment_mode_versions FOR INSERT TO crest_booking_owner
 WITH CHECK(sequence>1 AND dropoff_enabled AND origin='manual'
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=fulfillment_mode_versions.business_id
   AND o.operation_id=fulfillment_mode_versions.operation_id AND o.actor_id=fulfillment_mode_versions.created_by
   AND o.command_type='operations.custody.policy.revise' AND o.state='pending'));

CREATE POLICY dropoff_revision_mode_audit ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='fulfillment_modes');
CREATE POLICY dropoff_revision_policy_audit_receipt ON crest_private.audit_events FOR SELECT TO crest_booking_owner
 USING(entity_kind='custody_authorization_configs'
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions)
 TO crest_booking_integrity_owner;

CREATE OR REPLACE FUNCTION crest_private.validate_fulfillment_mode_append() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $append$
DECLARE prior crest.fulfillment_mode_versions; latest bigint; policy_revision boolean;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MODE_FRESH_READ_REQUIRED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||NEW.business_id::text,0));
 SELECT max(sequence) INTO latest FROM crest.fulfillment_mode_versions WHERE business_id=NEW.business_id;
 IF NEW.sequence=1 THEN
  IF latest IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_SEQUENCE_REVIEW_REQUIRED'; END IF;
 ELSE
  SELECT * INTO prior FROM crest.fulfillment_mode_versions WHERE business_id=NEW.business_id AND sequence=NEW.replaces_sequence;
  SELECT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id
   AND o.actor_id=NEW.created_by AND o.command_type='operations.custody.policy.revise' AND o.state='pending') INTO policy_revision;
  IF prior.id IS NULL OR latest IS DISTINCT FROM NEW.replaces_sequence OR policy_revision IS DISTINCT FROM
   (ROW(NEW.mobile_enabled,NEW.dropoff_enabled,NEW.pickup_return_enabled)
    IS NOT DISTINCT FROM ROW(prior.mobile_enabled,prior.dropoff_enabled,prior.pickup_return_enabled))
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_SEQUENCE_REVIEW_REQUIRED'; END IF;
 END IF;
 NEW.created_at:=clock_timestamp(); RETURN NEW;
END $append$;

CREATE OR REPLACE FUNCTION crest_private.check_fulfillment_mode_audit() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE prior jsonb:='null'::jsonb;
BEGIN
 IF NEW.sequence>1 THEN SELECT crest_private.fulfillment_mode_projection(v) INTO prior FROM crest.fulfillment_mode_versions v
  WHERE v.business_id=NEW.business_id AND v.sequence=NEW.replaces_sequence; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o
   ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by
   AND a.entity_kind='fulfillment_modes' AND a.entity_id=NEW.business_id AND a.entity_version=NEW.sequence
   AND a.action=CASE WHEN NEW.sequence=1 THEN 'initialize' ELSE 'revise' END
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',crest_private.fulfillment_mode_projection(NEW::crest.fulfillment_mode_versions))
   AND o.state='committed' AND (o.schema_version=1 OR o.schema_version=2 AND o.command_type='operations.job.book')
   AND o.origin=NEW.origin AND o.import_row_id IS NULL
   AND (NEW.sequence=1 AND o.command_type IN('operations.fulfillment_modes.initialize','operations.job.book')
    OR NEW.sequence>1 AND o.command_type IN('operations.fulfillment_modes.save','operations.custody.policy.revise')))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $audit$;

CREATE FUNCTION crest_private.dropoff_policy_revision_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; next_mode crest.fulfillment_mode_versions; prior_mode crest.fulfillment_mode_versions;
 next_policy crest.custody_authorization_configs; prior_policy crest.custody_authorization_configs;
 policy jsonb; intent jsonb; mode_audit uuid; policy_audit uuid; receipt jsonb;
BEGIN
 SELECT o.recovery_epoch,o.result,o.payload_hash INTO saved FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation
  AND o.command_type='operations.custody.policy.revise' AND o.state='committed' AND o.schema_version=1
  AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;

 SELECT * INTO next_policy FROM crest.custody_authorization_configs WHERE business_id=business AND id=operation;
 SELECT * INTO next_mode FROM crest.fulfillment_mode_versions WHERE business_id=business AND id=next_policy.mode_version_id
  AND created_by=actor AND operation_id=operation AND dropoff_enabled;
 SELECT * INTO prior_mode FROM crest.fulfillment_mode_versions WHERE business_id=business AND sequence=next_mode.replaces_sequence;
 SELECT * INTO prior_policy FROM crest.custody_authorization_configs WHERE business_id=business AND mode_version_id=prior_mode.id;
 IF prior_policy.id IS NULL OR prior_mode.dropoff_enabled IS DISTINCT FROM true OR
  ROW(next_mode.mobile_enabled,next_mode.dropoff_enabled,next_mode.pickup_return_enabled)
   IS DISTINCT FROM ROW(prior_mode.mobile_enabled,prior_mode.dropoff_enabled,prior_mode.pickup_return_enabled) OR
  ROW(next_policy.acknowledgement_text,next_policy.condition_photo_required)
   IS NOT DISTINCT FROM ROW(prior_policy.acknowledgement_text,prior_policy.condition_photo_required)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_DROPOFF_REVISION_ORIGINAL_REQUIRED'; END IF;

 policy:=crest_private.dropoff_policy_projection(next_policy);
 intent:=jsonb_build_object('modeVersionId',prior_mode.id,'policyId',prior_policy.id,'reason',next_mode.reason,
  'acknowledgementText',next_policy.acknowledgement_text,'conditionPhotoRequired',next_policy.condition_photo_required);
 SELECT a.id INTO mode_audit FROM crest_private.audit_events a WHERE a.business_id=business AND a.actor_id=actor
  AND a.operation_id=operation AND a.entity_kind='fulfillment_modes' AND a.entity_id=business
  AND a.entity_version=next_mode.sequence AND a.action='revise'
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',crest_private.fulfillment_mode_projection(prior_mode),
   'after',crest_private.fulfillment_mode_projection(next_mode));
 SELECT a.id INTO policy_audit FROM crest_private.audit_events a WHERE a.business_id=business AND a.actor_id=actor
  AND a.operation_id=operation AND a.entity_kind='custody_authorization_configs' AND a.entity_id=operation
  AND a.entity_version=1 AND a.action='create'
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',null,'after',policy);
 receipt:=jsonb_build_object('schemaVersion',1,'priorModeVersionId',prior_mode.id,'priorPolicyId',prior_policy.id,
  'sequence',next_mode.sequence::text,'policy',policy,'modeAuditId',mode_audit,'policyAuditId',policy_audit);
 IF mode_audit IS NULL OR policy_audit IS NULL OR saved.result IS DISTINCT FROM receipt
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(intent::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_DROPOFF_REVISION_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',saved.recovery_epoch,'receipt',receipt);
END $original$;
ALTER FUNCTION crest_private.dropoff_policy_revision_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_policy_revision_original(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_policy_revision_original(uuid,uuid,uuid) TO crest_booking_owner;

CREATE OR REPLACE FUNCTION crest_private.check_dropoff_policy_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE operation uuid; actor uuid; kind text; original jsonb;
BEGIN
 IF TG_TABLE_NAME='operations' THEN
  operation:=NEW.operation_id; actor:=NEW.actor_id; kind:=NEW.command_type;
 ELSE
  operation:=NEW.id;
  SELECT o.actor_id,o.command_type INTO actor,kind FROM crest_private.operations o
  WHERE o.business_id=NEW.business_id AND o.operation_id=operation
   AND o.command_type IN('operations.custody.policy.save','operations.custody.policy.revise');
 END IF;
 IF kind='operations.custody.policy.revise' THEN
  original:=crest_private.dropoff_policy_revision_original(NEW.business_id,actor,operation);
 ELSE
  original:=crest_private.dropoff_policy_original(NEW.business_id,actor,operation);
 END IF;
 IF original IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER dropoff_revision_operation_verified AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.custody.policy.revise')
 EXECUTE FUNCTION crest_private.check_dropoff_policy_original();

CREATE FUNCTION crest_commands.revise_dropoff_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,expected_mode uuid,expected_policy uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $revise$
DECLARE authority jsonb; claim uuid; original jsonb; digest text; saved_hash text; conflict text;
 prior_mode crest.fulfillment_mode_versions; next_mode crest.fulfillment_mode_versions;
 prior_policy crest.custody_authorization_configs; next_policy crest.custody_authorization_configs;
 policy jsonb; mode_audit uuid; policy_audit uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR expected_mode IS NULL OR expected_policy IS NULL
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT(body ?& ARRAY['acknowledgementText','conditionPhotoRequired','reason'])
  OR body-ARRAY['acknowledgementText','conditionPhotoRequired','reason']<>'{}'::jsonb OR octet_length(body::text)>16384
  OR jsonb_typeof(body->'conditionPhotoRequired') IS DISTINCT FROM 'boolean'
  OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE
  OR (body->'acknowledgementText'<>'null'::jsonb AND crest_private.booking_text_required(body->'acknowledgementText',2000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_DROPOFF_REVISION_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to((body||jsonb_build_object('modeVersionId',expected_mode,'policyId',expected_policy))::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.custody.policy.revise',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT payload_hash INTO saved_hash FROM crest_private.operations WHERE business_id=requested_business
    AND actor_id=expected_actor AND operation_id=requested_operation AND command_type='operations.custody.policy.revise';
   original:=crest_private.dropoff_policy_revision_original(requested_business,expected_actor,requested_operation);
   IF saved_hash IS DISTINCT FROM digest OR original->>'recoveryEpoch' IS DISTINCT FROM expected_epoch::text
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO prior_mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   SELECT * INTO prior_policy FROM crest.custody_authorization_configs WHERE business_id=requested_business AND mode_version_id=prior_mode.id;
   IF prior_mode.id IS DISTINCT FROM expected_mode OR prior_mode.dropoff_enabled IS DISTINCT FROM true
    OR prior_policy.id IS DISTINCT FROM expected_policy OR prior_mode.sequence=9223372036854775807
   THEN RAISE EXCEPTION USING ERRCODE='P1983',MESSAGE='version'; END IF;
   IF ROW(prior_policy.acknowledgement_text,prior_policy.condition_photo_required)
    IS NOT DISTINCT FROM ROW(body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean)
   THEN RAISE EXCEPTION USING ERRCODE='P1983',MESSAGE='unchanged'; END IF;
   INSERT INTO crest.fulfillment_mode_versions(business_id,sequence,replaces_sequence,mobile_enabled,dropoff_enabled,
    pickup_return_enabled,reason,created_by,operation_id)
   VALUES(requested_business,prior_mode.sequence+1,prior_mode.sequence,prior_mode.mobile_enabled,true,
    prior_mode.pickup_return_enabled,body->>'reason',expected_actor,requested_operation) RETURNING * INTO next_mode;
   INSERT INTO crest.custody_authorization_configs(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required)
   VALUES(requested_operation,requested_business,next_mode.id,body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean)
   RETURNING * INTO next_policy;
   mode_audit:=crest_private.append_booking_audit('fulfillment_modes',requested_business,next_mode.sequence,'revise',
    crest_private.fulfillment_mode_projection(prior_mode),crest_private.fulfillment_mode_projection(next_mode));
   policy:=crest_private.dropoff_policy_projection(next_policy);
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'custody_authorization_configs',next_policy.id,1,'create',
    jsonb_build_object('schemaVersion',1,'before',null,'after',policy),'manual') RETURNING id INTO policy_audit;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'priorModeVersionId',prior_mode.id,'priorPolicyId',prior_policy.id,
     'sequence',next_mode.sequence::text,'policy',policy,'modeAuditId',mode_audit,'policyAuditId',policy_audit)
   WHERE business_id=requested_business AND operation_id=requested_operation;
   original:=crest_private.dropoff_policy_revision_original(requested_business,expected_actor,requested_operation);
   IF original IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_DROPOFF_REVISION_ORIGINAL_REQUIRED'; END IF;
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN original;
 EXCEPTION WHEN SQLSTATE 'P1983' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $revise$;
ALTER FUNCTION crest_commands.revise_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.revise_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.revise_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,jsonb) TO crest_web;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
  OR position('operations.custody.policy.save' in source)=0 OR position('operations.custody.policy.revise' in source)>0
 THEN RAISE EXCEPTION 'CREST_DROPOFF_REVISION_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.custody.policy.revise' THEN
  keys:=ARRAY['operationId','recoveryEpoch','modeVersionId','policyId'];
  RETURN coalesce(jsonb_typeof(r)='object' AND r ?& keys AND r-keys='{}'::jsonb
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE
   AND crest_private.original_operation_uuid(r->'modeVersionId') IS TRUE
   AND crest_private.original_operation_uuid(r->'policyId') IS TRUE,false);
 END IF;
$case$);
END $reference$;

CREATE FUNCTION crest_commands.lookup_dropoff_policy_revision(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE reference jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.custody.policy.revise'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_DROPOFF_REVISION_REFERENCE_REVIEW_REQUIRED'; END IF;
 reference:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.dropoff_policy_revision_original(requested_business,expected_actor,(reference->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 receipt:=saved->'receipt';
 IF saved->>'recoveryEpoch' IS DISTINCT FROM reference->>'recoveryEpoch'
  OR receipt->>'priorModeVersionId' IS DISTINCT FROM reference->>'modeVersionId'
  OR receipt->>'priorPolicyId' IS DISTINCT FROM reference->>'policyId'
 THEN RETURN jsonb_build_object('state','absent'); END IF;
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed','receipt',
  jsonb_build_object('schemaVersion',1,'commandType','operations.custody.policy.revise','businessId',requested_business,
   'actorId',expected_actor,'operationId',reference->'operationId','recoveryEpoch',reference->'recoveryEpoch',
   'subjectId',reference->'modeVersionId','sourceRecordId',receipt->'policy'->'id','sourceVersion',receipt->'sequence',
   'sourceAuditIds',jsonb_build_array(receipt->'modeAuditId',receipt->'policyAuditId'))));
END $lookup$;
ALTER FUNCTION crest_commands.lookup_dropoff_policy_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_dropoff_policy_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))/length(marker)<>1
  OR position('operations.custody.policy.save' in source)=0 OR position('operations.custody.policy.revise' in source)>0
 THEN RAISE EXCEPTION 'CREST_DROPOFF_REVISION_REFERENCE_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.custody.policy.revise' THEN
  RETURN crest_commands.lookup_dropoff_policy_revision($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;

RESET ROLE;
