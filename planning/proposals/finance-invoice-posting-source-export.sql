-- Held invoice posting source capture. This source is private to the existing
-- export credential and is composed with business history in one read snapshot.
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.invoice_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('accounting_periods', ARRAY[
  'id:uuid', 'business_id:uuid', 'starts_on:date', 'month_start:date',
  'through_on:date', 'time_zone:text', 'opening_boundary:boolean', 'created_by:uuid',
  'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('invoice_series', ARRAY[
  'id:uuid', 'business_id:uuid', 'label:text', 'recovery_epoch:uuid',
  'kind:text', 'incident_id:uuid', 'approval_reason:text', 'created_by:uuid',
  'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('invoice_number_reservations', ARRAY[
  'id:uuid', 'business_id:uuid', 'full_number:text', 'series_id:uuid',
  'number_sequence:bigint', 'issued_source_id:uuid', 'incident_id:uuid', 'external_evidence:text',
  'recovery_epoch:uuid', 'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('accounting_period_locks', ARRAY[
  'id:uuid', 'business_id:uuid', 'period_id:uuid', 'generation:bigint',
  'previous_generation:bigint', 'state:text', 'evidence_ref:text', 'created_by:uuid',
  'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('tax_payable_mapping_versions', ARRAY[
  'id:uuid', 'business_id:uuid', 'jurisdiction:text', 'version:bigint',
  'previous_version:bigint', 'account_id:uuid', 'effective_from:date', 'reason:text',
  'audit_event_id:uuid', 'created_at:timestamp with time zone', 'created_by:uuid', 'operation_id:uuid'
 ]),
 ('invoice_exemption_evidence', ARRAY[
  'id:uuid', 'business_id:uuid', 'draft_id:uuid', 'draft_revision:bigint',
  'outcome_id:uuid', 'customer_id:uuid', 'jurisdiction:text', 'profile_id:uuid',
  'version:bigint', 'previous_version:bigint', 'valid_from:date', 'valid_through:date',
  'evidence_reference:text', 'reason:text', 'audit_event_id:uuid', 'created_at:timestamp with time zone',
  'created_by:uuid', 'operation_id:uuid'
 ]),
 ('invoices', ARRAY[
  'id:uuid', 'business_id:uuid', 'draft_id:uuid', 'draft_revision:bigint',
  'job_id:uuid', 'customer_id:uuid', 'reservation_id:uuid', 'invoice_number:text',
  'issued_on:date', 'due_on:date', 'time_zone:text', 'customer_snapshot:jsonb',
  'location_snapshot:jsonb', 'total_cents:bigint', 'currency:character(3)', 'created_at:timestamp with time zone',
  'created_by:uuid', 'operation_id:uuid'
 ]),
 ('invoice_items', ARRAY[
  'id:uuid', 'business_id:uuid', 'invoice_id:uuid', 'position:integer',
  'outcome_id:uuid', 'completion_part_id:uuid', 'partition_id:uuid', 'agreement_id:uuid',
  'entitlement_version_id:uuid', 'service_version_id:uuid', 'tax_profile_id:uuid', 'exemption_evidence_id:uuid',
  'gross_inclusive_cents:bigint', 'discount_inclusive_cents:bigint', 'gross_net_cents:bigint', 'discount_net_cents:bigint',
  'net_cents:bigint', 'tax_cents:bigint', 'total_cents:bigint', 'description:text',
  'created_at:timestamp with time zone', 'created_by:uuid', 'operation_id:uuid'
 ]),
 ('billing_consumptions', ARRAY[
  'id:uuid', 'business_id:uuid', 'invoice_item_id:uuid', 'partition_id:uuid',
  'consumed_cents:bigint', 'created_at:timestamp with time zone', 'created_by:uuid', 'operation_id:uuid'
 ]),
 ('atomic_finance_groups', ARRAY[
  'id:uuid', 'business_id:uuid', 'commit_sequence:bigint', 'recovery_epoch:uuid',
  'created_by:uuid', 'operation_id:uuid', 'created_at:timestamp with time zone'
 ]),
 ('financial_events', ARRAY[
  'id:uuid', 'business_id:uuid', 'group_id:uuid', 'event_sequence:integer',
  'invoice_id:uuid', 'period_id:uuid', 'period_generation:bigint', 'reopened_generation:bigint',
  'effective_on:date', 'time_zone:text', 'template:text', 'template_version:integer',
  'zero_effect_reason:text', 'posted_at:timestamp with time zone'
 ]),
 ('receivable_items', ARRAY[
  'id:uuid', 'business_id:uuid', 'invoice_id:uuid', 'account_id:uuid',
  'customer_id:uuid', 'original_cents:bigint', 'due_on:date'
 ]),
 ('invoice_tax_payable_movements', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'invoice_item_id:uuid',
  'tax_profile_id:uuid', 'mapping_id:uuid', 'account_id:uuid', 'jurisdiction:text',
  'cents:bigint'
 ]),
 ('journal_entries', ARRAY[
  'id:uuid', 'business_id:uuid', 'event_id:uuid', 'entry_sequence:integer'
 ]),
 ('journal_lines', ARRAY[
  'id:uuid', 'business_id:uuid', 'entry_id:uuid', 'invoice_item_id:uuid',
  'receivable_id:uuid', 'account_id:uuid', 'fixed_mapping_id:uuid', 'tax_payable_movement_id:uuid',
  'purpose:text', 'debit_cents:bigint', 'credit_cents:bigint'
 ]);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.invoice_source_dictionary() FROM PUBLIC;

CREATE FUNCTION crest_private.invoice_source_check_group(requested_group text, expected_fields text[])
RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $check$
DECLARE relation oid;
BEGIN
 SELECT c.oid INTO relation
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='crest' AND c.relname=requested_group AND c.relkind='r'
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
 IF relation IS NULL OR expected_fields IS DISTINCT FROM (
   SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
   FROM pg_attribute a WHERE a.attrelid=relation AND a.attnum>0 AND NOT a.attisdropped
 ) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_SCHEMA_REVIEW_REQUIRED';
 END IF;
END $check$;
REVOKE ALL ON FUNCTION crest_private.invoice_source_check_group(text,text[]) FROM PUBLIC;

CREATE FUNCTION crest_private.invoice_source_token(requested_business uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $token$
DECLARE snapshot_value text;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
   RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_INVOICE_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_SOURCE_SCOPE_REQUIRED';
 END IF;
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN
   RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_SOURCE_LIMIT';
 END IF;
 RETURN encode(sha256(convert_to(jsonb_build_array('crest.invoice.posting.sources/1',requested_business,
   pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
END $token$;
REVOKE ALL ON FUNCTION crest_private.invoice_source_token(uuid) FROM PUBLIC;

RESET ROLE;
DO $review$
DECLARE source record; columns text;
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_export','crest_export_owner')
     AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
     AND rolconfig IS NULL)<>2
   OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN('crest_export'::regrole,'crest_export_owner'::regrole)
      OR roleid='crest_export_owner'::regrole)
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE has_schema_privilege('crest_export_owner',oid,'CREATE')
      OR has_schema_privilege('crest_export',oid,'CREATE'))
   OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_export_owner'::regrole) AND a.grantee<>d.defaclrole)
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)')
      AND proowner='crest_export_owner'::regrole AND prosecdef)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;

 FOR source IN SELECT * FROM crest_private.invoice_source_dictionary() LOOP
   PERFORM crest_private.invoice_source_check_group(source.group_name,source.fields);
   IF has_any_column_privilege('crest_export',format('crest.%I',source.group_name),'SELECT,INSERT,UPDATE,REFERENCES')
     OR has_table_privilege('crest_export',format('crest.%I',source.group_name),'DELETE,TRUNCATE,TRIGGER,MAINTAIN')
   THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_INVOICE_SOURCE_AUTHORITY_REVIEW_REQUIRED';END IF;
   SELECT string_agg(format('%I',split_part(field,':',1)),',') INTO columns FROM unnest(source.fields) AS field;
   EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_export_owner',columns,source.group_name);
   EXECUTE format('CREATE POLICY invoice_source_export_read ON crest.%I FOR SELECT TO crest_export_owner
     USING (business_id=nullif(current_setting(''crest.business_id'',true),'''')::uuid)',source.group_name);
 END LOOP;
END $review$;

SET LOCAL ROLE crest_schema_owner;
GRANT EXECUTE ON FUNCTION crest_private.invoice_source_dictionary(),
 crest_private.invoice_source_check_group(text,text[]),crest_private.invoice_source_token(uuid) TO crest_export_owner;

CREATE FUNCTION crest_commands.invoice_source_snapshot_context(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $context$
DECLARE source record; token text; history jsonb; counts jsonb:='{}'::jsonb; group_count bigint; total bigint:=0;
BEGIN
 token:=crest_private.invoice_source_token(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
   set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.invoice_source_dictionary() LOOP
   PERFORM crest_private.invoice_source_check_group(source.group_name,source.fields);
   EXECUTE format('SELECT count(*) FROM (SELECT id FROM crest.%I WHERE business_id=$1 LIMIT 10001) bounded',source.group_name)
     INTO group_count USING requested_business;
   total:=total+group_count;
   IF total>10000 THEN
     RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_SOURCE_LIMIT';
   END IF;
   counts:=counts||jsonb_build_object(source.group_name,group_count::text);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'scope','invoice_posting_sources','businessId',requested_business,
   'snapshotToken',token,'historySnapshotToken',history->>'snapshotToken','counts',counts);
END $context$;

CREATE FUNCTION crest_commands.invoice_source_snapshot_page(requested_business uuid,expected_snapshot text,
 requested_group text,after_id uuid,page_limit integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $page$
DECLARE fields text[]; projection text; result jsonb;
BEGIN
 IF expected_snapshot IS DISTINCT FROM crest_private.invoice_source_token(requested_business)
   OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_SOURCE_PAGE_REQUIRED';
 END IF;
 SELECT d.fields INTO fields FROM crest_private.invoice_source_dictionary() d WHERE d.group_name=requested_group;
 IF fields IS NULL THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_INVOICE_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM crest_private.invoice_source_check_group(requested_group,fields);
 -- The page credential requires the same reviewed business export scope as context.
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
   set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);

 SELECT string_agg(format('%L,%s',name,CASE kind
   WHEN 'boolean' THEN format('t.%I',name)
   WHEN 'timestamp with time zone' THEN
     format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
 INTO projection
 FROM unnest(fields) WITH ORDINALITY AS f(field,position)
 CROSS JOIN LATERAL (SELECT split_part(field,':',1),split_part(field,':',2)) AS column_spec(name,kind);

 EXECUTE format($query$
   WITH candidates AS MATERIALIZED (
     SELECT t.id,jsonb_build_object(%s) AS row FROM crest.%I t
     WHERE t.business_id=$1 AND ($2 IS NULL OR t.id>$2)
     ORDER BY t.id LIMIT $3+1
   ), page AS (SELECT * FROM candidates ORDER BY id LIMIT $3)
   SELECT jsonb_build_object('schemaVersion',1,'businessId',$1,'snapshotToken',$4,'group',$5,
     'rows',coalesce((SELECT jsonb_agg(row ORDER BY id) FROM page),'[]'::jsonb),
     'hasMore',(SELECT count(*)>$3 FROM candidates))
 $query$,projection,requested_group) INTO result USING requested_business,after_id,page_limit,expected_snapshot,requested_group;
 IF octet_length(result::text)>4194304 THEN
   RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_INVOICE_SOURCE_LIMIT';
 END IF;
 RETURN result;
END $page$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_export_owner;
ALTER FUNCTION crest_commands.invoice_source_snapshot_context(uuid) OWNER TO crest_export_owner;
ALTER FUNCTION crest_commands.invoice_source_snapshot_page(uuid,text,text,uuid,integer) OWNER TO crest_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_export_owner;
REVOKE ALL ON FUNCTION crest_commands.invoice_source_snapshot_context(uuid),
 crest_commands.invoice_source_snapshot_page(uuid,text,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.invoice_source_snapshot_context(uuid),
 crest_commands.invoice_source_snapshot_page(uuid,text,text,uuid,integer) TO crest_export;
