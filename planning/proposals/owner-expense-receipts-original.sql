-- Unregistered read-only original reserve/publication lookup over registered48
-- plus expense/receipt/activity/original proposals. No retry or runtime activation.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.lookup_expense_receipt_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,bigint)') IS NOT NULL OR to_regprocedure('crest_commands.lookup_expense_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint)') IS NULL THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('crest.expense_receipt_revisions') AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity) THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.expense_receipt_projection(crest.expense_receipt_revisions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND NOT proleakproof AND provolatile='i' AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='feb0d9246259de8d15bef54f2b338e6b391cd12e9e952d406b4063a4dd06ef28') THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.expense_receipt_digest(text,uuid,uuid,uuid,uuid,jsonb)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND NOT proleakproof AND provolatile='i' AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='1073505fb57c5080a2d86e5a92dd75b3daf1fa70da3fa1c74ba6f8f072e75094') THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
SET LOCAL ROLE crest_expense_owner;
CREATE FUNCTION crest_commands.lookup_expense_receipt_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original_epoch uuid,requested_operation uuid,requested_receipt uuid,requested_expense uuid,expected_expense_revision bigint,expected_receipt_revision bigint) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;o crest_private.operations;r crest.expense_receipt_revisions;prior crest.expense_receipt_revisions;image jsonb;before_image jsonb;event crest_private.audit_events;action_name text;command_name text;body jsonb;digest text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF original_epoch IS NULL OR requested_operation IS NULL OR requested_receipt IS NULL OR requested_expense IS NULL OR expected_expense_revision IS NULL OR expected_expense_revision<1 OR expected_receipt_revision IS NULL OR expected_receipt_revision NOT IN(0,1) THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_INPUT_REQUIRED';END IF;
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation;
 IF NOT FOUND OR o.command_type='operation.retire' THEN RETURN jsonb_build_object('state','absent');END IF;
 action_name:=CASE WHEN expected_receipt_revision=0 THEN 'reserve' ELSE 'publish' END;command_name:='bookkeeping.receipt.'||action_name;
 IF o.command_type IS DISTINCT FROM command_name OR o.recovery_epoch IS DISTINCT FROM original_epoch OR o.schema_version<>1 OR o.state IS DISTINCT FROM 'committed' OR o.result_schema_version IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_REVIEW_REQUIRED';END IF;
 SELECT * INTO r FROM crest.expense_receipt_revisions WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation AND receipt_id=requested_receipt AND expense_id=requested_expense AND expense_revision=expected_expense_revision AND revision=expected_receipt_revision+1;
 IF NOT FOUND OR r.reservation->>'recoveryEpoch' IS DISTINCT FROM original_epoch::text THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_REVIEW_REQUIRED';END IF;
 image:=crest_private.expense_receipt_projection(r);
 IF expected_receipt_revision=1 THEN
  SELECT * INTO prior FROM crest.expense_receipt_revisions WHERE business_id=requested_business AND receipt_id=requested_receipt AND revision=1;
  IF NOT FOUND OR prior.reservation IS DISTINCT FROM r.reservation OR prior.candidate IS NOT NULL THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_REVIEW_REQUIRED';END IF;
  before_image:=crest_private.expense_receipt_projection(prior);
 END IF;
 body:=CASE WHEN expected_receipt_revision=0 THEN jsonb_build_object('expenseId',r.expense_id,'expenseRevision',r.expense_revision::text,'declaredType',r.reservation->'declaredType','byteSize',r.reservation->'byteSize') ELSE jsonb_build_object('candidate',r.candidate) END;
 digest:=crest_private.expense_receipt_digest(command_name,requested_business,expected_actor,original_epoch,requested_receipt,body);
 SELECT * INTO event FROM crest_private.audit_events WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation AND entity_kind='expense_receipt_revisions' AND entity_id=requested_receipt AND entity_version=r.revision AND action=action_name;
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=requested_operation)<>1 OR o.payload_hash IS DISTINCT FROM digest OR o.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'record',image) OR event.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',before_image,'after',image) OR event.hash_input IS DISTINCT FROM event.payload::text OR event.event_hash IS DISTINCT FROM encode(sha256(convert_to(event.hash_input,'UTF8')),'hex') THEN RAISE EXCEPTION 'RECEIPT_ORIGINAL_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','receipt',image);
END $lookup$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.lookup_expense_receipt_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_expense_receipt_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,bigint) TO crest_web;
