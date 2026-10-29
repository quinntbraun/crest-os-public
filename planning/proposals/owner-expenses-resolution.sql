-- Unregistered financial original-review extension over registered48 and the
-- expense/receipt/activity/original proposals. Preserve all19 existing kinds.
DO $review$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND prosecdef=false AND NOT proleakproof AND provolatile='i' AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='8c5ab696e217d64e89cce4aad7c222017839ddace92420224dadb6eb166fde06') THEN RAISE EXCEPTION 'FINANCIAL_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text)') AND proowner='crest_command_owner'::regrole AND prosecdef=true AND NOT proleakproof AND provolatile='v' AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='7cebfed84d50d2f4fb5a61fbc83062e04bee58ea39528171abd5425287a88d60') THEN RAISE EXCEPTION 'FINANCIAL_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') AND proowner='crest_session_owner'::regrole AND prosecdef=true AND NOT proleakproof AND provolatile='v' AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='a2201e2c378a47d11053dfef8297f70652eddf060fc8728c173730157fe19a1d') THEN RAISE EXCEPTION 'FINANCIAL_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') AND proowner='crest_session_owner'::regrole AND prosecdef=true AND NOT proleakproof AND provolatile='v' AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='3b796c52c8e7ae4261e75ede6c06c41b36e997a53d5a1199829b8aa7c77fb0ab') THEN RAISE EXCEPTION 'FINANCIAL_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF to_regprocedure('crest_commands.lookup_expense_receipt_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,bigint)') IS NULL OR to_regprocedure('crest_commands.lock_financial_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'FINANCIAL_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 keys:=CASE kind
  WHEN 'bookkeeping.expense.save' THEN ARRAY['expenseId','expectedRevision']
  WHEN 'bookkeeping.receipt.reserve' THEN ARRAY['receiptId','expenseId','expenseRevision','expectedRevision']
  WHEN 'bookkeeping.receipt.publish' THEN ARRAY['receiptId','expenseId','expenseRevision','expectedRevision']
  WHEN 'business.rename' THEN ARRAY['expectedVersion']
  WHEN 'crm.customer.save' THEN ARRAY['customerId','expectedVersion']
  WHEN 'crm.address.save' THEN ARRAY['customerId','addressId','expectedVersion']
  WHEN 'crm.vehicle.save' THEN ARRAY['vehicleId','expectedVersion']
  WHEN 'crm.vehicle.association' THEN ARRAY['action','associationId','vehicleId','expectedVersion','nextAssociationId']
  WHEN 'crm.lead.source.save' THEN ARRAY['leadSourceId','expectedVersion']
  WHEN 'crm.lead.save' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.state' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.vehicle.save' THEN ARRAY['leadId','leadVehicleId','expectedVersion']
  WHEN 'crm.lead.address.save' THEN ARRAY['leadId','leadAddressId','expectedVersion']
  WHEN 'crm.lead.convert' THEN ARRAY['conversionId','leadId','expectedLeadVersion','customerId']
  WHEN 'catalog.service.save' THEN ARRAY['serviceId','expectedRevision']
  WHEN 'operations.appointment_hold.save' THEN ARRAY['holdId','expectedSequence']
  WHEN 'quote.draft.save' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion']
  WHEN 'quote.review.submit' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion']
  WHEN 'quote.review.approve' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId']
 WHEN 'quote.manual.send' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','sendId','approvalId']
 WHEN 'quote.confirmation.accept' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId']
 WHEN 'quote.replacement.create' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key IN ('expectedSequence','expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state','quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept')) THEN RETURN false;END IF;
  ELSIF key='expenseRevision' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.replacement.create' AND (r->>'expectedFamilyVersion'='0' OR r->>'expectedRevisionVersion'<>'0') THEN RETURN false;END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 IF kind='bookkeeping.receipt.reserve' AND r->>'expectedRevision'<>'0' OR kind='bookkeeping.receipt.publish' AND r->>'expectedRevision'<>'1' THEN RETURN false;END IF;
 RETURN true;
END $$;
CREATE FUNCTION crest_commands.lock_financial_retirement_authority(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $financial$
DECLARE context jsonb;
BEGIN
 context:=crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'finance.post',true);
 RETURN context;
END $financial$;
CREATE FUNCTION crest_commands.finish_financial_retirement_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $financial$
BEGIN
 PERFORM crest_commands.lock_financial_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);
 PERFORM crest_commands.lock_financial_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
END $financial$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.lock_financial_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_financial_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.lock_financial_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.finish_financial_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_financial_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.finish_financial_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_command_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.retire_original_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original jsonb,requested_reason text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;operation uuid;digest text;claimed uuid;existing record;event uuid;stamp timestamptz;decision jsonb;financial boolean;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.original_operation_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 2000 OR btrim(requested_reason,E' \t\n\r\u000b\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' OR translate(requested_reason,E'\t\n\r','')~('['||chr(1)||'-'||chr(31)||chr(127)||']') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
 -- JSONB numeric equality admits schemaVersion1.0 as version1. Normalize its
 -- representation before hashing/retaining so an equivalent later lookup is
 -- not rejected merely because the original caller used another spelling.
 original:=original||jsonb_build_object('schemaVersion',1);
 financial:=original->>'commandType' IN('bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish');
 context:=CASE WHEN financial THEN crest_commands.lock_financial_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch) ELSE crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch) END;
 operation:=(original->'reference'->>'operationId')::uuid;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',operation::text,true);
 digest:=crest_private.operation_retirement_digest(expected_actor,expected_epoch,original,requested_reason);
 -- The SAME unique key used by every original writer serializes both choices.
 -- A conflicting uncommitted original must finish before this can decide.
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,'operation.retire',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT command_type,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  IF financial THEN PERFORM crest_commands.lock_financial_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);ELSE PERFORM crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);END IF;
  IF existing.command_type='operation.retire' AND existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  decision:=crest_private.operation_retirement_result(requested_business,expected_actor,original);
  IF decision->>'state'='retired' THEN IF financial THEN PERFORM crest_commands.finish_financial_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);ELSE PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);END IF;END IF;
  RETURN decision;
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,operation,expected_actor,expected_actor,'operations',claimed,1,'retire',requested_reason,jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',claimed,'original',original,'recoveryEpoch',expected_epoch,'reason',requested_reason)),'manual') RETURNING id,recorded_at INTO event,stamp;
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','original',original,'retirement',jsonb_build_object('operationRowId',claimed,'auditEventId',event,'recoveryEpoch',expected_epoch,'reason',requested_reason,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=operation;
 IF financial THEN PERFORM crest_commands.finish_financial_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);ELSE PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);END IF;
 RETURN crest_private.operation_retirement_result(requested_business,expected_actor,original);
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
