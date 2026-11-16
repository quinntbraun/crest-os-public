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
