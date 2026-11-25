-- HELD142 workspace source reader: retained opening-document evidence.
-- No new financial posting, refund, provider or runtime activation authority.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.business_source_dictionary_v4()
RETURNS TABLE(source_name text,fields text[],business_column text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 SELECT * FROM crest_private.business_source_dictionary_v3()
 UNION ALL SELECT * FROM (VALUES
 ('crest.opening_document_intents',ARRAY['id','business_id','reference','expected_sha256','recovery_epoch','media_type','byte_size','dispatch_id','operation_id','audit_event_id','created_by','recorded_at'],'business_id'),
 ('crest.opening_document_originals',ARRAY['id','business_id','candidate','operation_id','audit_event_id','created_by','recorded_at'],'business_id')) AS added(source_name,fields,business_column);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.business_source_dictionary_v4() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.business_source_dictionary_v4() TO crest_business_source_owner;
DO $grant$
DECLARE d record; source_oid oid; projection text;
BEGIN
 FOR d IN SELECT * FROM crest_private.business_source_dictionary_v4() WHERE source_name IN('crest.opening_document_intents','crest.opening_document_originals') LOOP
  source_oid:=to_regclass(d.source_name);
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=source_oid AND relkind='r'
   AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR NOT EXISTS(SELECT FROM pg_index i WHERE i.indrelid=source_oid AND i.indisprimary
    AND NOT EXISTS(SELECT FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid=source_oid AND a.attnum=k WHERE NOT a.attname=ANY(d.fields)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO projection FROM unnest(d.fields) field;
  EXECUTE format('GRANT SELECT(%s) ON %s TO crest_business_source_owner',projection,source_oid::regclass);
  EXECUTE format('CREATE POLICY current_business_source_scope ON %s FOR SELECT TO crest_business_source_owner USING(%I=nullif(current_setting(''crest.business_source_business'',true),'''')::uuid)',source_oid::regclass,d.business_column);
 END LOOP;
END $grant$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_business_source_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.business_source_page_v4(requested_business uuid,requested_source text,expected_snapshot text,after_key text[],page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' SET bytea_output='hex' SET extra_float_digits=3 AS $source$
DECLARE d record; source_oid oid; pk text[]; projection text; key_sql text; keys jsonb; data jsonb; snapshot_value text; token text; next_cursor jsonb; types jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF page_size IS NULL OR page_size<1 OR page_size>100 OR requested_business IS NULL
  OR (after_key IS NOT NULL AND (expected_snapshot IS NULL OR cardinality(after_key)<1 OR cardinality(after_key)>16 OR array_position(after_key,NULL) IS NOT NULL))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT * INTO d FROM crest_private.business_source_dictionary_v4() WHERE source_name=requested_source;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('crest.business.rows/2',requested_business,pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
 IF expected_snapshot IS NOT NULL AND expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_CHANGED'; END IF;
 source_oid:=to_regclass(d.source_name);
 SELECT array_agg(a.attname::text ORDER BY k.position) INTO pk FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number WHERE i.indrelid=source_oid AND i.indisprimary;
 IF pk IS NULL OR cardinality(pk)>16 OR after_key IS NOT NULL AND cardinality(after_key)<>cardinality(pk)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT string_agg(format('%L,%s',field,CASE WHEN a.atttypid='timestamptz'::regtype
  THEN format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',field)
  ELSE format('t.%I::text',field) END),',' ORDER BY position),
  jsonb_object_agg(field,format_type(a.atttypid,a.atttypmod)) INTO projection,types
  FROM unnest(d.fields) WITH ORDINALITY f(field,position) JOIN pg_attribute a ON a.attrelid=source_oid AND a.attname=field;
 SELECT 'ARRAY['||string_agg(format('t.%I::text',field),',' ORDER BY position)||']::text[]' INTO key_sql FROM unnest(pk) WITH ORDINALITY f(field,position);
 EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),''[]''::jsonb),coalesce(jsonb_agg(to_jsonb(key) ORDER BY key COLLATE "C"),''[]''::jsonb) FROM (SELECT %s AS key,jsonb_build_object(%s) AS value FROM %s t WHERE t.%I=$1 AND ($2::text[] IS NULL OR (%s COLLATE "C")>($2::text[] COLLATE "C")) ORDER BY %s COLLATE "C" LIMIT $3) bounded',key_sql,projection,source_oid::regclass,d.business_column,key_sql,key_sql)
  INTO data,keys USING requested_business,after_key,page_size+1;
 IF jsonb_array_length(data)>page_size THEN data:=data-page_size;next_cursor:=keys->(page_size-1); END IF;
 IF octet_length(data::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'source',requested_source,'snapshotToken',token,
  'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'columns',d.fields,'types',types,'primaryKey',pk,'rows',data,'nextCursor',next_cursor);
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.business_source_page_v4(uuid,text,text,text[],integer) OWNER TO crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_commands.business_source_page_v4(uuid,text,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_source_page_v4(uuid,text,text,text[],integer) TO crest_export;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_business_source_owner;

