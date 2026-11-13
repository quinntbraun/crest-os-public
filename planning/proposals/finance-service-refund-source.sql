-- Private, bounded P08 source reads. The base finance snapshot retains its original row scopes.
CREATE ROLE crest_service_refund_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_service_refund_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_service_refund_export_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid) TO crest_service_refund_export_owner;

SET LOCAL ROLE crest_schema_owner;
ALTER POLICY held_tip_source_export_read ON crest.fund_lot_range_consumptions USING(
 business_id=nullif(current_setting('crest.business_id',true),'')::uuid
 AND (fund_application_id IS NOT NULL OR tip_realization_id IS NOT NULL));

CREATE FUNCTION crest_private.service_refund_source_dictionary()
RETURNS TABLE(group_name text, fields text[])
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
VALUES
 ('service_credit_refunds',ARRAY['id','business_id','pair_id','fund_lot_id','first_cent','last_cent','cents',
  'channel_version_id','account_id','evidence_id','actual_on','confirmation','reason','operation_id','created_by','created_at']),
 ('fund_lot_range_consumptions',ARRAY['id','business_id','fund_lot_id','first_cent','last_cent',
  'fund_application_id','tip_realization_id','service_refund_id']),
 ('financial_events',ARRAY['id','business_id','group_id','event_sequence','invoice_id','period_id','period_generation',
  'reopened_generation','effective_on','time_zone','template','template_version','zero_effect_reason','posted_at',
  'payment_id','posted_expense_id','unapplication_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id']),
 ('atomic_finance_groups',ARRAY['id','business_id','commit_sequence','recovery_epoch','created_by','operation_id','created_at']),
 ('journal_entries',ARRAY['id','business_id','event_id','entry_sequence']),
 ('journal_lines',ARRAY['id','business_id','entry_id','invoice_item_id','receivable_id','account_id','fixed_mapping_id',
  'tax_payable_movement_id','purpose','debit_cents','credit_cents','money_movement_id','allocation_event_id','unapplication_id',
  'fund_lot_id','fund_application_id','tip_realization_id','invoice_credit_id','service_refund_id']),
 ('money_movements',ARRAY['id','business_id','event_id','account_id','evidence_id','signed_cents']),
 ('external_money_evidence',ARRAY['id','business_id','provider_namespace','external_account_id','id_namespace','external_id',
  'raw_reference','normalization_rule','confirmed_on','signed_cents','currency']);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.service_refund_source_dictionary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.service_refund_source_dictionary() TO crest_service_refund_export_owner;

DO $grants$
DECLARE source record; relation oid; columns text;
BEGIN
 FOR source IN SELECT * FROM crest_private.service_refund_source_dictionary() LOOP
  SELECT c.oid INTO relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='crest' AND c.relname=source.group_name AND c.relkind='r'
   AND c.relowner='crest_schema_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity;
  IF relation IS NULL OR source.fields IS DISTINCT FROM (SELECT array_agg(attname::text ORDER BY attnum)
   FROM pg_attribute WHERE attrelid=relation AND attnum>0 AND NOT attisdropped)
   OR has_any_column_privilege('crest_export',relation,'SELECT,INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SERVICE_REFUND_SOURCE_SCHEMA_REVIEW_REQUIRED';END IF;
  SELECT string_agg(format('%I',name),',') INTO columns FROM unnest(source.fields) AS name;
  EXECUTE format('GRANT SELECT(%s) ON crest.%I TO crest_service_refund_export_owner',columns,source.group_name);
 END LOOP;
END $grants$;

CREATE POLICY service_refund_source_export ON crest.service_credit_refunds FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY service_refund_source_export ON crest.fund_lot_range_consumptions FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND service_refund_id IS NOT NULL);
CREATE POLICY service_refund_source_export ON crest.financial_events FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND template='P08');
CREATE POLICY service_refund_source_export ON crest.atomic_finance_groups FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=atomic_finance_groups.business_id AND e.group_id=atomic_finance_groups.id));
CREATE POLICY service_refund_source_export ON crest.journal_entries FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=journal_entries.business_id AND e.id=journal_entries.event_id));
CREATE POLICY service_refund_source_export ON crest.journal_lines FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.journal_entries j WHERE j.business_id=journal_lines.business_id AND j.id=journal_lines.entry_id));
CREATE POLICY service_refund_source_export ON crest.money_movements FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.financial_events e WHERE e.business_id=money_movements.business_id AND e.id=money_movements.event_id));
CREATE POLICY service_refund_source_export ON crest.external_money_evidence FOR SELECT TO crest_service_refund_export_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND EXISTS(
  SELECT FROM crest.money_movements m WHERE m.business_id=external_money_evidence.business_id AND m.evidence_id=external_money_evidence.id));

CREATE FUNCTION crest_commands.service_refund_source_snapshot(requested_business uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source record; history jsonb; rows jsonb:='{}'::jsonb; items jsonb; projection text; row_count integer:=0;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='SERVICE_REFUND_SOURCE_SNAPSHOT_REQUIRED';END IF;
 history:=crest_commands.business_history_export_context(requested_business);
 PERFORM set_config('crest.business_id',requested_business::text,true),
  set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 FOR source IN SELECT * FROM crest_private.service_refund_source_dictionary() LOOP
  SELECT string_agg(format('%L,%s',name,
   CASE WHEN name IN('created_at','posted_at') THEN
    format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',name)
   ELSE format('t.%I::text',name) END),',' ORDER BY position)
  INTO projection FROM unnest(source.fields) WITH ORDINALITY AS f(name,position);
  EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY id),''[]''::jsonb) FROM (
   SELECT t.id,jsonb_build_object(%s) AS value FROM crest.%I t WHERE t.business_id=$1 ORDER BY t.id LIMIT 1001
   ) scoped',projection,source.group_name) INTO items USING requested_business;
  row_count:=row_count+jsonb_array_length(items);
  IF row_count>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SERVICE_REFUND_SOURCE_LIMIT';END IF;
  rows:=rows||jsonb_build_object(source.group_name,items);
 END LOOP;
 IF octet_length(rows::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SERVICE_REFUND_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'historySnapshotToken',history->>'snapshotToken','rows',rows);
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_service_refund_export_owner;
ALTER FUNCTION crest_commands.service_refund_source_snapshot(uuid) OWNER TO crest_service_refund_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_service_refund_export_owner;
REVOKE ALL ON FUNCTION crest_commands.service_refund_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.service_refund_source_snapshot(uuid) TO crest_export;
