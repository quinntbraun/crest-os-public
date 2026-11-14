-- Export-only complete worksheet revisions and their original operation/audit history.
CREATE ROLE crest_opening_worksheet_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_opening_worksheet_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_opening_worksheet_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,
 state,result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id)
 ON crest_private.operations TO crest_opening_worksheet_export_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,
 effective_at,delta,created_at,recorded_at,created_by,origin,import_row_id,database_principal,payload,hash_input,event_hash)
 ON crest_private.audit_events TO crest_opening_worksheet_export_owner;
GRANT SELECT ON crest.opening_worksheet_revisions TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_worksheet_export ON crest.opening_worksheet_revisions FOR SELECT TO crest_opening_worksheet_export_owner
 USING (business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
CREATE POLICY opening_worksheet_export_operations ON crest_private.operations FOR SELECT TO crest_opening_worksheet_export_owner
 USING (business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire'));
CREATE POLICY opening_worksheet_export_audit ON crest_private.audit_events FOR SELECT TO crest_opening_worksheet_export_owner
 USING (business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid AND
  EXISTS (SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire')));

CREATE FUNCTION crest_commands.opening_worksheet_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE revisions jsonb; operations jsonb; audits jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_WORKSHEET_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_SOURCE_BUSINESS_REQUIRED';
 END IF;
 PERFORM set_config('crest.opening_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'businessId',w.business_id,
  'revision',w.revision::text,'priorRevision',w.prior_revision::text,'cutoverOn',to_char(w.cutover_on,'YYYY-MM-DD'),
  'cutoverAt',to_char(w.cutover_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),'timeZone',w.time_zone,'operationId',w.operation_id,
  'auditEventId',w.audit_event_id,'recordedBy',w.recorded_by,'recordedAt',to_char(w.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidence',w.evidence::text,'evidenceSha256',w.evidence_sha256) ORDER BY w.revision),'[]') INTO revisions
 FROM (SELECT * FROM crest.opening_worksheet_revisions WHERE business_id=requested_business ORDER BY revision LIMIT 101) w;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'businessId',o.business_id,'operationId',o.operation_id,'actorId',o.actor_id,
  'commandType',o.command_type,'schemaVersion',o.schema_version,'recoveryEpoch',o.recovery_epoch,'payloadHash',o.payload_hash,
  'state',o.state,'resultSchemaVersion',o.result_schema_version,'result',o.result::text,
  'committedAt',to_char(o.committed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'createdAt',to_char(o.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'createdBy',o.created_by,'origin',o.origin,'importRowId',o.import_row_id) ORDER BY o.operation_id),'[]') INTO operations
 FROM (SELECT id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,
  result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id
  FROM crest_private.operations WHERE business_id=requested_business
   AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') ORDER BY operation_id LIMIT 201) o;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'businessId',a.business_id,'operationId',a.operation_id,'actorId',a.actor_id,
  'entityKind',a.entity_kind,'entityId',a.entity_id,'entityVersion',a.entity_version::text,'action',a.action,'reason',a.reason,
  'effectiveAt',to_char(a.effective_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'delta',a.delta::text,
  'createdAt',to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recordedAt',to_char(a.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'createdBy',a.created_by,
  'origin',a.origin,'importRowId',a.import_row_id,'databasePrincipal',a.database_principal,
  'payload',a.payload::text,'hashInput',a.hash_input,'eventHash',a.event_hash) ORDER BY a.operation_id),'[]') INTO audits
 FROM (SELECT id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,effective_at,
  delta,created_at,recorded_at,created_by,origin,import_row_id,database_principal,payload,hash_input,event_hash
  FROM crest_private.audit_events a WHERE a.business_id=requested_business AND EXISTS (
   SELECT FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=(a.business_id,a.operation_id,a.actor_id)
    AND o.command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire'))
  ORDER BY a.operation_id LIMIT 201) a;
 snapshot:=jsonb_build_object('schemaVersion',1,'scope','opening_worksheet_source','businessId',requested_business,
  'revisions',revisions,'operations',operations,'audits',audits);
 IF jsonb_array_length(revisions)>100 OR jsonb_array_length(operations)>200 OR jsonb_array_length(audits)>200
  OR octet_length(snapshot::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_SOURCE_LIMIT';
 END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_worksheet_source_snapshot(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_worksheet_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_worksheet_source_snapshot(uuid) TO crest_export;
