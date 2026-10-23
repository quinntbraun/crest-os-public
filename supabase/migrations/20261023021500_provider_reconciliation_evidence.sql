-- SECURITY2: immutable, token-free scan evidence; never cleanup authority.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_inventory_owner','crest_inventory')
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
    AND rolconfig IS NULL)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_inventory_owner','crest_inventory'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege('crest_inventory_owner',n.oid,'CREATE')
      OR pg_catalog.has_schema_privilege('crest_inventory',n.oid,'CREATE'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_inventory_owner') AND a.grantee<>d.defaclrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.sessions'::regclass,'auth.users'::regclass,'auth.refresh_tokens'::regclass,
      'crest_private.actors'::regclass,'crest_private.app_sessions'::regclass,'crest_private.provider_cleanup_references'::regclass,'crest_private.session_events'::regclass)
      AND (pg_catalog.has_any_column_privilege('crest_inventory_owner',c.oid,'INSERT,UPDATE,REFERENCES')
        OR pg_catalog.has_table_privilege('crest_inventory_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.users'::regclass,'auth.refresh_tokens'::regclass,'crest_private.session_events'::regclass)
      AND pg_catalog.has_any_column_privilege('crest_inventory_owner',c.oid,'SELECT'))
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid='crest_commands.provider_session_inventory(uuid,text,uuid,integer)'::regprocedure
      AND proowner='crest_inventory_owner'::regrole AND prosecdef AND provolatile='s'
      AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on']) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECONCILIATION_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.provider_inventory_observations (
  request_id uuid PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  actor_id uuid NOT NULL REFERENCES crest_private.actors(id) ON DELETE RESTRICT,
  provider_issuer text NOT NULL CHECK (length(provider_issuer) BETWEEN 1 AND 500),
  after_session uuid,
  page_size integer NOT NULL CHECK (page_size BETWEEN 1 AND 100),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  created_at timestamptz NOT NULL CHECK (isfinite(created_at) AND created_at>=observed_at),
  database_principal text NOT NULL,
  origin text NOT NULL DEFAULT 'system' CHECK (origin='system'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object' AND evidence @> '{"schemaVersion":1}'::jsonb
    AND jsonb_typeof(evidence->'observations')='array' AND jsonb_array_length(evidence->'observations')<=page_size),
  canonical_evidence text NOT NULL CHECK (octet_length(canonical_evidence)<=262144 AND canonical_evidence::jsonb=evidence),
  event_hash text NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$' AND event_hash=encode(sha256(convert_to(canonical_evidence,'UTF8')),'hex'))
);
CREATE INDEX inventory_observations_actor ON crest_private.provider_inventory_observations(actor_id,created_at,request_id);
ALTER TABLE crest_private.provider_inventory_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.provider_inventory_observations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest_private.provider_inventory_observations TO crest_inventory_owner;
CREATE POLICY inventory_observation_read ON crest_private.provider_inventory_observations FOR SELECT TO crest_inventory_owner USING (true);
CREATE POLICY inventory_observation_append ON crest_private.provider_inventory_observations FOR INSERT TO crest_inventory_owner WITH CHECK (true);

-- Derive the whole safe body from the fixed reader once, including raw admin
-- INSERTs. Supplied timestamps, findings, hashes and principal are discarded.
CREATE FUNCTION crest_private.capture_inventory_observation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on
SET TimeZone='UTC' SET DateStyle='ISO, YMD' AS $capture$
DECLARE samples jsonb; last_session uuid;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('classification',
    CASE WHEN i.local_revoked_at IS NOT NULL THEN 'local_revocation_review'
      WHEN i.app_session_id IS NULL THEN 'unregistered_review'
      WHEN i.actor_disabled OR i.local_epoch_current IS DISTINCT FROM true OR i.local_expires_at<=i.observed_at
        OR i.provider_unexpired IS DISTINCT FROM true OR i.provider_aal IS DISTINCT FROM 'aal2' THEN 'registered_review'
      ELSE 'registered_observed' END) ORDER BY i.provider_session_id),'[]'::jsonb)
    INTO samples FROM crest_commands.provider_session_inventory(NEW.actor_id,NEW.provider_issuer,NEW.after_session,NEW.page_size) i;
  last_session:=(samples->-1->>'provider_session_id')::uuid;
  NEW.schema_version:=1; NEW.origin:='system'; NEW.observed_at:=statement_timestamp(); NEW.created_at:=clock_timestamp(); NEW.database_principal:=session_user;
  NEW.evidence:=jsonb_build_object('schemaVersion',1,'requestId',NEW.request_id,'actorId',NEW.actor_id,
    'providerIssuer',NEW.provider_issuer,'afterSessionId',NEW.after_session,'pageSize',NEW.page_size,
    'observedAt',NEW.observed_at,'recordedAt',NEW.created_at,'databasePrincipal',NEW.database_principal,
    'origin',NEW.origin,'observationCount',jsonb_array_length(samples),'lastSessionId',last_session,'observations',samples);
  NEW.canonical_evidence:=NEW.evidence::text;
  NEW.event_hash:=encode(sha256(convert_to(NEW.canonical_evidence,'UTF8')),'hex');
  RETURN NEW;
END
$capture$;
REVOKE ALL ON FUNCTION crest_private.capture_inventory_observation() FROM PUBLIC;
CREATE TRIGGER inventory_observation_capture BEFORE INSERT ON crest_private.provider_inventory_observations
  FOR EACH ROW EXECUTE FUNCTION crest_private.capture_inventory_observation();
CREATE TRIGGER inventory_observation_retained BEFORE UPDATE OR DELETE ON crest_private.provider_inventory_observations
  FOR EACH ROW EXECUTE FUNCTION crest_private.reject_identity_removal();
CREATE TRIGGER inventory_observation_no_truncate BEFORE TRUNCATE ON crest_private.provider_inventory_observations
  FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_identity_removal();

CREATE FUNCTION crest_commands.record_provider_inventory(requested_id uuid,expected_actor uuid,expected_issuer text,after_session uuid,page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $record$
DECLARE saved crest_private.provider_inventory_observations%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_INVENTORY_FRESH_READ_REQUIRED';
  END IF;
  IF requested_id IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500
    OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVENTORY_INPUT_REQUIRED';
  END IF;
  -- No wait on another attempt; the adapter must retain the same request ID.
  -- This lock is request-scoped, not actor/business/recovery authorization.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('crest.provider.inventory/1:'||requested_id::text,0)) THEN
    RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='CREST_INVENTORY_REQUEST_BUSY';
  END IF;
  SELECT o.* INTO saved FROM crest_private.provider_inventory_observations o WHERE o.request_id=requested_id;
  IF FOUND THEN
    IF (saved.actor_id,saved.provider_issuer,saved.after_session,saved.page_size) IS DISTINCT FROM (expected_actor,expected_issuer,after_session,page_size) THEN
      RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='CREST_INVENTORY_REQUEST_CONFLICT';
    END IF;
  ELSE
    INSERT INTO crest_private.provider_inventory_observations(request_id,actor_id,provider_issuer,after_session,page_size)
      VALUES(requested_id,expected_actor,expected_issuer,record_provider_inventory.after_session,record_provider_inventory.page_size) RETURNING * INTO saved;
  END IF;
  RETURN jsonb_build_object('evidence',saved.evidence,'evidenceHash',saved.event_hash,'canonicalEvidence',saved.canonical_evidence);
END
$record$;

-- Historical lookup deliberately does not contact/reinterpret current provider
-- state, advance a cursor or authorize a cleanup action.
CREATE FUNCTION crest_commands.read_provider_inventory_observation(requested_id uuid,expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE result jsonb;
BEGIN
  IF requested_id IS NULL OR expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVENTORY_INPUT_REQUIRED';
  END IF;
  SELECT jsonb_build_object('evidence',o.evidence,'evidenceHash',o.event_hash,'canonicalEvidence',o.canonical_evidence) INTO result
    FROM crest_private.provider_inventory_observations o WHERE o.request_id=requested_id AND o.actor_id=expected_actor AND o.provider_issuer=expected_issuer;
  RETURN result;
END
$read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.record_provider_inventory(uuid,uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
ALTER FUNCTION crest_commands.read_provider_inventory_observation(uuid,uuid,text) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.record_provider_inventory(uuid,uuid,text,uuid,integer),crest_commands.read_provider_inventory_observation(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.record_provider_inventory(uuid,uuid,text,uuid,integer),crest_commands.read_provider_inventory_observation(uuid,uuid,text) TO crest_inventory;
