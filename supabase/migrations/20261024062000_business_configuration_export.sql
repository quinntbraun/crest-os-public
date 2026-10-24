-- ADR37: closed, business-scoped portable metadata extraction; no runtime activation.
DO $review$
DECLARE role_name text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.business_recovery_authorities'::regclass)
      AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname='crest_schema_owner' AND a.grantee<>d.defaclrole) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BUSINESS_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['crest_export_owner','crest_export'] LOOP
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
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BUSINESS_EXPORT_ROLE_REVIEW_REQUIRED';
    END IF;
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON ROUTINES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TABLES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON TYPES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SEQUENCES FROM PUBLIC',role_name);
    EXECUTE pg_catalog.format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL ON SCHEMAS FROM PUBLIC',role_name);
  END LOOP;
END
$review$;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_export_owner;
GRANT USAGE ON SCHEMA crest_commands TO crest_export;
GRANT SELECT(id,legal_name,currency,timezone,status,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest.businesses TO crest_export_owner;
GRANT SELECT(id,business_id,actor_id,role,active,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest.memberships TO crest_export_owner;
GRANT SELECT(id,business_id,active_epoch,writes_enabled,incident_id,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest_private.business_recovery_authorities TO crest_export_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY business_export_business ON crest.businesses FOR SELECT TO crest_export_owner USING (true);
CREATE POLICY business_export_membership ON crest.memberships FOR SELECT TO crest_export_owner USING (true);
CREATE POLICY business_export_recovery_authority ON crest_private.business_recovery_authorities FOR SELECT TO crest_export_owner USING (true);
CREATE FUNCTION crest_commands.business_configuration_export_context(expected_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $export$
DECLARE snapshot_token text; member_count bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BUSINESS_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_EXPORT_INPUT_REQUIRED';
  END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN
    RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BUSINESS_EXPORT_SNAPSHOT_REVIEW_REQUIRED';
  END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.business.configuration.snapshot/1',expected_business,snapshot_token)::text,'UTF8')),'hex');
  IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=expected_business)
    OR NOT EXISTS(SELECT 1 FROM crest_private.business_recovery_authorities WHERE business_id=expected_business) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BUSINESS_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  SELECT count(*) INTO member_count FROM crest.memberships WHERE business_id=expected_business;
  IF member_count<1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BUSINESS_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
  RETURN jsonb_build_object('schemaVersion',1,'scope','business_configuration','businessId',expected_business,
    'snapshotToken',snapshot_token,'observedAt',statement_timestamp(),'recordCounts',jsonb_build_object(
      'business','1','membership',member_count::text,'recovery_authority','1'));
END
$export$;
CREATE FUNCTION crest_commands.business_configuration_export_page(expected_business uuid,expected_snapshot text,record_kind text,after_id uuid,requested_page_size integer)
RETURNS TABLE(record_id uuid,representation text,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $export$
DECLARE snapshot_token text; source_cursor refcursor; item record;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BUSINESS_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_EXPORT_INPUT_REQUIRED';
  END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN
    RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BUSINESS_EXPORT_SNAPSHOT_REVIEW_REQUIRED';
  END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.business.configuration.snapshot/1',expected_business,snapshot_token)::text,'UTF8')),'hex');
  IF expected_snapshot IS NULL OR expected_snapshot !~ '^[a-f0-9]{64}$' OR expected_snapshot<>snapshot_token THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_EXPORT_SNAPSHOT_MISMATCH';
  END IF;
  IF record_kind IS NULL OR record_kind NOT IN ('business','membership','recovery_authority')
    OR requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_EXPORT_INPUT_REQUIRED';
  END IF;
  -- Also reject a damaged/nonexistent root, even for an empty cursor page.
  PERFORM crest_commands.business_configuration_export_context(expected_business);
  CASE record_kind
    WHEN 'business' THEN OPEN source_cursor FOR SELECT t.id AS source_id,jsonb_build_object('schemaVersion',1,'kind','business','businessId',expected_business,'row',jsonb_build_object('id',t.id,'legal_name',t.legal_name,'currency',t.currency,'timezone',t.timezone,'status',t.status,'version',t.version::text,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id))::text AS source_body
      FROM crest.businesses t WHERE t.id=expected_business AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
    WHEN 'membership' THEN OPEN source_cursor FOR SELECT t.id AS source_id,jsonb_build_object('schemaVersion',1,'kind','membership','businessId',expected_business,'row',jsonb_build_object('id',t.id,'business_id',t.business_id,'actor_id',t.actor_id,'role',t.role,'active',t.active,'version',t.version::text,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id))::text AS source_body
      FROM crest.memberships t WHERE t.business_id=expected_business AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
    WHEN 'recovery_authority' THEN OPEN source_cursor FOR SELECT t.id AS source_id,jsonb_build_object('schemaVersion',1,'kind','recovery_authority','businessId',expected_business,'row',jsonb_build_object('id',t.id,'business_id',t.business_id,'active_epoch',t.active_epoch,'writes_enabled',t.writes_enabled,'incident_id',t.incident_id,'version',t.version::text,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id))::text AS source_body
      FROM crest_private.business_recovery_authorities t WHERE t.business_id=expected_business AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
  END CASE;
  LOOP
    FETCH source_cursor INTO item; EXIT WHEN NOT FOUND;
    IF item.source_body IS NULL OR octet_length(item.source_body)>8192 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BUSINESS_EXPORT_SOURCE_REVIEW_REQUIRED';
    END IF;
    record_id:=item.source_id;representation:='snapshot_projection';canonical_evidence:=item.source_body;
    evidence_hash:=encode(sha256(convert_to(item.source_body,'UTF8')),'hex');RETURN NEXT;
  END LOOP;
  CLOSE source_cursor;
END
$export$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_export_owner;
ALTER FUNCTION crest_commands.business_configuration_export_context(uuid) OWNER TO crest_export_owner;
ALTER FUNCTION crest_commands.business_configuration_export_page(uuid,text,text,uuid,integer) OWNER TO crest_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_export_owner;
REVOKE ALL ON FUNCTION crest_commands.business_configuration_export_context(uuid),crest_commands.business_configuration_export_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_configuration_export_context(uuid),crest_commands.business_configuration_export_page(uuid,text,text,uuid,integer) TO crest_export;
