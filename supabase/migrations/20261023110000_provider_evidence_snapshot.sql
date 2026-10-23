-- Read-only scoped source extraction. No export job, Ready marker or restore authority.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_inventory_owner','crest_inventory')
      AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_inventory_owner','crest_inventory'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege('crest_inventory_owner',n.oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_inventory_owner') AND a.grantee<>d.defaclrole)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='crest_private' AND c.relname IN ('provider_inventory_observations','provider_login_attempts','provider_login_targets','provider_login_finishes','provider_cleanup_requests','provider_cleanup_outcomes')
      AND (c.relkind<>'r' OR c.relowner<>'crest_schema_owner'::regrole OR NOT(c.relrowsecurity AND c.relforcerowsecurity)
        OR NOT has_table_privilege('crest_inventory_owner',c.oid,'SELECT') OR has_any_column_privilege('crest_inventory',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        OR has_any_column_privilege('crest_inventory_owner',c.oid,'UPDATE,REFERENCES') OR has_table_privilege('crest_inventory_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
        OR c.relname NOT IN ('provider_inventory_observations','provider_cleanup_requests') AND has_any_column_privilege('crest_inventory_owner',c.oid,'INSERT')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.sessions'::regclass,'auth.users'::regclass,'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass)
      AND (has_any_column_privilege('crest_inventory_owner',c.oid,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_inventory_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='auth.sessions'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','user_id','not_after','aal') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.actors'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','kind','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.app_sessions'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','actor_id','provider_session_id','issued_security_epoch','expires_at','revoked_at') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.session_events'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','session_id','actor_id','operation_id','action') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.users'::regclass,'auth.refresh_tokens'::regclass)
      AND has_any_column_privilege('crest_inventory_owner',c.oid,'SELECT')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PROVIDER_EXPORT_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE INDEX inventory_export_scope ON crest_private.provider_inventory_observations(actor_id,provider_issuer,request_id);
CREATE INDEX attempt_export_scope ON crest_private.provider_login_attempts(actor_id,provider_issuer,attempt_id);
CREATE INDEX target_export_scope ON crest_private.provider_login_targets(actor_id,provider_issuer,attempt_id);
CREATE INDEX finish_export_scope ON crest_private.provider_login_finishes(actor_id,provider_issuer,id);
CREATE INDEX request_export_scope ON crest_private.provider_cleanup_requests(actor_id,provider_issuer,request_id);
CREATE INDEX outcome_export_scope ON crest_private.provider_cleanup_outcomes(actor_id,provider_issuer,request_id);
CREATE FUNCTION crest_commands.provider_evidence_export_context(expected_actor uuid,expected_issuer text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $export$
DECLARE snapshot_token text;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PROVIDER_EXPORT_INPUT_REQUIRED';
  END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.provider.export.snapshot/1',expected_actor,expected_issuer,snapshot_token)::text,'UTF8')),'hex');
  RETURN jsonb_build_object('schemaVersion',1,'scope','retained_provider_ledgers','actorId',expected_actor,'providerIssuer',expected_issuer,
    'snapshotToken',snapshot_token,'observedAt',statement_timestamp(),'ledgerCounts',jsonb_build_object(
      'inventory_observation',(SELECT count(*)::text FROM crest_private.provider_inventory_observations WHERE actor_id=expected_actor AND provider_issuer=expected_issuer),
      'login_attempt',(SELECT count(*)::text FROM crest_private.provider_login_attempts WHERE actor_id=expected_actor AND provider_issuer=expected_issuer),
      'login_target',(SELECT count(*)::text FROM crest_private.provider_login_targets WHERE actor_id=expected_actor AND provider_issuer=expected_issuer),
      'login_finish',(SELECT count(*)::text FROM crest_private.provider_login_finishes WHERE actor_id=expected_actor AND provider_issuer=expected_issuer),
      'cleanup_request',(SELECT count(*)::text FROM crest_private.provider_cleanup_requests WHERE actor_id=expected_actor AND provider_issuer=expected_issuer),
      'cleanup_outcome',(SELECT count(*)::text FROM crest_private.provider_cleanup_outcomes WHERE actor_id=expected_actor AND provider_issuer=expected_issuer)));
END
$export$;
CREATE FUNCTION crest_commands.provider_evidence_export_page(expected_actor uuid,expected_issuer text,expected_snapshot text,ledger_kind text,after_id uuid,requested_page_size integer)
RETURNS TABLE(record_id uuid,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $export$
DECLARE source_cursor refcursor; item record; snapshot_token text; body_limit integer:=8192;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PROVIDER_EXPORT_INPUT_REQUIRED';
  END IF;
  IF expected_snapshot IS NULL OR expected_snapshot !~ '^[a-f0-9]{64}$' OR ledger_kind IS NULL
    OR ledger_kind NOT IN ('inventory_observation','login_attempt','login_target','login_finish','cleanup_request','cleanup_outcome')
    OR requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PROVIDER_EXPORT_INPUT_REQUIRED';
  END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.provider.export.snapshot/1',expected_actor,expected_issuer,snapshot_token)::text,'UTF8')),'hex');
  IF expected_snapshot<>snapshot_token THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_CHANGED';
  END IF;
  IF ledger_kind='inventory_observation' THEN body_limit:=262144; END IF;
  CASE ledger_kind
    WHEN 'inventory_observation' THEN OPEN source_cursor FOR SELECT t.request_id AS source_id,t.canonical_evidence AS source_body,t.event_hash AS source_hash
      FROM crest_private.provider_inventory_observations t WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_id IS NULL OR t.request_id>after_id) ORDER BY t.request_id LIMIT requested_page_size;
    WHEN 'login_attempt' THEN OPEN source_cursor FOR SELECT t.attempt_id AS source_id,t.canonical_evidence AS source_body,t.event_hash AS source_hash
      FROM crest_private.provider_login_attempts t WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_id IS NULL OR t.attempt_id>after_id) ORDER BY t.attempt_id LIMIT requested_page_size;
    WHEN 'login_target' THEN OPEN source_cursor FOR SELECT t.attempt_id AS source_id,t.canonical_evidence AS source_body,t.event_hash AS source_hash
      FROM crest_private.provider_login_targets t WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_id IS NULL OR t.attempt_id>after_id) ORDER BY t.attempt_id LIMIT requested_page_size;
    WHEN 'login_finish' THEN OPEN source_cursor FOR SELECT t.id AS source_id,t.canonical_evidence AS source_body,t.event_hash AS source_hash
      FROM crest_private.provider_login_finishes t WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
    WHEN 'cleanup_request' THEN OPEN source_cursor FOR SELECT t.request_id AS source_id,t.canonical_evidence AS source_body,t.event_hash AS source_hash
      FROM crest_private.provider_cleanup_requests t WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_id IS NULL OR t.request_id>after_id) ORDER BY t.request_id LIMIT requested_page_size;
    WHEN 'cleanup_outcome' THEN OPEN source_cursor FOR SELECT t.request_id AS source_id,t.canonical_evidence AS source_body,t.event_hash AS source_hash
      FROM crest_private.provider_cleanup_outcomes t WHERE t.actor_id=expected_actor AND t.provider_issuer=expected_issuer AND (after_id IS NULL OR t.request_id>after_id) ORDER BY t.request_id LIMIT requested_page_size;
  END CASE;
  LOOP
    FETCH source_cursor INTO item; EXIT WHEN NOT FOUND;
    -- A damaged source fails the statement; never filter it out or invent bytes.
    IF item.source_body IS NULL OR octet_length(item.source_body)>body_limit
      OR item.source_hash IS NULL OR item.source_hash !~ '^[a-f0-9]{64}$'
      OR item.source_hash<>encode(sha256(convert_to(item.source_body,'UTF8')),'hex') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PROVIDER_EXPORT_SOURCE_REVIEW_REQUIRED';
    END IF;
    record_id:=item.source_id;canonical_evidence:=item.source_body;evidence_hash:=item.source_hash;RETURN NEXT;
  END LOOP;
  CLOSE source_cursor;
END
$export$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_evidence_export_context(uuid,text) OWNER TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_evidence_export_page(uuid,text,text,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.provider_evidence_export_context(uuid,text),crest_commands.provider_evidence_export_page(uuid,text,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.provider_evidence_export_context(uuid,text),crest_commands.provider_evidence_export_page(uuid,text,text,text,uuid,integer) TO crest_inventory;
