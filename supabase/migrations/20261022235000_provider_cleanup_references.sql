-- SECURITY2: retain token-free evidence of audited local revocation.
-- A reference is neither provider signout confirmation nor execution authority.
DO $boundary$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
      WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
      WHERE pg_catalog.has_schema_privilege('crest_session_owner',n.oid,'CREATE'))
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('crest_private.app_sessions'::regclass,'crest_private.session_events'::regclass)
      AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>2
    OR pg_catalog.to_regclass('crest_private.provider_cleanup_references') IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CLEANUP_REFERENCE_BOUNDARY_REQUIRED';
  END IF;
END
$boundary$;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_cleanup_references (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  app_session_id uuid NOT NULL UNIQUE REFERENCES crest_private.app_sessions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  provider_session_id uuid NOT NULL UNIQUE,
  issued_security_epoch uuid NOT NULL,
  source_version bigint NOT NULL CHECK (source_version>1),
  revoked_at timestamptz NOT NULL CHECK (isfinite(revoked_at)),
  source_event_id uuid NOT NULL UNIQUE REFERENCES crest_private.session_events(id) ON DELETE RESTRICT,
  source_event_hash text NOT NULL CHECK (source_event_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'review_required' CHECK (state='review_required'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp() CHECK (isfinite(created_at) AND created_at>=revoked_at),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  operation_id uuid
);
CREATE INDEX provider_cleanup_actor ON crest_private.provider_cleanup_references(actor_id,created_at,id);
CREATE INDEX provider_cleanup_creator ON crest_private.provider_cleanup_references(created_by);
CREATE INDEX provider_cleanup_order ON crest_private.provider_cleanup_references(created_at,id);
ALTER TABLE crest_private.provider_cleanup_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_cleanup_references FORCE ROW LEVEL SECURITY;
GRANT INSERT ON crest_private.provider_cleanup_references TO crest_session_owner;
CREATE POLICY cleanup_reference_append ON crest_private.provider_cleanup_references
  FOR INSERT TO crest_session_owner WITH CHECK (true);
GRANT SELECT(id,session_id,actor_id,created_by,operation_id,action,payload,event_hash)
  ON crest_private.session_events TO crest_session_owner;
CREATE POLICY cleanup_reference_source ON crest_private.session_events FOR SELECT TO crest_session_owner USING (true);

CREATE FUNCTION crest_private.validate_cleanup_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $validate$
BEGIN
  -- The invoker is the fixed session definer or explicit migration authority.
  -- No browser field or GUC can supply a source relationship.
  IF NOT EXISTS (
    SELECT 1 FROM crest_private.app_sessions s JOIN crest_private.session_events e ON e.session_id=s.id
    WHERE s.id=NEW.app_session_id AND s.actor_id=NEW.actor_id AND s.provider_session_id=NEW.provider_session_id
      AND s.issued_security_epoch=NEW.issued_security_epoch AND s.revoked_at=NEW.revoked_at
      AND s.version>=NEW.source_version AND e.id=NEW.source_event_id AND e.actor_id=s.actor_id
      AND e.created_by=NEW.created_by AND e.operation_id IS NOT DISTINCT FROM NEW.operation_id
      AND e.action='SECURITY_CHANGED' AND e.event_hash=NEW.source_event_hash
      AND e.event_hash=encode(sha256(convert_to(e.payload::text,'UTF8')),'hex')
      AND e.payload#>>'{after,id}'=s.id::text AND e.payload#>>'{after,actor_id}'=s.actor_id::text
      AND e.payload#>>'{after,issued_security_epoch}'=s.issued_security_epoch::text
      AND e.payload#>>'{after,version}'=NEW.source_version::text
      AND e.payload#>'{before,revoked_at}'='null'::jsonb
      AND (e.payload#>>'{after,revoked_at}')::timestamptz=NEW.revoked_at
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_SOURCE_REQUIRED'; END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END
$validate$;
CREATE TRIGGER cleanup_reference_source BEFORE INSERT ON crest_private.provider_cleanup_references
  FOR EACH ROW EXECUTE FUNCTION crest_private.validate_cleanup_reference();
CREATE TRIGGER cleanup_reference_retained BEFORE UPDATE OR DELETE ON crest_private.provider_cleanup_references
  FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER cleanup_reference_no_truncate BEFORE TRUNCATE ON crest_private.provider_cleanup_references
  FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();
REVOKE ALL ON FUNCTION crest_private.validate_cleanup_reference() FROM PUBLIC;

CREATE FUNCTION crest_private.capture_cleanup_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $capture$
DECLARE evidence record;
BEGIN
  IF TG_TABLE_SCHEMA<>'crest_private' OR TG_TABLE_NAME<>'app_sessions' OR TG_OP<>'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CLEANUP_TRIGGER_REQUIRED';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RETURN NULL; END IF;
  -- session_history sorts before zz_session_cleanup_reference. Its immutable
  -- event must already exist in this same transaction; ambiguity fails closed.
  SELECT e.id,e.event_hash,e.created_by,e.operation_id INTO STRICT evidence FROM crest_private.session_events e
    WHERE e.session_id=NEW.id AND e.actor_id=NEW.actor_id AND e.action='SECURITY_CHANGED'
      AND e.payload#>>'{after,version}'=NEW.version::text;
  INSERT INTO crest_private.provider_cleanup_references
    (app_session_id,actor_id,provider_session_id,issued_security_epoch,source_version,revoked_at,
     source_event_id,source_event_hash,created_by,operation_id)
    VALUES(NEW.id,NEW.actor_id,NEW.provider_session_id,NEW.issued_security_epoch,NEW.version,NEW.revoked_at,
      evidence.id,evidence.event_hash,evidence.created_by,evidence.operation_id);
  RETURN NULL;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.capture_cleanup_reference() FROM PUBLIC;
CREATE TRIGGER zz_session_cleanup_reference AFTER UPDATE ON crest_private.app_sessions
  FOR EACH ROW EXECUTE FUNCTION crest_private.capture_cleanup_reference();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_session_owner;
ALTER FUNCTION crest_private.capture_cleanup_reference() OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_session_owner;

-- Backfill only proven first-revocation events, without modifying any existing
-- session/event/provider row or claiming successful provider cleanup. Sessions
-- initially inserted already revoked and unregistered provider sessions remain
-- outside this evidence set and require the later provider inventory.
INSERT INTO crest_private.provider_cleanup_references
  (app_session_id,actor_id,provider_session_id,issued_security_epoch,source_version,revoked_at,
   source_event_id,source_event_hash,created_by,operation_id)
  SELECT s.id,s.actor_id,s.provider_session_id,s.issued_security_epoch,(e.payload#>>'{after,version}')::bigint,s.revoked_at,
    e.id,e.event_hash,e.created_by,e.operation_id
  FROM crest_private.app_sessions s JOIN crest_private.session_events e ON e.session_id=s.id
  WHERE s.revoked_at IS NOT NULL AND e.action='SECURITY_CHANGED'
    AND e.payload#>'{before,revoked_at}'='null'::jsonb
    AND (e.payload#>>'{after,revoked_at}')::timestamptz=s.revoked_at;
