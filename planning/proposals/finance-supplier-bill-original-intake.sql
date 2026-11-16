-- Held supplier original intake. Apply after the P14 proposals in a disposable
-- workspace. Browser authorization and the isolated validator are distinct.
CREATE ROLE crest_supplier_bill_document_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA crest_commands TO crest_supplier_bill_document_worker;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.supplier_bill_original_intents (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 bill_revision bigint NOT NULL,
 document_reference text NOT NULL,
 recovery_epoch uuid NOT NULL,
 media_type text NOT NULL CHECK(media_type IN('application/pdf','image/jpeg','image/png','image/heic')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 26214400),
 dispatch_id uuid NOT NULL UNIQUE,
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 reserved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(reserved_at)),
 UNIQUE(business_id,id,bill_id,bill_revision),
 FOREIGN KEY(business_id,bill_id,bill_revision) REFERENCES crest.supplier_bill_draft_revisions(business_id,bill_id,revision),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK(char_length(document_reference)>=1 AND char_length(document_reference)<=200 AND document_reference=btrim(document_reference)
  AND document_reference!~'[[:cntrl:]]')
);
ALTER TABLE crest.supplier_bill_original_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_bill_original_intents FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.supplier_bill_original_intents TO crest_finance_account_owner;
CREATE POLICY supplier_bill_original_intent_scope ON crest.supplier_bill_original_intents FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE TRIGGER supplier_bill_original_intent_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.supplier_bill_original_intents
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

ALTER TABLE crest.supplier_bill_originals DROP CONSTRAINT supplier_bill_original_object_key;
ALTER TABLE crest.supplier_bill_originals
 ADD COLUMN candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate)='object' AND octet_length(candidate::text)<=8192),
 ADD COLUMN operation_id uuid NOT NULL,
 ADD COLUMN created_by uuid NOT NULL,
 ADD CONSTRAINT supplier_bill_original_key CHECK(object_key='originals/'||business_id::text||'/'||id::text),
 ADD CONSTRAINT supplier_bill_original_reserved FOREIGN KEY(business_id,id,bill_id,bill_revision)
  REFERENCES crest.supplier_bill_original_intents(business_id,id,bill_id,bill_revision),
 ADD CONSTRAINT supplier_bill_original_publish_operation FOREIGN KEY(business_id,operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id);
GRANT INSERT ON crest.supplier_bill_originals TO crest_finance_account_owner;

CREATE FUNCTION crest_private.supplier_bill_original_reservation(i crest.supplier_bill_original_intents)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $reservation$
 SELECT jsonb_build_object('businessId',i.business_id,'originalId',i.id,'billId',i.bill_id,'billRevision',i.bill_revision::text,
  'recoveryEpoch',i.recovery_epoch,'declaredType',i.media_type,'byteSize',i.byte_size,'dispatchId',i.dispatch_id,
  'stagingKey','staging/'||i.business_id::text||'/'||i.id::text||'/'||i.dispatch_id::text,
  'originalKey','originals/'||i.business_id::text||'/'||i.id::text,'previewKey','previews/'||i.business_id::text||'/'||i.id::text);
$reservation$;
REVOKE ALL ON FUNCTION crest_private.supplier_bill_original_reservation(crest.supplier_bill_original_intents) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.supplier_bill_original_reservation(crest.supplier_bill_original_intents) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_receipt_reservation(jsonb),crest_private.valid_receipt_candidate(jsonb,jsonb)
 TO crest_finance_account_owner;

CREATE POLICY supplier_bill_document_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY supplier_bill_document_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY supplier_bill_document_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY supplier_bill_document_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK((entity_kind,action) IN(('supplier_bill_original_intents','reserve'),('supplier_bill_originals','publish'))
  AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY supplier_bill_original_intent_append ON crest.supplier_bill_original_intents FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=supplier_bill_original_intents.business_id
    AND o.operation_id=supplier_bill_original_intents.operation_id AND o.actor_id=supplier_bill_original_intents.created_by
    AND o.command_type='bookkeeping.supplier_bill.original.reserve' AND o.state='pending' AND o.recovery_epoch=supplier_bill_original_intents.recovery_epoch));
CREATE POLICY supplier_bill_original_append ON crest.supplier_bill_originals FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND EXISTS(SELECT FROM crest_private.operations o
   WHERE o.business_id=supplier_bill_originals.business_id
    AND o.operation_id=supplier_bill_originals.operation_id AND o.actor_id=supplier_bill_originals.created_by
    AND o.command_type='bookkeeping.supplier_bill.original.publish' AND o.state='pending'));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.change_fictional_supplier_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_original uuid,requested_bill uuid,requested_revision bigint,
 declared_type text,declared_bytes integer,verified_candidate jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $change$
DECLARE publishing boolean:=verified_candidate IS NOT NULL; command text; entity text; digest text; claimed uuid; prior record;
 draft crest.supplier_bill_draft_revisions; intent crest.supplier_bill_original_intents;
 reservation jsonb; validator_scope jsonb; expected_state jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_original IS NULL OR requested_bill IS NULL
  OR requested_revision IS NULL OR requested_revision<1
  OR (NOT publishing AND (declared_type IS NULL OR declared_type NOT IN('application/pdf','image/jpeg','image/png','image/heic')
    OR declared_bytes IS NULL OR declared_bytes NOT BETWEEN 1 AND 26214400))
  OR (publishing AND (declared_type IS NOT NULL OR declared_bytes IS NOT NULL OR jsonb_typeof(verified_candidate)<>'object'
    OR octet_length(verified_candidate::text)>8192))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_ORIGINAL_INPUT_REQUIRED'; END IF;
 IF publishing THEN
  command:='bookkeeping.supplier_bill.original.publish';entity:='supplier_bill_originals';
 ELSE
  command:='bookkeeping.supplier_bill.original.reserve';entity:='supplier_bill_original_intents';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||requested_bill::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 digest:=encode(sha256(convert_to(jsonb_build_array(command,1,requested_business,expected_actor,expected_epoch,
  requested_original,requested_bill,requested_revision,declared_type,declared_bytes,verified_candidate)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,command,1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.result INTO prior FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
   AND o.command_type=command AND o.recovery_epoch=expected_epoch AND o.state='committed';
  IF NOT FOUND OR prior.payload_hash IS DISTINCT FROM digest
  THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  RETURN jsonb_build_object('state','committed','receipt',prior.result);
 END IF;

 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d
 WHERE (d.business_id,d.bill_id)=(requested_business,requested_bill) ORDER BY d.revision DESC LIMIT 1;
 IF draft.revision IS DISTINCT FROM requested_revision OR draft.payload->>'documentReference' IS NULL
  OR EXISTS(SELECT FROM crest.supplier_payables p WHERE (p.business_id,p.bill_id)=(requested_business,requested_bill))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_CURRENT_DOCUMENT_REQUIRED'; END IF;

 IF NOT publishing THEN
  INSERT INTO crest.supplier_bill_original_intents(id,business_id,bill_id,bill_revision,document_reference,recovery_epoch,
   media_type,byte_size,dispatch_id,operation_id,created_by)
  VALUES(requested_original,requested_business,requested_bill,requested_revision,draft.payload->>'documentReference',expected_epoch,
   declared_type,declared_bytes,gen_random_uuid(),requested_operation,expected_actor) RETURNING * INTO intent;
  reservation:=crest_private.supplier_bill_original_reservation(intent);
  expected_state:=jsonb_build_object('schemaVersion',1,'reservation',reservation);
 ELSE
  SELECT * INTO intent FROM crest.supplier_bill_original_intents i
  WHERE (i.business_id,i.id,i.bill_id,i.bill_revision,i.recovery_epoch,i.created_by)=
   (requested_business,requested_original,requested_bill,requested_revision,expected_epoch,expected_actor);
  IF NOT FOUND OR intent.document_reference IS DISTINCT FROM draft.payload->>'documentReference'
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_RESERVATION_REQUIRED'; END IF;
  reservation:=crest_private.supplier_bill_original_reservation(intent);
  -- Use the existing strict private document validator with the same key and media fields.
  validator_scope:=(reservation-ARRAY['originalId','billId','billRevision'])||jsonb_build_object(
   'receiptId',intent.id,'expenseId',intent.bill_id,'expenseRevision',intent.bill_revision::text);
  IF crest_private.valid_receipt_candidate(verified_candidate,validator_scope) IS DISTINCT FROM true
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_VERIFIED_BYTES_REQUIRED'; END IF;
  IF EXISTS(SELECT FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(requested_business,requested_original))
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='SUPPLIER_ORIGINAL_ALREADY_RECORDED'; END IF;
  INSERT INTO crest.supplier_bill_originals(id,business_id,bill_id,bill_revision,document_reference,file_sha256,byte_size,
   media_type,object_key,candidate,operation_id,created_by)
  VALUES(intent.id,intent.business_id,intent.bill_id,intent.bill_revision,intent.document_reference,verified_candidate#>>'{source,sha256}',
   intent.byte_size,intent.media_type,reservation->>'originalKey',verified_candidate,requested_operation,expected_actor);
  expected_state:=jsonb_build_object('schemaVersion',1,'originalId',intent.id,'billId',intent.bill_id,
   'billRevision',intent.bill_revision::text,'sha256',verified_candidate#>>'{source,sha256}');
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,entity,requested_original,1,
  CASE WHEN publishing THEN 'publish' ELSE 'reserve' END,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected_state),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=expected_state
  WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',expected_state);
END $change$;

CREATE FUNCTION crest_commands.reserve_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
 SELECT crest_commands.change_fictional_supplier_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL);
$reserve$;
CREATE FUNCTION crest_commands.publish_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,jsonb
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $publish$
 SELECT crest_commands.change_fictional_supplier_original($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NULL,NULL,$14);
$publish$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.change_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer,jsonb),
 crest_commands.reserve_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer),
 crest_commands.publish_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer) TO crest_finance_preview;
GRANT EXECUTE ON FUNCTION crest_commands.publish_fictional_supplier_original(
 bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,jsonb) TO crest_supplier_bill_document_worker;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.supplier_bill_original_intents TO crest_finance_integrity_owner;
GRANT SELECT(payload_hash) ON crest_private.operations TO crest_finance_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.supplier_bill_original_reservation(crest.supplier_bill_original_intents),
 crest_private.valid_receipt_reservation(jsonb),crest_private.valid_receipt_candidate(jsonb,jsonb) TO crest_finance_integrity_owner;
CREATE POLICY supplier_bill_original_intent_integrity ON crest.supplier_bill_original_intents FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY supplier_bill_document_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type IN('bookkeeping.supplier_bill.original.reserve','bookkeeping.supplier_bill.original.publish'));
CREATE POLICY supplier_bill_document_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind IN('supplier_bill_original_intents','supplier_bill_originals'));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_supplier_original_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE publishing boolean:=TG_TABLE_NAME='supplier_bill_originals'; intent crest.supplier_bill_original_intents;
 original crest.supplier_bill_originals; reservation jsonb; validator_scope jsonb; expected jsonb; digest text;
 command text; expected_action text;
BEGIN
 SELECT * INTO STRICT intent FROM crest.supplier_bill_original_intents i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.id);
 IF NOT EXISTS(SELECT FROM crest.supplier_bill_draft_revisions draft
  WHERE (draft.business_id,draft.bill_id,draft.revision)=(intent.business_id,intent.bill_id,intent.bill_revision)
   AND (draft.payload->>'documentReference')=intent.document_reference)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_HISTORY_REQUIRED'; END IF;
 reservation:=crest_private.supplier_bill_original_reservation(intent);
 IF publishing THEN
  SELECT * INTO STRICT original FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(NEW.business_id,NEW.id);
  validator_scope:=(reservation-ARRAY['originalId','billId','billRevision'])||jsonb_build_object(
   'receiptId',intent.id,'expenseId',intent.bill_id,'expenseRevision',intent.bill_revision::text);
  IF (original.created_by,original.document_reference,original.media_type,original.byte_size,original.object_key,original.file_sha256)
   IS DISTINCT FROM (intent.created_by,intent.document_reference,intent.media_type,intent.byte_size::bigint,reservation->>'originalKey',
    original.candidate#>>'{source,sha256}') OR crest_private.valid_receipt_candidate(original.candidate,validator_scope) IS DISTINCT FROM true
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_HISTORY_REQUIRED'; END IF;
  command:='bookkeeping.supplier_bill.original.publish'; expected_action:='publish';
  expected:=jsonb_build_object('schemaVersion',1,'originalId',intent.id,'billId',intent.bill_id,'billRevision',intent.bill_revision::text,
   'sha256',original.file_sha256);
 ELSE
  command:='bookkeeping.supplier_bill.original.reserve'; expected_action:='reserve';
  expected:=jsonb_build_object('schemaVersion',1,'reservation',reservation);
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(command,1,intent.business_id,intent.created_by,intent.recovery_epoch,
  intent.id,intent.bill_id,intent.bill_revision,CASE WHEN NOT publishing THEN intent.media_type END,
  CASE WHEN NOT publishing THEN intent.byte_size END,original.candidate)::text,'UTF8')),'hex');
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by)
   AND o.command_type=command AND o.payload_hash=digest AND o.recovery_epoch=intent.recovery_epoch AND o.state='committed'
   AND o.result=expected AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=NEW.id AND a.entity_version=1
   AND a.action=expected_action AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_HISTORY_REQUIRED'; END IF;
 RETURN NULL;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_original_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_original_history() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER supplier_original_intent_history AFTER INSERT ON crest.supplier_bill_original_intents
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_original_history();
CREATE CONSTRAINT TRIGGER supplier_original_publish_history AFTER INSERT ON crest.supplier_bill_originals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_original_history();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.read_fictional_supplier_original(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_original uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE intent crest.supplier_bill_original_intents; candidate jsonb;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO intent FROM crest.supplier_bill_original_intents i WHERE (i.business_id,i.id)=(requested_business,requested_original);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT o.candidate INTO candidate FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(requested_business,requested_original);
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.supplier_bill_original_reservation(intent),
  'candidate',candidate);
END $read$;

CREATE FUNCTION crest_commands.authorize_fictional_supplier_original_write(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_original uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE intent crest.supplier_bill_original_intents; draft crest.supplier_bill_draft_revisions;
BEGIN
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO intent FROM crest.supplier_bill_original_intents i
 WHERE (i.business_id,i.id,i.recovery_epoch,i.created_by)=(requested_business,requested_original,expected_epoch,expected_actor);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_RESERVATION_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||intent.bill_id::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO draft FROM crest.supplier_bill_draft_revisions d WHERE (d.business_id,d.bill_id)=(intent.business_id,intent.bill_id)
 ORDER BY d.revision DESC LIMIT 1;
 IF draft.revision IS DISTINCT FROM intent.bill_revision OR draft.payload->>'documentReference' IS DISTINCT FROM intent.document_reference
  OR EXISTS(SELECT FROM crest.supplier_payables p WHERE (p.business_id,p.bill_id)=(intent.business_id,intent.bill_id))
  OR EXISTS(SELECT FROM crest.supplier_bill_originals o WHERE (o.business_id,o.id)=(intent.business_id,intent.id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_ORIGINAL_CURRENT_DOCUMENT_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.supplier_bill_original_reservation(intent));
END $check$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.read_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.authorize_fictional_supplier_original_write(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_supplier_original(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.authorize_fictional_supplier_original_write(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_finance_preview,crest_supplier_bill_document_worker;
