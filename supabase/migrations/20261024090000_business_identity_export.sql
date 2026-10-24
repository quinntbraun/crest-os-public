-- ADR39: fixed identity ancestry scope; new isolated nonlogin definer only.
DO $review$
DECLARE role_name text:='crest_identity_export_owner';
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
        'crest_commands.business_history_export_context(uuid)'::regprocedure,'crest_commands.business_history_export_page(uuid,text,text,uuid,integer)'::regprocedure))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_default_acl d JOIN pg_catalog.pg_roles r ON r.oid=d.defaclrole,
      LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE r.rolname='crest_schema_owner' AND a.grantee<>d.defaclrole)
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.business_recovery_authorities'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest_private.actors'::regclass,'crest_private.role_capabilities'::regclass,'crest_private.identity_events'::regclass) AND relkind='r' AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>8 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_IDENTITY_EXPORT_REVIEW_REQUIRED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
    CREATE ROLE crest_identity_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
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
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_type c JOIN pg_catalog.pg_roles r ON r.rolname=role_name
      WHERE c.typowner=r.oid OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(c.typacl) a WHERE a.grantee=r.oid)) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_IDENTITY_EXPORT_ROLE_REVIEW_REQUIRED';
  END IF;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_identity_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_identity_export_owner REVOKE ALL ON TABLES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_identity_export_owner REVOKE ALL ON TYPES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_identity_export_owner REVOKE ALL ON SEQUENCES FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_identity_export_owner REVOKE ALL ON SCHEMAS FROM PUBLIC;
END
$review$;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_identity_export_owner;
GRANT SELECT(id,legal_name,currency,timezone,status,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest.businesses TO crest_identity_export_owner;
GRANT SELECT(id,business_id,actor_id,role,active,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest.memberships TO crest_identity_export_owner;
GRANT SELECT(id,business_id,active_epoch,writes_enabled,incident_id,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest_private.business_recovery_authorities TO crest_identity_export_owner;
GRANT SELECT(business_id,actor_id,created_by) ON crest_private.operations TO crest_identity_export_owner;
GRANT SELECT(business_id,actor_id,created_by) ON crest_private.audit_events TO crest_identity_export_owner;
GRANT SELECT(id,kind,display_label,system_key,auth_provider_issuer,auth_user_id,current_security_epoch,disabled_at,version,created_at,updated_at,created_by,updated_by,origin,operation_id,import_row_id) ON crest_private.actors TO crest_identity_export_owner;
GRANT SELECT(id,role,capability,created_at,created_by,origin,operation_id,import_row_id) ON crest_private.role_capabilities TO crest_identity_export_owner;
GRANT SELECT(id,business_id,created_at,created_by,origin,operation_id,import_row_id,entity_kind,entity_id,entity_version,action,database_principal,payload,event_hash) ON crest_private.identity_events TO crest_identity_export_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY identity_export_businesses ON crest.businesses FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_memberships ON crest.memberships FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_business_recovery_authorities ON crest_private.business_recovery_authorities FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_operations ON crest_private.operations FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_audit_events ON crest_private.audit_events FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_actors ON crest_private.actors FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_role_capabilities ON crest_private.role_capabilities FOR SELECT TO crest_identity_export_owner USING(true);
CREATE POLICY identity_export_identity_events ON crest_private.identity_events FOR SELECT TO crest_identity_export_owner USING(true);
CREATE FUNCTION crest_private.identity_export_normalize(source jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE key text; stamp timestamptz;
BEGIN
  IF jsonb_typeof(source) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
  FOREACH key IN ARRAY ARRAY['created_at','updated_at','disabled_at'] LOOP
    IF source ? key AND source->key<>'null'::jsonb THEN
      IF jsonb_typeof(source->key)<>'string' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
      stamp:=(source->>key)::timestamptz;
      IF NOT isfinite(stamp) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
      source:=jsonb_set(source,ARRAY[key],to_jsonb(stamp));
    END IF;
  END LOOP;
  RETURN source;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
END
$fn$;
CREATE FUNCTION crest_private.identity_export_check_event(source jsonb) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE p jsonb:=source->'payload'; a jsonb:=p->'after'; b jsonb:=p->'before'; expected jsonb; names text[]; stamp timestamptz;
BEGIN
  IF source->>'origin' IS DISTINCT FROM 'system' OR source->'import_row_id' IS DISTINCT FROM 'null'::jsonb
    OR octet_length(p::text)>65536 OR jsonb_typeof(p) IS DISTINCT FROM 'object'
    OR source->>'event_hash' IS DISTINCT FROM encode(sha256(convert_to(p::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  expected:=jsonb_build_object('schemaVersion',1,'id',source->'id','businessId',source->'business_id','createdBy',source->'created_by',
    'operationId',source->'operation_id','entityKind',source->'entity_kind','entityId',source->'entity_id',
    'entityVersion',source->'entity_version','action',source->'action','databasePrincipal',source->'database_principal');
  IF p-ARRAY['recordedAt','before','after'] IS DISTINCT FROM expected OR NOT(p ?& ARRAY['recordedAt','before','after'])
    OR jsonb_typeof(p->'recordedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  stamp:=(p->>'recordedAt')::timestamptz;
  IF NOT isfinite(stamp) OR stamp IS DISTINCT FROM (source->>'created_at')::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  CASE source->>'entity_kind'
    WHEN 'actors' THEN names:=ARRAY['id','kind','display_label','system_key','auth_provider_issuer','auth_user_id','current_security_epoch','disabled_at','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'];
    WHEN 'businesses' THEN names:=ARRAY['id','legal_name','currency','timezone','status','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'];
    WHEN 'memberships' THEN names:=ARRAY['id','business_id','actor_id','role','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'];
    WHEN 'business_recovery_authorities' THEN names:=ARRAY['id','business_id','active_epoch','writes_enabled','incident_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'];
    WHEN 'role_capabilities' THEN names:=ARRAY['id','role','capability','created_at','created_by','origin','operation_id','import_row_id'];
    ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
  END CASE;
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR NOT(a ?& names) OR a-names<>'{}'::jsonb
    OR a->'id' IS DISTINCT FROM source->'entity_id' OR a->'operation_id' IS DISTINCT FROM source->'operation_id'
    OR coalesce(a->'updated_by',a->'created_by') IS DISTINCT FROM source->'created_by'
    OR coalesce(a->'version','1'::jsonb) IS DISTINCT FROM source->'entity_version'
    OR (CASE WHEN source->>'entity_kind'='businesses' THEN a->'id' ELSE coalesce(a->'business_id','null'::jsonb) END) IS DISTINCT FROM source->'business_id'
    OR source->>'action' NOT IN ('INSERT','UPDATE') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  PERFORM crest_private.identity_export_normalize(a);
  IF source->>'action'='INSERT' THEN
    IF b IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
  ELSE
    IF source->>'entity_kind'='role_capabilities' OR jsonb_typeof(b) IS DISTINCT FROM 'object' OR NOT(b ?& names) OR b-names<>'{}'::jsonb
      OR b->'id' IS DISTINCT FROM a->'id' OR (b->>'version')::bigint<>(a->>'version')::bigint-1
      OR b-ARRAY['display_label','current_security_epoch','disabled_at','legal_name','currency','timezone','status','active','active_epoch','writes_enabled','incident_id','version','updated_at','updated_by','operation_id']
        IS DISTINCT FROM a-ARRAY['display_label','current_security_epoch','disabled_at','legal_name','currency','timezone','status','active','active_epoch','writes_enabled','incident_id','version','updated_at','updated_by','operation_id'] THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
    END IF;
    PERFORM crest_private.identity_export_normalize(b);
  END IF;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range OR invalid_parameter_value THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
END
$fn$;
CREATE FUNCTION crest_private.business_identity_export_review(expected_business uuid) RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE actor_ids uuid[]; expanded uuid[]; entity record; event_row record; previous jsonb; last_version bigint; seen integer:=0; total bigint;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_IDENTITY_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_IDENTITY_EXPORT_INPUT_REQUIRED'; END IF;
  IF (SELECT count(*) FROM crest.businesses WHERE id=expected_business)<>1
    OR (SELECT count(*) FROM crest_private.business_recovery_authorities WHERE business_id=expected_business)<>1
    OR NOT EXISTS(SELECT 1 FROM crest.memberships WHERE business_id=expected_business)
    OR (SELECT count(*) FROM crest_private.role_capabilities)<>5
    OR (SELECT array_agg(capability ORDER BY capability) FROM crest_private.role_capabilities WHERE role='owner') IS DISTINCT FROM ARRAY['crm.manage','export.bulk','finance.post','identity.manage','identity.read']::text[] THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
  END IF;
  actor_ids:=ARRAY(SELECT id FROM (
SELECT created_by AS id FROM crest.businesses WHERE id=expected_business
    UNION
SELECT updated_by AS id FROM crest.businesses WHERE id=expected_business
    UNION
SELECT created_by AS id FROM crest.memberships WHERE business_id=expected_business
    UNION
SELECT updated_by AS id FROM crest.memberships WHERE business_id=expected_business
    UNION
SELECT actor_id AS id FROM crest.memberships WHERE business_id=expected_business
    UNION
SELECT created_by AS id FROM crest_private.business_recovery_authorities WHERE business_id=expected_business
    UNION
SELECT updated_by AS id FROM crest_private.business_recovery_authorities WHERE business_id=expected_business
    UNION
SELECT actor_id AS id FROM crest_private.operations WHERE business_id=expected_business
    UNION
SELECT created_by AS id FROM crest_private.operations WHERE business_id=expected_business
    UNION
SELECT actor_id AS id FROM crest_private.audit_events WHERE business_id=expected_business
    UNION
SELECT created_by AS id FROM crest_private.audit_events WHERE business_id=expected_business
    UNION
SELECT created_by AS id FROM crest_private.role_capabilities
    UNION
SELECT created_by AS id FROM crest_private.identity_events WHERE business_id=expected_business
  ) seeds ORDER BY id LIMIT 1001);
  LOOP
    IF cardinality(actor_ids)>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_IDENTITY_EXPORT_BUDGET_REQUIRED'; END IF;
    IF (SELECT count(*) FROM crest_private.actors WHERE id=ANY(actor_ids))<>cardinality(actor_ids) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
    END IF;
    SELECT count(*) INTO total FROM crest_private.identity_events e WHERE (e.business_id=expected_business OR e.business_id IS NULL AND (e.entity_kind='actors' AND e.entity_id=ANY(actor_ids) OR e.entity_kind='role_capabilities'));
    IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_IDENTITY_EXPORT_BUDGET_REQUIRED'; END IF;
    expanded:=ARRAY(SELECT id FROM (
      SELECT unnest(actor_ids) AS id
      UNION SELECT created_by FROM crest_private.actors WHERE id=ANY(actor_ids)
      UNION SELECT updated_by FROM crest_private.actors WHERE id=ANY(actor_ids)
      UNION SELECT created_by FROM crest_private.identity_events WHERE business_id IS NULL AND entity_kind='actors' AND entity_id=ANY(actor_ids)
    ) edges ORDER BY id LIMIT 1001);
    EXIT WHEN expanded=actor_ids; actor_ids:=expanded;
  END LOOP;
  -- Review every selected original chain through the exact current source row.
  -- Arbitrary positive initial versions are allowed by the immutable schema2.
  FOR entity IN
SELECT 'actors'::text AS kind,t.id,NULL::uuid AS business_id,t.version AS version,jsonb_build_object('id',t.id,'kind',t.kind,'display_label',t.display_label,'system_key',t.system_key,'auth_provider_issuer',t.auth_provider_issuer,'auth_user_id',t.auth_user_id,'current_security_epoch',t.current_security_epoch,'disabled_at',t.disabled_at,'version',t.version,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS current_row FROM crest_private.actors t WHERE t.id=ANY(actor_ids)    UNION ALL
SELECT 'role_capabilities'::text AS kind,t.id,NULL::uuid AS business_id,1::bigint AS version,jsonb_build_object('id',t.id,'role',t.role,'capability',t.capability,'created_at',t.created_at,'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS current_row FROM crest_private.role_capabilities t WHERE true    UNION ALL
SELECT 'businesses'::text AS kind,t.id,expected_business AS business_id,t.version AS version,jsonb_build_object('id',t.id,'legal_name',t.legal_name,'currency',t.currency,'timezone',t.timezone,'status',t.status,'version',t.version,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS current_row FROM crest.businesses t WHERE t.id=expected_business    UNION ALL
SELECT 'memberships'::text AS kind,t.id,expected_business AS business_id,t.version AS version,jsonb_build_object('id',t.id,'business_id',t.business_id,'actor_id',t.actor_id,'role',t.role,'active',t.active,'version',t.version,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS current_row FROM crest.memberships t WHERE t.business_id=expected_business    UNION ALL
SELECT 'business_recovery_authorities'::text AS kind,t.id,expected_business AS business_id,t.version AS version,jsonb_build_object('id',t.id,'business_id',t.business_id,'active_epoch',t.active_epoch,'writes_enabled',t.writes_enabled,'incident_id',t.incident_id,'version',t.version,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id) AS current_row FROM crest_private.business_recovery_authorities t WHERE t.business_id=expected_business
  LOOP
    previous:=NULL;last_version:=NULL;
    FOR event_row IN SELECT e.entity_version,e.action,jsonb_build_object('id',e.id,'business_id',e.business_id,'created_at',e.created_at,'created_by',e.created_by,'origin',e.origin,'operation_id',e.operation_id,'import_row_id',e.import_row_id,'entity_kind',e.entity_kind,'entity_id',e.entity_id,'entity_version',e.entity_version,'action',e.action,'database_principal',e.database_principal,'payload',e.payload,'event_hash',e.event_hash) AS source FROM crest_private.identity_events e
      WHERE e.business_id IS NOT DISTINCT FROM entity.business_id AND e.entity_kind=entity.kind AND e.entity_id=entity.id ORDER BY e.entity_version,e.id
    LOOP
      seen:=seen+1;
      IF seen>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_IDENTITY_EXPORT_BUDGET_REQUIRED'; END IF;
      PERFORM crest_private.identity_export_check_event(event_row.source);
      IF previous IS NULL THEN
        IF event_row.action<>'INSERT' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
      ELSE
        IF event_row.action<>'UPDATE' OR event_row.entity_version::numeric<>last_version::numeric+1
          OR crest_private.identity_export_normalize(event_row.source->'payload'->'before') IS DISTINCT FROM previous THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
        END IF;
      END IF;
      previous:=crest_private.identity_export_normalize(event_row.source->'payload'->'after');last_version:=event_row.entity_version;
    END LOOP;
    IF previous IS NULL OR last_version<>entity.version OR previous IS DISTINCT FROM crest_private.identity_export_normalize(entity.current_row) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED';
    END IF;
  END LOOP;
  IF seen<>total THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_IDENTITY_EXPORT_SOURCE_REVIEW_REQUIRED'; END IF;
  RETURN actor_ids;
END
$fn$;
CREATE FUNCTION crest_commands.business_identity_export_context(expected_business uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE actor_ids uuid[]; snapshot_token text;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_IDENTITY_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_IDENTITY_EXPORT_INPUT_REQUIRED'; END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_IDENTITY_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.business.identity.snapshot/1',expected_business,snapshot_token)::text,'UTF8')),'hex');
  actor_ids:=crest_private.business_identity_export_review(expected_business);
  RETURN jsonb_build_object('schemaVersion',1,'scope','business_identity','businessId',expected_business,'snapshotToken',snapshot_token,'observedAt',statement_timestamp(),'recordCounts',jsonb_build_object(
    'actor',cardinality(actor_ids)::text,'role_capability',(SELECT count(*)::text FROM crest_private.role_capabilities),'identity_event',(SELECT count(*)::text FROM crest_private.identity_events e WHERE (e.business_id=expected_business OR e.business_id IS NULL AND (e.entity_kind='actors' AND e.entity_id=ANY(actor_ids) OR e.entity_kind='role_capabilities')))));
END
$fn$;
CREATE FUNCTION crest_commands.business_identity_export_page(expected_business uuid,expected_snapshot text,record_kind text,after_id uuid,requested_page_size integer)
RETURNS TABLE(record_id uuid,representation text,canonical_evidence text,evidence_hash text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $fn$
DECLARE actor_ids uuid[];snapshot_token text;source_cursor refcursor;item record;body text;total_bytes integer:=0;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
    RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_IDENTITY_EXPORT_SNAPSHOT_REQUIRED';
  END IF;
  IF expected_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_IDENTITY_EXPORT_INPUT_REQUIRED'; END IF;
  snapshot_token:=pg_current_snapshot()::text;
  IF octet_length(snapshot_token)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_IDENTITY_EXPORT_SNAPSHOT_REVIEW_REQUIRED'; END IF;
  snapshot_token:=encode(sha256(convert_to(jsonb_build_array('crest.business.identity.snapshot/1',expected_business,snapshot_token)::text,'UTF8')),'hex');
  IF expected_snapshot IS NULL OR expected_snapshot !~ '^[a-f0-9]{64}$' OR expected_snapshot<>snapshot_token THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_IDENTITY_EXPORT_SNAPSHOT_MISMATCH';
  END IF;
  IF record_kind IS NULL OR record_kind NOT IN ('actor','role_capability','identity_event') OR requested_page_size IS NULL OR requested_page_size NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_IDENTITY_EXPORT_INPUT_REQUIRED';
  END IF;
  actor_ids:=crest_private.business_identity_export_review(expected_business);
  CASE record_kind
    WHEN 'actor' THEN OPEN source_cursor FOR SELECT t.id AS source_id,jsonb_build_object('schemaVersion',1,'kind','actor','businessId',expected_business,'jsonTextColumns','[]'::jsonb,'row',jsonb_build_object('id',t.id,'kind',t.kind,'display_label',t.display_label,'system_key',t.system_key,'auth_provider_issuer',t.auth_provider_issuer,'auth_user_id',t.auth_user_id,'current_security_epoch',t.current_security_epoch,'disabled_at',t.disabled_at,'version',t.version::text,'created_at',t.created_at,'updated_at',t.updated_at,'created_by',t.created_by,'updated_by',t.updated_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id))::text AS source_body FROM crest_private.actors t WHERE (t.id=ANY(actor_ids)) AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
    WHEN 'role_capability' THEN OPEN source_cursor FOR SELECT t.id AS source_id,jsonb_build_object('schemaVersion',1,'kind','role_capability','businessId',expected_business,'jsonTextColumns','[]'::jsonb,'row',jsonb_build_object('id',t.id,'role',t.role,'capability',t.capability,'created_at',t.created_at,'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id))::text AS source_body FROM crest_private.role_capabilities t WHERE (true) AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
    WHEN 'identity_event' THEN OPEN source_cursor FOR SELECT t.id AS source_id,jsonb_build_object('schemaVersion',1,'kind','identity_event','businessId',expected_business,'jsonTextColumns',jsonb_build_array('payload'),'row',jsonb_build_object('id',t.id,'business_id',t.business_id,'created_at',t.created_at,'created_by',t.created_by,'origin',t.origin,'operation_id',t.operation_id,'import_row_id',t.import_row_id,'entity_kind',t.entity_kind,'entity_id',t.entity_id,'entity_version',t.entity_version::text,'action',t.action,'database_principal',t.database_principal,'payload',t.payload::text,'event_hash',t.event_hash))::text AS source_body FROM crest_private.identity_events t WHERE ((t.business_id=expected_business OR t.business_id IS NULL AND (t.entity_kind='actors' AND t.entity_id=ANY(actor_ids) OR t.entity_kind='role_capabilities'))) AND (after_id IS NULL OR t.id>after_id) ORDER BY t.id LIMIT requested_page_size;
  END CASE;
  LOOP
    FETCH source_cursor INTO item;EXIT WHEN NOT FOUND;body:=item.source_body;
    IF body IS NULL OR octet_length(body)>(CASE WHEN record_kind='identity_event' THEN 262144 ELSE 16384 END) OR total_bytes+octet_length(body)>8388608 THEN
      RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_IDENTITY_EXPORT_BUDGET_REQUIRED';
    END IF;
    total_bytes:=total_bytes+octet_length(body);
    record_id:=item.source_id;representation:='snapshot_projection';canonical_evidence:=body;evidence_hash:=encode(sha256(convert_to(body,'UTF8')),'hex');RETURN NEXT;
  END LOOP;
  CLOSE source_cursor;
END
$fn$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_identity_export_owner;
ALTER FUNCTION crest_private.identity_export_normalize(jsonb) OWNER TO crest_identity_export_owner;
REVOKE ALL ON FUNCTION crest_private.identity_export_normalize(jsonb) FROM PUBLIC;
ALTER FUNCTION crest_private.identity_export_check_event(jsonb) OWNER TO crest_identity_export_owner;
REVOKE ALL ON FUNCTION crest_private.identity_export_check_event(jsonb) FROM PUBLIC;
ALTER FUNCTION crest_private.business_identity_export_review(uuid) OWNER TO crest_identity_export_owner;
REVOKE ALL ON FUNCTION crest_private.business_identity_export_review(uuid) FROM PUBLIC;
ALTER FUNCTION crest_commands.business_identity_export_context(uuid) OWNER TO crest_identity_export_owner;
REVOKE ALL ON FUNCTION crest_commands.business_identity_export_context(uuid) FROM PUBLIC;
ALTER FUNCTION crest_commands.business_identity_export_page(uuid,text,text,uuid,integer) OWNER TO crest_identity_export_owner;
REVOKE ALL ON FUNCTION crest_commands.business_identity_export_page(uuid,text,text,uuid,integer) FROM PUBLIC;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_identity_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_identity_export_context(uuid),crest_commands.business_identity_export_page(uuid,text,text,uuid,integer) TO crest_export;
