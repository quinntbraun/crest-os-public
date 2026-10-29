-- Unregistered after expense/receipt/activity proposals. Read-only exact original
-- expense lookup; absent never means a failed write or permits a replacement.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.lookup_expense_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint)') IS NOT NULL OR to_regprocedure('crest_commands.finish_expense_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('crest.expense_revisions') AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
SET LOCAL ROLE crest_expense_owner;
CREATE FUNCTION crest_commands.lookup_expense_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original_epoch uuid,requested_operation uuid,requested_expense uuid,expected_revision bigint) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;o crest_private.operations;r crest.expense_revisions;prior crest.expense_revisions;image jsonb;before_image jsonb;event crest_private.audit_events;action_name text;digest text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF original_epoch IS NULL OR requested_operation IS NULL OR requested_expense IS NULL OR expected_revision IS NULL OR expected_revision<0 OR expected_revision=9223372036854775807 THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_INPUT_REQUIRED';END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation;
 IF NOT FOUND OR o.command_type='operation.retire' THEN RETURN jsonb_build_object('state','absent');END IF;
 IF o.command_type IS DISTINCT FROM 'bookkeeping.expense.save' OR o.recovery_epoch IS DISTINCT FROM original_epoch OR o.schema_version<>1 OR o.state IS DISTINCT FROM 'committed' OR o.result_schema_version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_REVIEW_REQUIRED';END IF;
 SELECT * INTO r FROM crest.expense_revisions WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation AND expense_id=requested_expense AND revision=expected_revision+1;
 IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_REVIEW_REQUIRED';END IF;
 image:=crest_private.expense_projection(r);
 IF expected_revision>0 THEN
  SELECT * INTO prior FROM crest.expense_revisions WHERE business_id=requested_business AND expense_id=requested_expense AND revision=expected_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_REVIEW_REQUIRED';END IF;
  before_image:=crest_private.expense_projection(prior);
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',original_epoch,'expenseId',requested_expense,'expectedRevision',expected_revision::text,'payload',r.payload)::text,'UTF8')),'hex');
 action_name:=CASE WHEN expected_revision=0 THEN 'create' WHEN r.payload->'voided'='true'::jsonb THEN 'void' ELSE 'correct' END;
 SELECT * INTO event FROM crest_private.audit_events WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation AND entity_kind='expense_revisions' AND entity_id=requested_expense AND entity_version=r.revision AND action=action_name;
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation)<>1 OR o.payload_hash IS DISTINCT FROM digest OR o.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'expense',image) OR event.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_image,'after',image) OR event.hash_input IS DISTINCT FROM event.payload::text OR event.event_hash IS DISTINCT FROM encode(sha256(convert_to(event.hash_input,'UTF8')),'hex') THEN RAISE EXCEPTION 'EXPENSE_ORIGINAL_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','expense',image);
END $lookup$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_expense_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_expense_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint) TO crest_web;
