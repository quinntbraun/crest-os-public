-- P20/BR21. Held pre-consent state only; no web login, token exchange,
-- Google account data, configured client, or connection activation.
CREATE ROLE crest_calendar_oauth_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE crest_calendar_oauth NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.google_calendar_oauth_client (
 singleton boolean PRIMARY KEY CHECK(singleton),
 issuer text NOT NULL CHECK(issuer='https://accounts.google.com'),
 client_id text NOT NULL CHECK(char_length(client_id)<=200 AND client_id COLLATE "C" ~ '^[A-Za-z0-9_-]+[.]apps[.]googleusercontent[.]com$'),
 callback_uri text NOT NULL CHECK(char_length(callback_uri)<=300 AND callback_uri COLLATE "C" ~
  '^https://([A-Za-z0-9.-]+|\[[a-fA-F0-9:]+\])(:[0-9]{1,5})?/api/google-calendar/callback$'),
 verifier_key_id text NOT NULL CHECK(verifier_key_id COLLATE "C" ~ '^[A-Za-z0-9_-]{1,100}$')
);

-- Ephemeral server-only security state. Exclude this relation from product
-- exports and invalidate it on restore. No raw state, code, verifier or token.
CREATE TABLE crest_private.google_calendar_oauth_attempts (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
 recovery_epoch uuid NOT NULL,
 destination_id uuid,
 connection_generation bigint NOT NULL CHECK(connection_generation>=0),
 issuer text NOT NULL,
 client_id text NOT NULL,
 callback_uri text NOT NULL,
 state_digest bytea NOT NULL UNIQUE CHECK(octet_length(state_digest)=32),
 verifier_key_id text NOT NULL,
 verifier_envelope jsonb,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 expires_at timestamptz NOT NULL CHECK(expires_at=created_at+interval '5 minutes'),
 retired_at timestamptz CHECK(isfinite(retired_at) AND retired_at>=created_at),
 consumed_at timestamptz CHECK(consumed_at IS NULL OR
  (retired_at IS NOT NULL AND consumed_at=retired_at AND consumed_at<expires_at)),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id),
 FOREIGN KEY(business_id,destination_id) REFERENCES crest.google_calendar_destinations(business_id,id),
 CHECK(connection_generation=0 OR destination_id IS NOT NULL),
 CHECK((retired_at IS NULL)=(verifier_envelope IS NOT NULL))
);
CREATE INDEX google_calendar_oauth_attempt_window ON crest_private.google_calendar_oauth_attempts(business_id,created_at,id);
CREATE UNIQUE INDEX google_calendar_oauth_one_pending ON crest_private.google_calendar_oauth_attempts(business_id) WHERE retired_at IS NULL;

ALTER TABLE crest_private.google_calendar_oauth_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_oauth_client FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_oauth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.google_calendar_oauth_attempts FORCE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_calendar_oauth_owner;
GRANT USAGE ON SCHEMA crest_commands TO crest_calendar_oauth;
GRANT SELECT,UPDATE(singleton) ON crest_private.google_calendar_oauth_client TO crest_calendar_oauth_owner;
GRANT SELECT,INSERT,DELETE,UPDATE(retired_at,consumed_at,verifier_envelope) ON crest_private.google_calendar_oauth_attempts TO crest_calendar_oauth_owner;
GRANT SELECT(business_id,id),UPDATE(id) ON crest.google_calendar_destinations TO crest_calendar_oauth_owner;
GRANT SELECT(business_id,destination_id,generation) ON crest.google_calendar_consents TO crest_calendar_oauth_owner;
CREATE POLICY calendar_oauth_client_read ON crest_private.google_calendar_oauth_client FOR SELECT TO crest_calendar_oauth_owner USING(true);
CREATE POLICY calendar_oauth_client_lock ON crest_private.google_calendar_oauth_client FOR UPDATE TO crest_calendar_oauth_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_oauth_destination_read ON crest.google_calendar_destinations FOR SELECT TO crest_calendar_oauth_owner USING(true);
CREATE POLICY calendar_oauth_destination_lock ON crest.google_calendar_destinations FOR UPDATE TO crest_calendar_oauth_owner
 USING(true) WITH CHECK(false);
CREATE POLICY calendar_oauth_consent_read ON crest.google_calendar_consents FOR SELECT TO crest_calendar_oauth_owner USING(true);
CREATE POLICY calendar_oauth_attempt_read ON crest_private.google_calendar_oauth_attempts FOR SELECT TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid);
CREATE POLICY calendar_oauth_attempt_insert ON crest_private.google_calendar_oauth_attempts FOR INSERT TO crest_calendar_oauth_owner
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.calendar_oauth_actor',true),'')::uuid
  AND session_id=nullif(current_setting('crest.calendar_oauth_session',true),'')::uuid AND retired_at IS NULL AND consumed_at IS NULL);
CREATE POLICY calendar_oauth_attempt_retire ON crest_private.google_calendar_oauth_attempts FOR UPDATE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid AND retired_at IS NULL)
 WITH CHECK(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND retired_at IS NOT NULL AND verifier_envelope IS NULL);
CREATE POLICY calendar_oauth_attempt_expire ON crest_private.google_calendar_oauth_attempts FOR DELETE TO crest_calendar_oauth_owner
 USING(business_id=nullif(current_setting('crest.calendar_oauth_business',true),'')::uuid
  AND expires_at<=clock_timestamp()-interval '10 minutes');

-- An as-yet unconnected business has no destination row to lock. Serialize
-- creation of that first row with the same business lock as start/consume.
CREATE FUNCTION crest_private.lock_google_calendar_first_destination() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $destination$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||NEW.business_id::text,0));
 RETURN NEW;
END $destination$;
CREATE TRIGGER calendar_oauth_first_destination BEFORE INSERT ON crest.google_calendar_destinations
 FOR EACH ROW EXECUTE FUNCTION crest_private.lock_google_calendar_first_destination();

CREATE FUNCTION crest_private.lock_google_calendar_oauth_attempt(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text
) RETURNS TABLE(verifier_key text,destination_id uuid)
LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $boundary$
DECLARE configured crest_private.google_calendar_oauth_client; destination uuid; current_generation bigint;
BEGIN
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('crest.google-calendar.oauth:'||business::text,0));
 SELECT c.* INTO configured FROM crest_private.google_calendar_oauth_client c WHERE c.singleton FOR SHARE;
 IF NOT FOUND OR (configured.issuer,configured.client_id,configured.callback_uri) IS DISTINCT FROM (google_issuer,google_client,callback) THEN
  RETURN;
 END IF;
 SELECT d.id INTO destination FROM crest.google_calendar_destinations d WHERE d.business_id=business FOR SHARE;
 SELECT coalesce(max(c.generation),0) INTO current_generation FROM crest.google_calendar_consents c
 WHERE (c.business_id,c.destination_id)=(business,destination);
 IF current_generation IS DISTINCT FROM generation THEN RETURN; END IF;
 -- All other locks are already held. Check that owner/provider freshness
 -- did not expire while waiting for the business or destination.
 PERFORM crest_commands.lock_mutation_authority(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,'identity.manage',true);
 PERFORM set_config('crest.calendar_oauth_business',business::text,true);
 PERFORM set_config('crest.calendar_oauth_actor',actor::text,true);
 PERFORM set_config('crest.calendar_oauth_session',app_session::text,true);
 RETURN QUERY SELECT configured.verifier_key_id,destination;
END $boundary$;

CREATE FUNCTION crest_private.google_calendar_oauth_base64url(value bytea) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $encoding$
 SELECT translate(encode(value,'base64'),E'+/=\n','-_')
$encoding$;

CREATE FUNCTION crest_commands.begin_google_calendar_oauth_attempt(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,
 attempt uuid,digest bytea,key_id text,envelope jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $start$
DECLARE scope record; stamp timestamptz; inserted uuid; protected_header text; binding text;
BEGIN
 SELECT * INTO scope FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR attempt IS NULL OR attempt='00000000-0000-0000-0000-000000000000'
  OR digest IS NULL OR octet_length(digest)<>32 OR scope.verifier_key IS DISTINCT FROM key_id
  OR jsonb_typeof(envelope) IS DISTINCT FROM 'object' OR octet_length(envelope::text)>1400
 THEN RETURN NULL; END IF;
 -- Match the server's flattened dir/A256GCM JWE format. The application
 -- still owns authenticated decryption and must use a distinct Calendar key.
 -- The associated data binds the exact attempt, owner, session and OAuth client.
 protected_header:='{"alg":"dir","enc":"A256GCM","kid":"' || key_id ||
  '","typ":"application/vnd.crest.google-calendar-pkce.v1"}';
 binding:=concat_ws(E'\n','crest.google-calendar-pkce.v1',attempt,business,actor,app_session,epoch,generation,google_issuer,google_client,callback);
 IF (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(envelope) k) IS DISTINCT FROM
    ARRAY['aad','ciphertext','iv','protected','tag']
  OR envelope->>'protected' IS DISTINCT FROM crest_private.google_calendar_oauth_base64url(convert_to(protected_header,'UTF8'))
  OR envelope->>'aad' IS DISTINCT FROM crest_private.google_calendar_oauth_base64url(convert_to(binding,'UTF8'))
  OR jsonb_typeof(envelope->'iv') IS DISTINCT FROM 'string' OR envelope->>'iv' COLLATE "C" !~ '^[A-Za-z0-9_-]{16}$'
  OR jsonb_typeof(envelope->'tag') IS DISTINCT FROM 'string' OR envelope->>'tag' COLLATE "C" !~ '^[A-Za-z0-9_-]{22}$'
  OR jsonb_typeof(envelope->'ciphertext') IS DISTINCT FROM 'string'
  OR envelope->>'ciphertext' COLLATE "C" !~ '^[A-Za-z0-9_-]{58,171}$'
 THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 DELETE FROM crest_private.google_calendar_oauth_attempts a WHERE a.business_id=business AND a.expires_at<=stamp-interval '10 minutes';
 IF EXISTS(SELECT FROM crest_private.google_calendar_oauth_attempts a WHERE a.business_id=business AND (a.id=attempt OR a.state_digest=digest))
  OR (SELECT count(*) FROM crest_private.google_calendar_oauth_attempts a
      WHERE a.business_id=business AND a.created_at>stamp-interval '10 minutes')>=5
 THEN RETURN NULL; END IF;
 -- A savepoint also rolls back supersession if a concurrent global digest or
 -- UUID collision made this start unusable.
 BEGIN
  UPDATE crest_private.google_calendar_oauth_attempts a SET retired_at=greatest(stamp,a.created_at),verifier_envelope=NULL
  WHERE a.business_id=business AND a.retired_at IS NULL;
  INSERT INTO crest_private.google_calendar_oauth_attempts(
   id,business_id,actor_id,session_id,recovery_epoch,destination_id,connection_generation,issuer,client_id,callback_uri,
   state_digest,verifier_key_id,verifier_envelope,created_at,expires_at)
  VALUES(attempt,business,actor,app_session,epoch,scope.destination_id,generation,google_issuer,google_client,callback,
   digest,key_id,envelope,stamp,stamp+interval '5 minutes') RETURNING id INTO inserted;
 EXCEPTION WHEN unique_violation THEN RETURN NULL; END;
 RETURN jsonb_build_object('attemptId',inserted,'expiresAt',stamp+interval '5 minutes');
END $start$;

CREATE FUNCTION crest_commands.consume_google_calendar_oauth_attempt(
 credential bytea,app_session uuid,actor uuid,auth_issuer text,subject uuid,provider_session uuid,provider_valid_until timestamptz,
 business uuid,epoch uuid,generation bigint,google_issuer text,google_client text,callback text,attempt uuid,digest bytea
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $consume$
DECLARE scope record; stamp timestamptz; encrypted jsonb;
BEGIN
 SELECT * INTO scope FROM crest_private.lock_google_calendar_oauth_attempt(credential,app_session,actor,auth_issuer,subject,provider_session,
  provider_valid_until,business,epoch,generation,google_issuer,google_client,callback);
 IF NOT FOUND OR attempt IS NULL OR digest IS NULL OR octet_length(digest)<>32 THEN RETURN NULL; END IF;
 stamp:=clock_timestamp();
 SELECT a.verifier_envelope INTO encrypted FROM crest_private.google_calendar_oauth_attempts a
 WHERE (a.business_id,a.actor_id,a.session_id,a.id,a.state_digest)=(business,actor,app_session,attempt,digest)
  AND (a.recovery_epoch,a.connection_generation,a.issuer,a.client_id,a.callback_uri,a.verifier_key_id)
   =(epoch,generation,google_issuer,google_client,callback,scope.verifier_key)
  AND a.destination_id IS NOT DISTINCT FROM scope.destination_id
  AND a.retired_at IS NULL AND a.created_at<=stamp AND a.expires_at>stamp;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE crest_private.google_calendar_oauth_attempts a SET retired_at=stamp,consumed_at=stamp,verifier_envelope=NULL
 WHERE a.business_id=business AND a.id=attempt AND a.retired_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- The server commits before code exchange and may open only this envelope.
 -- A lost consume result requires a new start; it cannot re-release the envelope.
 RETURN jsonb_build_object('attemptId',attempt,'verifierKeyId',scope.verifier_key,'verifierEnvelope',encrypted);
END $consume$;

RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)
 TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.lock_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_private.google_calendar_oauth_base64url(bytea) OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.begin_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea,text,jsonb)
 OWNER TO crest_calendar_oauth_owner;
ALTER FUNCTION crest_commands.consume_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea)
 OWNER TO crest_calendar_oauth_owner;
REVOKE ALL ON FUNCTION crest_private.lock_google_calendar_first_destination(),crest_private.google_calendar_oauth_base64url(bytea),
 crest_private.lock_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text),
 crest_commands.begin_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea,text,jsonb),
 crest_commands.consume_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.begin_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea,text,jsonb),
 crest_commands.consume_google_calendar_oauth_attempt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,text,text,text,uuid,bytea)
 TO crest_calendar_oauth;
