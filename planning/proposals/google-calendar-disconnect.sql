-- P20/BR21. Local disconnect and redacted revocation evidence only.
-- Requires the held outbox, dispatch and OAuth-attempt proposals.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.google_calendar_disconnects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 disconnected_generation bigint NOT NULL CHECK(disconnected_generation>1),
 prior_generation bigint GENERATED ALWAYS AS (disconnected_generation-1) STORED,
 fenced_at timestamptz NOT NULL CHECK(isfinite(fenced_at)),
 drain_until timestamptz NOT NULL CHECK(drain_until BETWEEN fenced_at AND fenced_at+interval '60 seconds'),
 actor_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 UNIQUE(business_id,id),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,destination_id,disconnected_generation),
 FOREIGN KEY(business_id,destination_id,disconnected_generation,recovery_epoch)
  REFERENCES crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch),
 FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE TABLE crest.google_calendar_revocation_events (
 business_id uuid NOT NULL,
 disconnect_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN('admitted','revoked','uncertain')),
 admission_phase text GENERATED ALWAYS AS (CASE WHEN phase<>'admitted' THEN 'admitted' END) STORED,
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 deadline timestamptz CHECK(deadline=recorded_at+interval '30 seconds'),
 actor_id uuid NOT NULL,
 PRIMARY KEY(business_id,disconnect_id,phase),
 UNIQUE(business_id,disconnect_id,attempt_id,phase),
 FOREIGN KEY(business_id,disconnect_id) REFERENCES crest.google_calendar_disconnects(business_id,id),
 FOREIGN KEY(business_id,disconnect_id,attempt_id,admission_phase)
  REFERENCES crest.google_calendar_revocation_events(business_id,disconnect_id,attempt_id,phase),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 CHECK((phase='admitted')=(deadline IS NOT NULL))
);
CREATE UNIQUE INDEX calendar_revocation_one_result ON crest.google_calendar_revocation_events(business_id,disconnect_id)
 WHERE phase<>'admitted';

ALTER TABLE crest.google_calendar_disconnects ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.google_calendar_disconnects FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.google_calendar_revocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.google_calendar_revocation_events FORCE ROW LEVEL SECURITY;
CREATE TRIGGER calendar_disconnect_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.google_calendar_disconnects
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER calendar_revocation_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.google_calendar_revocation_events
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.google_calendar_disconnects,crest.google_calendar_revocation_events TO crest_calendar_oauth_owner;
GRANT SELECT ON crest.google_calendar_disconnects TO crest_calendar_dispatch_owner;
GRANT SELECT ON crest.google_calendar_outbox,crest.google_calendar_dispatch_leases,crest.google_calendar_request_admissions,
 crest.google_calendar_dispatch_results TO crest_calendar_oauth_owner;
CREATE POLICY calendar_disconnect_owner_read ON crest.google_calendar_disconnects FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_disconnect_owner_append ON crest.google_calendar_disconnects FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_disconnect_worker_read ON crest.google_calendar_disconnects FOR SELECT TO crest_calendar_dispatch_owner
 USING(EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p
  WHERE (p.business_id,p.principal)=(google_calendar_disconnects.business_id,session_user)));
CREATE POLICY calendar_revocation_owner_read ON crest.google_calendar_revocation_events FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_revocation_owner_append ON crest.google_calendar_revocation_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);

DO $disconnect$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_outbox','google_calendar_dispatch_leases',
  'google_calendar_request_admissions','google_calendar_dispatch_results'] LOOP
  EXECUTE format('CREATE POLICY calendar_disconnect_source ON crest.%I FOR SELECT TO crest_calendar_oauth_owner
   USING(business_id=nullif(current_setting(''crest.calendar_oauth_business'',true),'''')::uuid)',relation);
 END LOOP;
END $disconnect$;

GRANT SELECT(recovery_epoch,state,client_name,service_label,work_address),
 INSERT(business_id,destination_id,generation,recovery_epoch,state,client_name,service_label,work_address,created_by,operation_id)
 ON crest.google_calendar_consents TO crest_calendar_oauth_owner;
CREATE POLICY calendar_disconnect_consent_append ON crest.google_calendar_consents FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND created_by=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND state='disconnected'
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid);
GRANT SELECT ON crest_private.operations TO crest_calendar_oauth_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin),
 UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_calendar_oauth_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 ON crest_private.audit_events TO crest_calendar_oauth_owner;
CREATE POLICY calendar_disconnect_operation_read ON crest_private.operations FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND command_type='calendar.connection.disconnect');
CREATE POLICY calendar_disconnect_operation_begin ON crest_private.operations FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.disconnect' AND schema_version=1 AND state='pending' AND origin='manual');
CREATE POLICY calendar_disconnect_operation_finish ON crest_private.operations FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.disconnect' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND command_type='calendar.connection.disconnect' AND state='committed');
CREATE POLICY calendar_disconnect_audit_append ON crest_private.audit_events FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.calendar_disconnect_operation',true),'')::uuid
  AND entity_kind='google_calendar_connections' AND action='disconnect' AND origin='manual');

CREATE FUNCTION crest_private.lock_google_calendar_disconnect(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM d.id FROM crest.google_calendar_destinations d WHERE (d.business_id,d.id)=(business,destination) FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 RETURN true;
END $lock$;

CREATE FUNCTION crest_commands.begin_google_calendar_disconnect(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,generation bigint,requested_operation uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $begin$
DECLARE consent record; stamp timestamptz; drain timestamptz; decision jsonb; fingerprint text; prior record; disconnect uuid;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) OR generation IS NULL OR generation<=0 OR requested_operation IS NULL
 THEN RETURN NULL; END IF;
 PERFORM set_config('crest.calendar_disconnect_operation',requested_operation::text,true);
 fingerprint:=encode(sha256(convert_to(jsonb_build_array(destination,generation,epoch)::text,'UTF8')),'hex');
 SELECT o.payload_hash,o.result INTO prior FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(business,requested_operation,actor)
  AND o.command_type='calendar.connection.disconnect';
 IF FOUND THEN
  IF prior.payload_hash=fingerprint THEN RETURN prior.result; END IF;
  RETURN NULL;
 END IF;
 SELECT c.generation,c.recovery_epoch,c.state,c.client_name,c.service_label,c.work_address INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR (consent.generation,consent.recovery_epoch) IS DISTINCT FROM (generation,epoch)
  OR consent.state NOT IN('active','paused') THEN RETURN NULL; END IF;
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,requested_operation,actor,'calendar.connection.disconnect',1,epoch,fingerprint,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT greatest(stamp,max(l.lease_until)) INTO drain
 FROM crest.google_calendar_outbox o JOIN crest.google_calendar_dispatch_leases l ON (l.business_id,l.outbox_id)=(o.business_id,o.id)
 WHERE (o.business_id,o.destination_id,o.recovery_epoch)=(business,destination,epoch)
  AND o.connection_generation<=generation AND l.lease_until>stamp
  AND EXISTS(SELECT FROM crest.google_calendar_request_admissions a WHERE (a.business_id,a.lease_id)=(l.business_id,l.id))
  AND NOT EXISTS(SELECT FROM crest.google_calendar_dispatch_results r WHERE (r.business_id,r.lease_id)=(l.business_id,l.id));
 INSERT INTO crest.google_calendar_consents(business_id,destination_id,generation,recovery_epoch,state,
  client_name,service_label,work_address,created_by,operation_id)
 VALUES(business,destination,generation+1,epoch,'disconnected',consent.client_name,consent.service_label,consent.work_address,actor,requested_operation);
 INSERT INTO crest.google_calendar_disconnects(business_id,destination_id,recovery_epoch,disconnected_generation,
  fenced_at,drain_until,actor_id,operation_id)
 VALUES(business,destination,epoch,generation+1,stamp,drain,actor,requested_operation) RETURNING id,drain_until INTO disconnect,drain;
 decision:=jsonb_build_object('schemaVersion',1,'disconnectId',disconnect,'destinationId',destination,'generation',(generation+1)::text,
  'fencedAt',stamp,'drainUntil',drain);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(business,requested_operation,actor,actor,'google_calendar_connections',destination,generation+1,'disconnect',
  jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('generation',generation::text,'state',consent.state),
   'after',decision||jsonb_build_object('state','disconnected')),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=decision
 WHERE (o.business_id,o.operation_id)=(business,requested_operation);
 RETURN decision;
END $begin$;

-- This path records only the outcome of a previously admitted mutation.
-- It cannot obtain a fresh lease, request admission or current-sync receipt.
CREATE FUNCTION crest_commands.record_google_calendar_drained_send(
 business uuid,destination uuid,job uuid,epoch uuid,requested_lease uuid,outcome text,etag text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $drained$
DECLARE active_epoch uuid; enabled boolean; fence record; sent text; prior record; stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_FRESH_TRANSACTION_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p WHERE (p.business_id,p.principal)=(business,session_user)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED';
 END IF;
 SELECT r.active_epoch,r.writes_enabled INTO active_epoch,enabled FROM crest_private.business_recovery_authorities r
 WHERE r.business_id=business FOR SHARE;
 IF NOT FOUND OR (active_epoch,enabled) IS DISTINCT FROM (epoch,true) THEN RETURN false; END IF;
 PERFORM d.id FROM crest.google_calendar_destinations d WHERE (d.business_id,d.id)=(business,destination) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT d.prior_generation,d.fenced_at,d.drain_until INTO fence FROM crest.google_calendar_disconnects d
 WHERE (d.business_id,d.destination_id,d.recovery_epoch)=(business,destination,epoch)
  AND d.disconnected_generation=(SELECT max(c.generation) FROM crest.google_calendar_consents c
   WHERE (c.business_id,c.destination_id)=(business,destination));
 IF NOT FOUND THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 SELECT a.kind INTO sent FROM crest.google_calendar_dispatch_leases l
 JOIN crest.google_calendar_outbox o ON (o.business_id,o.id)=(l.business_id,l.outbox_id)
 JOIN crest.google_calendar_request_admissions a ON (a.business_id,a.lease_id)=(l.business_id,l.id)
 WHERE (l.business_id,l.id,l.worker_principal)=(business,requested_lease,session_user)
  AND (o.destination_id,o.job_id,o.recovery_epoch)=(destination,job,epoch) AND o.connection_generation<=fence.prior_generation
  AND a.kind IN('insert','update','delete') AND a.admitted_at<=fence.fenced_at
  AND a.admitted_at>=l.leased_at AND stamp<least(l.lease_until,fence.drain_until);
 IF NOT FOUND OR outcome IS NULL OR outcome NOT IN('published','removed','uncertain')
  OR (outcome='published')<>(etag IS NOT NULL)
  OR (outcome='published' AND sent NOT IN('insert','update')) OR (outcome='removed' AND sent<>'delete')
  OR (etag IS NOT NULL AND (char_length(etag)>258 OR etag COLLATE "C" !~ '^"[!#-~]+"$'))
 THEN RETURN false; END IF;
 INSERT INTO crest.google_calendar_dispatch_results(business_id,lease_id,outcome,provider_etag,source_current,recorded_at,retry_at)
 VALUES(business,requested_lease,outcome,etag,false,stamp,CASE WHEN outcome='uncertain' THEN stamp END)
 ON CONFLICT(business_id,lease_id) DO NOTHING;
 IF FOUND THEN RETURN true; END IF;
 SELECT r.outcome,r.provider_etag,r.source_current INTO prior FROM crest.google_calendar_dispatch_results r
 WHERE (r.business_id,r.lease_id)=(business,requested_lease);
 RETURN (prior.outcome,prior.provider_etag,prior.source_current) IS NOT DISTINCT FROM (outcome,etag,false);
END $drained$;

-- The owner-only executor must commit admission before any token revocation.
-- A lost response leaves a visible uncertainty and does not permit a retry.
CREATE FUNCTION crest_commands.google_calendar_disconnect_status(
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
ALTER FUNCTION crest_private.lock_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.begin_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.record_google_calendar_drained_send(uuid,uuid,uuid,uuid,uuid,text,text)
 OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_commands.begin_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,uuid),
 crest_commands.google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid),
 crest_commands.record_google_calendar_drained_send(uuid,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.begin_google_calendar_disconnect(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,uuid),
 crest_commands.google_calendar_disconnect_status(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,uuid)
 TO crest_calendar_oauth;
GRANT EXECUTE ON FUNCTION crest_commands.record_google_calendar_drained_send(uuid,uuid,uuid,uuid,uuid,text,text)
 TO crest_calendar_dispatch;
