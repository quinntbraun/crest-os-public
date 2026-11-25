-- Candidate142 private opening originals and versioned exports; no posting or production activation.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270218180000_opening_document_custody.sql
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

RESET ROLE;
-- END REVIEWED planning/proposals/20270218180000_opening_document_custody.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270218181000_opening_document_recovery_read.sql
-- HELD: metadata reads for the existing closed, non-login backup reader.
-- No write, function execution, membership or runtime activation is granted.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_document_intents,crest.opening_document_originals TO crest_backup_reader;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/20270218181000_opening_document_recovery_read.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270218182000_opening_document_workspace_source.sql
-- HELD142 workspace source reader: retained opening-document evidence.
-- No new financial posting, refund, provider or runtime activation authority.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.business_source_dictionary_v4()
RETURNS TABLE(source_name text,fields text[],business_column text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $dictionary$
 SELECT * FROM crest_private.business_source_dictionary_v3()
 UNION ALL SELECT * FROM (VALUES
 ('crest.opening_document_intents',ARRAY['id','business_id','reference','expected_sha256','recovery_epoch','media_type','byte_size','dispatch_id','operation_id','audit_event_id','created_by','recorded_at'],'business_id'),
 ('crest.opening_document_originals',ARRAY['id','business_id','candidate','operation_id','audit_event_id','created_by','recorded_at'],'business_id')) AS added(source_name,fields,business_column);
$dictionary$;
REVOKE ALL ON FUNCTION crest_private.business_source_dictionary_v4() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.business_source_dictionary_v4() TO crest_business_source_owner;
DO $grant$
DECLARE d record; source_oid oid; projection text;
BEGIN
 FOR d IN SELECT * FROM crest_private.business_source_dictionary_v4() WHERE source_name IN('crest.opening_document_intents','crest.opening_document_originals') LOOP
  source_oid:=to_regclass(d.source_name);
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=source_oid AND relkind='r'
   AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
   OR NOT EXISTS(SELECT FROM pg_index i WHERE i.indrelid=source_oid AND i.indisprimary
    AND NOT EXISTS(SELECT FROM unnest(i.indkey) k JOIN pg_attribute a ON a.attrelid=source_oid AND a.attnum=k WHERE NOT a.attname=ANY(d.fields)))
  THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_SOURCE_SCHEMA_REQUIRED'; END IF;
  SELECT string_agg(format('%I',field),',') INTO projection FROM unnest(d.fields) field;
  EXECUTE format('GRANT SELECT(%s) ON %s TO crest_business_source_owner',projection,source_oid::regclass);
  EXECUTE format('CREATE POLICY current_business_source_scope ON %s FOR SELECT TO crest_business_source_owner USING(%I=nullif(current_setting(''crest.business_source_business'',true),'''')::uuid)',source_oid::regclass,d.business_column);
 END LOOP;
END $grant$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_business_source_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.business_source_page_v4(requested_business uuid,requested_source text,expected_snapshot text,after_key text[],page_size integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' SET bytea_output='hex' SET extra_float_digits=3 AS $source$
DECLARE d record; source_oid oid; pk text[]; projection text; key_sql text; keys jsonb; data jsonb; snapshot_value text; token text; next_cursor jsonb; types jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF page_size IS NULL OR page_size<1 OR page_size>100 OR requested_business IS NULL
  OR (after_key IS NOT NULL AND (expected_snapshot IS NULL OR cardinality(after_key)<1 OR cardinality(after_key)>16 OR array_position(after_key,NULL) IS NOT NULL))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT * INTO d FROM crest_private.business_source_dictionary_v4() WHERE source_name=requested_source;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 PERFORM crest_commands.business_configuration_export_context(requested_business);
 PERFORM set_config('crest.business_source_business',requested_business::text,true);
 snapshot_value:=pg_current_snapshot()::text;
 IF octet_length(snapshot_value)>16384 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 token:=encode(sha256(convert_to(jsonb_build_array('crest.business.rows/2',requested_business,pg_backend_pid(),transaction_timestamp(),snapshot_value)::text,'UTF8')),'hex');
 IF expected_snapshot IS NOT NULL AND expected_snapshot<>token THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_SNAPSHOT_CHANGED'; END IF;
 source_oid:=to_regclass(d.source_name);
 SELECT array_agg(a.attname::text ORDER BY k.position) INTO pk FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(number,position)
  JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.number WHERE i.indrelid=source_oid AND i.indisprimary;
 IF pk IS NULL OR cardinality(pk)>16 OR after_key IS NOT NULL AND cardinality(after_key)<>cardinality(pk)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BUSINESS_SOURCE_REQUEST_REQUIRED'; END IF;
 SELECT string_agg(format('%L,%s',field,CASE WHEN a.atttypid='timestamptz'::regtype
  THEN format('to_char(t.%I AT TIME ZONE ''UTC'',''YYYY-MM-DD"T"HH24:MI:SS.US"Z"'')',field)
  ELSE format('t.%I::text',field) END),',' ORDER BY position),
  jsonb_object_agg(field,format_type(a.atttypid,a.atttypmod)) INTO projection,types
  FROM unnest(d.fields) WITH ORDINALITY f(field,position) JOIN pg_attribute a ON a.attrelid=source_oid AND a.attname=field;
 SELECT 'ARRAY['||string_agg(format('t.%I::text',field),',' ORDER BY position)||']::text[]' INTO key_sql FROM unnest(pk) WITH ORDINALITY f(field,position);
 EXECUTE format('SELECT coalesce(jsonb_agg(value ORDER BY key COLLATE "C"),''[]''::jsonb),coalesce(jsonb_agg(to_jsonb(key) ORDER BY key COLLATE "C"),''[]''::jsonb) FROM (SELECT %s AS key,jsonb_build_object(%s) AS value FROM %s t WHERE t.%I=$1 AND ($2::text[] IS NULL OR (%s COLLATE "C")>($2::text[] COLLATE "C")) ORDER BY %s COLLATE "C" LIMIT $3) bounded',key_sql,projection,source_oid::regclass,d.business_column,key_sql,key_sql)
  INTO data,keys USING requested_business,after_key,page_size+1;
 IF jsonb_array_length(data)>page_size THEN data:=data-page_size;next_cursor:=keys->(page_size-1); END IF;
 IF octet_length(data::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='BUSINESS_SOURCE_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'source',requested_source,'snapshotToken',token,
  'observedAt',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'columns',d.fields,'types',types,'primaryKey',pk,'rows',data,'nextCursor',next_cursor);
END $source$;
RESET ROLE;
ALTER FUNCTION crest_commands.business_source_page_v4(uuid,text,text,text[],integer) OWNER TO crest_business_source_owner;
REVOKE ALL ON FUNCTION crest_commands.business_source_page_v4(uuid,text,text,text[],integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.business_source_page_v4(uuid,text,text,text[],integer) TO crest_export;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_business_source_owner;


RESET ROLE;
-- END REVIEWED planning/proposals/20270218182000_opening_document_workspace_source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270218183000_opening_document_export_original.sql
-- HELD142: exact opening-original metadata for the frozen export membership check.
-- Existing jobs continue to use the original function and cannot acquire new files.
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_business_source_owner;
SET LOCAL ROLE crest_business_source_owner;
CREATE FUNCTION crest_private.current_source_export_original_v2(business uuid,kind text,attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' AS $original$
DECLARE i crest.opening_document_intents;o crest.opening_document_originals;extension text;
BEGIN
 IF business IS NULL OR attachment IS NULL OR kind IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 IF kind<>'supplier_document' THEN RETURN crest_private.current_source_export_original(business,kind,attachment);END IF;
 PERFORM set_config('crest.business_source_business',business::text,true);
 SELECT * INTO i FROM crest.opening_document_intents WHERE business_id=business AND id=attachment;
 IF NOT FOUND THEN RETURN crest_private.current_source_export_original(business,kind,attachment);END IF;
 SELECT * INTO o FROM crest.opening_document_originals WHERE business_id=business AND id=attachment;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_FILE_UNAVAILABLE';END IF;
 IF o.candidate#>>'{source,sha256}' IS DISTINCT FROM i.expected_sha256
 OR o.candidate#>>'{original,sha256}' IS DISTINCT FROM i.expected_sha256
 OR o.candidate#>>'{source,detectedType}' IS DISTINCT FROM i.media_type
 OR o.candidate#>>'{source,byteSize}' IS DISTINCT FROM i.byte_size::text
 OR o.candidate#>>'{original,byteSize}' IS DISTINCT FROM i.byte_size::text
 OR o.candidate#>>'{original,key}' IS DISTINCT FROM 'originals/'||business::text||'/'||attachment::text
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ORIGINAL_FILE_REVIEW_REQUIRED';END IF;
 extension:=CASE i.media_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/heic' THEN 'heic' WHEN 'application/pdf' THEN 'pdf' END;
 IF extension IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_ORIGINAL_FILE_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('file',jsonb_build_object('kind',kind,'attachmentId',attachment,'objectId',attachment,
  'path','attachments/'||attachment::text||'/'||attachment::text||'.'||extension,'mediaType',i.media_type,'byteSize',i.byte_size,
  'sha256',i.expected_sha256,'recordedAt',to_char(o.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  'object',jsonb_build_object('domain','supplier_document','key','originals/'||business::text||'/'||attachment::text));
END $original$;
REVOKE ALL ON FUNCTION crest_private.current_source_export_original_v2(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.current_source_export_original_v2(uuid,text,uuid) TO crest_command_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_business_source_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/20270218183000_opening_document_export_original.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/20270218184000_opening_document_workspace_jobs.sql
-- Versioned workspace export jobs142; old request writers and receipts retained.
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.export_jobs DROP CONSTRAINT export_jobs_profile_schema_check;
ALTER TABLE crest_private.export_jobs ADD CONSTRAINT export_jobs_profile_schema_check CHECK((profile='crest.business-source-journal-bundle.v1' AND source_schema_version=43) OR(profile='crest.current-business-source-bundle.v1' AND source_schema_version IN(134,135,136,137,138,140,141,142)));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_source_schema_version_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_source_schema_version_check CHECK(source_schema_version IN(43,134,135,136,137,138,140,141,142));
ALTER TABLE crest_private.export_job_snapshots DROP CONSTRAINT export_job_snapshots_request_text_check;
ALTER TABLE crest_private.export_job_snapshots ADD CONSTRAINT export_job_snapshots_request_text_check CHECK(octet_length(request_text) BETWEEN 1 AND (CASE WHEN source_schema_version IN(136,137,138,140,141,142) THEN 33554432 ELSE 1048576 END));
CREATE OR REPLACE FUNCTION crest_private.source_export_snapshot_plan(original text,j crest_private.export_jobs) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE maximum_bytes integer:=CASE WHEN j.source_schema_version IN(136,137,138,140,141,142) THEN 33554432 ELSE 1048576 END;r jsonb;p jsonb;f jsonb;names text[]:=ARRAY[]::text[];ids text[]:=ARRAY[]::text[];previous_name text;name text;n bigint:=0;position integer:=0;stamp timestamptz;plan_text text;
BEGIN
 IF original IS NULL OR octet_length(original) NOT BETWEEN 1 AND maximum_bytes OR NOT(original IS JSON OBJECT WITH UNIQUE KEYS) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 r:=original::jsonb;p:=r->'plan';plan_text:=(original::json->'plan')::text;
 IF NOT crest_private.export_json_object(r,ARRAY['plan','planSha256'])
 OR jsonb_typeof(r->'planSha256') IS DISTINCT FROM 'string' OR r->>'planSha256' IS DISTINCT FROM encode(sha256(convert_to(plan_text,'UTF8')),'hex')
 OR NOT crest_private.export_json_object(p,ARRAY['formatVersion','claim','generationId','observedAt','appReleaseId','sourceSchemaVersion','manifestSha256','parts','totalBytes','referenceClosureComplete','completePortableExport','completeBackup']||CASE WHEN j.source_schema_version IN(136,137,138,140,141,142) THEN ARRAY['originals'] ELSE ARRAY[]::text[] END)
 OR p->'formatVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.source_export_claim_matches(p->'claim',j) OR NOT crest_private.export_json_uuid(p->'generationId')
 OR p->'appReleaseId' IS DISTINCT FROM to_jsonb(j.app_release_id) OR p->'sourceSchemaVersion' IS DISTINCT FROM to_jsonb(j.source_schema_version)
 OR p->'referenceClosureComplete' IS DISTINCT FROM 'false'::jsonb OR p->'completePortableExport' IS DISTINCT FROM 'false'::jsonb OR p->'completeBackup' IS DISTINCT FROM 'false'::jsonb
 OR jsonb_typeof(p->'manifestSha256') IS DISTINCT FROM 'string' OR coalesce(p->>'manifestSha256','')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(p->'observedAt') IS DISTINCT FROM 'string' OR coalesce(p->>'observedAt','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?\+00:00$'
 OR jsonb_typeof(p->'parts') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'totalBytes') IS DISTINCT FROM 'number' OR coalesce(p->>'totalBytes','')!~'^[1-9][0-9]{0,7}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 IF jsonb_array_length(p->'parts') NOT BETWEEN 2 AND 1024 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 stamp:=(p->>'observedAt')::timestamptz;
 IF NOT isfinite(stamp) OR stamp>clock_timestamp() OR NOT EXISTS(SELECT 1 FROM crest_private.export_job_attempts a WHERE a.business_id=j.business_id AND a.export_job_id=j.id AND a.id=j.lease_id AND a.leased_at<=stamp) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p->'parts') LOOP
  position:=position+1;
  IF NOT crest_private.export_json_object(f,ARRAY['partId','fileName','contentType','bytes','sha256']) OR NOT crest_private.export_json_uuid(f->'partId')
  OR jsonb_typeof(f->'fileName') IS DISTINCT FROM 'string' OR coalesce(f->>'fileName','')!~'^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$'
  OR jsonb_typeof(f->'bytes') IS DISTINCT FROM 'number' OR coalesce(f->>'bytes','')!~'^[1-9][0-9]{0,6}$' OR (f->>'bytes')::bigint>8388608
  OR jsonb_typeof(f->'sha256') IS DISTINCT FROM 'string' OR coalesce(f->>'sha256','')!~'^[a-f0-9]{64}$'
  OR f->'contentType' IS DISTINCT FROM to_jsonb(CASE WHEN right(f->>'fileName',4)='.csv' THEN 'text/csv; charset=utf-8' WHEN right(f->>'fileName',5)='.json' THEN 'application/json' ELSE 'text/plain; charset=utf-8' END)
  OR f->>'fileName'=ANY(names) OR f->>'partId'=ANY(ids) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
  name:=f->>'fileName';
  IF position=jsonb_array_length(p->'parts') THEN
   IF name<>'source_manifest.json' OR f->'sha256' IS DISTINCT FROM p->'manifestSha256' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
  ELSIF name='source_manifest.json' OR previous_name IS NOT NULL AND name COLLATE "C"<=previous_name COLLATE "C" THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
  END IF;
  previous_name:=name;names:=array_append(names,name);ids:=array_append(ids,f->>'partId');n:=n+(f->>'bytes')::bigint;
 END LOOP;
 IF n<>(p->>'totalBytes')::bigint OR n>67108864 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';END IF;
 IF j.source_schema_version IN(136,137,138,140,141,142) AND crest_private.source_export_original_index_valid(p->'originals') IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_ORIGINAL_INDEX_REQUIRED';END IF;
 RETURN p;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_SNAPSHOT_INPUT_REQUIRED';
END $$;
CREATE OR REPLACE FUNCTION crest_private.source_export_receipt(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE o crest_private.operations;r jsonb;a record;expected_command jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 r:=o.result;
 IF o.command_type NOT IN('export.request','export.claim','export.expire','export.stop','export.ready') OR o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR r IS NULL OR jsonb_typeof(r)<>'object' OR NOT(r?&ARRAY['schemaVersion','command','job','auditEventId']) OR r-ARRAY['schemaVersion','command','job','auditEventId']<>'{}'::jsonb OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(r->'job') IS DISTINCT FROM 'object' OR r->'job'->>'business_id' IS DISTINCT FROM business::text OR r->'job'->>'operation_id' IS DISTINCT FROM operation::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 SELECT id,delta INTO a FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id::text=r->>'auditEventId' AND entity_kind='export_jobs' AND entity_id::text=r->'job'->>'id' AND entity_version::text=r->'job'->>'version' AND action=split_part(o.command_type,'.',2) AND delta->'after'=r->'job';
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 IF o.command_type='export.ready' THEN
  SELECT crest_private.source_export_ready_command(business,o.recovery_epoch,operation,(r->'job'->>'id')::uuid,c.expected_version::text,c.lease_id,c.generation_id,c.request_sha256) INTO expected_command FROM crest_private.export_job_completions c WHERE c.business_id=business AND c.export_job_id=(r->'job'->>'id')::uuid AND c.operation_id=operation AND c.actor_id=actor AND c.expected_version::text=a.delta->'before'->>'version' AND c.lease_id::text=a.delta->'before'->>'lease_id' AND a.delta->'before'->>'state'='Running' AND r->'job'->>'state'='Ready';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 ELSE
 expected_command:=crest_private.source_export_command(o.command_type,business,o.recovery_epoch,operation,(r->'job'->>'id')::uuid,a.delta->'before'->>'version',CASE WHEN o.command_type='export.claim' THEN (a.delta->'after'->>'lease_id')::uuid WHEN o.command_type='export.expire' THEN (a.delta->'before'->>'lease_id')::uuid ELSE NULL END,CASE WHEN o.command_type='export.request' THEN r->'job'->>'app_release_id' ELSE NULL END);
 END IF;
 IF o.command_type='export.request' AND r->'job'->>'profile'='crest.current-business-source-bundle.v1' AND r->'job'->'source_schema_version' IN('134'::jsonb,'135'::jsonb,'136'::jsonb,'137'::jsonb,'138'::jsonb,'140'::jsonb,'141'::jsonb,'142'::jsonb) THEN
  expected_command:=jsonb_set(jsonb_set(expected_command,'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}',r->'job'->'source_schema_version');
 END IF;
 IF r->'command' IS DISTINCT FROM expected_command THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_EXPORT_JOB_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $$;
CREATE OR REPLACE FUNCTION crest_private.source_export_request_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 RETURN coalesce(v?&ARRAY['schemaVersion','businessId','commandType','reference'] AND v-ARRAY['schemaVersion','businessId','commandType','reference']='{}'::jsonb
 AND v->'schemaVersion'='1'::jsonb AND crest_private.original_operation_uuid(v->'businessId') AND v->>'commandType'='export.request'
 AND jsonb_typeof(v->'reference')='object'
 AND v->'reference'?&ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']
 AND (v->'reference')-ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']='{}'::jsonb
 AND crest_private.original_operation_uuid(v->'reference'->'operationId') AND crest_private.original_operation_uuid(v->'reference'->'recoveryEpoch') AND crest_private.original_operation_uuid(v->'reference'->'exportJobId')
 AND jsonb_typeof(v->'reference'->'appReleaseId')='string' AND v->'reference'->>'appReleaseId'~'^[a-f0-9]{40}$'
 AND ((v->'reference'->>'profile'='crest.business-source-journal-bundle.v1' AND v->'reference'->'sourceSchemaVersion'='43'::jsonb) OR (v->'reference'->>'profile'='crest.current-business-source-bundle.v1' AND v->'reference'->'sourceSchemaVersion' IN('134'::jsonb,'135'::jsonb,'136'::jsonb,'137'::jsonb,'138'::jsonb,'140'::jsonb,'141'::jsonb,'142'::jsonb))),false);
END $$;
CREATE FUNCTION crest_commands.request_current_source_export_v8_for_execution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_job uuid,requested_release text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;j crest_private.export_jobs;after_state jsonb;event uuid;receipt jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_job IS NULL OR requested_release IS NULL OR requested_release!~'^[a-f0-9]{40}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_JOB_INPUT_REQUIRED';END IF;
 -- Actor/business/session-update precedes recovery and the original operation
 -- key. No lock spans provider, collection or object-store I/O.
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 context:=crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 -- Exactly the unchanged schema43 request writer's canonical payload hash.
 digest:=encode(sha256(convert_to(jsonb_build_object('schemaVersion',1,'commandType','export.request','businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedVersion',NULL::text,'leaseId',NULL::uuid,'appReleaseId',requested_release,'profile','crest.current-business-source-bundle.v1','sourceSchemaVersion',142)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'export.request',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
   IF existing.id IS NULL OR existing.actor_id IS DISTINCT FROM expected_actor OR existing.command_type IS DISTINCT FROM 'export.request' OR existing.recovery_epoch IS DISTINCT FROM expected_epoch OR existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   result:=crest_private.source_export_receipt(requested_business,expected_actor,requested_operation);
   PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
   RETURN jsonb_build_object('state','recorded','result',result);
  END IF;
  INSERT INTO crest_private.export_jobs(id,business_id,actor_id,profile,app_release_id,source_schema_version,recovery_epoch,request_operation_id,state,next_run_at,created_by,updated_by,origin,operation_id) VALUES(requested_job,requested_business,expected_actor,'crest.current-business-source-bundle.v1',requested_release,142,expected_epoch,requested_operation,'Queued',clock_timestamp(),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO j;
  after_state:=crest_private.source_export_job_projection(j);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'export_jobs',requested_job,j.version,'request',jsonb_build_object('schemaVersion',1,'before',NULL,'after',after_state),'manual') RETURNING id INTO event;
  receipt:=jsonb_build_object('schemaVersion',1,'command',jsonb_set(jsonb_set(crest_private.source_export_command('export.request',requested_business,expected_epoch,requested_operation,requested_job,NULL::text,NULL::uuid,requested_release),'{reference,profile}','"crest.current-business-source-bundle.v1"'::jsonb),'{reference,sourceSchemaVersion}','142'::jsonb),'job',after_state,'auditEventId',event);
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
  result:=crest_private.source_export_receipt(requested_business,expected_actor,requested_operation);
  PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  -- Keep the original verified scope through deferred audit checks at COMMIT.
  RETURN jsonb_build_object('state','created','result',result);
 EXCEPTION WHEN unique_violation THEN
  PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
  RETURN jsonb_build_object('state','conflict','reason','active_or_identity');
 END;
END $$;
REVOKE ALL ON FUNCTION crest_commands.request_current_source_export_v8_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_current_source_export_v8_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.request_current_source_export_v8_for_execution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_source_export_original(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_kind text,requested_attachment uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;original jsonb;original_index jsonb;matches jsonb;
BEGIN
 IF requested_attachment IS NULL OR requested_kind IS NULL OR requested_kind NOT IN('expense_receipt','supplier_document','condition_photo') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ORIGINAL_FILE_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 IF context->'header'->>'profile' IS DISTINCT FROM 'crest.current-business-source-bundle.v1'
 OR (context->'header'->>'sourceSchemaVersion')::integer NOT IN(136,137,138,140,141,142)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT request_text::jsonb->'plan'->'originals' INTO original_index FROM crest_private.export_job_snapshots WHERE business_id=requested_business AND export_job_id=requested_job AND generation_id=requested_generation;
 IF NOT FOUND OR original_index->>'profile' IS DISTINCT FROM 'crest.source-export-original-index.v1' OR jsonb_typeof(original_index->'files') IS DISTINCT FROM 'array'
 OR coalesce(original_index->>'inventorySha256','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO matches FROM jsonb_array_elements(original_index->'files') WHERE value->>'kind'=requested_kind AND value->>'attachmentId'=requested_attachment::text;
 IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_OUTSIDE_SNAPSHOT';END IF;
 IF (context->'header'->>'sourceSchemaVersion')::integer=142 THEN
  original:=crest_private.current_source_export_original_v2(requested_business,requested_kind,requested_attachment);
 ELSE
  original:=crest_private.current_source_export_original(requested_business,requested_kind,requested_attachment);
 END IF;
 IF original->'file' IS DISTINCT FROM matches->0 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 IF crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) IS DISTINCT FROM context
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ORIGINAL_EXPORT_UNAVAILABLE';END IF;
 RETURN jsonb_build_object('profile','crest.source-export-original-permit.v1','header',context->'header','authority',context->'authority','indexSha256',original_index->'inventorySha256','file',original->'file','object',original->'object');
END $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;

RESET ROLE;
-- END REVIEWED planning/proposals/20270218184000_opening_document_workspace_jobs.sql
