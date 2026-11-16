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
