-- Private contact-only import staging. The complete batch, operation receipt
-- and audit event commit together. These commands never apply a draft.
SET LOCAL ROLE crest_schema_owner;

CREATE TABLE crest.legacy_contact_batches (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES crest.businesses(id),
  source_label text NOT NULL CHECK(char_length(source_label)>=1 AND char_length(source_label)<=160
    AND source_label=btrim(source_label) AND source_label!~'[[:cntrl:]]'),
  original_sha256 text NOT NULL CHECK(original_sha256~'^[a-f0-9]{64}$'),
  mapping_version integer NOT NULL CHECK(mapping_version=1),
  mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object'),
  mapping_sha256 text NOT NULL CHECK(mapping_sha256=encode(sha256(convert_to(mapping::text,'UTF8')),'hex')),
  rows_sha256 text NOT NULL CHECK(rows_sha256~'^[a-f0-9]{64}$'),
  row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 100000),
  rejected_count integer NOT NULL CHECK(rejected_count BETWEEN 0 AND row_count),
  operation_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(created_at)),
  UNIQUE(business_id,id),
  UNIQUE(business_id,source_label,original_sha256,mapping_sha256),
  UNIQUE(business_id,operation_id),
  FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);

CREATE INDEX legacy_contact_batches_recent ON crest.legacy_contact_batches(business_id,created_at DESC,id DESC);

CREATE TABLE crest.legacy_contact_batch_rows (
  business_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  source_row integer NOT NULL CHECK(source_row BETWEEN 2 AND 100001),
  candidate jsonb NOT NULL CHECK(jsonb_typeof(candidate)='object'),
  fingerprint text NOT NULL CHECK(fingerprint=encode(sha256(convert_to(candidate::text,'UTF8')),'hex')),
  PRIMARY KEY(business_id,batch_id,source_row),
  FOREIGN KEY(business_id,batch_id) REFERENCES crest.legacy_contact_batches(business_id,id)
);

ALTER TABLE crest.legacy_contact_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_batch_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.legacy_contact_batch_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON crest.legacy_contact_batches,crest.legacy_contact_batch_rows TO crest_customer_owner;
GRANT SELECT ON crest.legacy_contact_batches,crest.legacy_contact_batch_rows TO crest_customer_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,command_type,state,result) ON crest_private.operations TO crest_customer_integrity_owner;
GRANT SELECT(action) ON crest_private.audit_events TO crest_customer_integrity_owner;

CREATE POLICY legacy_contact_batch_read ON crest.legacy_contact_batches FOR SELECT TO crest_customer_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY legacy_contact_batch_row_read ON crest.legacy_contact_batch_rows FOR SELECT TO crest_customer_owner
 USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY legacy_contact_batch_integrity ON crest.legacy_contact_batches FOR SELECT TO crest_customer_integrity_owner USING(true);
CREATE POLICY legacy_contact_row_integrity ON crest.legacy_contact_batch_rows FOR SELECT TO crest_customer_integrity_owner USING(true);

CREATE POLICY legacy_contact_operation_read ON crest_private.operations FOR SELECT TO crest_customer_owner
 USING(command_type='crm.legacy_contact.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY legacy_contact_operation_begin ON crest_private.operations FOR INSERT TO crest_customer_owner
 WITH CHECK(command_type='crm.legacy_contact.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid
  AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY legacy_contact_operation_complete ON crest_private.operations FOR UPDATE TO crest_customer_owner
 USING(command_type='crm.legacy_contact.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='pending')
 WITH CHECK(command_type='crm.legacy_contact.stage' AND business_id=nullif(current_setting('crest.business_id',true),'')::uuid
  AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
  AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND state='committed');
CREATE POLICY legacy_contact_operation_integrity ON crest_private.operations FOR SELECT TO crest_customer_integrity_owner
 USING(command_type='crm.legacy_contact.stage');
CREATE POLICY legacy_contact_audit_integrity ON crest_private.audit_events FOR SELECT TO crest_customer_integrity_owner
 USING(entity_kind='legacy_contact_batches');

CREATE POLICY legacy_contact_batch_insert ON crest.legacy_contact_batches FOR INSERT TO crest_customer_owner
 WITH CHECK(EXISTS(SELECT FROM crest_private.operations o WHERE o.business_id=legacy_contact_batches.business_id
  AND o.operation_id=legacy_contact_batches.operation_id AND o.actor_id=legacy_contact_batches.created_by
  AND o.command_type='crm.legacy_contact.stage' AND o.state='pending'));
CREATE POLICY legacy_contact_batch_row_insert ON crest.legacy_contact_batch_rows FOR INSERT TO crest_customer_owner
 WITH CHECK(EXISTS(SELECT FROM crest.legacy_contact_batches b JOIN crest_private.operations o
  ON (o.business_id,o.operation_id,o.actor_id)=(b.business_id,b.operation_id,b.created_by)
  WHERE b.business_id=legacy_contact_batch_rows.business_id AND b.id=legacy_contact_batch_rows.batch_id
   AND o.command_type='crm.legacy_contact.stage' AND o.state='pending'));
CREATE POLICY legacy_contact_audit_append ON crest_private.audit_events FOR INSERT TO crest_customer_owner
 WITH CHECK(entity_kind='legacy_contact_batches' AND action='stage' AND entity_version=1 AND origin='manual' AND import_row_id IS NULL
  AND actor_id=created_by AND EXISTS(SELECT FROM crest.legacy_contact_batches b JOIN crest_private.operations o
   ON (o.business_id,o.operation_id,o.actor_id)=(b.business_id,b.operation_id,b.created_by)
   WHERE b.business_id=audit_events.business_id AND b.id=audit_events.entity_id
    AND b.operation_id=audit_events.operation_id AND b.created_by=audit_events.actor_id
    AND o.command_type='crm.legacy_contact.stage' AND o.state='pending'));

CREATE TRIGGER legacy_contact_batches_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.legacy_contact_batches
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER legacy_contact_rows_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON crest.legacy_contact_batch_rows
 FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();

CREATE FUNCTION crest_private.legacy_contact_batch_receipt(batch crest.legacy_contact_batches)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp
RETURN jsonb_build_object('schemaVersion',1,'state','staged','batchId',batch.id,'businessId',batch.business_id,
 'sourceLabel',batch.source_label,'originalSha256',batch.original_sha256,'mappingVersion',batch.mapping_version,
 'mappingSha256',batch.mapping_sha256,'rowsSha256',batch.rows_sha256,'rowCount',batch.row_count,
 'rejectedCount',batch.rejected_count,'operationId',batch.operation_id);

CREATE FUNCTION crest_private.legacy_contact_candidate_valid(c jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $candidate$
DECLARE customer jsonb; vehicle jsonb; issues jsonb;
 contact_fields constant text[]:=ARRAY['sourceId','displayName','phone','email','customerSince','outreachOptOut','notes'];
 vehicle_fields constant text[]:=ARRAY['sourceId','label','year','make','model','color','vin','plate'];
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT c ?& ARRAY['customer','vehicle','issues']
   OR c-ARRAY['customer','vehicle','issues']<>'{}'::jsonb THEN RETURN false; END IF;
 customer:=c->'customer'; vehicle:=c->'vehicle'; issues:=c->'issues';
 IF jsonb_typeof(issues)<>'array' OR jsonb_array_length(issues)>3
  OR EXISTS(SELECT FROM jsonb_array_elements(issues) i(value) WHERE value NOT IN (
   '"LEGACY_SOURCE_ID_REQUIRED"','"LEGACY_OUTREACH_VALUE_REQUIRED"','"LEGACY_VEHICLE_YEAR_REQUIRED"',
   '"LEGACY_IMPORT_ROW_REVIEW_REQUIRED"','"LEGACY_CONTACT_SOURCE_CONFLICT"','"LEGACY_VEHICLE_SOURCE_CONFLICT"'))
 THEN RETURN false; END IF;
 IF customer='null'::jsonb THEN RETURN vehicle='null'::jsonb AND jsonb_array_length(issues)>0; END IF;
 IF jsonb_typeof(customer)<>'object' OR NOT customer ?& contact_fields OR customer-contact_fields<>'{}'::jsonb
  OR jsonb_typeof(customer->'sourceId')<>'string' OR char_length(customer->>'sourceId') NOT BETWEEN 1 AND 200
  OR (customer->>'sourceId')~'[[:cntrl:]]' OR jsonb_typeof(customer->'displayName')<>'string'
  OR char_length(btrim(customer->>'displayName')) NOT BETWEEN 1 AND 200
  OR NOT (jsonb_typeof(customer->'outreachOptOut') IN ('boolean','null'))
  OR EXISTS(SELECT FROM jsonb_each(customer) f(key,value) WHERE key NOT IN ('outreachOptOut')
    AND jsonb_typeof(value) NOT IN ('string','null'))
  OR greatest(char_length(customer->>'phone'),char_length(customer->>'email'))>512
  OR char_length(customer->>'notes')>2000 OR char_length(customer->>'customerSince')>10
 THEN RETURN false; END IF;
 IF vehicle='null'::jsonb THEN RETURN true; END IF;
 RETURN jsonb_typeof(vehicle)='object' AND vehicle ?& vehicle_fields AND vehicle-vehicle_fields='{}'::jsonb
  AND jsonb_typeof(vehicle->'sourceId')='string' AND char_length(vehicle->>'sourceId') BETWEEN 1 AND 200
  AND (vehicle->>'sourceId')!~'[[:cntrl:]]' AND jsonb_typeof(vehicle->'label')='string'
  AND char_length(btrim(vehicle->>'label')) BETWEEN 1 AND 200
  AND CASE WHEN jsonb_typeof(vehicle)='object' THEN NOT EXISTS(SELECT FROM jsonb_each(vehicle) f(key,value)
   WHERE CASE WHEN key='year' THEN jsonb_typeof(value) NOT IN ('number','null') ELSE jsonb_typeof(value) NOT IN ('string','null') END)
   ELSE false END
  AND coalesce(greatest(char_length(vehicle->>'make'),char_length(vehicle->>'model')),0)<=200
  AND coalesce(greatest(char_length(vehicle->>'color'),char_length(vehicle->>'vin'),char_length(vehicle->>'plate')),0)<=128;
END
$candidate$;
REVOKE ALL ON FUNCTION crest_private.legacy_contact_batch_receipt(crest.legacy_contact_batches),
 crest_private.legacy_contact_candidate_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_batch_receipt(crest.legacy_contact_batches)
 TO crest_customer_owner,crest_customer_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_private.legacy_contact_candidate_valid(jsonb) TO crest_customer_owner;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_private TO crest_customer_integrity_owner;
SET LOCAL ROLE crest_customer_integrity_owner;
CREATE FUNCTION crest_private.verify_legacy_contact_batch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $verify$
DECLARE summary record; expected jsonb;
BEGIN
  SELECT count(*) AS total,min(source_row) AS first_row,max(source_row) AS last_row,
    count(*) FILTER(WHERE candidate->'customer'='null'::jsonb) AS rejected,
    encode(sha256(convert_to(coalesce(string_agg(fingerprint,'' ORDER BY source_row),''),'UTF8')),'hex') AS digest
  INTO summary FROM crest.legacy_contact_batch_rows WHERE (business_id,batch_id)=(NEW.business_id,NEW.id);
  IF (summary.total,summary.first_row,summary.last_row,summary.rejected,summary.digest)
   IS DISTINCT FROM (NEW.row_count,2,NEW.row_count+1,NEW.rejected_count,NEW.rows_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_BATCH_ROW_PROOF_REQUIRED';
  END IF;
  expected:=crest_private.legacy_contact_batch_receipt(NEW);
  IF NOT EXISTS(SELECT FROM crest_private.operations o JOIN crest_private.audit_events a
   ON (a.business_id,a.operation_id,a.actor_id)=(o.business_id,o.operation_id,o.actor_id)
   WHERE (o.business_id,o.operation_id,o.actor_id)=(NEW.business_id,NEW.operation_id,NEW.created_by)
    AND o.command_type='crm.legacy_contact.stage' AND o.state='committed' AND o.result=expected
    AND a.entity_kind='legacy_contact_batches' AND a.entity_id=NEW.id AND a.action='stage' AND a.entity_version=1
    AND a.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',expected)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEGACY_BATCH_HISTORY_REQUIRED';
  END IF;
  RETURN NULL;
END
$verify$;
REVOKE ALL ON FUNCTION crest_private.verify_legacy_contact_batch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.verify_legacy_contact_batch() TO crest_schema_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_customer_integrity_owner;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER legacy_contact_batch_verify AFTER INSERT ON crest.legacy_contact_batches
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.verify_legacy_contact_batch();
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_customer_owner;
SET LOCAL ROLE crest_customer_owner;
CREATE FUNCTION crest_commands.stage_legacy_contact_batch(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,
 requested_operation uuid,requested_batch uuid,source_label text,original_sha256 text,mapping jsonb,candidates jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $stage$
DECLARE
  row_total integer; rejected integer; rows_digest text; map_digest text; payload_digest text;
  claimed uuid; existing crest.legacy_contact_batches; prior crest_private.operations; receipt jsonb;
  mapped_fields constant text[]:=ARRAY['customerSourceId','displayName','phone','email','customerSince','outreachOptOut',
    'customerNotes','vehicleSourceId','vehicleLabel','vehicleYear','vehicleMake','vehicleModel','vehicleColor','vehicleVin','vehiclePlate'];
BEGIN
  PERFORM set_config('crest.business_id','',true), set_config('crest.actor_id','',true), set_config('crest.operation_id','',true);
  IF requested_batch IS NULL OR requested_operation IS NULL OR expected_epoch IS NULL
   OR source_label IS NULL OR char_length(source_label) NOT BETWEEN 1 AND 160
   OR source_label<>btrim(source_label) OR source_label~'[[:cntrl:]]'
   OR original_sha256 IS NULL OR original_sha256!~'^[a-f0-9]{64}$'
   OR jsonb_typeof(mapping) IS DISTINCT FROM 'object' OR jsonb_typeof(candidates) IS DISTINCT FROM 'array'
   OR octet_length(candidates::text)>134217728 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_BATCH_INPUT_REQUIRED';
  END IF;
  PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
  row_total:=jsonb_array_length(candidates);
  IF row_total NOT BETWEEN 1 AND 100000
   OR NOT mapping ?& ARRAY['customerSourceId','displayName'] OR mapping-mapped_fields<>'{}'::jsonb
   OR (mapping ?| mapped_fields[8:15] AND NOT mapping ?& ARRAY['vehicleSourceId','vehicleLabel'])
   OR EXISTS(SELECT FROM jsonb_each(mapping) f(key,value)
    WHERE jsonb_typeof(value)<>'string' OR char_length(btrim(value#>>'{}'))=0)
   OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_each(mapping))
   OR EXISTS(SELECT FROM jsonb_array_elements(candidates) x(candidate)
    WHERE crest_private.legacy_contact_candidate_valid(candidate) IS DISTINCT FROM true) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_BATCH_INPUT_REQUIRED';
  END IF;

  PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),
    set_config('crest.operation_id',requested_operation::text,true);
  map_digest:=encode(sha256(convert_to(mapping::text,'UTF8')),'hex');
  SELECT count(*) FILTER(WHERE candidate->'customer'='null'::jsonb),
   encode(sha256(convert_to(string_agg(encode(sha256(convert_to(candidate::text,'UTF8')),'hex'),'' ORDER BY ordinal),'UTF8')),'hex')
  INTO rejected,rows_digest FROM jsonb_array_elements(candidates) WITH ORDINALITY AS x(candidate,ordinal);
  payload_digest:=encode(sha256(convert_to(jsonb_build_array('crm.legacy_contact.stage',1,requested_business,expected_actor,
    expected_epoch,requested_batch,source_label,original_sha256,map_digest,rows_digest)::text,'UTF8')),'hex');

  -- Same-source concurrent requests preserve the first batch and never leave a pending operation.
  PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('crm.legacy_contact.stage',requested_business,
   source_label,original_sha256,map_digest)::text,0));
  SELECT * INTO prior FROM crest_private.operations o WHERE (o.business_id,o.operation_id)=(requested_business,requested_operation);
  IF FOUND THEN
   IF prior.command_type='crm.legacy_contact.stage' AND prior.state='committed' AND prior.payload_hash=payload_digest AND prior.recovery_epoch=expected_epoch THEN
    RETURN jsonb_build_object('state','committed','receipt',prior.result);
   END IF;
   RETURN jsonb_build_object('state','conflict','reason','operation');
  END IF;
  SELECT * INTO existing FROM crest.legacy_contact_batches b WHERE
   (b.business_id,b.source_label,b.original_sha256,b.mapping_sha256)=
   (requested_business,stage_legacy_contact_batch.source_label,stage_legacy_contact_batch.original_sha256,map_digest);
  IF FOUND THEN
   IF existing.rows_sha256=rows_digest THEN
    RETURN jsonb_build_object('state','already_staged','receipt',crest_private.legacy_contact_batch_receipt(existing));
   END IF;
   RETURN jsonb_build_object('state','conflict','reason','source');
  END IF;
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  VALUES(requested_business,requested_operation,expected_actor,'crm.legacy_contact.stage',1,expected_epoch,payload_digest,expected_actor,'manual')
  ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN RETURN jsonb_build_object('state','conflict','reason','operation'); END IF;
  INSERT INTO crest.legacy_contact_batches(id,business_id,source_label,original_sha256,mapping_version,mapping,mapping_sha256,
    rows_sha256,row_count,rejected_count,operation_id,created_by)
  VALUES(requested_batch,requested_business,source_label,original_sha256,1,mapping,map_digest,rows_digest,row_total,rejected,requested_operation,expected_actor)
  RETURNING * INTO existing;
  INSERT INTO crest.legacy_contact_batch_rows(business_id,batch_id,source_row,candidate,fingerprint)
  SELECT requested_business,requested_batch,ordinal+1,candidate,encode(sha256(convert_to(candidate::text,'UTF8')),'hex')
  FROM jsonb_array_elements(candidates) WITH ORDINALITY AS x(candidate,ordinal);
  receipt:=crest_private.legacy_contact_batch_receipt(existing);
  INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
  VALUES(requested_business,requested_operation,expected_actor,expected_actor,'legacy_contact_batches',requested_batch,1,'stage',
    jsonb_build_object('schemaVersion',1,'before',NULL,'after',receipt),'manual');
  UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt
  WHERE (business_id,operation_id)=(requested_business,requested_operation);
  PERFORM crest_commands.finish_customer_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
  RETURN jsonb_build_object('state','committed','receipt',receipt);
END
$stage$;

CREATE FUNCTION crest_commands.read_legacy_contact_batch(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_batch uuid,
 after_row integer,page_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE authority jsonb; batch crest.legacy_contact_batches; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true), set_config('crest.actor_id','',true), set_config('crest.operation_id','',true);
  IF requested_batch IS NULL OR after_row IS NULL OR after_row NOT BETWEEN 1 AND 100001 OR page_size IS NULL
   OR page_size NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_BATCH_PAGE_REQUIRED';
  END IF;
  authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
  PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
  SELECT * INTO batch FROM crest.legacy_contact_batches b WHERE (b.business_id,b.id)=(requested_business,requested_batch);
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  SELECT jsonb_build_object('state','present','receipt',crest_private.legacy_contact_batch_receipt(batch),'mapping',batch.mapping,
   'rows',coalesce(jsonb_agg(jsonb_build_object('sourceRow',source_row,'fingerprint',fingerprint,'candidate',candidate)
     ORDER BY source_row),'[]'::jsonb),
   'hasMore',coalesce(max(source_row),after_row)<batch.row_count+1)
   INTO result FROM (SELECT source_row,fingerprint,candidate FROM crest.legacy_contact_batch_rows
    WHERE (business_id,batch_id)=(requested_business,requested_batch) AND source_row>after_row
    ORDER BY source_row LIMIT page_size) page;
  RETURN result;
END
$read$;

CREATE FUNCTION crest_commands.list_legacy_contact_batches(
 credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,
 expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,before_batch uuid,page_size integer
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE authority jsonb; cursor_time timestamptz; result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true), set_config('crest.actor_id','',true), set_config('crest.operation_id','',true);
  IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_BATCH_PAGE_REQUIRED';
  END IF;
  authority:=crest_commands.authorize_customer_read($1,$2,$3,$4,$5,$6,$7,$8);
  PERFORM set_config('crest.business_id',authority->>'businessId',true),set_config('crest.actor_id',authority->>'actorId',true);
  IF before_batch IS NOT NULL THEN
    SELECT b.created_at INTO cursor_time FROM crest.legacy_contact_batches b WHERE (business_id,id)=(requested_business,before_batch);
    IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  END IF;
  WITH candidates AS MATERIALIZED (
    SELECT b.* FROM crest.legacy_contact_batches b WHERE b.business_id=requested_business
     AND (before_batch IS NULL OR (b.created_at,b.id)<(cursor_time,before_batch))
    ORDER BY b.created_at DESC,b.id DESC LIMIT page_size+1
  ), page AS (
    SELECT * FROM candidates ORDER BY created_at DESC,id DESC LIMIT page_size
  )
  SELECT jsonb_build_object('state','present','businessId',requested_business,
    'batches',coalesce((SELECT jsonb_agg(crest_private.legacy_contact_batch_receipt(p::crest.legacy_contact_batches)
      ORDER BY p.created_at DESC,p.id DESC) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result;
  RETURN result;
END
$list$;

REVOKE ALL ON FUNCTION crest_commands.stage_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb),
 crest_commands.read_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,integer),
 crest_commands.list_legacy_contact_batches(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.stage_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb),
 crest_commands.read_legacy_contact_batch(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer,integer),
 crest_commands.list_legacy_contact_batches(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) TO crest_web;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_customer_owner;

-- Export credentials can page the exact draft source in a caller-owned snapshot.
-- The web, supplier worker and ordinary authenticated roles cannot use this path.
CREATE ROLE crest_legacy_contact_export_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DEFAULT PRIVILEGES FOR ROLE crest_legacy_contact_export_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
GRANT USAGE ON SCHEMA crest,crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.legacy_contact_batches,crest.legacy_contact_batch_rows TO crest_legacy_contact_export_owner;
CREATE POLICY legacy_contact_batch_source ON crest.legacy_contact_batches FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
CREATE POLICY legacy_contact_rows_source ON crest.legacy_contact_batch_rows FOR SELECT TO crest_legacy_contact_export_owner
 USING(business_id=nullif(current_setting('crest.legacy_export_business_id',true),'')::uuid);
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_legacy_contact_export_owner;
SET LOCAL ROLE crest_legacy_contact_export_owner;
CREATE FUNCTION crest_commands.legacy_contact_batch_source_page(requested_business uuid,after_batch uuid,page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on SET timezone='UTC' SET datestyle='ISO, YMD' AS $source$
DECLARE result jsonb;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
   RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
  END IF;
  IF requested_business IS NULL OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
  END IF;
  PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
  WITH candidates AS MATERIALIZED (
   SELECT b.* FROM crest.legacy_contact_batches b WHERE b.business_id=requested_business
    AND (after_batch IS NULL OR b.id>after_batch) ORDER BY b.id LIMIT page_size+1
  ), page AS (SELECT * FROM candidates ORDER BY id LIMIT page_size)
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,
    'batches',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM page p),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_size FROM candidates)) INTO result;
  RETURN result;
END
$source$;

CREATE FUNCTION crest_commands.legacy_contact_row_source_page(requested_business uuid,requested_batch uuid,after_row integer,page_size integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,pg_temp SET row_security=on AS $source$
DECLARE result jsonb; expected_rows integer;
BEGIN
  IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN
   RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEGACY_SOURCE_SNAPSHOT_REQUIRED';
  END IF;
  IF requested_business IS NULL OR requested_batch IS NULL OR after_row IS NULL OR after_row NOT BETWEEN 1 AND 100001
   OR page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEGACY_SOURCE_PAGE_REQUIRED';
  END IF;
  PERFORM set_config('crest.legacy_export_business_id',requested_business::text,true);
  SELECT b.row_count INTO expected_rows FROM crest.legacy_contact_batches b WHERE (b.business_id,b.id)=(requested_business,requested_batch);
  IF NOT FOUND THEN RETURN jsonb_build_object('state','absent'); END IF;
  SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'batchId',requested_batch,
   'rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY source_row),'[]'::jsonb),
   'hasMore',coalesce(max(source_row),after_row)<expected_rows+1) INTO result
  FROM (SELECT r.* FROM crest.legacy_contact_batch_rows r WHERE (r.business_id,r.batch_id)=(requested_business,requested_batch)
   AND r.source_row>after_row ORDER BY r.source_row LIMIT page_size) page;
  RETURN result;
END
$source$;
REVOKE ALL ON FUNCTION crest_commands.legacy_contact_batch_source_page(uuid,uuid,integer),
 crest_commands.legacy_contact_row_source_page(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.legacy_contact_batch_source_page(uuid,uuid,integer),
 crest_commands.legacy_contact_row_source_page(uuid,uuid,integer,integer) TO crest_export;
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_legacy_contact_export_owner;
