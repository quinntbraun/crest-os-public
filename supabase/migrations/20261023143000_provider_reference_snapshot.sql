-- Explicit reference coverage; projections are not invented original evidence.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_inventory_owner','crest_inventory')
      AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_inventory_owner','crest_inventory'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege('crest_inventory_owner',n.oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_inventory_owner') AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN
      ('crest_private.actors'::regclass,'crest_private.app_sessions'::regclass,'crest_private.session_events'::regclass,'crest_private.provider_cleanup_references'::regclass)
      AND c.relkind='r' AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)<>4
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN
      ('crest_private.actors'::regclass,'crest_private.app_sessions'::regclass,'crest_private.session_events'::regclass,'crest_private.provider_cleanup_references'::regclass,
       'auth.sessions'::regclass,'auth.users'::regclass,'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass)
      AND (has_any_column_privilege('crest_inventory',c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        OR has_table_privilege('crest_inventory',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
        OR has_any_column_privilege('crest_inventory_owner',c.oid,'INSERT,UPDATE,REFERENCES')
        OR has_table_privilege('crest_inventory_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.app_sessions'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','actor_id','provider_session_id','issued_security_epoch','expires_at','revoked_at') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.actors'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','kind','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.session_events'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','session_id','actor_id','operation_id','action') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='crest_private.provider_cleanup_references'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','app_session_id','actor_id','provider_session_id') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid='auth.sessions'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname NOT IN ('id','user_id','not_after','aal') AND has_column_privilege('crest_inventory_owner',a.attrelid,a.attnum,'SELECT'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN ('auth.users'::regclass,'auth.refresh_tokens'::regclass,'auth.mfa_amr_claims'::regclass)
      AND has_any_column_privilege('crest_inventory_owner',c.oid,'SELECT')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PROVIDER_REFERENCE_EXPORT_REVIEW_REQUIRED';
  END IF;
END
$review$;
GRANT SELECT(payload,event_hash) ON crest_private.session_events TO crest_inventory_owner;
GRANT SELECT(schema_version,issued_security_epoch,source_version,revoked_at,source_event_id,source_event_hash,state,created_at,created_by,origin,operation_id)
  ON crest_private.provider_cleanup_references TO crest_inventory_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE INDEX session_identity_export_scope ON crest_private.app_sessions(actor_id,id);
CREATE INDEX session_event_export_scope ON crest_private.session_events(actor_id,id);
CREATE INDEX cleanup_reference_export_scope ON crest_private.provider_cleanup_references(actor_id,id);

CREATE FUNCTION crest_commands.provider_reference_export_context(expected_actor uuid,expected_issuer text)
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
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.provider.references.snapshot/1',expected_actor,expected_issuer,snapshot_token)::text,'UTF8')),'hex');
  RETURN jsonb_build_object('schemaVersion',1,'scope','provider_session_references','actorId',expected_actor,'providerIssuer',expected_issuer,
    'snapshotToken',snapshot_token,'observedAt',statement_timestamp(),'ledgerCounts',jsonb_build_object(
      'session_identity',(SELECT count(*)::text FROM crest_private.app_sessions WHERE actor_id=expected_actor
        AND EXISTS(SELECT 1 FROM crest_private.actors a WHERE a.id=expected_actor AND a.auth_provider_issuer=expected_issuer)),
      'session_event',(SELECT count(*)::text FROM crest_private.session_events WHERE actor_id=expected_actor
        AND EXISTS(SELECT 1 FROM crest_private.actors a WHERE a.id=expected_actor AND a.auth_provider_issuer=expected_issuer)),
      'cleanup_reference',(SELECT count(*)::text FROM crest_private.provider_cleanup_references WHERE actor_id=expected_actor
        AND EXISTS(SELECT 1 FROM crest_private.actors a WHERE a.id=expected_actor AND a.auth_provider_issuer=expected_issuer))));
END
$export$;

CREATE FUNCTION crest_commands.provider_reference_export_page(expected_actor uuid,expected_issuer text,expected_snapshot text,ledger_kind text,after_id uuid,requested_page_size integer)
RETURNS TABLE(record_id uuid,representation text,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $export$
DECLARE source_cursor refcursor; item record; snapshot_token text; body text; original_hash text; bound boolean;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_actor IS NULL OR expected_issuer IS NULL OR length(expected_issuer) NOT BETWEEN 1 AND 500
    OR expected_snapshot IS NULL OR expected_snapshot !~ '^[a-f0-9]{64}$' OR ledger_kind IS NULL
    OR ledger_kind NOT IN ('session_identity','session_event','cleanup_reference') OR requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PROVIDER_EXPORT_INPUT_REQUIRED';
  END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.provider.references.snapshot/1',expected_actor,expected_issuer,snapshot_token)::text,'UTF8')),'hex');
  IF expected_snapshot<>snapshot_token THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='CREST_PROVIDER_EXPORT_SNAPSHOT_CHANGED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM crest_private.actors a WHERE a.id=expected_actor AND a.auth_provider_issuer=expected_issuer) THEN RETURN; END IF;
  CASE ledger_kind
    WHEN 'session_identity' THEN OPEN source_cursor FOR
      SELECT s.id AS source_id,jsonb_build_object('schemaVersion',1,'appSessionId',s.id,'actorId',s.actor_id,'providerIssuer',expected_issuer,
        'providerSessionId',s.provider_session_id,'securityEpoch',s.issued_security_epoch)::text AS source_body,NULL::text AS source_hash,true AS source_bound
      FROM crest_private.app_sessions s WHERE s.actor_id=expected_actor AND (after_id IS NULL OR s.id>after_id) ORDER BY s.id LIMIT requested_page_size;
    WHEN 'session_event' THEN OPEN source_cursor FOR
      SELECT e.id AS source_id,e.payload::text AS source_body,e.event_hash AS source_hash,
        (e.payload->>'id'=e.id::text AND e.payload->>'actorId'=e.actor_id::text AND e.payload->>'sessionId'=e.session_id::text
          AND e.payload->'schemaVersion'='1'::jsonb AND EXISTS(SELECT 1 FROM crest_private.app_sessions s WHERE s.id=e.session_id AND s.actor_id=e.actor_id)) AS source_bound
      FROM crest_private.session_events e WHERE e.actor_id=expected_actor AND (after_id IS NULL OR e.id>after_id) ORDER BY e.id LIMIT requested_page_size;
    WHEN 'cleanup_reference' THEN OPEN source_cursor FOR
      SELECT r.id AS source_id,jsonb_build_object('schemaVersion',r.schema_version,'origin',r.origin,'referenceId',r.id,
        'appSessionId',r.app_session_id,'actorId',r.actor_id,'providerSessionId',r.provider_session_id,'securityEpoch',r.issued_security_epoch,
        'sourceVersion',r.source_version::text,'revokedAt',r.revoked_at,'sourceEventId',r.source_event_id,'sourceEventHash',r.source_event_hash,
        'state',r.state,'createdAt',r.created_at,'createdBy',r.created_by,'operationId',r.operation_id)::text AS source_body,NULL::text AS source_hash,
        EXISTS(SELECT 1 FROM crest_private.app_sessions s JOIN crest_private.session_events e ON e.id=r.source_event_id
          WHERE s.id=r.app_session_id AND s.actor_id=r.actor_id AND s.provider_session_id=r.provider_session_id AND s.issued_security_epoch=r.issued_security_epoch
            AND s.revoked_at=r.revoked_at AND e.session_id=s.id AND e.actor_id=r.actor_id AND e.action='SECURITY_CHANGED'
            AND e.event_hash=r.source_event_hash AND e.event_hash=encode(sha256(convert_to(e.payload::text,'UTF8')),'hex')
            AND e.payload#>>'{after,id}'=s.id::text AND e.payload#>>'{after,actor_id}'=r.actor_id::text
            AND e.payload#>>'{after,issued_security_epoch}'=r.issued_security_epoch::text
            AND e.payload#>>'{after,version}'=r.source_version::text AND e.payload#>'{before,revoked_at}'='null'::jsonb
            AND (e.payload#>>'{after,revoked_at}')::timestamptz=r.revoked_at
            AND e.payload->>'createdBy'=r.created_by::text AND e.operation_id IS NOT DISTINCT FROM r.operation_id) AS source_bound
      FROM crest_private.provider_cleanup_references r WHERE r.actor_id=expected_actor AND (after_id IS NULL OR r.id>after_id) ORDER BY r.id LIMIT requested_page_size;
  END CASE;
  LOOP
    FETCH source_cursor INTO item; EXIT WHEN NOT FOUND;
    body:=item.source_body;original_hash:=item.source_hash;bound:=item.source_bound;
    IF bound IS DISTINCT FROM true OR body IS NULL OR octet_length(body)>8192
      OR (ledger_kind='session_event' AND (original_hash IS NULL OR original_hash !~ '^[a-f0-9]{64}$'
        OR original_hash<>encode(sha256(convert_to(body,'UTF8')),'hex'))) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_PROVIDER_EXPORT_SOURCE_REVIEW_REQUIRED';
    END IF;
    record_id:=item.source_id;representation:=CASE WHEN ledger_kind='session_event' THEN 'stored_payload' ELSE 'snapshot_projection' END;
    canonical_evidence:=body;evidence_hash:=CASE WHEN ledger_kind='session_event' THEN original_hash ELSE encode(sha256(convert_to(body,'UTF8')),'hex') END;RETURN NEXT;
  END LOOP;
  CLOSE source_cursor;
END
$export$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_reference_export_context(uuid,text) OWNER TO crest_inventory_owner;
ALTER FUNCTION crest_commands.provider_reference_export_page(uuid,text,text,text,uuid,integer) OWNER TO crest_inventory_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_inventory_owner;
REVOKE ALL ON FUNCTION crest_commands.provider_reference_export_context(uuid,text),crest_commands.provider_reference_export_page(uuid,text,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.provider_reference_export_context(uuid,text),crest_commands.provider_reference_export_page(uuid,text,text,text,uuid,integer) TO crest_inventory;
