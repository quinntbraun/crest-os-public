-- ADR40: isolated current safe app-session metadata; published SQL remains immutable.
DO $review$
DECLARE role_name text:='crest_session_export_owner';
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname='crest_export'
      AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>1
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_export')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege('crest_export',n.oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('crest','crest_private','auth') AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
        has_any_column_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') ELSE false END)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('crest','crest_private','auth') AND CASE WHEN c.relkind='S' THEN has_sequence_privilege('crest_export',c.oid,'USAGE,SELECT,UPDATE') ELSE false END)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('crest','crest_private','crest_commands') AND has_function_privilege('crest_export',p.oid,'EXECUTE')
      AND p.oid NOT IN ('crest_commands.business_configuration_export_context(uuid)'::regprocedure,'crest_commands.business_configuration_export_page(uuid,text,text,uuid,integer)'::regprocedure,
        'crest_commands.business_history_export_context(uuid)'::regprocedure,'crest_commands.business_history_export_page(uuid,text,text,uuid,integer)'::regprocedure,
        'crest_commands.business_identity_export_context(uuid)'::regprocedure,'crest_commands.business_identity_export_page(uuid,text,text,uuid,integer)'::regprocedure))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname='crest_schema_owner' AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest_private.actors'::regclass,'crest_private.app_sessions'::regclass) AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>2 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_METADATA_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
    CREATE ROLE crest_session_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname=role_name)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname=role_name AND a.grantee<>d.defaclrole)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
      WHERE c.relowner=r.oid OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.relacl) a WHERE a.grantee=r.oid))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute c JOIN pg_catalog.pg_roles r ON r.rolname=role_name,
      LATERAL pg_catalog.aclexplode(c.attacl) a WHERE a.grantee=r.oid)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
      WHERE c.nspowner=r.oid OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.nspacl) a WHERE a.grantee=r.oid))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
      WHERE c.proowner=r.oid OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.proacl) a WHERE a.grantee=r.oid))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege(role_name,n.oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('crest','crest_private','auth') AND CASE WHEN c.relkind IN ('r','p','v','m','f') THEN
        has_any_column_privilege(role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(role_name,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
        WHEN c.relkind='S' THEN has_sequence_privilege(role_name,c.oid,'USAGE,SELECT,UPDATE') ELSE false END)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('crest','crest_private','crest_commands') AND has_function_privilege(role_name,p.oid,'EXECUTE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_type c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
      WHERE c.typowner=r.oid OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.typacl) a WHERE a.grantee=r.oid)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SESSION_METADATA_ROLE_REVIEW_REQUIRED';
  END IF;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_export_owner REVOKE ALL ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_export_owner REVOKE ALL ON TYPES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_export_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_session_export_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
END
$review$;

-- ADR40: current safe metadata is a projection, never a credential or authority.
GRANT USAGE ON SCHEMA crest_private,crest_commands TO crest_session_export_owner;
GRANT SELECT(id,auth_provider_issuer) ON crest_private.actors TO crest_session_export_owner;
GRANT SELECT(id,actor_id,provider_session_id,issued_security_epoch,created_at,authenticated_at,last_active_at,expires_at,revoked_at,trusted,reauth_at,version,updated_at,created_by,updated_by,origin,operation_id)
  ON crest_private.app_sessions TO crest_session_export_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY session_metadata_export_actor ON crest_private.actors FOR SELECT TO crest_session_export_owner USING(true);
CREATE POLICY session_metadata_export_session ON crest_private.app_sessions FOR SELECT TO crest_session_export_owner USING(true);

CREATE FUNCTION crest_commands.session_metadata_export_context(expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE snapshot_text text; fingerprint text; source_count bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SESSION_METADATA_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(btrim(expected_issuer)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_METADATA_INPUT_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM crest_private.actors WHERE id=expected_actor AND auth_provider_issuer=expected_issuer) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SESSION_METADATA_SCOPE_REQUIRED';
  END IF;
  snapshot_text:=pg_current_snapshot()::text;
  IF octet_length(snapshot_text)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_SESSION_METADATA_BUDGET_REQUIRED'; END IF;
  SELECT count(*) INTO source_count FROM (SELECT 1 FROM crest_private.app_sessions WHERE actor_id=expected_actor LIMIT 1001) AS bounded_source;
  IF source_count>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_SESSION_METADATA_BUDGET_REQUIRED'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_array('crest.application.session.metadata.snapshot/1',expected_actor,expected_issuer,snapshot_text)::text,'UTF8')),'hex');
  RETURN jsonb_build_object('schemaVersion',1,'scope','application_session_metadata','actorId',expected_actor,'providerIssuer',expected_issuer,
    'snapshotToken',fingerprint,'observedAt',statement_timestamp(),'recordCount',source_count::text);
END
$fn$;
CREATE FUNCTION crest_commands.session_metadata_export_page(expected_actor uuid,expected_issuer text,expected_snapshot text,after_id uuid,requested_page_size integer)
RETURNS TABLE(record_id uuid,representation text,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE context jsonb; item record; body text; total_bytes integer:=0;
BEGIN
  context:=crest_commands.session_metadata_export_context(expected_actor,expected_issuer);
  IF expected_snapshot IS NULL OR expected_snapshot !~ '^[a-f0-9]{64}$' OR expected_snapshot IS DISTINCT FROM context->>'snapshotToken' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_METADATA_SNAPSHOT_MISMATCH';
  END IF;
  IF requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SESSION_METADATA_INPUT_REQUIRED';
  END IF;
  FOR item IN SELECT s.id AS source_id,
    isfinite(s.created_at) AND isfinite(s.authenticated_at) AND isfinite(s.last_active_at) AND isfinite(s.expires_at) AND isfinite(s.updated_at)
      AND (s.revoked_at IS NULL OR isfinite(s.revoked_at)) AND (s.reauth_at IS NULL OR isfinite(s.reauth_at)) AS finite_source,
    jsonb_build_object('schemaVersion',1,'scope','application_session_metadata','actorId',expected_actor,'providerIssuer',expected_issuer,
      'jsonTextColumns','[]'::jsonb,'row',jsonb_build_object('id',s.id,'actor_id',s.actor_id,'provider_session_id',s.provider_session_id,
      'issued_security_epoch',s.issued_security_epoch,'created_at',s.created_at,'authenticated_at',s.authenticated_at,'last_active_at',s.last_active_at,
      'expires_at',s.expires_at,'revoked_at',s.revoked_at,'trusted',s.trusted,'reauth_at',s.reauth_at,'version',s.version::text,'updated_at',s.updated_at,
      'created_by',s.created_by,'updated_by',s.updated_by,'origin',s.origin,'operation_id',s.operation_id))::text AS source_body
    FROM crest_private.app_sessions s WHERE s.actor_id=expected_actor AND (after_id IS NULL OR s.id>after_id) ORDER BY s.id LIMIT requested_page_size
  LOOP
    IF item.finite_source IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_SESSION_METADATA_SOURCE_REVIEW_REQUIRED'; END IF;
    body:=item.source_body;
    IF body IS NULL OR octet_length(body)>8192 OR total_bytes+octet_length(body)>163840 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_SESSION_METADATA_BUDGET_REQUIRED';
    END IF;
    total_bytes:=total_bytes+octet_length(body);record_id:=item.source_id;representation:='snapshot_projection';canonical_evidence:=body;
    evidence_hash:=encode(sha256(convert_to(body,'UTF8')),'hex');RETURN NEXT;
  END LOOP;
END
$fn$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_export_owner;
ALTER FUNCTION crest_commands.session_metadata_export_context(uuid,text) OWNER TO crest_session_export_owner;
ALTER FUNCTION crest_commands.session_metadata_export_page(uuid,text,text,uuid,integer) OWNER TO crest_session_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_export_owner;
REVOKE ALL ON FUNCTION crest_commands.session_metadata_export_context(uuid,text),crest_commands.session_metadata_export_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.session_metadata_export_context(uuid,text),crest_commands.session_metadata_export_page(uuid,text,text,uuid,integer) TO crest_export;
