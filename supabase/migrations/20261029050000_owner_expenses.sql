-- Owner expense and private receipt schema49. Runtime and production activation remain gated.
-- Exact proposed bodies are preserved; historical source comments do not amend full V1 or double-entry requirements.
-- The migration coordinator owns one atomic transaction. No real-data/financial activation.
DO $candidate_review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_command_owner','crest_quote_owner','crest_export_owner','crest_export','crest_web') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>7 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE49_SOURCE_REVIEW_REQUIRED';END IF;
END $candidate_review$;

RESET ROLE;
-- BEGIN REVIEWED owner-expenses.sql
-- Unregistered construction over registered45. No migration ordinal or runtime activation.
-- User scope reconciliation: manual cash bookkeeping for a single owner; formal books
-- handled by tax preparer. This records history without claiming a general ledger.
DO $review$ BEGIN
 IF to_regclass('crest.quote_revisions') IS NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_expense_owner') THEN
  RAISE EXCEPTION 'EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_proc p WHERE p.oid IN(to_regprocedure('crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)'),to_regprocedure('crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)')) AND p.proowner='crest_session_owner'::regrole AND p.prosecdef AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') IN('614b87966124be9297a7658a86bc3ee84a29f19f381a80ca23ecf702ffa0e952','9b2d19abde943ad1353250275d1b3bf66b34b9ff5fbe1a6d16b73a0ef42cae35'))<>2 THEN RAISE EXCEPTION 'EXPENSE_AUTHORITY_REVIEW_REQUIRED';END IF;
 CREATE ROLE crest_expense_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_expense_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.valid_expense_payload(p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text; v text;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' OR NOT p ?& ARRAY['paidOn','amountCents','currency','category','description','vendor','paymentMethod','reference','notes','voided','changeReason'] OR p-ARRAY['paidOn','amountCents','currency','category','description','vendor','paymentMethod','reference','notes','voided','changeReason']<>'{}'::jsonb OR octet_length(p::text)>20000 THEN RETURN false;END IF;
 IF jsonb_typeof(p->'paidOn') IS DISTINCT FROM 'string' OR (p->>'paidOn')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR p->>'paidOn'<'1900-01-01' OR to_char((p->>'paidOn')::date,'YYYY-MM-DD')<>p->>'paidOn' OR jsonb_typeof(p->'amountCents') IS DISTINCT FROM 'string' OR (p->>'amountCents')!~'^[1-9][0-9]{0,11}$' OR p->>'currency' IS DISTINCT FROM 'USD' OR jsonb_typeof(p->'category') IS DISTINCT FROM 'string' OR p->>'category' NOT IN('supplies','equipment','vehicle','fuel','insurance','marketing','software','fees','rent','utilities','professional','other') OR jsonb_typeof(p->'paymentMethod') IS DISTINCT FROM 'string' OR p->>'paymentMethod' NOT IN('cash','card','bank','other') OR jsonb_typeof(p->'voided') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['description','vendor','reference','notes','changeReason'] LOOP
  IF k<>'description' AND p->k='null'::jsonb THEN CONTINUE;END IF;
  v:=p->>k;
  IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR char_length(v)>(CASE k WHEN 'notes' THEN 2000 WHEN 'description' THEN 500 WHEN 'changeReason' THEN 500 ELSE 200 END) OR btrim(v,E' \t\n\r')='' OR translate(v,E'\t\n\r','')~'[[:cntrl:]]' THEN RETURN false;END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $valid$;
REVOKE ALL ON FUNCTION crest_private.valid_expense_payload(jsonb) FROM PUBLIC;
CREATE TABLE crest.expense_revisions(
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 expense_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 operation_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 payload jsonb NOT NULL CHECK(crest_private.valid_expense_payload(payload)),
 PRIMARY KEY(business_id,expense_id,revision),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(CASE WHEN revision=1 THEN payload->'voided'='false'::jsonb AND payload->'changeReason'='null'::jsonb ELSE payload->'changeReason'<>'null'::jsonb END)
);
ALTER TABLE crest.expense_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.expense_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_read ON crest.expense_revisions FOR SELECT TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY expense_append ON crest.expense_revisions FOR INSERT TO crest_expense_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE TRIGGER expense_no_update BEFORE UPDATE OR DELETE ON crest.expense_revisions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER expense_no_truncate BEFORE TRUNCATE ON crest.expense_revisions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE FUNCTION crest_private.expense_projection(r crest.expense_revisions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('businessId',r.business_id,'expenseId',r.expense_id,'revision',r.revision::text,'operationId',r.operation_id,'actorId',r.actor_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'payload',r.payload)
$projection$;
REVOKE ALL ON FUNCTION crest_private.expense_projection(crest.expense_revisions) FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_expense_owner;
GRANT SELECT,INSERT ON crest.expense_revisions TO crest_expense_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_expense_payload(jsonb),crest_private.expense_projection(crest.expense_revisions) TO crest_expense_owner;
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_expense_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_expense_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_expense_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_expense_owner;
CREATE POLICY expense_operations_read ON crest_private.operations FOR SELECT TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY expense_operations_create ON crest_private.operations FOR INSERT TO crest_expense_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='bookkeeping.expense.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY expense_operations_finish ON crest_private.operations FOR UPDATE TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='bookkeeping.expense.save') WITH CHECK(command_type='bookkeeping.expense.save');
CREATE POLICY expense_audits_read ON crest_private.audit_events FOR SELECT TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='expense_revisions');
CREATE POLICY expense_audits_create ON crest_private.audit_events FOR INSERT TO crest_expense_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='expense_revisions' AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean) TO crest_expense_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.check_expense_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE prior crest.expense_revisions; o crest_private.operations; image jsonb;
BEGIN
 SELECT * INTO prior FROM crest.expense_revisions WHERE business_id=NEW.business_id AND expense_id=NEW.expense_id AND revision=NEW.revision-1;
 IF NEW.revision>1 AND (prior.revision IS NULL OR prior.payload->'voided'='true'::jsonb) THEN RAISE EXCEPTION 'EXPENSE_HISTORY_REQUIRED';END IF;
 IF NEW.payload->'voided'='true'::jsonb AND NEW.payload-ARRAY['voided','changeReason'] IS DISTINCT FROM prior.payload-ARRAY['voided','changeReason'] THEN RAISE EXCEPTION 'EXPENSE_VOID_CONTENT_REQUIRED';END IF;
 SELECT * INTO o FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.actor_id;
 image:=crest_private.expense_projection(NEW);
 IF o.state IS DISTINCT FROM 'committed' OR o.command_type IS DISTINCT FROM 'bookkeeping.expense.save' OR o.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'expense',image) OR o.payload_hash IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('businessId',NEW.business_id,'actorId',NEW.actor_id,'recoveryEpoch',o.recovery_epoch,'expenseId',NEW.expense_id,'expectedRevision',(NEW.revision-1)::text,'payload',NEW.payload)::text,'UTF8')),'hex') OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND entity_kind='expense_revisions' AND entity_id=NEW.expense_id AND entity_version=NEW.revision AND actor_id=NEW.actor_id AND action=CASE WHEN NEW.revision=1 THEN 'create' WHEN NEW.payload->'voided'='true'::jsonb THEN 'void' ELSE 'correct' END AND delta=jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior.revision IS NULL THEN 'null'::jsonb ELSE crest_private.expense_projection(prior) END,'after',image)) THEN RAISE EXCEPTION 'EXPENSE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER expense_audit AFTER INSERT ON crest.expense_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_expense_append();
CREATE FUNCTION crest_commands.save_expense(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_expense uuid,expected_revision bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
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
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);
  RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'expense',image));
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentRevision',coalesce(prior.revision,0)::text);
 END;
END $save$;
CREATE FUNCTION crest_commands.read_expense_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_expense uuid,after_revision bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF after_revision IS DISTINCT FROM 0 OR after_expense IS NOT NULL THEN RAISE EXCEPTION 'EXPENSE_INPUT_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT coalesce(jsonb_agg(image ORDER BY expense_id,revision),'[]'::jsonb) INTO result FROM (SELECT expense_id,revision,crest_private.expense_projection(r) AS image FROM crest.expense_revisions r WHERE business_id=requested_business ORDER BY expense_id,revision LIMIT 1001) page;
 IF jsonb_array_length(result)>1000 OR octet_length(result::text)>6291456 THEN RAISE EXCEPTION 'EXPENSE_CAPACITY_REVIEW_REQUIRED';END IF;
 RETURN result;
END $read$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_expense_owner;
ALTER FUNCTION crest_private.check_expense_append() OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.save_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.read_expense_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) OWNER TO crest_expense_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_private.check_expense_append(),crest_commands.save_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb),crest_commands.read_expense_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb),crest_commands.read_expense_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_web;

RESET ROLE;
-- END REVIEWED owner-expenses.sql

RESET ROLE;
-- BEGIN REVIEWED owner-expense-receipts.sql
-- Unregistered construction over registered45 + reviewed owner-expenses.sql.
-- Private immutable candidate metadata only; no decoder, public file URL or runtime activation.
DO $review$ BEGIN
 IF to_regclass('crest.expense_revisions') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_expense_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL) OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_expense_owner') THEN RAISE EXCEPTION 'RECEIPT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.valid_expense_payload(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND NOT p.proleakproof AND p.provolatile='i' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a8de4a625d47dc34f1c5af2f1aeb8d69b08ae283eabfc55e09c647a16ca3ef6f') THEN RAISE EXCEPTION 'RECEIPT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.expense_projection(crest.expense_revisions)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND NOT p.proleakproof AND p.provolatile='i' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2bc3eb456f7db3738217a617a91f07c15498cc5d63f8f2dbf6603fc72c5b06cc') THEN RAISE EXCEPTION 'RECEIPT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_expense_append()') AND p.proowner='crest_expense_owner'::regrole AND p.prosecdef=true AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7b6554151fdbff8d984c6e4a58f32507f69f530a6153f19598f076e584e39caf') THEN RAISE EXCEPTION 'RECEIPT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.save_expense(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb)') AND p.proowner='crest_expense_owner'::regrole AND p.prosecdef=true AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='97188fd01ae728d305ad72dd29529d07f8189297d38bda279e25f74c2459e152') THEN RAISE EXCEPTION 'RECEIPT_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.read_expense_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)') AND p.proowner='crest_expense_owner'::regrole AND p.prosecdef=true AND NOT p.proleakproof AND p.provolatile='v' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3a5e3f3635798d063180e986aa1d96c4293d7ca79ca7f30c864408b8584fe9dc') THEN RAISE EXCEPTION 'RECEIPT_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.valid_receipt_reservation(r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text;
BEGIN
 IF r IS NULL OR jsonb_typeof(r)<>'object' OR NOT r ?& ARRAY['businessId','receiptId','expenseId','expenseRevision','recoveryEpoch','declaredType','byteSize','stagingKey','originalKey','previewKey','dispatchId'] OR r-ARRAY['businessId','receiptId','expenseId','expenseRevision','recoveryEpoch','declaredType','byteSize','stagingKey','originalKey','previewKey','dispatchId']<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['businessId','receiptId','expenseId','recoveryEpoch','dispatchId'] LOOP IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR (r->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN false;END IF;END LOOP;
 RETURN jsonb_typeof(r->'expenseRevision')='string' AND (r->>'expenseRevision')~'^[1-9][0-9]{0,18}$' AND (r->>'expenseRevision')::numeric<=9223372036854775807 AND jsonb_typeof(r->'byteSize')='number' AND (r->>'byteSize')~'^[1-9][0-9]{0,7}$' AND (r->>'byteSize')::numeric<=26214400 AND r->>'declaredType' IN('image/jpeg','image/png','image/heic','application/pdf') AND r->>'stagingKey'='staging/'||(r->>'businessId')||'/'||(r->>'receiptId')||'/'||(r->>'dispatchId') AND r->>'originalKey'='originals/'||(r->>'businessId')||'/'||(r->>'receiptId') AND r->>'previewKey'='previews/'||(r->>'businessId')||'/'||(r->>'receiptId');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $valid$;
CREATE FUNCTION crest_private.valid_receipt_candidate(c jsonb,r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE s jsonb; o jsonb; p jsonb; k text; pdf boolean:=r->>'declaredType'='application/pdf'; heic boolean:=r->>'declaredType'='image/heic'; source_keys text[];
BEGIN
 IF c IS NULL OR NOT crest_private.valid_receipt_reservation(r) OR jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT c ?& ARRAY['status','validationVersion','source','original','preview'] OR c-ARRAY['status','validationVersion','source','original','preview']<>'{}'::jsonb OR c->>'status' IS DISTINCT FROM 'PrivateValidatedCandidate' OR c->>'validationVersion' IS DISTINCT FROM (CASE WHEN pdf THEN 'crest-pdf-v1-qpdf-12.4.2-pdfium-3.0.0' WHEN heic THEN 'crest-heic-v1-libheif-1.23.6-libde265-1.1.3-sharp-0.35.5' ELSE 'crest-image-v1-sharp-0.35.5' END) OR octet_length(c::text)>8192 THEN RETURN false;END IF;
 s:=c->'source';o:=c->'original';p:=c->'preview';source_keys:=ARRAY['sha256','byteSize','detectedType']||(CASE WHEN pdf THEN ARRAY['pageCount'] WHEN heic THEN ARRAY['width','height','displayWidth','displayHeight','bitDepth'] ELSE ARRAY['width','height'] END);
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR NOT s ?& source_keys OR s-source_keys<>'{}'::jsonb OR jsonb_typeof(s->'sha256') IS DISTINCT FROM 'string' OR (s->>'sha256')!~'^[a-f0-9]{64}$' OR s->'byteSize' IS DISTINCT FROM r->'byteSize' OR s->'detectedType' IS DISTINCT FROM r->'declaredType' THEN RETURN false;END IF;
 FOREACH k IN ARRAY source_keys LOOP IF k IN('sha256','byteSize','detectedType') THEN CONTINUE;END IF;IF jsonb_typeof(s->k) IS DISTINCT FROM 'number' OR (s->>k)!~'^[1-9][0-9]{0,7}$' OR (s->>k)::numeric>(CASE WHEN k='pageCount' THEN 100 WHEN k='bitDepth' THEN 16 ELSE 60000000 END) THEN RETURN false;END IF;END LOOP;
 IF NOT pdf AND (s->>'width')::numeric*(s->>'height')::numeric>60000000 OR heic AND ((s->>'displayWidth')::numeric*(s->>'displayHeight')::numeric>60000000 OR (s->>'bitDepth')::numeric<8) THEN RETURN false;END IF;
 IF jsonb_typeof(o) IS DISTINCT FROM 'object' OR NOT o ?& ARRAY['key','byteSize','sha256'] OR o-ARRAY['key','byteSize','sha256']<>'{}'::jsonb OR o->'key' IS DISTINCT FROM r->'originalKey' OR o->'byteSize' IS DISTINCT FROM r->'byteSize' OR o->'sha256' IS DISTINCT FROM s->'sha256' THEN RETURN false;END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& (ARRAY['key','byteSize','sha256','contentType','width','height']||CASE WHEN pdf THEN ARRAY['pageNumber'] ELSE ARRAY[]::text[] END) OR p-(ARRAY['key','byteSize','sha256','contentType','width','height']||CASE WHEN pdf THEN ARRAY['pageNumber'] ELSE ARRAY[]::text[] END)<>'{}'::jsonb OR p->'key' IS DISTINCT FROM r->'previewKey' OR p->>'contentType' IS DISTINCT FROM 'image/jpeg' OR jsonb_typeof(p->'sha256') IS DISTINCT FROM 'string' OR (p->>'sha256')!~'^[a-f0-9]{64}$' OR pdf AND p->'pageNumber' IS DISTINCT FROM '1'::jsonb THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['byteSize','width','height'] LOOP IF jsonb_typeof(p->k) IS DISTINCT FROM 'number' OR (p->>k)!~'^[1-9][0-9]{0,7}$' OR (p->>k)::numeric>(CASE WHEN k='byteSize' THEN 8388608 ELSE 2048 END) THEN RETURN false;END IF;END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;
END $valid$;
CREATE TABLE crest.expense_receipt_revisions(
 business_id uuid NOT NULL,receipt_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision IN(1,2)),expense_id uuid NOT NULL,expense_revision bigint NOT NULL,
 operation_id uuid NOT NULL,actor_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),reservation jsonb NOT NULL CHECK(crest_private.valid_receipt_reservation(reservation) IS TRUE),candidate jsonb,
 PRIMARY KEY(business_id,receipt_id,revision),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,expense_id,expense_revision) REFERENCES crest.expense_revisions(business_id,expense_id,revision) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(reservation->>'businessId'=business_id::text AND reservation->>'receiptId'=receipt_id::text AND reservation->>'expenseId'=expense_id::text AND reservation->>'expenseRevision'=expense_revision::text),
 CHECK(CASE WHEN revision=1 THEN candidate IS NULL ELSE crest_private.valid_receipt_candidate(candidate,reservation) IS TRUE END)
);
ALTER TABLE crest.expense_receipt_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.expense_receipt_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY expense_receipt_read ON crest.expense_receipt_revisions FOR SELECT TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY expense_receipt_append ON crest.expense_receipt_revisions FOR INSERT TO crest_expense_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE TRIGGER expense_receipt_no_update BEFORE UPDATE OR DELETE ON crest.expense_receipt_revisions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER expense_receipt_no_truncate BEFORE TRUNCATE ON crest.expense_receipt_revisions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE FUNCTION crest_private.expense_receipt_projection(r crest.expense_receipt_revisions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $project$ SELECT jsonb_build_object('receiptVersion',r.revision::text,'operationId',r.operation_id,'actorId',r.actor_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reservation',r.reservation,'candidate',r.candidate) $project$;
CREATE FUNCTION crest_private.expense_receipt_digest(command text,business uuid,actor uuid,epoch uuid,receipt uuid,body jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $digest$ SELECT encode(sha256(convert_to(jsonb_build_object('commandType',command,'schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',epoch,'receiptId',receipt,'payload',body)::text,'UTF8')),'hex') $digest$;
GRANT SELECT,INSERT ON crest.expense_receipt_revisions TO crest_expense_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_receipt_reservation(jsonb),crest_private.valid_receipt_candidate(jsonb,jsonb),crest_private.expense_receipt_projection(crest.expense_receipt_revisions),crest_private.expense_receipt_digest(text,uuid,uuid,uuid,uuid,jsonb) TO crest_expense_owner;
DROP POLICY expense_operations_create ON crest_private.operations;
CREATE POLICY expense_operations_create ON crest_private.operations FOR INSERT TO crest_expense_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
DROP POLICY expense_operations_finish ON crest_private.operations;
CREATE POLICY expense_operations_finish ON crest_private.operations FOR UPDATE TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish')) WITH CHECK(command_type IN('bookkeeping.expense.save','bookkeeping.receipt.reserve','bookkeeping.receipt.publish'));
DROP POLICY expense_audits_read ON crest_private.audit_events;
CREATE POLICY expense_audits_read ON crest_private.audit_events FOR SELECT TO crest_expense_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('expense_revisions','expense_receipt_revisions'));
DROP POLICY expense_audits_create ON crest_private.audit_events;
CREATE POLICY expense_audits_create ON crest_private.audit_events FOR INSERT TO crest_expense_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('expense_revisions','expense_receipt_revisions') AND origin='manual' AND import_row_id IS NULL);
CREATE FUNCTION crest_private.check_expense_receipt_append() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE prior crest.expense_receipt_revisions;o crest_private.operations;image jsonb;body jsonb;command text;
BEGIN
 SELECT * INTO prior FROM crest.expense_receipt_revisions WHERE business_id=NEW.business_id AND receipt_id=NEW.receipt_id AND revision=NEW.revision-1;
 IF NEW.revision=2 AND (prior.revision IS NULL OR prior.reservation IS DISTINCT FROM NEW.reservation OR prior.candidate IS NOT NULL) THEN RAISE EXCEPTION 'RECEIPT_RESERVATION_REQUIRED';END IF;
 command:=CASE WHEN NEW.revision=1 THEN 'bookkeeping.receipt.reserve' ELSE 'bookkeeping.receipt.publish' END;
 body:=CASE WHEN NEW.revision=1 THEN jsonb_build_object('expenseId',NEW.expense_id,'expenseRevision',NEW.expense_revision::text,'declaredType',NEW.reservation->'declaredType','byteSize',NEW.reservation->'byteSize') ELSE jsonb_build_object('candidate',NEW.candidate) END;
 SELECT * INTO o FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.actor_id;image:=crest_private.expense_receipt_projection(NEW);
 IF o.state IS DISTINCT FROM 'committed' OR o.command_type IS DISTINCT FROM command OR o.recovery_epoch::text IS DISTINCT FROM NEW.reservation->>'recoveryEpoch' OR o.payload_hash IS DISTINCT FROM crest_private.expense_receipt_digest(command,NEW.business_id,NEW.actor_id,o.recovery_epoch,NEW.receipt_id,body) OR o.result IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'record',image) OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.actor_id AND entity_kind='expense_receipt_revisions' AND entity_id=NEW.receipt_id AND entity_version=NEW.revision AND action=CASE WHEN NEW.revision=1 THEN 'reserve' ELSE 'publish' END AND delta=jsonb_build_object('schemaVersion',1,'before',CASE WHEN prior.revision IS NULL THEN 'null'::jsonb ELSE crest_private.expense_receipt_projection(prior) END,'after',image)) THEN RAISE EXCEPTION 'RECEIPT_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER expense_receipt_audit AFTER INSERT ON crest.expense_receipt_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_expense_receipt_append();
CREATE FUNCTION crest_commands.reserve_expense_receipt(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_receipt uuid,requested_expense uuid,expected_expense_revision bigint,declared_type text,byte_size integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $reserve$
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
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);RETURN jsonb_build_object('state','committed','operationId',requested_operation,'receipt',jsonb_build_object('schemaVersion',1,'record',image));
 EXCEPTION WHEN SQLSTATE 'P1001' OR unique_violation THEN RETURN jsonb_build_object('state','conflict');END;
END $reserve$;
CREATE FUNCTION crest_commands.read_expense_receipt(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_receipt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT crest_private.expense_receipt_projection(r) INTO result FROM crest.expense_receipt_revisions r WHERE business_id=requested_business AND receipt_id=requested_receipt ORDER BY revision DESC LIMIT 1;
 IF result IS NULL THEN RAISE EXCEPTION 'RECEIPT_NOT_AVAILABLE';END IF;RETURN result;
END $read$;
CREATE FUNCTION crest_commands.list_expense_receipts(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_expense uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT coalesce(jsonb_agg(image ORDER BY receipt_id),'[]'::jsonb) INTO result FROM (SELECT DISTINCT ON(receipt_id) receipt_id,crest_private.expense_receipt_projection(r) AS image FROM crest.expense_receipt_revisions r WHERE business_id=requested_business AND expense_id=requested_expense ORDER BY receipt_id,revision DESC LIMIT 201) current_receipts;
 IF jsonb_array_length(result)>200 THEN RAISE EXCEPTION 'RECEIPT_CAPACITY_REVIEW_REQUIRED';END IF;RETURN result;
END $list$;
CREATE FUNCTION crest_commands.check_expense_receipt_writable(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_receipt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $write$
DECLARE context jsonb;r crest.expense_receipt_revisions;expense crest.expense_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO r FROM crest.expense_receipt_revisions WHERE business_id=requested_business AND receipt_id=requested_receipt AND revision=1;
 IF r.revision IS NULL OR r.reservation->>'recoveryEpoch' IS DISTINCT FROM expected_epoch::text THEN RAISE EXCEPTION 'RECEIPT_RESERVATION_REQUIRED';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(requested_business::text||r.expense_id::text,0));SELECT * INTO expense FROM crest.expense_revisions WHERE business_id=requested_business AND expense_id=r.expense_id ORDER BY revision DESC LIMIT 1;
 IF expense.revision IS NULL OR expense.payload->'voided'='true'::jsonb THEN RAISE EXCEPTION 'RECEIPT_EXPENSE_CONFLICT';END IF;RETURN jsonb_build_object('state','ready');
END $write$;
CREATE FUNCTION crest_commands.publish_expense_receipt(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,requested_receipt uuid,candidate jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $publish$
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
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',false);RETURN jsonb_build_object('state','committed','operationId',requested_operation,'receipt',jsonb_build_object('schemaVersion',1,'record',image));
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('state','conflict');END;
END $publish$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_expense_owner;
ALTER FUNCTION crest_private.check_expense_receipt_append() OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.reserve_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.read_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.list_expense_receipts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.check_expense_receipt_writable(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.publish_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) OWNER TO crest_expense_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.list_expense_receipts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_expense_receipts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
REVOKE ALL ON FUNCTION crest_private.valid_receipt_reservation(jsonb),crest_private.valid_receipt_candidate(jsonb,jsonb),crest_private.expense_receipt_projection(crest.expense_receipt_revisions),crest_private.expense_receipt_digest(text,uuid,uuid,uuid,uuid,jsonb),crest_private.check_expense_receipt_append(),crest_commands.reserve_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer),crest_commands.read_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.check_expense_receipt_writable(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.publish_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.reserve_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,uuid,bigint,text,integer),crest_commands.read_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.check_expense_receipt_writable(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.publish_expense_receipt(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,jsonb) TO crest_web;

RESET ROLE;
-- END REVIEWED owner-expense-receipts.sql

RESET ROLE;
-- BEGIN REVIEWED owner-expenses-activity.sql
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

RESET ROLE;
-- END REVIEWED owner-expenses-activity.sql

RESET ROLE;
-- BEGIN REVIEWED owner-expenses-original.sql
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

RESET ROLE;
-- END REVIEWED owner-expenses-original.sql

RESET ROLE;
-- BEGIN REVIEWED owner-expense-receipts-original.sql
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

RESET ROLE;
-- END REVIEWED owner-expense-receipts-original.sql

RESET ROLE;
-- BEGIN REVIEWED owner-expenses-resolution.sql
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

RESET ROLE;
-- END REVIEWED owner-expenses-resolution.sql

RESET ROLE;
-- BEGIN REVIEWED owner-expenses-source.sql
-- Unregistered financial source retrieval over registered48 plus expense overlays.
-- Privileged export credential only; not the ordinary web role or full backup proof.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_expense_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_expense_owner') OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_expense_owner',oid,'CREATE')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.quote_commercial_snapshot_context(uuid)') AND proowner='crest_quote_owner'::regrole AND prosecdef AND provolatile='v' AND NOT proleakproof AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='695968b644450c9789c86ba205962e17c6708f1e709fe1aa297f742cc28b5300') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN('crest.expense_revisions'::regclass,'crest.expense_receipt_revisions'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>2 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.business_history_export_context(uuid)') AND proowner='crest_export_owner'::regrole AND prosecdef AND provolatile='s' AND NOT proleakproof AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on,timezone=utc,datestyle=iso, ymd' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='4bffab5c3da874672971ecdea9a0353dc7a8b861c92384c8e2966811a967566e') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.expense_source_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE commercial jsonb;history jsonb;expenses bigint;receipts bigint;BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPENSE_SOURCE_SCOPE_REQUIRED';END IF;
 commercial:=crest_commands.quote_commercial_snapshot_context(requested_business);
 history:=crest_commands.business_history_export_context(requested_business);
 SELECT count(*) INTO expenses FROM crest.expense_revisions WHERE business_id=requested_business;
 SELECT count(*) INTO receipts FROM crest.expense_receipt_revisions WHERE business_id=requested_business;
 IF expenses+receipts>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_EXPENSE_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','owner_expense_sources','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.expense-source.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'commercialSnapshotToken',commercial->>'snapshotToken','historySnapshotToken',history->>'snapshotToken','expectedCounts',jsonb_build_object('expenses',expenses::text,'receipts',receipts::text));
END $context$;
CREATE FUNCTION crest_commands.expense_source_snapshot_expenses(requested_business uuid,expected_snapshot text,after_id uuid,after_revision bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;BEGIN
 context:=crest_commands.expense_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 OR (after_id IS NULL)<>(after_revision IS NULL) OR after_revision<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.expense_revisions WHERE business_id=requested_business AND (after_id IS NULL OR (expense_id,revision)>(after_id,after_revision)) ORDER BY expense_id,revision LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'expenses',coalesce(jsonb_agg(jsonb_build_object('business_id',p.business_id,'expense_id',p.expense_id,'revision',p.revision::text,'operation_id',p.operation_id,'actor_id',p.actor_id,'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'payload',p.payload) ORDER BY p.expense_id,p.revision),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.expense_revisions later WHERE later.business_id=requested_business AND (later.expense_id,later.revision)>(SELECT last.expense_id,last.revision FROM page last ORDER BY last.expense_id DESC,last.revision DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_EXPENSE_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.expense_source_snapshot_receipts(requested_business uuid,expected_snapshot text,after_id uuid,after_revision bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;BEGIN
 context:=crest_commands.expense_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 OR (after_id IS NULL)<>(after_revision IS NULL) OR after_revision<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.expense_receipt_revisions WHERE business_id=requested_business AND (after_id IS NULL OR (receipt_id,revision)>(after_id,after_revision)) ORDER BY receipt_id,revision LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'receipts',coalesce(jsonb_agg(jsonb_build_object('business_id',p.business_id,'receipt_id',p.receipt_id,'revision',p.revision::text,'expense_id',p.expense_id,'expense_revision',p.expense_revision::text,'operation_id',p.operation_id,'actor_id',p.actor_id,'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reservation',p.reservation,'candidate',p.candidate) ORDER BY p.receipt_id,p.revision),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.expense_receipt_revisions later WHERE later.business_id=requested_business AND (later.receipt_id,later.revision)>(SELECT last.receipt_id,last.revision FROM page last ORDER BY last.receipt_id DESC,last.revision DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_EXPENSE_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
ALTER FUNCTION crest_commands.expense_source_snapshot_context(uuid) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.expense_source_snapshot_expenses(uuid,text,uuid,bigint,integer) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) OWNER TO crest_expense_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.expense_source_snapshot_context(uuid),crest_commands.expense_source_snapshot_expenses(uuid,text,uuid,bigint,integer),crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.expense_source_snapshot_context(uuid),crest_commands.expense_source_snapshot_expenses(uuid,text,uuid,bigint,integer),crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) TO crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.quote_commercial_snapshot_context(uuid) TO crest_expense_owner;
GRANT EXECUTE ON FUNCTION crest_commands.business_history_export_context(uuid) TO crest_expense_owner;

RESET ROLE;
-- END REVIEWED owner-expenses-source.sql
