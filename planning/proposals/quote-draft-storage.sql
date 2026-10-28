-- Unregistered Draft-only construction over registered44 + quote-pricing.sql.
-- This does not enable approval, sending, acceptance, amendments or billing.
DO $review$
DECLARE role_id oid;
BEGIN
 IF to_regprocedure('crest_private.calculate_quote_pricing(jsonb,jsonb)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_schema_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_SOURCE_REVIEW_REQUIRED';END IF;
 SELECT oid INTO role_id FROM pg_roles WHERE rolname='crest_quote_integrity_owner';
 IF role_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_ROLE_REVIEW_REQUIRED';END IF;
 CREATE ROLE crest_quote_integrity_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
 ALTER DEFAULT PRIVILEGES FOR ROLE crest_quote_integrity_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE TABLE crest.quote_families(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 lead_id uuid,customer_id uuid,current_revision_id uuid NOT NULL,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,updated_by uuid NOT NULL,origin text NOT NULL CHECK(origin IN('manual','import','system')),operation_id uuid NOT NULL,import_row_id uuid,
 UNIQUE(business_id,id),CHECK(lead_id IS NOT NULL OR customer_id IS NOT NULL),CHECK(isfinite(created_at) AND isfinite(updated_at)),
 FOREIGN KEY(business_id,lead_id) REFERENCES crest.leads(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,customer_id) REFERENCES crest.customers(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT
);
CREATE TABLE crest.quote_revisions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,family_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),kind text NOT NULL DEFAULT 'initial' CHECK(kind='initial'),state text NOT NULL DEFAULT 'Draft' CHECK(state='Draft'),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),content_version bigint NOT NULL DEFAULT 1 CHECK(content_version>0),
 customer_safe_snapshot jsonb NOT NULL,internal_snapshot jsonb NOT NULL,canonical_content text NOT NULL,content_hash text NOT NULL,
 total_cents bigint NOT NULL CHECK(total_cents>=0),expiry_at timestamptz,timezone text NOT NULL,tax_readiness text NOT NULL DEFAULT 'not_configured' CHECK(tax_readiness='not_configured'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,updated_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN('manual','import','system')),operation_id uuid NOT NULL,import_row_id uuid,
 UNIQUE(business_id,id),UNIQUE(business_id,family_id,id),UNIQUE(business_id,family_id,sequence),
 CHECK(jsonb_typeof(customer_safe_snapshot)='object' AND jsonb_typeof(internal_snapshot)='object'),
 CHECK(octet_length(canonical_content)<=16777216 AND canonical_content::jsonb=jsonb_build_object('schemaVersion',1,'customer',customer_safe_snapshot,'internal',internal_snapshot)),
 CHECK(content_hash~'^[a-f0-9]{64}$' AND content_hash=encode(sha256(convert_to(canonical_content,'UTF8')),'hex')),
 CHECK(isfinite(created_at) AND isfinite(updated_at) AND (expiry_at IS NULL OR isfinite(expiry_at))),
 FOREIGN KEY(business_id,family_id) REFERENCES crest.quote_families(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT
);
ALTER TABLE crest.quote_families ADD CONSTRAINT quote_current_revision FOREIGN KEY(business_id,id,current_revision_id) REFERENCES crest.quote_revisions(business_id,family_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE crest.quote_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,revision_id uuid NOT NULL,stable_line_key uuid NOT NULL,
 active boolean NOT NULL,position integer,vehicle_id uuid,job_wide boolean NOT NULL,service_version_id uuid,
 gross_cents bigint NOT NULL CHECK(gross_cents>=0),line_discount jsonb NOT NULL,document_discount_eligible boolean NOT NULL,
 line_discount_cents bigint NOT NULL CHECK(line_discount_cents>=0),allocated_discount_cents bigint NOT NULL CHECK(allocated_discount_cents>=0),final_cents bigint NOT NULL CHECK(final_cents>=0),complimentary_reason text,
 customer_snapshot jsonb NOT NULL CHECK(jsonb_typeof(customer_snapshot)='object'),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,updated_by uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN('manual','import','system')),operation_id uuid NOT NULL,import_row_id uuid,
 UNIQUE(business_id,id),UNIQUE(business_id,revision_id,stable_line_key),UNIQUE(business_id,revision_id,position) DEFERRABLE INITIALLY DEFERRED,
 CHECK(active AND position IS NOT NULL AND position BETWEEN 1 AND 1000 OR NOT active AND position IS NULL),
 CHECK(vehicle_id IS NOT NULL AND NOT job_wide OR vehicle_id IS NULL AND job_wide),
 CHECK(final_cents::numeric=gross_cents::numeric-line_discount_cents::numeric-allocated_discount_cents::numeric),
 CHECK(complimentary_reason IS NULL OR char_length(complimentary_reason) BETWEEN 1 AND 1000),
 CHECK(final_cents<>0 OR complimentary_reason IS NOT NULL),CHECK(isfinite(created_at) AND isfinite(updated_at)),
 FOREIGN KEY(business_id,revision_id) REFERENCES crest.quote_revisions(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,service_version_id) REFERENCES crest.service_versions(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT
);
ALTER TABLE crest.quote_families ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.quote_families FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.quote_revisions ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.quote_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.quote_items ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.quote_items FORCE ROW LEVEL SECURITY;
CREATE INDEX quote_family_cursor ON crest.quote_families(business_id,id);
CREATE INDEX quote_family_customer ON crest.quote_families(business_id,customer_id);
CREATE INDEX quote_family_lead ON crest.quote_families(business_id,lead_id);
CREATE INDEX quote_revision_family ON crest.quote_revisions(business_id,family_id,id);
CREATE INDEX quote_item_revision ON crest.quote_items(business_id,revision_id,active,position);
CREATE FUNCTION crest_private.quote_family_projection(v crest.quote_families) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(v)||jsonb_build_object('version',(v).version::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.quote_revision_projection(v crest.quote_revisions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(v)||jsonb_build_object('sequence',(v).sequence::text,'version',(v).version::text,'content_version',(v).content_version::text,'total_cents',(v).total_cents::text,'expiry_at',CASE WHEN (v).expiry_at IS NULL THEN NULL ELSE to_char((v).expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.quote_item_projection(v crest.quote_items) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT to_jsonb(v)||jsonb_build_object('version',(v).version::text,'gross_cents',(v).gross_cents::text,'line_discount_cents',(v).line_discount_cents::text,'allocated_discount_cents',(v).allocated_discount_cents::text,'final_cents',(v).final_cents::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.reject_quote_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $retained$
 BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_HISTORY_RETAINED';END
$retained$;
CREATE FUNCTION crest_private.validate_quote_family_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.lead_id,NEW.customer_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.lead_id,OLD.customer_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
 END IF;NEW.updated_at:=stamp;RETURN NEW;
END $change$;
CREATE FUNCTION crest_private.validate_quote_revision_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE parent crest.quote_families; preceding bigint; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO parent FROM crest.quote_families WHERE business_id=NEW.business_id AND id=NEW.family_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_QUOTE_PARENT_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  SELECT coalesce(max(sequence),0) INTO preceding FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id;
  IF NEW.sequence::numeric<>preceding::numeric+1 OR NEW.version<>1 OR NEW.content_version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.sequence,NEW.kind,NEW.state,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.sequence,OLD.kind,OLD.state,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 OR NEW.content_version::numeric<>OLD.content_version::numeric+1 OR NEW.canonical_content=OLD.canonical_content THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
 END IF;
 IF NEW.internal_snapshot->>'customerId' IS DISTINCT FROM parent.customer_id::text OR NEW.internal_snapshot->>'leadId' IS DISTINCT FROM parent.lead_id::text
  OR NEW.customer_safe_snapshot->>'currency' IS DISTINCT FROM 'USD' OR NEW.customer_safe_snapshot->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR NEW.customer_safe_snapshot->>'totalCents' IS DISTINCT FROM NEW.total_cents::text OR NEW.customer_safe_snapshot->>'timezone' IS DISTINCT FROM NEW.timezone
  OR NEW.customer_safe_snapshot->>'expiryAt' IS DISTINCT FROM (CASE WHEN NEW.expiry_at IS NULL THEN NULL ELSE to_char(NEW.expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SNAPSHOT_CONFLICT';END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END $change$;
CREATE FUNCTION crest_private.validate_quote_item_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE parent crest.quote_revisions; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO parent FROM crest.quote_revisions WHERE business_id=NEW.business_id AND id=NEW.revision_id FOR UPDATE;
 IF parent.id IS NULL OR parent.state<>'Draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_DRAFT_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.revision_id,NEW.stable_line_key,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.revision_id,OLD.stable_line_key,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
 END IF;
 IF NOT(NEW.customer_snapshot ?& ARRAY['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason'])
  OR NEW.customer_snapshot-ARRAY['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason']<>'{}'::jsonb
  OR NOT(NEW.customer_snapshot @> jsonb_build_object('grossCents',NEW.gross_cents::text,'lineDiscount',NEW.line_discount,'lineDiscountCents',NEW.line_discount_cents::text,'documentDiscountEligible',NEW.document_discount_eligible,'allocatedDiscountCents',NEW.allocated_discount_cents::text,'finalCents',NEW.final_cents::text,'complimentaryReason',NEW.complimentary_reason))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_ITEM_SNAPSHOT_CONFLICT';END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END $change$;
CREATE FUNCTION crest_private.check_quote_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE prior jsonb:='null'::jsonb; following jsonb; kind text:=TG_TABLE_NAME; source jsonb; published boolean;
BEGIN
 IF kind='quote_families' THEN
  following:=crest_private.quote_family_projection(NEW::crest.quote_families);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_family_projection(OLD::crest.quote_families);END IF;
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions'
    AND a.entity_id=NEW.current_revision_id AND a.entity_version<=r.version AND r.family_id=NEW.id
    AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text) INTO published;
 ELSIF kind='quote_revisions' THEN
  following:=crest_private.quote_revision_projection(NEW::crest.quote_revisions);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_revision_projection(OLD::crest.quote_revisions);END IF;
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_families f ON f.business_id=a.business_id AND f.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_families'
    AND a.entity_id=NEW.family_id AND a.entity_version<=f.version AND a.delta->'after'->>'version'=a.entity_version::text
    AND a.delta->'after'->>'current_revision_id'=NEW.id::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text) INTO published;
 ELSIF kind='quote_items' THEN
  following:=crest_private.quote_item_projection(NEW::crest.quote_items);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_item_projection(OLD::crest.quote_items);END IF;
  source:=jsonb_build_object('stableLineKey',NEW.stable_line_key,'vehicleId',NEW.vehicle_id,'jobWide',NEW.job_wide,'serviceVersionId',NEW.service_version_id);
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions' AND a.entity_id=NEW.revision_id
    AND a.entity_version<=r.version AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text
    AND (NEW.active AND a.delta->'after'->'internal_snapshot'->'sources'->(NEW.position-1)=source AND a.delta->'after'->'customer_safe_snapshot'->'lines'->(NEW.position-1)=NEW.customer_snapshot
     OR NOT NEW.active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.delta->'after'->'internal_snapshot'->'sources') s WHERE s->>'stableLineKey'=NEW.stable_line_key::text))) INTO published;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=kind AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action=(CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END) AND a.delta->'before'=prior AND a.delta->'after'=following
   AND o.command_type='quote.draft.save' AND o.schema_version=1 AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $audit$;
CREATE FUNCTION crest_private.check_quote_aggregate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $aggregate$
DECLARE current_version bigint; inputs jsonb; actual jsonb; snapshots jsonb; sources jsonb; calculated jsonb; line_count integer; last_position integer;
BEGIN
 SELECT version INTO current_version FROM crest.quote_revisions WHERE business_id=NEW.business_id AND id=NEW.id;
 -- Earlier changes in the same transaction retain their exact audit images;
 -- the final version alone is compared with the final normalized line set.
 IF current_version IS DISTINCT FROM NEW.version THEN RETURN NULL;END IF;
 SELECT count(*)::integer,max(position),
  jsonb_agg(jsonb_build_object('id',stable_line_key,'grossCents',gross_cents::text,'lineDiscount',line_discount,'documentDiscountEligible',document_discount_eligible,'complimentaryReason',complimentary_reason) ORDER BY position),
  jsonb_agg(jsonb_build_object('id',stable_line_key,'grossCents',gross_cents::text,'lineDiscountCents',line_discount_cents::text,'documentDiscountEligible',document_discount_eligible,'allocatedDiscountCents',allocated_discount_cents::text,'finalCents',final_cents::text,'complimentaryReason',complimentary_reason) ORDER BY position),
  jsonb_agg(customer_snapshot ORDER BY position),jsonb_agg(jsonb_build_object('stableLineKey',stable_line_key,'vehicleId',vehicle_id,'jobWide',job_wide,'serviceVersionId',service_version_id) ORDER BY position)
 INTO line_count,last_position,inputs,actual,snapshots,sources FROM crest.quote_items WHERE business_id=NEW.business_id AND revision_id=NEW.id AND active;
 IF line_count=0 OR last_position IS DISTINCT FROM line_count OR NEW.customer_safe_snapshot->'lines' IS DISTINCT FROM snapshots OR NEW.internal_snapshot->'sources' IS DISTINCT FROM sources THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AGGREGATE_CONFLICT';END IF;
 calculated:=crest_private.calculate_quote_pricing(inputs,NEW.customer_safe_snapshot->'documentDiscount');
 IF calculated->'lines' IS DISTINCT FROM actual OR NOT(NEW.customer_safe_snapshot @> (calculated-'lines'))
  OR NEW.internal_snapshot->'extremeReviewRequired' IS DISTINCT FROM to_jsonb(EXISTS(SELECT 1 FROM jsonb_array_elements(snapshots) s WHERE s->>'condition'='Extreme'))
  OR NOT(NEW.customer_safe_snapshot ?& ARRAY['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents'])
  OR NEW.customer_safe_snapshot-ARRAY['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents']<>'{}'::jsonb
  OR NOT(NEW.internal_snapshot ?& ARRAY['customerId','leadId','notes','sources','extremeReviewRequired']) OR NEW.internal_snapshot-ARRAY['customerId','leadId','notes','sources','extremeReviewRequired']<>'{}'::jsonb
  OR NOT(NEW.customer_safe_snapshot->'recipient' ?& ARRAY['displayName','phone','email']) OR NEW.customer_safe_snapshot->'recipient'-ARRAY['displayName','phone','email']<>'{}'::jsonb
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AGGREGATE_CONFLICT';END IF;
 RETURN NULL;
END $aggregate$;
CREATE TRIGGER quote_family_change BEFORE INSERT OR UPDATE ON crest.quote_families FOR EACH ROW EXECUTE FUNCTION crest_private.validate_quote_family_change();
CREATE TRIGGER quote_revision_change BEFORE INSERT OR UPDATE ON crest.quote_revisions FOR EACH ROW EXECUTE FUNCTION crest_private.validate_quote_revision_change();
CREATE TRIGGER quote_item_change BEFORE INSERT OR UPDATE ON crest.quote_items FOR EACH ROW EXECUTE FUNCTION crest_private.validate_quote_item_change();
CREATE CONSTRAINT TRIGGER quote_family_audit AFTER INSERT OR UPDATE ON crest.quote_families DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_audit();
CREATE CONSTRAINT TRIGGER quote_revision_audit AFTER INSERT OR UPDATE ON crest.quote_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_audit();
CREATE CONSTRAINT TRIGGER quote_item_audit AFTER INSERT OR UPDATE ON crest.quote_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_audit();
CREATE CONSTRAINT TRIGGER quote_aggregate AFTER INSERT OR UPDATE ON crest.quote_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_aggregate();
CREATE TRIGGER quote_family_delete BEFORE DELETE ON crest.quote_families FOR EACH ROW EXECUTE FUNCTION crest_private.reject_quote_history_change();
CREATE TRIGGER quote_family_truncate BEFORE TRUNCATE ON crest.quote_families FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_quote_history_change();
CREATE TRIGGER quote_revision_delete BEFORE DELETE ON crest.quote_revisions FOR EACH ROW EXECUTE FUNCTION crest_private.reject_quote_history_change();
CREATE TRIGGER quote_revision_truncate BEFORE TRUNCATE ON crest.quote_revisions FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_quote_history_change();
CREATE TRIGGER quote_item_delete BEFORE DELETE ON crest.quote_items FOR EACH ROW EXECUTE FUNCTION crest_private.reject_quote_history_change();
CREATE TRIGGER quote_item_truncate BEFORE TRUNCATE ON crest.quote_items FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_quote_history_change();
CREATE UNIQUE INDEX quote_audit_revision ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN('quote_families','quote_revisions','quote_items');
GRANT USAGE ON SCHEMA crest,crest_private TO crest_quote_integrity_owner;
GRANT USAGE ON TYPE crest.quote_families,crest.quote_revisions,crest.quote_items TO crest_quote_integrity_owner;
GRANT SELECT ON crest.quote_families,crest.quote_revisions,crest.quote_items TO crest_quote_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,command_type,schema_version,origin,import_row_id) ON crest_private.operations TO crest_quote_integrity_owner;
GRANT SELECT(business_id,operation_id,actor_id,entity_kind,entity_id,entity_version,action,delta) ON crest_private.audit_events TO crest_quote_integrity_owner;
CREATE POLICY quote_integrity_families ON crest.quote_families FOR SELECT TO crest_quote_integrity_owner USING(true);
CREATE POLICY quote_integrity_revisions ON crest.quote_revisions FOR SELECT TO crest_quote_integrity_owner USING(true);
CREATE POLICY quote_integrity_items ON crest.quote_items FOR SELECT TO crest_quote_integrity_owner USING(true);
CREATE POLICY quote_integrity_operations ON crest_private.operations FOR SELECT TO crest_quote_integrity_owner USING(command_type='quote.draft.save');
CREATE POLICY quote_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_quote_integrity_owner USING(entity_kind IN('quote_families','quote_revisions','quote_items'));
GRANT EXECUTE ON FUNCTION crest_private.quote_family_projection(crest.quote_families),crest_private.quote_revision_projection(crest.quote_revisions),crest_private.quote_item_projection(crest.quote_items),crest_private.calculate_quote_pricing(jsonb,jsonb),crest_private.quote_discount_cents(jsonb,numeric) TO crest_quote_integrity_owner;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
ALTER FUNCTION crest_private.check_quote_audit() OWNER TO crest_quote_integrity_owner;
ALTER FUNCTION crest_private.check_quote_aggregate() OWNER TO crest_quote_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.quote_family_projection(crest.quote_families),crest_private.quote_revision_projection(crest.quote_revisions),crest_private.quote_item_projection(crest.quote_items),crest_private.reject_quote_history_change(),crest_private.validate_quote_family_change(),crest_private.validate_quote_revision_change(),crest_private.validate_quote_item_change(),crest_private.check_quote_audit(),crest_private.check_quote_aggregate() FROM PUBLIC;
