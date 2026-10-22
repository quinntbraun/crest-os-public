-- P01: point-in-time settings for an explicitly reviewed NEW command.
-- This read never rebases pending commands, enables writes or advances activity.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest.businesses'::regclass,'crest.memberships'::regclass,
      'crest_private.actors'::regclass,'crest_private.app_sessions'::regclass,'crest_private.business_recovery_authorities'::regclass,
      'crest_private.role_capabilities'::regclass) AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>6
    OR pg_catalog.has_column_privilege('crest_session_owner','crest.businesses','legal_name','SELECT')
    OR pg_catalog.has_column_privilege('crest_session_owner','crest.businesses','version','SELECT') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SETTINGS_CONTEXT_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(legal_name,version) ON crest.businesses TO crest_session_owner;
CREATE FUNCTION crest_commands.read_business_settings_context(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_SETTINGS_FRESH_READ_REQUIRED';
  END IF;
  IF credential_hash IS NULL OR octet_length(credential_hash)<>32 OR expected_session IS NULL OR expected_actor IS NULL
    OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR expected_subject IS NULL
    OR expected_provider_session IS NULL OR provider_valid_until IS NULL OR NOT isfinite(provider_valid_until) OR requested_business IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_SETTINGS_CONTEXT_INPUT_REQUIRED';
  END IF;
  -- Match current command ordering before calling the older read authorizer.
  -- All locks are shared: this is not a command/activity/session mutation.
  PERFORM a.id FROM crest_private.actors a WHERE a.id=expected_actor FOR SHARE;
  PERFORM b.id FROM crest.businesses b WHERE b.id=requested_business FOR SHARE;
  PERFORM s.id FROM crest_private.app_sessions s WHERE s.id=expected_session FOR SHARE;
  PERFORM r.id FROM crest_private.business_recovery_authorities r WHERE r.business_id=requested_business FOR SHARE;
  -- Fresh local/provider/capability checks AFTER every possible lock wait.
  -- This helper requires BOTH identity.read and identity.manage, even paused.
  context:=crest_commands.authorize_business_operation_lookup(credential_hash,expected_session,expected_actor,
    expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
  SELECT jsonb_build_object('schemaVersion',1,'businessId',b.id,'legalName',b.legal_name,'businessVersion',b.version::text,
    'writeState',CASE WHEN r.writes_enabled THEN 'ready' ELSE 'paused' END,
    'recoveryEpoch',CASE WHEN r.writes_enabled THEN r.active_epoch ELSE NULL END) INTO result
    FROM crest.businesses b JOIN crest_private.business_recovery_authorities r ON r.business_id=b.id
    WHERE b.id=(context->>'businessId')::uuid;
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_SETTINGS_CONTEXT_DENIED'; END IF;
  RETURN result;
END
$read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.read_business_settings_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.read_business_settings_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_business_settings_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) TO crest_web;
