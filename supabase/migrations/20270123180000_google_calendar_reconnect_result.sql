-- Keep the original migration immutable. Qualify the staged result by a
-- distinct local name so PostgreSQL cannot confuse it with operations.result.
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_calendar_oauth_owner;
RESET ROLE;
SET LOCAL ROLE crest_calendar_oauth_owner;
CREATE OR REPLACE FUNCTION crest_commands.stage_google_calendar_verified_credential(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,attempt uuid,new_credential uuid,key text,envelope jsonb,identity_issuer text,identity_subject text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stage$
DECLARE staged_result jsonb; reviewed text; next_generation bigint; configured text;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 SELECT c.client_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_account_bindings b WHERE (b.business_id,b.destination_id,b.client_id,b.provider_issuer,b.provider_subject)=(business,destination,configured,identity_issuer,identity_subject)) THEN RETURN NULL; END IF;
 SELECT r.calendar_owner INTO reviewed FROM crest_private.google_calendar_destination_verifications v
 JOIN crest_private.google_calendar_destination_reviews r ON (r.business_id,r.id,r.destination_id)=(v.business_id,v.review_id,v.destination_id)
 WHERE (v.business_id,v.attempt_id,v.destination_id)=(business,attempt,destination);
 IF NOT FOUND THEN RETURN NULL; END IF;
 staged_result:=crest_commands.stage_google_calendar_credential(credential,app_session,actor,auth_issuer,subject,provider_session,provider_valid_until,business,epoch,destination,attempt,new_credential,key,envelope);
 IF staged_result IS NULL THEN RETURN NULL; END IF;
 next_generation:=(staged_result->>'generation')::bigint;
 PERFORM set_config('crest.calendar_reconnect_operation',attempt::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,attempt,actor,'calendar.connection.reconnect',1,epoch,encode(sha256(convert_to(jsonb_build_array(destination,attempt,new_credential,epoch,identity_issuer,identity_subject)::text,'UTF8')),'hex'),actor,'manual');
 INSERT INTO crest_private.google_calendar_reconnection_stagings(business_id,attempt_id,destination_id,credential_id,generation,recovery_epoch,actor_id,app_session_id,provider_issuer,provider_subject,reviewed_google_owner,staged_at)
 VALUES(business,attempt,destination,new_credential,next_generation,epoch,actor,app_session,identity_issuer,identity_subject,reviewed,clock_timestamp());
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,attempt,actor,actor,'google_calendar_connections',destination,next_generation,'reconnect_stage',jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('state','staged','credentialId',new_credential,'generation',next_generation::text,'providerIdentityVerified',true)),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'state','staged','destinationId',destination)||staged_result WHERE (o.business_id,o.operation_id)=(business,attempt);
 RETURN staged_result;
END $stage$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_calendar_oauth_owner;
RESET ROLE;
