-- SECURITY2: maintenance-only observations, never revocation authority.
DO $review$
DECLARE role_name text;
BEGIN
  -- Review the exact provider projection again; never adopt incompatible DDL.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relname='sessions' AND c.relkind='r' AND c.relrowsecurity
      AND pg_catalog.pg_get_userbyid(c.relowner)='supabase_auth_admin')
    OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=pg_catalog.to_regclass('auth.sessions')
      AND NOT attisdropped AND ((attname IN ('id','user_id') AND atttypid='uuid'::regtype)
        OR (attname='not_after' AND atttypid='timestamptz'::regtype)
        OR (attname='aal' AND atttypid=pg_catalog.to_regtype('auth.aal_level'))))<>4 THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_PROVIDER_SCHEMA_REVIEW_REQUIRED';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['crest_inventory_owner','crest_inventory'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname=role_name)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
        LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname=role_name AND a.grantee<>d.defaclrole)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.relowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=r.oid))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute c JOIN pg_catalog.pg_roles r ON r.rolname=role_name,
        LATERAL pg_catalog.aclexplode(c.attacl) a WHERE a.grantee=r.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.nspowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.nspacl) a WHERE a.grantee=r.oid))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.proowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.proacl) a WHERE a.grantee=r.oid))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_type c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
        WHERE c.typowner=r.oid OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.typacl) a WHERE a.grantee=r.oid)) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVENTORY_ROLE_REVIEW_REQUIRED';
    END IF;
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON ROUTINES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TYPES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SCHEMAS FROM PUBLIC',role_name);
  END LOOP;
END
$review$;

GRANT USAGE ON SCHEMA auth,crest_private TO crest_inventory_owner;
GRANT SELECT(id,user_id,not_after,aal) ON auth.sessions TO crest_inventory_owner;
CREATE POLICY crest_inventory_sessions ON auth.sessions FOR SELECT TO crest_inventory_owner USING (true);
GRANT SELECT(id,kind,auth_provider_issuer,auth_user_id,current_security_epoch,disabled_at) ON crest_private.actors TO crest_inventory_owner;
GRANT SELECT(id,actor_id,provider_session_id,issued_security_epoch,expires_at,revoked_at) ON crest_private.app_sessions TO crest_inventory_owner;
GRANT SELECT(id,app_session_id,actor_id,provider_session_id) ON crest_private.provider_cleanup_references TO crest_inventory_owner;
CREATE POLICY inventory_actors ON crest_private.actors FOR SELECT TO crest_inventory_owner USING (true);
CREATE POLICY inventory_app_sessions ON crest_private.app_sessions FOR SELECT TO crest_inventory_owner USING (true);
CREATE POLICY inventory_cleanup_references ON crest_private.provider_cleanup_references FOR SELECT TO crest_inventory_owner USING (true);

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.provider_session_inventory(expected_actor uuid,expected_issuer text,after_session uuid,page_size integer)
RETURNS TABLE(provider_session_id uuid,app_session_id uuid,cleanup_reference_id uuid,provider_aal text,
  provider_not_after timestamptz,provider_unexpired boolean,local_revoked_at timestamptz,local_expires_at timestamptz,
  local_epoch_current boolean,actor_disabled boolean,observed_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $inventory$
DECLARE subject_text text; subject_id uuid; stamp timestamptz:=pg_catalog.statement_timestamp();
BEGIN
  IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_INVENTORY_FRESH_READ_REQUIRED';
  END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR pg_catalog.length(expected_issuer) NOT BETWEEN 1 AND 500
    OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVENTORY_INPUT_REQUIRED';
  END IF;
  SELECT a.auth_user_id INTO subject_text FROM crest_private.actors a
    WHERE a.id=expected_actor AND a.kind='owner' AND a.auth_provider_issuer=expected_issuer;
  IF NOT FOUND OR subject_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVENTORY_BINDING_REQUIRED';
  END IF;
  subject_id:=subject_text::uuid;
  -- STABLE uses one calling-statement snapshot for binding and projection.
  -- No locks, activity update, secret columns, provider DML or cleanup claim.
  RETURN QUERY SELECT p.id,s.id,r.id,p.aal::text,p.not_after,
    p.not_after IS NULL OR (pg_catalog.isfinite(p.not_after) AND p.not_after>stamp),
    s.revoked_at,s.expires_at,s.issued_security_epoch=a.current_security_epoch,a.disabled_at IS NOT NULL,stamp
    FROM auth.sessions p
    JOIN crest_private.actors a ON a.id=expected_actor AND a.auth_provider_issuer=expected_issuer AND a.auth_user_id=subject_text
    LEFT JOIN crest_private.app_sessions s ON s.provider_session_id=p.id AND s.actor_id=a.id
    LEFT JOIN crest_private.provider_cleanup_references r ON r.app_session_id=s.id AND r.actor_id=a.id AND r.provider_session_id=p.id
    WHERE p.user_id=subject_id AND (after_session IS NULL OR p.id>after_session)
    ORDER BY p.id LIMIT page_size;
END
$inventory$;
RESET ROLE;
GRANT USAGE,CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_session_inventory(uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.provider_session_inventory(uuid,text,uuid,integer) FROM PUBLIC;
GRANT USAGE ON SCHEMA crest_commands TO crest_inventory;
GRANT EXECUTE ON FUNCTION crest_commands.provider_session_inventory(uuid,text,uuid,integer) TO crest_inventory;
-- No login/membership is provisioned. Ordinary app/worker/recovery roles cannot
-- call or assume this maintenance boundary. Observations never authorize DML.
