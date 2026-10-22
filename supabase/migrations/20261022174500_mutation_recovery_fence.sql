-- ARCHITECTURE5 / SECURITY2-3,7: prerequisite fence, not a domain mutation
-- command, operation ledger, activation switch, or reusable authority token.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_session_owner') AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('crest_private.actors'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass,
       'crest_private.app_sessions'::regclass,'crest_private.role_capabilities'::regclass,'crest_private.business_recovery_authorities'::regclass)
      AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>6
    OR pg_catalog.has_column_privilege('crest_session_owner','crest_private.business_recovery_authorities','active_epoch','SELECT')
    OR pg_catalog.has_column_privilege('crest_session_owner','crest_private.business_recovery_authorities','writes_enabled','SELECT') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MUTATION_FENCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(active_epoch,writes_enabled) ON crest_private.business_recovery_authorities TO crest_session_owner;

CREATE FUNCTION crest_commands.lock_mutation_authority(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
  requested_business uuid,expected_recovery_epoch uuid,required_capability text,recent_required boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $fence$
DECLARE stamp timestamptz; authority_epoch uuid; enabled boolean;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MUTATION_FRESH_READ_REQUIRED';
  END IF;
  IF credential_hash IS NULL OR octet_length(credential_hash)<>32 OR expected_session IS NULL OR expected_actor IS NULL
    OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR expected_subject IS NULL
    OR expected_provider_session IS NULL OR provider_valid_until IS NULL OR NOT isfinite(provider_valid_until)
    OR requested_business IS NULL OR expected_recovery_epoch IS NULL OR recent_required IS NULL OR required_capability IS NULL
    OR required_capability NOT IN ('identity.manage','crm.manage','finance.post','export.bulk') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MUTATION_INPUT_REQUIRED';
  END IF;
  -- Provider signature verification must occur on the server before this DB
  -- transaction. Lock local identity/session before the recovery authority.
  PERFORM a.id FROM crest_private.actors a WHERE a.id=expected_actor FOR SHARE;
  PERFORM b.id FROM crest.businesses b WHERE b.id=requested_business FOR SHARE;
  -- Serialize foreground session activity, refresh and revoke; two commands
  -- must not both take SHARE and later deadlock upgrading the same session.
  PERFORM s.id FROM crest_private.app_sessions s WHERE s.id=expected_session FOR UPDATE;
  stamp:=clock_timestamp();
  IF NOT EXISTS (SELECT 1 FROM crest_private.app_sessions s JOIN crest_private.actors a ON a.id=s.actor_id
    JOIN crest.memberships m ON m.actor_id=a.id JOIN crest.businesses b ON b.id=m.business_id
    WHERE s.id=expected_session AND s.token_hash=credential_hash AND a.id=expected_actor
      AND s.provider_session_id=expected_provider_session AND a.auth_provider_issuer=expected_issuer AND a.auth_user_id=expected_subject::text
      AND a.kind='owner' AND a.disabled_at IS NULL AND a.current_security_epoch=s.issued_security_epoch
      AND s.revoked_at IS NULL AND s.provider_token_ciphertext IS NOT NULL AND s.key_id IS NOT NULL
      AND s.created_at<=stamp AND s.last_active_at<=stamp AND (s.reauth_at IS NULL OR s.reauth_at<=stamp) AND s.expires_at>stamp
      AND s.created_at>stamp-CASE WHEN s.trusted THEN interval '720 hours' ELSE interval '12 hours' END
      AND (NOT s.trusted OR s.last_active_at>stamp-interval '168 hours') AND provider_valid_until>stamp
      AND (NOT (recent_required OR required_capability='export.bulk') OR coalesce(s.reauth_at,s.authenticated_at)>stamp-interval '15 minutes')
      AND b.id=requested_business AND b.status IN ('setup','active') AND m.active
      AND EXISTS (SELECT 1 FROM crest_private.role_capabilities c WHERE c.role=m.role AND c.capability=required_capability))
    OR NOT crest_commands.provider_session_is_live(expected_subject,expected_provider_session) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MUTATION_AUTHORIZATION_DENIED';
  END IF;
  PERFORM r.id FROM crest_private.business_recovery_authorities r WHERE r.business_id=requested_business FOR SHARE;
  -- Fresh checks AFTER the last wait; never replace an old command's epoch.
  stamp:=clock_timestamp();
  IF provider_valid_until<=stamp OR NOT EXISTS (SELECT 1 FROM crest_private.app_sessions s
      WHERE s.id=expected_session AND s.revoked_at IS NULL AND s.created_at<=stamp AND s.last_active_at<=stamp
        AND (s.reauth_at IS NULL OR s.reauth_at<=stamp)
        AND s.expires_at>stamp AND s.created_at>stamp-CASE WHEN s.trusted THEN interval '720 hours' ELSE interval '12 hours' END
        AND (NOT s.trusted OR s.last_active_at>stamp-interval '168 hours')
        AND (NOT (recent_required OR required_capability='export.bulk') OR coalesce(s.reauth_at,s.authenticated_at)>stamp-interval '15 minutes'))
    OR NOT crest_commands.provider_session_is_live(expected_subject,expected_provider_session) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MUTATION_AUTHORIZATION_DENIED';
  END IF;
  SELECT r.active_epoch,r.writes_enabled INTO authority_epoch,enabled FROM crest_private.business_recovery_authorities r WHERE r.business_id=requested_business;
  IF authority_epoch IS DISTINCT FROM expected_recovery_epoch OR enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='RECOVERY_REVIEW_REQUIRED';
  END IF;
  RETURN jsonb_build_object('actorId',expected_actor,'businessId',requested_business,'sessionId',expected_session,
    'recoveryEpoch',expected_recovery_epoch,'capability',required_capability);
END
$fence$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_web;
