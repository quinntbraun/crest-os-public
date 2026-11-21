-- Read-only dated financial history; retained commands and legacy readers stay unchanged.
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY finance_history_recording_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND (
  (entity_kind='accounts' AND action IN ('create','revise') AND EXISTS (
   SELECT 1 FROM crest.account_versions v WHERE
    (v.business_id,v.audit_event_id,v.account_id,v.version,v.created_by,v.operation_id)=
    (audit_events.business_id,audit_events.id,audit_events.entity_id,audit_events.entity_version,audit_events.actor_id,audit_events.operation_id)))
  OR
  (entity_kind='tax_profiles' AND action IN ('approve') AND EXISTS (
   SELECT 1 FROM crest.tax_profiles v WHERE
    (v.business_id,v.audit_event_id,v.id,v.version,v.created_by,v.operation_id)=
    (audit_events.business_id,audit_events.id,audit_events.entity_id,audit_events.entity_version,audit_events.actor_id,audit_events.operation_id)))
  OR
  (entity_kind='money_channel_versions' AND action IN ('create','revise') AND EXISTS (
   SELECT 1 FROM crest.money_channel_versions v WHERE
    (v.business_id,v.audit_event_id,v.channel_id,v.version,v.created_by,v.operation_id)=
    (audit_events.business_id,audit_events.id,audit_events.entity_id,audit_events.entity_version,audit_events.actor_id,audit_events.operation_id)))
 ));
CREATE FUNCTION crest_private.finance_history_recording_evidence(history jsonb, business uuid, kind text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $evidence$
DECLARE items jsonb;
BEGIN
 IF kind IS NULL OR kind NOT IN ('accounts','tax_profiles','money_channel_versions') OR business IS NULL
  OR business IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid
  OR history->>'businessId' IS DISTINCT FROM business::text OR history->>'schemaVersion' IS DISTINCT FROM '1'
  OR jsonb_typeof(history->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(history->'rows')>25 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='FINANCE_HISTORY_RECORDING_INPUT_REQUIRED';
 END IF;
 SELECT coalesce(jsonb_agg(item.value||jsonb_build_object('recording',
  CASE WHEN a.id IS NOT NULL THEN jsonb_build_object(
   'recordedAt',to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
   'actorId',a.actor_id) ELSE NULL END) ORDER BY item.ordinality),'[]'::jsonb)
 INTO items FROM jsonb_array_elements(history->'rows') WITH ORDINALITY item(value,ordinality)
 LEFT JOIN crest_private.audit_events a ON a.business_id=business AND a.id=(item.value->>'auditEventId')::uuid
  AND a.entity_kind=kind AND a.entity_version=(item.value->>'version')::bigint
  AND a.entity_id=(CASE WHEN kind='money_channel_versions' THEN item.value->>'channelId' ELSE item.value->>'id' END)::uuid
  AND ((kind='tax_profiles' AND a.action='approve') OR (kind<>'tax_profiles' AND a.action IN ('create','revise')));
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(items) item WHERE item->'recording'='null'::jsonb) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FINANCE_HISTORY_RECORDING_REVIEW_REQUIRED';
 END IF;
 RETURN (history-'rows')||jsonb_build_object('schemaVersion',2,'rows',items);
END $evidence$;

CREATE FUNCTION crest_commands.read_finance_account_history_evidence(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_account uuid, after_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE history jsonb;
BEGIN
 history:=crest_commands.read_finance_account_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 RETURN crest_private.finance_history_recording_evidence(history,requested_business,'accounts');
END $history$;

CREATE FUNCTION crest_commands.read_finance_tax_profile_history_evidence(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 jurisdiction text, applicability text, service_id uuid, before_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE history jsonb;
BEGIN
 history:=crest_commands.read_finance_tax_profile_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
 RETURN crest_private.finance_history_recording_evidence(history,requested_business,'tax_profiles');
END $history$;

CREATE FUNCTION crest_commands.read_money_channel_history_evidence(
 credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text,
 expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamptz, requested_business uuid,
 requested_channel uuid, before_version bigint, page_limit integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE history jsonb;
BEGIN
 history:=crest_commands.read_money_channel_history($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
 RETURN crest_private.finance_history_recording_evidence(history,requested_business,'money_channel_versions');
END $history$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_private.finance_history_recording_evidence(jsonb,uuid,text) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_finance_account_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_finance_tax_profile_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,bigint,integer) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_money_channel_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_private.finance_history_recording_evidence(jsonb,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_commands.read_finance_account_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_finance_account_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_finance_tax_profile_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_finance_tax_profile_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text,uuid,bigint,integer) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.read_money_channel_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_money_channel_history_evidence(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_finance_preview;
