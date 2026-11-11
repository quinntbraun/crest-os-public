-- P08/BR08: the owner explicitly sets one immutable policy for a saved
-- Drop-Off-enabled arrangement. Its UUID is the original operation UUID.
SET LOCAL ROLE crest_schema_owner;
GRANT INSERT(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required) ON crest.custody_authorization_configs TO crest_booking_owner;
CREATE POLICY custody_policy_setup ON crest.custody_authorization_configs FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY custody_policy_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.custody.policy.save');
CREATE POLICY custody_policy_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.custody.policy.save' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_policy_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.policy.save' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.policy.save' AND state='committed');
CREATE POLICY custody_policy_audit_append ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND entity_kind='custody_authorization_configs' AND entity_id=operation_id AND entity_version=1 AND action='create'
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_policy_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.custody.policy.save');
CREATE POLICY custody_policy_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='custody_authorization_configs');
RESET ROLE;

CREATE FUNCTION crest_private.dropoff_policy_projection(v crest.custody_authorization_configs) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('id',v.id,'modeVersionId',v.mode_version_id,'acknowledgementText',v.acknowledgement_text,
  'conditionPhotoRequired',v.condition_photo_required)
$projection$;
REVOKE ALL ON FUNCTION crest_private.dropoff_policy_projection(crest.custody_authorization_configs) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_policy_projection(crest.custody_authorization_configs) TO crest_booking_owner,crest_booking_integrity_owner;

CREATE FUNCTION crest_private.dropoff_policy_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; policy crest.custody_authorization_configs; evidence uuid; receipt jsonb;
BEGIN
 SELECT o.recovery_epoch,o.result,o.payload_hash INTO saved FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.custody.policy.save'
  AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT c.* INTO STRICT policy FROM crest.custody_authorization_configs c WHERE c.business_id=business AND c.id=operation;
 receipt:=crest_private.dropoff_policy_projection(policy);
 IF saved.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'policy',receipt) OR saved.payload_hash IS DISTINCT FROM
  encode(sha256(convert_to(receipt::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
 SELECT a.id INTO STRICT evidence FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.actor_id=actor AND a.created_by=actor AND a.operation_id=operation
  AND a.entity_kind='custody_authorization_configs' AND a.entity_id=operation AND a.entity_version=1
  AND a.action='create' AND a.origin='manual' AND a.import_row_id IS NULL
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',null,'after',receipt);
 RETURN jsonb_build_object('recoveryEpoch',saved.recovery_epoch,'policy',receipt,'auditId',evidence);
END $original$;
ALTER FUNCTION crest_private.dropoff_policy_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_policy_original(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_policy_original(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_private.check_dropoff_policy_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE operation uuid; actor uuid;
BEGIN
 IF TG_TABLE_NAME='operations' THEN
  operation:=NEW.operation_id;actor:=NEW.actor_id;
 ELSE
  operation:=NEW.id;
  SELECT o.actor_id INTO actor FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=operation
   AND o.command_type='operations.custody.policy.save';
 END IF;
 IF crest_private.dropoff_policy_original(NEW.business_id,actor,operation) IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
 RETURN NULL;
END $check$;
ALTER FUNCTION crest_private.check_dropoff_policy_original() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_dropoff_policy_original() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER custody_policy_verified AFTER INSERT ON crest.custody_authorization_configs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_policy_original();
CREATE CONSTRAINT TRIGGER custody_policy_operation_verified AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.custody.policy.save')
 EXECUTE FUNCTION crest_private.check_dropoff_policy_original();

CREATE FUNCTION crest_commands.save_dropoff_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,requested_mode uuid,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE authority jsonb; claim uuid; stored jsonb; receipt jsonb; digest text; policy crest.custody_authorization_configs;
 conflict text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_mode IS NULL OR requested_operation IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR NOT(body ?& ARRAY['acknowledgementText','conditionPhotoRequired']) OR body-ARRAY['acknowledgementText','conditionPhotoRequired']<>'{}'::jsonb
  OR octet_length(body::text)>8192 OR jsonb_typeof(body->'conditionPhotoRequired') IS DISTINCT FROM 'boolean'
  OR (body->'acknowledgementText'<>'null'::jsonb AND crest_private.booking_text_required(body->'acknowledgementText',2000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_POLICY_INPUT_REQUIRED';END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 receipt:=jsonb_build_object('id',requested_operation,'modeVersionId',requested_mode,
  'acknowledgementText',body->'acknowledgementText','conditionPhotoRequired',body->'conditionPhotoRequired');
 digest:=encode(sha256(convert_to(receipt::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.custody.policy.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   stored:=crest_private.dropoff_policy_original(requested_business,expected_actor,requested_operation);
   IF stored->>'recoveryEpoch' IS DISTINCT FROM expected_epoch::text OR stored->'policy' IS DISTINCT FROM receipt
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM crest.fulfillment_mode_versions v WHERE v.business_id=requested_business AND v.id=requested_mode AND v.dropoff_enabled)
   THEN RAISE EXCEPTION USING ERRCODE='P1981',MESSAGE='mode';END IF;
   INSERT INTO crest.custody_authorization_configs(id,business_id,mode_version_id,acknowledgement_text,condition_photo_required)
   VALUES(requested_operation,requested_business,requested_mode,body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean)
   ON CONFLICT(business_id,mode_version_id) DO NOTHING RETURNING * INTO policy;
   IF policy.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1981',MESSAGE='configured';END IF;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'custody_authorization_configs',policy.id,1,'create',
    jsonb_build_object('schemaVersion',1,'before',null,'after',receipt),'manual');
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'policy',receipt)
   WHERE business_id=requested_business AND operation_id=requested_operation;
   stored:=crest_private.dropoff_policy_original(requested_business,expected_actor,requested_operation);
   IF stored IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_POLICY_ORIGINAL_REQUIRED';END IF;
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN jsonb_build_object('state','committed','policy',stored->'policy','auditId',stored->'auditId');
 EXCEPTION WHEN SQLSTATE 'P1981' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $save$;
ALTER FUNCTION crest_commands.save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) TO crest_web;

CREATE FUNCTION crest_commands.read_dropoff_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_mode uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; policy jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_mode IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_POLICY_INPUT_REQUIRED';END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
 SELECT crest_private.dropoff_policy_projection(c) INTO policy FROM crest.custody_authorization_configs c
 WHERE c.business_id=requested_business AND c.mode_version_id=requested_mode;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN coalesce(policy,jsonb_build_object('state','absent'));
END $read$;
ALTER FUNCTION crest_commands.read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_dropoff_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
