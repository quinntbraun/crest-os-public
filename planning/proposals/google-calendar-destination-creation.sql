-- P20/BR21 held, initial creation only. An unresolved insert remains blocked
-- across later OAuth attempts and recovery epochs. No blind retry or adoption.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.google_calendar_creation_intents (
 business_id uuid PRIMARY KEY REFERENCES crest.businesses(id),
 attempt_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 reviewed_google_owner text NOT NULL CHECK(char_length(reviewed_google_owner)<=254 AND reviewed_google_owner COLLATE "C" ~
  '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'),
 correlation_marker uuid NOT NULL DEFAULT gen_random_uuid(),
 confirmed_at timestamptz NOT NULL CHECK(isfinite(confirmed_at)),
 UNIQUE(business_id,attempt_id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE TABLE crest_private.google_calendar_creation_results (
 business_id uuid PRIMARY KEY,
 attempt_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 outcome text NOT NULL CHECK(outcome IN('created','review','uncertain')),
 provider_calendar_id text UNIQUE CHECK(provider_calendar_id COLLATE "C" ~
  '^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group[.]calendar[.]google[.]com$'),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest.google_calendar_request_admissions(business_id,creation_attempt_id),
 CHECK((outcome='created')=(provider_calendar_id IS NOT NULL))
);
ALTER TABLE crest.google_calendar_request_admissions ADD FOREIGN KEY(business_id,creation_attempt_id)
 REFERENCES crest_private.google_calendar_creation_intents(business_id,attempt_id);

DO $roles$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_creation_intents','google_calendar_creation_results'] LOOP
  EXECUTE format('ALTER TABLE crest_private.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest_private.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE TRIGGER calendar_creation_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
  EXECUTE format('GRANT SELECT,INSERT ON crest_private.%I TO crest_calendar_oauth_owner',relation);
  EXECUTE format('CREATE POLICY calendar_creation_read ON crest_private.%I FOR SELECT TO crest_calendar_oauth_owner
    USING(business_id=nullif(current_setting(''crest.calendar_oauth_business'',true),'''')::uuid)',relation);
  EXECUTE format('CREATE POLICY calendar_creation_append ON crest_private.%I FOR INSERT TO crest_calendar_oauth_owner
    WITH CHECK(business_id=nullif(current_setting(''crest.calendar_oauth_business'',true),'''')::uuid)',relation);
 END LOOP;
END $roles$;
GRANT SELECT(creation_attempt_id),INSERT(creation_attempt_id) ON crest.google_calendar_request_admissions TO crest_calendar_oauth_owner;
CREATE POLICY calendar_creation_admit ON crest.google_calendar_request_admissions FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND kind='create_secondary'
  AND creation_attempt_id IS NOT NULL AND lease_id IS NULL AND setup_attempt_id IS NULL);

GRANT INSERT(id,business_id,provider_calendar_id,created_by,operation_id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
CREATE POLICY calendar_creation_destination_insert ON crest.google_calendar_destinations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.google_calendar_creation_results r
   WHERE r.business_id=google_calendar_destinations.business_id AND r.outcome='created'
    AND r.provider_calendar_id=google_calendar_destinations.provider_calendar_id));
CREATE POLICY calendar_creation_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.create');
CREATE POLICY calendar_creation_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND command_type='calendar.connection.create' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_creation_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND command_type='calendar.connection.create' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND command_type='calendar.connection.create' AND state='committed');
CREATE POLICY calendar_creation_audit_append ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_creation_operation',true),'')::uuid
  AND entity_kind='google_calendar_connections' AND action='stage_creation' AND origin='manual');

-- A later OAuth grant may have access to the same calendar through sharing.
-- Until provider-subject proof is added, it cannot replace the original grant.
CREATE FUNCTION crest_private.refuse_unproved_google_calendar_reconnect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $reconnect$
BEGIN
 IF NEW.destination_id IS NOT NULL AND EXISTS(SELECT FROM crest_private.google_calendar_creation_results r
  JOIN crest.google_calendar_destinations d ON (d.business_id,d.provider_calendar_id)=(r.business_id,r.provider_calendar_id)
  WHERE r.outcome='created' AND (d.business_id,d.id)=(NEW.business_id,NEW.destination_id)) THEN RETURN NULL; END IF;
 RETURN NEW;
END $reconnect$;
CREATE TRIGGER calendar_creation_reconnect_fence BEFORE INSERT ON crest_private.google_calendar_code_exchanges
 FOR EACH ROW EXECUTE FUNCTION crest_private.refuse_unproved_google_calendar_reconnect();

-- Pin a reviewed Google owner in the same current Crest session that started
-- the still-live attempt. No external request is made by this command.
CREATE FUNCTION crest_commands.confirm_google_calendar_creation(
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

CREATE FUNCTION crest_commands.admit_google_calendar_creation_exchange(
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
   AND a.connection_generation=0 AND a.destination_id IS NULL AND a.verifier_key_id=boundary.verifier_key
   AND a.consumed_at>=i.confirmed_at AND a.consumed_at<=stamp AND a.expires_at>stamp)
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_code_exchanges(business_id,attempt_id,app_session_id,actor_id,recovery_epoch,
  client_id,generation,admitted_at,deadline)
 VALUES(business,attempt,app_session,actor,epoch,google_client,0,stamp,stamp+interval '30 seconds')
 ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',attempt,'deadline',stamp+interval '30 seconds');
END $exchange$;

CREATE FUNCTION crest_commands.admit_google_calendar_secondary_creation(
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
  =(business,attempt,app_session,actor,epoch,google_client) AND e.generation=0 AND e.destination_id IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR retained.deadline<=stamp OR provider_valid_until<=stamp THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_request_admissions(business_id,creation_attempt_id,kind,admitted_at)
 VALUES(business,attempt,'create_secondary',stamp) ON CONFLICT(business_id,creation_attempt_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('correlationMarker',retained.correlation_marker,'reviewedGoogleOwner',retained.reviewed_google_owner);
END $admit$;

-- Records only what the trusted provider adapter observed. The creation
-- response proves the caller's account email for this operation. It does not
-- identify a later grant or establish sharing/ACL state.
CREATE FUNCTION crest_commands.finish_google_calendar_secondary_creation(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,
 reported_outcome text,provider_id text,observed_owner text,observed_marker uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE boundary record; retained record; stamp timestamptz; outcome text;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL OR reported_outcome IS NULL
  OR reported_outcome NOT IN('created','review','uncertain') THEN RETURN false; END IF;
 SELECT i.reviewed_google_owner,i.correlation_marker,e.deadline,a.admitted_at INTO retained
 FROM crest_private.google_calendar_creation_intents i JOIN crest_private.google_calendar_code_exchanges e
  ON (e.business_id,e.attempt_id)=(i.business_id,i.attempt_id)
 JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.creation_attempt_id)=(i.business_id,i.attempt_id)
 WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
  =(business,attempt,app_session,actor,epoch,google_client) AND e.generation=0 AND e.destination_id IS NULL AND a.kind='create_secondary';
 IF NOT FOUND THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF stamp<retained.admitted_at OR (reported_outcome<>'uncertain' AND stamp>=retained.deadline) THEN RETURN false; END IF;
 outcome:=reported_outcome;
 IF outcome='created' AND (observed_owner IS DISTINCT FROM retained.reviewed_google_owner
  OR observed_marker IS DISTINCT FROM retained.correlation_marker OR provider_id IS NULL OR provider_id COLLATE "C" !~
   '^[A-Za-z0-9][A-Za-z0-9._+-]{0,254}@group[.]calendar[.]google[.]com$') THEN outcome:='review'; END IF;
 INSERT INTO crest_private.google_calendar_creation_results(business_id,attempt_id,recorded_at,outcome,provider_calendar_id)
 VALUES(business,attempt,stamp,outcome,CASE WHEN outcome='created' THEN provider_id END) ON CONFLICT DO NOTHING;
 RETURN FOUND AND outcome=reported_outcome;
END $finish$;

-- Called only from the original server callback while it still holds the
-- grant used for creation. The operation records redacted provenance and
-- atomically stages the destination and credential without activating consent.
CREATE FUNCTION crest_commands.promote_google_calendar_initial_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,google_issuer text,google_client text,callback text,attempt uuid,
 destination uuid,new_credential uuid,key text,envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $promote$
DECLARE boundary record; evidence record; active_key text; stamp timestamptz; receipt jsonb; fingerprint text;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,0,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NOT NULL OR destination IS NULL OR new_credential IS NULL
  OR destination='00000000-0000-0000-0000-000000000000' OR new_credential='00000000-0000-0000-0000-000000000000'
  OR destination=new_credential THEN RETURN NULL; END IF;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key IS DISTINCT FROM key OR active_key=boundary.verifier_key THEN RETURN NULL; END IF;
 SELECT r.provider_calendar_id,r.recorded_at,e.deadline INTO evidence
 FROM crest_private.google_calendar_creation_results r JOIN crest_private.google_calendar_creation_intents i
 ON (i.business_id,i.attempt_id)=(r.business_id,r.attempt_id)
 JOIN crest_private.google_calendar_code_exchanges e ON (e.business_id,e.attempt_id)=(r.business_id,r.attempt_id)
 WHERE (i.business_id,i.attempt_id,i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)
  =(business,attempt,app_session,actor,epoch,google_client) AND r.outcome='created'
  AND (e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id,e.generation)=(app_session,actor,epoch,google_client,0)
  AND e.destination_id IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF evidence.recorded_at>stamp OR evidence.deadline<=stamp OR
  crest_private.valid_google_calendar_credential(envelope,key,business,destination,1,epoch,google_client,new_credential,1) IS DISTINCT FROM true
 THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_creation_operation',attempt::text,true);
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(attempt,destination,new_credential,epoch)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,attempt,actor,'calendar.connection.create',1,epoch,fingerprint,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_destinations(id,business_id,provider_calendar_id,created_by,operation_id)
 VALUES(destination,business,evidence.provider_calendar_id,actor,attempt);
 INSERT INTO crest_private.google_calendar_credentials(id,business_id,destination_id,connection_generation,recovery_epoch,
  client_id,key_id,scope,envelope,version,source_exchange,created_at,updated_at)
 VALUES(new_credential,business,destination,1,epoch,google_client,key,
  'https://www.googleapis.com/auth/calendar.app.created',envelope,1,attempt,stamp,stamp);
 receipt:=jsonb_build_object('schemaVersion',1,'destinationId',destination,'credentialId',new_credential,'generation','1','version','1');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,attempt,actor,actor,'google_calendar_connections',destination,1,'stage_creation',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('destinationId',destination,'generation','1','state','staged')),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
 WHERE (o.business_id,o.operation_id)=(business,attempt);
 RETURN receipt;
END $promote$;

RESET ROLE;
ALTER FUNCTION crest_private.refuse_unproved_google_calendar_reconnect() OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.promote_google_calendar_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_private.refuse_unproved_google_calendar_reconnect(),
 crest_commands.promote_google_calendar_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.promote_google_calendar_initial_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,uuid,uuid,text,jsonb)
 TO crest_calendar_oauth;
ALTER FUNCTION crest_commands.confirm_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,boolean) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,text,text,uuid) OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION
 crest_commands.confirm_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,boolean),
 crest_commands.admit_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.admit_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.finish_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.confirm_google_calendar_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,boolean),
 crest_commands.admit_google_calendar_creation_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.admit_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid),
 crest_commands.finish_google_calendar_secondary_creation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,text,text,uuid,text,text,text,uuid) TO crest_calendar_oauth;
