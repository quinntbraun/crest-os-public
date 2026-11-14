-- P20/BR21. Read only the portable Calendar metadata and redacted history.
-- Credential and OAuth proof tables, raw provider bodies and host worker names
-- are deliberately outside the SQL grant as well as the exported dictionary.
CREATE ROLE crest_calendar_export_owner NOLOGIN NOINHERIT NOSUPERUSER
 NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_calendar_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_calendar_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_configuration_export_context(uuid) TO crest_calendar_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.google_calendar_source_dictionary()
RETURNS TABLE(source_group text,source_schema text,source_table text,key_column text,fields text[],predicate text)
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('destinations','crest','google_calendar_destinations','id',
  ARRAY['id','business_id','provider_calendar_id','created_by','operation_id','created_at'],'true'),
 ('consents','crest','google_calendar_consents','id',
  ARRAY['id','business_id','destination_id','generation','previous_generation','recovery_epoch','state',
   'client_name','service_label','work_address','created_by','operation_id','created_at'],'true'),
 ('mappings','crest','google_calendar_mappings','id',
  ARRAY['id','business_id','destination_id','job_id','event_uuid','correlation_marker','created_by','operation_id','created_at'],'true'),
 ('outbox','crest','google_calendar_outbox','id',
  ARRAY['id','business_id','destination_id','connection_generation','recovery_epoch','job_id','appointment_id',
   'appointment_sequence','mapping_id','action','created_by','operation_id','created_at'],'true'),
 ('dispatch_leases','crest','google_calendar_dispatch_leases','id',
  ARRAY['id','business_id','outbox_id','attempt_no','mode','leased_at','lease_until'],'true'),
 ('dispatch_sends','crest','google_calendar_dispatch_sends','id',
  ARRAY['id','business_id','lease_id','action','request_sha256','prior_etag','recorded_at'],'true'),
 ('request_admissions','crest','google_calendar_request_admissions','id',
  ARRAY['id','business_id','lease_id','setup_attempt_id','creation_attempt_id','kind','admitted_at'],'true'),
 ('dispatch_results','crest','google_calendar_dispatch_results','id',
  ARRAY['id','business_id','lease_id','outcome','provider_etag','source_current','recorded_at','retry_at'],'true'),
 ('disconnects','crest','google_calendar_disconnects','id',
  ARRAY['id','business_id','destination_id','recovery_epoch','disconnected_generation','prior_generation',
   'fenced_at','drain_until','actor_id','operation_id'],'true'),
 ('revocation_admissions','crest','google_calendar_revocation_events','disconnect_id',
  ARRAY['business_id','disconnect_id','attempt_id','phase','recorded_at','deadline','actor_id'],'t.phase=''admitted'''),
 ('revocation_outcomes','crest','google_calendar_revocation_events','disconnect_id',
  ARRAY['business_id','disconnect_id','attempt_id','phase','recorded_at','actor_id'],'t.phase<>''admitted'''),
 ('creation_intents','crest_private','google_calendar_creation_intents','attempt_id',
  ARRAY['business_id','attempt_id','actor_id','recovery_epoch','correlation_marker','confirmed_at'],'true'),
 ('creation_results','crest_private','google_calendar_creation_results','attempt_id',
  ARRAY['business_id','attempt_id','recorded_at','outcome','provider_calendar_id'],'true');
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.google_calendar_source_dictionary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.google_calendar_source_dictionary() TO crest_calendar_export_owner;

DO $grant$
DECLARE t record; cols text;
BEGIN
 FOR t IN SELECT source_schema,source_table,array_agg(DISTINCT field) AS columns
  FROM crest_private.google_calendar_source_dictionary() d CROSS JOIN LATERAL unnest(d.fields) field
  GROUP BY source_schema,source_table
 LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname,c.relname)=(t.source_schema,t.source_table) AND c.relkind='r'
    AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='GOOGLE_CALENDAR_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO cols FROM unnest(t.columns) field;
  EXECUTE format('GRANT SELECT(%s) ON %I.%I TO crest_calendar_export_owner',cols,t.source_schema,t.source_table);
  EXECUTE format('CREATE POLICY calendar_export_scope ON %I.%I FOR SELECT TO crest_calendar_export_owner
   USING(business_id=nullif(current_setting(''crest.calendar_source_business'',true),'''')::uuid)',t.source_schema,t.source_table);
 END LOOP;
END $grant$;

CREATE FUNCTION crest_commands.google_calendar_source_snapshot(requested_business uuid)
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
 FOR d IN SELECT * FROM crest_private.google_calendar_source_dictionary() LOOP
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
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'groups',groups,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_array('crest.google.calendar.source/1',requested_business,
   pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex'));
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.google_calendar_source_snapshot(uuid) OWNER TO crest_calendar_export_owner;
REVOKE ALL ON FUNCTION crest_commands.google_calendar_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.google_calendar_source_snapshot(uuid) TO crest_export;
