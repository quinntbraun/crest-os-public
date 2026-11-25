-- HELD; original commands/audits remain unchanged. Private responses include the exact historical parent.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.opening_allocations_private_response(value jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $response$
DECLARE saved jsonb; parent crest.opening_payables_schedule_revisions;
BEGIN
 IF value->>'state'='committed' THEN saved:=value->'receipt';
 ELSIF value?'schedule' THEN saved:=value->'schedule';
 ELSE RETURN value; END IF;
 IF saved='null' THEN RETURN value||jsonb_build_object('supplierSchedule',NULL);END IF;
 SELECT * INTO STRICT parent FROM crest.opening_payables_schedule_revisions p
  WHERE p.business_id=(saved->>'businessId')::uuid AND p.worksheet_revision_id=(saved->>'worksheetRevisionId')::uuid
   AND p.revision=(saved->>'payablesRevision')::bigint;
 RETURN value||jsonb_build_object('supplierSchedule',crest_private.opening_payables_receipt(parent));
END $response$;
REVOKE ALL ON FUNCTION crest_private.opening_allocations_private_response(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_allocations_private_response(jsonb) TO crest_finance_account_owner;
CREATE FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,operation uuid,worksheet_revision bigint,payables_revision bigint,expected_revision bigint,lines jsonb,reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.save_fictional_opening_allocations_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,bigint,jsonb,text) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,worksheet bigint) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.read_fictional_opening_allocations_schedule($1,$2,$3,$4,$5,$6,$7,$8,$9,$10))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_allocations_schedule_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,operation uuid,original_epoch uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.lookup_fictional_opening_allocations_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,business uuid,epoch uuid,operation uuid,original_epoch uuid,reason text) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $command$
 SELECT crest_private.opening_allocations_private_response(crest_commands.retire_fictional_opening_allocations_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12))
$command$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.retire_fictional_opening_allocations_save_v2(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;
SET LOCAL ROLE crest_schema_owner;
RESET ROLE;
