-- Live disconnect composition. Existing append-only fences/results remain
-- authoritative; no new retained tables or changes to financial history.
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_calendar_oauth_owner;
RESET ROLE;
SET LOCAL ROLE crest_calendar_oauth_owner;
CREATE FUNCTION crest_commands.read_google_calendar_connection(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $connection$
DECLARE destination uuid; consent record; disconnect uuid; destinations bigint;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 SELECT count(*),min(d.id::text)::uuid INTO destinations,destination FROM crest.google_calendar_destinations d WHERE d.business_id=business;
 IF destinations=0 THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF destinations<>1 OR NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 SELECT c.generation,c.recovery_epoch,c.state INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR consent.recovery_epoch<>epoch THEN RETURN jsonb_build_object('state','review'); END IF;
 SELECT d.id INTO disconnect FROM crest.google_calendar_disconnects d
 WHERE (d.business_id,d.destination_id,d.recovery_epoch,d.disconnected_generation)=(business,destination,epoch,consent.generation);
 RETURN jsonb_build_object('state',consent.state,'destinationId',destination,'generation',consent.generation::text,'disconnectId',disconnect);
END $connection$;

-- The wrapper cannot exist before shared-budget migration 125. Its version
-- distinguishes committed budget admission from an older unbudgeted status.
CREATE FUNCTION crest_commands.budgeted_google_calendar_disconnect_status(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,disconnect uuid,request text DEFAULT 'read',revocation_attempt uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE result jsonb;
BEGIN
 result:=crest_commands.google_calendar_disconnect_status(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination,disconnect,request,revocation_attempt);
 IF result->>'state'='revocation_admitted' THEN RETURN result||jsonb_build_object('admissionVersion',1); END IF;
 RETURN result;
END $status$;

-- A sealed credential is available only to the server, for the exact current
-- disconnect's already committed, unexpired and unresolved revocation claim.
CREATE FUNCTION crest_commands.read_google_calendar_revocation_credential(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,disconnect uuid,revocation_attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $credential$
DECLARE fence record; retained record; configured record; active_key text; admission record;
BEGIN
 IF revocation_attempt IS NULL OR NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 SELECT d.prior_generation,d.drain_until INTO fence FROM crest.google_calendar_disconnects d
 WHERE (d.business_id,d.destination_id,d.id,d.recovery_epoch)=(business,destination,disconnect,epoch)
  AND d.disconnected_generation=(SELECT max(c.generation) FROM crest.google_calendar_consents c WHERE (c.business_id,c.destination_id)=(business,destination));
 IF NOT FOUND OR clock_timestamp()<fence.drain_until THEN RETURN NULL; END IF;
 SELECT v.deadline INTO admission FROM crest.google_calendar_revocation_events v
 WHERE (v.business_id,v.disconnect_id,v.attempt_id,v.phase)=(business,disconnect,revocation_attempt,'admitted')
  AND v.deadline>clock_timestamp()
  AND NOT EXISTS(SELECT FROM crest.google_calendar_revocation_events done WHERE (done.business_id,done.disconnect_id)=(business,disconnect) AND done.phase<>'admitted');
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key=configured.verifier_key_id THEN RETURN NULL; END IF;
 SELECT c.id,c.version,c.key_id,c.envelope INTO retained FROM crest_private.google_calendar_credentials c
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch,c.client_id,c.key_id)
  =(business,destination,fence.prior_generation,epoch,configured.client_id,active_key);
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('credentialId',retained.id,'version',retained.version::text,'keyId',retained.key_id,
  'envelope',retained.envelope,'generation',fence.prior_generation::text,'deadline',admission.deadline);
END $credential$;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_connection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_commands.budgeted_google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_commands.read_google_calendar_revocation_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_google_calendar_connection(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.budgeted_google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid),
 crest_commands.read_google_calendar_revocation_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid) TO crest_calendar_oauth;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_calendar_oauth_owner;
RESET ROLE;
