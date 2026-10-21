-- DATABASE 1-2 / SECURITY 2-3 / F1. Closed identity storage, not a login API.
-- Reject hidden default grants before creating any sensitive relation/routine.
DO $defaults$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN
      ('crest_schema_owner','crest_command_owner','crest_web','crest_worker','crest_recovery')
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND rolconfig IS NULL)<>5
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r
      ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_schema_owner','crest_command_owner','crest_web','crest_worker','crest_recovery')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_ROLE_REVIEW_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
    LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE r.rolname IN ('crest_schema_owner','crest_command_owner')
      AND a.grantee<>d.defaclrole
  ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='CREST_DEFAULT_GRANTS_REVIEW_REQUIRED';
  END IF;
END
$defaults$;

SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.actors (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('owner','system')),
  display_label text NOT NULL CHECK (length(btrim(display_label)) BETWEEN 1 AND 200),
  system_key text UNIQUE,
  auth_provider_issuer text,
  auth_user_id text,
  current_security_epoch uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  disabled_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  updated_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  origin text NOT NULL CHECK (origin IN ('manual','import','system')),
  operation_id uuid,
  import_row_id uuid,
  UNIQUE(auth_provider_issuer,auth_user_id),
  CHECK (
    (kind='system' AND system_key IS NOT NULL AND system_key ~ '^[a-z][a-z0-9_]{0,63}$' AND auth_provider_issuer IS NULL AND auth_user_id IS NULL)
    OR (kind='owner' AND system_key IS NULL AND auth_provider_issuer IS NOT NULL AND auth_user_id IS NOT NULL
      AND length(btrim(auth_provider_issuer)) BETWEEN 1 AND 500 AND length(btrim(auth_user_id)) BETWEEN 1 AND 255)
  )
);
CREATE INDEX actors_created_by ON crest_private.actors(created_by);
CREATE INDEX actors_updated_by ON crest_private.actors(updated_by);

CREATE TABLE crest.businesses (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','active','suspended')),
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('manual','import','system')),
  operation_id uuid,
  import_row_id uuid
);
CREATE INDEX businesses_created_by ON crest.businesses(created_by);
CREATE INDEX businesses_updated_by ON crest.businesses(updated_by);

CREATE TABLE crest.memberships (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role='owner'),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('manual','import','system')),
  operation_id uuid,
  import_row_id uuid,
  UNIQUE(business_id,id),
  UNIQUE(business_id,actor_id),
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX memberships_actor ON crest.memberships(actor_id,business_id);
CREATE INDEX memberships_creator ON crest.memberships(business_id,created_by);
CREATE INDEX memberships_updater ON crest.memberships(business_id,updated_by);
CREATE INDEX memberships_cursor ON crest.memberships(business_id,created_at,id);
ALTER TABLE crest.businesses ADD CONSTRAINT business_creator_membership
  FOREIGN KEY(id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE crest.businesses ADD CONSTRAINT business_updater_membership
  FOREIGN KEY(id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE crest_private.business_recovery_authorities (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  active_epoch uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  writes_enabled boolean NOT NULL DEFAULT false,
  incident_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  updated_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('manual','import','system')),
  operation_id uuid,
  import_row_id uuid,
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX recovery_creator ON crest_private.business_recovery_authorities(business_id,created_by);
CREATE INDEX recovery_updater ON crest_private.business_recovery_authorities(business_id,updated_by);
CREATE INDEX recovery_cursor ON crest_private.business_recovery_authorities(business_id,created_at,id);

-- Migration-maintained names, not SQL privileges or an executable authorization API.
CREATE TABLE crest_private.role_capabilities (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  role text NOT NULL CHECK (role='owner'),
  capability text NOT NULL CHECK (capability IN ('identity.read','identity.manage','crm.manage','finance.post','export.bulk')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  operation_id uuid,
  import_row_id uuid,
  UNIQUE(role,capability)
);
CREATE INDEX role_capabilities_creator ON crest_private.role_capabilities(created_by);

-- Global identity changes need history even before a tenant exists. This is
-- separate from future business audit_events and never includes session secrets.
CREATE TABLE crest_private.identity_events (
  id uuid PRIMARY KEY,
  business_id uuid REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  operation_id uuid,
  import_row_id uuid,
  entity_kind text NOT NULL CHECK (entity_kind IN ('actors','businesses','memberships','business_recovery_authorities','role_capabilities')),
  entity_id uuid NOT NULL,
  entity_version bigint NOT NULL CHECK (entity_version>0),
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE')),
  database_principal text NOT NULL,
  payload jsonb NOT NULL CHECK (payload @> '{"schemaVersion":1}'::jsonb AND jsonb_typeof(payload)='object'),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX identity_events_creator ON crest_private.identity_events(created_by);
CREATE INDEX identity_events_entity ON crest_private.identity_events(business_id,entity_kind,entity_id,created_at,id);
CREATE INDEX identity_events_cursor ON crest_private.identity_events(business_id,created_at,id);
CREATE INDEX identity_events_operation ON crest_private.identity_events(business_id,operation_id);

CREATE FUNCTION crest_private.reject_identity_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='CREST_RETAINED_IDENTITY_HISTORY';
END
$fn$;

CREATE FUNCTION crest_private.validate_identity_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
  -- The owner invariant relies on fresh snapshots after the tenant-root lock.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_IDENTITY_ISOLATION_REQUIRED';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['display_label','current_security_epoch','disabled_at','legal_name','currency','timezone','status','active','active_epoch','writes_enabled','incident_id','version','updated_at','updated_by','operation_id'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['display_label','current_security_epoch','disabled_at','legal_name','currency','timezone','status','active','active_epoch','writes_enabled','incident_id','version','updated_at','updated_by','operation_id']) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='CREST_IMMUTABLE_IDENTITY';
    END IF;
    IF NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_VERSION_CONFLICT';
    END IF;
    NEW.updated_at:=clock_timestamp();
  END IF;
  IF TG_TABLE_NAME='businesses' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_INVALID_TIMEZONE';
    END IF;
  END IF;
  IF TG_TABLE_NAME='memberships' THEN
    -- FOR SHARE conflicts with actor disable, not only provider-key changes.
    -- Lock actor before tenant root; a late membership cannot evade disable checks.
    PERFORM 1 FROM crest_private.actors WHERE id=NEW.actor_id FOR SHARE;
    IF NOT EXISTS (SELECT 1 FROM crest_private.actors WHERE id=NEW.actor_id AND kind='owner') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_OWNER_IDENTITY_REQUIRED';
    END IF;
    PERFORM 1 FROM crest.businesses WHERE id=NEW.business_id FOR UPDATE;
  ELSIF TG_TABLE_NAME='actors' AND TG_OP='UPDATE' THEN
    PERFORM b.id FROM crest.businesses b JOIN crest.memberships m ON m.business_id=b.id
      WHERE m.actor_id=NEW.id ORDER BY b.id FOR UPDATE OF b;
  END IF;
  RETURN NEW;
END
$fn$;

CREATE FUNCTION crest_private.check_identity_roots() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE
  business uuid;
BEGIN
  FOR business IN
    SELECT b.id FROM crest.businesses b WHERE
      (TG_TABLE_NAME='businesses' AND b.id=NEW.id)
      OR (TG_TABLE_NAME='memberships' AND b.id=(to_jsonb(NEW)->>'business_id')::uuid)
      OR (TG_TABLE_NAME='actors' AND EXISTS (SELECT 1 FROM crest.memberships m WHERE m.business_id=b.id AND m.actor_id=NEW.id))
    ORDER BY b.id
  LOOP
    PERFORM 1 FROM crest.businesses WHERE id=business FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM crest.memberships m JOIN crest_private.actors a ON a.id=m.actor_id
      WHERE m.business_id=business AND m.active AND m.role='owner' AND a.kind='owner' AND a.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_LAST_ACTIVE_OWNER';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM crest_private.business_recovery_authorities r WHERE r.business_id=business) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CREST_RECOVERY_AUTHORITY_REQUIRED';
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;

CREATE FUNCTION crest_private.record_identity_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE
  row_after jsonb:=to_jsonb(NEW);
  row_before jsonb;
  safe_after jsonb;
  safe_before jsonb;
  event_id uuid:=gen_random_uuid();
  stamp timestamptz:=clock_timestamp();
  business uuid;
  actor uuid:=coalesce(row_after->>'updated_by',row_after->>'created_by')::uuid;
  body jsonb;
  -- Explicit allowlist: future secret columns must never enter this history.
  fields text[]:=ARRAY['id','business_id','kind','display_label','system_key','auth_provider_issuer','auth_user_id',
    'current_security_epoch','disabled_at','legal_name','currency','timezone','status','actor_id','role','active',
    'active_epoch','writes_enabled','incident_id','capability','version','created_at','updated_at','created_by',
    'updated_by','origin','operation_id','import_row_id'];
BEGIN
  IF TG_OP='UPDATE' THEN row_before:=to_jsonb(OLD); END IF;
  SELECT jsonb_object_agg(key,value) INTO safe_after FROM jsonb_each(row_after) WHERE key=ANY(fields);
  SELECT jsonb_object_agg(key,value) INTO safe_before FROM jsonb_each(row_before) WHERE key=ANY(fields);
  business:=CASE WHEN TG_TABLE_NAME='businesses' THEN NEW.id ELSE (row_after->>'business_id')::uuid END;
  body:=jsonb_build_object('schemaVersion',1,'id',event_id,'businessId',business,'createdBy',actor,
    'recordedAt',stamp,'operationId',row_after->>'operation_id','entityKind',TG_TABLE_NAME,'entityId',NEW.id,
    'entityVersion',coalesce((row_after->>'version')::bigint,1),'action',TG_OP,'databasePrincipal',session_user,
    'before',safe_before,'after',safe_after);
  INSERT INTO crest_private.identity_events(id,business_id,created_at,created_by,operation_id,entity_kind,
    entity_id,entity_version,action,database_principal,payload,event_hash)
  VALUES(event_id,business,stamp,actor,(row_after->>'operation_id')::uuid,TG_TABLE_NAME,NEW.id,
    coalesce((row_after->>'version')::bigint,1),TG_OP,session_user,body,
    encode(sha256(convert_to(body::text,'UTF8')),'hex'));
  RETURN NULL;
END
$fn$;

DO $triggers$
DECLARE
  relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['crest_private.actors','crest.businesses','crest.memberships',
    'crest_private.business_recovery_authorities','crest_private.role_capabilities','crest_private.identity_events']
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE TRIGGER retained_delete BEFORE DELETE ON %s FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal()',relation);
    EXECUTE format('CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal()',relation);
    IF relation IN ('crest_private.role_capabilities','crest_private.identity_events') THEN
      EXECUTE format('CREATE TRIGGER retained_update BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal()',relation);
    ELSE
      EXECUTE format('CREATE TRIGGER identity_change BEFORE INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION crest_private.validate_identity_change()',relation);
    END IF;
    IF relation<>'crest_private.identity_events' THEN
      EXECUTE format('CREATE TRIGGER identity_history AFTER INSERT OR UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION crest_private.record_identity_event()',relation);
    END IF;
    IF relation IN ('crest.businesses','crest.memberships','crest_private.actors') THEN
      EXECUTE format('CREATE CONSTRAINT TRIGGER identity_roots AFTER INSERT OR UPDATE ON %s DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_identity_roots()',relation);
    END IF;
  END LOOP;
END
$triggers$;

RESET ROLE;
-- Only a powerless technical actor/capability names are seeded. No tenant/owner,
-- provider user, credential, active write authority, session or login is created.
DO $seed$
DECLARE
  actor uuid:=pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO crest_private.actors(id,kind,display_label,system_key,created_by,updated_by,origin)
    VALUES(actor,'system','Crest security bootstrap','security_bootstrap',actor,actor,'system');
  INSERT INTO crest_private.role_capabilities(role,capability,created_by)
    SELECT 'owner',capability,actor FROM unnest(ARRAY['identity.read','identity.manage','crm.manage','finance.post','export.bulk']) AS capability;
END
$seed$;
-- No RLS policies, runtime table grants or positive EXECUTE grants in this slice.
