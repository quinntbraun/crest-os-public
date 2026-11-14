-- P20/BR21. Read the owner's current setup under the existing authority fence.
-- Retained state contains no token, OAuth state, PKCE verifier or private key.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_google_calendar_setup_state(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $state$
DECLARE destination uuid; consent record; staged uuid; creation boolean;
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
  SELECT EXISTS(SELECT FROM crest_private.google_calendar_creation_intents i WHERE i.business_id=business) INTO creation;
  RETURN jsonb_build_object('schemaVersion',1,'state',CASE WHEN creation THEN 'review' ELSE 'ready' END);
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
RESET ROLE;
ALTER FUNCTION crest_commands.read_google_calendar_setup_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_setup_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_setup_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_calendar_oauth;
