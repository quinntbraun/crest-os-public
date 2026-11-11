-- P08/BR08 held command candidate. Apply after Drop-Off storage and photo storage
-- in a disposable synthetic workspace. No owner configuration writer or runtime
-- route is enabled by this proposal.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.custody_authorization_configs (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 mode_version_id uuid NOT NULL,
 acknowledgement_text text,
 condition_photo_required boolean NOT NULL,
 UNIQUE(business_id,id),UNIQUE(business_id,mode_version_id),
 FOREIGN KEY(business_id,mode_version_id) REFERENCES crest.fulfillment_mode_versions(business_id,id),
 CHECK (char_length(acknowledgement_text)<=2000),
 CHECK (btrim(acknowledgement_text,E' \t\n\r')<>'')
);
ALTER TABLE crest.custody_authorization_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.custody_authorization_configs FORCE ROW LEVEL SECURITY;
CREATE TRIGGER custody_config_retain BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.custody_authorization_configs
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.field_retain_source();

ALTER TABLE crest.custody_cases ADD COLUMN authorization_config_id uuid NOT NULL,
 ADD CONSTRAINT custody_case_config FOREIGN KEY(business_id,authorization_config_id)
 REFERENCES crest.custody_authorization_configs(business_id,id);
ALTER TABLE crest.custody_events ADD COLUMN acknowledgement_confirmed boolean CHECK(acknowledgement_confirmed IS TRUE OR acknowledgement_confirmed IS NULL);
ALTER TABLE crest.custody_events
 ALTER COLUMN missing_photo_reason DROP NOT NULL,
 ADD COLUMN condition_photo_id uuid,
 ADD CONSTRAINT custody_photo_or_reason CHECK ((condition_photo_id IS NULL) <> (missing_photo_reason IS NULL)),
 ADD CONSTRAINT custody_photo_once UNIQUE(business_id,condition_photo_id),
 ADD CONSTRAINT custody_photo_original FOREIGN KEY(business_id,condition_photo_id)
  REFERENCES crest.custody_photo_originals(business_id,photo_id);

GRANT USAGE ON TYPE crest.custody_authorization_configs,crest.custody_cases,crest.custody_events TO crest_booking_owner,crest_booking_integrity_owner;
GRANT SELECT ON crest.custody_authorization_configs,crest.custody_cases,crest.custody_events TO crest_booking_owner,crest_booking_integrity_owner;
GRANT INSERT ON crest.custody_cases,crest.custody_events TO crest_booking_owner;
GRANT UPDATE(state,version,current_event_id) ON crest.custody_cases TO crest_booking_owner;
GRANT INSERT(effective_at) ON crest_private.audit_events TO crest_booking_owner;
GRANT SELECT(effective_at) ON crest_private.audit_events TO crest_booking_integrity_owner;

CREATE POLICY custody_config_scope ON crest.custody_authorization_configs FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_case_scope ON crest.custody_cases FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_event_scope ON crest.custody_events FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY custody_case_insert ON crest.custody_cases FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND state='held' AND version=1);
CREATE POLICY custody_case_release ON crest.custody_cases FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND state='held')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND state='released' AND version=2);
CREATE POLICY custody_event_insert ON crest.custody_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE POLICY custody_operation_read ON crest_private.operations FOR SELECT TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.custody.save');
CREATE POLICY custody_operation_insert ON crest_private.operations FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type='operations.custody.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_operation_finish ON crest_private.operations FOR UPDATE TO crest_booking_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.save' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.custody.save' AND state='committed');
CREATE POLICY custody_audit_insert ON crest_private.audit_events FOR INSERT TO crest_booking_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='custody_cases' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY custody_case_integrity ON crest.custody_cases FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_event_integrity ON crest.custody_events FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_config_integrity ON crest.custody_authorization_configs FOR SELECT TO crest_booking_integrity_owner USING(true);
CREATE POLICY custody_operation_integrity ON crest_private.operations FOR SELECT TO crest_booking_integrity_owner
 USING(command_type='operations.custody.save');
CREATE POLICY custody_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_booking_integrity_owner
 USING(entity_kind='custody_cases');

CREATE OR REPLACE FUNCTION crest_private.dropoff_custody_snapshot(c crest.custody_cases,e crest.custody_events) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $snapshot$
 SELECT jsonb_build_object(
  'schemaVersion',1,'caseId',c.id,'jobId',c.job_id,'jobVehicleId',c.job_vehicle_id,'vehicleId',c.vehicle_id,
  'eventId',e.id,'version',e.version::text,'action',e.action,
  'effectiveAt',to_char(e.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'recordedAt',to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'person',e.person_snapshot,'location',e.location_snapshot,'notes',e.notes,'missingPhotoReason',e.missing_photo_reason,
  'authorizationConfigId',c.authorization_config_id,'acknowledgementConfirmed',e.acknowledgement_confirmed
 ) || CASE WHEN e.condition_photo_id IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('conditionPhotoId',e.condition_photo_id) END
$snapshot$;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_custody_snapshot(crest.custody_cases,crest.custody_events)
 TO crest_booking_owner,crest_booking_integrity_owner;
RESET ROLE;

-- Keep the existing exact audit verification when the protected write has
-- returned, including if another statement in the transaction changes context.
ALTER FUNCTION crest_private.check_dropoff_custody_audit() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_dropoff_custody_audit() SECURITY DEFINER;
ALTER FUNCTION crest_private.check_dropoff_custody_audit() SET row_security=on;
ALTER FUNCTION crest_private.check_dropoff_custody_head() OWNER TO crest_booking_integrity_owner;
ALTER FUNCTION crest_private.check_dropoff_custody_head() SECURITY DEFINER;
ALTER FUNCTION crest_private.check_dropoff_custody_head() SET row_security=on;

CREATE FUNCTION crest_private.check_dropoff_authorization() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE config crest.custody_authorization_configs; booked_mode uuid; booked_vehicle uuid; epoch uuid;
BEGIN
 SELECT a.* INTO config FROM crest.custody_cases c JOIN crest.custody_authorization_configs a
  ON a.business_id=c.business_id AND a.id=c.authorization_config_id
 WHERE c.business_id=NEW.business_id AND c.id=NEW.case_id;
 SELECT j.mode_version_id,c.job_vehicle_id INTO booked_mode,booked_vehicle FROM crest.custody_cases c
 JOIN crest.jobs j ON j.business_id=c.business_id AND j.id=c.job_id
 WHERE c.business_id=NEW.business_id AND c.id=NEW.case_id;
 IF config.id IS NULL OR (NEW.version=1 AND config.mode_version_id IS DISTINCT FROM booked_mode)
  OR (config.condition_photo_required AND NEW.condition_photo_id IS NULL)
  OR NEW.acknowledgement_confirmed IS DISTINCT FROM (CASE WHEN config.acknowledgement_text IS NULL THEN NULL::boolean ELSE true END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_AUTHORIZATION_REQUIRED';END IF;
 IF NEW.condition_photo_id IS NOT NULL THEN
  SELECT o.recovery_epoch INTO epoch FROM crest_private.operations o
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.created_by
    AND o.command_type='operations.custody.save';
  IF NOT crest_private.verified_dropoff_photo(NEW.business_id,NEW.condition_photo_id,booked_vehicle,
    NEW.case_id,NEW.version::integer,epoch) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_PHOTO_REQUIRED';
  END IF;
 END IF;
 RETURN NEW;
END $check$;
ALTER FUNCTION crest_private.check_dropoff_authorization() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_dropoff_authorization() FROM PUBLIC;
CREATE TRIGGER custody_event_authorization BEFORE INSERT ON crest.custody_events
 FOR EACH ROW EXECUTE FUNCTION crest_private.check_dropoff_authorization();

CREATE FUNCTION crest_commands.save_dropoff_handoff(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,request_schema integer,requested_job_vehicle uuid,requested_case uuid,
 expected_version integer,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE authority jsonb; request jsonb; digest text; claim uuid; saved record; booked crest.job_vehicles;
 job crest.jobs; current_case crest.custody_cases; prior crest.custody_events; event crest.custody_events;
 policy crest.custody_authorization_configs; config_id uuid; event_id uuid; acknowledgement boolean; before_row jsonb;
 receipt jsonb; conflict text; violated_constraint text; photo_id uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_job_vehicle IS NULL OR requested_case IS NULL OR requested_operation IS NULL
  OR expected_version IS NULL OR expected_version NOT IN(0,1)
  OR jsonb_typeof(body) IS DISTINCT FROM 'object'
  OR NOT(body ?& ARRAY['authorizationConfigId','effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed'])
  OR body-ARRAY['authorizationConfigId','effectiveAt','person','location','notes','missingPhotoReason','acknowledgementConfirmed','conditionPhotoId']<>'{}'::jsonb
  OR octet_length(body::text)>16384 OR crest_private.booking_uuid(body->'authorizationConfigId') IS NOT TRUE
  OR crest_private.valid_support_instant(body->'effectiveAt',clock_timestamp()) IS NOT TRUE
  OR body->'acknowledgementConfirmed' NOT IN('null'::jsonb,'true'::jsonb)
  OR (body->'notes'<>'null'::jsonb AND jsonb_typeof(body->'notes') IS DISTINCT FROM 'string')
  OR (CASE WHEN body ? 'conditionPhotoId' THEN
       crest_private.booking_uuid(body->'conditionPhotoId') IS TRUE AND body->'missingPhotoReason'='null'::jsonb
      ELSE jsonb_typeof(body->'missingPhotoReason')='string' END) IS NOT TRUE
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_INPUT_REQUIRED';END IF;
 config_id:=(body->>'authorizationConfigId')::uuid;
 photo_id:=(body->>'conditionPhotoId')::uuid;
 acknowledgement:=(body->>'acknowledgementConfirmed')::boolean;
 authority:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true),
  set_config('crest.operation_id',requested_operation::text,true);
 request:=jsonb_build_object('schemaVersion',1,'commandType','operations.custody.save','businessId',requested_business,
  'actorId',expected_actor,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobVehicleId',requested_job_vehicle,
  'caseId',requested_case,'expectedVersion',expected_version::text,'body',body);
 digest:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'operations.custody.save',1,expected_epoch,digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT o.recovery_epoch,o.payload_hash,o.state,o.result INTO saved FROM crest_private.operations o
   WHERE o.business_id=requested_business AND o.actor_id=expected_actor AND o.operation_id=requested_operation
    AND o.command_type='operations.custody.save' AND o.schema_version=1 AND o.result_schema_version=1;
   IF NOT FOUND OR saved.recovery_epoch<>expected_epoch OR saved.payload_hash<>digest OR saved.state<>'committed'
   THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   receipt:=saved.result;
  ELSE
   SELECT v.* INTO booked FROM crest.job_vehicles v WHERE v.business_id=requested_business AND v.id=requested_job_vehicle;
   SELECT j.* INTO job FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=booked.job_id FOR SHARE;
   IF job.id IS NULL OR job.fulfillment_mode<>'dropoff' OR job.operator_actor_id IS DISTINCT FROM expected_actor
    OR (expected_version=0 AND job.state<>'scheduled') OR (expected_version=1 AND job.state NOT IN('completed','cancelled'))
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='job';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.dropoff/1:'||requested_business::text||':'||requested_job_vehicle::text,0));
   SELECT c.* INTO current_case FROM crest.custody_cases c
    WHERE c.business_id=requested_business AND c.job_vehicle_id=requested_job_vehicle;
   IF (expected_version=0 AND current_case.id IS NOT NULL) OR
    (expected_version=1 AND (current_case.id IS DISTINCT FROM requested_case OR current_case.state<>'held'))
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='version';END IF;
   SELECT a.* INTO policy FROM crest.custody_authorization_configs a WHERE a.business_id=requested_business AND a.id=config_id
    AND ((expected_version=0 AND a.mode_version_id=job.mode_version_id) OR a.id=current_case.authorization_config_id);
   IF policy.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='policy';END IF;
   IF (photo_id IS NULL AND policy.condition_photo_required)
    OR (photo_id IS NOT NULL AND NOT crest_private.verified_dropoff_photo(requested_business,photo_id,
         booked.id,requested_case,expected_version+1,expected_epoch))
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='photo';END IF;
   IF acknowledgement IS DISTINCT FROM (CASE WHEN policy.acknowledgement_text IS NULL THEN NULL::boolean ELSE true END)
   THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='acknowledgement';END IF;

   event_id:=gen_random_uuid();
   IF expected_version=0 THEN
    INSERT INTO crest.custody_cases(id,business_id,job_id,job_vehicle_id,vehicle_id,mode,version,state,current_event_id,authorization_config_id)
    VALUES(requested_case,requested_business,job.id,booked.id,booked.vehicle_id,'dropoff',1,'held',event_id,config_id)
    RETURNING * INTO current_case;
   ELSE
    SELECT e.* INTO STRICT prior FROM crest.custody_events e WHERE e.business_id=requested_business AND e.id=current_case.current_event_id;
    before_row:=crest_private.dropoff_custody_snapshot(current_case,prior);
   END IF;
   INSERT INTO crest.custody_events(id,business_id,case_id,version,prior_version,action,effective_at,person_snapshot,location_snapshot,
    notes,missing_photo_reason,created_by,operation_id,acknowledgement_confirmed,condition_photo_id)
   VALUES(event_id,requested_business,requested_case,expected_version+1,nullif(expected_version,0),
    CASE expected_version WHEN 0 THEN 'received' ELSE 'released' END,(body->>'effectiveAt')::timestamptz,
    body->'person',body->'location',body->>'notes',body->>'missingPhotoReason',expected_actor,requested_operation,acknowledgement,photo_id)
   RETURNING * INTO event;
   IF expected_version=1 THEN
    UPDATE crest.custody_cases SET state='released',version=2,current_event_id=event.id
    WHERE business_id=requested_business AND id=requested_case AND version=1 RETURNING * INTO current_case;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1980',MESSAGE='version';END IF;
   END IF;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,effective_at,delta,origin)
   VALUES(requested_business,requested_operation,expected_actor,expected_actor,'custody_cases',requested_case,event.version,event.action,event.effective_at,
    jsonb_build_object('schemaVersion',1,'before',coalesce(before_row,'null'::jsonb),'after',crest_private.dropoff_custody_snapshot(current_case,event)),'manual');
   receipt:=jsonb_build_object('schemaVersion',1,'caseId',requested_case,'eventId',event.id,'version',event.version::text);
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
   WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN jsonb_build_object('state','committed','receipt',receipt);
 EXCEPTION WHEN SQLSTATE 'P1980' THEN
  GET STACKED DIAGNOSTICS conflict=MESSAGE_TEXT;
  RETURN jsonb_build_object('state','conflict','reason',conflict);
 WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS violated_constraint=CONSTRAINT_NAME;
  IF violated_constraint='custody_one_held_case_per_vehicle' THEN
   RETURN jsonb_build_object('state','conflict','reason','vehicle_held');
  ELSIF violated_constraint='custody_cases_pkey' THEN
   RETURN jsonb_build_object('state','conflict','reason','version');
  END IF;
  RAISE;
 END;
END $write$;
ALTER FUNCTION crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.save_dropoff_handoff(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer,jsonb) TO crest_web;

CREATE FUNCTION crest_private.dropoff_custody_original(business uuid,actor uuid,operation uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $original$
DECLARE saved record; event crest.custody_events; custody crest.custody_cases; prior crest.custody_events;
 audit_id uuid; before_row jsonb:='null'::jsonb; receipt jsonb;
BEGIN
 SELECT o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
 WHERE o.business_id=business AND o.actor_id=actor AND o.operation_id=operation AND o.command_type='operations.custody.save'
  AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT e.* INTO STRICT event FROM crest.custody_events e
 WHERE e.business_id=business AND e.operation_id=operation AND e.created_by=actor;
 SELECT c.* INTO STRICT custody FROM crest.custody_cases c WHERE c.business_id=business AND c.id=event.case_id;
 IF event.prior_version IS NOT NULL THEN
  SELECT e.* INTO STRICT prior FROM crest.custody_events e
  WHERE e.business_id=business AND e.case_id=event.case_id AND e.version=event.prior_version;
  before_row:=crest_private.dropoff_custody_snapshot(custody,prior);
 END IF;
 SELECT a.id INTO STRICT audit_id FROM crest_private.audit_events a
 WHERE a.business_id=business AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor
  AND a.entity_kind='custody_cases' AND a.entity_id=custody.id AND a.entity_version=event.version
  AND a.action=event.action AND a.effective_at=event.effective_at AND a.origin='manual' AND a.import_row_id IS NULL
  AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',crest_private.dropoff_custody_snapshot(custody,event));
 receipt:=jsonb_build_object('schemaVersion',1,'caseId',event.case_id,'eventId',event.id,'version',event.version::text);
 IF saved.result IS DISTINCT FROM receipt THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_ORIGINAL_REQUIRED';
 END IF;
 RETURN jsonb_build_object('recoveryEpoch',saved.recovery_epoch,'jobVehicleId',custody.job_vehicle_id,
  'receipt',receipt,'auditId',audit_id);
END $original$;
ALTER FUNCTION crest_private.dropoff_custody_original(uuid,uuid,uuid) OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.dropoff_custody_original(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.dropoff_custody_original(uuid,uuid,uuid) TO crest_booking_owner;

CREATE FUNCTION crest_commands.read_dropoff_handoff_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,
 expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 original_epoch uuid,requested_operation uuid,request_schema integer,requested_job_vehicle uuid,requested_case uuid,
 expected_version integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE original jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR original_epoch IS NULL OR requested_operation IS NULL
  OR requested_job_vehicle IS NULL OR requested_case IS NULL OR expected_version IS NULL OR expected_version NOT IN(0,1)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CUSTODY_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 original:=crest_private.dropoff_custody_original(requested_business,expected_actor,requested_operation);
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 IF original->>'recoveryEpoch' IS DISTINCT FROM original_epoch::text
  OR original->>'jobVehicleId' IS DISTINCT FROM requested_job_vehicle::text
  OR original->'receipt'->>'caseId' IS DISTINCT FROM requested_case::text
  OR original->'receipt'->>'version' IS DISTINCT FROM (expected_version+1)::text
 THEN RETURN jsonb_build_object('state','absent');END IF;
 RETURN jsonb_build_object('state','committed','receipt',original->'receipt','auditId',original->'auditId');
END $read$;
ALTER FUNCTION crest_commands.read_dropoff_handoff_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer)
 OWNER TO crest_booking_owner;
REVOKE ALL ON FUNCTION crest_commands.read_dropoff_handoff_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer)
 FROM PUBLIC,anon,authenticated,crest_worker,crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.read_dropoff_handoff_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,integer) TO crest_web;

CREATE FUNCTION crest_private.check_dropoff_custody_original() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF crest_private.dropoff_custody_original(NEW.business_id,NEW.actor_id,NEW.operation_id) IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CUSTODY_ORIGINAL_REQUIRED';END IF;
 RETURN NULL;
END $check$;
ALTER FUNCTION crest_private.check_dropoff_custody_original() OWNER TO crest_booking_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_dropoff_custody_original() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER custody_original_verified AFTER INSERT OR UPDATE ON crest_private.operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='operations.custody.save')
 EXECUTE FUNCTION crest_private.check_dropoff_custody_original();
