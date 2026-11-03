-- UNREGISTERED original-reference/retirement composition after amendment sharing.
-- No new grant, route, browser journal or automatic retry/retirement is enabled.
-- original_recorded is observation only; the independent typed receipt must bind
-- all original IDs/versions before any pending reference can be cleared.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>51 OR to_regprocedure('crest_private.amendment_send_result(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='fcd6f8c9553d55dccde5a9595814f0dc3b97c9eb15ba77d17291399a7d309dfd') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='9781cad97804a6e9342f5172c00d3736da2322a62a5a474325e3acbb977fbc7e') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ORIGINAL_SOURCE_REVIEW_REQUIRED';END IF;
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
CREATE OR REPLACE FUNCTION crest_private.operation_retirement_result(business uuid, actor uuid, original jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE o crest_private.operations;a record;decision jsonb;r jsonb;expected_delta jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=(original->'reference'->>'operationId')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF o.command_type<>'operation.retire' THEN
  IF o.command_type IS DISTINCT FROM original->>'commandType' OR o.schema_version<>(CASE WHEN o.command_type='quote.amendment.create' THEN 3 ELSE 1 END) OR o.state<>'committed' OR o.recovery_epoch::text IS DISTINCT FROM original->'reference'->>'recoveryEpoch' THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  -- Observation only. The caller must use the existing typed original lookup
  -- to validate receipt/source identity before clearing any pending reference.
  RETURN jsonb_build_object('schemaVersion',1,'state','original_recorded','original',original);
 END IF;
 decision:=o.result;r:=decision->'retirement';
 IF o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR jsonb_typeof(decision) IS DISTINCT FROM 'object' OR NOT(decision?&ARRAY['schemaVersion','state','original','retirement']) OR decision-ARRAY['schemaVersion','state','original','retirement']<>'{}'::jsonb OR decision->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR decision->>'state' IS DISTINCT FROM 'retired' OR decision->'original' IS DISTINCT FROM original OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']) OR r-ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']<>'{}'::jsonb OR r->>'operationRowId' IS DISTINCT FROM o.id::text OR r->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string' OR NOT crest_private.original_operation_uuid(r->'auditEventId') OR o.payload_hash IS DISTINCT FROM crest_private.operation_retirement_digest(actor,o.recovery_epoch,original,r->>'reason') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 expected_delta:=jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',o.id,'original',original,'recoveryEpoch',o.recovery_epoch,'reason',r->>'reason'));
 SELECT id,reason,recorded_at,delta,payload,hash_input,event_hash INTO a FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id AND entity_kind='operations' AND entity_id=o.id AND entity_version=1 AND action='retire';
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id)<>1 OR a.id::text IS DISTINCT FROM r->>'auditEventId' OR a.reason IS DISTINCT FROM r->>'reason' OR a.delta IS DISTINCT FROM expected_delta OR r->>'recordedAt' IS DISTINCT FROM to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') OR a.hash_input IS DISTINCT FROM a.payload::text OR a.event_hash IS DISTINCT FROM encode(sha256(convert_to(a.hash_input,'UTF8')),'hex') OR a.recorded_at<o.created_at OR a.recorded_at>o.committed_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 RETURN decision;
END $function$
;
RESET ROLE;
