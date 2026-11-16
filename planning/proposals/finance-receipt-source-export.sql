-- Held exact P03 source. No worker, public download, or registered profile.
-- The existing export credential calls closed readers. A separate definer
-- prevents the P03 row policies from widening the frozen invoice profile.
DO $review$
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='crest_receipt_export_owner') OR
  NOT EXISTS(SELECT FROM pg_roles WHERE rolname='crest_export'
   AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR NOT EXISTS(SELECT FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
   AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
END $review$;
CREATE ROLE crest_receipt_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_receipt_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands,crest_private TO crest_receipt_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid),
 crest_commands.business_configuration_export_context(uuid) TO crest_receipt_export_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.receipt_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('external_money_evidence', ARRAY[
  'id:uuid', 'business_id:uuid', 'provider_namespace:text', 'external_account_id:uuid',
  'id_namespace:text', 'external_id:text', 'raw_reference:text', 'normalization_rule:text',
  'confirmed_on:date', 'signed_cents:bigint', 'currency:text'
 ]),
 ('payments', ARRAY[
  'id:uuid', 'business_id:uuid', 'customer_id:uuid', 'channel_version_id:uuid',
  'account_id:uuid', 'actual_on:date', 'gross_cents:bigint', 'confirmation:text',
  'distinct_reason:text', 'operation_id:uuid', 'created_by:uuid', 'created_at:timestamp with time zone'
 ]),
 ('money_movements', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'account_id:uuid',
  'evidence_id:uuid', 'signed_cents:bigint'
 ]),
 ('funding_origins', ARRAY[
  'id:uuid', 'business_id:uuid', 'payment_id:uuid', 'customer_id:uuid',
  'cents:bigint', 'currency:text'
 ]),
 ('funding_partitions', ARRAY[
  'id:uuid', 'business_id:uuid', 'origin_id:uuid', 'position:integer',
  'first_cent:bigint', 'last_cent:bigint'
 ]),
 ('allocation_events', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'partition_id:uuid',
  'receivable_id:uuid', 'cents:bigint'
 ]),
 ('atomic_finance_groups', ARRAY[
  'id:uuid', 'business_id:uuid', 'commit_sequence:bigint', 'recovery_epoch:uuid',
  'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('financial_events', ARRAY[
  'id:uuid', 'business_id:uuid', 'group_id:uuid', 'event_sequence:integer',
  'invoice_id:uuid', 'period_id:uuid', 'period_generation:bigint', 'reopened_generation:bigint',
  'effective_on:date', 'time_zone:text', 'template:text', 'template_version:integer',
  'zero_effect_reason:text', 'posted_at:timestamp with time zone', 'payment_id:uuid'
 ]),
 ('journal_entries', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'entry_sequence:integer'
 ]),
 ('journal_lines', ARRAY[
  'id:uuid', 'business_id:uuid', 'entry_id:uuid', 'invoice_item_id:uuid',
  'receivable_id:uuid', 'account_id:uuid', 'fixed_mapping_id:uuid', 'tax_payable_movement_id:uuid',
  'purpose:text', 'debit_cents:bigint', 'credit_cents:bigint', 'money_movement_id:uuid',
  'allocation_event_id:uuid'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.receipt_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.receipt_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
  AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
  SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
  FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.receipt_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.receipt_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_RECEIPT_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RECEIPT_SOURCE_SCOPE_REQUIRED';END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_RECEIPT_SOURCE_LIMIT';END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.direct.receipt.sources/1',requested_business,
  pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.receipt_source_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.receipt_source_dictionary(),
 crest_private.receipt_source_check_group(text,text[]),crest_private.receipt_source_token(uuid) TO crest_receipt_export_owner;

DO $grants$
DECLARE source record; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.receipt_source_dictionary() LOOP
  PERFORM crest_private.receipt_source_check_group(source.group_name,source.fields);
  IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
   OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN') THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_RECEIPT_SOURCE_AUTHORITY_REVIEW_REQUIRED';
  END IF;
  SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_receipt_export_owner',columns,source.group_name);
  IF source.group_name NOT IN ('atomic_finance_groups','financial_events','journal_entries','journal_lines') THEN
   EXECUTE format('CREATE POLICY receipt_source_export_read ON crest.%I FOR SELECT TO crest_receipt_export_owner
    USING (business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source.group_name);
  END IF;
 END LOOP;
END $grants$;
CREATE POLICY receipt_source_export_read ON crest.financial_events FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND template='P03');
CREATE POLICY receipt_source_export_read ON crest.atomic_finance_groups FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=atomic_finance_groups.business_id AND e.group_id=atomic_finance_groups.id));
CREATE POLICY receipt_source_export_read ON crest.journal_entries FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=journal_entries.business_id AND e.id=journal_entries.event_id));
CREATE POLICY receipt_source_export_read ON crest.journal_lines FOR SELECT TO crest_receipt_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.journal_entries j WHERE j.business_id=journal_lines.business_id AND j.id=journal_lines.entry_id));

CREATE FUNCTION crest_commands.receipt_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.receipt_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.receipt_source_dictionary() LOOP
  PERFORM crest_private.receipt_source_check_group(source.group_name,source.fields);
  EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
   INTO group_count USING requested_business;
  total:=total+group_count;
  IF total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_RECEIPT_SOURCE_LIMIT';END IF;
  counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','direct_receipt_sources','businessId',requested_business,
  'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.receipt_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.receipt_source_token(requested_business)
  OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RECEIPT_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.receipt_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_RECEIPT_SOURCE_PAGE_REQUIRED';END IF;
 PERFORM crest_private.receipt_source_check_group(requested_group,fields);
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
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_RECEIPT_SOURCE_LIMIT';END IF;
 RETURN result;
END $page$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_receipt_export_owner;
ALTER FUNCTION crest_commands.receipt_source_snapshot_context(uuid) OWNER TO crest_receipt_export_owner;
ALTER FUNCTION crest_commands.receipt_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_receipt_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_receipt_export_owner;
REVOKE ALL ON FUNCTION crest_commands.receipt_source_snapshot_context(uuid),
 crest_commands.receipt_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.receipt_source_snapshot_context(uuid),
 crest_commands.receipt_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;
