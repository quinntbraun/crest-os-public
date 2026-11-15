-- P20/BR21. Held initial explicit consent over the exact staged creation.
-- No automatic backfill, provider request, session grant, or runtime mount.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.google_calendar_initial_consent_reviews (
 business_id uuid NOT NULL,
 id uuid NOT NULL,
 destination_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 client_name boolean NOT NULL,
 service_label boolean NOT NULL,
 work_address boolean NOT NULL,
 payload_version integer NOT NULL CHECK(payload_version=1),
 reviewed_at timestamptz NOT NULL CHECK(isfinite(reviewed_at)),
 expires_at timestamptz NOT NULL CHECK(expires_at=reviewed_at+interval '10 minutes'),
 PRIMARY KEY(business_id,id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,credential_id) REFERENCES crest_private.google_calendar_credentials(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE INDEX calendar_initial_review_session ON crest_private.google_calendar_initial_consent_reviews(business_id,app_session_id,reviewed_at DESC);
ALTER TABLE crest_private.google_calendar_initial_consent_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_initial_consent_reviews FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_initial_consent_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.google_calendar_initial_consent_reviews
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest_private.google_calendar_initial_consent_reviews TO crest_calendar_oauth_owner;
CREATE POLICY calendar_initial_review_read ON crest_private.google_calendar_initial_consent_reviews FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid);
CREATE POLICY calendar_initial_review_append ON crest_private.google_calendar_initial_consent_reviews FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_initial_consent_append ON crest.google_calendar_consents FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND generation=1 AND state='active'
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid);
GRANT SELECT(id) ON crest.google_calendar_consents TO crest_calendar_oauth_owner;
GRANT SELECT(operation_id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
CREATE POLICY calendar_initial_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.consent.activate');
CREATE POLICY calendar_initial_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND command_type='calendar.consent.activate' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_initial_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND command_type='calendar.consent.activate' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND command_type='calendar.consent.activate' AND state='committed');
CREATE POLICY calendar_initial_audit_append ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_initial_consent_operation',true),'')::uuid
  AND entity_kind='google_calendar_connections' AND action='activate' AND origin='manual');

CREATE FUNCTION crest_private.lock_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid
) RETURNS TABLE(google_client text,google_owner text,provider_calendar text)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN; END IF;
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 -- Activation requires the proven original provider response and the same
 -- connection/session/epoch that staged its grant. No seed or later token.
 RETURN QUERY SELECT c.client_id,i.reviewed_google_owner,r.provider_calendar_id
 FROM crest_private.google_calendar_credentials c
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id,d.operation_id)=(c.business_id,c.destination_id,c.source_exchange)
 JOIN crest_private.google_calendar_creation_results r ON (r.business_id,r.attempt_id,r.provider_calendar_id)=(d.business_id,d.operation_id,d.provider_calendar_id)
 JOIN crest_private.google_calendar_creation_intents i ON (i.business_id,i.attempt_id)=(r.business_id,r.attempt_id)
 JOIN crest_private.google_calendar_credential_key k ON k.singleton AND k.key_id=c.key_id
 JOIN crest_private.google_calendar_oauth_client o ON o.singleton AND o.client_id=c.client_id AND o.verifier_key_id<>k.key_id
 WHERE (c.business_id,c.destination_id,c.id,c.recovery_epoch)=(business,destination,staged_grant,epoch)
  AND (i.app_session_id,i.actor_id,i.recovery_epoch,i.client_id)=(app_session,actor,epoch,c.client_id)
  AND c.connection_generation=1 AND c.version=1 AND r.outcome='created' AND i.confirmed_at<=r.recorded_at
  AND NOT EXISTS(SELECT FROM crest.google_calendar_consents consent WHERE (consent.business_id,consent.destination_id)=(business,destination))
 FOR SHARE OF k,o;
END $lock$;

CREATE FUNCTION crest_commands.prepare_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid,client_name boolean,service_label boolean,work_address boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $prepare$
DECLARE binding record; stamp timestamptz;
BEGIN
 SELECT * INTO binding FROM crest_private.lock_google_calendar_initial_consent(credential,app_session,actor,auth_issuer,subject,provider_session,
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

CREATE FUNCTION crest_commands.confirm_google_calendar_initial_consent(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,staged_grant uuid,review uuid,client_name boolean,service_label boolean,work_address boolean,
 reviewed_payload boolean,reviewed_sharing boolean,reviewed_notifications boolean
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE binding record; selected record; receipt jsonb; consent uuid;
BEGIN
 IF reviewed_payload IS DISTINCT FROM true OR reviewed_sharing IS DISTINCT FROM true OR reviewed_notifications IS DISTINCT FROM true
  OR review IS NULL OR client_name IS NULL OR service_label IS NULL OR work_address IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO binding FROM crest_private.lock_google_calendar_initial_consent(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination,staged_grant);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT v.* INTO selected FROM crest_private.google_calendar_initial_consent_reviews v
 WHERE (v.business_id,v.id,v.destination_id,v.credential_id,v.actor_id,v.app_session_id,v.recovery_epoch,v.client_id)
  =(business,review,destination,staged_grant,actor,app_session,epoch,binding.google_client)
  AND v.payload_version=1 AND (v.client_name,v.service_label,v.work_address)
   =(confirm_google_calendar_initial_consent.client_name,confirm_google_calendar_initial_consent.service_label,
    confirm_google_calendar_initial_consent.work_address)
  AND v.reviewed_at<=clock_timestamp() AND v.expires_at>clock_timestamp();
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_initial_consent_operation',review::text,true);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,review,actor,'calendar.consent.activate',1,epoch,encode(sha256(convert_to(jsonb_build_array(review,destination,staged_grant,
  selected.payload_version,selected.client_name,selected.service_label,selected.work_address,reviewed_payload,reviewed_sharing,reviewed_notifications)::text,
  'UTF8')),'hex'),actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,client_name,service_label,work_address,created_by,operation_id)
 VALUES(business,destination,1,epoch,'active',selected.client_name,selected.service_label,selected.work_address,actor,review) RETURNING id INTO consent;
 receipt:=jsonb_build_object('schemaVersion',1,'state','active','destinationId',destination,'consentId',consent,'generation','1',
  'payloadVersion',selected.payload_version,'disclosure',jsonb_build_object('clientName',selected.client_name,
   'serviceLabel',selected.service_label,'workAddress',selected.work_address));
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,review,actor,actor,'google_calendar_connections',destination,1,'activate',
  jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('state','staged'),'after',receipt||
   jsonb_build_object('sharingReviewed',true,'notificationsReviewed',true,'payloadReviewed',true)),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
 WHERE (o.business_id,o.operation_id)=(business,review);
 RETURN receipt;
END $confirm$;

CREATE FUNCTION crest_commands.lookup_google_calendar_initial_consent(
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
 IF NOT FOUND OR current_consent.generation<>1 OR current_consent.state<>'active'
  OR current_consent.id::text IS DISTINCT FROM result->>'consentId'
 THEN RETURN jsonb_build_object('state','changed'); END IF;
 RETURN result;
END $lookup$;

RESET ROLE;
ALTER FUNCTION crest_private.lock_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.prepare_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.confirm_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.lookup_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.prepare_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean),
 crest_commands.confirm_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean),
 crest_commands.lookup_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.prepare_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean),
 crest_commands.confirm_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,boolean,boolean,boolean,boolean,boolean,boolean),
 crest_commands.lookup_google_calendar_initial_consent(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid)
 TO crest_calendar_oauth;
