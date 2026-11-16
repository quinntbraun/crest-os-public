-- Whole-batch approval retains the exact reviewed plan. Application is a
-- separate operation and must revalidate the approved evidence under its locks.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.legacy_contact_approvals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 source_namespace text NOT NULL,
 evidence_sha256 text COLLATE "C" NOT NULL CHECK(evidence_sha256~'^[a-f0-9]{64}$'),
 original_sha256 text NOT NULL CHECK(original_sha256~'^[a-f0-9]{64}$'),
 mapping_sha256 text NOT NULL CHECK(mapping_sha256~'^[a-f0-9]{64}$'),
 rows_sha256 text NOT NULL CHECK(rows_sha256~'^[a-f0-9]{64}$'),
 decisions_sha256 text NOT NULL CHECK(decisions_sha256~'^[a-f0-9]{64}$'),
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 100000),
 skipped_rows integer NOT NULL CHECK(skipped_rows>=0 AND skipped_rows<=row_count),
 operation_id uuid NOT NULL,
 approved_by uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(approved_at)),
 UNIQUE(business_id,batch_id,evidence_sha256),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,batch_id,source_namespace) REFERENCES crest.legacy_contact_decision_sources(business_id,batch_id,source_namespace),
 FOREIGN KEY(business_id,operation_id,approved_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.legacy_contact_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_approvals FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.legacy_contact_approvals TO crest_legacy_contact_decision_owner;
GRANT SELECT ON crest.legacy_contact_approvals TO crest_customer_integrity_owner;
GRANT SELECT(business_id,id,original_sha256,mapping_sha256,rows_sha256,row_count)
 ON crest.legacy_contact_batches TO crest_legacy_contact_decision_owner;
CREATE POLICY legacy_approval_batch_read ON crest.legacy_contact_batches FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_approval_read ON crest.legacy_contact_approvals FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_approval_integrity ON crest.legacy_contact_approvals FOR SELECT TO crest_customer_integrity_owner USING(true);
CREATE POLICY legacy_approval_claim_integrity ON crest_private.operations FOR SELECT TO crest_customer_integrity_owner
 USING(command_type='crm.legacy_contact.approve');
CREATE POLICY legacy_approval_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_customer_integrity_owner
 USING(entity_kind='legacy_contact_approvals');

CREATE POLICY legacy_approval_claim_read ON crest_private.operations FOR SELECT TO crest_legacy_contact_decision_owner
 USING(command_type='crm.legacy_contact.approve' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY legacy_approval_claim_begin ON crest_private.operations FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(command_type='crm.legacy_contact.approve' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY legacy_approval_claim_complete ON crest_private.operations FOR UPDATE TO crest_legacy_contact_decision_owner
 USING(command_type='crm.legacy_contact.approve' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='crm.legacy_contact.approve' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY legacy_approval_insert ON crest.legacy_contact_approvals FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=legacy_contact_approvals.business_id
  AND o.operation_id=legacy_contact_approvals.operation_id AND o.actor_id=legacy_contact_approvals.approved_by
  AND o.command_type='crm.legacy_contact.approve' AND o.state='pending'));
CREATE POLICY legacy_approval_audit_read ON crest_private.audit_events FOR SELECT TO crest_legacy_contact_decision_owner
 USING(entity_kind='legacy_contact_approvals' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY legacy_approval_audit_insert ON crest_private.audit_events FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(entity_kind='legacy_contact_approvals' AND action='approve' AND origin='manual' AND import_row_id IS NULL AND entity_version=1
  AND EXISTS(SELECT FROM crest.legacy_contact_approvals x WHERE x.business_id=audit_events.business_id AND x.id=audit_events.entity_id
   AND x.operation_id=audit_events.operation_id AND x.approved_by=audit_events.actor_id));
CREATE TRIGGER legacy_approvals_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.legacy_contact_approvals
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.legacy_contact_approval_receipt(a crest.legacy_contact_approvals) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'approvalId',a.id,'businessId',a.business_id,'batchId',a.batch_id,
  'sourceNamespace',a.source_namespace,'evidenceSha256',a.evidence_sha256,'originalSha256',a.original_sha256,
  'mappingSha256',a.mapping_sha256,'rowsSha256',a.rows_sha256,'decisionsSha256',a.decisions_sha256,
  'rowCount',a.row_count,'skippedRows',a.skipped_rows,'operationId',a.operation_id,'approvedBy',a.approved_by)
$receipt$;
REVOKE ALL ON FUNCTION crest_private.legacy_contact_approval_receipt(crest.legacy_contact_approvals) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_approval_receipt(crest.legacy_contact_approvals)
 TO crest_legacy_contact_decision_owner,crest_customer_integrity_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
SET LOCAL ROLE crest_customer_integrity_owner;
CREATE FUNCTION crest_private.verify_legacy_contact_approval() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE expected jsonb:=crest_private.legacy_contact_approval_receipt(NEW);
BEGIN
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.approved_by)
   AND o.command_type='crm.legacy_contact.approve' AND o.state='committed' AND o.result=expected
   AND a.entity_kind='legacy_contact_approvals' AND a.entity_id=NEW.id AND a.action='approve' AND a.entity_version=1
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPROVAL_PROOF_REQUIRED';
 END IF;
 RETURN NULL;
END
$verify$;
REVOKE ALL ON FUNCTION crest_private.verify_legacy_contact_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_legacy_contact_approval() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER legacy_approval_verify AFTER INSERT ON crest.legacy_contact_approvals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_legacy_contact_approval();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_legacy_contact_decision_owner;
SET LOCAL ROLE crest_legacy_contact_decision_owner;
CREATE FUNCTION crest_private.legacy_contact_approval_evidence(requested_business uuid,requested_batch uuid) RETURNS jsonb
 LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $evidence$
 WITH batch AS MATERIALIZED (
  SELECT b.id,b.original_sha256,b.mapping_sha256,b.rows_sha256,b.row_count,s.source_namespace
  FROM crest.legacy_contact_batches b LEFT JOIN crest.legacy_contact_decision_sources s
   ON s.business_id=b.business_id AND s.batch_id=b.id
  WHERE b.business_id=requested_business AND b.id=requested_batch
 ), latest AS MATERIALIZED (
  SELECT DISTINCT ON (d.source_row) d.* FROM crest.legacy_contact_decisions d
  WHERE d.business_id=requested_business AND d.batch_id=requested_batch ORDER BY d.source_row,d.revision DESC
 ), selected AS MATERIALIZED (
  SELECT d.id,d.source_row,d.row_fingerprint,d.customer_action,d.customer_id,d.customer_version,d.vehicle_action,d.vehicle_id,d.vehicle_version,
   r.candidate->'customer' AS customer,r.candidate->'vehicle' AS vehicle,
   r.candidate->'customer'->>'sourceId' AS customer_source,r.candidate->'vehicle'->>'sourceId' AS vehicle_source,
   (d.customer_action='link' AND (c.id IS NULL OR c.archived_at IS NOT NULL OR c.version<>d.customer_version)
    OR d.vehicle_action='link' AND (v.id IS NULL OR v.archived_at IS NOT NULL OR v.kind<>'customer_vehicle' OR v.version<>d.vehicle_version)) AS stale
  FROM latest d JOIN crest.legacy_contact_batch_rows r
   ON r.business_id=d.business_id AND r.batch_id=d.batch_id AND r.source_row=d.source_row AND r.fingerprint=d.row_fingerprint
  LEFT JOIN crest.customers c ON c.business_id=d.business_id AND c.id=d.customer_id
  LEFT JOIN crest.vehicles v ON v.business_id=d.business_id AND v.id=d.vehicle_id
 ), customer_groups AS (
  SELECT customer_source,min(customer_action) AS intended,
    count(DISTINCT jsonb_build_array(customer_action,customer_id,customer_version,CASE WHEN customer_action='create' THEN customer END))>1 AS conflicted
  FROM selected WHERE customer_action<>'skip' GROUP BY customer_source
 ), vehicle_groups AS (
  SELECT vehicle_source,min(vehicle_action) AS intended,
   count(DISTINCT jsonb_build_array(vehicle_action,vehicle_id,vehicle_version,CASE WHEN vehicle_action='create' THEN vehicle END))>1
     OR count(DISTINCT jsonb_build_array(customer_action,
       CASE WHEN customer_action='link' THEN customer_id::text ELSE customer_source END))
       FILTER(WHERE vehicle_action IN ('create','link'))>1 AS conflicted
  FROM selected WHERE customer_action<>'skip' AND vehicle_action<>'none' GROUP BY vehicle_source
 ), summary AS (
  SELECT count(*) AS decided,count(*) FILTER(WHERE stale) AS stale,
   count(*) FILTER(WHERE customer_action='skip') AS skipped,
   encode(sha256(convert_to(coalesce(string_agg(row_fingerprint||id::text,'' ORDER BY source_row),''),'UTF8')),'hex') AS decisions_sha256
  FROM selected
 ), customer_counts AS (
  SELECT count(*) FILTER(WHERE conflicted) AS conflicts,
   count(*) FILTER(WHERE intended='create' AND NOT conflicted) AS creates,
   count(*) FILTER(WHERE intended='link' AND NOT conflicted) AS links FROM customer_groups
 ), vehicle_counts AS (
  SELECT count(*) FILTER(WHERE conflicted) AS conflicts,
   count(*) FILTER(WHERE intended='create' AND NOT conflicted) AS creates,
   count(*) FILTER(WHERE intended='link' AND NOT conflicted) AS links FROM vehicle_groups
 ), calculated AS (
  SELECT b.*,summary.*,customer_counts.conflicts+vehicle_counts.conflicts AS conflicts,
   customer_counts.creates AS customer_creates,customer_counts.links AS customer_links,
   vehicle_counts.creates AS vehicle_creates,vehicle_counts.links AS vehicle_links,
   encode(sha256(convert_to(jsonb_build_array('crest.contact-import-approval',1,requested_business,b.id,b.source_namespace,
    b.original_sha256,b.mapping_sha256,b.rows_sha256,summary.decisions_sha256)::text,'UTF8')),'hex') AS evidence_sha256
  FROM batch b CROSS JOIN summary CROSS JOIN customer_counts CROSS JOIN vehicle_counts
 )
 SELECT CASE WHEN NOT EXISTS(SELECT FROM calculated) THEN jsonb_build_object('state','absent') ELSE (
  SELECT jsonb_build_object('state',CASE WHEN c.decided=c.row_count AND c.stale=0 AND c.conflicts=0 THEN 'ready' ELSE 'blocked' END,
   'schemaVersion',1,'businessId',requested_business,'batchId',c.id,'sourceNamespace',c.source_namespace,
   'rowCount',c.row_count,'undecidedRows',c.row_count-c.decided,'skippedRows',c.skipped,'staleRows',c.stale,'conflictingGroups',c.conflicts,
   'customerCreates',c.customer_creates,'customerLinks',c.customer_links,'vehicleCreates',c.vehicle_creates,'vehicleLinks',c.vehicle_links,
   'originalSha256',c.original_sha256,'mappingSha256',c.mapping_sha256,'rowsSha256',c.rows_sha256,
   'decisionsSha256',c.decisions_sha256,'evidenceSha256',c.evidence_sha256,
   'approval',CASE WHEN a.id IS NULL THEN NULL ELSE crest_private.legacy_contact_approval_receipt(a) END)
  FROM calculated c LEFT JOIN crest.legacy_contact_approvals a
   ON a.business_id=requested_business AND a.batch_id=c.id AND a.evidence_sha256=c.evidence_sha256 AND c.stale=0
 ) END
$evidence$;
REVOKE ALL ON FUNCTION crest_private.legacy_contact_approval_evidence(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION crest_commands.review_legacy_contact_approval(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $review$
DECLARE authority jsonb;
BEGIN
 PERFORM set_config('crest.legacy_decision_business_id','',true);
 IF requested_batch IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPROVAL_INPUT_REQUIRED'; END IF;
 authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_decision_business_id',authority->>'businessId',true);
 RETURN crest_private.legacy_contact_approval_evidence(requested_business,requested_batch);
END
$review$;

CREATE FUNCTION crest_commands.approve_legacy_contact_batch(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,expected_evidence text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $approve$
DECLARE evidence jsonb; prior record; payload_digest text; claimed uuid; saved crest.legacy_contact_approvals; receipt jsonb;
BEGIN
 PERFORM set_config('crest.legacy_decision_business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_batch IS NULL OR requested_operation IS NULL OR expected_evidence IS NULL OR expected_evidence!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPROVAL_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM set_config('crest.legacy_decision_business_id',requested_business::text,true),
  set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',requested_operation::text,true);
 payload_digest:=encode(sha256(convert_to(jsonb_build_array('crm.legacy_contact.approve',1,requested_business,expected_actor,
  expected_epoch,requested_batch,expected_evidence)::text,'UTF8')),'hex');
 -- Use the same batch lock as row decisions so a concurrent edit cannot become
 -- the chosen review revision while authorization commits.
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('crm.legacy_contact.decide',requested_business,requested_batch)::text,0));
 SELECT o.state,o.result,o.payload_hash,o.recovery_epoch INTO prior FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation);
 IF FOUND THEN
  IF prior.state='committed' AND prior.payload_hash=payload_digest AND prior.recovery_epoch=expected_epoch THEN
   RETURN jsonb_build_object('state','committed','receipt',prior.result);
  END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 evidence:=crest_private.legacy_contact_approval_evidence(requested_business,requested_batch);
 IF evidence->>'state'='absent' OR evidence->>'evidenceSha256' IS DISTINCT FROM expected_evidence THEN
  RETURN jsonb_build_object('state','conflict','reason','evidence');
 END IF;
 IF evidence->>'state'<>'ready' THEN RETURN jsonb_build_object('state','conflict','reason','not_ready'); END IF;
 IF evidence->'approval'<>'null'::jsonb THEN RETURN jsonb_build_object('state','already_approved','receipt',evidence->'approval'); END IF;
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'crm.legacy_contact.approve',1,expected_epoch,payload_digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 INSERT INTO crest.legacy_contact_approvals(business_id,batch_id,source_namespace,evidence_sha256,original_sha256,mapping_sha256,
  rows_sha256,decisions_sha256,row_count,skipped_rows,operation_id,approved_by)
 VALUES(requested_business,requested_batch,evidence->>'sourceNamespace',expected_evidence,evidence->>'originalSha256',
  evidence->>'mappingSha256',evidence->>'rowsSha256',evidence->>'decisionsSha256',(evidence->>'rowCount')::integer,
  (evidence->>'skippedRows')::integer,requested_operation,expected_actor)
 RETURNING * INTO saved;
 receipt:=crest_private.legacy_contact_approval_receipt(saved);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'legacy_contact_approvals',saved.id,1,'approve',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
  WHERE (business_id,operation_id)=(requested_business,requested_operation);
 PERFORM crest_commands.finish_customer_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END
$approve$;
REVOKE ALL ON FUNCTION crest_commands.review_legacy_contact_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.approve_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.review_legacy_contact_approval(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.approve_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_legacy_contact_decision_owner;

-- Portable receipts include historical approvals even after their evidence goes stale.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.legacy_contact_approvals TO crest_legacy_contact_export_owner;
CREATE POLICY legacy_approval_export ON crest.legacy_contact_approvals FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_approval_source_page(
 requested_business uuid,after_batch uuid,after_evidence text,page_size integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100
  OR (after_batch IS NULL)<>(after_evidence IS NULL) OR after_evidence!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
 WITH candidates AS MATERIALIZED (
  SELECT a.* FROM crest.legacy_contact_approvals a WHERE a.business_id=requested_business
   AND (after_batch IS NULL OR (a.batch_id,a.evidence_sha256)>(after_batch,after_evidence COLLATE "C"))
  ORDER BY a.batch_id,a.evidence_sha256 LIMIT page_size+1
 ), page AS (SELECT * FROM candidates ORDER BY batch_id,evidence_sha256 LIMIT page_size)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY batch_id,evidence_sha256),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 RETURN result;
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_approval_source_page(uuid,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_approval_source_page(uuid,uuid,text,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;
