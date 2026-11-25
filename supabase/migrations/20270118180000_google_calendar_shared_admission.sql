-- Calendar shared provider budget and versioned refresh admission.
-- The coordinator owns the transaction. No retained row or financial rule changes.
RESET ROLE;
CREATE ROLE crest_calendar_budget_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_calendar_budget_owner;
GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_request_budget TO crest_calendar_budget_owner;
GRANT SELECT(admitted_at) ON crest.google_calendar_request_admissions TO crest_calendar_budget_owner;
GRANT SELECT(admitted_at) ON crest_private.google_calendar_code_exchanges TO crest_calendar_budget_owner;
GRANT SELECT(admitted_at) ON crest_private.google_calendar_refresh_claims TO crest_calendar_budget_owner;
GRANT SELECT(recorded_at,phase) ON crest.google_calendar_revocation_events TO crest_calendar_budget_owner;
CREATE POLICY calendar_shared_budget_lock ON crest_private.google_calendar_request_budget FOR ALL TO crest_calendar_budget_owner USING(singleton) WITH CHECK(singleton);
CREATE POLICY calendar_shared_budget_event_times ON crest.google_calendar_request_admissions FOR SELECT TO crest_calendar_budget_owner USING(true);
CREATE POLICY calendar_shared_budget_exchange_times ON crest_private.google_calendar_code_exchanges FOR SELECT TO crest_calendar_budget_owner USING(true);
CREATE POLICY calendar_shared_budget_refresh_times ON crest_private.google_calendar_refresh_claims FOR SELECT TO crest_calendar_budget_owner USING(true);
CREATE POLICY calendar_shared_budget_revocation_times ON crest.google_calendar_revocation_events FOR SELECT TO crest_calendar_budget_owner USING(true);
CREATE INDEX calendar_code_exchange_budget_time ON crest_private.google_calendar_code_exchanges(admitted_at);
CREATE INDEX calendar_refresh_budget_time ON crest_private.google_calendar_refresh_claims(admitted_at);
CREATE INDEX calendar_revocation_budget_time ON crest.google_calendar_revocation_events(recorded_at) WHERE phase='admitted';
GRANT CREATE ON SCHEMA crest_private TO crest_calendar_budget_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_calendar_dispatch_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_calendar_oauth_owner;
RESET ROLE;
SET LOCAL ROLE crest_calendar_dispatch_owner;
CREATE OR REPLACE FUNCTION crest_private.lock_google_calendar_request_budget() RETURNS timestamptz
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $budget$
DECLARE stamp timestamptz; minute_count bigint; day_count bigint;
BEGIN
 PERFORM singleton FROM crest_private.google_calendar_request_budget FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT count(*) FILTER(WHERE requested_at>stamp-interval '1 minute'),count(*) INTO minute_count,day_count
 FROM (
  SELECT admitted_at AS requested_at FROM crest.google_calendar_request_admissions WHERE admitted_at>stamp-interval '24 hours'
  UNION ALL SELECT admitted_at FROM crest_private.google_calendar_code_exchanges WHERE admitted_at>stamp-interval '24 hours'
  UNION ALL SELECT admitted_at FROM crest_private.google_calendar_refresh_claims WHERE admitted_at>stamp-interval '24 hours'
  UNION ALL SELECT recorded_at FROM crest.google_calendar_revocation_events WHERE phase='admitted' AND recorded_at>stamp-interval '24 hours'
 ) requests;
 IF minute_count>=60 OR day_count>=5000 THEN RETURN NULL; END IF;
 RETURN stamp;
END $budget$;
RESET ROLE;
ALTER FUNCTION crest_private.lock_google_calendar_request_budget() OWNER TO crest_calendar_budget_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_request_budget() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lock_google_calendar_request_budget() TO crest_calendar_dispatch_owner,crest_calendar_oauth_owner;
SET LOCAL ROLE crest_calendar_dispatch_owner;
CREATE OR REPLACE FUNCTION crest_commands.claim_google_calendar_refresh(
 business uuid,destination uuid,epoch uuid,generation bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
DECLARE current_row record; prior record; configured record; active_key text; stamp timestamptz; claim uuid;
BEGIN
 IF NOT crest_private.lock_google_calendar_credential(business,destination,epoch,generation) THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key=configured.verifier_key_id THEN RETURN NULL; END IF;
 SELECT c.id,c.version,c.key_id,c.envelope INTO current_row FROM crest_private.google_calendar_credentials c
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch,c.client_id,c.key_id)
  =(business,destination,generation,epoch,configured.client_id,active_key) FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT a.deadline,r.outcome INTO prior FROM crest_private.google_calendar_refresh_claims a
 LEFT JOIN crest_private.google_calendar_refresh_results r ON (r.business_id,r.claim_id)=(a.business_id,a.id)
 WHERE (a.business_id,a.credential_id,a.credential_version)=(business,current_row.id,current_row.version);
 IF FOUND THEN RETURN jsonb_build_object('state',CASE WHEN prior.outcome='reconnect' THEN 'reconnect'
  WHEN prior.outcome IS NOT NULL OR prior.deadline<=stamp THEN 'uncertain' ELSE 'busy' END); END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL THEN RETURN jsonb_build_object('state','delayed'); END IF;
 INSERT INTO crest_private.google_calendar_refresh_claims(business_id,credential_id,credential_version,worker_principal,admitted_at,deadline)
 VALUES(business,current_row.id,current_row.version,session_user,stamp,stamp+interval '30 seconds') RETURNING id INTO claim;
 RETURN jsonb_build_object('state','claimed','claimId',claim,'deadline',stamp+interval '30 seconds',
  'credentialId',current_row.id,'version',current_row.version::text,'keyId',current_row.key_id,'envelope',current_row.envelope);
END $claim$;
CREATE FUNCTION crest_commands.claim_budgeted_google_calendar_refresh(business uuid,destination uuid,epoch uuid,generation bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $versioned$
DECLARE result jsonb;
BEGIN
 result:=crest_commands.claim_google_calendar_refresh(business,destination,epoch,generation);
 IF result->>'state'='claimed' THEN RETURN result||jsonb_build_object('admissionVersion',1); END IF;
 RETURN result;
END $versioned$;
REVOKE ALL ON FUNCTION crest_commands.claim_budgeted_google_calendar_refresh(uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.claim_budgeted_google_calendar_refresh(uuid,uuid,uuid,bigint) TO crest_calendar_dispatch;
RESET ROLE;
SET LOCAL ROLE crest_calendar_oauth_owner;
CREATE OR REPLACE FUNCTION crest_commands.google_calendar_disconnect_status(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,disconnect uuid,request text DEFAULT 'read',revocation_attempt uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE fence record; admitted record; recorded text; stamp timestamptz; unresolved bigint; status text;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) OR request IS NULL OR request NOT IN('read','admit','revoked','uncertain')
  OR ((request='read')<>(revocation_attempt IS NULL)) THEN RETURN NULL; END IF;
 SELECT d.prior_generation,d.fenced_at,d.drain_until INTO fence FROM crest.google_calendar_disconnects d
 WHERE (d.business_id,d.destination_id,d.id,d.recovery_epoch)=(business,destination,disconnect,epoch)
  AND d.disconnected_generation=(SELECT max(c.generation) FROM crest.google_calendar_consents c
   WHERE (c.business_id,c.destination_id)=(business,destination));
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT v.attempt_id,v.deadline INTO admitted FROM crest.google_calendar_revocation_events v
 WHERE (v.business_id,v.disconnect_id,v.phase)=(business,disconnect,'admitted');
 SELECT v.phase INTO recorded FROM crest.google_calendar_revocation_events v
 WHERE (v.business_id,v.disconnect_id)=(business,disconnect) AND v.phase<>'admitted';
 IF request='admit' AND stamp>=fence.drain_until AND admitted.attempt_id IS NULL THEN
  stamp:=crest_private.lock_google_calendar_request_budget();
  IF stamp IS NULL THEN RETURN jsonb_build_object('state','delayed','disconnectId',disconnect); END IF;
  INSERT INTO crest.google_calendar_revocation_events(business_id,disconnect_id,attempt_id,phase,recorded_at,deadline,actor_id)
  VALUES(business,disconnect,revocation_attempt,'admitted',stamp,stamp+interval '30 seconds',actor);
  RETURN jsonb_build_object('state','revocation_admitted','disconnectId',disconnect,'attemptId',revocation_attempt,
   'deadline',stamp+interval '30 seconds');
 ELSIF request IN('revoked','uncertain') THEN
  IF admitted.attempt_id IS DISTINCT FROM revocation_attempt OR (recorded IS NOT NULL AND recorded<>request)
   OR (recorded IS NULL AND request='revoked' AND admitted.deadline<=stamp) THEN RETURN NULL; END IF;
  IF recorded IS NULL THEN
   INSERT INTO crest.google_calendar_revocation_events(business_id,disconnect_id,attempt_id,phase,recorded_at,actor_id)
   VALUES(business,disconnect,revocation_attempt,request,stamp,actor);
   recorded:=request;
  END IF;
 END IF;
 SELECT count(*) INTO unresolved FROM crest.google_calendar_outbox o
 WHERE (o.business_id,o.destination_id,o.recovery_epoch)=(business,destination,epoch) AND o.connection_generation<=fence.prior_generation
  AND EXISTS(SELECT FROM crest.google_calendar_dispatch_leases l
   JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id)=(l.business_id,l.id) AND a.kind IN('insert','update','delete')
   LEFT JOIN crest.google_calendar_dispatch_results r ON (r.business_id,r.lease_id)=(l.business_id,l.id)
   WHERE (l.business_id,l.outbox_id)=(o.business_id,o.id) AND (r.id IS NULL OR r.outcome IN('uncertain','review','reconnect'))
    AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_leases newer
     JOIN crest.google_calendar_dispatch_results done ON (done.business_id,done.lease_id)=(newer.business_id,newer.id)
     WHERE (newer.business_id,newer.outbox_id)=(o.business_id,o.id) AND newer.attempt_no>l.attempt_no
      AND done.outcome IN('published','removed','no_effect')));
 status:=CASE WHEN recorded='revoked' THEN 'disconnected' WHEN recorded='uncertain' OR admitted.deadline<=stamp THEN 'revocation_uncertain'
  WHEN stamp<fence.drain_until THEN 'draining' WHEN admitted.attempt_id IS NOT NULL THEN 'revoking' ELSE 'ready_to_revoke' END;
 RETURN jsonb_build_object('state',status,'disconnectId',disconnect,'drainUntil',fence.drain_until,
  'unresolvedMutations',unresolved,'reviewRequired',unresolved>0 OR status='revocation_uncertain');
END $status$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_calendar_budget_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_calendar_dispatch_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_calendar_oauth_owner;
RESET ROLE;
