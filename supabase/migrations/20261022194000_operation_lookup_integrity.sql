-- PostgreSQL17 deferred triggers use the commit-time role. Give only the
-- invariant checkers a stable, read-only nonlogin principal before writers.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_integrity_owner') THEN
    CREATE ROLE crest_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_integrity_owner'
      AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE pg_catalog.has_schema_privilege('crest_integrity_owner',n.oid,'CREATE'))
    OR (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_command_owner','crest_session_owner','crest_schema_owner')
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_command_owner','crest_session_owner','crest_schema_owner','crest_integrity_owner'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest_private.operations','SELECT,INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest_private.audit_events','SELECT,INSERT,UPDATE,REFERENCES')
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest.businesses'::regclass,'crest.memberships'::regclass,
      'crest_private.actors'::regclass,'crest_private.business_recovery_authorities'::regclass,
      'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>6
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('crest.businesses'::regclass,'crest.memberships'::regclass,
      'crest_private.actors'::regclass,'crest_private.business_recovery_authorities'::regclass,'crest_private.app_sessions'::regclass,
      'crest_private.operations'::regclass,'crest_private.audit_events'::regclass)
      AND (pg_catalog.has_any_column_privilege('crest_integrity_owner',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        OR pg_catalog.has_table_privilege('crest_integrity_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE oid IN ('crest_private.check_identity_roots()'::regprocedure,
      'crest_private.check_operation_completion()'::regprocedure) AND proowner='crest_schema_owner'::regrole AND NOT prosecdef)<>2 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_LOOKUP_REVIEW_REQUIRED';
  END IF;
END
$review$;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_integrity_owner REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_integrity_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_integrity_owner REVOKE ALL ON TYPES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_integrity_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private TO crest_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_integrity_owner;
GRANT UPDATE(id) ON crest.businesses TO crest_integrity_owner;
GRANT SELECT(business_id,actor_id,active,role) ON crest.memberships TO crest_integrity_owner;
GRANT SELECT(id,kind,disabled_at) ON crest_private.actors TO crest_integrity_owner;
GRANT SELECT(id,business_id) ON crest_private.business_recovery_authorities TO crest_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,state) ON crest_private.operations TO crest_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id) ON crest_private.audit_events TO crest_integrity_owner;
CREATE POLICY integrity_business_read ON crest.businesses FOR SELECT TO crest_integrity_owner USING (true);
CREATE POLICY integrity_business_lock ON crest.businesses FOR UPDATE TO crest_integrity_owner USING (true) WITH CHECK (false);
CREATE POLICY integrity_membership_read ON crest.memberships FOR SELECT TO crest_integrity_owner USING (true);
CREATE POLICY integrity_actor_read ON crest_private.actors FOR SELECT TO crest_integrity_owner USING (true);
CREATE POLICY integrity_authority_read ON crest_private.business_recovery_authorities FOR SELECT TO crest_integrity_owner USING (true);
CREATE POLICY integrity_operation_read ON crest_private.operations FOR SELECT TO crest_integrity_owner USING (true);
CREATE POLICY integrity_audit_read ON crest_private.audit_events FOR SELECT TO crest_integrity_owner USING (true);
-- Only fixed definer lookup SQL can use these scopes. Web cannot SET ROLE to
-- the owner or read tables; caller GUCs are cleared then replaced after auth.
GRANT SELECT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,state,result) ON crest_private.operations TO crest_command_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action) ON crest_private.audit_events TO crest_command_owner;
CREATE POLICY command_operation_read ON crest_private.operations FOR SELECT TO crest_command_owner USING
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY command_audit_read ON crest_private.audit_events FOR SELECT TO crest_command_owner USING
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_integrity_owner;
ALTER FUNCTION crest_private.check_identity_roots() OWNER TO crest_integrity_owner;
ALTER FUNCTION crest_private.check_operation_completion() OWNER TO crest_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_integrity_owner;
ALTER FUNCTION crest_private.check_identity_roots() SECURITY DEFINER;
ALTER FUNCTION crest_private.check_identity_roots() SET row_security=on;
ALTER FUNCTION crest_private.check_operation_completion() SECURITY DEFINER;
ALTER FUNCTION crest_private.check_operation_completion() SET row_security=on;
REVOKE ALL ON FUNCTION crest_private.check_identity_roots(),crest_private.check_operation_completion() FROM PUBLIC;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.authorize_business_operation_lookup(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $authorize$
DECLARE context jsonb;
BEGIN
  context:=crest_commands.read_authorized_business_context(credential_hash,expected_session,expected_actor,
    expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  IF NOT EXISTS (SELECT 1 FROM crest.memberships m JOIN crest_private.role_capabilities c ON c.role=m.role
      WHERE m.business_id=requested_business AND m.actor_id=expected_actor AND m.active AND c.capability='identity.manage') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_LOOKUP_DENIED';
  END IF;
  RETURN context;
END
$authorize$;
CREATE FUNCTION crest_commands.lookup_business_name_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb; operation_row record; receipt jsonb; version_text text;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true);
  IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_ID_REQUIRED'; END IF;
  context:=crest_commands.authorize_business_operation_lookup(credential_hash,expected_session,expected_actor,
    expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
  SELECT command_type,schema_version,recovery_epoch,state,result INTO operation_row FROM crest_private.operations
    WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  receipt:=operation_row.result;
  IF operation_row.command_type<>'business.rename' OR operation_row.schema_version<>1 OR operation_row.state<>'committed'
    OR receipt IS NULL OR jsonb_typeof(receipt)<>'object' OR NOT receipt ?& ARRAY['schemaVersion','businessId','businessVersion','auditEventId']
    OR receipt-ARRAY['schemaVersion','businessId','businessVersion','auditEventId']<>'{}'::jsonb
    OR receipt->'schemaVersion'<>'1'::jsonb OR receipt->>'businessId' IS DISTINCT FROM requested_business::text
    OR jsonb_typeof(receipt->'businessVersion') IS DISTINCT FROM 'string'
    OR jsonb_typeof(receipt->'auditEventId') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RESULT_REVIEW_REQUIRED';
  END IF;
  version_text:=receipt->>'businessVersion';
  IF version_text !~ '^[1-9][0-9]{0,18}$' OR receipt->>'auditEventId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RESULT_REVIEW_REQUIRED';
  END IF;
  IF version_text::numeric>9223372036854775807 OR NOT EXISTS (SELECT 1 FROM crest_private.audit_events a
      WHERE a.business_id=requested_business AND a.operation_id=requested_operation AND a.actor_id=expected_actor
        AND a.id::text=receipt->>'auditEventId' AND a.entity_kind='businesses' AND a.entity_id=requested_business
        AND a.entity_version::text=version_text AND a.action='rename') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RESULT_REVIEW_REQUIRED';
  END IF;
  -- Original epoch is historical evidence, never the active epoch or permission
  -- to resubmit. Paused writes do not prevent authorized review of old results.
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',operation_row.recovery_epoch,'receipt',receipt);
END
$lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_command_owner;
ALTER FUNCTION crest_commands.authorize_business_operation_lookup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.lookup_business_name_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_business_operation_lookup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),
  crest_commands.lookup_business_name_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_business_operation_lookup(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_business_name_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
