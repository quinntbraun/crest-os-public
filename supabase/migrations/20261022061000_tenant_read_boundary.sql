-- SECURITY2-3: one allowlisted background context read, not a domain-write
-- authority, arbitrary tenant GUC, RLS bypass, or reusable authorization ticket.
DO $review$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='crest_session_owner'
    AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='crest_session_owner'::regrole OR member='crest_session_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_session_owner') AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN
      ('crest_private.actors'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass,
       'crest_private.app_sessions'::regclass,'crest_private.business_recovery_authorities'::regclass,'crest_private.role_capabilities'::regclass)
      AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>6
    OR pg_catalog.has_any_column_privilege('crest_session_owner','crest_private.business_recovery_authorities','SELECT,INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_table_privilege('crest_session_owner','crest_private.business_recovery_authorities','DELETE,TRUNCATE,TRIGGER,MAINTAIN')
    OR pg_catalog.has_any_column_privilege('crest_session_owner','crest_private.role_capabilities','SELECT,INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_table_privilege('crest_session_owner','crest_private.role_capabilities','DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_TENANT_BOUNDARY_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(currency,timezone) ON crest.businesses TO crest_session_owner;
GRANT SELECT(role) ON crest.memberships TO crest_session_owner;
GRANT SELECT(role,capability) ON crest_private.role_capabilities TO crest_session_owner;
GRANT SELECT(id,business_id) ON crest_private.business_recovery_authorities TO crest_session_owner;
-- Lock-only privilege: no recovery update can pass the false WITH CHECK policy.
GRANT UPDATE(id) ON crest_private.business_recovery_authorities TO crest_session_owner;
CREATE POLICY tenant_capability_read ON crest_private.role_capabilities FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY tenant_recovery_read ON crest_private.business_recovery_authorities FOR SELECT TO crest_session_owner USING (true);
CREATE POLICY tenant_recovery_lock ON crest_private.business_recovery_authorities FOR UPDATE TO crest_session_owner USING (true) WITH CHECK (false);

CREATE FUNCTION crest_commands.read_authorized_business_context(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE stamp timestamptz; result jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_TENANT_FRESH_READ_REQUIRED';
  END IF;
  IF credential_hash IS NULL OR octet_length(credential_hash)<>32 OR expected_session IS NULL OR expected_actor IS NULL
    OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 OR expected_subject IS NULL
    OR expected_provider_session IS NULL OR provider_valid_until IS NULL OR NOT isfinite(provider_valid_until) OR requested_business IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_TENANT_INPUT_REQUIRED';
  END IF;
  -- SDK signature/issuer/audience/AAL verification precedes this call in the
  -- server reader. The DB revalidates its exact local/provider binding itself.
  -- Actor before business agrees with identity mutation ordering. Membership
  -- changes require the business root exclusively; never lock membership first.
  PERFORM a.id FROM crest_private.actors a WHERE a.id=expected_actor FOR SHARE;
  PERFORM b.id FROM crest.businesses b WHERE b.id=requested_business FOR SHARE;
  PERFORM r.id FROM crest_private.business_recovery_authorities r WHERE r.business_id=requested_business FOR SHARE;
  PERFORM s.id FROM crest_private.app_sessions s WHERE s.id=expected_session FOR SHARE;
  -- A fresh statement after waits sees completed revocation/membership/epoch
  -- changes. Already-authorized reads may finish; no cross-request cache.
  stamp:=clock_timestamp();
  SELECT jsonb_build_object('actorId',a.id,'businessId',b.id,'currency',b.currency,'timezone',b.timezone) INTO result
    FROM crest_private.app_sessions s JOIN crest_private.actors a ON a.id=s.actor_id
    JOIN crest.memberships m ON m.actor_id=a.id JOIN crest.businesses b ON b.id=m.business_id
    WHERE s.id=expected_session AND s.token_hash=credential_hash AND a.id=expected_actor
      AND s.provider_session_id=expected_provider_session AND a.auth_provider_issuer=expected_issuer AND a.auth_user_id=expected_subject::text
      AND a.kind='owner' AND a.disabled_at IS NULL AND a.current_security_epoch=s.issued_security_epoch
      AND s.revoked_at IS NULL AND s.provider_token_ciphertext IS NOT NULL AND s.key_id IS NOT NULL
      AND s.created_at<=stamp AND s.last_active_at<=stamp AND s.expires_at>stamp
      AND s.created_at>stamp-CASE WHEN s.trusted THEN interval '720 hours' ELSE interval '12 hours' END
      AND (NOT s.trusted OR s.last_active_at>stamp-interval '168 hours') AND provider_valid_until>stamp
      AND b.id=requested_business AND b.status IN ('setup','active') AND m.active
      AND EXISTS (SELECT 1 FROM crest_private.role_capabilities c WHERE c.role=m.role AND c.capability='identity.read')
      AND EXISTS (SELECT 1 FROM crest_private.business_recovery_authorities r WHERE r.business_id=b.id);
  IF result IS NULL OR NOT crest_commands.provider_session_is_live(expected_subject,expected_provider_session) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_TENANT_READ_DENIED';
  END IF;
  -- Context metadata only. No secrets, recovery epoch, writes_enabled switch,
  -- permission list, legal/customer records, foreground activity or mutations.
  RETURN result;
END
$read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) TO crest_web;
