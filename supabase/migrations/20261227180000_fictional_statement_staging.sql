-- Fictional dedicated statement staging and private source evidence. The migration coordinator owns the transaction.

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-statement-staging.sql
-- Held native statement evidence for ACCOUNTING 10 and 24.7.
-- Applied only by a disposable database fixture pending migration adoption.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.statement_imports (
 id uuid PRIMARY KEY,
 business_id uuid NOT NULL,
 account_id uuid NOT NULL,
 channel_version_id uuid NOT NULL,
 starts_on date NOT NULL CHECK(starts_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 ends_on date NOT NULL CHECK(ends_on BETWEEN starts_on AND DATE '9999-12-31'),
 opening_cents bigint NOT NULL,
 closing_cents bigint NOT NULL,
 file_sha256 text NOT NULL CHECK(file_sha256 ~ '^[a-f0-9]{64}$'),
 date_convention text NOT NULL CHECK(char_length(date_convention)>=1 AND char_length(date_convention)<=1000
  AND date_convention=btrim(date_convention) AND date_convention !~ '[[:cntrl:]]'),
 completeness_evidence text NOT NULL CHECK(char_length(completeness_evidence)>=1 AND char_length(completeness_evidence)<=1000
  AND completeness_evidence=btrim(completeness_evidence) AND completeness_evidence !~ '[[:cntrl:]]'),
 row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 10000),
 signed_rows_cents numeric(24,0) NOT NULL,
 rows_sha256 text NOT NULL CHECK(rows_sha256 ~ '^[a-f0-9]{64}$'),
 statement_difference_cents numeric(24,0) GENERATED ALWAYS AS
  (closing_cents::numeric-opening_cents-signed_rows_cents) STORED,
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,id),
 UNIQUE(business_id,account_id,file_sha256),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,account_id) REFERENCES crest.accounts(business_id,id),
 FOREIGN KEY(business_id,channel_version_id) REFERENCES crest.money_channel_versions(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE TABLE crest.statement_import_rows (
 business_id uuid NOT NULL,
 statement_id uuid NOT NULL,
 id uuid NOT NULL,
 statement_on date NOT NULL CHECK(statement_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 signed_cents bigint NOT NULL CHECK(signed_cents<>0),
 PRIMARY KEY(business_id,statement_id,id),
 FOREIGN KEY(business_id,statement_id) REFERENCES crest.statement_imports(business_id,id)
);

ALTER TABLE crest.statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.statement_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.statement_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.statement_import_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.statement_imports,crest.statement_import_rows TO crest_finance_account_owner;
GRANT SELECT ON crest.statement_imports,crest.statement_import_rows TO crest_finance_integrity_owner;

CREATE POLICY statement_import_read ON crest.statement_imports FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY statement_row_read ON crest.statement_import_rows FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY statement_import_integrity ON crest.statement_imports FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY statement_row_integrity ON crest.statement_import_rows FOR SELECT TO crest_finance_integrity_owner USING(true);

CREATE POLICY statement_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type='finance.statement.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY statement_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.statement.stage');
CREATE POLICY statement_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='statement_imports');
CREATE POLICY statement_operation_start ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type='finance.statement.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY statement_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type='finance.statement.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='finance.statement.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY statement_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(entity_kind='statement_imports' AND action='stage' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.statement.stage' AND o.state='pending'));
CREATE POLICY statement_import_append ON crest.statement_imports FOR INSERT TO crest_finance_account_owner
 WITH CHECK(EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=statement_imports.business_id
  AND o.operation_id=statement_imports.operation_id AND o.actor_id=statement_imports.created_by
  AND o.command_type='finance.statement.stage' AND o.state='pending'));
CREATE POLICY statement_row_append ON crest.statement_import_rows FOR INSERT TO crest_finance_account_owner
 WITH CHECK(EXISTS(SELECT FROM crest.statement_imports s JOIN crest_private.operations o
  ON (o.business_id,o.operation_id,o.actor_id)=(s.business_id,s.operation_id,s.created_by)
  WHERE s.business_id=statement_import_rows.business_id AND s.id=statement_import_rows.statement_id
  AND o.command_type='finance.statement.stage' AND o.state='pending'));

CREATE TRIGGER statement_import_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.statement_imports
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER statement_rows_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.statement_import_rows
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
SET LOCAL ROLE crest_finance_integrity_owner;
CREATE FUNCTION crest_private.verify_statement_import_rows() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE row_summary record; expected jsonb;
BEGIN
 SELECT count(*) AS total,coalesce(sum(r.signed_cents),0) AS cents,min(r.statement_on) AS first_on,max(r.statement_on) AS last_on,
  encode(sha256(convert_to(coalesce(jsonb_agg(jsonb_build_object('id',r.id,'statementOn',to_char(r.statement_on,'YYYY-MM-DD'),
   'signedCents',r.signed_cents::text) ORDER BY r.id),'[]'::jsonb)::text,'UTF8')),'hex') AS digest
 INTO row_summary FROM crest.statement_import_rows r WHERE (r.business_id,r.statement_id)=(NEW.business_id,NEW.id);
 IF row_summary.total<>NEW.row_count OR row_summary.cents<>NEW.signed_rows_cents OR row_summary.first_on<NEW.starts_on
  OR row_summary.last_on>NEW.ends_on OR row_summary.digest<>NEW.rows_sha256 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_IMPORT_ROW_PROOF_REQUIRED';
 END IF;
 expected:=jsonb_build_object('schemaVersion',1,'businessId',NEW.business_id,'statementId',NEW.id,'accountId',NEW.account_id,
  'channelVersionId',NEW.channel_version_id,'operationId',NEW.operation_id,'startsOn',NEW.starts_on,'endsOn',NEW.ends_on,
  'openingCents',NEW.opening_cents::text,'closingCents',NEW.closing_cents::text,'fileSha256',NEW.file_sha256,
  'dateConvention',NEW.date_convention,'completenessEvidence',NEW.completeness_evidence,'rowCount',NEW.row_count,
  'signedRowsCents',NEW.signed_rows_cents::text,'rowsSha256',NEW.rows_sha256,'statementDifferenceCents',NEW.statement_difference_cents::text);
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by)
   AND o.command_type='finance.statement.stage' AND o.state='committed'
   AND a.entity_kind='statement_imports' AND a.action='stage' AND a.entity_id=NEW.id AND a.entity_version=1
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected) AND o.result=expected) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_IMPORT_HISTORY_PROOF_REQUIRED';
 END IF;
 RETURN NULL;
END $verify$;
REVOKE ALL ON FUNCTION crest_private.verify_statement_import_rows() FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.verify_statement_import_rows() TO crest_schema_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER statement_import_rows_verify AFTER INSERT ON crest.statement_imports
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_statement_import_rows();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.stage_fictional_statement_import(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_statement uuid,requested_channel uuid,expected_channel_version bigint,
 starts_on date,ends_on date,opening_cents bigint,closing_cents bigint,file_sha256 text,date_convention text,
 completeness_evidence text,source_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET datestyle='ISO, YMD' AS $stage$
DECLARE auth jsonb; channel crest.money_channel_versions; claimed uuid; prior crest_private.operations;
 canonical_rows jsonb; batch_total numeric; row_total integer; payload_digest text; saved crest.statement_imports; receipt jsonb;
BEGIN
 IF requested_operation IS NULL OR requested_statement IS NULL OR requested_channel IS NULL OR coalesce(expected_channel_version,0)<1
  OR starts_on IS NULL OR ends_on IS NULL OR starts_on<DATE '0001-01-01' OR ends_on NOT BETWEEN starts_on AND DATE '9999-12-31'
  OR opening_cents IS NULL OR closing_cents IS NULL OR file_sha256 IS NULL OR file_sha256 !~ '^[a-f0-9]{64}$'
  OR date_convention IS NULL OR char_length(date_convention) NOT BETWEEN 1 AND 1000 OR date_convention<>btrim(date_convention)
  OR date_convention ~ '[[:cntrl:]]' OR completeness_evidence IS NULL OR char_length(completeness_evidence) NOT BETWEEN 1 AND 1000
  OR completeness_evidence<>btrim(completeness_evidence) OR completeness_evidence ~ '[[:cntrl:]]'
  OR jsonb_typeof(source_rows) IS DISTINCT FROM 'array' OR octet_length(source_rows::text)>2097152 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_IMPORT_INPUT_REQUIRED';
 END IF;
 row_total:=jsonb_array_length(source_rows);
 IF row_total>10000 OR EXISTS(SELECT FROM jsonb_array_elements(source_rows) x(row)
  WHERE CASE WHEN jsonb_typeof(row)<>'object' THEN true ELSE
   NOT row ?& ARRAY['id','statementOn','signedCents'] OR row-ARRAY['id','statementOn','signedCents']<>'{}'::jsonb
   OR jsonb_typeof(row->'id')<>'string' OR row->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   OR jsonb_typeof(row->'statementOn')<>'string' OR row->>'statementOn' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR jsonb_typeof(row->'signedCents')<>'string' OR row->>'signedCents' !~ '^-?[1-9][0-9]{0,18}$' END) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_IMPORT_INPUT_REQUIRED';
 END IF;
 BEGIN
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'id'),'[]'::jsonb),coalesce(sum((row->>'signedCents')::bigint),0)
   INTO canonical_rows,batch_total FROM jsonb_array_elements(source_rows) x(row);
  IF EXISTS(SELECT FROM jsonb_array_elements(source_rows) x(row)
   WHERE (row->>'statementOn')::date NOT BETWEEN starts_on AND ends_on)
   OR (SELECT count(DISTINCT row->>'id') FROM jsonb_array_elements(source_rows) x(row))<>row_total THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_IMPORT_INPUT_REQUIRED';
  END IF;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_IMPORT_INPUT_REQUIRED';
 END;

 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',requested_operation::text,true);
 payload_digest:=encode(sha256(convert_to(jsonb_build_array('finance.statement.stage',1,requested_business,expected_actor,
  expected_epoch,requested_statement,requested_channel,expected_channel_version,starts_on,ends_on,opening_cents,
  closing_cents,file_sha256,date_convention,completeness_evidence,canonical_rows)::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'finance.statement.stage',1,expected_epoch,payload_digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT * INTO prior FROM crest_private.operations o WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation);
  IF NOT FOUND OR prior.state<>'committed' OR (prior.recovery_epoch,prior.payload_hash) IS DISTINCT FROM (expected_epoch,payload_digest) THEN
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  RETURN jsonb_build_object('state','committed','receipt',prior.result);
 END IF;
 PERFORM f.id FROM crest_private.finance_controls f WHERE f.business_id=requested_business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED';END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 auth:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF ends_on>(clock_timestamp() AT TIME ZONE (auth->>'timezone'))::date THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_IMPORT_INPUT_REQUIRED';END IF;
 SELECT * INTO channel FROM crest.money_channel_versions v
  WHERE (v.business_id,v.channel_id)=(requested_business,requested_channel) AND v.effective_from<=ends_on
  ORDER BY v.effective_from DESC LIMIT 1;
 IF NOT FOUND OR channel.version<>expected_channel_version OR NOT channel.active OR channel.ownership_scope<>'dedicated_business'
  OR channel.kind NOT IN('bank','wallet') OR channel.ownership_evidence IS NULL
  OR NOT EXISTS(SELECT FROM crest.money_channel_versions v WHERE (v.business_id,v.channel_id,v.version)=
   (requested_business,requested_channel,1) AND v.effective_from<=starts_on) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_IMPORT_DEDICATED_CHANNEL_REQUIRED';
 END IF;
 IF EXISTS(SELECT FROM crest.statement_imports s WHERE (s.business_id,s.account_id,s.file_sha256)=
  (requested_business,channel.account_id,stage_fictional_statement_import.file_sha256)) THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='STATEMENT_IMPORT_FILE_ALREADY_RETAINED';
 END IF;
 INSERT INTO crest.statement_imports(id,business_id,account_id,channel_version_id,starts_on,ends_on,opening_cents,closing_cents,
  file_sha256,date_convention,completeness_evidence,row_count,signed_rows_cents,rows_sha256,operation_id,created_by)
 VALUES(requested_statement,requested_business,channel.account_id,channel.id,starts_on,ends_on,opening_cents,closing_cents,
  file_sha256,date_convention,completeness_evidence,row_total,batch_total,encode(sha256(convert_to(canonical_rows::text,'UTF8')),'hex'),
  requested_operation,expected_actor) RETURNING * INTO saved;
 INSERT INTO crest.statement_import_rows(business_id,statement_id,id,statement_on,signed_cents)
 SELECT requested_business,saved.id,(row->>'id')::uuid,(row->>'statementOn')::date,(row->>'signedCents')::bigint
 FROM jsonb_array_elements(canonical_rows) x(row);
 receipt:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'statementId',saved.id,'accountId',saved.account_id,
  'channelVersionId',saved.channel_version_id,'operationId',saved.operation_id,'startsOn',saved.starts_on,'endsOn',saved.ends_on,
  'openingCents',saved.opening_cents::text,'closingCents',saved.closing_cents::text,'fileSha256',saved.file_sha256,
  'dateConvention',saved.date_convention,'completenessEvidence',saved.completeness_evidence,'rowCount',saved.row_count,
  'signedRowsCents',saved.signed_rows_cents::text,'rowsSha256',saved.rows_sha256,'statementDifferenceCents',saved.statement_difference_cents::text);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'statement_imports',saved.id,1,'stage',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
 WHERE (business_id,operation_id)=(requested_business,requested_operation);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $stage$;

CREATE FUNCTION crest_commands.lookup_fictional_statement_import(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original_epoch uuid,
 original_operation uuid,original_statement uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE saved crest_private.operations;
BEGIN
 IF original_epoch IS NULL OR original_operation IS NULL OR original_statement IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_IMPORT_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
  set_config('crest.operation_id',original_operation::text,true);
 SELECT * INTO saved FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=
  (requested_business,original_operation,expected_actor) AND o.command_type='finance.statement.stage' AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF saved.recovery_epoch<>original_epoch OR saved.result->>'statementId' IS DISTINCT FROM original_statement::text THEN
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 RETURN jsonb_build_object('state','committed','receipt',saved.result);
END $lookup$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.stage_fictional_statement_import(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,bigint,date,date,bigint,bigint,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.stage_fictional_statement_import(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,
 uuid,uuid,uuid,uuid,bigint,date,date,bigint,bigint,text,text,text,jsonb) TO crest_finance_preview;
REVOKE ALL ON FUNCTION crest_commands.lookup_fictional_statement_import(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lookup_fictional_statement_import(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid)
 TO crest_finance_preview;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-statement-staging.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-statement-staging-source.sql
-- Closed private capture of normalized statement evidence. Original file bytes are outside this slice.
CREATE ROLE crest_statement_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_statement_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands TO crest_statement_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.statement_imports,crest.statement_import_rows TO crest_statement_export_owner;
CREATE POLICY statement_import_source ON crest.statement_imports FOR SELECT TO crest_statement_export_owner
 USING (business_id=nullif(current_setting('crest.statement_export_business_id',true),'')::uuid);
CREATE POLICY statement_row_source ON crest.statement_import_rows FOR SELECT TO crest_statement_export_owner
 USING (business_id=nullif(current_setting('crest.statement_export_business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.statement_staging_source_snapshot(requested_business uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
 SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $snapshot$
DECLARE capture jsonb; batches jsonb; row_total integer;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='STATEMENT_STAGING_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_STAGING_SOURCE_BUSINESS_REQUIRED';
 END IF;
 PERFORM set_config('crest.statement_export_business_id',requested_business::text,true);
 SELECT count(*) INTO row_total FROM (SELECT 1 FROM crest.statement_import_rows WHERE business_id=requested_business LIMIT 10001) r;
 IF row_total>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_STAGING_SOURCE_LIMIT';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'businessId',s.business_id,'accountId',s.account_id,
  'channelVersionId',s.channel_version_id,'startsOn',to_char(s.starts_on,'YYYY-MM-DD'),'endsOn',to_char(s.ends_on,'YYYY-MM-DD'),
  'openingCents',s.opening_cents::text,'closingCents',s.closing_cents::text,'fileSha256',s.file_sha256,
  'dateConvention',s.date_convention,'completenessEvidence',s.completeness_evidence,'rowCount',s.row_count,
  'signedRowsCents',s.signed_rows_cents::text,'rowsSha256',s.rows_sha256,'statementDifferenceCents',s.statement_difference_cents::text,
  'operationId',s.operation_id,'recordedBy',s.created_by,'recordedAt',to_char(s.created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rows',children.original_text) ORDER BY s.id),'[]') INTO batches
 FROM (SELECT * FROM crest.statement_imports WHERE business_id=requested_business ORDER BY id LIMIT 201) s
 CROSS JOIN LATERAL(
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'statementOn',to_char(r.statement_on,'YYYY-MM-DD'),
   'signedCents',r.signed_cents::text) ORDER BY r.id),'[]'::jsonb)::text AS original_text
  FROM crest.statement_import_rows r WHERE (r.business_id,r.statement_id)=(s.business_id,s.id)
 ) children;
 capture:=jsonb_build_object('schemaVersion',1,'scope','statement_staging_source','businessId',requested_business,'batches',batches);
 IF jsonb_array_length(batches)>200 OR octet_length(capture::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_STAGING_SOURCE_LIMIT';
 END IF;
 RETURN capture;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_statement_export_owner;
ALTER FUNCTION crest_commands.statement_staging_source_snapshot(uuid) OWNER TO crest_statement_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_statement_export_owner;
REVOKE ALL ON FUNCTION crest_commands.statement_staging_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.statement_staging_source_snapshot(uuid) TO crest_export;

RESET ROLE;
-- END REVIEWED planning/proposals/finance-statement-staging-source.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/finance-statement-staging-export-access.sql
-- The registered schema 103 handoff adds private normalized statement evidence.
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=103 THEN 'crest.posted-finance-source.v19' WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
-- END REVIEWED planning/proposals/finance-statement-staging-export-access.sql
