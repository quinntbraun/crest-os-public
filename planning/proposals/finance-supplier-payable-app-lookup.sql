-- Resolves interrupted app writes by owner, operation, original recovery epoch,
-- and the originally requested payable or settlement ID.
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.lookup_fictional_supplier_payable_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original_epoch uuid,
 requested_operation uuid,requested_id uuid,kind text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE command text; entity_field text; saved record;
BEGIN
 IF original_epoch IS NULL OR requested_operation IS NULL OR requested_id IS NULL OR kind IS NULL OR kind NOT IN('payable','settlement')
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_PAYABLE_LOOKUP_REQUIRED'; END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 IF kind='payable' THEN command:='finance.supplier_bill.accrual';entity_field:='payableId';
 ELSE command:='finance.supplier_bill.settle';entity_field:='settlementId'; END IF;
 SELECT o.command_type,o.recovery_epoch,o.result INTO saved FROM crest_private.operations o
 WHERE (o.business_id,o.actor_id,o.operation_id)=(requested_business,expected_actor,requested_operation) AND o.state='committed';
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF saved.command_type IS NULL THEN RETURN jsonb_build_object('state','absent'); END IF;
 IF saved.command_type<>command OR saved.recovery_epoch IS DISTINCT FROM original_epoch
  OR saved.result->>entity_field IS DISTINCT FROM requested_id::text
 THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_supplier_payable_operation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_supplier_payable_operation(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
