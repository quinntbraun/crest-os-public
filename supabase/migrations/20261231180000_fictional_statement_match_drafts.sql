-- Append-only evidence for statement matching. Drafts do not clear movements or approve a reconciliation.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.statement_match_draft_revisions (
 business_id uuid NOT NULL,
 statement_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),
 previous_revision bigint GENERATED ALWAYS AS(nullif(revision-1,0)) STORED,
 operation_id uuid NOT NULL,
 audit_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(recorded_at)),
 movement_from_on date NOT NULL CHECK(movement_from_on BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 reason text NOT NULL CHECK(char_length(reason)>=1 AND char_length(reason)<=1000 AND reason=btrim(reason) AND reason !~ '[[:cntrl:]]'),
 allocations jsonb NOT NULL CHECK(jsonb_typeof(allocations)='array' AND jsonb_array_length(allocations)<=200
  AND octet_length(allocations::text)<=30000 AND (revision>1 OR jsonb_array_length(allocations)>0)),
 PRIMARY KEY(business_id,statement_id,revision),
 UNIQUE(business_id,operation_id),
 UNIQUE(audit_id),
 FOREIGN KEY(business_id,statement_id) REFERENCES crest.statement_imports(business_id,id),
 FOREIGN KEY(business_id,statement_id,previous_revision) REFERENCES crest.statement_match_draft_revisions(business_id,statement_id,revision),
 FOREIGN KEY(business_id,operation_id,recorded_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.statement_match_draft_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.statement_match_draft_revisions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.statement_match_draft_revisions TO crest_finance_account_owner;
GRANT SELECT ON crest.statement_match_draft_revisions TO crest_finance_integrity_owner,crest_statement_export_owner;
CREATE POLICY statement_match_draft_read ON crest.statement_match_draft_revisions FOR SELECT TO crest_finance_account_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY statement_match_draft_source ON crest.statement_match_draft_revisions FOR SELECT TO crest_statement_export_owner
 USING(business_id=nullif(current_setting('crest.statement_export_business_id',true),'')::uuid);
CREATE POLICY statement_match_draft_integrity ON crest.statement_match_draft_revisions FOR SELECT TO crest_finance_integrity_owner USING(true);
CREATE POLICY statement_match_draft_insert ON crest.statement_match_draft_revisions FOR INSERT TO crest_finance_account_owner
 WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND recorded_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=statement_match_draft_revisions.business_id
   AND o.operation_id=statement_match_draft_revisions.operation_id AND o.actor_id=statement_match_draft_revisions.recorded_by
   AND o.command_type='finance.statement_match_draft.save' AND o.state='pending'));
CREATE TRIGGER statement_match_draft_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.statement_match_draft_revisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE POLICY statement_match_draft_operation_read ON crest_private.operations FOR SELECT TO crest_finance_account_owner
 USING(command_type='finance.statement_match_draft.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY statement_match_draft_operation_start ON crest_private.operations FOR INSERT TO crest_finance_account_owner
 WITH CHECK(command_type='finance.statement_match_draft.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY statement_match_draft_operation_finish ON crest_private.operations FOR UPDATE TO crest_finance_account_owner
 USING(command_type='finance.statement_match_draft.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='finance.statement_match_draft.save' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY statement_match_draft_audit_append ON crest_private.audit_events FOR INSERT TO crest_finance_account_owner
 WITH CHECK(entity_kind='statement_match_draft_revisions' AND action='review' AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=audit_events.business_id
   AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id
   AND o.command_type='finance.statement_match_draft.save' AND o.state='pending'));
CREATE POLICY statement_match_draft_operation_integrity ON crest_private.operations FOR SELECT TO crest_finance_integrity_owner
 USING(command_type='finance.statement_match_draft.save');
CREATE POLICY statement_match_draft_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_finance_integrity_owner
 USING(entity_kind='statement_match_draft_revisions');

CREATE FUNCTION crest.statement_match_draft_receipt(r crest.statement_match_draft_revisions)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'businessId',r.business_id,'statementId',r.statement_id,
  'revision',r.revision::text,'operationId',r.operation_id,'recordedBy',r.recorded_by,
  'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'state','draft','movementFromOn',to_char(r.movement_from_on,'YYYY-MM-DD'),'reason',r.reason,'allocations',r.allocations);
$receipt$;
REVOKE ALL ON FUNCTION crest.statement_match_draft_receipt(crest.statement_match_draft_revisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest.statement_match_draft_receipt(crest.statement_match_draft_revisions)
 TO crest_finance_account_owner,crest_finance_integrity_owner,crest_statement_export_owner;

CREATE FUNCTION crest_private.check_statement_match_draft() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE expected jsonb; prior jsonb;
BEGIN
 IF NOT EXISTS(SELECT FROM crest.statement_imports s WHERE (s.business_id,s.id)=(NEW.business_id,NEW.statement_id)
  AND NEW.movement_from_on<=s.ends_on)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(NEW.allocations) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object'
  OR NOT x ?& ARRAY['statementRowId','movementId','signedCents']
  OR x-ARRAY['statementRowId','movementId','signedCents']<>'{}'::jsonb
  OR jsonb_typeof(x->'statementRowId') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'movementId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(x->'signedCents') IS DISTINCT FROM 'string'
  OR x->>'statementRowId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR x->>'movementId' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  OR x->>'signedCents' !~ '^-?[1-9][0-9]{0,18}$')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED'; END IF;
 IF EXISTS (
  WITH input AS MATERIALIZED (
   SELECT (x->>'statementRowId')::uuid AS row_id,(x->>'movementId')::uuid AS movement_id,(x->>'signedCents')::numeric AS cents
   FROM jsonb_array_elements(NEW.allocations) x
  ), checked AS (
   SELECT i.*,count(*) OVER(PARTITION BY i.row_id,i.movement_id) AS pair_count,
    sum(i.cents) OVER(PARTITION BY i.row_id) AS row_total,
    sum(i.cents) OVER(PARTITION BY i.movement_id) AS movement_total,
    r.signed_cents AS row_cents,m.signed_cents AS movement_cents,s.account_id,m.account_id AS actual_account,
    r.statement_on,e.effective_on
   FROM input i
   JOIN crest.statement_imports s ON (s.business_id,s.id)=(NEW.business_id,NEW.statement_id)
   LEFT JOIN crest.statement_import_rows r ON (r.business_id,r.statement_id,r.id)=(s.business_id,s.id,i.row_id)
   LEFT JOIN crest.money_movements m ON (m.business_id,m.id)=(s.business_id,i.movement_id)
   LEFT JOIN crest.financial_events e ON (e.business_id,e.id)=(m.business_id,m.event_id)
  )
  SELECT FROM checked WHERE pair_count<>1 OR row_cents IS NULL OR movement_cents IS NULL
   OR actual_account IS DISTINCT FROM account_id OR effective_on IS NULL OR effective_on>statement_on OR effective_on<NEW.movement_from_on
   OR sign(cents)<>sign(row_cents) OR sign(cents)<>sign(movement_cents)
   OR abs(row_total)>abs(row_cents::numeric) OR abs(movement_total)>abs(movement_cents::numeric)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED'; END IF;
 expected:=crest.statement_match_draft_receipt(NEW);
 SELECT crest.statement_match_draft_receipt(d) INTO prior FROM crest.statement_match_draft_revisions d
 WHERE (d.business_id,d.statement_id,d.revision)=(NEW.business_id,NEW.statement_id,NEW.previous_revision);
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.recorded_by)
   AND o.command_type='finance.statement_match_draft.save' AND o.state='committed' AND o.result=expected
   AND a.id=NEW.audit_id AND a.entity_kind='statement_match_draft_revisions' AND a.entity_id=NEW.statement_id
   AND a.entity_version=NEW.revision AND a.action='review' AND a.reason=NEW.reason
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',expected))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STATEMENT_MATCH_DRAFT_AUDIT_REQUIRED'; END IF;
 RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_statement_match_draft() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_statement_match_draft() TO crest_schema_owner;
CREATE CONSTRAINT TRIGGER statement_match_draft_proof AFTER INSERT ON crest.statement_match_draft_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_statement_match_draft();
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_finance_integrity_owner;
ALTER FUNCTION crest_private.check_statement_match_draft() OWNER TO crest_finance_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_finance_integrity_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_finance_account_owner;
SET LOCAL ROLE crest_finance_account_owner;
CREATE FUNCTION crest_commands.save_fictional_statement_match_draft(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,epoch uuid,operation uuid,statement uuid,expected_revision bigint,proposed jsonb,review_reason text,movement_from date
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE saved crest.statement_match_draft_revisions; previous crest.statement_match_draft_revisions;
 existing crest_private.operations; claimed uuid; digest text; receipt jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 IF jsonb_typeof(proposed) IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_MATCH_DRAFT_INPUT_REQUIRED'; END IF;
 IF operation IS NULL OR statement IS NULL OR movement_from IS NULL OR movement_from NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
  OR expected_revision IS NULL OR expected_revision NOT BETWEEN 0 AND 9223372036854775806
  OR octet_length(proposed::text)>30000
  OR jsonb_array_length(proposed)>200 OR (expected_revision=0 AND jsonb_array_length(proposed)=0)
  OR review_reason IS NULL OR char_length(review_reason) NOT BETWEEN 1 AND 1000 OR review_reason<>btrim(review_reason)
  OR review_reason~'[[:cntrl:]]'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_MATCH_DRAFT_INPUT_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',business::text,true),set_config('crest.actor_id',actor::text,true),
  set_config('crest.operation_id',operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_array('finance.statement_match_draft.save',1,business,actor,epoch,
  statement,expected_revision::text,proposed,review_reason,to_char(movement_from,'YYYY-MM-DD'))::text,'UTF8')),'hex');
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(business,operation,actor,'finance.statement_match_draft.save',1,epoch,digest,actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT * INTO existing FROM crest_private.operations o WHERE (o.business_id,o.operation_id,o.actor_id)=(business,operation,actor)
   AND o.command_type='finance.statement_match_draft.save' AND o.state='committed';
  IF NOT FOUND OR (existing.recovery_epoch,existing.payload_hash) IS DISTINCT FROM (epoch,digest)
  THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
  RETURN jsonb_build_object('state','committed','receipt',existing.result);
 END IF;
 PERFORM FROM crest_private.finance_controls f WHERE f.business_id=business FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FINANCE_ACCOUNT_SETUP_REQUIRED'; END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 PERFORM FROM crest.statement_imports s WHERE (s.business_id,s.id)=(business,statement);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED'; END IF;
 SELECT * INTO previous FROM crest.statement_match_draft_revisions d WHERE (d.business_id,d.statement_id)=(business,statement)
  ORDER BY d.revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision
 THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='STATEMENT_MATCH_DRAFT_REVISION_CONFLICT'; END IF;
 INSERT INTO crest.statement_match_draft_revisions(business_id,statement_id,revision,operation_id,audit_id,recorded_by,reason,allocations,movement_from_on)
 VALUES(business,statement,expected_revision+1,operation,gen_random_uuid(),actor,review_reason,proposed,movement_from) RETURNING * INTO saved;
 receipt:=crest.statement_match_draft_receipt(saved);
 INSERT INTO crest_private.audit_events(id,business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin)
 VALUES(saved.audit_id,business,operation,actor,actor,'statement_match_draft_revisions',statement,saved.revision,'review',review_reason,
  jsonb_build_object('schemaVersion',1,'before',CASE WHEN previous.revision IS NOT NULL
   THEN crest.statement_match_draft_receipt(previous) END,'after',receipt),'manual');
 UPDATE crest_private.operations o SET state='committed',result_schema_version=1,result=receipt
  WHERE (o.business_id,o.operation_id)=(business,operation);
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'finance.post',true);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END $save$;

CREATE FUNCTION crest_commands.read_fictional_statement_match_draft(
 credential bytea,session_id uuid,actor uuid,issuer text,subject uuid,provider_session uuid,valid_until timestamptz,
 business uuid,statement uuid,requested_revision bigint
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE saved crest.statement_match_draft_revisions;
BEGIN
 PERFORM crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',business::text,true);
 IF statement IS NULL OR requested_revision<1
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_MATCH_DRAFT_INPUT_REQUIRED'; END IF;
 PERFORM FROM crest.statement_imports s WHERE (s.business_id,s.id)=(business,statement);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED'; END IF;
 SELECT * INTO saved FROM crest.statement_match_draft_revisions d WHERE (d.business_id,d.statement_id)=(business,statement)
  AND (requested_revision IS NULL OR d.revision=requested_revision) ORDER BY d.revision DESC LIMIT 1;
 RETURN jsonb_build_object('draft',CASE WHEN FOUND THEN crest.statement_match_draft_receipt(saved) END);
END $read$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_finance_account_owner;
REVOKE ALL ON FUNCTION crest_commands.save_fictional_statement_match_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text,date),
 crest_commands.read_fictional_statement_match_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_fictional_statement_match_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,bigint,jsonb,text,date),
 crest_commands.read_fictional_statement_match_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint) TO crest_finance_preview;

SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.statement_match_draft_source_snapshot(requested_business uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $snapshot$
DECLARE revisions jsonb; snapshot jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_REQUIRED';
 END IF;
 PERFORM set_config('crest.statement_export_business_id',requested_business::text,true);
 SELECT coalesce(jsonb_agg(jsonb_build_object('receipt',crest.statement_match_draft_receipt(d),'auditId',d.audit_id)
  ORDER BY d.statement_id,d.revision),'[]'::jsonb) INTO revisions
 FROM (SELECT * FROM crest.statement_match_draft_revisions WHERE business_id=requested_business ORDER BY statement_id,revision LIMIT 101) d;
 snapshot:=jsonb_build_object('schemaVersion',1,'scope','statement_match_draft_source','businessId',requested_business,'revisions',revisions);
 IF jsonb_array_length(revisions)>100 OR octet_length(snapshot::text)>4194304 THEN
  RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='STATEMENT_MATCH_DRAFT_SOURCE_LIMIT';
 END IF;
 RETURN snapshot;
END $snapshot$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_statement_export_owner;
ALTER FUNCTION crest_commands.statement_match_draft_source_snapshot(uuid) OWNER TO crest_statement_export_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_statement_export_owner;
REVOKE ALL ON FUNCTION crest_commands.statement_match_draft_source_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.statement_match_draft_source_snapshot(uuid) TO crest_export;


-- Record the updated source profile on the audited owner download.
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
 scope:=jsonb_build_object('profile',CASE WHEN source_version>=107 THEN 'crest.posted-finance-source.v21' WHEN source_version>=105 THEN 'crest.posted-finance-source.v20' WHEN source_version>=103 THEN 'crest.posted-finance-source.v19' WHEN source_version>=102 THEN 'crest.posted-finance-source.v18' WHEN source_version>=101 THEN 'crest.posted-finance-source.v17' WHEN source_version>=100 THEN 'crest.posted-finance-source.v16' WHEN source_version>=99 THEN 'crest.posted-finance-source.v15' WHEN source_version>=98 THEN 'crest.posted-finance-source.v14' WHEN source_version>=97 THEN 'crest.posted-finance-source.v13' WHEN source_version>=96 THEN 'crest.posted-finance-source.v12' WHEN source_version>=95 THEN 'crest.posted-finance-source.v11' WHEN source_version>=94 THEN 'crest.posted-finance-source.v10' WHEN source_version>=93 THEN 'crest.posted-finance-source.v9' WHEN source_version>=91 THEN 'crest.posted-finance-source.v8' ELSE 'crest.posted-finance-source.v7' END,'sourceSchemaVersion',source_version,
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
