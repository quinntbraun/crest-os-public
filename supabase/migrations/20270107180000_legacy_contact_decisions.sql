-- Owner review evidence for the contact-only import. Decisions are append-only
-- and scoped to a retained CSV row. Saving a choice does not apply the import.
CREATE ROLE crest_legacy_contact_decision_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_legacy_contact_decision_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_legacy_contact_decision_owner;
GRANT EXECUTE ON FUNCTION crest_commands.authorize_customer_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),
 crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),
 crest_commands.finish_customer_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)
 TO crest_legacy_contact_decision_owner;

SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.legacy_contact_decision_sources (
 business_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 source_namespace text NOT NULL CHECK(source_namespace ~ '^[a-z][a-z0-9_-]{1,63}$'),
 first_operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 PRIMARY KEY(business_id,batch_id),
 UNIQUE(business_id,batch_id,source_namespace),
 FOREIGN KEY(business_id,batch_id) REFERENCES crest.legacy_contact_batches(business_id,id),
 FOREIGN KEY(business_id,first_operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.legacy_contact_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 source_row integer NOT NULL,
 source_namespace text NOT NULL,
 row_fingerprint text NOT NULL CHECK(row_fingerprint ~ '^[a-f0-9]{64}$'),
 revision integer NOT NULL CHECK(revision>=1),
 customer_action text NOT NULL CHECK(customer_action IN ('create','link','skip')),
 customer_id uuid,
 customer_version bigint,
 vehicle_action text NOT NULL CHECK(vehicle_action IN ('none','create','link','skip')),
 vehicle_id uuid,
 vehicle_version bigint,
 operation_id uuid NOT NULL,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
 UNIQUE(business_id,batch_id,source_row,revision),
 UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,batch_id,source_row) REFERENCES crest.legacy_contact_batch_rows(business_id,batch_id,source_row),
 FOREIGN KEY(business_id,batch_id,source_namespace) REFERENCES crest.legacy_contact_decision_sources(business_id,batch_id,source_namespace),
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id),
 FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id),
 CHECK((customer_action='link')=(customer_id IS NOT NULL) AND (customer_id IS NULL)=(customer_version IS NULL)
  AND (customer_version IS NULL OR customer_version>0)),
 CHECK((vehicle_action='link')=(vehicle_id IS NOT NULL) AND (vehicle_id IS NULL)=(vehicle_version IS NULL)
  AND (vehicle_version IS NULL OR vehicle_version>0)),
 CHECK(customer_action<>'skip' OR vehicle_action='none')
);
ALTER TABLE crest.legacy_contact_decision_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_decision_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_decisions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.legacy_contact_decision_sources,crest.legacy_contact_decisions TO crest_legacy_contact_decision_owner;
GRANT SELECT(business_id,batch_id,source_row,candidate,fingerprint) ON crest.legacy_contact_batch_rows TO crest_legacy_contact_decision_owner;
GRANT SELECT(business_id,id,version,archived_at,phone_normalized,email_normalized) ON crest.customers TO crest_legacy_contact_decision_owner;
GRANT SELECT(business_id,id,version,archived_at,vin_normalized,kind) ON crest.vehicles TO crest_legacy_contact_decision_owner;
GRANT SELECT,INSERT,UPDATE(state,result,result_schema_version) ON crest_private.operations TO crest_legacy_contact_decision_owner;
GRANT SELECT(business_id,operation_id,actor_id),INSERT ON crest_private.audit_events TO crest_legacy_contact_decision_owner;
GRANT SELECT ON crest.legacy_contact_decisions TO crest_customer_integrity_owner;
CREATE POLICY legacy_decision_integrity ON crest.legacy_contact_decisions FOR SELECT TO crest_customer_integrity_owner USING(true);
CREATE POLICY legacy_decision_claim_integrity ON crest_private.operations FOR SELECT TO crest_customer_integrity_owner
 USING(command_type='crm.legacy_contact.decide');
CREATE POLICY legacy_decision_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_customer_integrity_owner
 USING(entity_kind='legacy_contact_decisions');

CREATE POLICY legacy_decision_source_read ON crest.legacy_contact_decision_sources FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_decision_read ON crest.legacy_contact_decisions FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_decision_row_read ON crest.legacy_contact_batch_rows FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_decision_customer_read ON crest.customers FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);
CREATE POLICY legacy_decision_vehicle_read ON crest.vehicles FOR SELECT TO crest_legacy_contact_decision_owner
 USING(business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid);

CREATE POLICY legacy_decision_claim_read ON crest_private.operations FOR SELECT TO crest_legacy_contact_decision_owner
 USING(command_type='crm.legacy_contact.decide' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY legacy_decision_claim_begin ON crest_private.operations FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(command_type='crm.legacy_contact.decide' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY legacy_decision_claim_complete ON crest_private.operations FOR UPDATE TO crest_legacy_contact_decision_owner
 USING(command_type='crm.legacy_contact.decide' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending')
 WITH CHECK(command_type='crm.legacy_contact.decide' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='committed');
CREATE POLICY legacy_decision_audit_read ON crest_private.audit_events FOR SELECT TO crest_legacy_contact_decision_owner
 USING(entity_kind='legacy_contact_decisions' AND business_id=nullif(current_setting('crest.legacy_decision_business_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid);
CREATE POLICY legacy_decision_source_insert ON crest.legacy_contact_decision_sources FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=legacy_contact_decision_sources.business_id
  AND o.operation_id=legacy_contact_decision_sources.first_operation_id AND o.actor_id=legacy_contact_decision_sources.created_by
  AND o.state='pending'));
CREATE POLICY legacy_decision_insert ON crest.legacy_contact_decisions FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=legacy_contact_decisions.business_id
  AND o.operation_id=legacy_contact_decisions.operation_id AND o.actor_id=legacy_contact_decisions.created_by AND o.state='pending'));
CREATE POLICY legacy_decision_audit_insert ON crest_private.audit_events FOR INSERT TO crest_legacy_contact_decision_owner
 WITH CHECK(entity_kind='legacy_contact_decisions' AND action='decide' AND origin='manual' AND import_row_id IS NULL
  AND EXISTS(SELECT FROM crest.legacy_contact_decisions d WHERE d.business_id=audit_events.business_id AND d.id=audit_events.entity_id
   AND d.operation_id=audit_events.operation_id AND d.created_by=audit_events.actor_id AND d.revision=audit_events.entity_version));
CREATE TRIGGER legacy_decision_sources_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.legacy_contact_decision_sources
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER legacy_decisions_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.legacy_contact_decisions
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.legacy_contact_decision_receipt(d crest.legacy_contact_decisions) RETURNS jsonb
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $receipt$
 SELECT jsonb_build_object('schemaVersion',1,'decisionId',d.id,'businessId',d.business_id,'batchId',d.batch_id,
  'row',d.source_row,'fingerprint',d.row_fingerprint,'sourceNamespace',d.source_namespace,'revision',d.revision,
  'customerAction',d.customer_action,'customerId',d.customer_id,'customerVersion',d.customer_version::text,
  'vehicleAction',d.vehicle_action,'vehicleId',d.vehicle_id,'vehicleVersion',d.vehicle_version::text,'operationId',d.operation_id)
$receipt$;
REVOKE ALL ON FUNCTION crest_private.legacy_contact_decision_receipt(crest.legacy_contact_decisions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_decision_receipt(crest.legacy_contact_decisions)
 TO crest_legacy_contact_decision_owner,crest_customer_integrity_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
SET LOCAL ROLE crest_customer_integrity_owner;
CREATE FUNCTION crest_private.verify_legacy_contact_decision() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE current_receipt jsonb; previous_receipt jsonb;
BEGIN
 current_receipt:=crest_private.legacy_contact_decision_receipt(NEW);
 IF NOT EXISTS(SELECT FROM crest.legacy_contact_batch_rows r WHERE
  (r.business_id,r.batch_id,r.source_row,r.fingerprint)=(NEW.business_id,NEW.batch_id,NEW.source_row,NEW.row_fingerprint)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_DECISION_FINGERPRINT_REQUIRED';
 END IF;
 IF NEW.revision>1 THEN
  SELECT crest_private.legacy_contact_decision_receipt(d) INTO previous_receipt FROM crest.legacy_contact_decisions d
   WHERE (d.business_id,d.batch_id,d.source_row,d.revision)=(NEW.business_id,NEW.batch_id,NEW.source_row,NEW.revision-1);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_DECISION_REVISION_REQUIRED'; END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
  ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
  WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by)
   AND o.command_type='crm.legacy_contact.decide' AND o.state='committed' AND o.result=current_receipt
   AND a.entity_kind='legacy_contact_decisions' AND a.entity_id=NEW.id AND a.action='decide' AND a.entity_version=NEW.revision
   AND a.delta=jsonb_build_object('schemaVersion',1,'before',previous_receipt,'after',current_receipt)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_DECISION_PROOF_REQUIRED';
 END IF;
 RETURN NULL;
END
$verify$;
CREATE FUNCTION crest_private.verify_legacy_contact_decision_source() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
BEGIN
 IF NOT EXISTS(SELECT FROM crest.legacy_contact_decisions d WHERE
  (d.business_id,d.batch_id,d.operation_id,d.created_by,d.source_namespace) IS NOT DISTINCT FROM
  (NEW.business_id,NEW.batch_id,NEW.first_operation_id,NEW.created_by,NEW.source_namespace) AND d.revision=1) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_DECISION_SOURCE_PROOF_REQUIRED';
 END IF;
 RETURN NULL;
END
$verify$;
REVOKE ALL ON FUNCTION crest_private.verify_legacy_contact_decision(),crest_private.verify_legacy_contact_decision_source() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_legacy_contact_decision(),crest_private.verify_legacy_contact_decision_source()
 TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER legacy_decision_verify AFTER INSERT ON crest.legacy_contact_decisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_legacy_contact_decision();
CREATE CONSTRAINT TRIGGER legacy_decision_source_verify AFTER INSERT ON crest.legacy_contact_decision_sources
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_legacy_contact_decision_source();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_decision_owner;
SET LOCAL ROLE crest_legacy_contact_decision_owner;
CREATE FUNCTION crest_commands.save_legacy_contact_decision(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,requested_row integer,expected_fingerprint text,expected_revision integer,
 requested_namespace text,contact_action text,contact_target uuid,contact_version bigint,
 auto_action text,auto_target uuid,auto_version bigint
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE
 mapped jsonb; digest text; payload_digest text; previous crest.legacy_contact_decisions; namespace text;
 prior record; claimed uuid; saved crest.legacy_contact_decisions; receipt jsonb; before_receipt jsonb;
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
 IF contact_action='link' AND NOT EXISTS(
  SELECT FROM crest.customers c WHERE c.business_id=requested_business AND c.id=contact_target
   AND c.version=contact_version AND c.archived_at IS NULL
   AND (c.phone_normalized=nullif(regexp_replace(mapped->'customer'->>'phone','[^0-9]','','g'),'')
     OR c.email_normalized=nullif(lower(btrim(mapped->'customer'->>'email')),''))
 ) THEN RETURN jsonb_build_object('state','conflict','reason','target'); END IF;
 IF auto_action='link' AND NOT EXISTS(
  SELECT FROM crest.vehicles v WHERE v.business_id=requested_business AND v.id=auto_target
   AND v.version=auto_version AND v.archived_at IS NULL AND v.kind='customer_vehicle'
   AND v.vin_normalized=nullif(translate(regexp_replace(mapped->'vehicle'->>'vin','[^A-Za-z0-9]','','g'),
    'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),'')
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

CREATE FUNCTION crest_commands.read_legacy_contact_decision(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid,requested_row integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; saved crest.legacy_contact_decisions; digest text; namespace text;
BEGIN
 PERFORM set_config('crest.legacy_decision_business_id','',true);
 IF requested_batch IS NULL OR requested_row IS NULL OR requested_row NOT BETWEEN 2 AND 100001 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_DECISION_ROW_REQUIRED';
 END IF;
 authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.legacy_decision_business_id',authority->>'businessId',true);
 SELECT fingerprint INTO digest FROM crest.legacy_contact_batch_rows
  WHERE (business_id,batch_id,source_row)=(requested_business,requested_batch,requested_row);
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
 SELECT source_namespace INTO namespace FROM crest.legacy_contact_decision_sources
  WHERE (business_id,batch_id)=(requested_business,requested_batch);
 SELECT * INTO saved FROM crest.legacy_contact_decisions
  WHERE (business_id,batch_id,source_row)=(requested_business,requested_batch,requested_row)
  ORDER BY revision DESC LIMIT 1;
 RETURN jsonb_build_object('state','present','businessId',requested_business,'batchId',requested_batch,'row',requested_row,
  'sourceNamespace',coalesce(namespace,saved.source_namespace),'fingerprint',digest,
  'decision',CASE WHEN saved.id IS NULL THEN NULL ELSE crest_private.legacy_contact_decision_receipt(saved) END);
END
$read$;
REVOKE ALL ON FUNCTION crest_commands.save_legacy_contact_decision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,
 uuid,uuid,integer,text,integer,text,text,uuid,bigint,text,uuid,bigint),
 crest_commands.read_legacy_contact_decision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_legacy_contact_decision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,
 uuid,uuid,integer,text,integer,text,text,uuid,bigint,text,uuid,bigint),
 crest_commands.read_legacy_contact_decision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_decision_owner;

-- New evidence stays within the existing private, read-only snapshot boundary.
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.legacy_contact_decision_sources,crest.legacy_contact_decisions TO crest_legacy_contact_export_owner;
CREATE POLICY legacy_decision_source_export ON crest.legacy_contact_decision_sources FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
CREATE POLICY legacy_decision_export ON crest.legacy_contact_decisions FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_decision_source_page(
 requested_business uuid,source_kind text,after_batch uuid,after_row integer,after_revision integer,page_size integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
 END IF;
 IF requested_business IS NULL OR source_kind IS NULL OR source_kind NOT IN ('binding','decision')
  OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100
  OR (source_kind='binding' AND (after_row IS NOT NULL OR after_revision IS NOT NULL))
  OR (source_kind='decision' AND ((after_batch IS NULL)<>(after_row IS NULL) OR (after_batch IS NULL)<>(after_revision IS NULL)
    OR after_row NOT BETWEEN 2 AND 100001 OR after_revision<1)) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
 END IF;
 PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
 IF source_kind='binding' THEN
  WITH candidates AS MATERIALIZED (
   SELECT s.* FROM crest.legacy_contact_decision_sources s WHERE s.business_id=requested_business
    AND (after_batch IS NULL OR s.batch_id>after_batch) ORDER BY s.batch_id LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY batch_id LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY batch_id),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 ELSE
  WITH candidates AS MATERIALIZED (
   SELECT d.* FROM crest.legacy_contact_decisions d WHERE d.business_id=requested_business
    AND (after_batch IS NULL OR (d.batch_id,d.source_row,d.revision)>(after_batch,after_row,after_revision))
   ORDER BY d.batch_id,d.source_row,d.revision LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY batch_id,source_row,revision LIMIT page_size)
  SELECT jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(page)||jsonb_build_object(
   'customer_version',customer_version::text,'vehicle_version',vehicle_version::text)
   ORDER BY batch_id,source_row,revision),'[]'::jsonb),
   'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result FROM page;
 END IF;
 RETURN result || jsonb_build_object('schemaVersion',1,'businessId',requested_business,'kind',source_kind);
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_decision_source_page(uuid,text,uuid,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_decision_source_page(uuid,text,uuid,integer,integer,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;
