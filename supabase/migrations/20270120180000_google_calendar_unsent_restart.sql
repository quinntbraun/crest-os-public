-- Preserve every reviewed creation intent. A fresh owner may explicitly
-- retire only an attempt with no admitted provider exchange or creation.
-- The coordinator owns this transaction; historical migrations stay intact.
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.google_calendar_creation_intents DROP CONSTRAINT google_calendar_creation_intents_pkey;
ALTER TABLE crest_private.google_calendar_creation_intents ADD PRIMARY KEY(business_id,attempt_id);
CREATE TABLE crest_private.google_calendar_creation_abandonments (
 business_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 operation_id uuid NOT NULL,
 abandoned_at timestamptz NOT NULL CHECK(isfinite(abandoned_at)),
 PRIMARY KEY(business_id,attempt_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest_private.google_calendar_creation_intents(business_id,attempt_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,operation_id) REFERENCES crest_private.operations(business_id,operation_id)
);
ALTER TABLE crest_private.google_calendar_creation_abandonments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_creation_abandonments FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_abandonment_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.google_calendar_creation_abandonments
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest_private.google_calendar_creation_abandonments TO crest_calendar_oauth_owner;
CREATE POLICY calendar_abandonment_read ON crest_private.google_calendar_creation_abandonments FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_abandonment_append ON crest_private.google_calendar_creation_abandonments FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_abandon_operation',true),'')::uuid);
CREATE POLICY calendar_abandon_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.abandon');
CREATE POLICY calendar_abandon_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_abandon_operation',true),'')::uuid
  AND command_type='calendar.connection.abandon' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_abandon_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.abandon')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.abandon');
CREATE POLICY calendar_abandon_audit ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_abandon_operation',true),'')::uuid
  AND entity_kind='google_calendar_authorizations' AND action='abandon_creation' AND origin='manual');
GRANT CREATE ON SCHEMA crest_commands TO crest_calendar_oauth_owner;
RESET ROLE;
SET LOCAL ROLE crest_calendar_oauth_owner;
CREATE FUNCTION crest_commands.abandon_google_calendar_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,attempt uuid,requested_operation uuid,confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $abandon$
DECLARE stamp timestamptz; fingerprint text; prior record; decision jsonb;
BEGIN
 IF attempt IS NULL OR requested_operation IS NULL OR confirmed IS DISTINCT FROM true THEN RETURN NULL; END IF;
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||business::text,0));
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 PERFORM set_config('crest.calendar_abandon_operation',requested_operation::text,true);
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(attempt,epoch)::text,'UTF8')),'hex');
 SELECT o.payload_hash,o.result INTO prior FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id,o.command_type)=(business,requested_operation,actor,'calendar.connection.abandon');
 IF FOUND THEN IF prior.payload_hash=fingerprint THEN RETURN prior.result; END IF; RETURN NULL; END IF;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_intents i WHERE (i.business_id,i.attempt_id)=(business,attempt))
  OR EXISTS(SELECT FROM crest_private.google_calendar_creation_abandonments a WHERE (a.business_id,a.attempt_id)=(business,attempt))
  OR EXISTS(SELECT FROM crest.google_calendar_destinations d WHERE d.business_id=business)
  OR EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e WHERE (e.business_id,e.attempt_id)=(business,attempt))
  OR EXISTS(SELECT FROM crest.google_calendar_request_admissions a WHERE (a.business_id,a.creation_attempt_id)=(business,attempt))
  OR EXISTS(SELECT FROM crest_private.google_calendar_creation_results r WHERE r.business_id=business)
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,requested_operation,actor,'calendar.connection.abandon',1,epoch,fingerprint,actor,'manual') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 UPDATE crest_private.google_calendar_oauth_attempts SET retired_at=stamp,verifier_envelope=NULL
 WHERE (business_id,id)=(business,attempt) AND retired_at IS NULL;
 INSERT INTO crest_private.google_calendar_creation_abandonments(business_id,attempt_id,actor_id,app_session_id,recovery_epoch,operation_id,abandoned_at)
 VALUES(business,attempt,actor,app_session,epoch,requested_operation,stamp);
 decision:=jsonb_build_object('schemaVersion',1,'state','abandoned','attemptId',attempt);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,requested_operation,actor,actor,'google_calendar_authorizations',attempt,1,'abandon_creation',
  jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('state','awaiting_authorization'),'after',decision),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=decision WHERE (o.business_id,o.operation_id)=(business,requested_operation);
 RETURN decision;
END $abandon$;
REVOKE ALL ON FUNCTION crest_commands.abandon_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.abandon_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,boolean) TO crest_calendar_oauth;

CREATE OR REPLACE FUNCTION crest_commands.confirm_google_calendar_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,reviewed_google_owner text,confirmed boolean
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE boundary record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL OR confirmed IS DISTINCT FROM true OR reviewed_google_owner IS NULL
  OR char_length(reviewed_google_owner)>254 OR reviewed_google_owner COLLATE "C" !~
   '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$' THEN RETURN false; END IF;
 IF EXISTS(SELECT FROM crest_private.google_calendar_creation_intents i WHERE i.business_id=business
  AND NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_abandonments a WHERE (a.business_id,a.attempt_id)=(i.business_id,i.attempt_id))) THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a
  WHERE (a.business_id,a.id,a.session_id,a.actor_id,a.recovery_epoch,a.connection_generation,a.client_id,a.verifier_key_id)
   =(business,attempt,app_session,actor,epoch,0,google_client,boundary.verifier_key)
   AND a.destination_id IS NULL AND a.retired_at IS NULL AND a.created_at<=stamp AND a.expires_at>stamp)
 THEN RETURN false; END IF;
 INSERT INTO crest_private.google_calendar_creation_intents(business_id,attempt_id,actor_id,app_session_id,recovery_epoch,
  client_id,reviewed_google_owner,confirmed_at)
 VALUES(business,attempt,actor,app_session,epoch,google_client,reviewed_google_owner,stamp)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $confirm$;

CREATE OR REPLACE FUNCTION crest_commands.admit_google_calendar_creation_exchange(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $exchange$
DECLARE boundary record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_intents i
  JOIN crest_private.google_calendar_oauth_attempts a ON (a.business_id,a.id)=(i.business_id,i.attempt_id)
  WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
   =(business,attempt,app_session,actor,epoch,google_client)
   AND NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_abandonments abandoned WHERE (abandoned.business_id,abandoned.attempt_id)=(i.business_id,i.attempt_id))
   AND a.connection_generation=0 AND a.destination_id IS NULL AND a.verifier_key_id=boundary.verifier_key
   AND a.consumed_at>=i.confirmed_at AND a.consumed_at<=stamp AND a.expires_at>stamp)
 THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR provider_valid_until<=stamp OR NOT EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a
  WHERE (a.business_id,a.id)=(business,attempt) AND a.expires_at>stamp) THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_code_exchanges(business_id,attempt_id,app_session_id,actor_id,recovery_epoch,
  client_id,generation,admitted_at,deadline)
 VALUES(business,attempt,app_session,actor,epoch,google_client,0,stamp,stamp+interval '30 seconds')
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',attempt,'deadline',stamp+interval '30 seconds');
END $exchange$;

CREATE OR REPLACE FUNCTION crest_commands.admit_google_calendar_code_exchange(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; stamp timestamptz; inserted uuid;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR attempt IS NULL THEN RETURN NULL; END IF;
 IF boundary.destination_id IS NULL OR NOT EXISTS(SELECT FROM crest_private.google_calendar_destination_reviews r
  WHERE (r.business_id,r.app_session_id,r.actor_id,r.recovery_epoch,r.generation,r.client_id,r.destination_id)
   =(business,app_session,actor,epoch,admit_google_calendar_code_exchange.generation,google_client,boundary.destination_id)
   AND r.reviewed_at<=clock_timestamp() AND r.expires_at>clock_timestamp())
 THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a
  WHERE (a.business_id,a.id,a.session_id,a.actor_id)=(business,attempt,app_session,actor)
   AND (a.recovery_epoch,a.connection_generation,a.issuer,a.client_id,a.callback_uri,a.verifier_key_id)
    =(epoch,generation,google_issuer,google_client,callback,boundary.verifier_key)
   AND a.destination_id IS NOT DISTINCT FROM boundary.destination_id
   AND a.consumed_at IS NOT NULL AND a.consumed_at<=stamp AND a.expires_at>stamp)
 THEN RETURN NULL; END IF;
 IF EXISTS(SELECT FROM crest.google_calendar_disconnects d
   WHERE (d.business_id,d.destination_id,d.disconnected_generation)=(business,boundary.destination_id,generation)
   AND NOT EXISTS(SELECT FROM crest.google_calendar_revocation_events v
    WHERE (v.business_id,v.disconnect_id,v.phase)=(business,d.id,'revoked')))
 THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR provider_valid_until<=stamp OR NOT EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a
  WHERE (a.business_id,a.id)=(business,attempt) AND a.expires_at>stamp) THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_code_exchanges(business_id,attempt_id,app_session_id,actor_id,recovery_epoch,client_id,
  generation,destination_id,admitted_at,deadline)
 VALUES(business,attempt,app_session,actor,epoch,google_client,generation,boundary.destination_id,stamp,stamp+interval '30 seconds')
 ON CONFLICT DO NOTHING RETURNING attempt_id INTO inserted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',inserted,'deadline',stamp+interval '30 seconds');
END $admit$;

CREATE OR REPLACE FUNCTION crest_commands.admit_google_calendar_secondary_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; retained record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL THEN RETURN NULL; END IF;
 SELECT i.correlation_marker,i.reviewed_google_owner,e.deadline INTO retained
 FROM crest_private.google_calendar_creation_intents i JOIN crest_private.google_calendar_code_exchanges e
  ON (e.business_id,e.attempt_id)=(i.business_id,i.attempt_id)
 WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
  =(business,attempt,app_session,actor,epoch,google_client) AND e.generation=0 AND e.destination_id IS NULL
  AND NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_abandonments abandoned WHERE (abandoned.business_id,abandoned.attempt_id)=(i.business_id,i.attempt_id));
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR retained.deadline<=stamp OR provider_valid_until<=stamp THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_request_admissions(business_id,creation_attempt_id,kind,admitted_at)
 VALUES(business,attempt,'create_secondary',stamp) ON CONFLICT(business_id,creation_attempt_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('correlationMarker',retained.correlation_marker,'reviewedGoogleOwner',retained.reviewed_google_owner);
END $admit$;

CREATE OR REPLACE FUNCTION crest_commands.read_google_calendar_setup_state(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $state$
DECLARE destination uuid; consent record; staged uuid; creation uuid;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||business::text,0));
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 SELECT d.id INTO destination FROM crest.google_calendar_destinations d WHERE d.business_id=business FOR SHARE;
 IF destination IS NULL THEN
  SELECT i.attempt_id INTO creation FROM crest_private.google_calendar_creation_intents i WHERE i.business_id=business
   AND NOT EXISTS(SELECT FROM crest_private.google_calendar_creation_abandonments a WHERE (a.business_id,a.attempt_id)=(i.business_id,i.attempt_id));
  IF creation IS NULL THEN RETURN jsonb_build_object('schemaVersion',1,'state','ready'); END IF;
  IF EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e WHERE (e.business_id,e.attempt_id)=(business,creation))
   OR EXISTS(SELECT FROM crest.google_calendar_request_admissions a WHERE (a.business_id,a.creation_attempt_id)=(business,creation))
   OR EXISTS(SELECT FROM crest_private.google_calendar_creation_results r WHERE r.business_id=business)
  THEN RETURN jsonb_build_object('schemaVersion',1,'state','review'); END IF;
  RETURN jsonb_build_object('schemaVersion',1,'state','authorization_pending','attemptId',creation);
 END IF;
 SELECT c.state,c.recovery_epoch INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF FOUND AND (consent.recovery_epoch<>epoch OR consent.state<>'active') THEN
  RETURN jsonb_build_object('schemaVersion',1,'state','review');
 END IF;
 SELECT c.id INTO staged FROM crest_private.google_calendar_credentials c
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id,d.operation_id)=(c.business_id,c.destination_id,c.source_exchange)
 JOIN crest_private.google_calendar_creation_results r ON (r.business_id,r.attempt_id,r.provider_calendar_id)=(d.business_id,d.operation_id,d.provider_calendar_id)
 JOIN crest_private.google_calendar_creation_intents i ON (i.business_id,i.attempt_id)=(r.business_id,r.attempt_id)
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id
 WHERE (c.business_id,c.destination_id,c.recovery_epoch,i.app_session_id,i.actor_id,i.recovery_epoch)
  =(business,destination,epoch,app_session,actor,epoch)
  AND c.connection_generation=1 AND r.outcome='created' AND (consent.state='active' OR c.version=1);
 IF staged IS NOT NULL THEN
  RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN consent.state='active' THEN 'active' ELSE 'staged' END,
   'destinationId',destination,'credentialId',staged,'recoveryEpoch',epoch);
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN consent.state='active' THEN 'active' ELSE 'review' END);
END $state$;
CREATE FUNCTION crest_commands.budgeted_google_calendar_creation_exchange(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $versioned$
DECLARE result jsonb;
BEGIN
 result:=crest_commands.admit_google_calendar_creation_exchange(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,google_issuer,google_client,callback,attempt);
 IF result IS NOT NULL THEN RETURN result||jsonb_build_object('admissionVersion',1); END IF;
 RETURN NULL;
END $versioned$;
REVOKE ALL ON FUNCTION crest_commands.budgeted_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.budgeted_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid) TO crest_calendar_oauth;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_calendar_oauth_owner;
RESET ROLE;
