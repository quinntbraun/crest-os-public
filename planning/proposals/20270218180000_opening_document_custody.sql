-- Held opening-document custody. No bill, expense, ledger or opening approval.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.opening_document_intents (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,reference text NOT NULL,
 expected_sha256 text NOT NULL CHECK(expected_sha256~'^[a-f0-9]{64}$'),
 recovery_epoch uuid NOT NULL,media_type text NOT NULL CHECK(media_type IN('application/pdf','image/jpeg','image/png','image/heic')),
 byte_size integer NOT NULL CHECK(byte_size>=1 AND byte_size<=26214400),dispatch_id uuid NOT NULL UNIQUE,
 operation_id uuid NOT NULL,audit_event_id uuid NOT NULL,created_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,operation_id),UNIQUE(business_id,audit_event_id),
 CHECK(length(reference)>=1 AND length(reference)<=200 AND reference=btrim(reference) AND reference!~'[[:cntrl:]]'),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE crest.opening_document_originals (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,candidate jsonb NOT NULL,
 operation_id uuid NOT NULL,audit_event_id uuid NOT NULL,created_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,operation_id),UNIQUE(business_id,audit_event_id),
 CHECK(jsonb_typeof(candidate)='object' AND octet_length(candidate::text)<=8192),
 FOREIGN KEY(business_id,id) REFERENCES crest.opening_document_intents(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE crest.opening_document_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_document_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_document_originals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_document_originals FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.opening_document_intents,crest.opening_document_originals TO crest_finance_account_owner;
-- The command pins a server-generated audit ID before inserting either retained
-- row. Existing audit grants omit explicit IDs and these closure-check columns.
GRANT INSERT(id) ON crest_private.audit_events TO crest_finance_account_owner;
GRANT SELECT(created_by,origin,import_row_id) ON crest_private.audit_events TO crest_finance_account_owner;
CREATE POLICY opening_document_scope ON crest.opening_document_intents FOR SELECT TO crest_finance_account_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_document_scope ON crest.opening_document_originals FOR SELECT TO crest_finance_account_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_document_append ON crest.opening_document_intents FOR INSERT TO crest_finance_account_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_document_append ON crest.opening_document_originals FOR INSERT TO crest_finance_account_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE TRIGGER opening_document_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_document_intents FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER opening_document_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_document_originals FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE POLICY opening_document_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner USING(command_type IN('finance.opening_document.reserve','finance.opening_document.publish') AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY opening_document_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner WITH CHECK(command_type IN('finance.opening_document.reserve','finance.opening_document.publish') AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_document_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner USING(command_type IN('finance.opening_document.reserve','finance.opening_document.publish') AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='pending') WITH CHECK(command_type IN('finance.opening_document.reserve','finance.opening_document.publish') AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='committed');
CREATE POLICY opening_document_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner WITH CHECK(entity_kind IN('opening_document_intents','opening_document_originals') AND action IN('reserve','publish') AND entity_version=1 AND origin='manual' AND import_row_id IS NULL AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_document_audit_read ON crest_private.audit_events FOR SELECT TO crest_finance_account_owner USING(entity_kind IN('opening_document_intents','opening_document_originals') AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_private.opening_document_reservation(i crest.opening_document_intents)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $body$
 SELECT jsonb_build_object('businessId',i.business_id,'documentId',i.id,'reference',i.reference,'sha256',i.expected_sha256,'recoveryEpoch',i.recovery_epoch,'declaredType',i.media_type,'byteSize',i.byte_size,'dispatchId',i.dispatch_id,'stagingKey','staging/'||i.business_id::text||'/'||i.id::text||'/'||i.dispatch_id::text,'originalKey','originals/'||i.business_id::text||'/'||i.id::text,'previewKey','previews/'||i.business_id::text||'/'||i.id::text);
$body$;
CREATE FUNCTION crest_private.opening_document_receipt_scope(i crest.opening_document_intents)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $body$
 SELECT (crest_private.opening_document_reservation(i)-ARRAY['documentId','reference','sha256'])||jsonb_build_object('receiptId',i.id,'expenseId',i.id,'expenseRevision','1');
$body$;
CREATE FUNCTION crest_private.exclusive_supplier_document_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier document original '||NEW.business_id::text||NEW.id::text,0));
 IF (TG_TABLE_NAME='opening_document_intents' AND EXISTS(SELECT FROM crest.supplier_bill_original_intents i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.id)))
 OR (TG_TABLE_NAME='supplier_bill_original_intents' AND EXISTS(SELECT FROM crest.opening_document_intents i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.id)))
 THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='DOCUMENT_STORAGE_ID_ALREADY_RESERVED'; END IF;
 RETURN NEW;
END $body$;

CREATE FUNCTION crest_commands.change_fictional_opening_document(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_document uuid,requested_reference text,requested_sha256 text,declared_type text,declared_bytes integer,verified_candidate jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE publishing boolean:=verified_candidate IS NOT NULL;command text;entity text;digest text;claimed uuid;prior record;intent crest.opening_document_intents;expected_result jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF requested_document IS NULL OR requested_operation IS NULL OR expected_epoch IS NULL
 OR (NOT publishing AND (requested_reference IS NULL OR length(requested_reference)<1 OR length(requested_reference)>200 OR requested_reference<>btrim(requested_reference) OR requested_reference~'[[:cntrl:]]' OR requested_sha256 IS NULL OR requested_sha256!~'^[a-f0-9]{64}$' OR declared_type IS NULL OR declared_type NOT IN('application/pdf','image/jpeg','image/png','image/heic') OR declared_bytes IS NULL OR declared_bytes<1 OR declared_bytes>26214400))
 OR (publishing AND (requested_reference IS NOT NULL OR requested_sha256 IS NOT NULL OR declared_type IS NOT NULL OR declared_bytes IS NOT NULL OR jsonb_typeof(verified_candidate)<>'object' OR octet_length(verified_candidate::text)>8192))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_DOCUMENT_INPUT_REQUIRED'; END IF;
 command:=CASE WHEN publishing THEN 'finance.opening_document.publish' ELSE 'finance.opening_document.reserve' END;
 entity:=CASE WHEN publishing THEN 'opening_document_originals' ELSE 'opening_document_intents' END;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',requested_operation::text,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier document original '||requested_business::text||requested_document::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 digest:=encode(sha256(convert_to(jsonb_build_array(command,1,requested_business,expected_actor,expected_epoch,requested_document,requested_reference,requested_sha256,declared_type,declared_bytes,verified_candidate)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,command,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT o.payload_hash,o.result INTO prior FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor) AND o.command_type=command AND o.recovery_epoch=expected_epoch AND o.state='committed';
  IF NOT FOUND OR prior.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  RETURN jsonb_build_object('state','committed','receipt',prior.result);
 END IF;
 IF NOT publishing THEN
  INSERT INTO crest.opening_document_intents(id,business_id,reference,expected_sha256,recovery_epoch,media_type,byte_size,dispatch_id,operation_id,audit_event_id,created_by) VALUES(requested_document,requested_business,requested_reference,requested_sha256,expected_epoch,declared_type,declared_bytes,gen_random_uuid(),requested_operation,audit_id,expected_actor) RETURNING * INTO intent;
  expected_result:=jsonb_build_object('schemaVersion',1,'reservation',crest_private.opening_document_reservation(intent));
 ELSE
  SELECT * INTO intent FROM crest.opening_document_intents i WHERE (i.business_id,i.id,i.recovery_epoch,i.created_by)=(requested_business,requested_document,expected_epoch,expected_actor);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_DOCUMENT_RESERVATION_REQUIRED'; END IF;
  IF crest_private.valid_receipt_candidate(verified_candidate,crest_private.opening_document_receipt_scope(intent)) IS DISTINCT FROM true OR verified_candidate#>>'{source,sha256}' IS DISTINCT FROM intent.expected_sha256
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_DOCUMENT_VERIFIED_BYTES_REQUIRED'; END IF;
  INSERT INTO crest.opening_document_originals(id,business_id,candidate,operation_id,audit_event_id,created_by) VALUES(intent.id,requested_business,verified_candidate,requested_operation,audit_id,expected_actor);
  expected_result:=jsonb_build_object('schemaVersion',1,'documentId',intent.id,'reference',intent.reference,'sha256',intent.expected_sha256);
 END IF;
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(audit_id,requested_business,requested_operation,expected_actor,expected_actor,entity,requested_document,1,CASE WHEN publishing THEN 'publish' ELSE 'reserve' END,jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected_result),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=expected_result WHERE business_id=requested_business AND operation_id=requested_operation;
 RETURN jsonb_build_object('state','committed','receipt',expected_result);
END $body$;

CREATE FUNCTION crest_commands.reserve_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,text,integer)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
 SELECT crest_commands.change_fictional_opening_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL);
$body$;
CREATE FUNCTION crest_commands.publish_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
 SELECT crest_commands.change_fictional_opening_document($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,NULL,NULL,$12);
$body$;
CREATE FUNCTION crest_commands.read_fictional_opening_document(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_document uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE intent crest.opening_document_intents;original crest.opening_document_originals;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO intent FROM crest.opening_document_intents i WHERE (i.business_id,i.id)=(requested_business,requested_document);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='OPENING_DOCUMENT_NOT_FOUND'; END IF;
 SELECT * INTO original FROM crest.opening_document_originals o WHERE (o.business_id,o.id)=(requested_business,requested_document);
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.opening_document_reservation(intent),'candidate',original.candidate);
END $body$;
CREATE FUNCTION crest_commands.authorize_fictional_opening_document_write(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_document uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE intent crest.opening_document_intents;
BEGIN
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);PERFORM set_config('crest.business_id',requested_business::text,true);
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier document original '||requested_business::text||requested_document::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO intent FROM crest.opening_document_intents i WHERE (i.business_id,i.id,i.recovery_epoch,i.created_by)=(requested_business,requested_document,expected_epoch,expected_actor);
 IF NOT FOUND OR EXISTS(SELECT FROM crest.opening_document_originals o WHERE (o.business_id,o.id)=(requested_business,requested_document)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_DOCUMENT_WRITE_REQUIRED'; END IF;
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.opening_document_reservation(intent));
END $body$;
CREATE FUNCTION crest_private.check_opening_document_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE intent crest.opening_document_intents;publishing boolean:=TG_TABLE_NAME='opening_document_originals';expected_result jsonb;command text;digest text;candidate jsonb;
BEGIN
 SELECT * INTO STRICT intent FROM crest.opening_document_intents i WHERE (i.business_id,i.id)=(NEW.business_id,NEW.id);
 command:=CASE WHEN publishing THEN 'finance.opening_document.publish' ELSE 'finance.opening_document.reserve' END;
 IF publishing THEN
  candidate:=to_jsonb(NEW)->'candidate';
  IF crest_private.valid_receipt_candidate(candidate,crest_private.opening_document_receipt_scope(intent)) IS DISTINCT FROM true OR candidate#>>'{source,sha256}' IS DISTINCT FROM intent.expected_sha256 OR NEW.created_by<>intent.created_by
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_DOCUMENT_VERIFIED_BYTES_REQUIRED'; END IF;
  expected_result:=jsonb_build_object('schemaVersion',1,'documentId',intent.id,'reference',intent.reference,'sha256',intent.expected_sha256);
 ELSE
  expected_result:=jsonb_build_object('schemaVersion',1,'reservation',crest_private.opening_document_reservation(intent));
 END IF;
 digest:=encode(sha256(convert_to(jsonb_build_array(command,1,NEW.business_id,NEW.created_by,intent.recovery_epoch,NEW.id,CASE WHEN NOT publishing THEN intent.reference END,CASE WHEN NOT publishing THEN intent.expected_sha256 END,CASE WHEN NOT publishing THEN intent.media_type END,CASE WHEN NOT publishing THEN intent.byte_size END,candidate)::text,'UTF8')),'hex');
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by) AND o.created_by=NEW.created_by AND o.command_type=command AND o.schema_version=1 AND o.state='committed' AND o.result_schema_version=1 AND o.result=expected_result AND o.payload_hash=digest AND o.recovery_epoch=intent.recovery_epoch AND o.origin='manual' AND o.import_row_id IS NULL
   AND a.id=NEW.audit_event_id AND a.created_by=NEW.created_by AND a.entity_id=NEW.id AND a.entity_version=1 AND a.entity_kind=TG_TABLE_NAME AND a.action=CASE WHEN publishing THEN 'publish' ELSE 'reserve' END AND a.origin='manual' AND a.import_row_id IS NULL AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected_result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_DOCUMENT_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $body$;
RESET ROLE;
REVOKE ALL ON FUNCTION crest_private.opening_document_reservation(crest.opening_document_intents),crest_private.opening_document_receipt_scope(crest.opening_document_intents),crest_private.exclusive_supplier_document_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION crest_commands.change_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,text,integer,jsonb),crest_commands.reserve_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,text,integer),crest_commands.publish_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb),crest_commands.read_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.authorize_fictional_opening_document_write(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,text,integer) TO crest_finance_preview;
GRANT EXECUTE ON FUNCTION crest_commands.publish_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) TO crest_supplier_bill_document_worker;
GRANT EXECUTE ON FUNCTION crest_commands.read_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.authorize_fictional_opening_document_write(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_finance_preview,crest_supplier_bill_document_worker;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_document_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.exclusive_supplier_document_id(),crest_private.check_opening_document_history() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER opening_document_exclusive_id BEFORE INSERT ON crest.opening_document_intents FOR EACH ROW EXECUTE FUNCTION crest_private.exclusive_supplier_document_id();
CREATE TRIGGER opening_document_exclusive_id BEFORE INSERT ON crest.supplier_bill_original_intents FOR EACH ROW EXECUTE FUNCTION crest_private.exclusive_supplier_document_id();
CREATE CONSTRAINT TRIGGER opening_document_audited AFTER INSERT ON crest.opening_document_intents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_document_history();
CREATE CONSTRAINT TRIGGER opening_document_audited AFTER INSERT ON crest.opening_document_originals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_document_history();
RESET ROLE;
REVOKE EXECUTE ON FUNCTION crest_private.exclusive_supplier_document_id(),crest_private.check_opening_document_history() FROM crest_schema_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE INDEX opening_document_reference_lookup ON crest.opening_document_intents(business_id,reference,expected_sha256);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.find_fictional_opening_document(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_reference text,requested_sha256 text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $body$
DECLARE intent crest.opening_document_intents;original crest.opening_document_originals;
BEGIN
 IF requested_reference IS NULL OR length(requested_reference)<1 OR length(requested_reference)>200 OR requested_reference<>btrim(requested_reference) OR requested_reference~'[[:cntrl:]]' OR requested_sha256 IS NULL OR requested_sha256!~'^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_DOCUMENT_INPUT_REQUIRED'; END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT i.* INTO intent FROM crest.opening_document_intents i JOIN crest.opening_document_originals o ON (o.business_id,o.id)=(i.business_id,i.id)
 WHERE i.business_id=requested_business AND i.reference=requested_reference AND i.expected_sha256=requested_sha256 ORDER BY o.recorded_at DESC,o.id LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT * INTO STRICT original FROM crest.opening_document_originals o WHERE (o.business_id,o.id)=(requested_business,intent.id);
 RETURN jsonb_build_object('state','ready','schemaVersion',1,'reservation',crest_private.opening_document_reservation(intent),'candidate',original.candidate);
END $body$;
RESET ROLE;
REVOKE ALL ON FUNCTION crest_commands.find_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.find_fictional_opening_document(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,text) TO crest_finance_preview;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
