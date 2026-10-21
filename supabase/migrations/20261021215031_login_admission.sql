-- SECURITY4: operational rolling login limits; no browser authentication grant.
DO $boundary$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_login_owner') THEN
    CREATE ROLE crest_login_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_login_owner'
    AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_login_owner'::regrole OR member='crest_login_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE pg_catalog.has_schema_privilege('crest_login_owner',oid,'CREATE')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_OWNER_REVIEW_REQUIRED';
  END IF;
END
$boundary$;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_login_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_login_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_login_owner REVOKE ALL ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_login_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_login_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
GRANT USAGE ON SCHEMA crest_private,crest_commands TO crest_login_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.login_limit_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  key_fingerprint bytea CHECK (key_fingerprint IS NULL OR octet_length(key_fingerprint)=32)
);
INSERT INTO crest_private.login_limit_state(singleton) VALUES(true);
CREATE TABLE crest_private.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier_hash bytea NOT NULL CHECK (octet_length(identifier_hash)=32),
  ip_hash bytea NOT NULL CHECK (octet_length(ip_hash)=32),
  admitted_at timestamptz NOT NULL CHECK (isfinite(admitted_at))
);
CREATE INDEX login_attempt_identifier ON crest_private.login_attempts(identifier_hash,admitted_at);
CREATE INDEX login_attempt_ip ON crest_private.login_attempts(ip_hash,admitted_at);
CREATE INDEX login_attempt_expiry ON crest_private.login_attempts(admitted_at,id);
CREATE FUNCTION crest_private.retain_login_key() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,pg_temp AS $retain$
BEGIN
  IF OLD.key_fingerprint IS NOT NULL AND NEW.key_fingerprint IS DISTINCT FROM OLD.key_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_KEY_CHANGE_REVIEW_REQUIRED';
  END IF;
  RETURN NEW;
END
$retain$;
CREATE TRIGGER login_key_immutable BEFORE UPDATE ON crest_private.login_limit_state
  FOR EACH ROW EXECUTE FUNCTION crest_private.retain_login_key();
ALTER TABLE crest_private.login_limit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.login_limit_state FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.login_attempts FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest_private.login_limit_state,crest_private.login_attempts TO crest_login_owner;
GRANT UPDATE(key_fingerprint) ON crest_private.login_limit_state TO crest_login_owner;
GRANT INSERT(identifier_hash,ip_hash,admitted_at),DELETE ON crest_private.login_attempts TO crest_login_owner;
CREATE POLICY login_state_read ON crest_private.login_limit_state FOR SELECT TO crest_login_owner USING (true);
CREATE POLICY login_state_bind ON crest_private.login_limit_state FOR UPDATE TO crest_login_owner USING (true) WITH CHECK (key_fingerprint IS NOT NULL);
CREATE POLICY login_attempt_read ON crest_private.login_attempts FOR SELECT TO crest_login_owner USING (true);
CREATE POLICY login_attempt_insert ON crest_private.login_attempts FOR INSERT TO crest_login_owner WITH CHECK (true);
CREATE POLICY login_attempt_expire ON crest_private.login_attempts FOR DELETE TO crest_login_owner
  USING (admitted_at<=clock_timestamp()-interval '15 minutes');
CREATE FUNCTION crest_commands.admit_login(identifier_digest bytea,ip_digest bytea,expected_key bytea)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE stored_key bytea; stamp timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LOGIN_FRESH_READ_REQUIRED';
  END IF;
  IF identifier_digest IS NULL OR octet_length(identifier_digest)<>32 OR ip_digest IS NULL OR octet_length(ip_digest)<>32
    OR expected_key IS NULL OR octet_length(expected_key)<>32 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LOGIN_INPUT_REQUIRED';
  END IF;
  -- One short operational lock: the transaction ends before any provider I/O.
  -- This avoids unbounded per-identifier lock rows and cross-key deadlocks.
  SELECT key_fingerprint INTO stored_key FROM crest_private.login_limit_state WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LOGIN_STATE_REQUIRED'; END IF;
  IF stored_key IS NULL THEN
    UPDATE crest_private.login_limit_state SET key_fingerprint=expected_key WHERE singleton;
  ELSIF stored_key<>expected_key THEN RETURN false;
  END IF;
  stamp:=clock_timestamp();
  DELETE FROM crest_private.login_attempts WHERE id IN
    (SELECT id FROM crest_private.login_attempts WHERE admitted_at<=stamp-interval '15 minutes' ORDER BY admitted_at,id LIMIT 256);
  IF (SELECT count(*) FROM crest_private.login_attempts WHERE identifier_hash=identifier_digest AND admitted_at>stamp-interval '15 minutes')>=5
    OR (SELECT count(*) FROM crest_private.login_attempts WHERE ip_hash=ip_digest AND admitted_at>stamp-interval '15 minutes')>=20 THEN
    RETURN false;
  END IF;
  INSERT INTO crest_private.login_attempts(identifier_hash,ip_hash,admitted_at) VALUES(identifier_digest,ip_digest,stamp);
  RETURN true;
END
$admit$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_login_owner;
ALTER FUNCTION crest_commands.admit_login(bytea,bytea,bytea) OWNER TO crest_login_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_login_owner;
REVOKE ALL ON FUNCTION crest_commands.admit_login(bytea,bytea,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.admit_login(bytea,bytea,bytea) TO crest_web;
