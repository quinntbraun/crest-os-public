-- Unregistered integration after BOTH byte-exact expense/receipt proposals.
-- Foreground activity only; no ledger posting, business-rule or runtime activation.
DO $review$ BEGIN
 IF to_regprocedure('crest_commands.finish_expense_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') IS NOT NULL THEN RAISE EXCEPTION 'EXPENSE_ACTIVITY_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.save_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb)') AND p.proowner='crest_expense_owner'::regrole AND p.prosecdef AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='97188fd01ae728d305ad72dd29529d07f8189297d38bda279e25f74c2459e152') THEN RAISE EXCEPTION 'EXPENSE_ACTIVITY_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.reserve_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer)') AND p.proowner='crest_expense_owner'::regrole AND p.prosecdef AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='6ccded40154e15efe9291b841018638a29a9cf1bcbe4d57c45bfcaf4da04eb5f') THEN RAISE EXCEPTION 'EXPENSE_ACTIVITY_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.publish_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb)') AND p.proowner='crest_expense_owner'::regrole AND p.prosecdef AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='feb817dba2c4e779e2f7eaa1e3b9a10f0ffe3cb6c176603a4e0bd992cf2dec51') THEN RAISE EXCEPTION 'EXPENSE_ACTIVITY_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.finish_expense_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='EXPENSE_ACTIVITY_DENIED';END IF;
END $finish$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_expense_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner;
REVOKE ALL ON FUNCTION crest_commands.finish_expense_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.finish_expense_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_expense_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
SET LOCAL ROLE crest_expense_owner;
CREATE OR REPLACE FUNCTION crest_commands.save_expense(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_expense uuid,expected_revision bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; claimed uuid; o crest_private.operations; prior crest.expense_revisions; fresh crest.expense_revisions; image jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_expense IS NULL OR expected_revision IS NULL OR expected_revision<0 OR NOT crest_private.valid_expense_payload(body) THEN RAISE EXCEPTION 'EXPENSE_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'expenseId',requested_expense,'expectedRevision',expected_revision::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'bookkeeping.expense.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF o.actor_id IS DISTINCT FROM expected_actor OR o.command_type IS DISTINCT FROM 'bookkeeping.expense.save' OR o.payload_hash IS DISTINCT FROM digest OR o.state IS DISTINCT FROM 'committed' THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',o.result);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(requested_business::text||requested_expense::text,0));
  SELECT * INTO prior FROM crest.expense_revisions WHERE business_id=requested_business AND expense_id=requested_expense ORDER BY revision DESC LIMIT 1;
  IF coalesce(prior.revision,0)<>expected_revision OR prior.payload->'voided'='true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='EXPENSE_VERSION_CONFLICT';END IF;
  INSERT INTO crest.expense_revisions(business_id,expense_id,revision,operation_id,actor_id,payload) VALUES(requested_business,requested_expense,expected_revision+1,requested_operation,expected_actor,body) RETURNING * INTO fresh;
  image:=crest_private.expense_projection(fresh);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'expense_revisions',requested_expense,fresh.revision,CASE WHEN expected_revision=0 THEN 'create' WHEN body->'voided'='true'::jsonb THEN 'void' ELSE 'correct' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_revision=0 THEN 'null'::jsonb ELSE crest_private.expense_projection(prior) END,'after',image),'manual');
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'expense',image) WHERE business_id=requested_business AND operation_id=requested_operation;
  PERFORM crest_commands.finish_expense_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'expense',image));
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentRevision',coalesce(prior.revision,0)::text);
 END;
END $save$;

CREATE OR REPLACE FUNCTION crest_commands.reserve_expense_receipt(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_receipt uuid,requested_expense uuid,expected_expense_revision bigint,declared_type text,byte_size integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
DECLARE context jsonb;body jsonb;digest text;claimed uuid;o crest_private.operations;expense crest.expense_revisions;fresh crest.expense_receipt_revisions;r jsonb;dispatch uuid:=gen_random_uuid();image jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_receipt IS NULL OR requested_expense IS NULL OR expected_expense_revision IS NULL OR expected_expense_revision<1 OR declared_type IS NULL OR declared_type NOT IN('image/jpeg','image/png','image/heic','application/pdf') OR byte_size IS NULL OR byte_size NOT BETWEEN 1 AND 26214400 THEN RAISE EXCEPTION 'RECEIPT_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 body:=jsonb_build_object('expenseId',requested_expense,'expenseRevision',expected_expense_revision::text,'declaredType',declared_type,'byteSize',byte_size);digest:=crest_private.expense_receipt_digest('bookkeeping.receipt.reserve',requested_business,expected_actor,expected_epoch,requested_receipt,body);
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'bookkeeping.receipt.reserve',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;IF o.payload_hash IS DISTINCT FROM digest OR o.command_type IS DISTINCT FROM 'bookkeeping.receipt.reserve' OR o.state IS DISTINCT FROM 'committed' THEN RETURN jsonb_build_object('state','conflict');END IF;RETURN jsonb_build_object('state','committed','operationId',requested_operation,'receipt',o.result);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(requested_business::text||requested_expense::text,0));
  SELECT * INTO expense FROM crest.expense_revisions WHERE business_id=requested_business AND expense_id=requested_expense ORDER BY revision DESC LIMIT 1;
  IF expense.revision IS DISTINCT FROM expected_expense_revision OR expense.payload->'voided'='true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='RECEIPT_EXPENSE_CONFLICT';END IF;
  r:=jsonb_build_object('businessId',requested_business,'receiptId',requested_receipt,'expenseId',requested_expense,'expenseRevision',expected_expense_revision::text,'recoveryEpoch',expected_epoch,'declaredType',declared_type,'byteSize',byte_size,'stagingKey','staging/'||requested_business::text||'/'||requested_receipt::text||'/'||dispatch::text,'originalKey','originals/'||requested_business::text||'/'||requested_receipt::text,'previewKey','previews/'||requested_business::text||'/'||requested_receipt::text,'dispatchId',dispatch);
  INSERT INTO crest.expense_receipt_revisions(business_id,receipt_id,revision,expense_id,expense_revision,operation_id,actor_id,reservation) VALUES(requested_business,requested_receipt,1,requested_expense,expected_expense_revision,requested_operation,expected_actor,r) RETURNING * INTO fresh;image:=crest_private.expense_receipt_projection(fresh);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'expense_receipt_revisions',requested_receipt,1,'reserve',jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',image),'manual');
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'record',image) WHERE business_id=requested_business AND operation_id=requested_operation;
  PERFORM crest_commands.finish_expense_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN jsonb_build_object('state','committed','operationId',requested_operation,'receipt',jsonb_build_object('schemaVersion',1,'record',image));
 EXCEPTION WHEN SQLSTATE 'P1001' OR unique_violation THEN RETURN jsonb_build_object('state','conflict');END;
END $reserve$;

CREATE OR REPLACE FUNCTION crest_commands.publish_expense_receipt(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_receipt uuid,candidate jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $publish$
DECLARE context jsonb;prior crest.expense_receipt_revisions;fresh crest.expense_receipt_revisions;digest text;claimed uuid;o crest_private.operations;image jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_receipt IS NULL THEN RAISE EXCEPTION 'RECEIPT_INPUT_REQUIRED';END IF;
 PERFORM crest_commands.check_expense_receipt_writable($1,$2,$3,$4,$5,$6,$7,$8,$9,$11);PERFORM set_config('crest.operation_id',requested_operation::text,true);
 SELECT * INTO prior FROM crest.expense_receipt_revisions WHERE business_id=requested_business AND receipt_id=requested_receipt AND revision=1;
 IF crest_private.valid_receipt_candidate(candidate,prior.reservation) IS DISTINCT FROM true THEN RAISE EXCEPTION 'RECEIPT_CANDIDATE_REQUIRED';END IF;
 digest:=crest_private.expense_receipt_digest('bookkeeping.receipt.publish',requested_business,expected_actor,expected_epoch,requested_receipt,jsonb_build_object('candidate',candidate));
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'bookkeeping.receipt.publish',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;IF o.payload_hash IS DISTINCT FROM digest OR o.command_type IS DISTINCT FROM 'bookkeeping.receipt.publish' OR o.state IS DISTINCT FROM 'committed' THEN RETURN jsonb_build_object('state','conflict');END IF;RETURN jsonb_build_object('state','committed','operationId',requested_operation,'receipt',o.result);END IF;
  INSERT INTO crest.expense_receipt_revisions(business_id,receipt_id,revision,expense_id,expense_revision,operation_id,actor_id,reservation,candidate) VALUES(requested_business,requested_receipt,2,prior.expense_id,prior.expense_revision,requested_operation,expected_actor,prior.reservation,candidate) RETURNING * INTO fresh;image:=crest_private.expense_receipt_projection(fresh);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'expense_receipt_revisions',requested_receipt,2,'publish',jsonb_build_object('schemaVersion',1,'before',crest_private.expense_receipt_projection(prior),'after',image),'manual');
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=jsonb_build_object('schemaVersion',1,'record',image) WHERE business_id=requested_business AND operation_id=requested_operation;
  PERFORM crest_commands.finish_expense_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN jsonb_build_object('state','committed','operationId',requested_operation,'receipt',jsonb_build_object('schemaVersion',1,'record',image));
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('state','conflict');END;
END $publish$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
