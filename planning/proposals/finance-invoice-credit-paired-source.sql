-- Held E08 paired link and versioned exact P05/P07 snapshot readers.
DO $review$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='crest_paired_credit_export_owner') OR
  NOT EXISTS(SELECT FROM pg_roles WHERE rolname='crest_export'
   AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
   AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_paired_credit_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_paired_credit_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands,crest_private TO crest_paired_credit_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid),
 crest_commands.business_configuration_export_context(uuid) TO crest_paired_credit_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.paired_invoice_credit_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES ('paired_invoice_credit_releases',ARRAY[
  'id:uuid','business_id:uuid','invoice_credit_id:uuid','unapplication_id:uuid',
  'operation_id:uuid','actor_id:uuid','reviewed_ar_cents:bigint'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.paired_invoice_credit_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.paired_invoice_credit_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.paired_invoice_credit_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.paired_invoice_credit_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_SCOPE_REQUIRED';END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.paired.invoice.credit.sources/1',requested_business,
  pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.paired_invoice_credit_source_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.paired_invoice_credit_source_dictionary(),
 crest_private.paired_invoice_credit_source_check_group(text,text[]),crest_private.paired_invoice_credit_source_token(uuid) TO crest_paired_credit_export_owner;

DO $grants$
DECLARE source record; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.paired_invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.paired_invoice_credit_source_check_group(source.group_name,source.fields);
  IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
   OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_AUTHORITY_REVIEW_REQUIRED';
  END IF;
  SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_paired_credit_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;
CREATE POLICY paired_invoice_credit_source_export_read ON crest.paired_invoice_credit_releases FOR SELECT TO crest_paired_credit_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);

CREATE FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.paired_invoice_credit_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.paired_invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.paired_invoice_credit_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','paired_invoice_credit_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.paired_invoice_credit_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.paired_invoice_credit_source_token(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.paired_invoice_credit_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.paired_invoice_credit_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_PAIRED_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_paired_credit_export_owner;
ALTER FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(uuid) OWNER TO crest_paired_credit_export_owner;
ALTER FUNCTION crest_commands.paired_invoice_credit_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_paired_credit_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_paired_credit_export_owner;
REVOKE ALL ON FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(uuid),
 crest_commands.paired_invoice_credit_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.paired_invoice_credit_source_snapshot_context(uuid),
 crest_commands.paired_invoice_credit_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;


SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.unapplication_source_token_v2(requested_business uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $token$
 SELECT encode(sha256(convert_to('crest.paired.unapplication.source.v2:'||crest_private.unapplication_source_token(requested_business),'UTF8')),'hex');
$token$;
REVOKE ALL ON FUNCTION crest_private.unapplication_source_token_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.unapplication_source_token_v2(uuid) TO crest_unapplication_export_owner;

CREATE FUNCTION crest_commands.unapplication_source_snapshot_context_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.unapplication_source_token_v2(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.unapplication_source_dictionary() LOOP
  PERFORM crest_private.unapplication_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',2,'scope','allocation_unapplication_sources_v2','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.unapplication_source_snapshot_page_v2(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.unapplication_source_token_v2(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.unapplication_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_UNAPPLICATION_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.unapplication_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',2,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_UNAPPLICATION_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_unapplication_export_owner;
ALTER FUNCTION crest_commands.unapplication_source_snapshot_context_v2(uuid) OWNER TO crest_unapplication_export_owner;
ALTER FUNCTION crest_commands.unapplication_source_snapshot_page_v2(uuid,text,text,uuid,integer) OWNER TO crest_unapplication_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_unapplication_export_owner;
REVOKE ALL ON FUNCTION crest_commands.unapplication_source_snapshot_context_v2(uuid),crest_commands.unapplication_source_snapshot_page_v2(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.unapplication_source_snapshot_context_v2(uuid),crest_commands.unapplication_source_snapshot_page_v2(uuid,text,text,uuid,integer) TO crest_export;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.invoice_credit_source_token_v2(requested_business uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $token$
 SELECT encode(sha256(convert_to('crest.paired.invoice_credit.source.v2:'||crest_private.invoice_credit_source_token(requested_business),'UTF8')),'hex');
$token$;
REVOKE ALL ON FUNCTION crest_private.invoice_credit_source_token_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.invoice_credit_source_token_v2(uuid) TO crest_invoice_credit_export_owner;

CREATE FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.invoice_credit_source_token_v2(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.invoice_credit_source_dictionary() LOOP
  PERFORM crest_private.invoice_credit_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',2,'scope','invoice_credit_sources_v2','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.invoice_credit_source_snapshot_page_v2(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.invoice_credit_source_token_v2(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.invoice_credit_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.invoice_credit_source_check_group(requested_group,fields);
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
  WHEN 'timestamp with time zone' THEN
   format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
  ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS spec(name,kind);

 EXECUTE format($query$
  WITH candidates AS MATERIALIZED (
   SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
   WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2) ORDER BY t.id LIMIT $3+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
  SELECT jsonb_build_object('schemaVersion',2,'businessId',$1,'snapshotToken',$4,'group',$5,
   'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
   'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_CREDIT_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_invoice_credit_export_owner;
ALTER FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(uuid) OWNER TO crest_invoice_credit_export_owner;
ALTER FUNCTION crest_commands.invoice_credit_source_snapshot_page_v2(uuid,text,text,uuid,integer) OWNER TO crest_invoice_credit_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_invoice_credit_export_owner;
REVOKE ALL ON FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(uuid),crest_commands.invoice_credit_source_snapshot_page_v2(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.invoice_credit_source_snapshot_context_v2(uuid),crest_commands.invoice_credit_source_snapshot_page_v2(uuid,text,text,uuid,integer) TO crest_export;
