-- Held owner-only download for a single completed import. Scope includes the
-- retained receipt, row reconciliation, and request history for that batch.
-- CSV fields are database-controlled UUIDs, enums, digests, times or integers.
GRANT EXECUTE ON FUNCTION crest_commands.lock_source_export_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY legacy_download_operation_read ON crest_private.operations FOR SELECT TO crest_legacy_contact_apply_owner
 USING(command_type='crm.legacy_contact.download' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid);
CREATE POLICY legacy_download_operation_insert ON crest_private.operations FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(command_type='crm.legacy_contact.download' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY legacy_download_operation_finish ON crest_private.operations FOR UPDATE TO crest_legacy_contact_apply_owner
 USING(command_type='crm.legacy_contact.download' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='pending')
 WITH CHECK(command_type='crm.legacy_contact.download' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='committed');
CREATE POLICY legacy_download_audit_insert ON crest_private.audit_events FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND entity_kind='legacy_contact_downloads' AND entity_version=1 AND action='authorized_handoff' AND origin='manual'
  AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='crm.legacy_contact.download' AND o.state='pending'));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
CREATE FUNCTION crest_commands.read_legacy_contact_download(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_batch uuid,expected_operation uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $download$
DECLARE receipt jsonb; outcomes text; requests text; result_count integer;
BEGIN
 IF requested_batch IS NULL OR expected_operation IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_DOWNLOAD_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.legacy_apply_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_request_business_id',requested_business::text,true),set_config('crest.legacy_apply_dispatch','0',true);
 SELECT o.result INTO receipt FROM crest.legacy_contact_applications a JOIN crest_private.operations o USING(business_id,operation_id)
 WHERE a.business_id=requested_business AND a.batch_id=requested_batch AND a.operation_id=expected_operation
  AND o.command_type='crm.legacy_contact.apply' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT count(*)::integer,string_agg(concat_ws(',',source_row,decision_revision,customer_action,coalesce(customer_id::text,''),
  coalesce(customer_version::text,''),vehicle_action,coalesce(vehicle_id::text,''),coalesce(vehicle_version::text,''))||E'\r\n',''
  ORDER BY source_row) INTO result_count,outcomes
 FROM crest.legacy_contact_application_rows WHERE business_id=requested_business AND batch_id=requested_batch;
 IF result_count IS DISTINCT FROM (receipt->>'rowCount')::integer OR outcomes IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_DOWNLOAD_ROWS_REQUIRED';
 END IF;
 SELECT coalesce(string_agg(concat_ws(',',operation_id,evidence_sha256,requested_by,
  to_char(requested_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),coalesce(outcome,'queued'),
  coalesce(to_char(completed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),''),attempt_count)||E'\r\n','' ORDER BY operation_id),'')
 INTO requests FROM crest_private.legacy_contact_apply_requests WHERE business_id=requested_business AND batch_id=requested_batch;
 RETURN jsonb_build_object('state','present','receipt',receipt,'outcomes',outcomes,'requests',requests);
END
$download$;

CREATE FUNCTION crest_commands.record_legacy_contact_download(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_batch uuid,expected_operation uuid,digest text,archive_bytes integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $handoff$
DECLARE operation uuid:=gen_random_uuid(); scope jsonb; receipt jsonb;
BEGIN
 IF requested_batch IS NULL OR expected_operation IS NULL OR digest IS NULL OR digest!~'^[a-f0-9]{64}$'
  OR archive_bytes IS NULL OR archive_bytes NOT BETWEEN 1 AND 16777216 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_DOWNLOAD_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.legacy_apply_business_id',requested_business::text,true),
  set_config('crest.operation_id',operation::text,true),set_config('crest.actor_id',expected_actor::text,true);
 IF NOT EXISTS(SELECT FROM crest.legacy_contact_applications a JOIN crest_private.operations o USING(business_id,operation_id)
  WHERE a.business_id=requested_business AND a.batch_id=requested_batch AND a.operation_id=expected_operation
   AND o.command_type='crm.legacy_contact.apply' AND o.state='committed') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEGACY_DOWNLOAD_UNAVAILABLE';
 END IF;
 scope:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,
  'applicationOperationId',expected_operation,'archiveSha256',digest,'archiveBytes',archive_bytes);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'crm.legacy_contact.download',1,expected_epoch,
  encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'legacy_contact_downloads',requested_batch,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual');
 receipt:=scope||jsonb_build_object('operationId',operation,'state','authorized_handoff');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation;
 RETURN receipt;
END
$handoff$;
REVOKE ALL ON FUNCTION crest_commands.read_legacy_contact_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.record_legacy_contact_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_legacy_contact_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.record_legacy_contact_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,integer) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_apply_owner;
