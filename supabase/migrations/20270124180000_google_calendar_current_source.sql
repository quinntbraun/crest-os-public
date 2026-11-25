-- Current Calendar business-control source alongside unchanged v1.
-- Explicit metadata projections exclude provider subjects, reviewed account
-- identifiers, key identities, grant envelopes and all bearer/PKCE material.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.google_calendar_source_dictionary_v2()
RETURNS TABLE(source_group text,source_schema text,source_table text,key_column text,fields text[],predicate text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 SELECT * FROM crest_private.google_calendar_source_dictionary()
 UNION ALL VALUES
 ('creation_abandonments','crest_private','google_calendar_creation_abandonments','attempt_id',ARRAY['business_id','attempt_id','actor_id','app_session_id','recovery_epoch','operation_id','abandoned_at'],'true'),
 ('account_bindings','crest_private','google_calendar_account_bindings','destination_id',ARRAY['business_id','destination_id','client_id','provider_issuer','credential_id','source_attempt','recovery_epoch','actor_id','bound_at'],'true'),
 ('reconnection_stagings','crest_private','google_calendar_reconnection_stagings','attempt_id',ARRAY['business_id','attempt_id','destination_id','credential_id','generation','recovery_epoch','actor_id','app_session_id','provider_issuer','staged_at'],'true'),
 ('credential_metadata','crest_private','google_calendar_credentials','id',ARRAY['id','business_id','destination_id','connection_generation','recovery_epoch','client_id','scope','version','source_exchange','created_at','updated_at'],'true'),
 ('code_exchange_metadata','crest_private','google_calendar_code_exchanges','attempt_id',ARRAY['business_id','attempt_id','app_session_id','actor_id','recovery_epoch','client_id','generation','destination_id','admitted_at','deadline'],'true');
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.google_calendar_source_dictionary_v2() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.google_calendar_source_dictionary_v2() TO crest_calendar_export_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_calendar_export_owner;
DO $grant$
DECLARE t record; cols text;
BEGIN
 FOR t IN SELECT source_schema,source_table,array_agg(DISTINCT field) AS columns
  FROM crest_private.google_calendar_source_dictionary_v2() d CROSS JOIN LATERAL unnest(d.fields) field
  WHERE d.source_group IN('creation_abandonments','account_bindings','reconnection_stagings','credential_metadata','code_exchange_metadata') GROUP BY source_schema,source_table
 LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname,c.relname)=(t.source_schema,t.source_table) AND c.relkind='r'
    AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO cols FROM unnest(t.columns) field;
  EXECUTE format('GRANT SELECT(%s) ON %I.%I TO crest_calendar_export_owner',cols,t.source_schema,t.source_table);
  EXECUTE format('CREATE POLICY calendar_current_export_scope ON %I.%I FOR SELECT TO crest_calendar_export_owner USING(business_id=nullif(current_setting(''crest.calendar_source_business'',true),'''')::uuid)',t.source_schema,t.source_table);
 END LOOP;
END $grant$;
CREATE FUNCTION crest_commands.google_calendar_source_snapshot_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE d record; projection text; rows jsonb; groups jsonb:='{}'::jsonb; total integer:=0; snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='GOOGLE_CALENDAR_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.calendar_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='GOOGLE_CALENDAR_SOURCE_LIMIT'; END IF;
 FOR d IN SELECT * FROM crest_private.google_calendar_source_dictionary_v2() LOOP
  SELECT string_agg(format('%L,%s',name,CASE
   WHEN name LIKE '%\_at' OR name IN('lease_until','deadline','drain_until') THEN
    format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
  INTO projection FROM unnest(d.fields) WITH ORDINALITY AS f(name,position);
  IF d.key_column<>'id' THEN projection:=projection||format(',''id'',t.%I::text',d.key_column); END IF;
  EXECUTE format($rows$
   SELECT coalesce(jsonb_agg(value ORDER BY key),'[]'::jsonb)
   FROM (SELECT t.%I AS key,jsonb_build_object(%s) AS value FROM %I.%I t
    WHERE t.business_id=$1 AND %s ORDER BY t.%I LIMIT $2) bounded
  $rows$,d.key_column,projection,d.source_schema,d.source_table,d.predicate,d.key_column)
  INTO rows USING requested_business,1001-total;
  total:=total+jsonb_array_length(rows);
  IF total>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='GOOGLE_CALENDAR_SOURCE_LIMIT'; END IF;
  groups:=groups||jsonb_build_object(d.source_group,rows);
 END LOOP;
 IF octet_length(groups::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='GOOGLE_CALENDAR_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',2,'businessId',requested_business,'groups',groups,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.google.calendar.source/2',requested_business,
   pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex'));
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.google_calendar_source_snapshot_v2(uuid) OWNER TO crest_calendar_export_owner;
REVOKE ALL ON FUNCTION crest_commands.google_calendar_source_snapshot_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.google_calendar_source_snapshot_v2(uuid) TO crest_export;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_calendar_export_owner;
RESET ROLE;
