-- HELD/unregistered customer-funds evidence storage. No production or posting activation.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.opening_funds_origins (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,
 source_namespace text NOT NULL CHECK(source_namespace~'^[a-z][a-z0-9_.-]{0,99}$'),
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 200 AND btrim(external_id)=external_id AND external_id!~'[[:cntrl:]]'),
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),UNIQUE(business_id,source_namespace,external_id),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.opening_funds_items (
 id uuid PRIMARY KEY,business_id uuid NOT NULL,origin_id uuid NOT NULL,customer_id uuid NOT NULL,
 operation_id uuid NOT NULL,recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 UNIQUE(business_id,id),
 FOREIGN KEY(business_id,origin_id) REFERENCES crest.opening_funds_origins(business_id,id),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.opening_funds_schedule_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 worksheet_revision_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 prior_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,
 audit_event_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=2097152),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
 UNIQUE(business_id,worksheet_revision_id,revision),
 UNIQUE(business_id,operation_id),
 UNIQUE(business_id,audit_event_id),
 FOREIGN KEY(business_id,worksheet_revision_id) REFERENCES crest.opening_worksheet_revisions(business_id,id),
 FOREIGN KEY(business_id,worksheet_revision_id,prior_revision)
  REFERENCES crest.opening_funds_schedule_revisions(business_id,worksheet_revision_id,revision),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY(business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE crest.opening_funds_schedule_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_funds_schedule_revisions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_funds_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_funds_schedule_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_funds_schedule_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_funds_schedule_revisions TO crest_finance_integrity_owner;
CREATE POLICY opening_funds_review ON crest.opening_funds_schedule_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_funds_append ON crest.opening_funds_schedule_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_funds_integrity ON crest.opening_funds_schedule_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);


ALTER TABLE crest.opening_funds_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_funds_origins FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_funds_origins_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_funds_origins
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_funds_origins TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_funds_origins TO crest_finance_integrity_owner;
CREATE POLICY opening_funds_origins_review ON crest.opening_funds_origins FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_funds_origins_append ON crest.opening_funds_origins FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_funds_origins_integrity ON crest.opening_funds_origins FOR SELECT TO crest_finance_integrity_owner USING(true);

ALTER TABLE crest.opening_funds_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_funds_items FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_funds_items_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_funds_items
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_funds_items TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_funds_items TO crest_finance_integrity_owner;
CREATE POLICY opening_funds_items_review ON crest.opening_funds_items FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_funds_items_append ON crest.opening_funds_items FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY opening_funds_items_integrity ON crest.opening_funds_items FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE POLICY opening_funds_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.opening_funds.save','finance.opening_funds.retire'));
CREATE POLICY opening_funds_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_funds.save','finance.opening_funds.retire')
  AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_funds_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_funds.save','finance.opening_funds.retire') AND state='pending')
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_funds.save','finance.opening_funds.retire') AND state='committed');
CREATE POLICY opening_funds_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='opening_funds_schedule_revisions' AND action='review' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_funds_retire_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.id=audit_events.entity_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.opening_funds.retire' AND o.state='pending'));
CREATE POLICY opening_funds_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.opening_funds.save');
CREATE POLICY opening_funds_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='opening_funds_schedule_revisions');

CREATE FUNCTION crest_private.opening_funds_receipt(saved crest.opening_funds_schedule_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',saved.business_id,'scheduleRevisionId',saved.id,
  'worksheetRevisionId',saved.worksheet_revision_id,'revision',saved.revision::text,'operationId',saved.operation_id,
  'auditEventId',saved.audit_event_id,'recordedBy',saved.recorded_by,
  'recordedAt',to_char(saved.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidenceSha256',saved.evidence_sha256,'evidence',saved.evidence)
$receipt$;

CREATE FUNCTION crest_private.check_opening_funds_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.opening_funds_schedule_revisions;
BEGIN
 IF NEW.prior_revision IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM crest.opening_funds_schedule_revisions p
  WHERE p.business_id=NEW.business_id AND p.worksheet_revision_id=NEW.worksheet_revision_id AND p.revision=NEW.prior_revision;
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON a.business_id=o.business_id AND a.operation_id=o.operation_id AND a.actor_id=o.actor_id
   WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.recorded_by
    AND o.command_type='finance.opening_funds.save' AND o.state='committed' AND o.result_schema_version=1
    AND o.result=crest_private.opening_funds_receipt(NEW)
    AND a.id=NEW.audit_event_id AND a.entity_id=NEW.id AND a.entity_version=NEW.revision
    AND a.entity_kind='opening_funds_schedule_revisions' AND a.action='review' AND a.reason=NEW.evidence->>'reason'
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',
     CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_funds_receipt(previous) END,'after',o.result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_funds_audited AFTER INSERT ON crest.opening_funds_schedule_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_funds_history();


CREATE FUNCTION crest_private.check_opening_funds_identity_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
BEGIN
 IF TG_TABLE_NAME='opening_funds_origins' THEN
  IF NOT EXISTS(SELECT FROM crest.opening_funds_schedule_revisions s CROSS JOIN LATERAL jsonb_array_elements(s.evidence->'roots') root
   WHERE s.business_id=NEW.business_id AND s.operation_id=NEW.operation_id AND s.recorded_by=NEW.recorded_by
    AND root->>'rootId'=NEW.id::text AND root->>'sourceNamespace'=NEW.source_namespace AND root->>'externalId'=NEW.external_id)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_ORIGIN_AUDIT_REQUIRED'; END IF;
 ELSE
  IF NOT EXISTS(SELECT FROM crest.opening_funds_schedule_revisions s CROSS JOIN LATERAL jsonb_array_elements(s.evidence->'roots') root
   CROSS JOIN LATERAL jsonb_array_elements(root->'items') item
   WHERE s.business_id=NEW.business_id AND s.operation_id=NEW.operation_id AND s.recorded_by=NEW.recorded_by
    AND root->>'rootId'=NEW.origin_id::text AND item->>'itemId'=NEW.id::text AND item->>'customerId'=NEW.customer_id::text)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_ITEM_AUDIT_REQUIRED'; END IF;
 END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_funds_origins_audited AFTER INSERT ON crest.opening_funds_origins
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_funds_identity_history();
CREATE CONSTRAINT TRIGGER opening_funds_items_audited AFTER INSERT ON crest.opening_funds_items
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_funds_identity_history();

CREATE FUNCTION crest_private.opening_funds_date(input jsonb) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp SET datestyle='ISO, YMD' AS $date$
DECLARE stamp date;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'string' OR input#>>'{}'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_DATE_REQUIRED'; END IF;
 stamp:=(input#>>'{}')::date;
 IF stamp NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' OR to_char(stamp,'YYYY-MM-DD')<>input#>>'{}'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_DATE_REQUIRED'; END IF;
 RETURN stamp;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_DATE_REQUIRED';
END $date$;

CREATE FUNCTION crest_private.opening_funds_cents(input jsonb,positive boolean DEFAULT false) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $cents$
DECLARE amount numeric;
BEGIN
 IF jsonb_typeof(input) IS DISTINCT FROM 'string' OR input#>>'{}'!~'^(0|[1-9][0-9]{0,18})$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_AMOUNT_REQUIRED'; END IF;
 amount:=(input#>>'{}')::numeric;
 IF amount>9223372036854775807 OR (positive AND amount=0)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_AMOUNT_REQUIRED'; END IF;
 RETURN amount;
END $cents$;

CREATE FUNCTION crest_private.opening_funds_evidence(business uuid,cutover date,lines jsonb,reason text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $evidence$
DECLARE root jsonb; reduction jsonb; item jsonb; received date; occurred date;
 received_amount numeric; removed numeric; root_held numeric; root_refundable numeric; amount numeric; ceiling numeric;
 held numeric:=0; refundable numeric:=0; root_known boolean; all_known boolean:=true; item_count integer:=0;
 root_ids text[]:='{}'; origins jsonb:='[]'; item_ids text[]:='{}'; refs text[];
 reviewed jsonb:='[]'; items jsonb;
 root_keys text[]:=ARRAY['rootId','sourceNamespace','externalId','receivedOn','receivedCents','receiptEvidence','reductions','items'];
 reduction_keys text[]:=ARRAY['kind','reference','occurredOn','amountCents','evidence'];
 item_keys text[]:=ARRAY['itemId','customerId','heldCents','obligationEvidence','refundableCeilingCents','refundEvidence'];
 uuid_pattern text:='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR octet_length(lines::text)>1048576
  OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
 IF jsonb_array_length(lines)>200 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
 FOR root IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(root)<>'object' OR NOT root?&root_keys OR root-root_keys<>'{}'
   OR jsonb_typeof(root->'rootId') IS DISTINCT FROM 'string' OR root->>'rootId'!~uuid_pattern
   OR jsonb_typeof(root->'sourceNamespace') IS DISTINCT FROM 'string' OR root->>'sourceNamespace'!~'^[a-z][a-z0-9_.-]{0,99}$'
   OR NOT crest_private.opening_worksheet_note(root->'externalId') OR length(root->>'externalId')>200
   OR NOT crest_private.opening_worksheet_document(root->'receiptEvidence')
   OR jsonb_typeof(root->'reductions') IS DISTINCT FROM 'array' OR jsonb_typeof(root->'items') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
  IF root->>'rootId'=ANY(root_ids) OR origins @> jsonb_build_array(jsonb_build_array(root->>'sourceNamespace',root->>'externalId'))
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_FUNDS_DUPLICATE_ORIGIN'; END IF;
  root_ids:=array_append(root_ids,root->>'rootId');origins:=origins||jsonb_build_array(jsonb_build_array(root->>'sourceNamespace',root->>'externalId'));
  received:=crest_private.opening_funds_date(root->'receivedOn');
  IF received>=cutover THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_DATE_REQUIRED'; END IF;
  received_amount:=crest_private.opening_funds_cents(root->'receivedCents',true);removed:=0;root_held:=0;root_refundable:=0;root_known:=true;refs:='{}';items:='[]';
  IF jsonb_array_length(root->'reductions')>100 OR jsonb_array_length(root->'items') NOT BETWEEN 1 AND 200
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
  FOR reduction IN SELECT value FROM jsonb_array_elements(root->'reductions') LOOP
   IF jsonb_typeof(reduction)<>'object' OR NOT reduction?&reduction_keys OR reduction-reduction_keys<>'{}'
    OR coalesce(reduction->>'kind','') NOT IN ('application','refund','tip_conversion','collection_failure','noncustomer_reclassification')
    OR NOT crest_private.opening_worksheet_note(reduction->'reference') OR length(reduction->>'reference')>200
    OR NOT crest_private.opening_worksheet_document(reduction->'evidence')
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
   IF reduction->>'reference'=ANY(refs) THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_FUNDS_DUPLICATE_REDUCTION'; END IF;
   refs:=array_append(refs,reduction->>'reference');occurred:=crest_private.opening_funds_date(reduction->'occurredOn');
   IF occurred<received OR occurred>=cutover THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_DATE_REQUIRED'; END IF;
   removed:=removed+crest_private.opening_funds_cents(reduction->'amountCents',true);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(root->'items') LOOP
   IF jsonb_typeof(item)<>'object' OR NOT item?&item_keys OR item-item_keys<>'{}'
    OR jsonb_typeof(item->'itemId') IS DISTINCT FROM 'string' OR item->>'itemId'!~uuid_pattern
    OR jsonb_typeof(item->'customerId') IS DISTINCT FROM 'string' OR item->>'customerId'!~uuid_pattern
    OR NOT crest_private.opening_worksheet_document(item->'obligationEvidence')
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
   IF item->>'itemId'=ANY(item_ids) THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_FUNDS_DUPLICATE_ITEM'; END IF;
   item_ids:=array_append(item_ids,item->>'itemId');item_count:=item_count+1;
   IF item_count>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
   IF NOT EXISTS(SELECT FROM crest.customers c WHERE c.business_id=business AND c.id=(item->>'customerId')::uuid)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_CUSTOMER_REQUIRED'; END IF;
   amount:=crest_private.opening_funds_cents(item->'heldCents',true);root_held:=root_held+amount;
   IF item->'refundableCeilingCents'='null' THEN
    IF item->'refundEvidence'<>'null' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
    root_known:=false;all_known:=false;
   ELSE
    IF NOT crest_private.opening_worksheet_document(item->'refundEvidence') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
    ceiling:=crest_private.opening_funds_cents(item->'refundableCeilingCents');
    IF ceiling>amount THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_REFUND_CEILING_REQUIRED'; END IF;
    root_refundable:=root_refundable+ceiling;
   END IF;
   items:=items||jsonb_build_array(item||jsonb_build_object('refundCeilingState',CASE WHEN item->'refundableCeilingCents'='null' THEN 'needs_review' ELSE 'evidenced' END));
  END LOOP;
  IF root_held<=0 OR received_amount-removed<>root_held THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_BALANCE_REQUIRED'; END IF;
  held:=held+root_held;refundable:=refundable+root_refundable;
  reviewed:=reviewed||jsonb_build_array(root||jsonb_build_object('items',items,'heldCents',root_held::text,'openingRootCents',root_held::text,'refundableCeilingCents',CASE WHEN root_known THEN root_refundable::text END));
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'cutoverOn',to_char(cutover,'YYYY-MM-DD'),'state','evidence_prepared','posted',false,'currency','USD','reason',reason,
  'totals',jsonb_build_object('heldCents',held::text,'refundableCeilingCents',CASE WHEN all_known THEN refundable::text END,'rootCount',jsonb_array_length(reviewed),'itemCount',item_count,'allItemRefundCeilingsKnown',all_known),
  'roots',reviewed,'refundAuthorized',false,'fullSourceClosureVerified',false);
END $evidence$;

CREATE FUNCTION crest_commands.save_fictional_opening_funds_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,operation uuid,worksheet_revision bigint,expected_revision bigint,lines jsonb,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE parent crest.opening_worksheet_revisions; previous crest.opening_funds_schedule_revisions;
 stored crest.opening_funds_schedule_revisions; existing crest_private.operations; operation_row uuid;
 evidence_body jsonb; receipt jsonb; digest text; root jsonb; item jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR worksheet_revision IS NULL OR worksheet_revision<1 OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 9223372036854775806 OR jsonb_typeof(lines) IS DISTINCT FROM 'array'
  OR octet_length(lines::text)>1048576 OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_funds.save',1,business,actor,epoch,
  worksheet_revision::text,expected_revision::text,lines,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_funds.save',1,epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO operation_row;
 IF operation_row IS NULL THEN
  SELECT * INTO existing FROM crest_private.operations o
   WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
    AND o.command_type IN ('finance.opening_funds.save','finance.opening_funds.retire') AND o.state='committed';
  IF existing.command_type='finance.opening_funds.retire' THEN
   RETURN CASE WHEN existing.result->>'originalEpoch'=epoch::text THEN jsonb_build_object('state','retired')
    ELSE jsonb_build_object('state','conflict','reason','operation') END;
  END IF;
  IF NOT FOUND OR (existing.recovery_epoch,existing.payload_hash) IS DISTINCT FROM (epoch,digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',existing.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO parent FROM crest.opening_worksheet_revisions w WHERE w.business_id=business ORDER BY w.revision DESC LIMIT 1;
 IF parent.revision IS DISTINCT FROM worksheet_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;
 SELECT * INTO previous FROM crest.opening_funds_schedule_revisions p
  WHERE p.business_id=business AND p.worksheet_revision_id=parent.id ORDER BY p.revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_FUNDS_REVISION_CONFLICT'; END IF;
 evidence_body:=crest_private.opening_funds_evidence(business,parent.cutover_on,lines,reason);
 FOR root IN SELECT value FROM jsonb_array_elements(evidence_body->'roots') LOOP
  INSERT INTO crest.opening_funds_origins(id,business_id,source_namespace,external_id,operation_id,recorded_by)
   VALUES((root->>'rootId')::uuid,business,root->>'sourceNamespace',root->>'externalId',operation,actor)
   ON CONFLICT(business_id,id) DO NOTHING;
  IF NOT EXISTS(SELECT FROM crest.opening_funds_origins o WHERE o.business_id=business AND o.id=(root->>'rootId')::uuid
   AND o.source_namespace=root->>'sourceNamespace' AND o.external_id=root->>'externalId')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_ORIGIN_IDENTITY_CONFLICT'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(root->'items') LOOP
   INSERT INTO crest.opening_funds_items(id,business_id,origin_id,customer_id,operation_id,recorded_by)
    VALUES((item->>'itemId')::uuid,business,(root->>'rootId')::uuid,(item->>'customerId')::uuid,operation,actor)
    ON CONFLICT(business_id,id) DO NOTHING;
   IF NOT EXISTS(SELECT FROM crest.opening_funds_items i WHERE i.business_id=business AND i.id=(item->>'itemId')::uuid
    AND i.origin_id=(root->>'rootId')::uuid AND i.customer_id=(item->>'customerId')::uuid)
   THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_FUNDS_ITEM_IDENTITY_CONFLICT'; END IF;
  END LOOP;
 END LOOP;
 INSERT INTO crest.opening_funds_schedule_revisions(business_id,worksheet_revision_id,revision,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256)
 VALUES(business,parent.id,expected_revision+1,operation,gen_random_uuid(),actor,evidence_body,
  encode(sha256(convert_to(evidence_body::text,'UTF8')),'hex')) RETURNING * INTO stored;
 receipt:=crest_private.opening_funds_receipt(stored);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(stored.audit_event_id,business,operation,actor,actor,'opening_funds_schedule_revisions',stored.id,stored.revision,
  'review',reason,jsonb_build_object('schemaVersion',1,'before',
   CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_funds_receipt(previous) END,'after',receipt),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
  WHERE o.business_id=business AND o.operation_id=operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.lookup_fictional_opening_funds_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE existing crest_private.operations;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF operation IS NULL OR original_epoch IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED';
 END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT * INTO existing FROM crest_private.operations o
  WHERE o.business_id=business AND o.operation_id=operation AND o.actor_id=actor
   AND o.command_type IN ('finance.opening_funds.save','finance.opening_funds.retire') AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state',CASE WHEN original_epoch=review_epoch THEN 'absent' ELSE 'review_required' END); END IF;
 IF existing.command_type='finance.opening_funds.retire' THEN
  RETURN CASE WHEN existing.result->>'originalEpoch'=original_epoch::text THEN jsonb_build_object('state','retired')
   ELSE jsonb_build_object('state','conflict','reason','operation') END;
 END IF;
 IF existing.recovery_epoch<>original_epoch THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',existing.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_opening_funds_save(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,review_epoch uuid,operation uuid,original_epoch uuid,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claimed uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; existing_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 IF operation IS NULL OR original_epoch IS NULL OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_EVIDENCE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','businessId',business,
  'operationId',operation,'originalEpoch',original_epoch,'auditEventId',event_id,'reviewEpoch',review_epoch);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_funds.retire',actor,decision,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.opening_funds.retire',1,review_epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  existing_result:=crest_commands.lookup_fictional_opening_funds_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
  IF existing_result->>'state' IN ('absent','review_required') THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN existing_result;
 END IF;
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,business,operation,actor,actor,'operations',claimed,1,'retire',reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=decision
  WHERE o.business_id=business AND o.operation_id=operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 RETURN jsonb_build_object('state','retired');
END $retire$;

CREATE FUNCTION crest_commands.read_fictional_opening_funds_schedule(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,worksheet bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE parent_id uuid; saved crest.opening_funds_schedule_revisions;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true);
 SELECT id INTO parent_id FROM crest.opening_worksheet_revisions w WHERE w.business_id=business AND w.revision=worksheet;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;
 SELECT * INTO saved FROM crest.opening_funds_schedule_revisions r
  WHERE r.business_id=business AND r.worksheet_revision_id=parent_id ORDER BY r.revision DESC LIMIT 1;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',business,'worksheetRevisionId',parent_id,
  'schedule',CASE WHEN saved.id IS NOT NULL THEN crest_private.opening_funds_receipt(saved) END);
END $read$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_funds_history() OWNER TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_funds_identity_history() OWNER TO crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_funds_identity_history() FROM PUBLIC;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_funds_history(),crest_private.opening_funds_date(jsonb),
 crest_private.opening_funds_cents(jsonb,boolean),crest_private.opening_funds_evidence(uuid,date,jsonb,text),
 crest_private.opening_funds_receipt(crest.opening_funds_schedule_revisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_funds_date(jsonb),crest_private.opening_funds_cents(jsonb,boolean),
 crest_private.opening_funds_evidence(uuid,date,jsonb,text) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.opening_funds_receipt(crest.opening_funds_schedule_revisions)
 TO crest_finance_account_owner,crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_funds_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_funds_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_funds_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)
 OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_funds_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint)
 OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION
 crest_commands.save_fictional_opening_funds_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_funds_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_funds_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_funds_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
 crest_commands.save_fictional_opening_funds_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,bigint,jsonb,text),
 crest_commands.lookup_fictional_opening_funds_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_funds_save(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_fictional_opening_funds_schedule(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;


SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.opening_funds_origins TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_funds_origins_export ON crest.opening_funds_origins FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT SELECT ON crest.opening_funds_items TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_funds_items_export ON crest.opening_funds_items FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT SELECT ON crest.opening_funds_schedule_revisions TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_funds_schedule_revisions_export ON crest.opening_funds_schedule_revisions FOR SELECT TO crest_opening_worksheet_export_owner
 USING(business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
GRANT EXECUTE ON FUNCTION crest_private.opening_funds_receipt(crest.opening_funds_schedule_revisions) TO crest_opening_worksheet_export_owner;
CREATE FUNCTION crest_commands.opening_funds_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE origins jsonb; items jsonb; revisions jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_FUNDS_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_FUNDS_SOURCE_BUSINESS_REQUIRED'; END IF;
 PERFORM set_config('crest.opening_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO origins
  FROM(SELECT * FROM crest.opening_funds_origins WHERE business_id=requested_business ORDER BY id LIMIT 20001) r;
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]') INTO items
  FROM(SELECT * FROM crest.opening_funds_items WHERE business_id=requested_business ORDER BY id LIMIT 100001) r;
 SELECT coalesce(jsonb_agg(jsonb_build_object('row',to_jsonb(r),'receipt',crest_private.opening_funds_receipt(r),'evidenceText',r.evidence::text)
  ORDER BY r.worksheet_revision_id,r.revision),'[]') INTO revisions
  FROM(SELECT * FROM crest.opening_funds_schedule_revisions WHERE business_id=requested_business ORDER BY worksheet_revision_id,revision LIMIT 101) r;
 snapshot:=jsonb_build_object('schemaVersion',1,'profile','crest.opening-funds-source-candidate.v1','catalogRegistered',false,
  'businessId',requested_business,'origins',origins,'items',items,'revisions',revisions,'completeBusinessExport',false);
 IF jsonb_array_length(origins)>20000 OR jsonb_array_length(items)>100000 OR jsonb_array_length(revisions)>100 OR octet_length(snapshot::text)>33554432 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='OPENING_FUNDS_SOURCE_LIMIT'; END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_funds_source_snapshot(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_funds_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_funds_source_snapshot(uuid) TO crest_export;
