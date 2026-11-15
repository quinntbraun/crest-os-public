-- Immutable fictional supplier-bill intake, reviewed evidence, and duplicate hints. Drafts do not record a liability.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.valid_supplier_bill_draft(body jsonb) RETURNS boolean
 LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp SET datestyle='ISO, YMD' AS $valid$
DECLARE field text; value text; gross bigint; tax bigint; split jsonb; total numeric:=0; categories text[]:=ARRAY[]::text[];
BEGIN
 IF jsonb_typeof(body) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF NOT body ?& ARRAY['incurredOn','dueOn','unknownDueReason','vendor','unknownVendorReason','documentReference',
  'grossCents','purchaseTaxCents','purpose','missingReceiptReason','splits','changeReason']
  OR body-ARRAY['incurredOn','dueOn','unknownDueReason','vendor','unknownVendorReason','documentReference',
   'grossCents','purchaseTaxCents','purpose','missingReceiptReason','splits','changeReason']<>'{}'::jsonb
  OR octet_length(body::text)>20000 THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['vendor','unknownVendorReason','unknownDueReason','documentReference','purpose','missingReceiptReason','changeReason'] LOOP
  IF field NOT IN('purpose','missingReceiptReason') AND body->field='null'::jsonb THEN CONTINUE; END IF;
  value:=body->>field;
  IF jsonb_typeof(body->field) IS DISTINCT FROM 'string' OR char_length(value) NOT BETWEEN 1 AND
   (CASE WHEN field IN('vendor','documentReference') THEN 200 ELSE 1000 END)
   OR value<>btrim(value) OR value~'[[:cntrl:]]' THEN RETURN false; END IF;
 END LOOP;
 IF (body->'vendor'='null'::jsonb) IS DISTINCT FROM (body->'unknownVendorReason'<>'null'::jsonb)
  OR (body->'dueOn'='null'::jsonb) IS DISTINCT FROM (body->'unknownDueReason'<>'null'::jsonb)
  OR jsonb_typeof(body->'incurredOn') IS DISTINCT FROM 'string' OR body->>'incurredOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR to_char((body->>'incurredOn')::date,'YYYY-MM-DD')<>body->>'incurredOn'
  OR body->>'incurredOn'<'1900-01-01'
  OR jsonb_typeof(body->'grossCents') IS DISTINCT FROM 'string' OR body->>'grossCents' !~ '^[1-9][0-9]{0,18}$'
  OR jsonb_typeof(body->'splits') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF body->'dueOn'<>'null'::jsonb AND (jsonb_typeof(body->'dueOn') IS DISTINCT FROM 'string' OR body->>'dueOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR to_char((body->>'dueOn')::date,'YYYY-MM-DD')<>body->>'dueOn') THEN RETURN false; END IF;
 gross:=(body->>'grossCents')::bigint;
 IF body->'purchaseTaxCents'<>'null'::jsonb THEN
  IF jsonb_typeof(body->'purchaseTaxCents') IS DISTINCT FROM 'string' OR body->>'purchaseTaxCents' !~ '^(0|[1-9][0-9]{0,18})$'
   THEN RETURN false; END IF;
  tax:=(body->>'purchaseTaxCents')::bigint;
  IF tax>gross THEN RETURN false; END IF;
 END IF;
 IF jsonb_array_length(body->'splits')=0 THEN RETURN false; END IF;
 FOR split IN SELECT x FROM jsonb_array_elements(body->'splits') x LOOP
  IF jsonb_typeof(split)<>'object' THEN RETURN false; END IF;
  IF NOT split ?& ARRAY['category','grossCents'] OR split-ARRAY['category','grossCents']<>'{}'::jsonb
   OR jsonb_typeof(split->'category') IS DISTINCT FROM 'string'
   OR split->>'category' NOT IN('supplies','vehicle','fuel','insurance','marketing','software','fees','rent','utilities','professional','other')
   OR split->>'category'=ANY(categories) OR jsonb_typeof(split->'grossCents') IS DISTINCT FROM 'string'
   OR split->>'grossCents' !~ '^[1-9][0-9]{0,18}$' THEN RETURN false; END IF;
  categories:=array_append(categories,split->>'category');
  total:=total+(split->>'grossCents')::bigint;
 END LOOP;
 RETURN total=gross;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN RETURN false;
END $valid$;
REVOKE ALL ON FUNCTION crest_private.valid_supplier_bill_draft(jsonb) FROM PUBLIC;

CREATE TABLE crest.supplier_bill_draft_revisions (
 business_id uuid NOT NULL,
 bill_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 previous_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 payload jsonb NOT NULL CHECK(crest_private.valid_supplier_bill_draft(payload) IS TRUE),
 PRIMARY KEY(business_id,bill_id,revision),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,bill_id,previous_revision) REFERENCES crest.supplier_bill_draft_revisions(business_id,bill_id,revision),
 FOREIGN KEY(business_id,operation_id,actor_id) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((revision=1)=(payload->'changeReason'='null'::jsonb))
);
ALTER TABLE crest.supplier_bill_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.supplier_bill_draft_revisions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.supplier_bill_draft_revisions TO crest_expense_owner;
GRANT EXECUTE ON FUNCTION crest_private.valid_supplier_bill_draft(jsonb) TO crest_expense_owner;
CREATE POLICY bill_draft_read ON crest.supplier_bill_draft_revisions FOR SELECT TO crest_expense_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY bill_draft_append ON crest.supplier_bill_draft_revisions FOR INSERT TO crest_expense_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=supplier_bill_draft_revisions.business_id
   AND o.operation_id=supplier_bill_draft_revisions.operation_id AND o.actor_id=supplier_bill_draft_revisions.actor_id
   AND o.command_type='bookkeeping.supplier_bill.save' AND o.state='pending'));
CREATE TRIGGER bill_draft_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.supplier_bill_draft_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE POLICY bill_draft_operation_claim ON crest_private.operations FOR INSERT TO crest_expense_owner
 WITH CHECK(command_type='bookkeeping.supplier_bill.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY bill_draft_operation_finish ON crest_private.operations FOR UPDATE TO crest_expense_owner
 USING(command_type='bookkeeping.supplier_bill.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='bookkeeping.supplier_bill.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY bill_draft_audit_read ON crest_private.audit_events FOR SELECT TO crest_expense_owner
 USING(entity_kind='supplier_bill_draft_revisions' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT(reason),INSERT(reason) ON crest_private.audit_events TO crest_expense_owner;
CREATE POLICY bill_draft_audit_append ON crest_private.audit_events FOR INSERT TO crest_expense_owner
 WITH CHECK(entity_kind='supplier_bill_draft_revisions' AND action IN('create','revise')
  AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL);

CREATE FUNCTION crest_private.supplier_bill_draft_projection(r crest.supplier_bill_draft_revisions) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT jsonb_build_object('businessId',r.business_id,'billId',r.bill_id,'revision',r.revision::text,'operationId',r.operation_id,
  'actorId',r.actor_id,'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'payload',r.payload)
$projection$;
CREATE FUNCTION crest_private.supplier_bill_draft_digest(business uuid,actor uuid,epoch uuid,bill uuid,prior bigint,body jsonb) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $digest$
 SELECT encode(sha256(convert_to(jsonb_build_array('bookkeeping.supplier_bill.save',1,business,actor,epoch,bill,prior,body)::text,'UTF8')),'hex')
$digest$;
REVOKE ALL ON FUNCTION crest_private.supplier_bill_draft_projection(crest.supplier_bill_draft_revisions),
 crest_private.supplier_bill_draft_digest(uuid,uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.supplier_bill_draft_projection(crest.supplier_bill_draft_revisions),
 crest_private.supplier_bill_draft_digest(uuid,uuid,uuid,uuid,bigint,jsonb) TO crest_expense_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_expense_owner;
SET LOCAL ROLE crest_expense_owner;
CREATE FUNCTION crest_private.verify_supplier_bill_draft() RETURNS trigger LANGUAGE plpgsql
 SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $integrity$
DECLARE prior crest.supplier_bill_draft_revisions; image jsonb;
BEGIN
 PERFORM set_config('crest.business_id',NEW.business_id::text,true),set_config('crest.actor_id',NEW.actor_id::text,true),
  set_config('crest.operation_id',NEW.operation_id::text,true);
 SELECT * INTO prior FROM crest.supplier_bill_draft_revisions r WHERE
  (r.business_id,r.bill_id,r.revision)=(NEW.business_id,NEW.bill_id,NEW.previous_revision);
 image:=crest_private.supplier_bill_draft_projection(NEW);
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.actor_id)
   AND o.command_type='bookkeeping.supplier_bill.save' AND o.state='committed'
   AND o.payload_hash=crest_private.supplier_bill_draft_digest(NEW.business_id,NEW.actor_id,o.recovery_epoch,NEW.bill_id,NEW.revision-1,NEW.payload)
   AND o.result=jsonb_build_object('schemaVersion',1,'draft',image)
   AND a.entity_kind='supplier_bill_draft_revisions' AND a.entity_id=NEW.bill_id AND a.entity_version=NEW.revision
   AND a.action=CASE WHEN prior.revision IS NULL THEN 'create' ELSE 'revise' END
   AND a.reason IS NOT DISTINCT FROM NEW.payload->>'changeReason'
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',
    CASE WHEN prior.revision IS NOT NULL THEN crest_private.supplier_bill_draft_projection(prior) END,'after',image)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SUPPLIER_BILL_DRAFT_AUDIT_REQUIRED';
 END IF;
 RETURN NULL;
END $integrity$;
REVOKE ALL ON FUNCTION crest_private.verify_supplier_bill_draft() FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_expense_owner;
GRANT EXECUTE ON FUNCTION crest_private.verify_supplier_bill_draft() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER supplier_bill_draft_verify AFTER INSERT ON crest.supplier_bill_draft_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_supplier_bill_draft();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
SET LOCAL ROLE crest_expense_owner;
CREATE FUNCTION crest_commands.save_fictional_supplier_bill_draft(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_bill uuid,expected_revision bigint,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE auth jsonb; claimed uuid; digest text; prior crest.supplier_bill_draft_revisions;
 saved crest.supplier_bill_draft_revisions; operation crest_private.operations; image jsonb; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_bill IS NULL OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 OR NOT crest_private.valid_supplier_bill_draft(body)
  OR (expected_revision=0) IS DISTINCT FROM (body->'changeReason'='null'::jsonb) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_BILL_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=crest_private.supplier_bill_draft_digest(requested_business,expected_actor,expected_epoch,requested_bill,expected_revision,body);
 PERFORM pg_advisory_xact_lock(hashtextextended('supplier bill draft '||requested_business::text||requested_bill::text,0));
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO operation FROM crest_private.operations o WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation);
 IF FOUND THEN
  IF operation.command_type<>'bookkeeping.supplier_bill.save' OR operation.state<>'committed'
   OR (operation.payload_hash,operation.recovery_epoch) IS DISTINCT FROM (digest,expected_epoch) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',operation.result);
 END IF;
 SELECT * INTO prior FROM crest.supplier_bill_draft_revisions r WHERE (r.business_id,r.bill_id)=(requested_business,requested_bill)
  ORDER BY r.revision DESC LIMIT 1;
 IF coalesce(prior.revision,0)<>expected_revision THEN
  RETURN jsonb_build_object('state','conflict','reason','revision','currentRevision',coalesce(prior.revision,0)::text);
 END IF;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF (body->>'incurredOn')::date>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_BILL_DRAFT_INCURRED_DATE_REQUIRED';
 END IF;
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'bookkeeping.supplier_bill.save',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
 INSERT INTO crest.supplier_bill_draft_revisions(business_id,bill_id,revision,operation_id,actor_id,payload)
 VALUES(requested_business,requested_bill,expected_revision+1,requested_operation,expected_actor,body) RETURNING * INTO saved;
 image:=crest_private.supplier_bill_draft_projection(saved);
 receipt:=jsonb_build_object('schemaVersion',1,'draft',image);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'supplier_bill_draft_revisions',requested_bill,
  saved.revision,CASE WHEN prior.revision IS NULL THEN 'create' ELSE 'revise' END,body->>'changeReason',jsonb_build_object('schemaVersion',1,'before',
  CASE WHEN prior.revision IS NOT NULL THEN crest_private.supplier_bill_draft_projection(prior) END,'after',image),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE (business_id,operation_id)=(requested_business,requested_operation);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.lookup_fictional_supplier_bill_draft(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original_epoch uuid,
 original_operation uuid,original_bill uuid,expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved crest_private.operations;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_bill IS NULL OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_BILL_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT * INTO saved FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=
  (requested_business,original_operation,expected_actor) AND o.command_type='bookkeeping.supplier_bill.save' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.recovery_epoch<>original_epoch OR saved.result->'draft'->>'billId' IS DISTINCT FROM original_bill::text
  OR saved.result->'draft'->>'revision' IS DISTINCT FROM (expected_revision+1)::text THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;

CREATE FUNCTION crest_commands.review_fictional_supplier_bill_draft(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_bill uuid,expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE target crest.supplier_bill_draft_revisions; candidates jsonb;
BEGIN
 IF requested_bill IS NULL OR coalesce(expected_revision,0)<1 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_BILL_DRAFT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT * INTO target FROM crest.supplier_bill_draft_revisions r WHERE (r.business_id,r.bill_id)=(requested_business,requested_bill)
  ORDER BY r.revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF target.revision<>expected_revision THEN
  RETURN jsonb_build_object('state','conflict','reason','revision','currentRevision',target.revision::text);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('billId',d.bill_id,'revision',d.revision::text,
  'sameDocumentReference',d.same_document,'sameIncurredDateAndGross',d.same_amount_and_date) ORDER BY d.bill_id),'[]'::jsonb)
 INTO candidates
 FROM (
  SELECT current.bill_id,current.revision,
   coalesce(current.payload->>'documentReference'=target.payload->>'documentReference',false) AS same_document,
   (current.payload->>'incurredOn',current.payload->>'grossCents')=
    (target.payload->>'incurredOn',target.payload->>'grossCents') AS same_amount_and_date
  FROM (
   SELECT DISTINCT ON (r.bill_id) r.bill_id,r.revision,r.payload FROM crest.supplier_bill_draft_revisions r
   WHERE r.business_id=requested_business AND r.bill_id<>requested_bill ORDER BY r.bill_id,r.revision DESC
  ) current
  WHERE current.payload->>'vendor'=target.payload->>'vendor'
   AND (current.payload->>'documentReference'=target.payload->>'documentReference'
    OR (current.payload->>'incurredOn',current.payload->>'grossCents')=(target.payload->>'incurredOn',target.payload->>'grossCents'))
  ORDER BY current.bill_id LIMIT 51
 ) d;
 RETURN jsonb_build_object('schemaVersion',1,'state','review_required','billId',target.bill_id,'revision',target.revision::text,
  'vendorUnknown',target.payload->'vendor'='null'::jsonb,'dueTermsUnknown',target.payload->'dueOn'='null'::jsonb,
  'purchaseTaxAmountUnknown',target.payload->'purchaseTaxCents'='null'::jsonb,'missingDocument',true,
  'sameSupplierDrafts',CASE WHEN jsonb_array_length(candidates)>50 THEN candidates-50 ELSE candidates END,
  'moreSameSupplierDrafts',jsonb_array_length(candidates)>50);
END $review$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.save_fictional_supplier_bill_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.lookup_fictional_supplier_bill_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_fictional_supplier_bill_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.lookup_fictional_supplier_bill_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.review_fictional_supplier_bill_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_fictional_supplier_bill_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)
 TO crest_finance_preview;

GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
SET LOCAL ROLE crest_expense_owner;
CREATE FUNCTION crest_commands.list_fictional_supplier_bill_drafts(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_bill uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE drafts jsonb;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(crest_private.supplier_bill_draft_projection(d) ORDER BY d.bill_id),'[]') INTO drafts
 FROM (
  SELECT DISTINCT ON (r.bill_id) r.*
  FROM crest.supplier_bill_draft_revisions r
  WHERE r.business_id=requested_business AND (after_bill IS NULL OR r.bill_id>after_bill)
  ORDER BY r.bill_id,r.revision DESC LIMIT 9
 ) d;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'hasMore',jsonb_array_length(drafts)>8,'drafts',CASE WHEN jsonb_array_length(drafts)>8 THEN drafts-8 ELSE drafts END);
END $list$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.list_fictional_supplier_bill_drafts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_fictional_supplier_bill_drafts(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)
 TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.supplier_bill_draft_revisions TO crest_paid_expense_export_owner;
GRANT EXECUTE ON FUNCTION crest_private.supplier_bill_draft_projection(crest.supplier_bill_draft_revisions)
 TO crest_paid_expense_export_owner;
CREATE POLICY bill_draft_export ON crest.supplier_bill_draft_revisions FOR SELECT TO crest_paid_expense_export_owner
 USING(business_id=nullif(current_setting('crest.supplier_bill_export_business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.supplier_bill_draft_source_snapshot(requested_business uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $snapshot$
DECLARE revisions jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on'
 THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='SUPPLIER_BILL_DRAFT_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SUPPLIER_BILL_DRAFT_INPUT_REQUIRED'; END IF;
 PERFORM set_config('crest.supplier_bill_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(crest_private.supplier_bill_draft_projection(r) ORDER BY r.bill_id,r.revision),'[]') INTO revisions
 FROM (SELECT * FROM crest.supplier_bill_draft_revisions WHERE business_id=requested_business
  ORDER BY bill_id,revision LIMIT 401) r;
 snapshot:=jsonb_build_object('schemaVersion',1,'scope','supplier_bill_draft_source','businessId',requested_business,'revisions',revisions);
 IF jsonb_array_length(revisions)>400 OR octet_length(snapshot::text)>4194304
 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='SUPPLIER_BILL_DRAFT_SOURCE_LIMIT'; END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_paid_expense_export_owner;
ALTER FUNCTION crest_commands.supplier_bill_draft_source_snapshot(uuid) OWNER TO crest_paid_expense_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_paid_expense_export_owner;
REVOKE ALL ON FUNCTION crest_commands.supplier_bill_draft_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.supplier_bill_draft_source_snapshot(uuid) TO crest_export;

-- Audit authorized downloads of the revised finance source.
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
SET LOCAL ROLE crest_command_owner;
CREATE OR REPLACE FUNCTION crest_commands.record_posted_finance_export_access(credential_hash bytea,expected_session uuid,expected_actor uuid,
 expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,source_version integer,app_release text,observed_at text,manifest_digest text,archive_digest text,archive_bytes integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $handoff$
DECLARE operation uuid:=gen_random_uuid(); event uuid; scope jsonb; receipt jsonb; recorded timestamptz; observed timestamptz;
BEGIN
 IF expected_epoch IS NULL OR source_version IS NULL OR source_version NOT BETWEEN 89 AND 999
   OR app_release IS NULL OR app_release!~'^[a-f0-9]{40}$' OR observed_at IS NULL
   OR observed_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?\+00:00$'
   OR manifest_digest IS NULL OR manifest_digest!~'^[a-f0-9]{64}$' OR archive_digest IS NULL OR archive_digest!~'^[a-f0-9]{64}$'
   OR archive_bytes IS NULL OR archive_bytes NOT BETWEEN 1 AND 8388608 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 observed:=observed_at::timestamptz;
 IF NOT isfinite(observed) OR observed>clock_timestamp() OR observed<=clock_timestamp()-interval '2 minutes' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_POSTED_FINANCE_EXPORT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_source_export_download_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
   set_config('crest.operation_id',operation::text,true);
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=108 THEN 'crest.posted-finance-source.v22' WHEN source_version>=107 THEN 'crest.posted-finance-source.v21' WHEN source_version>=105 THEN 'crest.posted-finance-source.v20' WHEN source_version>=103 THEN 'crest.posted-finance-source.v19' WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
   'appReleaseId',app_release,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,
   'observedAt',observed_at,'manifestSha256',manifest_digest,'archiveSha256',archive_digest,'archiveBytes',archive_bytes);
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,operation,expected_actor,'finance.export_access',1,expected_epoch,
  encode(sha256(convert_to(scope::text,'UTF8')),'hex'),expected_actor,'manual');
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,operation,expected_actor,expected_actor,'finance_export_accesses',operation,1,'authorized_handoff',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',scope),'manual') RETURNING id,recorded_at INTO event,recorded;
 receipt:=jsonb_build_object('schemaVersion',1,'state','authorized_handoff','operationId',operation,'auditEventId',event,
  'recordedAt',to_char(recorded AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'scope',scope);
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE business_id=requested_business AND operation_id=operation AND actor_id=expected_actor;
 PERFORM crest_commands.finish_source_export_foreground_activity($1,$2,$3,$4,$5,$6,$7,$8,expected_epoch,operation);
 RETURN receipt;
END $handoff$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;

RESET ROLE;
