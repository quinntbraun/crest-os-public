-- P20/BR21. Held encrypted credential storage and refresh fencing.
-- No secrets, configured key, provisioned login, provider I/O or activation.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.google_calendar_credential_key (
 singleton boolean PRIMARY KEY CHECK(singleton),
 key_id text NOT NULL CHECK(key_id COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$')
);

CREATE TABLE crest_private.google_calendar_code_exchanges (
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 attempt_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 generation bigint NOT NULL CHECK(generation>=0),
 destination_id uuid,
 admitted_at timestamptz NOT NULL CHECK(isfinite(admitted_at)),
 deadline timestamptz NOT NULL CHECK(deadline=admitted_at+interval '30 seconds'),
 PRIMARY KEY(business_id,attempt_id),
 UNIQUE(business_id,recovery_epoch,generation),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id)
);

ALTER TABLE crest.google_calendar_request_admissions ADD FOREIGN KEY(business_id,setup_attempt_id)
 REFERENCES crest_private.google_calendar_code_exchanges(business_id,attempt_id);

CREATE TABLE crest_private.google_calendar_destination_reviews (
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 app_session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 actor_id uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>=0),
 client_id text NOT NULL,
 provider_calendar_id text NOT NULL,
 calendar_owner text NOT NULL CHECK(char_length(calendar_owner)<=254 AND calendar_owner COLLATE "C" ~
  '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'),
 reviewed_at timestamptz NOT NULL CHECK(isfinite(reviewed_at)),
 expires_at timestamptz NOT NULL CHECK(expires_at=reviewed_at+interval '10 minutes'),
 PRIMARY KEY(business_id,id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id)
);
CREATE INDEX calendar_destination_reviews_scope ON crest_private.google_calendar_destination_reviews
 (business_id,app_session_id,destination_id,generation,recovery_epoch,reviewed_at DESC);
CREATE TABLE crest_private.google_calendar_destination_verifications (
 business_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 review_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 verified_at timestamptz NOT NULL CHECK(isfinite(verified_at)),
 PRIMARY KEY(business_id,attempt_id),
 FOREIGN KEY(business_id,attempt_id) REFERENCES crest.google_calendar_request_admissions(business_id,setup_attempt_id),
 FOREIGN KEY(business_id,review_id) REFERENCES crest_private.google_calendar_destination_reviews(business_id,id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id)
);

-- Isolated from ordinary exports. The initial row names the intended next
-- generation but grants nothing until a separate reviewed consent activates it.
CREATE TABLE crest_private.google_calendar_credentials (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 destination_id uuid NOT NULL,
 connection_generation bigint NOT NULL CHECK(connection_generation>0),
 recovery_epoch uuid NOT NULL,
 client_id text NOT NULL,
 key_id text NOT NULL,
 scope text NOT NULL CHECK(scope='https://www.googleapis.com/auth/calendar.app.created'),
 envelope jsonb NOT NULL CHECK(jsonb_typeof(envelope)='object' AND octet_length(envelope::text)<=12300),
 version bigint NOT NULL CHECK(version>0),
 source_exchange uuid,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 updated_at timestamptz NOT NULL CHECK(isfinite(updated_at) AND updated_at>=created_at),
 UNIQUE(business_id,id),
 UNIQUE(business_id,destination_id,connection_generation),
 UNIQUE(business_id,source_exchange),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 FOREIGN KEY(business_id,source_exchange) REFERENCES crest_private.google_calendar_code_exchanges(business_id,attempt_id),
 CHECK(source_exchange IS NOT NULL)
);

CREATE TABLE crest_private.google_calendar_refresh_claims (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 credential_version bigint NOT NULL CHECK(credential_version>0),
 worker_principal name NOT NULL,
 admitted_at timestamptz NOT NULL CHECK(isfinite(admitted_at)),
 deadline timestamptz NOT NULL CHECK(deadline=admitted_at+interval '30 seconds'),
 UNIQUE(business_id,id),
 UNIQUE(business_id,credential_id,credential_version),
 FOREIGN KEY(business_id,credential_id) REFERENCES crest_private.google_calendar_credentials(business_id,id)
);

CREATE TABLE crest_private.google_calendar_refresh_results (
 business_id uuid NOT NULL,
 claim_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('rotated','reconnect','uncertain')),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 PRIMARY KEY(business_id,claim_id),
 FOREIGN KEY(business_id,claim_id) REFERENCES crest_private.google_calendar_refresh_claims(business_id,id)
);

DO $roles$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_credential_key','google_calendar_code_exchanges','google_calendar_destination_reviews',
   'google_calendar_destination_verifications','google_calendar_credentials',
   'google_calendar_refresh_claims','google_calendar_refresh_results'] LOOP
  EXECUTE format('ALTER TABLE crest_private.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest_private.%I FORCE ROW LEVEL SECURITY',relation);
  IF relation IN ('google_calendar_code_exchanges','google_calendar_destination_reviews','google_calendar_destination_verifications',
    'google_calendar_refresh_claims','google_calendar_refresh_results') THEN
   EXECUTE format('CREATE TRIGGER calendar_credentials_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest_private.%I
    FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
  END IF;
 END LOOP;
END $roles$;
CREATE TRIGGER calendar_credentials_not_deleted BEFORE DELETE OR TRUNCATE ON crest_private.google_calendar_credentials
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_credential_key TO crest_calendar_oauth_owner,crest_calendar_dispatch_owner;
CREATE POLICY calendar_credential_key_read ON crest_private.google_calendar_credential_key FOR SELECT
 TO crest_calendar_oauth_owner,crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_credential_key_lock ON crest_private.google_calendar_credential_key FOR UPDATE
 TO crest_calendar_oauth_owner,crest_calendar_dispatch_owner USING(true) WITH CHECK(false);
GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_oauth_client TO crest_calendar_dispatch_owner;
CREATE POLICY calendar_credential_client_read ON crest_private.google_calendar_oauth_client FOR SELECT
 TO crest_calendar_dispatch_owner USING(true);
CREATE POLICY calendar_credential_client_lock ON crest_private.google_calendar_oauth_client FOR UPDATE
 TO crest_calendar_dispatch_owner USING(true) WITH CHECK(false);
GRANT SELECT,INSERT ON crest_private.google_calendar_code_exchanges,crest_private.google_calendar_credentials TO crest_calendar_oauth_owner;
GRANT SELECT,INSERT ON crest_private.google_calendar_destination_reviews,crest_private.google_calendar_destination_verifications TO crest_calendar_oauth_owner;
GRANT SELECT(provider_calendar_id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
GRANT INSERT(business_id,setup_attempt_id,kind,admitted_at) ON crest.google_calendar_request_admissions TO crest_calendar_oauth_owner;
CREATE POLICY calendar_setup_admission_insert ON crest.google_calendar_request_admissions FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND lease_id IS NULL AND setup_attempt_id IS NOT NULL AND kind='verify_setup_destination');
CREATE POLICY calendar_destination_review_read ON crest_private.google_calendar_destination_reviews FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid);
CREATE POLICY calendar_destination_review_insert ON crest_private.google_calendar_destination_reviews FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND app_session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_destination_verification_read ON crest_private.google_calendar_destination_verifications FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_destination_verification_insert ON crest_private.google_calendar_destination_verifications FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_code_read ON crest_private.google_calendar_code_exchanges FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_code_append ON crest_private.google_calendar_code_exchanges FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
 AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid);
CREATE POLICY calendar_credential_owner_read ON crest_private.google_calendar_credentials FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_credential_owner_stage ON crest_private.google_calendar_credentials FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND version=1);
GRANT SELECT(business_id,credential_id,credential_version,deadline) ON crest_private.google_calendar_refresh_claims TO crest_calendar_oauth_owner;
GRANT SELECT(business_id,claim_id) ON crest_private.google_calendar_refresh_results TO crest_calendar_oauth_owner;
GRANT SELECT(id) ON crest_private.google_calendar_refresh_claims TO crest_calendar_oauth_owner;
CREATE POLICY calendar_refresh_owner_read ON crest_private.google_calendar_refresh_claims FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_refresh_result_owner_read ON crest_private.google_calendar_refresh_results FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);

GRANT SELECT,UPDATE(key_id,envelope,version,updated_at) ON crest_private.google_calendar_credentials TO crest_calendar_dispatch_owner;
GRANT SELECT,INSERT ON crest_private.google_calendar_refresh_claims,crest_private.google_calendar_refresh_results TO crest_calendar_dispatch_owner;
DO $worker$
DECLARE relation text;
DECLARE tenant text:='business_id=nullif(current_setting(''crest.calendar_credential_business'',true),'''')::uuid';
BEGIN
 FOREACH relation IN ARRAY ARRAY['google_calendar_credentials','google_calendar_refresh_claims','google_calendar_refresh_results'] LOOP
  EXECUTE format('CREATE POLICY calendar_credential_worker_read ON crest_private.%I FOR SELECT TO crest_calendar_dispatch_owner USING(%s)',relation,tenant);
  IF relation<>'google_calendar_credentials' THEN
   EXECUTE format('CREATE POLICY calendar_credential_worker_append ON crest_private.%I FOR INSERT TO crest_calendar_dispatch_owner WITH CHECK(%s)',relation,tenant);
  END IF;
 END LOOP;
 EXECUTE format('CREATE POLICY calendar_credential_worker_rotate ON crest_private.google_calendar_credentials
  FOR UPDATE TO crest_calendar_dispatch_owner USING(%s) WITH CHECK(%s)',tenant,tenant);
END $worker$;

-- Disconnect takes the exclusive destination lock before inserting the
-- fence, so every concurrent refresh either contributes here or is refused.
CREATE FUNCTION crest_private.drain_google_calendar_refresh_on_disconnect() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $drain$
DECLARE refresh_deadline timestamptz;
BEGIN
 SELECT max(a.deadline) INTO refresh_deadline
 FROM crest_private.google_calendar_credentials c JOIN crest_private.google_calendar_refresh_claims a
 ON (a.business_id,a.credential_id,a.credential_version)=(c.business_id,c.id,c.version)
 WHERE (c.business_id,c.destination_id,c.recovery_epoch)=(NEW.business_id,NEW.destination_id,NEW.recovery_epoch)
  AND c.connection_generation<NEW.disconnected_generation
  AND NOT EXISTS(SELECT FROM crest_private.google_calendar_refresh_results r WHERE (r.business_id,r.claim_id)=(a.business_id,a.id));
 NEW.drain_until:=greatest(NEW.drain_until,refresh_deadline);
 RETURN NEW;
END $drain$;
CREATE TRIGGER calendar_disconnect_refresh_drain BEFORE INSERT ON crest.google_calendar_disconnects
 FOR EACH ROW EXECUTE FUNCTION crest_private.drain_google_calendar_refresh_on_disconnect();

CREATE FUNCTION crest_private.valid_google_calendar_credential(
 envelope jsonb, key_id text, business uuid, destination uuid, generation bigint, epoch uuid, client_id text, credential uuid, version bigint
) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $validate$
 SELECT CASE WHEN jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR octet_length(envelope::text)>12300 THEN false ELSE
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(envelope) k)=ARRAY['aad','ciphertext','iv','protected','tag']
  AND envelope->>'protected'=crest_private.google_calendar_oauth_base64url(convert_to(
    '{"alg":"dir","enc":"A256GCM","kid":"' || key_id || '","typ":"application/vnd.crest.google-calendar-credentials.v1"}','UTF8'))
  AND envelope->>'aad'=crest_private.google_calendar_oauth_base64url(convert_to(concat_ws(E'\n',
    'crest.google-calendar-credentials.v1',business,destination,generation,epoch,client_id,
    'https://www.googleapis.com/auth/calendar.app.created',credential,version),'UTF8'))
  AND jsonb_typeof(envelope->'iv')='string' AND envelope->>'iv' COLLATE "C" ~ '^[A-Za-z0-9_-]{16}$'
  AND jsonb_typeof(envelope->'tag')='string' AND envelope->>'tag' COLLATE "C" ~ '^[A-Za-z0-9_-]{22}$'
  AND jsonb_typeof(envelope->'ciphertext')='string' AND char_length(envelope->>'ciphertext') BETWEEN 2 AND 11600
  AND envelope->>'ciphertext' COLLATE "C" ~ '^[A-Za-z0-9_-]+$'
 END
$validate$;

CREATE FUNCTION crest_commands.admit_google_calendar_code_exchange(
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
 INSERT INTO crest_private.google_calendar_code_exchanges(business_id,attempt_id,app_session_id,actor_id,recovery_epoch,client_id,
  generation,destination_id,admitted_at,deadline)
 VALUES(business,attempt,app_session,actor,epoch,google_client,generation,boundary.destination_id,stamp,stamp+interval '30 seconds')
 ON CONFLICT DO NOTHING RETURNING attempt_id INTO inserted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('attemptId',inserted,'deadline',stamp+interval '30 seconds');
END $admit$;

CREATE FUNCTION crest_commands.confirm_google_calendar_setup_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,
 destination uuid,provider_id text,reviewed_owner text,confirmed boolean
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $confirm$
DECLARE boundary record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR confirmed IS DISTINCT FROM true OR destination IS NULL OR boundary.destination_id IS DISTINCT FROM destination
  OR reviewed_owner IS NULL OR char_length(reviewed_owner)>254 OR reviewed_owner COLLATE "C" !~
   '^[^[:space:][:cntrl:]@]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,63}$'
  OR NOT EXISTS(SELECT FROM crest.google_calendar_destinations d
    WHERE (d.business_id,d.id,d.provider_calendar_id)=(business,destination,provider_id))
 THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e
  WHERE (e.business_id,e.recovery_epoch,e.generation)=(business,epoch,confirm_google_calendar_setup_destination.generation)) THEN RETURN false; END IF;
 -- An explicit reviewed value can be superseded before exchange, but never
 -- replaced while a code exchange or metadata request is in flight.
 IF EXISTS(SELECT FROM crest_private.google_calendar_destination_reviews r
  WHERE (r.business_id,r.app_session_id,r.destination_id,r.generation,r.recovery_epoch)
   =(business,app_session,destination,confirm_google_calendar_setup_destination.generation,epoch)
   AND r.reviewed_at>stamp-interval '1 second') THEN RETURN false; END IF;
 INSERT INTO crest_private.google_calendar_destination_reviews(business_id,destination_id,app_session_id,actor_id,
  recovery_epoch,generation,client_id,provider_calendar_id,calendar_owner,reviewed_at,expires_at)
 VALUES(business,destination,app_session,actor,epoch,generation,google_client,provider_id,reviewed_owner,stamp,stamp+interval '10 minutes');
 RETURN true;
END $confirm$;

CREATE FUNCTION crest_private.current_google_calendar_destination_review(
 business uuid,app_session uuid,actor uuid,epoch uuid,generation bigint,client text,destination uuid
) RETURNS crest_private.google_calendar_destination_reviews LANGUAGE sql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
 SELECT r FROM crest_private.google_calendar_destination_reviews r
 JOIN crest.google_calendar_destinations d ON (d.business_id,d.id,d.provider_calendar_id)=(r.business_id,r.destination_id,r.provider_calendar_id)
 WHERE (r.business_id,r.app_session_id,r.actor_id,r.recovery_epoch,r.generation,r.client_id,r.destination_id)
  =($1,$2,$3,$4,$5,$6,$7)
 AND r.reviewed_at<=clock_timestamp() AND r.expires_at>clock_timestamp()
 ORDER BY r.reviewed_at DESC,r.id DESC LIMIT 1
$review$;

-- The combined read/admit provides the exact reviewed target only after the
-- database has reserved one provider request in the shared quota window.
CREATE FUNCTION crest_commands.admit_google_calendar_setup_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE boundary record; reviewed crest_private.google_calendar_destination_reviews; exchange record; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR boundary.destination_id IS NULL THEN RETURN NULL; END IF;
 SELECT e.deadline,e.admitted_at INTO exchange FROM crest_private.google_calendar_code_exchanges e
 WHERE (e.business_id,e.attempt_id,e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id,e.generation,e.destination_id)
  =(business,attempt,app_session,actor,epoch,google_client,admit_google_calendar_setup_destination.generation,boundary.destination_id);
 IF NOT FOUND THEN RETURN NULL; END IF;
 reviewed:=crest_private.current_google_calendar_destination_review(business,app_session,actor,epoch,generation,google_client,boundary.destination_id);
 IF reviewed.id IS NULL OR reviewed.reviewed_at>exchange.admitted_at THEN RETURN NULL; END IF;
 stamp:=crest_private.lock_google_calendar_request_budget();
 IF stamp IS NULL OR exchange.deadline<=stamp OR reviewed.expires_at<=stamp OR provider_valid_until<=stamp THEN RETURN NULL; END IF;
 INSERT INTO crest.google_calendar_request_admissions(business_id,setup_attempt_id,kind,admitted_at)
 VALUES(business,attempt,'verify_setup_destination',stamp) ON CONFLICT(business_id,setup_attempt_id) DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('destinationId',reviewed.destination_id,'providerCalendarId',reviewed.provider_calendar_id,
  'reviewedCalendarOwner',reviewed.calendar_owner);
END $admit$;

CREATE FUNCTION crest_commands.finish_google_calendar_setup_destination(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid,destination uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE boundary record; reviewed crest_private.google_calendar_destination_reviews; stamp timestamptz;
BEGIN
 SELECT * INTO boundary FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,
  provider_session,provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR destination IS NULL OR boundary.destination_id IS DISTINCT FROM destination THEN RETURN false; END IF;
 reviewed:=crest_private.current_google_calendar_destination_review(business,app_session,actor,epoch,generation,google_client,destination);
 IF reviewed.id IS NULL THEN RETURN false; END IF;
 stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_code_exchanges e JOIN crest.google_calendar_request_admissions a
  ON (a.business_id,a.setup_attempt_id)=(e.business_id,e.attempt_id)
  WHERE (e.business_id,e.attempt_id,e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id,e.generation,e.destination_id)
   =(business,attempt,app_session,actor,epoch,google_client,finish_google_calendar_setup_destination.generation,destination)
   AND a.kind='verify_setup_destination' AND a.admitted_at<=stamp AND e.deadline>stamp AND reviewed.reviewed_at<=e.admitted_at)
 THEN RETURN false; END IF;
 INSERT INTO crest_private.google_calendar_destination_verifications(business_id,attempt_id,review_id,destination_id,verified_at)
 VALUES(business,attempt,reviewed.id,destination,stamp) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $finish$;

CREATE FUNCTION crest_commands.stage_google_calendar_credential(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,destination uuid,attempt uuid,new_credential uuid,key text,envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stage$
DECLARE configured record; exchange record; generation bigint; active_key text; stamp timestamptz; inserted uuid;
BEGIN
 IF NOT crest_private.lock_google_calendar_disconnect(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,destination) THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR configured.client_id IS NULL OR active_key IS DISTINCT FROM key OR key=configured.verifier_key_id
  OR new_credential IS NULL OR new_credential='00000000-0000-0000-0000-000000000000' THEN RETURN NULL; END IF;
 SELECT e.* INTO exchange FROM crest_private.google_calendar_code_exchanges e WHERE (e.business_id,e.attempt_id,e.app_session_id,e.actor_id,e.recovery_epoch,e.client_id)
  =(business,attempt,app_session,actor,epoch,configured.client_id);
 IF NOT FOUND OR exchange.destination_id IS DISTINCT FROM destination
  OR NOT EXISTS(SELECT FROM crest_private.google_calendar_destination_verifications v
   WHERE (v.business_id,v.attempt_id,v.destination_id)=(business,attempt,destination))
 THEN RETURN NULL; END IF;
 SELECT coalesce(max(c.generation),0) INTO generation FROM crest.google_calendar_consents c WHERE (c.business_id,c.destination_id)=(business,destination);
 stamp:=clock_timestamp();
 IF generation<>exchange.generation OR generation>=9223372036854775807 OR stamp>=exchange.deadline OR stamp<exchange.admitted_at
  OR crest_private.valid_google_calendar_credential(envelope,key,business,destination,generation+1,epoch,configured.client_id,new_credential,1) IS DISTINCT FROM true
 THEN RETURN NULL; END IF;
 INSERT INTO crest_private.google_calendar_credentials(id,business_id,destination_id,connection_generation,recovery_epoch,
  client_id,key_id,scope,envelope,version,source_exchange,created_at,updated_at)
 VALUES(new_credential,business,destination,generation+1,epoch,configured.client_id,key,
  'https://www.googleapis.com/auth/calendar.app.created',envelope,1,attempt,stamp,stamp)
 ON CONFLICT DO NOTHING RETURNING id INTO inserted;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('credentialId',inserted,'generation',(generation+1)::text,'version','1');
END $stage$;

CREATE FUNCTION crest_private.lock_google_calendar_credential(
 business uuid,destination uuid,epoch uuid,generation bigint
) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
DECLARE authority record; consent record;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_FRESH_TRANSACTION_REQUIRED';
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.google_calendar_worker_principals p WHERE (p.business_id,p.principal)=(business,session_user)) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_WORKER_DENIED';
 END IF;
 SELECT r.active_epoch,r.writes_enabled INTO authority FROM crest_private.business_recovery_authorities r WHERE r.business_id=business FOR SHARE;
 IF NOT FOUND OR (authority.active_epoch,authority.writes_enabled) IS DISTINCT FROM (epoch,true) THEN RETURN false; END IF;
 PERFORM d.id FROM crest.google_calendar_destinations d WHERE (d.business_id,d.id)=(business,destination) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT c.generation,c.recovery_epoch,c.state INTO consent FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination) ORDER BY c.generation DESC LIMIT 1;
 IF NOT FOUND OR (consent.generation,consent.recovery_epoch,consent.state) IS DISTINCT FROM (generation,epoch,'active') THEN RETURN false; END IF;
 PERFORM set_config('crest.calendar_credential_business',business::text,true);
 RETURN true;
END $lock$;

CREATE FUNCTION crest_commands.claim_google_calendar_refresh(
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
 INSERT INTO crest_private.google_calendar_refresh_claims(business_id,credential_id,credential_version,worker_principal,admitted_at,deadline)
 VALUES(business,current_row.id,current_row.version,session_user,stamp,stamp+interval '30 seconds') RETURNING id INTO claim;
 RETURN jsonb_build_object('state','claimed','claimId',claim,'deadline',stamp+interval '30 seconds',
  'credentialId',current_row.id,'version',current_row.version::text,'keyId',current_row.key_id,'envelope',current_row.envelope);
END $claim$;

CREATE FUNCTION crest_commands.finish_google_calendar_refresh(
 business uuid,destination uuid,epoch uuid,generation bigint,claim uuid,outcome text,replacement_key text,replacement jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
DECLARE current_row record; admitted record; prior text; configured record; active_key text; stamp timestamptz;
BEGIN
 IF NOT crest_private.lock_google_calendar_credential(business,destination,epoch,generation) THEN RETURN NULL; END IF;
 IF outcome IS NULL OR outcome NOT IN('rotated','reconnect','uncertain') OR
  ((outcome='rotated')<>(replacement_key IS NOT NULL AND replacement IS NOT NULL)) OR
  (outcome<>'rotated' AND (replacement_key IS NOT NULL OR replacement IS NOT NULL))
 THEN RETURN NULL; END IF;
 SELECT c.client_id,c.verifier_key_id INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 SELECT k.key_id INTO active_key FROM crest_private.google_calendar_credential_key k WHERE k.singleton FOR SHARE;
 IF NOT FOUND OR active_key=configured.verifier_key_id THEN RETURN NULL; END IF;
 SELECT c.id,c.version INTO current_row FROM crest_private.google_calendar_credentials c
 WHERE (c.business_id,c.destination_id,c.connection_generation,c.recovery_epoch,c.client_id)
  =(business,destination,generation,epoch,configured.client_id) FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT a.id,a.deadline,a.credential_version INTO admitted FROM crest_private.google_calendar_refresh_claims a
 WHERE (a.business_id,a.id,a.credential_id,a.worker_principal)=(business,claim,current_row.id,session_user);
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT r.outcome INTO prior FROM crest_private.google_calendar_refresh_results r WHERE (r.business_id,r.claim_id)=(business,claim);
 IF FOUND THEN
  IF prior=outcome AND prior<>'rotated' THEN RETURN jsonb_build_object('state',prior); END IF;
  RETURN NULL;
 END IF;
 stamp:=clock_timestamp();
 IF current_row.version<>admitted.credential_version OR (outcome<>'uncertain' AND stamp>=admitted.deadline) THEN RETURN NULL; END IF;
 IF outcome='rotated' THEN
  IF active_key IS DISTINCT FROM replacement_key OR current_row.version>=9223372036854775807
   OR crest_private.valid_google_calendar_credential(replacement,active_key,business,destination,generation,epoch,configured.client_id,
    current_row.id,current_row.version+1) IS DISTINCT FROM true
  THEN RETURN NULL; END IF;
  UPDATE crest_private.google_calendar_credentials c SET envelope=replacement,key_id=active_key,version=c.version+1,updated_at=stamp
  WHERE (c.business_id,c.id)=(business,current_row.id);
 END IF;
 INSERT INTO crest_private.google_calendar_refresh_results(business_id,claim_id,outcome,recorded_at) VALUES(business,claim,outcome,stamp);
 RETURN jsonb_build_object('state',outcome);
END $finish$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.lock_google_calendar_request_budget() TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.confirm_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,text,text,boolean)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.current_google_calendar_destination_review(uuid,uuid,uuid,uuid,bigint,text,uuid) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,uuid)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION
 crest_commands.confirm_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,text,text,boolean),
 crest_private.current_google_calendar_destination_review(uuid,uuid,uuid,uuid,bigint,text,uuid),
 crest_commands.admit_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.finish_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.confirm_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,text,text,boolean),
 crest_commands.admit_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.finish_google_calendar_setup_destination(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,uuid) TO crest_calendar_oauth;
ALTER FUNCTION crest_private.valid_google_calendar_credential(jsonb,text,uuid,uuid,bigint,uuid,text,uuid,bigint) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.drain_google_calendar_refresh_on_disconnect() OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.lock_google_calendar_credential(uuid,uuid,uuid,bigint) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.admit_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.stage_google_calendar_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.claim_google_calendar_refresh(uuid,uuid,uuid,bigint) OWNER TO crest_calendar_dispatch_owner;
ALTER FUNCTION crest_commands.finish_google_calendar_refresh(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) OWNER TO crest_calendar_dispatch_owner;
REVOKE ALL ON FUNCTION crest_private.valid_google_calendar_credential(jsonb,text,uuid,uuid,bigint,uuid,text,uuid,bigint),
 crest_private.drain_google_calendar_refresh_on_disconnect(),
 crest_private.lock_google_calendar_credential(uuid,uuid,uuid,bigint),
 crest_commands.admit_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.stage_google_calendar_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb),
 crest_commands.claim_google_calendar_refresh(uuid,uuid,uuid,bigint),
 crest_commands.finish_google_calendar_refresh(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_google_calendar_credential(jsonb,text,uuid,uuid,bigint,uuid,text,uuid,bigint),
 crest_private.google_calendar_oauth_base64url(bytea) TO crest_calendar_dispatch_owner;
GRANT EXECUTE ON FUNCTION
 crest_commands.admit_google_calendar_code_exchange(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid),
 crest_commands.stage_google_calendar_credential(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,text,jsonb)
 TO crest_calendar_oauth;
GRANT EXECUTE ON FUNCTION crest_commands.claim_google_calendar_refresh(uuid,uuid,uuid,bigint),
 crest_commands.finish_google_calendar_refresh(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) TO crest_calendar_dispatch;
