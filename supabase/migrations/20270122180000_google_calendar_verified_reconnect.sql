-- A verified new grant may stage the next generation of the same saved
-- calendar. Activation requires a separate fresh, explicit sharing review.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.google_calendar_reconnection_stagings (
 business_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>1),
 recovery_epoch uuid NOT NULL,
 actor_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 provider_issuer text NOT NULL CHECK(provider_issuer='https://accounts.google.com'),
 provider_subject text NOT NULL CHECK(provider_subject COLLATE "C" ~ '^[!-~]{1,255}$'),
 reviewed_google_owner text NOT NULL CHECK(char_length(reviewed_google_owner)<=254 AND reviewed_google_owner COLLATE "C" ~ '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'),
 staged_at timestamptz NOT NULL CHECK(isfinite(staged_at)),
 PRIMARY KEY(business_id,attempt_id),
 UNIQUE(business_id,destination_id,generation),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest_private.google_calendar_code_exchanges(business_id,attempt_id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest_private.google_calendar_account_bindings(business_id,destination_id),
 FOREIGN KEY(business_id,credential_id) REFERENCES crest_private.google_calendar_credentials(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest_private.operations(business_id,operation_id)
);
ALTER TABLE crest_private.google_calendar_reconnection_stagings ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_reconnection_stagings FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_reconnection_staging_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.google_calendar_reconnection_stagings
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest_private.google_calendar_reconnection_stagings TO crest_calendar_oauth_owner;
CREATE POLICY calendar_reconnection_read ON crest_private.google_calendar_reconnection_stagings FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_reconnection_append ON crest_private.google_calendar_reconnection_stagings FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid
  AND attempt_id=nullif(current_setting('crest.calendar_reconnect_operation',true),'')::uuid);
CREATE POLICY calendar_reconnect_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.reconnect');
CREATE POLICY calendar_reconnect_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND created_by=actor_id AND operation_id=nullif(current_setting('crest.calendar_reconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.reconnect' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_reconnect_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.reconnect')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.reconnect');
CREATE POLICY calendar_reconnect_audit ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_reconnect_operation',true),'')::uuid AND entity_kind='google_calendar_connections' AND action='reconnect_stage' AND origin='manual');
CREATE POLICY calendar_reviewed_consent_append ON crest.google_calendar_consents FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND generation>1 AND state='active' AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.google_calendar_reconnection_stagings s WHERE (s.business_id,s.destination_id,s.generation,s.recovery_epoch,s.actor_id,s.app_session_id)
   =(google_calendar_consents.business_id,google_calendar_consents.destination_id,google_calendar_consents.generation,google_calendar_consents.recovery_epoch,google_calendar_consents.created_by,nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid)));
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_calendar_oauth_owner;
RESET ROLE;
SET LOCAL ROLE crest_calendar_oauth_owner;
CREATE FUNCTION crest_commands.read_google_calendar_reconnect_target(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,business uuid,epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $target$
DECLARE destination uuid; pinned record; current_consent record; configured text; remote text;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||business::text,0));
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 SELECT d.id,d.provider_calendar_id INTO destination,remote FROM crest.google_calendar_destinations d WHERE d.business_id=business;
 IF destination IS NULL OR NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 SELECT c.client_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT b.provider_issuer,b.provider_subject INTO pinned FROM crest_private.google_calendar_account_bindings b
 WHERE (b.business_id,b.destination_id,b.client_id)=(business,destination,configured);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT c.state,c.generation INTO current_consent FROM crest.google_calendar_consents c WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR current_consent.generation>=9223372036854775807 THEN RETURN NULL; END IF;
 IF EXISTS(SELECT FROM crest.google_calendar_disconnects d WHERE (d.business_id,d.destination_id,d.disconnected_generation)=(business,destination,current_consent.generation)
  AND NOT EXISTS(SELECT FROM crest.google_calendar_revocation_events v WHERE (v.business_id,v.disconnect_id,v.phase)=(business,d.id,'revoked')))
  OR EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e WHERE (e.business_id,e.recovery_epoch,e.generation)=(business,epoch,current_consent.generation))
 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('destinationId',destination,'providerCalendarId',remote,'generation',current_consent.generation::text,'state',current_consent.state,'issuer',pinned.provider_issuer,'subject',pinned.provider_subject,'clientId',configured);
END $target$;

-- Admission authorizes identity verification, not adoption of a new account.
CREATE OR REPLACE FUNCTION crest_private.refuse_unproved_google_calendar_reconnect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $reconnect$
BEGIN
 IF NEW.destination_id IS NOT NULL AND EXISTS(SELECT FROM crest_private.google_calendar_creation_results r
  JOIN crest.google_calendar_destinations d ON (d.business_id,d.provider_calendar_id)=(r.business_id,r.provider_calendar_id)
  WHERE r.outcome='created' AND (d.business_id,d.id)=(NEW.business_id,NEW.destination_id))
 AND NOT EXISTS(SELECT FROM crest_private.google_calendar_account_bindings b
  JOIN crest_private.google_calendar_destination_reviews r ON (r.business_id,r.destination_id,r.client_id)=(b.business_id,b.destination_id,b.client_id)
  WHERE (b.business_id,b.destination_id,b.client_id)=(NEW.business_id,NEW.destination_id,NEW.client_id)
   AND (r.app_session_id,r.actor_id,r.recovery_epoch,r.generation)=(NEW.app_session_id,NEW.actor_id,NEW.recovery_epoch,NEW.generation)
   AND r.reviewed_at<=NEW.admitted_at AND r.expires_at>NEW.admitted_at)
 THEN RETURN NULL; END IF;
 RETURN NEW;
END $reconnect$;
CREATE FUNCTION crest_commands.budgeted_google_calendar_code_exchange(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $exchange$
DECLARE result jsonb;
BEGIN
 result:=crest_commands.admit_google_calendar_code_exchange(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback,attempt);
 IF result IS NOT NULL THEN RETURN result||jsonb_build_object('admissionVersion',1); END IF; RETURN NULL;
END $exchange$;
CREATE FUNCTION crest_commands.stage_google_calendar_verified_credential(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,attempt uuid,new_credential uuid,key text,envelope jsonb,identity_issuer text,identity_subject text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stage$
DECLARE result jsonb; reviewed text; next_generation bigint; configured text;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 SELECT c.client_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_account_bindings b WHERE (b.business_id,b.destination_id,b.client_id,b.provider_issuer,b.provider_subject)=(business,destination,configured,identity_issuer,identity_subject)) THEN RETURN NULL; END IF;
 SELECT r.calendar_owner INTO reviewed FROM crest_private.google_calendar_destination_verifications v
 JOIN crest_private.google_calendar_destination_reviews r ON (r.business_id,r.id,r.destination_id)=(v.business_id,v.review_id,v.destination_id)
 WHERE (v.business_id,v.attempt_id,v.destination_id)=(business,attempt,destination);
 IF NOT FOUND THEN RETURN NULL; END IF;
 result:=crest_commands.stage_google_calendar_credential(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination,attempt,new_credential,key,envelope);
 IF result IS NULL THEN RETURN NULL; END IF;
 next_generation:=(result->>'generation')::bigint;
 PERFORM set_config('crest.calendar_reconnect_operation',attempt::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,attempt,actor,'calendar.connection.reconnect',1,epoch,encode(sha256(convert_to(jsonb_build_array(destination,attempt,new_credential,epoch,identity_issuer,identity_subject)::text,'UTF8')),'hex'),actor,'manual');
 INSERT INTO crest_private.google_calendar_reconnection_stagings(business_id,attempt_id,destination_id,credential_id,generation,recovery_epoch,actor_id,app_session_id,provider_issuer,provider_subject,reviewed_google_owner,staged_at)
 VALUES(business,attempt,destination,new_credential,next_generation,epoch,actor,app_session,identity_issuer,identity_subject,reviewed,clock_timestamp());
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,attempt,actor,actor,'google_calendar_connections',destination,next_generation,'reconnect_stage',jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('state','staged','credentialId',new_credential,'generation',next_generation::text,'providerIdentityVerified',true)),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'state','staged','destinationId',destination)||result WHERE (o.business_id,o.operation_id)=(business,attempt);
 RETURN result;
END $stage$;

CREATE FUNCTION crest_private.lock_google_calendar_reviewed_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid
) RETURNS TABLE(google_client text,google_owner text,provider_calendar text,activation_generation bigint)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination) THEN RETURN; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 RETURN QUERY SELECT original.google_client,original.google_owner,original.provider_calendar,1::bigint
 FROM crest_private.lock_google_calendar_initial_consent(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination,staged_grant) original
 JOIN crest_private.google_calendar_account_bindings b ON (b.business_id,b.destination_id,b.credential_id,b.client_id)=(business,destination,staged_grant,original.google_client);
 IF FOUND THEN RETURN; END IF;
 RETURN QUERY SELECT c.client_id,s.reviewed_google_owner,d.provider_calendar_id,c.connection_generation
 FROM crest_private.google_calendar_reconnection_stagings s
 JOIN crest_private.google_calendar_credentials c ON (c.business_id,c.destination_id,c.id,c.source_exchange)=(s.business_id,s.destination_id,s.credential_id,s.attempt_id)
 JOIN crest_private.google_calendar_account_bindings b ON (b.business_id,b.destination_id,b.provider_issuer,b.provider_subject,b.client_id)=(s.business_id,s.destination_id,s.provider_issuer,s.provider_subject,c.client_id)
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id)=(c.business_id,c.destination_id)
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id AND o.verifier_key_id<>k.key_id
 WHERE (s.business_id,s.destination_id,s.credential_id,s.actor_id,s.app_session_id,s.recovery_epoch)=(business,destination,staged_grant,actor,app_session,epoch)
  AND c.version=1 AND c.recovery_epoch=epoch AND c.connection_generation=s.generation
  AND c.connection_generation=1+(SELECT coalesce(max(consent.generation),0) FROM crest.google_calendar_consents consent WHERE (consent.business_id,consent.destination_id)=(business,destination))
 FOR SHARE OF k,o;
END $lock$;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_reconnect_target(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.budgeted_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.stage_google_calendar_verified_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_reconnect_target(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.budgeted_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.stage_google_calendar_verified_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb,text,text) TO crest_calendar_oauth;

CREATE FUNCTION crest_commands.prepare_google_calendar_reviewed_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid,client_name boolean,service_label boolean,work_address boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $prepare$
DECLARE binding record; stamp timestamptz;
BEGIN
 SELECT * INTO binding FROM crest_private.lock_google_calendar_reviewed_consent(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination,staged_grant);
 IF NOT FOUND OR review IS NULL OR client_name IS NULL OR service_label IS NULL OR work_address IS NULL THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 IF (SELECT count(*) FROM crest_private.google_calendar_initial_consent_reviews v
  WHERE (v.business_id,v.app_session_id)=(business,app_session) AND v.reviewed_at>stamp-interval '10 minutes')>=20
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_initial_consent_reviews(business_id,id,destination_id,credential_id,actor_id,app_session_id,
  recovery_epoch,client_id,client_name,service_label,work_address,payload_version,reviewed_at,expires_at)
 VALUES(business,review,destination,staged_grant,actor,app_session,epoch,binding.google_client,client_name,service_label,work_address,1,stamp,
  stamp+interval '10 minutes') ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('reviewId',review,'destinationId',destination,'providerCalendarId',binding.provider_calendar,
  'googleOwner',binding.google_owner,'credentialId',staged_grant,'payloadVersion',1,'expiresAt',stamp+interval '10 minutes',
  'disclosure',jsonb_build_object('clientName',client_name,'serviceLabel',service_label,'workAddress',work_address));
END $prepare$;

CREATE FUNCTION crest_commands.confirm_google_calendar_reviewed_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid,client_name boolean,service_label boolean,work_address boolean,
 reviewed_payload boolean,reviewed_sharing boolean,reviewed_notifications boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE binding record; selected record; receipt jsonb; consent uuid;
BEGIN
 IF reviewed_payload IS DISTINCT FROM true OR reviewed_sharing IS DISTINCT FROM true OR reviewed_notifications IS DISTINCT FROM true
  OR review IS NULL OR client_name IS NULL OR service_label IS NULL OR work_address IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO binding FROM crest_private.lock_google_calendar_reviewed_consent(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination,staged_grant);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT v.* INTO selected FROM crest_private.google_calendar_initial_consent_reviews v
 WHERE (v.business_id,v.id,v.destination_id,v.credential_id,v.actor_id,v.app_session_id,v.recovery_epoch,v.client_id)
  =(business,review,destination,staged_grant,actor,app_session,epoch,binding.google_client)
  AND v.payload_version=1 AND (v.client_name,v.service_label,v.work_address)
   =(confirm_google_calendar_reviewed_consent.client_name,confirm_google_calendar_reviewed_consent.service_label,
    confirm_google_calendar_reviewed_consent.work_address)
  AND v.reviewed_at<=clock_timestamp() AND v.expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_initial_consent_operation',review::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,review,actor,'calendar.consent.activate',1,epoch,encode(sha256(convert_to(jsonb_build_array(review,destination,staged_grant,
  selected.payload_version,selected.client_name,selected.service_label,selected.work_address,reviewed_payload,reviewed_sharing,reviewed_notifications)::text,
  'UTF8')),'hex'),actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,client_name,service_label,work_address,created_by,operation_id)
 VALUES(business,destination,binding.activation_generation,epoch,'active',selected.client_name,selected.service_label,selected.work_address,actor,review) RETURNING id INTO consent;
 receipt:=jsonb_build_object('schemaVersion',1,'state','active','destinationId',destination,'consentId',consent,'generation',binding.activation_generation::text,
  'payloadVersion',selected.payload_version,'disclosure',jsonb_build_object('clientName',selected.client_name,
   'serviceLabel',selected.service_label,'workAddress',selected.work_address));
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,review,actor,actor,'google_calendar_connections',destination,binding.activation_generation,'activate',
  jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('state','staged'),'after',receipt||
   jsonb_build_object('sharingReviewed',true,'notificationsReviewed',true,'payloadReviewed',true)),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
 WHERE (o.business_id,o.operation_id)=(business,review);
 RETURN receipt;
END $confirm$;

CREATE FUNCTION crest_commands.lookup_google_calendar_reviewed_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE result jsonb; selected record; current_consent record;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 SELECT v.id INTO selected FROM crest_private.google_calendar_initial_consent_reviews v
 WHERE (v.business_id,v.id,v.destination_id,v.credential_id,v.actor_id,v.app_session_id,v.recovery_epoch)
  =(business,review,destination,staged_grant,actor,app_session,epoch);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT o.result INTO result FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id,o.recovery_epoch)=(business,review,actor,epoch)
  AND o.command_type='calendar.consent.activate' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT c.id,c.generation,c.state INTO current_consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR current_consent.generation::text IS DISTINCT FROM result->>'generation' OR current_consent.state<>'active'
  OR current_consent.id::text IS DISTINCT FROM result->>'consentId'
 THEN RETURN jsonb_build_object('state','changed'); END IF;
 RETURN result;
END $lookup$;

CREATE OR REPLACE FUNCTION crest_commands.read_google_calendar_setup_state(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $state$
DECLARE destination uuid; consent record; staged uuid; creation uuid; staged_generation bigint;
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
 SELECT c.state,c.recovery_epoch,c.generation INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;

 SELECT c.id,c.connection_generation INTO staged,staged_generation FROM crest_private.google_calendar_reconnection_stagings s
 JOIN crest_private.google_calendar_credentials c ON (c.business_id,c.id,c.destination_id,c.source_exchange)=(s.business_id,s.credential_id,s.destination_id,s.attempt_id)
 JOIN crest_private.google_calendar_account_bindings b ON (b.business_id,b.destination_id,b.client_id,b.provider_issuer,b.provider_subject)=(s.business_id,s.destination_id,c.client_id,s.provider_issuer,s.provider_subject)
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id AND o.verifier_key_id<>k.key_id
 WHERE (s.business_id,s.destination_id,s.actor_id,s.app_session_id,s.recovery_epoch,c.recovery_epoch)=(business,destination,actor,app_session,epoch,epoch)
  AND ((c.connection_generation=consent.generation+1 AND c.version=1) OR (c.connection_generation=consent.generation AND consent.state='active' AND consent.recovery_epoch=epoch))
 ORDER BY c.connection_generation DESC LIMIT 1;
 IF staged IS NOT NULL THEN RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN staged_generation=consent.generation THEN 'active' ELSE 'staged' END,'destinationId',destination,'credentialId',staged,'recoveryEpoch',epoch); END IF;
 IF consent.generation IS NOT NULL AND (consent.recovery_epoch<>epoch OR consent.state<>'active') THEN
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
  AND coalesce(consent.generation,1)=1 AND c.connection_generation=1 AND r.outcome='created' AND (consent.state='active' OR c.version=1);
 IF staged IS NOT NULL THEN
  RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN consent.state='active' THEN 'active' ELSE 'staged' END,
   'destinationId',destination,'credentialId',staged,'recoveryEpoch',epoch);
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN consent.state='active' THEN 'active' ELSE 'review' END);
END $state$;
REVOKE ALL ON FUNCTION crest_commands.prepare_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean),
 crest_commands.confirm_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean),
 crest_commands.lookup_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.prepare_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean),
 crest_commands.confirm_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean),
 crest_commands.lookup_google_calendar_reviewed_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid) TO crest_calendar_oauth;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_calendar_oauth_owner;
RESET ROLE;
