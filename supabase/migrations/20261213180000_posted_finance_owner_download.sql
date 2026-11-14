-- P17 partial posted-finance handoff. The migration coordinator owns the transaction.
-- Uses the existing recent-owner export lock and immutable operation/audit history.
DO $review$
BEGIN
 IF to_regprocedure('crest_commands.service_refund_source_snapshot(uuid)') IS NULL
   OR to_regprocedure('crest_commands.lock_source_export_download_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') IS NULL
   OR to_regprocedure('crest_commands.authorize_posted_finance_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') IS NOT NULL
   OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass)
       AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>2 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_FINANCE_EXPORT_REVIEW_REQUIRED';
 END IF;
END $review$;

SET LOCAL ROLE crest_schema_owner;
CREATE POLICY posted_finance_export_operation_create ON crest_private.operations FOR INSERT TO crest_command_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND command_type='finance.export_access' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY posted_finance_export_operation_finish ON crest_private.operations FOR UPDATE TO crest_command_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND command_type='finance.export_access' AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND command_type='finance.export_access' AND state='committed' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY posted_finance_export_audit_create ON crest_private.audit_events FOR INSERT TO crest_command_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
   AND entity_kind='finance_export_accesses' AND entity_id=operation_id AND entity_version=1 AND action='authorized_handoff'
   AND origin='manual' AND import_row_id IS NULL
   AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
     AND o.actor_id=audit_events.actor_id AND o.operation_id=audit_events.operation_id
     AND o.command_type='finance.export_access' AND o.schema_version=1 AND o.state='pending'));

CREATE FUNCTION crest_commands.authorize_posted_finance_export(credential_hash bytea,expected_session uuid,expected_actor uuid,
 expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $auth$
DECLARE context jsonb; epoch uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 -- Use the reviewed settings reader solely for its current recovery epoch.
 -- This helper grants no settings table or browser authority.
 context:=crest_commands.read_business_settings_context($1,$2,$3,$4,$5,$6,$7,$8);
 epoch:=(context->>'recoveryEpoch')::uuid;
 IF context->>'writeState' IS DISTINCT FROM 'ready' OR epoch IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_POSTED_FINANCE_EXPORT_DENIED';
 END IF;
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,epoch);
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',epoch);
END $auth$;

CREATE FUNCTION crest_commands.record_posted_finance_export_access(credential_hash bytea,expected_session uuid,expected_actor uuid,
 expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,source_version integer,app_release text,observed_at text,manifest_digest text,archive_digest text,archive_bytes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $handoff$
DECLARE operation uuid:=gen_random_uuid(); event uuid; scope jsonb; receipt jsonb; recorded timestamptz; observed timestamptz;
BEGIN
 IF expected_epoch IS NULL OR source_version IS NULL OR source_version NOT BETWEEN 89 AND 999
   OR app_release IS NULL OR app_release!~'^[a-f0-9]{40}$' OR observed_at IS NULL
   OR observed_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00:00$'
   OR manifest_digest IS NULL OR manifest_digest!~'^[a-f0-9]{64}$' OR archive_digest IS NULL OR archive_digest!~'^[a-f0-9]{64}$'
   OR archive_bytes IS NULL OR archive_bytes NOT BETWEEN 1 AND 8388608 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 observed:=observed_at::timestamptz;
 IF NOT isfinite(observed) OR observed>clock_timestamp() OR observed<=clock_timestamp()-interval '2 minutes' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
   set_config('crest.operation_id',operation::text,true);
 scope:=jsonb_build_object('profile','crest.posted-finance-source.v7','sourceSchemaVersion',source_version,
   'appReleaseId',app_release,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,
   'observedAt',observed_at,'manifestSha256',manifest_digest,'archiveSha256',archive_digest,'archiveBytes',archive_bytes);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'finance.export_access',1,expected_epoch,
  encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'finance_export_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,recorded;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,
  'recordedAt',to_char(recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch,operation);
 RETURN receipt;
END $handoff$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.authorize_posted_finance_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.record_posted_finance_export_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,text,text,text,integer) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.read_business_settings_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) TO crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.authorize_posted_finance_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),
 crest_commands.record_posted_finance_export_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_posted_finance_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),
 crest_commands.record_posted_finance_export_access(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,text,text,text,integer) TO crest_web;
