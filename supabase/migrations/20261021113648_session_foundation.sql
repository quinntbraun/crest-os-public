-- SECURITY2 / DATABASE2: private session lifecycle. No authentication endpoint,
-- provider verifier, positive RLS policy, runtime grant or custom cryptography.
DO $boundary$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
    ('crest_schema_owner','crest_command_owner','crest_web','crest_worker','crest_recovery')
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)<>5
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_schema_owner','crest_command_owner','crest_web','crest_worker','crest_recovery'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a
      WHERE r.rolname IN ('crest_schema_owner','crest_command_owner') AND a.grantee<>d.defaclrole) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_SESSION_BOUNDARY_REVIEW_REQUIRED';
  END IF;
END
$boundary$;
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.app_sessions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  provider_session_id uuid NOT NULL UNIQUE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash)=32),
  issued_security_epoch uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  authenticated_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  trusted boolean NOT NULL,
  reauth_at timestamptz,
  provider_token_ciphertext bytea,
  key_id text,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  operation_id uuid,
  CHECK (created_by=actor_id),
  CHECK (isfinite(created_at) AND isfinite(authenticated_at) AND isfinite(last_active_at) AND isfinite(expires_at)),
  CHECK (authenticated_at<=created_at AND last_active_at>=created_at AND last_active_at<expires_at),
  -- Hours, not calendar days: exact elapsed limits across DST/session timezones.
  CHECK (expires_at>created_at AND expires_at<=created_at+CASE WHEN trusted THEN interval '720 hours' ELSE interval '12 hours' END),
  CHECK (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=created_at)),
  CHECK (reauth_at IS NULL OR (isfinite(reauth_at) AND reauth_at>=created_at AND reauth_at<expires_at)),
  CHECK ((provider_token_ciphertext IS NULL AND key_id IS NULL) OR
    (provider_token_ciphertext IS NOT NULL AND key_id IS NOT NULL AND octet_length(provider_token_ciphertext) BETWEEN 1 AND 65536 AND length(btrim(key_id)) BETWEEN 1 AND 100)),
  CHECK (revoked_at IS NULL OR (provider_token_ciphertext IS NULL AND key_id IS NULL))
);
CREATE INDEX app_sessions_actor ON crest_private.app_sessions(actor_id,created_at,id);
CREATE INDEX app_sessions_creator ON crest_private.app_sessions(created_by);
CREATE INDEX app_sessions_updater ON crest_private.app_sessions(updated_by);

CREATE TABLE crest_private.session_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES crest_private.app_sessions(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  operation_id uuid,
  action text NOT NULL CHECK (action IN ('CREATED','SECURITY_CHANGED')),
  database_principal text NOT NULL,
  payload jsonb NOT NULL CHECK (payload @> '{"schemaVersion":1}'::jsonb AND jsonb_typeof(payload)='object'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX session_events_session ON crest_private.session_events(session_id,created_at,id);
CREATE INDEX session_events_actor ON crest_private.session_events(actor_id,created_at,id);
CREATE INDEX session_events_creator ON crest_private.session_events(created_by);

CREATE FUNCTION crest_private.validate_session_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_SESSION_ISOLATION_REQUIRED';
  END IF;
  IF TG_OP='INSERT' THEN
    PERFORM 1 FROM crest_private.actors WHERE id=NEW.actor_id FOR SHARE;
    IF NOT EXISTS (SELECT 1 FROM crest_private.actors a WHERE a.id=NEW.actor_id AND a.kind='owner'
      AND a.disabled_at IS NULL AND a.current_security_epoch=NEW.issued_security_epoch
      AND EXISTS (SELECT 1 FROM crest.memberships m JOIN crest.businesses b ON b.id=m.business_id
        WHERE m.actor_id=a.id AND m.active AND b.status IN ('setup','active'))) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_SESSION_IDENTITY_REQUIRED';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['last_active_at','expires_at','revoked_at','reauth_at','provider_token_ciphertext','key_id','version','updated_at','updated_by','operation_id'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['last_active_at','expires_at','revoked_at','reauth_at','provider_token_ciphertext','key_id','version','updated_at','updated_by','operation_id']) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='CREST_IMMUTABLE_SESSION';
    END IF;
    IF NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_SESSION_VERSION_CONFLICT';
    END IF;
    IF NEW.last_active_at<OLD.last_active_at OR NEW.expires_at>OLD.expires_at
      OR (OLD.reauth_at IS NOT NULL AND (NEW.reauth_at IS NULL OR NEW.reauth_at<OLD.reauth_at)) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_SESSION_TIME_REGRESSION';
    END IF;
    IF OLD.revoked_at IS NOT NULL AND
      ((to_jsonb(NEW)-ARRAY['version','updated_at','updated_by','operation_id']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['version','updated_at','updated_by','operation_id'])) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='CREST_SESSION_REVOCATION_FINAL';
    END IF;
  END IF;
  IF NEW.created_at>stamp OR NEW.authenticated_at>stamp OR NEW.last_active_at>stamp
    OR NEW.reauth_at>stamp OR NEW.revoked_at>stamp THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_SESSION_FUTURE_TIME';
  END IF;
  IF NEW.revoked_at IS NOT NULL THEN NEW.provider_token_ciphertext:=NULL; NEW.key_id:=NULL; END IF;
  NEW.updated_at:=stamp;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION crest_private.record_session_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE
  before_row jsonb;
  after_row jsonb;
  body jsonb;
  event_id uuid:=gen_random_uuid();
  stamp timestamptz:=clock_timestamp();
  fields text[]:=ARRAY['id','actor_id','issued_security_epoch','created_at','authenticated_at','last_active_at',
    'expires_at','revoked_at','trusted','reauth_at','version','created_by','updated_by','origin','operation_id'];
BEGIN
  -- Activity and routine provider refresh are operational state, not repeated
  -- recent-auth assertions or giant history entries on every protected request.
  IF TG_OP='UPDATE' THEN
    IF (NEW.expires_at,NEW.revoked_at,NEW.reauth_at,NEW.key_id)
      IS NOT DISTINCT FROM (OLD.expires_at,OLD.revoked_at,OLD.reauth_at,OLD.key_id) THEN RETURN NULL; END IF;
    SELECT jsonb_object_agg(key,value) INTO before_row FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(fields);
  END IF;
  SELECT jsonb_object_agg(key,value) INTO after_row FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(fields);
  body:=jsonb_build_object('schemaVersion',1,'id',event_id,'sessionId',NEW.id,'actorId',NEW.actor_id,
    'createdBy',NEW.updated_by,'recordedAt',stamp,'databasePrincipal',session_user,
    'before',before_row,'after',after_row);
  INSERT INTO crest_private.session_events(id,session_id,actor_id,created_at,created_by,operation_id,action,database_principal,payload,event_hash)
    VALUES(event_id,NEW.id,NEW.actor_id,stamp,NEW.updated_by,NEW.operation_id,
      CASE WHEN TG_OP='INSERT' THEN 'CREATED' ELSE 'SECURITY_CHANGED' END,session_user,body,
      encode(sha256(convert_to(body::text,'UTF8')),'hex'));
  RETURN NULL;
END
$fn$;

ALTER TABLE crest_private.app_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.app_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.session_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.session_events FORCE ROW LEVEL SECURITY;
CREATE TRIGGER session_change BEFORE INSERT OR UPDATE ON crest_private.app_sessions
  FOR EACH ROW EXECUTE FUNCTION crest_private.validate_session_change();
CREATE TRIGGER session_history AFTER INSERT OR UPDATE ON crest_private.app_sessions
  FOR EACH ROW EXECUTE FUNCTION crest_private.record_session_event();
CREATE TRIGGER retained_session_delete BEFORE DELETE ON crest_private.app_sessions
  FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER retained_session_truncate BEFORE TRUNCATE ON crest_private.app_sessions
  FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER retained_session_event_change BEFORE UPDATE OR DELETE ON crest_private.session_events
  FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER retained_session_event_truncate BEFORE TRUNCATE ON crest_private.session_events
  FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();
RESET ROLE;
