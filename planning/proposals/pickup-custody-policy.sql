-- Held BR08 policy settings. Booking and policy saves share the existing
-- arrangement lock. Each new pickup job retains the selected policy forever.
RESET ROLE;
DO $review$ BEGIN
 IF EXISTS(SELECT FROM crest_private.pickup_custody_policies)
  OR EXISTS(SELECT FROM crest_private.pickup_custody_collections)
 THEN RAISE EXCEPTION 'CREST_PICKUP_POLICY_ADOPTION_REQUIRES_EMPTY_CANDIDATE'; END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;

ALTER TABLE crest_private.pickup_custody_policies
 DROP CONSTRAINT pickup_custody_policies_business_id_mode_version_id_key,
 ADD COLUMN sequence bigint NOT NULL CHECK(sequence>0),
 ADD COLUMN replaces_sequence bigint CHECK(replaces_sequence=sequence-1),
 ADD COLUMN reason text CHECK(reason IS NULL OR char_length(reason)<=1000 AND btrim(reason,E' \t\r\n')<>''),
 ADD COLUMN recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 ADD COLUMN created_by uuid NOT NULL,
 ADD UNIQUE(business_id,sequence),
 ADD FOREIGN KEY(business_id,replaces_sequence) REFERENCES crest_private.pickup_custody_policies(business_id,sequence),
 ADD FOREIGN KEY(business_id,id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 ADD CHECK((sequence=1)=(replaces_sequence IS NULL) AND (sequence=1 OR reason IS NOT NULL));

CREATE TABLE crest_private.pickup_job_policies(
 business_id uuid NOT NULL,
 job_id uuid NOT NULL,
 policy_id uuid NOT NULL,
 PRIMARY KEY(business_id,job_id),
 FOREIGN KEY(business_id,job_id) REFERENCES crest.jobs(business_id,id),
 FOREIGN KEY(business_id,policy_id) REFERENCES crest_private.pickup_custody_policies(business_id,id)
);
ALTER TABLE crest_private.pickup_job_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.pickup_job_policies FORCE ROW LEVEL SECURITY;
CREATE TRIGGER retain_pickup_job_policy BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.pickup_job_policies
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();
GRANT SELECT,INSERT ON crest_private.pickup_job_policies TO crest_booking_owner;
GRANT SELECT ON crest_private.pickup_job_policies TO crest_booking_integrity_owner;
CREATE POLICY pickup_job_policy_read ON crest_private.pickup_job_policies FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY pickup_job_policy_integrity ON crest_private.pickup_job_policies FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY pickup_job_policy_append ON crest_private.pickup_job_policies FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.jobs j WHERE j.business_id=pickup_job_policies.business_id AND j.id=pickup_job_policies.job_id
   AND j.fulfillment_mode='pickup_return' AND j.operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid));

CREATE POLICY pickup_policy_op_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(command_type='operations.pickup_custody.policy.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_policy_op_append ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(command_type='operations.pickup_custody.policy.save' AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_policy_op_commit ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(command_type='operations.pickup_custody.policy.save' AND state='pending' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid)
 WITH CHECK(command_type='operations.pickup_custody.policy.save' AND state='committed' AND result_schema_version=1
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY pickup_policy_op_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.pickup_custody.policy.save');
GRANT INSERT ON crest_private.pickup_custody_policies TO crest_booking_owner;
CREATE POLICY pickup_policy_append ON crest_private.pickup_custody_policies FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND id=nullif(current_setting('crest.operation_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=pickup_custody_policies.business_id
   AND o.operation_id=pickup_custody_policies.id AND o.actor_id=pickup_custody_policies.created_by
   AND o.command_type='operations.pickup_custody.policy.save' AND o.state='pending'));
CREATE POLICY pickup_policy_audit_append ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(entity_kind='pickup_custody_policies' AND action='create' AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_id=operation_id);
CREATE POLICY pickup_policy_audit_receipt ON crest_private.audit_events FOR SELECT TO crest_booking_owner
 USING(entity_kind='pickup_custody_policies' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY pickup_policy_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='pickup_custody_policies');

CREATE OR REPLACE FUNCTION crest_private.pickup_policy_for_job(requested_business uuid,requested_job uuid) RETURNS uuid
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $policy$
 SELECT policy_id FROM crest_private.pickup_job_policies WHERE business_id=requested_business AND job_id=requested_job
$policy$;

CREATE FUNCTION crest_private.pickup_policy_projection(p crest_private.pickup_custody_policies) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('id',p.id,'modeVersionId',p.mode_version_id,'sequence',p.sequence::text,
  'acknowledgementText',p.acknowledgement_text,'conditionPhotoRequired',p.condition_photo_required,'reason',p.reason,
  'recordedAt',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;

CREATE FUNCTION crest_private.pickup_policy_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; policy crest_private.pickup_custody_policies; prior crest_private.pickup_custody_policies;
 audit record; projected jsonb; expected jsonb; request jsonb;
BEGIN
 SELECT o.recovery_epoch,o.payload_hash,o.result INTO saved FROM crest_private.operations o WHERE o.business_id=business
  AND o.operation_id=operation AND o.actor_id=actor AND o.command_type='operations.pickup_custody.policy.save'
  AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT * INTO STRICT policy FROM crest_private.pickup_custody_policies
 WHERE business_id=business AND id=operation AND created_by=actor;
 SELECT * INTO prior FROM crest_private.pickup_custody_policies
 WHERE business_id=business AND sequence=policy.replaces_sequence;
 SELECT a.id,a.delta INTO STRICT audit FROM crest_private.audit_events a WHERE a.business_id=business AND a.actor_id=actor
  AND a.operation_id=operation AND a.entity_id=operation AND a.entity_kind='pickup_custody_policies'
  AND a.entity_version=policy.sequence AND a.action='create' AND a.origin='manual' AND a.import_row_id IS NULL;
 projected:=crest_private.pickup_policy_projection(policy);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.policy.save',
  'businessId',business,'actorId',actor,'operationId',operation,'recoveryEpoch',saved.recovery_epoch,
  'expectedSequence',(policy.sequence-1)::text,'body',projected-ARRAY['id','modeVersionId','sequence','recordedAt']);
 expected:=jsonb_build_object('schemaVersion',1,'policy',projected,'auditId',audit.id);
 IF audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',
   CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.pickup_policy_projection(prior) END,'after',projected)
  OR saved.result IS DISTINCT FROM expected
  OR saved.payload_hash IS DISTINCT FROM encode(sha256(convert_to(request::text,'UTF8')),'hex')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','committed','receipt',expected,'request',request);
END $original$;

CREATE FUNCTION crest_private.check_pickup_policy_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE row_data jsonb:=to_jsonb(NEW);
BEGIN
 IF crest_private.pickup_policy_original(NEW.business_id,coalesce(row_data->>'actor_id',row_data->>'created_by')::uuid,
    coalesce(row_data->>'operation_id',row_data->>'id')::uuid)->>'state' IS DISTINCT FROM 'committed'
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
 RETURN NULL;
END $check$;

CREATE FUNCTION crest_private.bind_pickup_booking_policy() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $bind$
DECLARE chosen uuid;
BEGIN
 -- book_job already takes this lock before checking the current mode.
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||NEW.business_id::text,0));
 SELECT id INTO STRICT chosen FROM crest_private.pickup_custody_policies
 WHERE business_id=NEW.business_id ORDER BY sequence DESC LIMIT 1;
 INSERT INTO crest_private.pickup_job_policies(business_id,job_id,policy_id) VALUES(NEW.business_id,NEW.id,chosen);
 RETURN NULL;
END $bind$;

CREATE FUNCTION crest_commands.save_pickup_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,expected_sequence bigint,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE authority jsonb; mode_id uuid; claim uuid; request jsonb; digest text; original jsonb; conflict text;
 prior crest_private.pickup_custody_policies; policy crest_private.pickup_custody_policies; projected jsonb; audit_id uuid;
BEGIN
 IF requested_operation IS NULL OR expected_sequence IS NULL OR expected_sequence<0 OR expected_sequence=9223372036854775807
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT body ?& ARRAY['acknowledgementText','conditionPhotoRequired','reason']
  OR body-ARRAY['acknowledgementText','conditionPhotoRequired','reason']<>'{}'::jsonb OR octet_length(body::text)>16384
  OR jsonb_typeof(body->'conditionPhotoRequired') IS DISTINCT FROM 'boolean'
  OR (body->'acknowledgementText'<>'null'::jsonb AND crest_private.booking_text_required(body->'acknowledgementText',2000) IS NOT TRUE)
  OR (body->'reason'='null'::jsonb AND expected_sequence>0
   OR body->'reason'<>'null'::jsonb AND crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.policy.save','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'expectedSequence',expected_sequence::text,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.pickup_custody.policy.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   original:=crest_private.pickup_policy_original(requested_business,expected_actor,requested_operation);
   IF original->'request' IS DISTINCT FROM request THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT id INTO mode_id FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF mode_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='arrangements'; END IF;
   SELECT * INTO prior FROM crest_private.pickup_custody_policies WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF coalesce(prior.sequence,0)<>expected_sequence THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='version'; END IF;
   IF prior.id IS NOT NULL AND ROW(prior.acknowledgement_text,prior.condition_photo_required)
    IS NOT DISTINCT FROM ROW(body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean)
   THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='unchanged'; END IF;
   INSERT INTO crest_private.pickup_custody_policies(id,business_id,mode_version_id,sequence,replaces_sequence,
    acknowledgement_text,condition_photo_required,reason,created_by)
   VALUES(requested_operation,requested_business,mode_id,expected_sequence+1,prior.sequence,
    body->>'acknowledgementText',(body->>'conditionPhotoRequired')::boolean,body->>'reason',expected_actor) RETURNING * INTO policy;
   projected:=crest_private.pickup_policy_projection(policy);
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'pickup_custody_policies',policy.id,policy.sequence,'create',
    jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior.id IS NULL THEN NULL ELSE crest_private.pickup_policy_projection(prior) END,
     'after',projected),'manual') RETURNING id INTO audit_id;
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,
    result=jsonb_build_object('schemaVersion',1,'policy',projected,'auditId',audit_id)
   WHERE business_id=requested_business AND operation_id=requested_operation;
   original:=crest_private.pickup_policy_original(requested_business,expected_actor,requested_operation);
   IF original->'request' IS DISTINCT FROM request THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN original-'request';
 EXCEPTION WHEN SQLSTATE 'P1969' THEN GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 END;
END $save$;

CREATE FUNCTION crest_commands.read_pickup_policy(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,before_sequence bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; policy crest_private.pickup_custody_policies; latest bigint; cursor_sequence bigint; verified jsonb; versions jsonb:='[]';
BEGIN
 IF before_sequence IS NOT NULL AND before_sequence<1
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id','',true);
 SELECT coalesce(max(sequence),0) INTO latest FROM crest_private.pickup_custody_policies WHERE business_id=requested_business;
 IF before_sequence>latest THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_INPUT_REQUIRED'; END IF;
 FOR policy IN SELECT * FROM crest_private.pickup_custody_policies WHERE business_id=requested_business
  AND sequence<=latest AND (before_sequence IS NULL OR sequence<before_sequence) ORDER BY sequence DESC LIMIT 20
 LOOP
  verified:=crest_private.pickup_policy_original(requested_business,policy.created_by,policy.id);
  IF verified->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_ORIGINAL_REQUIRED'; END IF;
  versions:=versions||jsonb_build_array(verified->'receipt'->'policy');cursor_sequence:=policy.sequence;
 END LOOP;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'currentSequence',latest::text,'versions',versions,
  'hasMore',coalesce(cursor_sequence>1,false));
END $read$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_booking_owner,crest_booking_integrity_owner;
ALTER FUNCTION crest_private.pickup_policy_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_pickup_policy_original() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.bind_pickup_booking_policy() OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.save_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb) OWNER TO crest_booking_owner;
ALTER FUNCTION crest_commands.read_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_booking_owner,crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.pickup_policy_projection(crest_private.pickup_custody_policies),
 crest_private.pickup_policy_original(uuid,uuid,uuid),crest_private.check_pickup_policy_original(),crest_private.bind_pickup_booking_policy(),
 crest_commands.save_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.read_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.pickup_policy_projection(crest_private.pickup_custody_policies) TO crest_booking_owner,crest_booking_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.pickup_policy_original(uuid,uuid,uuid) TO crest_booking_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.read_pickup_policy(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint) TO crest_web;
CREATE CONSTRAINT TRIGGER pickup_policy_row_original AFTER INSERT ON crest_private.pickup_custody_policies
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_pickup_policy_original();
CREATE CONSTRAINT TRIGGER pickup_policy_operation_original AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.pickup_custody.policy.save')
 EXECUTE FUNCTION crest_private.check_pickup_policy_original();
CREATE TRIGGER capture_pickup_booking_policy AFTER INSERT ON crest.jobs
 FOR EACH ROW WHEN(NEW.fulfillment_mode='pickup_return') EXECUTE FUNCTION crest_private.bind_pickup_booking_policy();

DO $booking$
DECLARE source text; marker constant text:=E'   IF EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job)';
 signature constant text:='crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('crest.fulfillment.modes/1:' in source)=0 OR position('pickup_policy' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_BOOKING_POLICY_REVIEW_REQUIRED'; END IF;
 EXECUTE replace(source,marker,$require$
   IF body->>'fulfillmentMode'='pickup_return' AND NOT EXISTS(
    SELECT FROM crest_private.pickup_custody_policies WHERE business_id=requested_business)
   THEN reason:='pickup_policy';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
$require$||marker);
END $booking$;

DO $reference$
DECLARE source text; marker constant text:=' kind:=v->>''commandType'';r:=v->''reference'';';
BEGIN
 source:=pg_get_functiondef('crest_private.original_operation_reference_valid(jsonb)'::regprocedure);
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.policy.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF kind='operations.pickup_custody.policy.save' THEN
  keys:=ARRAY['operationId','recoveryEpoch','expectedSequence'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT r ?& keys OR r-keys<>'{}'::jsonb
   OR jsonb_typeof(r->'expectedSequence') IS DISTINCT FROM 'string'
   OR (r->>'expectedSequence')!~'^(0|[1-9][0-9]{0,18})$' THEN RETURN false; END IF;
  RETURN coalesce((r->>'expectedSequence')::numeric<9223372036854775807
   AND crest_private.original_operation_uuid(r->'operationId') IS TRUE
   AND crest_private.original_operation_uuid(r->'recoveryEpoch') IS TRUE,false);
 END IF;
$case$);
END $reference$;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_pickup_policy_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE ref jsonb; saved jsonb; receipt jsonb;
BEGIN
 IF original->>'commandType' IS DISTINCT FROM 'operations.pickup_custody.policy.save'
  OR original->>'businessId' IS DISTINCT FROM requested_business::text
  OR crest_private.original_operation_reference_valid(original) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 ref:=original->'reference';
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 saved:=crest_private.pickup_policy_original(requested_business,expected_actor,(ref->>'operationId')::uuid);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved->>'state'='absent' THEN RETURN saved; END IF;
 IF saved->>'state' IS DISTINCT FROM 'committed'
  OR ref IS DISTINCT FROM (saved->'request')-ARRAY['schemaVersion','commandType','businessId','actorId','body']
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 receipt:=saved->'receipt';
 RETURN jsonb_build_object('schemaVersion',1,'original',original,'result',jsonb_build_object('state','committed',
  'receipt',jsonb_build_object('schemaVersion',1,'commandType','operations.pickup_custody.policy.save',
   'businessId',requested_business,'actorId',expected_actor,'operationId',ref->'operationId','recoveryEpoch',ref->'recoveryEpoch',
   'subjectId',requested_business,'sourceRecordId',receipt->'policy'->'id','sourceVersion',receipt->'policy'->'sequence',
   'sourceAuditIds',jsonb_build_array(receipt->'auditId'))));
END $lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
ALTER FUNCTION crest_commands.lookup_pickup_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_pickup_policy_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;

DO $route$
DECLARE source text; marker constant text:=E'BEGIN\n';
 signature constant text:='crest_commands.lookup_scheduling_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR position('operations.pickup_custody.collect' in source)=0 OR position('operations.pickup_custody.policy.save' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_POLICY_REFERENCE_REQUIRED'; END IF;
 EXECUTE replace(source,marker,marker||$case$
 IF original->>'commandType'='operations.pickup_custody.policy.save' THEN
  RETURN crest_commands.lookup_pickup_policy_original($1,$2,$3,$4,$5,$6,$7,$8,$9);
 END IF;
$case$);
END $route$;

-- The normal settings command shares the lock used above. Its dedicated
-- definer can see that a scoped policy exists without seeing its contents.
GRANT SELECT(business_id) ON crest_private.pickup_custody_policies TO crest_mode_owner;
CREATE POLICY pickup_policy_exists_for_mode ON crest_private.pickup_custody_policies FOR SELECT TO crest_mode_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
DO $modes$
DECLARE source text; marker constant text:='   IF expected_sequence>0 AND ROW(';
 handler constant text:='WHEN SQLSTATE ''P1002'' THEN RETURN jsonb_build_object(''state'',''conflict'',''reason'',''review'');END;';
 signature constant text:='crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb)';
BEGIN
 source:=pg_get_functiondef(to_regprocedure(signature));
 IF (length(source)-length(replace(source,marker,'')))<>length(marker)
  OR (length(source)-length(replace(source,handler,'')))<>length(handler)
  OR position('crest.fulfillment.modes/1:' in source)=0 OR position('pickup_policy' in source)>0
 THEN RAISE EXCEPTION 'CREST_PICKUP_MODE_POLICY_REVIEW_REQUIRED'; END IF;
 source:=replace(source,marker,$require$
   IF (body->>'pickupReturnEnabled')::boolean AND NOT EXISTS(
    SELECT FROM crest_private.pickup_custody_policies WHERE business_id=requested_business)
   THEN RAISE EXCEPTION USING ERRCODE='P1969',MESSAGE='CREST_PICKUP_POLICY_REQUIRED'; END IF;
$require$||marker);
 EXECUTE replace(source,handler,replace(handler,';END;',';
  WHEN SQLSTATE ''P1969'' THEN RETURN jsonb_build_object(''state'',''conflict'',''reason'',''pickup_policy'');END;'));
END $modes$;
