-- Registered fictional opening worksheet. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-opening-worksheet.sql
-- Held synthetic P27 worksheet. No ledger, money, period, or activation changes.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.opening_worksheet_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id),
 revision bigint NOT NULL CHECK (revision>0),
 prior_revision bigint GENERATED ALWAYS AS (nullif(revision-1,0)) STORED,
 cutover_on date NOT NULL,
 cutover_at timestamptz NOT NULL CHECK (isfinite(cutover_at)),
 time_zone text NOT NULL,
 operation_id uuid NOT NULL,
 audit_event_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 evidence_sha256 text NOT NULL CHECK (evidence_sha256=encode(sha256(convert_to(evidence::text,'UTF8')),'hex')),
 UNIQUE(business_id,id), UNIQUE(business_id,revision),
 UNIQUE(business_id,operation_id), UNIQUE(business_id,audit_event_id),
 FOREIGN KEY (business_id,prior_revision) REFERENCES crest.opening_worksheet_revisions(business_id,revision),
 FOREIGN KEY (business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 FOREIGN KEY (business_id,audit_event_id) REFERENCES crest_private.audit_events(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK (cutover_at AT TIME ZONE time_zone = cutover_on::timestamp)
);

ALTER TABLE crest.opening_worksheet_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.opening_worksheet_revisions FORCE ROW LEVEL SECURITY;
CREATE TRIGGER opening_worksheet_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.opening_worksheet_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT,INSERT ON crest.opening_worksheet_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.opening_worksheet_revisions TO crest_finance_integrity_owner;
CREATE POLICY opening_worksheet_read ON crest.opening_worksheet_revisions FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY opening_worksheet_integrity_read ON crest.opening_worksheet_revisions FOR SELECT TO crest_finance_integrity_owner USING (true);
CREATE POLICY opening_worksheet_append ON crest.opening_worksheet_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
   AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
   AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);

CREATE POLICY opening_worksheet_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire'));
CREATE POLICY opening_worksheet_operation_claim ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') AND schema_version=1 AND state='pending'
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_worksheet_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') AND state='pending')
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') AND state='committed');
CREATE POLICY opening_worksheet_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='opening_worksheet_revisions' AND action='review' AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY opening_worksheet_retire_audit ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK (business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND entity_kind='operations' AND action='retire' AND entity_version=1 AND reason IS NOT NULL
  AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.id=audit_events.entity_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.opening_worksheet.retire' AND o.state='pending'));
CREATE POLICY opening_worksheet_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING (command_type='finance.opening_worksheet.save');
CREATE POLICY opening_worksheet_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING (entity_kind='opening_worksheet_revisions');

CREATE FUNCTION crest_private.opening_worksheet_document(document jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $document$
 SELECT coalesce(jsonb_typeof(document)='object'
  AND document?&ARRAY['reference','sha256'] AND document-ARRAY['reference','sha256']='{}'
  AND jsonb_typeof(document->'reference')='string'
  AND length(document->>'reference') BETWEEN 1 AND 200
  AND btrim(document->>'reference')=document->>'reference' AND document->>'reference'!~'[[:cntrl:]]'
  AND jsonb_typeof(document->'sha256')='string' AND document->>'sha256'~'^[a-f0-9]{64}$',false)
$document$;

CREATE FUNCTION crest_private.opening_worksheet_note(note jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $note$
 SELECT coalesce(jsonb_typeof(note)='string' AND length(note#>>'{}') BETWEEN 1 AND 1000
  AND btrim(note#>>'{}')=note#>>'{}' AND note#>>'{}'!~'[[:cntrl:]]',false)
$note$;

CREATE FUNCTION crest_private.opening_worksheet_banks(business uuid, boundary date)
RETURNS TABLE(channel_id uuid,channel_version bigint,channel_version_id uuid,account_id uuid,account_code text,label text,masked_suffix text)
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $banks$
 SELECT v.channel_id,v.version,v.id,a.id,a.code,v.label,v.masked_suffix
 FROM (
   SELECT DISTINCT ON (c.channel_id) c.* FROM crest.money_channel_versions c
   WHERE c.business_id=business AND c.effective_from<=boundary
   ORDER BY c.channel_id,c.effective_from DESC
 ) v JOIN crest.accounts a ON (a.business_id,a.id)=(v.business_id,v.account_id)
 WHERE v.active AND v.kind='bank' AND v.ownership_scope='dedicated_business'
   AND crest_private.money_channel_account_matches(v.kind,v.ownership_scope,a)
   AND (SELECT av.active FROM crest.account_versions av
    WHERE (av.business_id,av.account_id)=(a.business_id,a.id) ORDER BY av.version DESC LIMIT 1)
$banks$;

CREATE FUNCTION crest_private.opening_worksheet_receipt(saved crest.opening_worksheet_revisions)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT saved.evidence||jsonb_build_object('schemaVersion',1,'businessId',saved.business_id,
  'worksheetRevisionId',saved.id,'revision',saved.revision::text,'operationId',saved.operation_id,
  'auditEventId',saved.audit_event_id,'recordedBy',saved.recorded_by,
  'recordedAt',to_char(saved.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidenceSha256',saved.evidence_sha256)
$receipt$;

CREATE FUNCTION crest_private.check_opening_worksheet_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE previous crest.opening_worksheet_revisions;
BEGIN
 IF NEW.prior_revision IS NOT NULL THEN
  SELECT * INTO STRICT previous FROM crest.opening_worksheet_revisions p
   WHERE (p.business_id,p.revision)=(NEW.business_id,NEW.prior_revision);
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.recorded_by)
   AND o.command_type='finance.opening_worksheet.save' AND o.state='committed' AND o.result_schema_version=1
   AND o.result=crest_private.opening_worksheet_receipt(NEW)
   AND (a.id,a.entity_id,a.entity_version)=(NEW.audit_event_id,NEW.id,NEW.revision)
   AND a.entity_kind='opening_worksheet_revisions' AND a.action='review' AND a.reason=NEW.evidence->>'equityBasis'
   AND a.delta=jsonb_build_object('schemaVersion',1,
    'before',CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_worksheet_receipt(previous) END,
    'after',o.result))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_WORKSHEET_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
CREATE CONSTRAINT TRIGGER opening_worksheet_audited AFTER INSERT ON crest.opening_worksheet_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_opening_worksheet_audit();

CREATE FUNCTION crest_commands.save_fictional_opening_worksheet(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,
 expected_epoch uuid,requested_operation uuid,expected_revision bigint,body jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $save$
<<worksheet_save>>
DECLARE
 keys text[]:=ARRAY['cutoverOn','cutoverAt','source','equityBasis','banks','controls'];
 control_keys text[]:=ARRAY['receivables','customerFunds','supplierPayables','taxLiabilities','otherLiabilities','cashAndChecks','wallets','otherAssets'];
 control_fields text[]:=ARRAY['state','evidence','note'];
 bank_fields text[]:=ARRAY['channelId','channelVersion','state','statementCents','bookCents','evidence','timing','note'];
 cent_format text:='^(0|-?[1-9][0-9]{0,17})$';
 auth jsonb; zone text; boundary date; instant timestamptz;
 bank jsonb; timing jsonb; control jsonb; eligible record; selection jsonb;
 bank_net numeric:=0; debit_total numeric:=0; credit_total numeric:=0; statement_amount numeric; book_amount numeric; differences numeric;
 unknown boolean:=false; bank_rows jsonb:='[]'; timing_rows jsonb; all_timing jsonb:='[]';
 previous crest.opening_worksheet_revisions; fresh crest.opening_worksheet_revisions;
 digest text; claimed uuid; prior_operation crest_private.operations; result jsonb; worksheet jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF requested_operation IS NULL OR expected_revision IS NULL OR expected_revision NOT BETWEEN 0 AND 9223372036854775806
  OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT body?&keys OR body-keys<>'{}' OR octet_length(body::text)>24000
  OR jsonb_typeof(body->'cutoverOn') IS DISTINCT FROM 'string' OR body->>'cutoverOn'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR jsonb_typeof(body->'cutoverAt') IS DISTINCT FROM 'string' OR body->>'cutoverAt'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
  OR NOT crest_private.opening_worksheet_document(body->'source') OR NOT crest_private.opening_worksheet_note(body->'equityBasis')
  OR jsonb_typeof(body->'banks') IS DISTINCT FROM 'array' OR jsonb_typeof(body->'controls') IS DISTINCT FROM 'object'
  OR NOT (body->'controls')?&control_keys OR (body->'controls')-control_keys<>'{}'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_INPUT_REQUIRED'; END IF;
 IF jsonb_array_length(body->'banks')>30
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_INPUT_REQUIRED'; END IF;
 boundary:=(body->>'cutoverOn')::date;
 instant:=(body->>'cutoverAt')::timestamptz;
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 IF instant AT TIME ZONE zone IS DISTINCT FROM boundary::timestamp
  OR to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') IS DISTINCT FROM body->>'cutoverAt'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_BOUNDARY_REQUIRED'; END IF;

 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_worksheet.save',1,requested_business,
  expected_actor,expected_epoch,expected_revision::text,body)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.opening_worksheet.save',1,expected_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT * INTO prior_operation FROM crest_private.operations o
   WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
    AND o.command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') AND o.state='committed';
  IF prior_operation.command_type='finance.opening_worksheet.retire' THEN
   RETURN CASE WHEN prior_operation.result->>'originalEpoch'=expected_epoch::text
    THEN jsonb_build_object('state','retired') ELSE jsonb_build_object('state','conflict','reason','operation') END;
  END IF;
  IF NOT FOUND OR (prior_operation.recovery_epoch,prior_operation.payload_hash) IS DISTINCT FROM (expected_epoch,digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',prior_operation.result);
 END IF;

 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 SELECT * INTO previous FROM crest.opening_worksheet_revisions p
  WHERE p.business_id=requested_business ORDER BY p.revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='OPENING_WORKSHEET_REVISION_CONFLICT'; END IF;

 FOR control IN SELECT value FROM jsonb_each(body->'controls') LOOP
  IF jsonb_typeof(control)<>'object' OR NOT control?&control_fields OR control-control_fields<>'{}'
   OR coalesce(control->>'state','') NOT IN ('unknown','verified_zero','not_applicable')
   OR NOT crest_private.opening_worksheet_note(control->'note')
   OR (control->>'state'='unknown' AND control->'evidence'<>'null')
   OR (control->>'state'<>'unknown' AND NOT crest_private.opening_worksheet_document(control->'evidence'))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_CONTROL_EVIDENCE_REQUIRED'; END IF;
  unknown:=unknown OR control->>'state'='unknown';
 END LOOP;

 FOR bank IN SELECT value FROM jsonb_array_elements(body->'banks') ORDER BY value->>'channelId' LOOP
  IF jsonb_typeof(bank)<>'object' OR NOT bank?&bank_fields OR bank-bank_fields<>'{}'
   OR jsonb_typeof(bank->'channelId') IS DISTINCT FROM 'string'
   OR bank->>'channelId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(bank->'channelVersion') IS DISTINCT FROM 'string' OR bank->>'channelVersion'!~'^[1-9][0-9]{0,18}$'
   OR coalesce(bank->>'state','') NOT IN ('verified','verified_zero','unknown')
   OR NOT crest_private.opening_worksheet_note(bank->'note') OR jsonb_typeof(bank->'timing') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_INPUT_REQUIRED'; END IF;
  IF jsonb_array_length(bank->'timing')>40
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_INPUT_REQUIRED'; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(bank_rows) v WHERE v->>'channelId'=bank->>'channelId')
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_WORKSHEET_DUPLICATE_BANK'; END IF;
  SELECT * INTO eligible FROM crest_private.opening_worksheet_banks(requested_business,boundary) b
   WHERE b.channel_id=(bank->>'channelId')::uuid AND b.channel_version::text=bank->>'channelVersion';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_WORKSHEET_BANK_REQUIRED'; END IF;
  IF EXISTS (SELECT FROM jsonb_array_elements(bank_rows) v WHERE v->>'accountId'=eligible.account_id::text)
  THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_WORKSHEET_DUPLICATE_BANK'; END IF;
  selection:=jsonb_build_object('accountId',eligible.account_id,'accountCode',eligible.account_code,
   'channelVersionId',eligible.channel_version_id,'label',eligible.label,'maskedSuffix',eligible.masked_suffix);
  IF bank->>'state'='unknown' THEN
   IF bank->'statementCents'<>'null' OR bank->'bookCents'<>'null' OR bank->'evidence'<>'null' OR bank->'timing'<>'[]'
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_BANK_UNKNOWN_AMOUNTS'; END IF;
   unknown:=true;
   bank_rows:=bank_rows||jsonb_build_array(bank||selection);
   CONTINUE;
  END IF;
  IF NOT crest_private.opening_worksheet_document(bank->'evidence')
   OR jsonb_typeof(bank->'statementCents') IS DISTINCT FROM 'string' OR bank->>'statementCents'!~cent_format
   OR jsonb_typeof(bank->'bookCents') IS DISTINCT FROM 'string' OR bank->>'bookCents'!~cent_format
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_BANK_EVIDENCE_REQUIRED'; END IF;
  statement_amount:=(bank->>'statementCents')::numeric;
  book_amount:=(bank->>'bookCents')::numeric;
  differences:=0;
  timing_rows:='[]';
  FOR timing IN SELECT value FROM jsonb_array_elements(bank->'timing') ORDER BY value->>'reference' COLLATE "C",value->>'sha256' LOOP
   IF NOT crest_private.opening_worksheet_document(timing-'cents') OR jsonb_typeof(timing->'cents') IS DISTINCT FROM 'string'
    OR timing->>'cents'!~cent_format OR timing->>'cents'='0'
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_TIMING_EVIDENCE_REQUIRED'; END IF;
   IF all_timing @> jsonb_build_array(timing-'cents')
   THEN RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='OPENING_WORKSHEET_DUPLICATE_TIMING'; END IF;
   all_timing:=all_timing||jsonb_build_array(timing-'cents');
   timing_rows:=timing_rows||jsonb_build_array(timing);
   differences:=differences+(timing->>'cents')::numeric;
  END LOOP;
  IF book_amount<>statement_amount+differences OR (book_amount=0)<>(bank->>'state'='verified_zero')
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_WORKSHEET_BANK_BRIDGE_REQUIRED'; END IF;
  bank_net:=bank_net+book_amount;
  debit_total:=debit_total+greatest(book_amount,0);
  credit_total:=credit_total+greatest(-book_amount,0);
  bank_rows:=bank_rows||jsonb_build_array(bank||selection||jsonb_build_object('timing',timing_rows));
 END LOOP;
 IF (SELECT count(*) FROM crest_private.opening_worksheet_banks(requested_business,boundary))<>jsonb_array_length(bank_rows)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='OPENING_WORKSHEET_BANK_INVENTORY_REQUIRED'; END IF;
 debit_total:=debit_total+greatest(-bank_net,0);
 credit_total:=credit_total+greatest(bank_net,0);
 worksheet:=jsonb_build_object('cutoverOn',body->>'cutoverOn','cutoverAt',body->>'cutoverAt','timeZone',zone,
  'source',body->'source','equityBasis',body->>'equityBasis','banks',bank_rows,'controls',body->'controls','currency','USD',
  'state',CASE WHEN unknown THEN 'incomplete' ELSE 'balanced_evidence_only' END,'posted',false,
  'bankNetCents',bank_net::text,'provisionalEquityCents',bank_net::text,'provisionalEquityAccountCode','3000',
  'debitCents',debit_total::text,'creditCents',credit_total::text,'profitAndLossCents','0');
 INSERT INTO crest.opening_worksheet_revisions(business_id,revision,cutover_on,cutover_at,time_zone,operation_id,audit_event_id,recorded_by,evidence,evidence_sha256)
 VALUES(requested_business,expected_revision+1,boundary,instant,zone,requested_operation,gen_random_uuid(),expected_actor,worksheet,encode(sha256(convert_to(worksheet::text,'UTF8')),'hex'))
 RETURNING * INTO fresh;
 result:=crest_private.opening_worksheet_receipt(fresh);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(fresh.audit_event_id,requested_business,requested_operation,expected_actor,expected_actor,'opening_worksheet_revisions',fresh.id,
  fresh.revision,'review',body->>'equityBasis',jsonb_build_object('schemaVersion',1,
    'before',CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_worksheet_receipt(previous) END,'after',result),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=worksheet_save.result
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',result);
END $save$;

CREATE FUNCTION crest_commands.read_fictional_opening_worksheet(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_on date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on AS $read$
DECLARE auth jsonb; zone text; boundary date; instant timestamptz; previous crest.opening_worksheet_revisions; banks jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 zone:=auth->>'timezone';
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true);
 SELECT * INTO previous FROM crest.opening_worksheet_revisions p
  WHERE p.business_id=requested_business ORDER BY p.revision DESC LIMIT 1;
 boundary:=coalesce(requested_on,previous.cutover_on);
 IF boundary IS NOT NULL AND boundary NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_BOUNDARY_REQUIRED'; END IF;
 IF requested_on IS NULL AND previous.id IS NOT NULL THEN
  zone:=previous.time_zone;
  instant:=previous.cutover_at;
 ELSE
  instant:=boundary::timestamp AT TIME ZONE zone;
 END IF;
 IF boundary IS NOT NULL AND instant AT TIME ZONE zone IS DISTINCT FROM boundary::timestamp
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_BOUNDARY_REQUIRED'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('channelId',v.channel_id,'channelVersion',v.channel_version::text,
  'accountCode',v.account_code,'label',v.label,'maskedSuffix',v.masked_suffix) ORDER BY v.account_code COLLATE "C"),'[]') INTO banks
 FROM crest_private.opening_worksheet_banks(requested_business,boundary) v;
 RETURN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'timeZone',zone,
  'cutoverOn',to_char(boundary,'YYYY-MM-DD'),'cutoverAt',to_char(instant AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'banks',banks,'worksheet',CASE WHEN previous.id IS NOT NULL THEN crest_private.opening_worksheet_receipt(previous) END);
END $read$;

CREATE FUNCTION crest_commands.lookup_fictional_opening_worksheet_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,review_epoch uuid,
 requested_operation uuid,original_epoch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE original crest_private.operations;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF requested_operation IS NULL OR original_epoch IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_INPUT_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 SELECT * INTO original FROM crest_private.operations o
 WHERE (o.business_id,o.operation_id,o.actor_id)=(requested_business,requested_operation,expected_actor)
  AND o.command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') AND o.state='committed';
 IF NOT FOUND THEN
  RETURN jsonb_build_object('state',CASE WHEN original_epoch=review_epoch THEN 'absent' ELSE 'review_required' END);
 END IF;
 IF original.command_type='finance.opening_worksheet.retire' THEN
  IF original.result->>'originalEpoch' IS DISTINCT FROM original_epoch::text THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','retired');
 END IF;
 IF original.recovery_epoch IS DISTINCT FROM original_epoch
 THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 RETURN jsonb_build_object('state','committed','receipt',original.result);
END $lookup$;

CREATE FUNCTION crest_commands.retire_fictional_opening_worksheet_operation(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,review_epoch uuid,
 requested_operation uuid,original_epoch uuid,reason text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $retire$
DECLARE claimed uuid; event_id uuid:=gen_random_uuid(); decision jsonb; digest text; prior_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_financial_retirement_authority($1,$2,$3,$4,$5,$6,$7,$8,$9);
 IF requested_operation IS NULL OR original_epoch IS NULL OR NOT crest_private.opening_worksheet_note(to_jsonb(reason))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_INPUT_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','businessId',requested_business,
  'operationId',requested_operation,'originalEpoch',original_epoch,'auditEventId',event_id,'reviewEpoch',review_epoch);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.opening_worksheet.retire',expected_actor,decision,reason)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.opening_worksheet.retire',1,review_epoch,digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  prior_result:=crest_commands.lookup_fictional_opening_worksheet_operation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
  IF prior_result->>'state' IN ('absent','review_required') THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN prior_result;
 END IF;
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(event_id,requested_business,requested_operation,expected_actor,expected_actor,'operations',claimed,1,'retire',reason,
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',decision),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision
 WHERE business_id=requested_business AND operation_id=requested_operation;
 PERFORM crest_commands.finish_financial_retirement_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 RETURN jsonb_build_object('state','retired');
END $retire$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_opening_worksheet_audit() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_opening_worksheet_audit(),
 crest_private.opening_worksheet_document(jsonb),crest_private.opening_worksheet_note(jsonb),
 crest_private.opening_worksheet_banks(uuid,date),crest_private.opening_worksheet_receipt(crest.opening_worksheet_revisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.opening_worksheet_document(jsonb),crest_private.opening_worksheet_note(jsonb),
 crest_private.opening_worksheet_banks(uuid,date),crest_private.opening_worksheet_receipt(crest.opening_worksheet_revisions) TO crest_finance_account_owner;
GRANT EXECUTE ON FUNCTION crest_private.opening_worksheet_receipt(crest.opening_worksheet_revisions) TO crest_finance_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.save_fictional_opening_worksheet(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.read_fictional_opening_worksheet(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.lookup_fictional_opening_worksheet_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_finance_account_owner;
ALTER FUNCTION crest_commands.retire_fictional_opening_worksheet_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) OWNER TO crest_finance_account_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.save_fictional_opening_worksheet(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.read_fictional_opening_worksheet(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date),
 crest_commands.lookup_fictional_opening_worksheet_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_worksheet_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_fictional_opening_worksheet(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,jsonb),
 crest_commands.read_fictional_opening_worksheet(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,date),
 crest_commands.lookup_fictional_opening_worksheet_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid),
 crest_commands.retire_fictional_opening_worksheet_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-opening-worksheet.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-opening-worksheet-source.sql
-- Export-only complete worksheet revisions and their original operation/audit history.
CREATE ROLE crest_opening_worksheet_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_opening_worksheet_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_opening_worksheet_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,
 state,result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id)
 ON crest_private.operations TO crest_opening_worksheet_export_owner;
GRANT SELECT(id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,
 effective_at,delta,created_at,recorded_at,created_by,origin,import_row_id,database_principal,payload,hash_input,event_hash)
 ON crest_private.audit_events TO crest_opening_worksheet_export_owner;
GRANT SELECT ON crest.opening_worksheet_revisions TO crest_opening_worksheet_export_owner;
CREATE POLICY opening_worksheet_export ON crest.opening_worksheet_revisions FOR SELECT TO crest_opening_worksheet_export_owner
 USING (business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid);
CREATE POLICY opening_worksheet_export_operations ON crest_private.operations FOR SELECT TO crest_opening_worksheet_export_owner
 USING (business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid
  AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire'));
CREATE POLICY opening_worksheet_export_audit ON crest_private.audit_events FOR SELECT TO crest_opening_worksheet_export_owner
 USING (business_id=nullif(current_setting('crest.opening_export_business_id',true),'')::uuid AND
  EXISTS (SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire')));

CREATE FUNCTION crest_commands.opening_worksheet_source_snapshot(requested_business uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE revisions jsonb; operations jsonb; audits jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='OPENING_WORKSHEET_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_SOURCE_BUSINESS_REQUIRED';
 END IF;
 PERFORM set_config('crest.opening_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'businessId',w.business_id,
  'revision',w.revision::text,'priorRevision',w.prior_revision::text,'cutoverOn',to_char(w.cutover_on,'YYYY-MM-DD'),
  'cutoverAt',to_char(w.cutover_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),'timeZone',w.time_zone,'operationId',w.operation_id,
  'auditEventId',w.audit_event_id,'recordedBy',w.recorded_by,'recordedAt',to_char(w.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'evidence',w.evidence::text,'evidenceSha256',w.evidence_sha256) ORDER BY w.revision),'[]') INTO revisions
 FROM (SELECT * FROM crest.opening_worksheet_revisions WHERE business_id=requested_business ORDER BY revision LIMIT 101) w;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'businessId',o.business_id,'operationId',o.operation_id,'actorId',o.actor_id,
  'commandType',o.command_type,'schemaVersion',o.schema_version,'recoveryEpoch',o.recovery_epoch,'payloadHash',o.payload_hash,
  'state',o.state,'resultSchemaVersion',o.result_schema_version,'result',o.result::text,
  'committedAt',to_char(o.committed_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'createdAt',to_char(o.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'createdBy',o.created_by,'origin',o.origin,'importRowId',o.import_row_id) ORDER BY o.operation_id),'[]') INTO operations
 FROM (SELECT id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,
  result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id
  FROM crest_private.operations WHERE business_id=requested_business
   AND command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire') ORDER BY operation_id LIMIT 201) o;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'businessId',a.business_id,'operationId',a.operation_id,'actorId',a.actor_id,
  'entityKind',a.entity_kind,'entityId',a.entity_id,'entityVersion',a.entity_version::text,'action',a.action,'reason',a.reason,
  'effectiveAt',to_char(a.effective_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'delta',a.delta::text,
  'createdAt',to_char(a.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recordedAt',to_char(a.recorded_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'createdBy',a.created_by,
  'origin',a.origin,'importRowId',a.import_row_id,'databasePrincipal',a.database_principal,
  'payload',a.payload::text,'hashInput',a.hash_input,'eventHash',a.event_hash) ORDER BY a.operation_id),'[]') INTO audits
 FROM (SELECT id,business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,reason,effective_at,
  delta,created_at,recorded_at,created_by,origin,import_row_id,database_principal,payload,hash_input,event_hash
  FROM crest_private.audit_events a WHERE a.business_id=requested_business AND EXISTS (
   SELECT FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=(a.business_id,a.operation_id,a.actor_id)
    AND o.command_type IN ('finance.opening_worksheet.save','finance.opening_worksheet.retire'))
  ORDER BY a.operation_id LIMIT 201) a;
 snapshot:=jsonb_build_object('schemaVersion',1,'scope','opening_worksheet_source','businessId',requested_business,
  'revisions',revisions,'operations',operations,'audits',audits);
 IF jsonb_array_length(revisions)>100 OR jsonb_array_length(operations)>200 OR jsonb_array_length(audits)>200
  OR octet_length(snapshot::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='OPENING_WORKSHEET_SOURCE_LIMIT';
 END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_opening_worksheet_export_owner;
ALTER FUNCTION crest_commands.opening_worksheet_source_snapshot(uuid) OWNER TO crest_opening_worksheet_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_opening_worksheet_export_owner;
REVOKE ALL ON FUNCTION crest_commands.opening_worksheet_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.opening_worksheet_source_snapshot(uuid) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-opening-worksheet-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-opening-worksheet-export-access.sql
-- The registered schema 102 handoff adds the worksheet-bearing ZIP profile.
-- Keep the audited download provenance aligned with the source profile.
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-opening-worksheet-export-access.sql
