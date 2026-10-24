-- ADR38: retain original audit hash-input bytes inside explicit business-scoped projections.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_export','crest_export_owner')
      AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_export','crest_export_owner'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE has_schema_privilege('crest_export',n.oid,'CREATE') OR has_schema_privilege('crest_export_owner',n.oid,'CREATE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_export_owner') AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.business_recovery_authorities'::regclass,
      'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>5
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private','auth') AND c.relkind IN ('r','p','v','m','f')
      AND (has_any_column_privilege('crest_export',c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private','auth') AND c.relkind IN ('r','p','v','m','f')
      AND (has_any_column_privilege('crest_export_owner',c.oid,'INSERT,UPDATE,REFERENCES') OR has_table_privilege('crest_export_owner',c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
        OR c.oid NOT IN ('crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.business_recovery_authorities'::regclass) AND has_any_column_privilege('crest_export_owner',c.oid,'SELECT')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('crest','crest_private','auth') AND c.relkind='S'
      AND (has_sequence_privilege('crest_export',c.oid,'USAGE,SELECT,UPDATE') OR has_sequence_privilege('crest_export_owner',c.oid,'USAGE,SELECT,UPDATE')))
    OR has_table_privilege('crest_export_owner','crest.businesses','SELECT')
    OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='crest.businesses'::regclass AND attnum>0 AND NOT attisdropped AND attname IN ('id','legal_name','currency','timezone','status','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id') AND has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT'))<>13
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='crest.businesses'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN ('id','legal_name','currency','timezone','status','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id') AND has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT'))
    OR has_table_privilege('crest_export_owner','crest.memberships','SELECT')
    OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='crest.memberships'::regclass AND attnum>0 AND NOT attisdropped AND attname IN ('id','business_id','actor_id','role','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id') AND has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT'))<>13
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='crest.memberships'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN ('id','business_id','actor_id','role','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id') AND has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT'))
    OR has_table_privilege('crest_export_owner','crest_private.business_recovery_authorities','SELECT')
    OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='crest_private.business_recovery_authorities'::regclass AND attnum>0 AND NOT attisdropped AND attname IN ('id','business_id','active_epoch','writes_enabled','incident_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id') AND has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT'))<>13
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='crest_private.business_recovery_authorities'::regclass AND attnum>0 AND NOT attisdropped AND attname NOT IN ('id','business_id','active_epoch','writes_enabled','incident_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id') AND has_column_privilege('crest_export_owner',attrelid,attnum,'SELECT'))
    OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE oid IN ('crest_commands.business_configuration_export_context(uuid)'::regprocedure,'crest_commands.business_configuration_export_page(uuid,text,text,uuid,integer)'::regprocedure)
      AND proowner='crest_export_owner'::regrole AND prosecdef AND provolatile='s'
      AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on,timezone=utc,datestyle=iso, ymd')<>2 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_REVIEW_REQUIRED';
  END IF;
END
$review$;
GRANT SELECT(id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id) ON crest_private.operations TO crest_export_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,effective_at,delta,created_at,recorded_at,created_by,origin,import_row_id,database_principal,payload,hash_input,event_hash) ON crest_private.audit_events TO crest_export_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY business_history_export_operation ON crest_private.operations FOR SELECT TO crest_export_owner USING (true);
CREATE POLICY business_history_export_audit_event ON crest_private.audit_events FOR SELECT TO crest_export_owner USING (true);
CREATE FUNCTION crest_commands.business_history_export_context(expected_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $export$
DECLARE snapshot_token text;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_INPUT_REQUIRED'; END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.business.history.snapshot/1',expected_business,snapshot_token)::text,'UTF8')),'hex');
  PERFORM crest_commands.business_configuration_export_context(expected_business);
  RETURN jsonb_build_object('schemaVersion',1,'scope','business_history','businessId',expected_business,
    'snapshotToken',snapshot_token,'observedAt',statement_timestamp(),'recordCounts',jsonb_build_object(
      'operation',(SELECT count(*)::text FROM crest_private.operations WHERE business_id=expected_business),
      'audit_event',(SELECT count(*)::text FROM crest_private.audit_events WHERE business_id=expected_business)));
END
$export$;
CREATE FUNCTION crest_commands.business_history_export_page(expected_business uuid,expected_snapshot text,record_kind text,after_id uuid,requested_page_size integer)
RETURNS TABLE(record_id uuid,representation text,canonical_evidence text,evidence_hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $export$
DECLARE snapshot_token text; source_cursor refcursor; item record; body text; expected_payload jsonb; total_bytes integer:=0; body_limit integer;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_INPUT_REQUIRED'; END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.business.history.snapshot/1',expected_business,snapshot_token)::text,'UTF8')),'hex');
  IF expected_snapshot IS NULL OR expected_snapshot !~ '^[a-f0-9]{64}$' OR expected_snapshot<>snapshot_token THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SNAPSHOT_MISMATCH';
  END IF;
  IF record_kind IS NULL OR record_kind NOT IN ('operation','audit_event') OR requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_INPUT_REQUIRED';
  END IF;
  PERFORM crest_commands.business_configuration_export_context(expected_business);
  CASE record_kind
    WHEN 'operation' THEN OPEN source_cursor FOR SELECT t.id,t.business_id,t.operation_id,t.actor_id,t.command_type,t.schema_version,t.recovery_epoch,t.payload_hash,t.state,t.result_schema_version,t.result,t.committed_at,t.created_at,t.created_by,t.origin,t.import_row_id FROM crest_private.operations t WHERE t.business_id=expected_business AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
    WHEN 'audit_event' THEN OPEN source_cursor FOR SELECT t.id,t.business_id,t.operation_id,t.actor_id,t.entity_kind,t.entity_id,t.entity_version,t.action,t.reason,t.effective_at,t.delta,t.created_at,t.recorded_at,t.created_by,t.origin,t.import_row_id,t.database_principal,t.payload,t.hash_input,t.event_hash FROM crest_private.audit_events t WHERE t.business_id=expected_business AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
  END CASE;
  LOOP
    FETCH source_cursor INTO item; EXIT WHEN NOT FOUND;
    IF record_kind='operation' THEN
      IF item.state IS DISTINCT FROM 'committed' OR item.result IS NULL OR item.result_schema_version IS NULL
        OR jsonb_typeof(item.result) IS DISTINCT FROM 'object' OR item.result->'schemaVersion' IS DISTINCT FROM to_jsonb(item.result_schema_version)
        OR octet_length(item.result::text)>65536 OR item.committed_at IS NULL
        OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=expected_business AND a.operation_id=item.operation_id AND a.actor_id=item.actor_id) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SOURCE_REVIEW_REQUIRED';
      END IF;
      body_limit:=262144;
      body:=jsonb_build_object('schemaVersion',1,'kind','operation','businessId',expected_business,'jsonTextColumns',jsonb_build_array('result'),'row',jsonb_build_object('id',item.id,'business_id',item.business_id,'operation_id',item.operation_id,'actor_id',item.actor_id,'command_type',item.command_type,'schema_version',item.schema_version,'recovery_epoch',item.recovery_epoch,'payload_hash',item.payload_hash,'state',item.state,'result_schema_version',item.result_schema_version,'result',item.result::text,'committed_at',item.committed_at,'created_at',item.created_at,'created_by',item.created_by,'origin',item.origin,'import_row_id',item.import_row_id))::text;
    ELSE
      IF item.hash_input IS NULL OR octet_length(item.hash_input)>524288 OR octet_length(item.delta::text)>262144 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SOURCE_REVIEW_REQUIRED';
      END IF;
      expected_payload:=jsonb_build_object('schemaVersion',1,'hashFormat','pg17-jsonb-text-utf8-v1','id',item.id,
        'businessId',item.business_id,'operationId',item.operation_id,'actorId',item.actor_id,'createdBy',item.created_by,
        'entityKind',item.entity_kind,'entityId',item.entity_id,'entityVersion',item.entity_version::text,
        'action',item.action,'reason',item.reason,'delta',item.delta,'origin',item.origin,'importRowId',item.import_row_id,
        'databasePrincipal',item.database_principal,'recordedAt',to_char(item.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'effectiveAt',CASE WHEN item.effective_at IS NULL THEN NULL ELSE to_char(item.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
      IF item.payload IS DISTINCT FROM expected_payload OR item.created_at IS DISTINCT FROM item.recorded_at
        OR item.hash_input IS DISTINCT FROM item.payload::text OR item.event_hash IS DISTINCT FROM encode(sha256(convert_to(item.hash_input,'UTF8')),'hex')
        OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=expected_business AND o.operation_id=item.operation_id AND o.actor_id=item.actor_id
          AND o.state='committed' AND o.origin=item.origin AND o.import_row_id IS NOT DISTINCT FROM item.import_row_id) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_SOURCE_REVIEW_REQUIRED';
      END IF;
      body_limit:=2097152;
      body:=jsonb_build_object('schemaVersion',1,'kind','audit_event','businessId',expected_business,'jsonTextColumns',jsonb_build_array('delta','payload'),'row',jsonb_build_object('id',item.id,'business_id',item.business_id,'operation_id',item.operation_id,'actor_id',item.actor_id,'entity_kind',item.entity_kind,'entity_id',item.entity_id,'entity_version',item.entity_version::text,'action',item.action,'reason',item.reason,'effective_at',item.effective_at,'delta',item.delta::text,'created_at',item.created_at,'recorded_at',item.recorded_at,'created_by',item.created_by,'origin',item.origin,'import_row_id',item.import_row_id,'database_principal',item.database_principal,'payload',item.payload::text,'hash_input',item.hash_input,'event_hash',item.event_hash))::text;
    END IF;
    IF body IS NULL OR octet_length(body)>body_limit OR total_bytes+octet_length(body)>8388608 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BUSINESS_HISTORY_EXPORT_BUDGET_REQUIRED';
    END IF;
    total_bytes:=total_bytes+octet_length(body);
    record_id:=item.id;representation:='snapshot_projection';canonical_evidence:=body;evidence_hash:=encode(sha256(convert_to(body,'UTF8')),'hex');RETURN NEXT;
  END LOOP;
  CLOSE source_cursor;
END
$export$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_export_owner;
ALTER FUNCTION crest_commands.business_history_export_context(uuid) OWNER TO crest_export_owner;
ALTER FUNCTION crest_commands.business_history_export_page(uuid,text,text,uuid,integer) OWNER TO crest_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_export_owner;
REVOKE ALL ON FUNCTION crest_commands.business_history_export_context(uuid),crest_commands.business_history_export_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid),crest_commands.business_history_export_page(uuid,text,text,uuid,integer) TO crest_export;
