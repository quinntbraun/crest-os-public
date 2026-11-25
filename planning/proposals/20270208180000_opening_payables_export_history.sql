-- HELD after funds sources. v2 retains complete original operation/audit text.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY opening_payables_export_operations ON crest_private.operations FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND command_type IN ('finance.opening_payables.save','finance.opening_payables.retire'));
CREATE POLICY opening_payables_export_audits ON crest_private.audit_events FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.command_type IN('finance.opening_payables.save','finance.opening_payables.retire')));
CREATE FUNCTION crest_commands.opening_payables_source_snapshot_v2(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE source jsonb; revisions jsonb; operations jsonb; audits jsonb; snapshot_result jsonb;
BEGIN
 source:=crest_commands.opening_payables_source_snapshot(requested_business);
 -- Convert bigint revision fields inside PostgreSQL, before any JSON number can
 -- pass through JavaScript. Exact evidence JSON text remains separately retained.
 SELECT coalesce(jsonb_agg(item||jsonb_build_object('row',(item->'row')||jsonb_build_object(
  'revision',item->'row'->>'revision','prior_revision',item->'row'->>'prior_revision')) ORDER BY ordinal),'[]') INTO revisions
  FROM jsonb_array_elements(source->'revisions') WITH ORDINALITY AS selected(item,ordinal);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id::text,'business_id',o.business_id::text,'operation_id',o.operation_id::text,'actor_id',o.actor_id::text,'command_type',o.command_type::text,'schema_version',o.schema_version::text,'recovery_epoch',o.recovery_epoch::text,'payload_hash',o.payload_hash::text,'state',o.state::text,'result_schema_version',o.result_schema_version::text,'result',o.result::text,'committed_at',to_char(o.committed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',o.created_by::text,'origin',o.origin::text,'import_row_id',o.import_row_id::text) ORDER BY o.operation_id),'[]') INTO operations
  FROM(SELECT id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id FROM crest_private.operations WHERE business_id=requested_business AND command_type IN('finance.opening_payables.save','finance.opening_payables.retire') ORDER BY operation_id LIMIT 1001) o;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'business_id',a.business_id::text,'operation_id',a.operation_id::text,'actor_id',a.actor_id::text,'entity_kind',a.entity_kind::text,'entity_id',a.entity_id::text,'entity_version',a.entity_version::text,'action',a.action::text,'reason',a.reason::text,'effective_at',to_char(a.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'delta',a.delta::text,'created_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recorded_at',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',a.created_by::text,'origin',a.origin::text,'import_row_id',a.import_row_id::text,'database_principal',a.database_principal::text,'payload',a.payload::text,'hash_input',a.hash_input::text,'event_hash',a.event_hash::text) ORDER BY a.operation_id),'[]') INTO audits
  FROM(SELECT a.id,a.business_id,a.operation_id,a.actor_id,a.entity_kind,a.entity_id,a.entity_version,a.action,a.reason,a.effective_at,a.delta,a.created_at,a.recorded_at,a.created_by,a.origin,a.import_row_id,a.database_principal,a.payload,a.hash_input,a.event_hash FROM crest_private.audit_events a WHERE a.business_id=requested_business AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.command_type IN('finance.opening_payables.save','finance.opening_payables.retire')) ORDER BY a.operation_id LIMIT 1001) a;
 snapshot_result:=source||jsonb_build_object('profile','crest.opening-payables-source-candidate.v2','revisions',revisions,'operations',operations,'audits',audits);
 IF jsonb_array_length(operations)>1000 OR jsonb_array_length(audits)>1000 OR octet_length(snapshot_result::text)>33554432 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_PAYABLES_SOURCE_LIMIT'; END IF;
 RETURN snapshot_result;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_payables_source_snapshot_v2(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_payables_source_snapshot_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_payables_source_snapshot_v2(uuid) TO crest_export;
