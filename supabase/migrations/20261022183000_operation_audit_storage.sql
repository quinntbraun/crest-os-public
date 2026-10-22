-- ARCHITECTURE5 / DATABASE1-2 / SECURITY3-4: closed storage prerequisites.
-- No claim/replay API, domain write grant, context policy or activation switch.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_schema_owner','crest_command_owner')
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND rolconfig IS NULL)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_schema_owner','crest_command_owner'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_command_owner') AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest.businesses'::regclass,'crest.memberships'::regclass)
      AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>2 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_STORAGE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest_private.operations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  command_type text NOT NULL CHECK (length(command_type)<=100 AND command_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,3}$'),
  schema_version integer NOT NULL CHECK (schema_version>0),
  recovery_epoch uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','committed')),
  result_schema_version integer CHECK (result_schema_version>0),
  result jsonb,
  committed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL CHECK (created_by=actor_id),
  origin text NOT NULL CHECK (origin IN ('manual','import','system')),
  import_row_id uuid,
  UNIQUE(business_id,id),
  UNIQUE(business_id,operation_id),
  UNIQUE(business_id,operation_id,actor_id),
  FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  CHECK (isfinite(created_at)),
  CHECK ((state='pending' AND result_schema_version IS NULL AND result IS NULL AND committed_at IS NULL)
    OR (state='committed' AND result_schema_version IS NOT NULL AND result IS NOT NULL
      AND jsonb_typeof(result)='object' AND result ? 'schemaVersion' AND result->'schemaVersion'=to_jsonb(result_schema_version)
      AND octet_length(result::text)<=65536 AND committed_at IS NOT NULL AND isfinite(committed_at) AND committed_at>=created_at))
);
CREATE INDEX operations_actor ON crest_private.operations(business_id,actor_id);
CREATE INDEX operations_creator ON crest_private.operations(business_id,created_by);
CREATE INDEX operations_cursor ON crest_private.operations(business_id,created_at,id);

CREATE TABLE crest_private.audit_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  entity_kind text NOT NULL CHECK (entity_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  entity_id uuid NOT NULL,
  entity_version bigint NOT NULL CHECK (entity_version>0),
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  reason text CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  effective_at timestamptz CHECK (isfinite(effective_at)),
  delta jsonb NOT NULL CHECK (jsonb_typeof(delta)='object' AND delta ?& ARRAY['schemaVersion','before','after']
    AND delta-ARRAY['schemaVersion','before','after']='{}'::jsonb AND delta->'schemaVersion'='1'::jsonb
    AND jsonb_typeof(delta->'before') IN ('object','null') AND jsonb_typeof(delta->'after') IN ('object','null')
    AND (delta->'before'<>'null'::jsonb OR delta->'after'<>'null'::jsonb) AND octet_length(delta::text)<=262144),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_by uuid NOT NULL CHECK (created_by=actor_id),
  origin text NOT NULL CHECK (origin IN ('manual','import','system')),
  import_row_id uuid,
  database_principal text NOT NULL,
  payload jsonb NOT NULL,
  hash_input text NOT NULL,
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE(business_id,id),
  FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,actor_id) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
  CHECK (created_at=recorded_at AND isfinite(recorded_at)),
  CHECK (jsonb_typeof(payload)='object' AND hash_input=payload::text
    AND event_hash=encode(sha256(convert_to(hash_input,'UTF8')),'hex'))
);
CREATE INDEX audit_events_operation ON crest_private.audit_events(business_id,operation_id,actor_id);
CREATE INDEX audit_events_actor ON crest_private.audit_events(business_id,actor_id);
CREATE INDEX audit_events_creator ON crest_private.audit_events(business_id,created_by);
CREATE INDEX audit_events_entity ON crest_private.audit_events(business_id,entity_kind,entity_id,recorded_at,id);
CREATE INDEX audit_events_cursor ON crest_private.audit_events(business_id,created_at,id);

CREATE FUNCTION crest_private.reject_command_history_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retain$
BEGIN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_RETAINED_COMMAND_HISTORY';
END
$retain$;

CREATE FUNCTION crest_private.validate_operation_change() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $operation$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_CLAIM_REQUIRED';
    END IF;
    NEW.created_at:=clock_timestamp();
  ELSE
    IF OLD.state<>'pending' OR NEW.state IS DISTINCT FROM 'committed'
      OR (to_jsonb(NEW)-ARRAY['state','result_schema_version','result','committed_at'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result_schema_version','result','committed_at']) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_OPERATION';
    END IF;
    NEW.committed_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END
$operation$;

CREATE FUNCTION crest_private.prepare_command_audit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $audit$
DECLARE operation_row crest_private.operations; stamp timestamptz:=clock_timestamp();
BEGIN
  -- Lock the claim before accepting its audit. A committed operation can never
  -- acquire later audit rows, including from another transaction.
  SELECT * INTO operation_row FROM crest_private.operations
    WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id FOR UPDATE;
  IF NOT FOUND OR operation_row.actor_id IS DISTINCT FROM NEW.actor_id THEN
    RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_AUDIT_OPERATION_REQUIRED';
  END IF;
  IF operation_row.state<>'pending' THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_OPERATION';
  END IF;
  IF NEW.origin IS DISTINCT FROM operation_row.origin OR NEW.import_row_id IS DISTINCT FROM operation_row.import_row_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AUDIT_PROVENANCE_REQUIRED';
  END IF;
  NEW.created_at:=stamp; NEW.recorded_at:=stamp; NEW.database_principal:=session_user;
  NEW.payload:=jsonb_build_object('schemaVersion',1,'hashFormat','pg17-jsonb-text-utf8-v1','id',NEW.id,
    'businessId',NEW.business_id,'operationId',NEW.operation_id,'actorId',NEW.actor_id,'createdBy',NEW.created_by,
    'entityKind',NEW.entity_kind,'entityId',NEW.entity_id,'entityVersion',NEW.entity_version::text,
    'action',NEW.action,'reason',NEW.reason,'delta',NEW.delta,'origin',NEW.origin,'importRowId',NEW.import_row_id,
    'databasePrincipal',NEW.database_principal,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'effectiveAt',CASE WHEN NEW.effective_at IS NULL THEN NULL ELSE to_char(NEW.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
  NEW.hash_input:=NEW.payload::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.hash_input,'UTF8')),'hex');
  RETURN NEW;
END
$audit$;

CREATE FUNCTION crest_private.check_operation_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $complete$
BEGIN
  -- Inspect the final row, not the INSERT trigger's pending NEW snapshot.
  IF NOT EXISTS (SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id
      AND o.state='committed' AND EXISTS (SELECT 1 FROM crest_private.audit_events a
        WHERE a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_COMPLETION_REQUIRED';
  END IF;
  RETURN NULL;
END
$complete$;

ALTER TABLE crest_private.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.operations FORCE ROW LEVEL SECURITY;
ALTER TABLE crest_private.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.audit_events FORCE ROW LEVEL SECURITY;
CREATE TRIGGER operation_change BEFORE INSERT OR UPDATE ON crest_private.operations FOR EACH ROW EXECUTE FUNCTION crest_private.validate_operation_change();
CREATE CONSTRAINT TRIGGER operation_completion AFTER INSERT OR UPDATE ON crest_private.operations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_operation_completion();
CREATE TRIGGER audit_prepare BEFORE INSERT ON crest_private.audit_events FOR EACH ROW EXECUTE FUNCTION crest_private.prepare_command_audit();
CREATE TRIGGER retained_update BEFORE UPDATE ON crest_private.audit_events FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest_private.audit_events FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest_private.audit_events FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest_private.operations FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest_private.operations FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
RESET ROLE;
