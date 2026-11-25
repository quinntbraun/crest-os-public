-- Read-only approval recording evidence. Historical snapshots and commands stay v1.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(recorded_at) ON crest_private.audit_events TO crest_finance_account_owner;
CREATE POLICY finance_mapping_recording_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND entity_kind='account_mapping_versions' AND action='approve'
  AND EXISTS (SELECT 1 FROM crest.account_mapping_versions m
   WHERE (m.business_id,m.audit_event_id,m.id,m.version,m.created_by,m.operation_id)=
    (audit_events.business_id,audit_events.id,audit_events.entity_id,audit_events.entity_version,audit_events.actor_id,audit_events.operation_id)));

CREATE FUNCTION crest_commands.read_finance_mapping_history_evidence(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_purpose text, before_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE history jsonb; items jsonb;
BEGIN
 -- The retained v1 reader owns input validation, tenant authorization, ordering,
 -- contiguous versions and pagination. Do not substitute a direct table read.
 history:=crest_commands.read_fixed_finance_mapping_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 SELECT coalesce(jsonb_agg(item.value||jsonb_build_object('recording',
   CASE WHEN a.id IS NOT NULL THEN jsonb_build_object(
    'recordedAt',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actorId',a.actor_id) ELSE NULL END) ORDER BY item.ordinality),'[]'::jsonb)
 INTO items
 FROM jsonb_array_elements(history->'rows') WITH ORDINALITY AS item(value,ordinality)
 LEFT JOIN crest.account_mapping_versions m ON m.business_id=requested_business
  AND m.id=(item.value->>'id')::uuid AND m.purpose=requested_purpose
  AND m.version=(item.value->>'version')::bigint AND m.audit_event_id=(item.value->>'auditEventId')::uuid
 LEFT JOIN crest_private.audit_events a ON (a.business_id,a.id)=(m.business_id,m.audit_event_id)
  AND a.entity_kind='account_mapping_versions' AND a.entity_id=m.id
  AND a.entity_version=m.version AND a.action='approve' AND a.actor_id=m.created_by
  AND a.operation_id=m.operation_id;
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(items) item WHERE item->'recording'='null'::jsonb) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_MAPPING_RECORDING_REVIEW_REQUIRED';
 END IF;
 RETURN (history-'rows')||jsonb_build_object('schemaVersion',2,'rows',items);
END $history$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_finance_mapping_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_finance_mapping_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_finance_mapping_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,bigint,integer) TO crest_finance_preview;
