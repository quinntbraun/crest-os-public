-- UNREGISTERED acceptance original-reference composition after the full closure.
-- Reuses the exact unique operation claim, fresh authority and immutable audited
-- retirement. No route, new grant, retry or release of an absent lookup.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52 OR to_regprocedure('crest_commands.lookup_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='c764d24c6092b365402c14f474bf67f5c32a3ab946abe43e7d3232412cdb0fc3')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4ad7fd691b4657eb2d554633a4c71758a5dbda76195897b1e13fe508c8237866')
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_ORIGINAL_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 IF kind='quote.amendment.accept' THEN
  keys:=ARRAY['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId','sendId','customerId','expectedParentAgreementId','expectedParentAgreementVersion'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
  FOREACH key IN ARRAY keys LOOP
   IF key IN('expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedParentAgreementVersion') THEN
    IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
   ELSIF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;
  END LOOP;
  RETURN coalesce((r->>'expectedFamilyVersion')::numeric<9223372036854775807 AND (r->>'expectedRevisionVersion')::numeric<9223372036854775807 AND (r->>'expectedParentAgreementVersion')::numeric<9223372036854775807 AND (r->>'expectedContentVersion')::numeric<=(r->>'expectedRevisionVersion')::numeric AND r->>'agreementId'<>r->>'expectedParentAgreementId',false);
 END IF;
 IF kind IN('quote.amendment.create','quote.amendment.send') THEN
  keys:=ARRAY['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedParentAgreementId','expectedParentAgreementVersion']||(CASE WHEN kind='quote.amendment.send' THEN ARRAY['expectedContentVersion','sendId','approvalId','replacesRevisionId'] ELSE ARRAY[]::text[] END);
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
  FOREACH key IN ARRAY keys LOOP
   IF key IN('expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedParentAgreementVersion') THEN
    IF NOT crest_private.original_operation_version(r->key,kind='quote.amendment.create' AND key='expectedRevisionVersion') THEN RETURN false;END IF;
   ELSIF key<>'replacesRevisionId' AND NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;
  END LOOP;
  IF (r->>'expectedFamilyVersion')::numeric>=9223372036854775807 THEN RETURN false;END IF;
  IF kind='quote.amendment.create' THEN RETURN r->>'expectedRevisionVersion'='0' AND (r->>'expectedParentAgreementVersion')::numeric<9223372036854775807;END IF;
  RETURN coalesce((r->>'expectedRevisionVersion')::numeric<9223372036854775807 AND (r->>'expectedContentVersion')::numeric<=(r->>'expectedRevisionVersion')::numeric AND (r->'replacesRevisionId'='null'::jsonb OR crest_private.original_operation_uuid(r->'replacesRevisionId') AND r->>'replacesRevisionId'<>r->>'revisionId'),false);
 END IF;
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
 WHEN 'operations.fulfillment_modes.initialize' THEN ARRAY['expectedSequence']
 WHEN 'operations.fulfillment_modes.save' THEN ARRAY['expectedSequence']
 WHEN 'operations.job.book' THEN ARRAY['jobId','expectedModeSequence']
 WHEN 'operations.job.cancel' THEN ARRAY['jobId','expectedJobVersion']
 WHEN 'operations.job.reschedule' THEN ARRAY['jobId','expectedJobVersion','action','latestAppointmentId']
 WHEN 'quote.replacement.create' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key='expectedJobVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key IN ('expectedSequence','expectedModeSequence','expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state','quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept')) THEN RETURN false;END IF;
  ELSIF key='expenseRevision' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.replacement.create' AND (r->>'expectedFamilyVersion'='0' OR r->>'expectedRevisionVersion'<>'0') THEN RETURN false;END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 IF kind='bookkeeping.receipt.reserve' AND r->>'expectedRevision'<>'0' OR kind='bookkeeping.receipt.publish' AND r->>'expectedRevision'<>'1' THEN RETURN false;END IF;
 IF kind='operations.job.reschedule' AND NOT coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN('propose','confirm','withdraw'),false) THEN RETURN false;END IF;
 IF kind='operations.fulfillment_modes.save' AND r->>'expectedSequence'='0' THEN RETURN false;END IF;
 IF kind='operations.fulfillment_modes.initialize' AND r->>'expectedSequence'<>'0' THEN RETURN false;END IF;
 RETURN true;
END $function$
;
RESET ROLE;
