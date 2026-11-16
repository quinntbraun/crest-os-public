-- Registered background application for the authorized synthetic contact-import workflow.
-- Held contact-only import identity registry and review interlock.
-- Only the application transaction may bind identities. Review never inserts.
-- The apply operation must serialize writers for the source namespace, lock
-- existing targets, recheck the approval, and commit mappings with the business
-- rows and audit. A new target records its immutable importing decision ID.
-- A mapped ID permits an explicit link when mutable match hints have drifted.
-- A conflicting create or a different link must go back for review.
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.legacy_contact_external_identities (
 business_id uuid NOT NULL,
 source_namespace text COLLATE "C" NOT NULL,
 entity_kind text NOT NULL,
 external_id text COLLATE "C" NOT NULL CHECK(char_length(external_id)>=1 AND char_length(external_id)<=200 AND external_id!~'[[:cntrl:]]'),
 customer_id uuid,
 vehicle_id uuid,
 first_batch_id uuid NOT NULL,
 first_evidence_sha256 text COLLATE "C" NOT NULL,
 first_source_row integer NOT NULL,
 first_decision_revision integer NOT NULL,
 first_apply_operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 PRIMARY KEY(business_id,source_namespace,entity_kind,external_id),
 CHECK((entity_kind='customer' AND customer_id IS NOT NULL AND vehicle_id IS NULL)
  OR (entity_kind='vehicle' AND vehicle_id IS NOT NULL AND customer_id IS NULL)),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),
 FOREIGN KEY(business_id,first_batch_id,source_namespace)
  REFERENCES crest.legacy_contact_decision_sources(business_id,batch_id,source_namespace),
 FOREIGN KEY(business_id,first_batch_id,first_evidence_sha256)
  REFERENCES crest.legacy_contact_approvals(business_id,batch_id,evidence_sha256),
 FOREIGN KEY(business_id,first_batch_id,first_source_row,first_decision_revision)
  REFERENCES crest.legacy_contact_decisions(business_id,batch_id,source_row,revision),
 FOREIGN KEY(business_id,first_apply_operation_id,created_by)
  REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.legacy_contact_external_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_external_identities FORCE ROW LEVEL SECURITY;
GRANT SELECT ON crest.legacy_contact_external_identities TO crest_legacy_contact_decision_owner,crest_customer_integrity_owner;
CREATE POLICY legacy_external_identity_read ON crest.legacy_contact_external_identities FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_external_identity_integrity ON crest.legacy_contact_external_identities FOR SELECT TO crest_customer_integrity_owner USING(true);
CREATE TRIGGER legacy_external_identities_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.legacy_contact_external_identities
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

GRANT SELECT(business_id,batch_id,source_row,candidate,fingerprint) ON crest.legacy_contact_batch_rows TO crest_customer_integrity_owner;
CREATE POLICY legacy_external_identity_row_proof ON crest.legacy_contact_batch_rows FOR SELECT TO crest_customer_integrity_owner USING(true);
GRANT SELECT(business_id,operation_id,actor_id,command_type,state,schema_version,result_schema_version,result)
 ON crest_private.operations TO crest_customer_integrity_owner;
CREATE POLICY legacy_external_identity_operation_proof ON crest_private.operations FOR SELECT TO crest_customer_integrity_owner
 USING(command_type='crm.legacy_contact.apply');
GRANT SELECT(business_id,id,kind,origin,operation_id,import_row_id) ON crest.vehicles TO crest_customer_integrity_owner;
CREATE POLICY legacy_external_identity_vehicle_proof ON crest.vehicles FOR SELECT TO crest_customer_integrity_owner USING(true);
GRANT SELECT(business_id,id,origin,operation_id,import_row_id) ON crest.customers TO crest_customer_integrity_owner;
CREATE POLICY legacy_external_identity_customer_proof ON crest.customers FOR SELECT TO crest_customer_integrity_owner USING(true);
GRANT SELECT(id,display_name) ON crest.customers TO crest_legacy_contact_decision_owner;
GRANT SELECT(id,label) ON crest.vehicles TO crest_legacy_contact_decision_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
SET LOCAL ROLE crest_customer_integrity_owner;
CREATE FUNCTION crest_private.verify_legacy_contact_external_identity() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $proof$
BEGIN
 IF NOT EXISTS(
  SELECT FROM crest.legacy_contact_decisions d
  JOIN crest.legacy_contact_batch_rows r ON (r.business_id,r.batch_id,r.source_row,r.fingerprint)=(d.business_id,d.batch_id,d.source_row,d.row_fingerprint)
  JOIN crest.legacy_contact_approvals a ON (a.business_id,a.batch_id,a.evidence_sha256)=(NEW.business_id,NEW.first_batch_id,NEW.first_evidence_sha256)
  JOIN crest_private.operations o ON (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.first_apply_operation_id,NEW.created_by)
  LEFT JOIN crest.customers c ON (c.business_id,c.id)=(NEW.business_id,NEW.customer_id)
  LEFT JOIN crest.vehicles v ON (v.business_id,v.id)=(NEW.business_id,NEW.vehicle_id)
  WHERE (d.business_id,d.batch_id,d.source_row,d.revision,d.source_namespace)=
    (NEW.business_id,NEW.first_batch_id,NEW.first_source_row,NEW.first_decision_revision,NEW.source_namespace)
   AND (r.candidate->NEW.entity_kind->>'sourceId') COLLATE "C"=NEW.external_id
   AND o.command_type='crm.legacy_contact.apply' AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1
   AND o.result->>'batchId'=a.batch_id::text AND o.result->>'approvalId'=a.id::text AND o.result->>'evidenceSha256'=a.evidence_sha256
   AND (NEW.entity_kind='customer' AND (
       d.customer_action='link' AND d.customer_id=NEW.customer_id
       OR d.customer_action='create' AND c.origin='import' AND c.operation_id=NEW.first_apply_operation_id AND c.import_row_id=d.id)
    OR NEW.entity_kind='vehicle' AND v.kind='customer_vehicle' AND (
       d.vehicle_action='link' AND d.vehicle_id=NEW.vehicle_id
       OR d.vehicle_action='create' AND v.origin='import' AND v.operation_id=NEW.first_apply_operation_id AND v.import_row_id=d.id))
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_EXTERNAL_IDENTITY_PROOF_REQUIRED';
 END IF;
 RETURN NULL;
END
$proof$;
REVOKE ALL ON FUNCTION crest_private.verify_legacy_contact_external_identity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_legacy_contact_external_identity() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER legacy_external_identity_verify AFTER INSERT ON crest.legacy_contact_external_identities
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_legacy_contact_external_identity();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_legacy_contact_decision_owner;
SET LOCAL ROLE crest_legacy_contact_decision_owner;
CREATE FUNCTION crest_commands.find_legacy_contact_identity(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid,
 requested_row integer,requested_namespace text,target_kind text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE authority jsonb; digest text; pinned_namespace text; source_id text; target jsonb;
BEGIN
 PERFORM set_config('crest.legacy_decision_business_id','',true);
 IF requested_batch IS NULL OR requested_row IS NULL OR requested_row NOT BETWEEN 2 AND 100001
  OR requested_namespace IS NULL OR requested_namespace!~'^[a-z][a-z0-9_-]{1,63}$'
  OR target_kind IS NULL OR target_kind NOT IN ('customer','vehicle') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_IDENTITY_LOOKUP_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_decision_business_id',authority->>'businessId',true);
 SELECT r.fingerprint,s.source_namespace,r.candidate->target_kind->>'sourceId'
 INTO digest,pinned_namespace,source_id
 FROM crest.legacy_contact_batch_rows r LEFT JOIN crest.legacy_contact_decision_sources s USING(business_id,batch_id)
 WHERE (r.business_id,r.batch_id,r.source_row)=(requested_business,requested_batch,requested_row);
 IF NOT FOUND OR pinned_namespace IS NOT NULL AND pinned_namespace<>requested_namespace THEN
  RETURN jsonb_build_object('state','absent');
 END IF;
 SELECT CASE WHEN m.entity_kind='customer' THEN
  jsonb_build_object('id',c.id,'version',c.version::text,'label',c.display_name,'archived',c.archived_at IS NOT NULL,'recordType','customer')
 ELSE jsonb_build_object('id',v.id,'version',v.version::text,'label',v.label,'archived',v.archived_at IS NOT NULL,'recordType',v.kind) END
 INTO target FROM crest.legacy_contact_external_identities m
 LEFT JOIN crest.customers c ON (c.business_id,c.id)=(m.business_id,m.customer_id)
 LEFT JOIN crest.vehicles v ON (v.business_id,v.id)=(m.business_id,m.vehicle_id)
 WHERE (m.business_id,m.source_namespace,m.entity_kind,m.external_id)=(requested_business,requested_namespace,target_kind,source_id);
 RETURN jsonb_build_object('state','present','schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,
  'row',requested_row,'sourceNamespace',requested_namespace,'kind',target_kind,'fingerprint',digest,'target',target);
END
$lookup$;
REVOKE ALL ON FUNCTION crest_commands.find_legacy_contact_identity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.find_legacy_contact_identity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,text,text) TO crest_web;

CREATE OR REPLACE FUNCTION crest_commands.save_legacy_contact_decision(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,requested_row integer,expected_fingerprint text,expected_revision integer,
 requested_namespace text,contact_action text,contact_target uuid,contact_version bigint,
 auto_action text,auto_target uuid,auto_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE
 mapped jsonb; digest text; payload_digest text; previous crest.legacy_contact_decisions; namespace text;
 prior record; claimed uuid; bound_customer uuid; bound_vehicle uuid; saved crest.legacy_contact_decisions; receipt jsonb; before_receipt jsonb;
BEGIN
 PERFORM set_config('crest.legacy_decision_business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_batch IS NULL OR requested_row IS NULL OR requested_row NOT BETWEEN 2 AND 100001
  OR expected_fingerprint IS NULL OR expected_fingerprint!~'^[a-f0-9]{64}$' OR expected_revision IS NULL
  OR expected_revision NOT BETWEEN 0 AND 2147483646 OR requested_namespace IS NULL OR requested_namespace!~'^[a-z][a-z0-9_-]{1,63}$'
  OR contact_action IS NULL OR contact_action NOT IN ('create','link','skip') OR auto_action IS NULL
  OR auto_action NOT IN ('none','create','link','skip') OR (contact_action='link')<>(contact_target IS NOT NULL)
  OR (auto_action='link')<>(auto_target IS NOT NULL) OR (contact_target IS NULL)<>(contact_version IS NULL)
  OR (auto_target IS NULL)<>(auto_version IS NULL) OR contact_version<=0 OR auto_version<=0
  OR (contact_action='skip' AND auto_action<>'none') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_DECISION_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM set_config('crest.legacy_decision_business_id',requested_business::text,true),
  set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',requested_operation::text,true);
 payload_digest:=encode(sha256(convert_to(jsonb_build_array('crm.legacy_contact.decide',1,requested_business,expected_actor,
  expected_epoch,requested_batch,requested_row,expected_fingerprint,expected_revision,requested_namespace,
  contact_action,contact_target,contact_version,auto_action,auto_target,auto_version)::text,'UTF8')),'hex');
 -- Serialize the initial source binding and all version checks for the batch.
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('crm.legacy_contact.decide',requested_business,requested_batch)::text,0));
 SELECT o.state,o.result,o.payload_hash,o.recovery_epoch INTO prior FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation);
 IF FOUND THEN
  IF prior.state='committed' AND prior.payload_hash=payload_digest AND prior.recovery_epoch=expected_epoch THEN
   RETURN jsonb_build_object('state','committed','receipt',prior.result);
  END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT candidate,fingerprint INTO mapped,digest FROM crest.legacy_contact_batch_rows
  WHERE (business_id,batch_id,source_row)=(requested_business,requested_batch,requested_row);
 IF NOT FOUND OR digest IS DISTINCT FROM expected_fingerprint THEN
  RETURN jsonb_build_object('state','conflict','reason','row');
 END IF;
 SELECT source_namespace INTO namespace FROM crest.legacy_contact_decision_sources
  WHERE (business_id,batch_id)=(requested_business,requested_batch);
 IF FOUND AND namespace<>requested_namespace THEN RETURN jsonb_build_object('state','conflict','reason','source'); END IF;
 SELECT * INTO previous FROM crest.legacy_contact_decisions
  WHERE (business_id,batch_id,source_row)=(requested_business,requested_batch,requested_row)
  ORDER BY revision DESC LIMIT 1;
 IF coalesce(previous.revision,0)<>expected_revision THEN
  RETURN jsonb_build_object('state','conflict','reason','revision','currentRevision',previous.revision);
 END IF;
 IF (mapped->'customer'='null'::jsonb AND contact_action<>'skip') OR
   (contact_action<>'skip' AND (mapped->'vehicle'='null'::jsonb)<>(auto_action='none')) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_DECISION_ROW_ACTION_REQUIRED';
 END IF;
 SELECT customer_id INTO bound_customer FROM crest.legacy_contact_external_identities
  WHERE (business_id,source_namespace,entity_kind,external_id)=(requested_business,requested_namespace,'customer',mapped->'customer'->>'sourceId');
 SELECT vehicle_id INTO bound_vehicle FROM crest.legacy_contact_external_identities
  WHERE (business_id,source_namespace,entity_kind,external_id)=(requested_business,requested_namespace,'vehicle',mapped->'vehicle'->>'sourceId');
 IF bound_customer IS NOT NULL AND (contact_action='create' OR contact_action='link' AND contact_target<>bound_customer)
  OR bound_vehicle IS NOT NULL AND (auto_action='create' OR auto_action='link' AND auto_target<>bound_vehicle)
 THEN RETURN jsonb_build_object('state','conflict','reason','target'); END IF;
 IF contact_action='link' AND NOT EXISTS(
  SELECT FROM crest.customers c WHERE c.business_id=requested_business AND c.id=contact_target
   AND c.version=contact_version AND c.archived_at IS NULL
   AND (c.id=bound_customer OR c.phone_normalized=nullif(regexp_replace(mapped->'customer'->>'phone','[^0-9]','','g'),'')
     OR c.email_normalized=nullif(lower(btrim(mapped->'customer'->>'email')),''))
 ) THEN RETURN jsonb_build_object('state','conflict','reason','target'); END IF;
 IF auto_action='link' AND NOT EXISTS(
  SELECT FROM crest.vehicles v WHERE v.business_id=requested_business AND v.id=auto_target
   AND v.version=auto_version AND v.archived_at IS NULL AND v.kind='customer_vehicle'
   AND (v.id=bound_vehicle OR v.vin_normalized=nullif(translate(regexp_replace(mapped->'vehicle'->>'vin','[^A-Za-z0-9]','','g'),
    'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),''))
 ) THEN RETURN jsonb_build_object('state','conflict','reason','target'); END IF;
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'crm.legacy_contact.decide',1,expected_epoch,payload_digest,expected_actor,'manual')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 IF namespace IS NULL THEN
  INSERT INTO crest.legacy_contact_decision_sources(business_id,batch_id,source_namespace,first_operation_id,created_by)
  VALUES(requested_business,requested_batch,requested_namespace,requested_operation,expected_actor);
 END IF;
 INSERT INTO crest.legacy_contact_decisions(business_id,batch_id,source_row,source_namespace,row_fingerprint,revision,
  customer_action,customer_id,customer_version,vehicle_action,vehicle_id,vehicle_version,operation_id,created_by)
 VALUES(requested_business,requested_batch,requested_row,requested_namespace,digest,expected_revision+1,
  contact_action,contact_target,contact_version,auto_action,auto_target,auto_version,requested_operation,expected_actor)
 RETURNING * INTO saved;
 receipt:=crest_private.legacy_contact_decision_receipt(saved);
 IF previous.id IS NOT NULL THEN before_receipt:=crest_private.legacy_contact_decision_receipt(previous); END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'legacy_contact_decisions',saved.id,saved.revision,
  'decide',jsonb_build_object('schemaVersion',1,'before',before_receipt,'after',receipt),'manual');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
  WHERE (business_id,operation_id)=(requested_business,requested_operation);
 PERFORM crest_commands.finish_customer_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 RETURN jsonb_build_object('state','committed','receipt',receipt);
END
$save$;

CREATE OR REPLACE FUNCTION crest_private.legacy_contact_approval_evidence(requested_business uuid,requested_batch uuid) RETURNS jsonb
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
   (mc.customer_id IS NOT NULL AND (d.customer_action='create' OR d.customer_action='link' AND d.customer_id<>mc.customer_id)) AS customer_binding_conflict,
   (mv.vehicle_id IS NOT NULL AND (d.vehicle_action='create' OR d.vehicle_action='link' AND d.vehicle_id<>mv.vehicle_id)) AS vehicle_binding_conflict,
   (d.customer_action='link' AND (c.id IS NULL OR c.archived_at IS NOT NULL OR c.version<>d.customer_version)
    OR d.vehicle_action='link' AND (v.id IS NULL OR v.archived_at IS NOT NULL OR v.kind<>'customer_vehicle' OR v.version<>d.vehicle_version)) AS stale
  FROM latest d JOIN crest.legacy_contact_batch_rows r
   ON r.business_id=d.business_id AND r.batch_id=d.batch_id AND r.source_row=d.source_row AND r.fingerprint=d.row_fingerprint
  LEFT JOIN crest.customers c ON c.business_id=d.business_id AND c.id=d.customer_id
  LEFT JOIN crest.vehicles v ON v.business_id=d.business_id AND v.id=d.vehicle_id
  LEFT JOIN crest.legacy_contact_external_identities mc ON
   (mc.business_id,mc.source_namespace,mc.entity_kind,mc.external_id)=(d.business_id,d.source_namespace,'customer',r.candidate->'customer'->>'sourceId')
  LEFT JOIN crest.legacy_contact_external_identities mv ON
   (mv.business_id,mv.source_namespace,mv.entity_kind,mv.external_id)=(d.business_id,d.source_namespace,'vehicle',r.candidate->'vehicle'->>'sourceId')
 ), customer_groups AS (
  SELECT customer_source,min(customer_action) AS intended,
    count(DISTINCT jsonb_build_array(customer_action,customer_id,customer_version,CASE WHEN customer_action='create' THEN customer END))>1 OR bool_or(customer_binding_conflict) AS conflicted
  FROM selected WHERE customer_action<>'skip' GROUP BY customer_source
 ), vehicle_groups AS (
  SELECT vehicle_source,min(vehicle_action) AS intended,
   count(DISTINCT jsonb_build_array(vehicle_action,vehicle_id,vehicle_version,CASE WHEN vehicle_action='create' THEN vehicle END))>1
     OR count(DISTINCT jsonb_build_array(customer_action,
       CASE WHEN customer_action='link' THEN customer_id::text ELSE customer_source END))
       FILTER(WHERE vehicle_action IN ('create','link'))>1 OR bool_or(vehicle_binding_conflict) AS conflicted
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
   ON a.business_id=requested_business AND a.batch_id=c.id AND a.evidence_sha256=c.evidence_sha256 AND c.stale=0 AND c.conflicts=0
 ) END
$evidence$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_legacy_contact_decision_owner;

-- Apply the approved CRM records and retain one typed outcome for every source row.
-- Source pairing is reconciliation evidence. This command does not assign a
-- live vehicle owner, keeper, or billing customer from CSV co-occurrence.
CREATE ROLE crest_legacy_contact_apply_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_legacy_contact_apply_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_legacy_contact_apply_owner;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),
 crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),
 crest_commands.finish_customer_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
 crest_private.customer_projection(crest.customers),crest_private.vehicle_projection(crest.vehicles)
 TO crest_legacy_contact_apply_owner;
ALTER FUNCTION crest_private.legacy_contact_approval_evidence(uuid,uuid) SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_approval_evidence(uuid,uuid) TO crest_legacy_contact_apply_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.legacy_contact_applications (
 business_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 evidence_sha256 text COLLATE "C" NOT NULL,
 operation_id uuid NOT NULL,
 applied_by uuid NOT NULL,
 PRIMARY KEY(business_id,batch_id),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,batch_id,evidence_sha256) REFERENCES crest.legacy_contact_approvals(business_id,batch_id,evidence_sha256),
 FOREIGN KEY(business_id,operation_id,applied_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.legacy_contact_application_rows (
 business_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 source_row integer NOT NULL,
 decision_revision integer NOT NULL,
 customer_action text NOT NULL CHECK(customer_action IN ('create','link','skip')),
 customer_id uuid,
 customer_version bigint,
 vehicle_action text NOT NULL CHECK(vehicle_action IN ('create','link','skip','none')),
 vehicle_id uuid,
 vehicle_version bigint,
 PRIMARY KEY(business_id,batch_id,source_row),
 FOREIGN KEY(business_id,batch_id) REFERENCES crest.legacy_contact_applications(business_id,batch_id),
 FOREIGN KEY(business_id,batch_id,source_row,decision_revision)
  REFERENCES crest.legacy_contact_decisions(business_id,batch_id,source_row,revision),
 CONSTRAINT legacy_apply_row_customer_fk FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CONSTRAINT legacy_apply_row_vehicle_fk FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((customer_action IN ('create','link'))=(customer_id IS NOT NULL) AND (customer_id IS NULL)=(customer_version IS NULL)
  AND (customer_version IS NULL OR customer_version>0)),
 CHECK((vehicle_action IN ('create','link'))=(vehicle_id IS NOT NULL) AND (vehicle_id IS NULL)=(vehicle_version IS NULL)
  AND (vehicle_version IS NULL OR vehicle_version>0)),
 CHECK(customer_action<>'skip' OR vehicle_action='none')
);

-- Large imports add enough records to change the right plan for PostgreSQL's
-- built-in foreign-key probes. Refresh only the two fixed target statistics,
-- through the existing schema owner, without lending maintenance privileges.
CREATE FUNCTION crest_private.refresh_legacy_contact_target_statistics(refresh_customers boolean,refresh_vehicles boolean)
 RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $statistics$
BEGIN
 IF refresh_customers THEN ANALYZE crest.customers (business_id,id); END IF;
 IF refresh_vehicles THEN ANALYZE crest.vehicles (business_id,id); END IF;
END
$statistics$;
REVOKE ALL ON FUNCTION crest_private.refresh_legacy_contact_target_statistics(boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.refresh_legacy_contact_target_statistics(boolean,boolean) TO crest_legacy_contact_apply_owner;

-- Scope the single-purpose writer and its lock-only permissions to the verified actor.
DO $policy$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['legacy_contact_applications','legacy_contact_application_rows','legacy_contact_external_identities',
   'legacy_contact_decisions','legacy_contact_batch_rows','customers','vehicles'] LOOP
  EXECUTE format('CREATE POLICY legacy_apply_read ON crest.%I FOR SELECT TO crest_legacy_contact_apply_owner
   USING(business_id=nullif(current_setting(''crest.legacy_apply_business_id'',true),'''')::uuid)',relation);
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['legacy_contact_applications','legacy_contact_application_rows'] LOOP
  EXECUTE format('ALTER TABLE crest.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE crest.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE TRIGGER legacy_apply_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.%I
   FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal()',relation);
 END LOOP;
END
$policy$;
GRANT SELECT,INSERT ON crest.legacy_contact_applications,crest.legacy_contact_application_rows,crest.legacy_contact_external_identities
 TO crest_legacy_contact_apply_owner;
GRANT SELECT ON crest.legacy_contact_decisions,crest.legacy_contact_batch_rows,crest.customers,crest.vehicles TO crest_legacy_contact_apply_owner;
GRANT INSERT(id,business_id,display_name,phone_raw,email_raw,outreach_opt_out,notes,customer_since,created_by,updated_by,origin,operation_id,import_row_id)
 ON crest.customers TO crest_legacy_contact_apply_owner;
GRANT INSERT(id,business_id,label,year,make,model,color,vin_raw,plate,kind,created_by,updated_by,origin,operation_id,import_row_id)
 ON crest.vehicles TO crest_legacy_contact_apply_owner;
GRANT UPDATE(id) ON crest.customers,crest.vehicles TO crest_legacy_contact_apply_owner;
CREATE POLICY legacy_apply_lock_customer ON crest.customers FOR UPDATE TO crest_legacy_contact_apply_owner
 USING(business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY legacy_apply_lock_vehicle ON crest.vehicles FOR UPDATE TO crest_legacy_contact_apply_owner
 USING(business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid) WITH CHECK(false);
GRANT SELECT,INSERT,UPDATE(state,result,result_schema_version) ON crest_private.operations TO crest_legacy_contact_apply_owner;
GRANT INSERT ON crest_private.audit_events TO crest_legacy_contact_apply_owner;
CREATE POLICY legacy_apply_operation_read ON crest_private.operations FOR SELECT TO crest_legacy_contact_apply_owner
 USING(command_type='crm.legacy_contact.apply' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid);
CREATE POLICY legacy_apply_operation_insert ON crest_private.operations FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(command_type='crm.legacy_contact.apply' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND schema_version=1 AND state='pending'
  AND origin='import' AND import_row_id IS NULL);
CREATE POLICY legacy_apply_operation_commit ON crest_private.operations FOR UPDATE TO crest_legacy_contact_apply_owner
 USING(command_type='crm.legacy_contact.apply' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='pending')
 WITH CHECK(command_type='crm.legacy_contact.apply' AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='committed');
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
-- Evaluate the one operation claim once per statement. Each inserted row
-- separately proves it belongs to the scoped business, operation and actor.
CREATE FUNCTION crest_private.legacy_contact_apply_pending()
 RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $pending$
 SELECT EXISTS(SELECT FROM crest_private.operations o WHERE
  o.business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND o.operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND o.actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND o.state='pending' AND o.command_type='crm.legacy_contact.apply')
$pending$;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE POLICY legacy_apply_insert ON crest.legacy_contact_applications FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND applied_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND (SELECT crest_private.legacy_contact_apply_pending()));
CREATE POLICY legacy_apply_rows_insert ON crest.legacy_contact_application_rows FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND batch_id=nullif(current_setting('crest.legacy_apply_batch_id',true),'')::uuid
  AND (SELECT EXISTS(SELECT FROM crest.legacy_contact_applications a
   WHERE a.business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
    AND a.batch_id=nullif(current_setting('crest.legacy_apply_batch_id',true),'')::uuid
    AND a.operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
    AND a.applied_by=nullif(current_setting('crest.actor_id',true),'')::uuid))
  AND (SELECT crest_private.legacy_contact_apply_pending()));
CREATE POLICY legacy_apply_identity_insert ON crest.legacy_contact_external_identities FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND first_batch_id=nullif(current_setting('crest.legacy_apply_batch_id',true),'')::uuid
  AND first_apply_operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND (SELECT crest_private.legacy_contact_apply_pending()));
CREATE POLICY legacy_apply_customer_insert ON crest.customers FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(origin='import' AND import_row_id IS NOT NULL AND created_by=updated_by
  AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND (SELECT crest_private.legacy_contact_apply_pending()));
CREATE POLICY legacy_apply_vehicle_insert ON crest.vehicles FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(origin='import' AND import_row_id IS NOT NULL AND created_by=updated_by AND kind='customer_vehicle'
  AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND (SELECT crest_private.legacy_contact_apply_pending()));
CREATE POLICY legacy_apply_audit_insert ON crest_private.audit_events FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(origin='import' AND import_row_id IS NULL AND entity_kind IN ('legacy_contact_applications','customers','vehicles')
  AND business_id=nullif(current_setting('crest.legacy_apply_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND (SELECT crest_private.legacy_contact_apply_pending()));
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands,crest_private TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
-- Private apply logic. Its only callers must hold the current business and
-- actor authority before entering. Neither web nor worker roles can invoke it.
CREATE FUNCTION crest_private.commit_legacy_contact_application(
 requested_business uuid,expected_actor uuid,expected_epoch uuid,requested_operation uuid,
 requested_batch uuid,expected_evidence text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp SET row_security=on AS $application$
DECLARE digest text; prior record; evidence jsonb; receipt jsonb; claimed uuid; source_key text; applied_count integer; created_customers integer; created_vehicles integer; previous_scan_setting text;
BEGIN
 PERFORM set_config('crest.legacy_apply_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_batch_id',requested_batch::text,true),
  set_config('crest.legacy_decision_business_id',requested_business::text,true),
  set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id',requested_operation::text,true);
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('crm.legacy_contact.decide',requested_business,requested_batch)::text,0));
 digest:=encode(sha256(convert_to(jsonb_build_array('crm.legacy_contact.apply',1,requested_business,expected_actor,
   expected_epoch,requested_batch,expected_evidence)::text,'UTF8')),'hex');
 SELECT o.state,o.payload_hash,o.result INTO prior FROM crest_private.operations o
  WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation);
 IF FOUND THEN
  IF prior.state='committed' AND prior.payload_hash=digest THEN RETURN jsonb_build_object('state','committed','receipt',prior.result); END IF;
  RETURN jsonb_build_object('state','conflict','reason','operation');
 END IF;
 SELECT a.evidence_sha256,o.result INTO prior FROM crest.legacy_contact_applications a JOIN crest_private.operations o
  USING(business_id,operation_id) WHERE (a.business_id,a.batch_id)=(requested_business,requested_batch);
 IF FOUND THEN
  IF prior.evidence_sha256=expected_evidence THEN RETURN jsonb_build_object('state','already_applied','receipt',prior.result); END IF;
  RETURN jsonb_build_object('state','conflict','reason','applied');
 END IF;
 evidence:=crest_private.legacy_contact_approval_evidence(requested_business,requested_batch);
 source_key:=evidence->>'sourceNamespace';
 IF evidence->>'evidenceSha256' IS DISTINCT FROM expected_evidence OR evidence->>'state'<>'ready'
  OR evidence->>'approval' IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','approval'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('crm.legacy_contact.source',requested_business,source_key)::text,0));
 -- Lock existing targets in a stable order and reread the proof afterward.
 PERFORM c.id FROM crest.customers c JOIN (
  SELECT DISTINCT d.customer_id FROM (SELECT DISTINCT ON(source_row) source_row,customer_id FROM crest.legacy_contact_decisions
   WHERE (business_id,batch_id)=(requested_business,requested_batch) ORDER BY source_row,revision DESC) d WHERE d.customer_id IS NOT NULL
 ) target ON target.customer_id=c.id WHERE c.business_id=requested_business ORDER BY c.id FOR NO KEY UPDATE OF c;
 PERFORM v.id FROM crest.vehicles v JOIN (
  SELECT DISTINCT d.vehicle_id FROM (SELECT DISTINCT ON(source_row) source_row,vehicle_id FROM crest.legacy_contact_decisions
   WHERE (business_id,batch_id)=(requested_business,requested_batch) ORDER BY source_row,revision DESC) d WHERE d.vehicle_id IS NOT NULL
 ) target ON target.vehicle_id=v.id WHERE v.business_id=requested_business ORDER BY v.id FOR NO KEY UPDATE OF v;
 evidence:=crest_private.legacy_contact_approval_evidence(requested_business,requested_batch);
 IF evidence->>'evidenceSha256' IS DISTINCT FROM expected_evidence OR evidence->>'state'<>'ready'
  OR evidence->>'approval' IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','approval'); END IF;

 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
 VALUES(requested_business,requested_operation,expected_actor,'crm.legacy_contact.apply',1,expected_epoch,digest,expected_actor,'import')
 ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
 INSERT INTO crest.legacy_contact_applications VALUES(requested_business,requested_batch,expected_evidence,requested_operation,expected_actor);
 -- The result retains the first chosen target per external ID, including
 -- duplicate input rows. Deferred target FKs are checked before commit.
 WITH chosen AS MATERIALIZED (
  SELECT DISTINCT ON(d.source_row) d.*, (r.candidate->'customer'->>'sourceId') COLLATE "C" AS customer_source,
   (r.candidate->'vehicle'->>'sourceId') COLLATE "C" AS vehicle_source
  FROM crest.legacy_contact_decisions d JOIN crest.legacy_contact_batch_rows r USING(business_id,batch_id,source_row)
  WHERE (d.business_id,d.batch_id)=(requested_business,requested_batch)
  ORDER BY d.source_row,d.revision DESC
 ), contacts AS MATERIALIZED (
  SELECT DISTINCT ON(customer_source) customer_source,coalesce(customer_id,gen_random_uuid()) AS target
  FROM chosen WHERE customer_action IN ('create','link') ORDER BY customer_source,source_row
 ), autos AS MATERIALIZED (
  SELECT DISTINCT ON(vehicle_source) vehicle_source,coalesce(vehicle_id,gen_random_uuid()) AS target
  FROM chosen WHERE vehicle_action IN ('create','link') ORDER BY vehicle_source,source_row
 )
 INSERT INTO crest.legacy_contact_application_rows
 SELECT requested_business,requested_batch,d.source_row,d.revision,d.customer_action,c.target,
  CASE d.customer_action WHEN 'create' THEN 1 ELSE d.customer_version END,
  d.vehicle_action,v.target,CASE d.vehicle_action WHEN 'create' THEN 1 ELSE d.vehicle_version END
 FROM chosen d LEFT JOIN contacts c ON c.customer_source=d.customer_source AND d.customer_action IN ('create','link')
 LEFT JOIN autos v ON v.vehicle_source=d.vehicle_source AND d.vehicle_action IN ('create','link');
 GET DIAGNOSTICS applied_count=ROW_COUNT;
 IF applied_count<>(evidence->>'rowCount')::integer THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_ROW_COUNT_REQUIRED';
 END IF;

 WITH source AS (
  SELECT DISTINCT ON(outcome.customer_id) outcome.customer_id,d.id AS decision_id,r.candidate->'customer' AS c
  FROM crest.legacy_contact_application_rows outcome
  JOIN crest.legacy_contact_batch_rows r USING(business_id,batch_id,source_row)
  JOIN crest.legacy_contact_decisions d ON (d.business_id,d.batch_id,d.source_row,d.revision)=
   (outcome.business_id,outcome.batch_id,outcome.source_row,outcome.decision_revision)
  WHERE (outcome.business_id,outcome.batch_id)=(requested_business,requested_batch) AND outcome.customer_action='create'
  ORDER BY outcome.customer_id,outcome.source_row
 ), inserted AS (
  INSERT INTO crest.customers(id,business_id,display_name,phone_raw,email_raw,outreach_opt_out,notes,customer_since,
   created_by,updated_by,origin,operation_id,import_row_id)
  SELECT customer_id,requested_business,c->>'displayName',c->>'phone',c->>'email',
   coalesce((c->>'outreachOptOut')::boolean,true),c->>'notes',(c->>'customerSince')::date,
   expected_actor,expected_actor,'import',requested_operation,decision_id FROM source RETURNING *
 )
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 SELECT business_id,requested_operation,expected_actor,expected_actor,'customers',id,1,'create',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.customer_projection(inserted::crest.customers)),'import' FROM inserted;
 GET DIAGNOSTICS created_customers=ROW_COUNT;

 WITH source AS (
  SELECT DISTINCT ON(outcome.vehicle_id) outcome.vehicle_id,d.id AS decision_id,r.candidate->'vehicle' AS v
  FROM crest.legacy_contact_application_rows outcome
  JOIN crest.legacy_contact_batch_rows r USING(business_id,batch_id,source_row)
  JOIN crest.legacy_contact_decisions d ON (d.business_id,d.batch_id,d.source_row,d.revision)=
   (outcome.business_id,outcome.batch_id,outcome.source_row,outcome.decision_revision)
  WHERE (outcome.business_id,outcome.batch_id)=(requested_business,requested_batch) AND outcome.vehicle_action='create'
  ORDER BY outcome.vehicle_id,outcome.source_row
 ), inserted AS (
  INSERT INTO crest.vehicles(id,business_id,label,year,make,model,color,vin_raw,plate,kind,created_by,updated_by,origin,operation_id,import_row_id)
  SELECT vehicle_id,requested_business,v->>'label',(v->>'year')::integer,v->>'make',v->>'model',v->>'color',v->>'vin',v->>'plate',
   'customer_vehicle',expected_actor,expected_actor,'import',requested_operation,decision_id FROM source RETURNING *
 )
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 SELECT business_id,requested_operation,expected_actor,expected_actor,'vehicles',id,1,'create',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.vehicle_projection(inserted::crest.vehicles)),'import' FROM inserted;
 GET DIAGNOSTICS created_vehicles=ROW_COUNT;
 IF created_customers>=10000 OR created_vehicles>=10000 THEN
  PERFORM crest_private.refresh_legacy_contact_target_statistics(created_customers>=10000,created_vehicles>=10000);
 END IF;

 -- A cached foreign-key check may pick a sequential scan using the old
 -- table size and then repeat it for each of the newly created targets.
 previous_scan_setting:=current_setting('enable_seqscan');
 PERFORM set_config('enable_seqscan','off',true);
 -- Let the full unique key arbitrate repeat source IDs. A tenant/namespace
 -- anti-join can repeatedly scan newly indexed candidates during this insert.
 -- The deferred application proof still requires an exact target for every row.
 WITH targets AS (
  SELECT outcome.source_row,outcome.decision_revision,outcome.customer_id,outcome.vehicle_id,kind.entity_kind,(r.candidate->kind.entity_kind->>'sourceId') COLLATE "C" AS external_id
  FROM crest.legacy_contact_application_rows outcome JOIN crest.legacy_contact_batch_rows r USING(business_id,batch_id,source_row)
  CROSS JOIN (VALUES ('customer'),('vehicle')) kind(entity_kind)
  WHERE (outcome.business_id,outcome.batch_id)=(requested_business,requested_batch)
   AND CASE kind.entity_kind WHEN 'customer' THEN outcome.customer_id IS NOT NULL ELSE outcome.vehicle_id IS NOT NULL END
 ), first_rows AS (
  SELECT DISTINCT ON(entity_kind,external_id) * FROM targets ORDER BY entity_kind,external_id,source_row
 )
 INSERT INTO crest.legacy_contact_external_identities(business_id,source_namespace,entity_kind,external_id,customer_id,vehicle_id,
  first_batch_id,first_evidence_sha256,first_source_row,first_decision_revision,first_apply_operation_id,created_by)
 SELECT requested_business,source_key,f.entity_kind,f.external_id,
  CASE WHEN f.entity_kind='customer' THEN f.customer_id END,CASE WHEN f.entity_kind='vehicle' THEN f.vehicle_id END,
  requested_batch,expected_evidence,f.source_row,f.decision_revision,requested_operation,expected_actor
 FROM first_rows f
 ON CONFLICT(business_id,source_namespace,entity_kind,external_id) DO NOTHING;
 PERFORM set_config('enable_seqscan',previous_scan_setting,true);

 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,
  'approvalId',evidence->'approval'->'approvalId','evidenceSha256',expected_evidence,'sourceNamespace',source_key,
  'operationId',requested_operation,'rowCount',applied_count,'skippedRows',count(*) FILTER(WHERE customer_action='skip'),
  'customersCreated',count(DISTINCT customer_id) FILTER(WHERE customer_action='create'),
  'vehiclesCreated',count(DISTINCT vehicle_id) FILTER(WHERE vehicle_action='create'),
  'rowsWithVehiclePair',count(*) FILTER(WHERE vehicle_id IS NOT NULL))
 INTO receipt FROM crest.legacy_contact_application_rows WHERE (business_id,batch_id)=(requested_business,requested_batch);
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
 VALUES(requested_business,requested_operation,expected_actor,expected_actor,'legacy_contact_applications',requested_batch,1,'apply',
  jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'import');
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
  WHERE (business_id,operation_id)=(requested_business,requested_operation);
 -- Run the retained relationship and receipt constraints before returning
 -- from this command, with indexed lookups favored for the newly written rows.
 PERFORM set_config('enable_seqscan','off',true);
 SET CONSTRAINTS crest.legacy_apply_row_customer_fk,crest.legacy_apply_row_vehicle_fk,
  crest.legacy_external_identity_verify,crest.legacy_application_verify IMMEDIATE;
 SET CONSTRAINTS crest.legacy_apply_row_customer_fk,crest.legacy_apply_row_vehicle_fk,
  crest.legacy_external_identity_verify,crest.legacy_application_verify DEFERRED;
 PERFORM set_config('enable_seqscan',previous_scan_setting,true);
 RETURN jsonb_build_object('state','committed','receipt',receipt,'newlyCommitted',true);
END
$application$;
REVOKE ALL ON FUNCTION crest_private.commit_legacy_contact_application(uuid,uuid,uuid,uuid,uuid,text) FROM PUBLIC;

CREATE FUNCTION crest_commands.apply_legacy_contact_batch(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,expected_evidence text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $apply$
DECLARE result jsonb;
BEGIN
 IF requested_batch IS NULL OR requested_operation IS NULL OR expected_evidence IS NULL OR expected_evidence!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 result:=crest_private.commit_legacy_contact_application(requested_business,expected_actor,expected_epoch,requested_operation,requested_batch,expected_evidence);
 IF result->>'newlyCommitted'='true' THEN
  PERFORM crest_commands.finish_customer_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 END IF;
 RETURN result-'newlyCommitted';
END
$apply$;
CREATE FUNCTION crest_commands.read_legacy_contact_application(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid,after_row integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; receipt jsonb; page jsonb;
BEGIN
 IF requested_batch IS NULL OR after_row IS NULL OR after_row NOT BETWEEN 1 AND 100001 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_PAGE_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_apply_business_id',authority->>'businessId',true);
 SELECT o.result INTO receipt FROM crest.legacy_contact_applications a JOIN crest_private.operations o
 USING(business_id,operation_id) WHERE (a.business_id,a.batch_id)=(requested_business,requested_batch) AND o.state='committed';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 WITH candidates AS MATERIALIZED (
  SELECT * FROM crest.legacy_contact_application_rows WHERE (business_id,batch_id)=(requested_business,requested_batch)
   AND source_row>after_row ORDER BY source_row LIMIT 26
 ), visible AS (SELECT * FROM candidates ORDER BY source_row LIMIT 25)
 SELECT jsonb_build_object('rows',coalesce(jsonb_agg(jsonb_build_object('row',source_row,'decisionRevision',decision_revision,
  'customerAction',customer_action,'customerId',customer_id,'customerVersion',customer_version::text,
  'vehicleAction',vehicle_action,'vehicleId',vehicle_id,'vehicleVersion',vehicle_version::text) ORDER BY source_row),'[]'::jsonb),
  'hasMore',(SELECT count(*)>25 FROM candidates)) INTO page FROM visible;
 RETURN jsonb_build_object('state','present','receipt',receipt)||page;
END
$read$;
REVOKE ALL ON FUNCTION crest_commands.read_legacy_contact_application(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_legacy_contact_application(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) TO crest_web;
REVOKE ALL ON FUNCTION crest_commands.apply_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.apply_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands,crest_private FROM crest_legacy_contact_apply_owner;

-- Verify the entire set once per application, even when several source rows
-- share one customer or vehicle. Audit/receipt and outcomes commit together.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.legacy_contact_application_rows TO crest_customer_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta)
 ON crest_private.audit_events TO crest_customer_integrity_owner;
CREATE POLICY legacy_application_integrity_rows ON crest.legacy_contact_application_rows FOR SELECT TO crest_customer_integrity_owner USING(true);
CREATE POLICY legacy_application_integrity_audit ON crest_private.audit_events FOR SELECT TO crest_customer_integrity_owner
 USING(entity_kind='legacy_contact_applications');
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
SET LOCAL ROLE crest_customer_integrity_owner;
CREATE FUNCTION crest_private.verify_legacy_contact_application() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $proof$
DECLARE approval crest.legacy_contact_approvals; observed record; expected jsonb;
BEGIN
 SELECT * INTO STRICT approval FROM crest.legacy_contact_approvals WHERE (business_id,batch_id,evidence_sha256)=
  (NEW.business_id,NEW.batch_id,NEW.evidence_sha256);
 SELECT count(*) AS row_count,count(*) FILTER(WHERE r.customer_action='skip') AS skipped,
  count(DISTINCT r.customer_id) FILTER(WHERE r.customer_action='create') AS customers_created,
  count(DISTINCT r.vehicle_id) FILTER(WHERE r.vehicle_action='create') AS vehicles_created,
  count(*) FILTER(WHERE r.vehicle_id IS NOT NULL) AS paired,
  count(*) FILTER(WHERE r.customer_action<>d.customer_action OR r.vehicle_action<>d.vehicle_action
   OR d.customer_action='link' AND ROW(r.customer_id,r.customer_version) IS DISTINCT FROM ROW(d.customer_id,d.customer_version)
   OR d.vehicle_action='link' AND ROW(r.vehicle_id,r.vehicle_version) IS DISTINCT FROM ROW(d.vehicle_id,d.vehicle_version)
   OR d.customer_action='create' AND r.customer_version<>1 OR d.vehicle_action='create' AND r.vehicle_version<>1
   OR r.customer_id IS NOT NULL AND contact.customer_id IS DISTINCT FROM r.customer_id
   OR r.vehicle_id IS NOT NULL AND vehicle.vehicle_id IS DISTINCT FROM r.vehicle_id) AS mismatches,
  encode(sha256(convert_to(coalesce(string_agg(d.row_fingerprint||d.id::text,'' ORDER BY r.source_row),''),'UTF8')),'hex') AS decision_hash
 INTO observed FROM crest.legacy_contact_application_rows r JOIN crest.legacy_contact_decisions d
  ON (d.business_id,d.batch_id,d.source_row,d.revision)=(r.business_id,r.batch_id,r.source_row,r.decision_revision)
 JOIN crest.legacy_contact_batch_rows staged ON (staged.business_id,staged.batch_id,staged.source_row)=(r.business_id,r.batch_id,r.source_row)
 -- Prove each target using all four columns of the unique identity key.
 -- Keep the lookup parameterized after bulk inserts, when statistics lag.
 LEFT JOIN LATERAL (
  SELECT i.customer_id FROM crest.legacy_contact_external_identities i
  WHERE i.business_id=r.business_id AND i.source_namespace=d.source_namespace AND i.entity_kind='customer'
   AND i.external_id=(staged.candidate->'customer'->>'sourceId') COLLATE "C" LIMIT 1
 ) contact ON r.customer_id IS NOT NULL
 LEFT JOIN LATERAL (
  SELECT i.vehicle_id FROM crest.legacy_contact_external_identities i
  WHERE i.business_id=r.business_id AND i.source_namespace=d.source_namespace AND i.entity_kind='vehicle'
   AND i.external_id=(staged.candidate->'vehicle'->>'sourceId') COLLATE "C" LIMIT 1
 ) vehicle ON r.vehicle_id IS NOT NULL
 WHERE (r.business_id,r.batch_id)=(NEW.business_id,NEW.batch_id);
 expected:=jsonb_build_object('schemaVersion',1,'businessId',NEW.business_id,'batchId',NEW.batch_id,
  'approvalId',approval.id,'evidenceSha256',NEW.evidence_sha256,'sourceNamespace',approval.source_namespace,
  'operationId',NEW.operation_id,'rowCount',observed.row_count,'skippedRows',observed.skipped,
  'customersCreated',observed.customers_created,'vehiclesCreated',observed.vehicles_created,'rowsWithVehiclePair',observed.paired);
 IF observed.row_count<>approval.row_count OR observed.skipped<>approval.skipped_rows OR observed.mismatches<>0
  OR observed.decision_hash<>approval.decisions_sha256 OR NOT EXISTS(
   SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
    ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
   WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.applied_by)
    AND o.command_type='crm.legacy_contact.apply' AND o.state='committed' AND o.result=expected
    AND a.entity_kind='legacy_contact_applications' AND a.entity_id=NEW.batch_id AND a.entity_version=1 AND a.action='apply'
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected)
  ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLICATION_PROOF_REQUIRED'; END IF;
 RETURN NULL;
END
$proof$;
REVOKE ALL ON FUNCTION crest_private.verify_legacy_contact_application() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_legacy_contact_application() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER legacy_application_verify AFTER INSERT ON crest.legacy_contact_applications
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_legacy_contact_application();
RESET ROLE;

-- Earlier decision retries still return their retained receipt. A subsequent
-- decision insert cannot change the reviewed plan of an already applied batch.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id,batch_id) ON crest.legacy_contact_applications TO crest_customer_integrity_owner;
CREATE POLICY legacy_application_integrity_head ON crest.legacy_contact_applications FOR SELECT TO crest_customer_integrity_owner USING(true);
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
SET LOCAL ROLE crest_customer_integrity_owner;
CREATE FUNCTION crest_private.reject_applied_legacy_contact_decision() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $decision$
BEGIN
 IF EXISTS(SELECT FROM crest.legacy_contact_applications WHERE (business_id,batch_id)=(NEW.business_id,NEW.batch_id)) THEN
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_LEGACY_APPLIED_DECISIONS_RETAINED';
 END IF;
 RETURN NEW;
END
$decision$;
REVOKE ALL ON FUNCTION crest_private.reject_applied_legacy_contact_decision() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.reject_applied_legacy_contact_decision() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE TRIGGER legacy_application_freeze_decisions BEFORE INSERT ON crest.legacy_contact_decisions
 FOR EACH ROW EXECUTE FUNCTION crest_private.reject_applied_legacy_contact_decision();
RESET ROLE;

-- Held private source for identity and import reconciliation evidence.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.legacy_contact_external_identities,crest.legacy_contact_applications,crest.legacy_contact_application_rows
 TO crest_legacy_contact_export_owner;
DO $policies$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['legacy_contact_external_identities','legacy_contact_applications','legacy_contact_application_rows'] LOOP
  EXECUTE format('CREATE POLICY legacy_application_source_read ON crest.%I FOR SELECT TO crest_legacy_contact_export_owner
   USING(business_id=nullif(current_setting(''crest.legacy_export_business_id'',true),'''')::uuid)',relation);
 END LOOP;
END
$policies$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_application_source_page(
 requested_business uuid,source_kind text,after_batch uuid,after_row integer,
 after_namespace text,after_kind text,after_id text,page_size integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR source_kind IS NULL
  OR source_kind NOT IN ('identity','application','outcome')
  OR (source_kind='identity' AND (after_batch IS NOT NULL OR after_row IS NOT NULL
   OR (after_namespace IS NULL)<>(after_kind IS NULL) OR (after_namespace IS NULL)<>(after_id IS NULL)
   OR after_namespace!~'^[a-z][a-z0-9_-]{1,63}$' OR after_kind NOT IN ('customer','vehicle')
   OR char_length(after_id) NOT BETWEEN 1 AND 200 OR after_id~'[[:cntrl:]]'))
  OR (source_kind<>'identity' AND (after_namespace IS NOT NULL OR after_kind IS NOT NULL OR after_id IS NOT NULL))
  OR (source_kind='application' AND after_row IS NOT NULL)
  OR (source_kind='outcome' AND ((after_batch IS NULL)<>(after_row IS NULL) OR after_row NOT BETWEEN 2 AND 100001)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
 IF source_kind='identity' THEN
  WITH candidates AS MATERIALIZED (
   SELECT i.* FROM crest.legacy_contact_external_identities i WHERE i.business_id=requested_business
    AND (after_namespace IS NULL OR (i.source_namespace,i.entity_kind,i.external_id)>(after_namespace COLLATE "C",after_kind,after_id COLLATE "C"))
   ORDER BY i.source_namespace,i.entity_kind,i.external_id LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY source_namespace,entity_kind,external_id LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY source_namespace,entity_kind,external_id),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 ELSIF source_kind='application' THEN
  WITH candidates AS MATERIALIZED (
   SELECT a.* FROM crest.legacy_contact_applications a WHERE a.business_id=requested_business
    AND (after_batch IS NULL OR a.batch_id>after_batch) ORDER BY a.batch_id LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY batch_id LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY batch_id),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 ELSE
  WITH candidates AS MATERIALIZED (
   SELECT r.* FROM crest.legacy_contact_application_rows r WHERE r.business_id=requested_business
    AND (after_batch IS NULL OR (r.batch_id,r.source_row)>(after_batch,after_row))
   ORDER BY r.batch_id,r.source_row LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY batch_id,source_row LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page)||jsonb_build_object(
   'customer_version',customer_version::text,'vehicle_version',vehicle_version::text) ORDER BY batch_id,source_row),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 END IF;
 RETURN result||jsonb_build_object('schemaVersion',1,'businessId',requested_business,'kind',source_kind);
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_application_source_page(uuid,text,uuid,integer,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_application_source_page(uuid,text,uuid,integer,text,text,text,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;

-- Held background admission for a specific approved contact batch. Store
-- identifiers only. The worker must never receive browser/provider credentials.
-- Recent interactive owner authority is consumed at admission. Closing the
-- browser or signing out after admission leaves the request intact. Account
-- disablement, security-epoch changes, lost business membership/capability,
-- and recovery-epoch changes prevent deferred execution.
-- One worker transaction locks one request. Any thrown error or interruption
-- rolls back the entire import and releases the same request for reconciliation.
CREATE ROLE crest_legacy_contact_dispatch NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON SCHEMA crest,crest_private FROM crest_legacy_contact_dispatch;
GRANT USAGE ON SCHEMA crest_commands TO crest_legacy_contact_dispatch;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest_private.legacy_contact_apply_requests (
 business_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 evidence_sha256 text COLLATE "C" NOT NULL,
 requested_by uuid NOT NULL,
 security_epoch uuid NOT NULL,
 recovery_epoch uuid NOT NULL,
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(requested_at)),
 outcome text CHECK(outcome IN ('committed','already_applied','approval','applied','operation','authority')),
 completed_at timestamptz CHECK(isfinite(completed_at)),
 PRIMARY KEY(business_id,operation_id),
 FOREIGN KEY(business_id,batch_id,evidence_sha256) REFERENCES crest.legacy_contact_approvals(business_id,batch_id,evidence_sha256),
 FOREIGN KEY(business_id,requested_by) REFERENCES crest.memberships(business_id,actor_id),
 CHECK((outcome IS NULL)=(completed_at IS NULL)),
 CHECK(completed_at>=requested_at)
);
CREATE UNIQUE INDEX legacy_contact_apply_single_request ON crest_private.legacy_contact_apply_requests(business_id,batch_id)
 WHERE outcome IS NULL;
CREATE INDEX legacy_contact_apply_requests_batch ON crest_private.legacy_contact_apply_requests(business_id,batch_id,requested_at DESC,operation_id DESC);
CREATE INDEX legacy_contact_apply_requests_pending ON crest_private.legacy_contact_apply_requests(requested_at,business_id,operation_id)
 WHERE outcome IS NULL;
ALTER TABLE crest_private.legacy_contact_apply_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest_private.legacy_contact_apply_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE(outcome,completed_at) ON crest_private.legacy_contact_apply_requests TO crest_legacy_contact_apply_owner;
CREATE POLICY legacy_apply_request_tenant_read ON crest_private.legacy_contact_apply_requests
 FOR SELECT TO crest_legacy_contact_apply_owner
 USING(business_id=nullif(current_setting('crest.legacy_apply_request_business_id',true),'')::uuid
   OR current_setting('crest.legacy_apply_dispatch',true)='1');
CREATE POLICY legacy_apply_request_admission ON crest_private.legacy_contact_apply_requests
 FOR INSERT TO crest_legacy_contact_apply_owner
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_request_business_id',true),'')::uuid
   AND outcome IS NULL AND completed_at IS NULL);
CREATE POLICY legacy_apply_request_dispatch ON crest_private.legacy_contact_apply_requests
 FOR UPDATE TO crest_legacy_contact_apply_owner
 USING(current_setting('crest.legacy_apply_dispatch',true)='1' AND outcome IS NULL)
 WITH CHECK(current_setting('crest.legacy_apply_dispatch',true)='1' AND outcome IS NOT NULL);
CREATE TRIGGER legacy_apply_request_retained BEFORE DELETE OR TRUNCATE ON crest_private.legacy_contact_apply_requests
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

-- The session owner already owns the authority boundary and can read the same
-- business/security/recovery records. Allow it to lock, but not edit, membership.
GRANT UPDATE(id) ON crest.memberships TO crest_session_owner;
CREATE POLICY legacy_apply_authority_membership_lock ON crest.memberships FOR UPDATE TO crest_session_owner
 USING(business_id=nullif(current_setting('crest.legacy_apply_authority_business_id',true),'')::uuid
   AND actor_id=nullif(current_setting('crest.legacy_apply_authority_actor_id',true),'')::uuid)
 WITH CHECK(false);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_session_owner;
SET LOCAL ROLE crest_session_owner;
CREATE FUNCTION crest_private.legacy_contact_request_security_epoch(requested_actor uuid) RETURNS uuid
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $security$
 SELECT a.current_security_epoch FROM crest_private.actors a WHERE a.id=requested_actor AND a.disabled_at IS NULL AND a.kind='owner'
$security$;
CREATE FUNCTION crest_private.lock_legacy_contact_worker_authority(
 requested_business uuid,requested_actor uuid,security_epoch uuid,recovery_epoch uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $authority$
DECLARE current_security uuid; business_status text; member_role text; can_write boolean; current_recovery uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MUTATION_FRESH_READ_REQUIRED';
 END IF;
 SELECT a.current_security_epoch INTO current_security FROM crest_private.actors a
  WHERE a.id=requested_actor AND a.kind='owner' AND a.disabled_at IS NULL FOR SHARE;
 IF current_security IS DISTINCT FROM security_epoch THEN RETURN false; END IF;
 SELECT b.status INTO business_status FROM crest.businesses b WHERE b.id=requested_business FOR SHARE;
 IF business_status IS NULL OR business_status NOT IN ('setup','active') THEN RETURN false; END IF;
 PERFORM set_config('crest.legacy_apply_authority_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_authority_actor_id',requested_actor::text,true);
 SELECT m.role INTO member_role FROM crest.memberships m
  WHERE (m.business_id,m.actor_id)=(requested_business,requested_actor) AND m.active FOR SHARE;
 IF member_role IS NULL OR NOT EXISTS(SELECT FROM crest_private.role_capabilities c WHERE c.role=member_role AND c.capability='crm.manage')
  THEN RETURN false; END IF;
 SELECT r.active_epoch,r.writes_enabled INTO current_recovery,can_write
  FROM crest_private.business_recovery_authorities r WHERE r.business_id=requested_business FOR SHARE;
 RETURN current_recovery IS NOT DISTINCT FROM recovery_epoch AND can_write IS TRUE;
END
$authority$;
REVOKE ALL ON FUNCTION crest_private.legacy_contact_request_security_epoch(uuid),
 crest_private.lock_legacy_contact_worker_authority(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_request_security_epoch(uuid),
 crest_private.lock_legacy_contact_worker_authority(uuid,uuid,uuid,uuid) TO crest_legacy_contact_apply_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_session_owner;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
CREATE FUNCTION crest_commands.request_legacy_contact_application(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,expected_evidence text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $request$
DECLARE prior record; evidence jsonb; actor_epoch uuid;
BEGIN
 IF requested_batch IS NULL OR requested_operation IS NULL OR expected_evidence IS NULL OR expected_evidence!~'^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_INPUT_REQUIRED';
 END IF;
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',true);
 PERFORM set_config('crest.legacy_apply_request_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_dispatch','0',true),
  set_config('crest.legacy_decision_business_id',requested_business::text,true);
 SELECT q.* INTO prior FROM crest_private.legacy_contact_apply_requests q
  WHERE (q.business_id,q.operation_id)=(requested_business,requested_operation);
 IF FOUND THEN
  IF (prior.batch_id,prior.evidence_sha256,prior.requested_by,prior.recovery_epoch)
    IS DISTINCT FROM (requested_batch,expected_evidence,expected_actor,expected_epoch)
   THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  RETURN jsonb_build_object('state',coalesce(prior.outcome,'queued'),'operationId',prior.operation_id);
 END IF;
 evidence:=crest_private.legacy_contact_approval_evidence(requested_business,requested_batch);
 IF evidence->>'state' IS DISTINCT FROM 'ready' OR evidence->>'evidenceSha256' IS DISTINCT FROM expected_evidence
   OR evidence->>'approval' IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','approval'); END IF;
 actor_epoch:=crest_private.legacy_contact_request_security_epoch(expected_actor);
 INSERT INTO crest_private.legacy_contact_apply_requests(business_id,operation_id,batch_id,evidence_sha256,requested_by,security_epoch,recovery_epoch)
 VALUES(requested_business,requested_operation,requested_batch,expected_evidence,expected_actor,actor_epoch,expected_epoch)
 ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN jsonb_build_object('state','queued','operationId',requested_operation); END IF;
 -- An exact concurrent request is allowed to acknowledge the existing intent.
 -- A different pending approval must be executed or rejected before requeueing.
 SELECT q.* INTO prior FROM crest_private.legacy_contact_apply_requests q
  WHERE q.business_id=requested_business AND (q.operation_id=requested_operation OR (q.batch_id=requested_batch AND q.outcome IS NULL))
  ORDER BY (q.operation_id=requested_operation) DESC LIMIT 1;
 IF FOUND AND (prior.batch_id,prior.evidence_sha256,prior.requested_by,prior.recovery_epoch)
   IS NOT DISTINCT FROM (requested_batch,expected_evidence,expected_actor,expected_epoch) THEN
  RETURN jsonb_build_object('state',coalesce(prior.outcome,'queued'),'operationId',prior.operation_id);
 END IF;
 RETURN jsonb_build_object('state','conflict','reason','operation');
END
$request$;

CREATE FUNCTION crest_commands.read_legacy_contact_apply_request(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
DECLARE prior record;
BEGIN
 PERFORM crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_apply_request_business_id',requested_business::text,true),
  set_config('crest.legacy_apply_dispatch','0',true);
 SELECT q.operation_id,q.outcome INTO prior FROM crest_private.legacy_contact_apply_requests q
  WHERE (q.business_id,q.batch_id)=(requested_business,requested_batch)
  ORDER BY q.requested_at DESC,q.operation_id DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 RETURN jsonb_build_object('state',coalesce(prior.outcome,'queued'),'operationId',prior.operation_id);
END
$status$;

CREATE FUNCTION crest_commands.run_next_legacy_contact_application() RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $dispatch$
DECLARE request crest_private.legacy_contact_apply_requests; result jsonb; final_outcome text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_MUTATION_FRESH_READ_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 SELECT q.* INTO request FROM crest_private.legacy_contact_apply_requests q WHERE q.outcome IS NULL
  ORDER BY q.requested_at,q.business_id,q.operation_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN false; END IF;
 IF crest_private.lock_legacy_contact_worker_authority(request.business_id,request.requested_by,request.security_epoch,request.recovery_epoch) THEN
  result:=crest_private.commit_legacy_contact_application(request.business_id,request.requested_by,request.recovery_epoch,
   request.operation_id,request.batch_id,request.evidence_sha256);
  final_outcome:=CASE WHEN result->>'state'='conflict' THEN result->>'reason' ELSE result->>'state' END;
 ELSE
  final_outcome:='authority';
 END IF;
 IF final_outcome IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_OUTCOME_REQUIRED'; END IF;
 UPDATE crest_private.legacy_contact_apply_requests SET outcome=final_outcome,completed_at=clock_timestamp()
  WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_REQUEST_REQUIRED'; END IF;
 RETURN true;
END
$dispatch$;
REVOKE ALL ON FUNCTION crest_commands.request_legacy_contact_application(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_legacy_contact_apply_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
 crest_commands.run_next_legacy_contact_application() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.request_legacy_contact_application(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text),
 crest_commands.read_legacy_contact_apply_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.run_next_legacy_contact_application() TO crest_legacy_contact_dispatch;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_apply_owner;

-- Held worker restart and retry behavior. A persisted lease starts in a short
-- committed transaction. The application and its terminal outcome still share
-- one transaction, so a lost response cannot repeat a committed import.
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest_private.legacy_contact_apply_requests
 DROP CONSTRAINT legacy_contact_apply_requests_outcome_check,
 ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
 ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(next_attempt_at)),
 ADD COLUMN lease_id uuid,
 ADD COLUMN lease_expires_at timestamptz CHECK(isfinite(lease_expires_at)),
 ADD CONSTRAINT legacy_apply_request_lease_pair CHECK((lease_id IS NULL)=(lease_expires_at IS NULL)),
 ADD CONSTRAINT legacy_apply_request_lease_open CHECK(lease_id IS NULL OR (outcome IS NULL AND attempt_count>0)),
 ADD CONSTRAINT legacy_contact_apply_requests_outcome_check
  CHECK(outcome IN ('committed','already_applied','approval','applied','operation','authority','review'));
CREATE UNIQUE INDEX legacy_apply_request_lease ON crest_private.legacy_contact_apply_requests(lease_id) WHERE lease_id IS NOT NULL;
DROP INDEX crest_private.legacy_contact_apply_requests_pending;
CREATE INDEX legacy_contact_apply_requests_pending ON crest_private.legacy_contact_apply_requests(next_attempt_at,requested_at,business_id,operation_id)
 WHERE outcome IS NULL;
GRANT UPDATE(attempt_count,next_attempt_at,lease_id,lease_expires_at)
 ON crest_private.legacy_contact_apply_requests TO crest_legacy_contact_apply_owner;
ALTER POLICY legacy_apply_request_admission ON crest_private.legacy_contact_apply_requests
 WITH CHECK(business_id=nullif(current_setting('crest.legacy_apply_request_business_id',true),'')::uuid
  AND outcome IS NULL AND completed_at IS NULL AND attempt_count=0 AND lease_id IS NULL AND lease_expires_at IS NULL);
ALTER POLICY legacy_apply_request_dispatch ON crest_private.legacy_contact_apply_requests
 WITH CHECK(current_setting('crest.legacy_apply_dispatch',true)='1');
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_apply_owner;
SET LOCAL ROLE crest_legacy_contact_apply_owner;
-- The worker supplies a random attempt identifier before contacting PostgreSQL.
-- It can release an uncertain claim using that same identifier.
CREATE FUNCTION crest_commands.claim_legacy_contact_application(requested_lease uuid) RETURNS text
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $claim$
DECLARE request crest_private.legacy_contact_apply_requests; stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR requested_lease IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_LEASE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 stamp:=clock_timestamp();
 SELECT q.* INTO request FROM crest_private.legacy_contact_apply_requests q
  WHERE q.outcome IS NULL AND q.next_attempt_at<=stamp AND (q.lease_expires_at IS NULL OR q.lease_expires_at<=stamp)
  ORDER BY q.next_attempt_at,q.requested_at,q.business_id,q.operation_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN 'idle'; END IF;
 IF request.attempt_count=3 THEN
  UPDATE crest_private.legacy_contact_apply_requests SET outcome='review',completed_at=greatest(clock_timestamp(),requested_at),
   lease_id=NULL,lease_expires_at=NULL WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
  RETURN 'retired';
 END IF;
 UPDATE crest_private.legacy_contact_apply_requests SET attempt_count=attempt_count+1,lease_id=requested_lease,
  lease_expires_at=clock_timestamp()+interval '6 minutes'
  WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
 RETURN 'claimed';
END
$claim$;

CREATE FUNCTION crest_commands.run_claimed_legacy_contact_application(requested_lease uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $run$
DECLARE request crest_private.legacy_contact_apply_requests; result jsonb; final_outcome text;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR requested_lease IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_LEASE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 SELECT q.* INTO request FROM crest_private.legacy_contact_apply_requests q
  WHERE q.lease_id=requested_lease AND q.outcome IS NULL FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR request.lease_expires_at<=clock_timestamp() THEN RETURN false; END IF;
 IF crest_private.lock_legacy_contact_worker_authority(request.business_id,request.requested_by,request.security_epoch,request.recovery_epoch) THEN
  result:=crest_private.commit_legacy_contact_application(request.business_id,request.requested_by,request.recovery_epoch,
   request.operation_id,request.batch_id,request.evidence_sha256);
  final_outcome:=CASE WHEN result->>'state'='conflict' THEN result->>'reason' ELSE result->>'state' END;
 ELSE
  final_outcome:='authority';
 END IF;
 IF final_outcome IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_OUTCOME_REQUIRED'; END IF;
 UPDATE crest_private.legacy_contact_apply_requests SET outcome=final_outcome,completed_at=greatest(clock_timestamp(),requested_at),
  lease_id=NULL,lease_expires_at=NULL WHERE (business_id,operation_id)=(request.business_id,request.operation_id);
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_APPLY_REQUEST_REQUIRED'; END IF;
 RETURN true;
END
$run$;

CREATE FUNCTION crest_commands.release_legacy_contact_application(requested_lease uuid) RETURNS boolean
 LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $release$
DECLARE stamp timestamptz;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR requested_lease IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_APPLY_LEASE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_apply_dispatch','1',true),set_config('crest.legacy_apply_request_business_id','',true);
 stamp:=clock_timestamp();
 UPDATE crest_private.legacy_contact_apply_requests SET lease_id=NULL,lease_expires_at=NULL,
  outcome=CASE WHEN attempt_count=3 THEN 'review' END,
  completed_at=CASE WHEN attempt_count=3 THEN greatest(stamp,requested_at) END,
  next_attempt_at=stamp+CASE attempt_count WHEN 1 THEN interval '30 seconds' ELSE interval '2 minutes' END
  WHERE lease_id=requested_lease AND outcome IS NULL;
 RETURN FOUND;
END
$release$;

REVOKE EXECUTE ON FUNCTION crest_commands.run_next_legacy_contact_application() FROM crest_legacy_contact_dispatch;
REVOKE ALL ON FUNCTION crest_commands.claim_legacy_contact_application(uuid),
 crest_commands.run_claimed_legacy_contact_application(uuid),crest_commands.release_legacy_contact_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.claim_legacy_contact_application(uuid),
 crest_commands.run_claimed_legacy_contact_application(uuid),crest_commands.release_legacy_contact_application(uuid) TO crest_legacy_contact_dispatch;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_apply_owner;

-- Held portability source for the retained request and its public outcome.
-- Worker lease identifiers, retry scheduling and security epochs stay in the
-- encrypted database recovery profile. A portable row is evidence, not work
-- that a receiving database should put into an operating queue.
GRANT USAGE ON SCHEMA crest_private TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(business_id,operation_id,batch_id,evidence_sha256,requested_by,requested_at,outcome,completed_at,attempt_count)
 ON crest_private.legacy_contact_apply_requests TO crest_legacy_contact_export_owner;
CREATE POLICY legacy_apply_request_export ON crest_private.legacy_contact_apply_requests
 FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_request_source_page(
 requested_business uuid,after_operation uuid,page_size integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
 WITH candidates AS MATERIALIZED (
  SELECT r.business_id,r.operation_id,r.batch_id,r.evidence_sha256,r.requested_by,r.requested_at,
   coalesce(r.outcome,'queued') AS status,r.completed_at,r.attempt_count
  FROM crest_private.legacy_contact_apply_requests r
  WHERE r.business_id=requested_business AND (after_operation IS NULL OR r.operation_id>after_operation)
  ORDER BY r.operation_id LIMIT page_size+1
 ), page AS (
  SELECT * FROM candidates ORDER BY operation_id LIMIT page_size
 )
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
  'rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY operation_id),'[]'::jsonb),
  'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 RETURN result;
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_request_source_page(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_request_source_page(uuid,uuid,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;

-- Product traffic uses durable admission and worker claims.
REVOKE EXECUTE ON FUNCTION crest_commands.apply_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text) FROM crest_web;
