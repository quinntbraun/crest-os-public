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
