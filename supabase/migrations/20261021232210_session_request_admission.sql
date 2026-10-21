-- SECURITY4: durable rolling per-session admission, never authentication evidence.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege('crest_session_owner',n.oid,'CREATE'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid='crest_private.app_sessions'::regclass
      AND (NOT relrowsecurity OR NOT relforcerowsecurity OR relowner<>'crest_schema_owner'::regrole)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_ADMISSION_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.session_request_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id),
  bucket text NOT NULL CHECK (bucket IN ('ordinary','logout')),
  admitted_at timestamptz NOT NULL CHECK (isfinite(admitted_at))
);
CREATE INDEX session_request_window ON crest_private.session_request_admissions(session_id,bucket,admitted_at,id);
ALTER TABLE crest_private.session_request_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.session_request_admissions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON crest_private.session_request_admissions TO crest_session_owner;
CREATE POLICY session_request_read ON crest_private.session_request_admissions FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY session_request_insert ON crest_private.session_request_admissions FOR INSERT TO crest_session_owner WITH CHECK (true);
CREATE POLICY session_request_expire ON crest_private.session_request_admissions FOR DELETE TO crest_session_owner
  USING (admitted_at<=clock_timestamp()-interval '1 minute');

CREATE FUNCTION crest_commands.admit_session_request(credential bytea,request_bucket text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $admit$
DECLARE parent_id uuid; stamp timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_ADMISSION_FRESH_READ_REQUIRED'; END IF;
  IF credential IS NULL OR octet_length(credential)<>32 OR request_bucket IS NULL OR request_bucket NOT IN ('ordinary','logout') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_ADMISSION_INPUT_REQUIRED';
  END IF;
  -- Only this session root is locked, with no subsequent actor/business lock.
  -- Existing expired/revoked sessions may reserve logout work; this is not eligibility.
  SELECT s.id INTO parent_id FROM crest_private.app_sessions s WHERE s.token_hash=credential FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  stamp:=clock_timestamp();
  -- Logical TTL is one minute. At most 240 rows/session are produced by this API;
  -- bounded pruning also tolerates privileged fixture/maintenance backlogs.
  DELETE FROM crest_private.session_request_admissions WHERE id IN
    (SELECT id FROM crest_private.session_request_admissions WHERE session_id=parent_id AND admitted_at<=stamp-interval '1 minute'
      ORDER BY admitted_at,id LIMIT 240);
  -- Future timestamps remain counted after a backward clock step: fail conservative.
  IF (SELECT count(*) FROM crest_private.session_request_admissions WHERE session_id=parent_id AND bucket=request_bucket
      AND admitted_at>stamp-interval '1 minute')>=120 THEN RETURN false; END IF;
  INSERT INTO crest_private.session_request_admissions(session_id,bucket,admitted_at) VALUES(parent_id,request_bucket,stamp);
  RETURN true;
END
$admit$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.admit_session_request(bytea,text) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.admit_session_request(bytea,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.admit_session_request(bytea,text) TO crest_web;
