-- Historical review only: missing evidence never authorizes cleanup or closure.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_inventory_owner','crest_inventory')
      AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
      AND rolconfig IS NULL)<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_inventory_owner','crest_inventory'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege('crest_inventory_owner',n.oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_inventory_owner') AND a.grantee<>d.defaclrole)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.sessions'::regclass,'auth.users'::regclass,
      'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass,'crest_private.provider_login_attempts'::regclass,
      'crest_private.provider_login_targets'::regclass,'crest_private.provider_login_finishes'::regclass,'crest_private.provider_cleanup_outcomes'::regclass)
      AND (has_any_column_privilege('crest_inventory_owner',c.oid,'INSERT,UPDATE,REFERENCES')
        OR has_table_privilege('crest_inventory_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer)'::regprocedure
      AND proowner='crest_inventory_owner'::regrole AND prosecdef AND provolatile='s'
      AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p,LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid='crest_commands.provider_login_attempt_inventory(uuid,text,uuid,integer)'::regprocedure AND a.grantee=0) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECONCILIATION_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.provider_reconciliation_review(expected_actor uuid,expected_issuer text,after_attempt uuid,page_size integer)
RETURNS TABLE(attempt_id uuid,observation jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $inventory$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_RECONCILIATION_FRESH_READ_REQUIRED';
  END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500
    OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RECONCILIATION_INPUT_REQUIRED';
  END IF;
  RETURN QUERY
  WITH attempts AS MATERIALIZED (
    SELECT * FROM crest_commands.provider_login_attempt_inventory(expected_actor,expected_issuer,after_attempt,page_size)
  ), facts AS (
    SELECT a.*,t.provider_session_id AS target_session,t.event_hash AS target_hash,
      c.id AS closed_id,c.event_hash AS closed_hash,z.id AS stopped_id,z.event_hash AS stopped_hash,
      r.request_id,r.event_hash AS request_hash,o.outcome,o.event_hash AS outcome_hash,
      -- An inconsistent restored/privileged source is review, never completion.
      (a.registration_state<>'binding_conflict_review'
        AND (t.attempt_id IS NULL OR (t.actor_id=expected_actor AND t.provider_issuer=expected_issuer
          AND t.issued_security_epoch=(a.evidence->>'securityEpoch')::uuid AND t.provider_subject=(a.evidence->>'providerSubject')::uuid
          AND (a.provider_session_id IS NULL OR a.provider_session_id=t.provider_session_id)))
        AND (c.id IS NULL OR (c.actor_id=expected_actor AND c.provider_issuer=expected_issuer
          AND c.issued_security_epoch=(a.evidence->>'securityEpoch')::uuid AND c.provider_subject=(a.evidence->>'providerSubject')::uuid
          AND (c.provider_session_id IS NULL OR c.provider_session_id=t.provider_session_id)))
        AND (z.id IS NULL OR (z.actor_id=expected_actor AND z.provider_issuer=expected_issuer
          AND z.issued_security_epoch=(a.evidence->>'securityEpoch')::uuid AND z.provider_subject=(a.evidence->>'providerSubject')::uuid
          AND (z.provider_session_id IS NULL OR z.provider_session_id=t.provider_session_id)))
        AND (r.request_id IS NULL OR (r.actor_id=expected_actor AND r.provider_issuer=expected_issuer
          AND r.issued_security_epoch=(a.evidence->>'securityEpoch')::uuid AND r.provider_subject=(a.evidence->>'providerSubject')::uuid
          AND r.attempt_id=a.attempt_id AND r.app_session_id=(a.evidence->>'appSessionId')::uuid
          AND r.provider_session_id=t.provider_session_id AND r.canonical_evidence::jsonb->>'sourceFinishHash'=z.event_hash
          AND r.canonical_evidence::jsonb->>'targetHash'=t.event_hash))
        AND (o.request_id IS NULL OR (o.actor_id=expected_actor AND o.provider_issuer=expected_issuer
          AND o.provider_subject=(a.evidence->>'providerSubject')::uuid AND o.provider_session_id=t.provider_session_id
          AND o.canonical_evidence::jsonb->>'requestHash'=r.event_hash))) IS TRUE AS consistent
    FROM attempts a
    LEFT JOIN crest_private.provider_login_targets t ON t.attempt_id=a.attempt_id
    LEFT JOIN crest_private.provider_login_finishes c ON c.attempt_id=a.attempt_id AND c.phase='registration_closed'
    LEFT JOIN crest_private.provider_login_finishes z ON z.attempt_id=a.attempt_id AND z.phase='stopped_review'
    LEFT JOIN crest_private.provider_cleanup_requests r ON r.source_finish_id=z.id
    LEFT JOIN crest_private.provider_cleanup_outcomes o ON o.request_id=r.request_id
  )
  SELECT f.attempt_id,jsonb_build_object('schemaVersion',1,'observedAt',statement_timestamp(),
    'attempt',jsonb_build_object('attemptId',f.attempt_id,'actorId',expected_actor,'providerIssuer',expected_issuer,
      'providerSubject',f.evidence->>'providerSubject','securityEpoch',f.evidence->>'securityEpoch',
      'appSessionId',f.evidence->>'appSessionId','evidenceHash',f.evidence_hash),
    'reviewState',CASE WHEN NOT f.consistent THEN 'binding_conflict_review'
      WHEN f.target_hash IS NULL THEN 'target_unconfirmed_review'
      WHEN f.stopped_id IS NULL AND f.closed_id IS NULL THEN 'finish_unconfirmed_review'
      WHEN f.stopped_id IS NULL THEN 'registration_closed_recorded'
      WHEN f.request_id IS NULL THEN 'stopped_without_request_review'
      WHEN f.outcome_hash IS NULL THEN 'cleanup_outcome_unconfirmed_review'
      ELSE 'cleanup_outcome_recorded' END,
    'registration',jsonb_build_object('state',f.registration_state,
      'providerSessionId',CASE WHEN f.consistent THEN f.provider_session_id END,
      'localRevokedAt',CASE WHEN f.consistent THEN f.local_revoked_at END),
    'target',CASE WHEN f.consistent AND f.target_hash IS NOT NULL THEN jsonb_build_object('providerSessionId',f.target_session,'evidenceHash',f.target_hash) END,
    'registrationFinish',CASE WHEN f.consistent AND f.closed_id IS NOT NULL THEN jsonb_build_object('finishId',f.closed_id,'evidenceHash',f.closed_hash) END,
    'stop',CASE WHEN f.consistent AND f.stopped_id IS NOT NULL THEN jsonb_build_object('finishId',f.stopped_id,'evidenceHash',f.stopped_hash) END,
    'request',CASE WHEN f.consistent AND f.request_id IS NOT NULL THEN jsonb_build_object('requestId',f.request_id,'evidenceHash',f.request_hash) END,
    'outcome',CASE WHEN f.consistent AND f.outcome_hash IS NOT NULL THEN jsonb_build_object('outcome',f.outcome,'evidenceHash',f.outcome_hash) END)
  FROM facts f ORDER BY f.attempt_id;
END
$inventory$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_reconciliation_review(uuid,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.provider_reconciliation_review(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.provider_reconciliation_review(uuid,text,uuid,integer) TO crest_inventory;
-- No new table privilege, source write, provider I/O, login or executable cleanup grant.
