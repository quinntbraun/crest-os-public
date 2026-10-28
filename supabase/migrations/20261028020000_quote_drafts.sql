-- Registered45 retained Draft quote construction; production activation remains blocked.
-- Exact reviewed proposal bodies and offsets are retained in QUOTE_SCHEMA45_ADOPTION.json.
-- The migration coordinator owns one atomic transaction; historical comments remain intact.

-- BEGIN REVIEWED QUOTE 1 quote-pricing
-- Unregistered BR04 construction over registered44. No tables, runtime grants,
-- migration ordinal, provider changes or production activation.
DO $review$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_schema_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR to_regprocedure('crest_private.quote_discount_cents(jsonb,numeric)') IS NOT NULL
  OR to_regprocedure('crest_private.calculate_quote_pricing(jsonb,jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_PRICING_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.quote_discount_cents(discount jsonb,base numeric) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $discount$
DECLARE amount numeric; entered text;
BEGIN
 IF base IS NULL OR base<0 OR base<>trunc(base) OR base>9223372036854775807 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 IF discount='null'::jsonb THEN RETURN 0;END IF;
 IF jsonb_typeof(discount) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 IF discount->>'kind'='fixed' AND discount ?& ARRAY['kind','cents'] AND discount-ARRAY['kind','cents']='{}'::jsonb
  AND jsonb_typeof(discount->'cents')='string' THEN
  entered:=discount->>'cents';
  IF entered!~'^(0|[1-9][0-9]{0,18})$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  amount:=entered::numeric;
 ELSIF discount->>'kind'='percent' AND discount ?& ARRAY['kind','rate'] AND discount-ARRAY['kind','rate']='{}'::jsonb
  AND jsonb_typeof(discount->'rate')='string' THEN
  entered:=discount->>'rate';
  IF entered!~'^(0|1)(\.[0-9]{1,8})?$' OR entered::numeric>1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  amount:=round(base*entered::numeric,0);
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
 IF amount>base THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_DISCOUNT_EXCEEDS_AMOUNT';END IF;
 RETURN amount;
END $discount$;

CREATE FUNCTION crest_private.calculate_quote_pricing(lines jsonb,document_discount jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $calculate$
DECLARE item jsonb; rows jsonb:='[]'::jsonb; result_rows jsonb; seen text[]:='{}'; identifier text;
 gross numeric; line_discount numeric; remaining numeric; gross_total numeric:=0; line_total numeric:=0;
 eligible_total numeric:=0; document_total numeric; total numeric; reason text;
BEGIN
 IF jsonb_typeof(lines) IS DISTINCT FROM 'array' OR jsonb_array_length(lines) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(lines) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object'
   OR NOT(item ?& ARRAY['id','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason'])
   OR item-ARRAY['id','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason']<>'{}'::jsonb
   OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'grossCents') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'documentDiscountEligible') IS DISTINCT FROM 'boolean'
   OR jsonb_typeof(item->'complimentaryReason') NOT IN('string','null') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
  END IF;
  identifier:=item->>'id';
  IF identifier!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR identifier=ANY(seen)
   OR (item->>'grossCents')!~'^(0|[1-9][0-9]{0,18})$' THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
  END IF;
  seen:=array_append(seen,identifier);gross:=(item->>'grossCents')::numeric;
  IF gross>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  reason:=item->>'complimentaryReason';
  IF reason IS NOT NULL AND (char_length(reason)>1000 OR btrim(reason,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')='' OR translate(reason,E'\t\n\r','')~'[[:cntrl:]]') THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
  END IF;
  line_discount:=crest_private.quote_discount_cents(item->'lineDiscount',gross);remaining:=gross-line_discount;
  gross_total:=gross_total+gross;line_total:=line_total+line_discount;
  IF gross_total>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';END IF;
  IF (item->>'documentDiscountEligible')::boolean THEN eligible_total:=eligible_total+remaining;END IF;
  rows:=rows||jsonb_build_array(jsonb_build_object('id',identifier,'gross',gross,'lineDiscount',line_discount,'remaining',remaining,'eligible',(item->>'documentDiscountEligible')::boolean,'reason',reason));
 END LOOP;
 document_total:=crest_private.quote_discount_cents(document_discount,eligible_total);
 WITH source AS(
  SELECT value,ordinality,CASE WHEN (value->>'eligible')::boolean THEN (value->>'remaining')::numeric ELSE 0::numeric END AS weight
  FROM jsonb_array_elements(rows) WITH ORDINALITY
 ), shares AS(
  SELECT *,CASE WHEN eligible_total>0 THEN div(document_total*weight,eligible_total) ELSE 0::numeric END AS allocated,
   CASE WHEN eligible_total>0 THEN mod(document_total*weight,eligible_total) ELSE 0::numeric END AS remainder FROM source
 ), ranked AS(
  SELECT ordinality,row_number() OVER(ORDER BY remainder DESC,ordinality) AS position FROM shares WHERE weight>0
 ), allocations AS(
  SELECT s.*,s.allocated+CASE WHEN r.position<=document_total-(SELECT sum(allocated) FROM shares) THEN 1 ELSE 0 END AS actual
  FROM shares s LEFT JOIN ranked r USING(ordinality)
 )
 SELECT jsonb_agg(jsonb_build_object('id',value->>'id','grossCents',trunc((value->>'gross')::numeric)::text,
  'lineDiscountCents',trunc((value->>'lineDiscount')::numeric)::text,'allocatedDiscountCents',trunc(actual)::text,
  'finalCents',trunc((value->>'remaining')::numeric-actual)::text,'documentDiscountEligible',(value->>'eligible')::boolean,
  'complimentaryReason',value->'reason') ORDER BY ordinality) INTO result_rows FROM allocations;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result_rows) v WHERE (v->>'finalCents')::numeric<0)
  OR (SELECT sum((v->>'allocatedDiscountCents')::numeric) FROM jsonb_array_elements(result_rows) v)<>document_total THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result_rows) v WHERE (v->>'finalCents')::numeric=0 AND v->'complimentaryReason'='null'::jsonb) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_COMPLIMENTARY_REASON_REQUIRED';
 END IF;
 total:=gross_total-line_total-document_total;
 IF (SELECT sum((v->>'finalCents')::numeric) FROM jsonb_array_elements(result_rows) v)<>total THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_PRICING_INVALID';
 END IF;
 RETURN jsonb_build_object('currency','USD','grossCents',trunc(gross_total)::text,'lineDiscountCents',trunc(line_total)::text,
  'documentDiscountCents',trunc(document_total)::text,'totalCents',trunc(total)::text,'lines',result_rows);
END $calculate$;
REVOKE ALL ON FUNCTION crest_private.quote_discount_cents(jsonb,numeric),crest_private.calculate_quote_pricing(jsonb,jsonb) FROM PUBLIC;

-- END REVIEWED QUOTE 1

-- BEGIN REVIEWED QUOTE 2 quote-draft-storage
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
 CONSTRAINT quote_revision_content_hash CHECK(content_hash~'^[a-f0-9]{64}$' AND content_hash=encode(sha256(convert_to(canonical_content,'UTF8')),'hex')),
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
  -- Extract first: subtraction binds more tightly than the JSON -> operator.
  OR NOT((NEW.customer_safe_snapshot->'recipient') ?& ARRAY['displayName','phone','email']) OR (NEW.customer_safe_snapshot->'recipient')-ARRAY['displayName','phone','email']<>'{}'::jsonb
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

-- END REVIEWED QUOTE 2

-- BEGIN REVIEWED QUOTE 3 quote-draft-commands
-- Unregistered trusted Draft construction over registered44 + accepted quote
-- pricing/storage proposals. Owner-only crm.manage; no finance capability.
DO $review$
DECLARE r oid;
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='crest_quote_owner';
 IF r IS NULL THEN
  CREATE ROLE crest_quote_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ALTER DEFAULT PRIVILEGES FOR ROLE crest_quote_owner REVOKE ALL ON ROUTINES FROM PUBLIC;
  SELECT oid INTO r FROM pg_roles WHERE rolname='crest_quote_owner';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=r OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') OR has_table_privilege(r,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=r AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',r))) a WHERE a.grantee<>r)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_ROLE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN('crest_schema_owner','crest_session_owner','crest_quote_integrity_owner'))
  OR EXISTS(SELECT 1 FROM pg_roles p CROSS JOIN LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=p.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',p.oid))) a WHERE p.rolname IN('crest_schema_owner','crest_session_owner') AND a.grantee<>p.oid)
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.quote_families'::regclass,'crest.quote_revisions'::regclass,'crest.quote_items'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.businesses'::regclass,'crest.memberships'::regclass,'crest_private.app_sessions'::regclass,'crest_private.business_recovery_authorities'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>9
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_family_projection(crest.quote_families)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e52360a7f1d1f2db24ddd11122876563d436cf1ad722d038aa9be0eeb0bc7e01') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_revision_projection(crest.quote_revisions)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='403998e14bcb7f79eaf6e4869bf0787711ce84855a89af58f465036866166895') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_item_projection(crest.quote_items)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b04d429fde9e8d08381c5705ccea735649181731fa50cba51f7331043718aa1d') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.reject_quote_history_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='561eb0e11c186a935c72df0016ad0030db2a86962958b390866d8d9642728a0a') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_quote_family_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e71e1344d974341d24e615566bde20920dbc075246f9b3ea398cba30730f5825') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_quote_revision_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8a85fa2ec4309efffcfb6d96c7caaa5085393c49da0a808902caeaffa10ed444') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_quote_item_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d40743aacdfe4f1bbbd06659d7e26cbd48a92f7a65ffb0e192e277700a9c73be') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_quote_audit()') AND p.proowner='crest_quote_integrity_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e93aa14954d249192fa52a2da0b6a66d6f7d1dd566eac5cc9e04e029682caba3') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_quote_aggregate()') AND p.proowner='crest_quote_integrity_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='90572fe90e63d466d0aec4d9529e9d63df974c97a091f78fa351e39a45ceed97') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_discount_cents(jsonb,numeric)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ff13fa6fd1b102045953e137ef7af34ddfa5f9a8763757e8cd18f7b3618b67d0') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.calculate_quote_pricing(jsonb,jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2915d99f70eeb1f948567a7ea1c37d8741eb337a21b1d60fa0f19a3fc628868f') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='614b87966124be9297a7658a86bc3ee84a29f19f381a80ca23ecf702ffa0e952') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='9b2d19abde943ad1353250275d1b3bf66b34b9ff5fbe1a6d16b73a0ef42cae35') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
DO $storage_review$
BEGIN
 IF (SELECT count(*) FROM (VALUES
  ('crest.quote_families','quote_family_change','crest_private.validate_quote_family_change()',23,false),
  ('crest.quote_revisions','quote_revision_change','crest_private.validate_quote_revision_change()',23,false),
  ('crest.quote_items','quote_item_change','crest_private.validate_quote_item_change()',23,false),
  ('crest.quote_families','quote_family_audit','crest_private.check_quote_audit()',21,true),
  ('crest.quote_revisions','quote_revision_audit','crest_private.check_quote_audit()',21,true),
  ('crest.quote_items','quote_item_audit','crest_private.check_quote_audit()',21,true),
  ('crest.quote_revisions','quote_aggregate','crest_private.check_quote_aggregate()',21,true),
  ('crest.quote_families','quote_family_delete','crest_private.reject_quote_history_change()',11,false),
  ('crest.quote_families','quote_family_truncate','crest_private.reject_quote_history_change()',34,false),
  ('crest.quote_revisions','quote_revision_delete','crest_private.reject_quote_history_change()',11,false),
  ('crest.quote_revisions','quote_revision_truncate','crest_private.reject_quote_history_change()',34,false),
  ('crest.quote_items','quote_item_delete','crest_private.reject_quote_history_change()',11,false),
  ('crest.quote_items','quote_item_truncate','crest_private.reject_quote_history_change()',34,false)
 ) expected(relation,name,routine,kind,deferred) JOIN pg_trigger t ON t.tgrelid=to_regclass(expected.relation) AND t.tgname=expected.name AND t.tgfoid=to_regprocedure(expected.routine) AND t.tgtype=expected.kind AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=expected.deferred AND t.tginitdeferred=expected.deferred)<>13
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.quote_families'::regclass AND conname='quote_current_revision' AND contype='f' AND conkey=ARRAY[2,1,5]::smallint[] AND confrelid='crest.quote_revisions'::regclass AND confkey=ARRAY[2,3,1]::smallint[] AND confdeltype='r' AND convalidated AND condeferrable AND condeferred)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $storage_review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_quote_owner;
GRANT USAGE ON TYPE crest.quote_families,crest.quote_revisions,crest.quote_items TO crest_quote_owner;
GRANT SELECT ON crest.quote_families,crest.quote_revisions,crest.quote_items TO crest_quote_owner;
GRANT INSERT(id,business_id,lead_id,customer_id,current_revision_id,created_by,updated_by,origin,operation_id) ON crest.quote_families TO crest_quote_owner;
GRANT UPDATE(version,updated_by,operation_id) ON crest.quote_families TO crest_quote_owner;
GRANT INSERT(id,business_id,family_id,sequence,customer_safe_snapshot,internal_snapshot,canonical_content,content_hash,total_cents,expiry_at,timezone,created_by,updated_by,origin,operation_id) ON crest.quote_revisions TO crest_quote_owner;
GRANT UPDATE(version,content_version,customer_safe_snapshot,internal_snapshot,canonical_content,content_hash,total_cents,expiry_at,timezone,updated_by,operation_id) ON crest.quote_revisions TO crest_quote_owner;
GRANT INSERT(id,business_id,revision_id,stable_line_key,active,position,vehicle_id,job_wide,service_version_id,gross_cents,line_discount,document_discount_eligible,line_discount_cents,allocated_discount_cents,final_cents,complimentary_reason,customer_snapshot,created_by,updated_by,origin,operation_id) ON crest.quote_items TO crest_quote_owner;
GRANT UPDATE(active,position,vehicle_id,job_wide,service_version_id,gross_cents,line_discount,document_discount_eligible,line_discount_cents,allocated_discount_cents,final_cents,complimentary_reason,customer_snapshot,version,updated_by,operation_id) ON crest.quote_items TO crest_quote_owner;
CREATE POLICY quote_command_family_read ON crest.quote_families FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_command_family_create ON crest.quote_families FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY quote_command_family_edit ON crest.quote_families FOR UPDATE TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY quote_command_revision_read ON crest.quote_revisions FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_command_revision_create ON crest.quote_revisions FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY quote_command_revision_edit ON crest.quote_revisions FOR UPDATE TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY quote_command_item_read ON crest.quote_items FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_command_item_create ON crest.quote_items FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY quote_command_item_edit ON crest.quote_items FOR UPDATE TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_quote_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_quote_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_quote_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_quote_owner;
CREATE POLICY quote_command_operations_read ON crest_private.operations FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.draft.save');
CREATE POLICY quote_command_operations_create ON crest_private.operations FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='quote.draft.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY quote_command_operations_finish ON crest_private.operations FOR UPDATE TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.draft.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.draft.save');
CREATE POLICY quote_command_audits_read ON crest_private.audit_events FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('quote_families','quote_revisions','quote_items'));
CREATE POLICY quote_command_audits_create ON crest_private.audit_events FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('quote_families','quote_revisions','quote_items') AND origin='manual' AND import_row_id IS NULL);
GRANT EXECUTE ON FUNCTION crest_private.quote_family_projection(crest.quote_families),crest_private.quote_revision_projection(crest.quote_revisions),crest_private.quote_item_projection(crest.quote_items),crest_private.calculate_quote_pricing(jsonb,jsonb),crest_private.quote_discount_cents(jsonb,numeric) TO crest_quote_owner;

CREATE FUNCTION crest_private.valid_quote_draft_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE c jsonb; i jsonb; line jsonb; source jsonb; k text; s text; n integer; ids text[]:='{}'; inputs jsonb:='[]'; calculated jsonb; blanks text:=E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT(body ?& ARRAY['customer','internal','canonical']) OR body-ARRAY['customer','internal','canonical']<>'{}'::jsonb OR jsonb_typeof(body->'canonical') IS DISTINCT FROM 'string' OR octet_length(body->>'canonical')>16777216 THEN RETURN false;END IF;
 c:=body->'customer';i:=body->'internal';
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(i) IS DISTINCT FROM 'object' OR (body->>'canonical')::jsonb IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'customer',c,'internal',i)
  OR NOT(c ?& ARRAY['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents']) OR c-ARRAY['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents']<>'{}'::jsonb
  OR c->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR c->>'currency' IS DISTINCT FROM 'USD'
  OR NOT(i ?& ARRAY['customerId','leadId','notes','sources','extremeReviewRequired']) OR i-ARRAY['customerId','leadId','notes','sources','extremeReviewRequired']<>'{}'::jsonb OR jsonb_typeof(i->'extremeReviewRequired') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(c->'recipient') IS DISTINCT FROM 'object' OR NOT((c->'recipient') ?& ARRAY['displayName','phone','email']) OR (c->'recipient')-ARRAY['displayName','phone','email']<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['title','workLocation','terms','timezone'] LOOP
  IF jsonb_typeof(c->k) IS DISTINCT FROM 'string' THEN RETURN false;END IF;s:=c->>k;
  IF char_length(s)>(CASE k WHEN 'title' THEN 200 WHEN 'workLocation' THEN 4000 WHEN 'timezone' THEN 100 ELSE 8000 END) OR (k<>'terms' AND btrim(s,blanks)='') OR (CASE WHEN k IN('title','timezone') THEN s ELSE translate(s,E'\t\n\r','') END)~'[[:cntrl:]]' THEN RETURN false;END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE lower(name)=lower(c->>'timezone')) THEN RETURN false;END IF;
 s:=c->'recipient'->>'displayName';IF jsonb_typeof(c->'recipient'->'displayName') IS DISTINCT FROM 'string' OR char_length(s)>200 OR btrim(s,blanks)='' OR s~'[[:cntrl:]]' THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['phone','email'] LOOP IF c->'recipient'->k<>'null'::jsonb THEN s:=c->'recipient'->>k;IF jsonb_typeof(c->'recipient'->k) IS DISTINCT FROM 'string' OR char_length(s)>512 OR btrim(s,blanks)='' OR s~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['customerId','leadId'] LOOP IF i->k<>'null'::jsonb AND (jsonb_typeof(i->k) IS DISTINCT FROM 'string' OR (i->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RETURN false;END IF;END LOOP;
 IF i->'customerId'='null'::jsonb AND i->'leadId'='null'::jsonb THEN RETURN false;END IF;
 IF i->'notes'<>'null'::jsonb THEN s:=i->>'notes';IF jsonb_typeof(i->'notes') IS DISTINCT FROM 'string' OR char_length(s)>8000 OR btrim(s,blanks)='' OR translate(s,E'\t\n\r','')~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;
 IF c->'proposedSchedule'<>'null'::jsonb THEN s:=c->>'proposedSchedule';IF jsonb_typeof(c->'proposedSchedule') IS DISTINCT FROM 'string' OR char_length(s)>2000 OR btrim(s,blanks)='' OR translate(s,E'\t\n\r','')~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;
 IF c->'expiryAt'<>'null'::jsonb THEN s:=c->>'expiryAt';IF jsonb_typeof(c->'expiryAt') IS DISTINCT FROM 'string' OR s!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR to_char(s::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>s THEN RETURN false;END IF;END IF;
 IF jsonb_typeof(c->'lines') IS DISTINCT FROM 'array' OR jsonb_typeof(i->'sources') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 n:=jsonb_array_length(c->'lines');IF n NOT BETWEEN 1 AND 1000 OR jsonb_array_length(i->'sources')<>n THEN RETURN false;END IF;
 FOR line_index IN 0..n-1 LOOP
  line:=c->'lines'->line_index;source:=i->'sources'->line_index;
  IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR NOT(line ?& ARRAY['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason']) OR line-ARRAY['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason']<>'{}'::jsonb
   OR jsonb_typeof(source) IS DISTINCT FROM 'object' OR NOT(source ?& ARRAY['stableLineKey','vehicleId','jobWide','serviceVersionId']) OR source-ARRAY['stableLineKey','vehicleId','jobWide','serviceVersionId']<>'{}'::jsonb OR jsonb_typeof(source->'jobWide') IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['stableLineKey','vehicleId','serviceVersionId'] LOOP IF source->k<>'null'::jsonb AND (jsonb_typeof(source->k) IS DISTINCT FROM 'string' OR (source->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RETURN false;END IF;END LOOP;
  IF source->'stableLineKey'='null'::jsonb OR source->>'stableLineKey'=ANY(ids) THEN RETURN false;END IF;ids:=array_append(ids,source->>'stableLineKey');
  IF source->'vehicleId'='null'::jsonb THEN IF source->'jobWide' IS DISTINCT FROM 'true'::jsonb OR line->'vehicle' IS DISTINCT FROM 'null'::jsonb THEN RETURN false;END IF;
  ELSE IF source->'jobWide' IS DISTINCT FROM 'false'::jsonb OR jsonb_typeof(line->'vehicle') IS DISTINCT FROM 'string' OR char_length(line->>'vehicle')>500 OR btrim(line->>'vehicle',blanks)='' OR (line->>'vehicle')~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;
  IF line->'condition'<>'null'::jsonb AND (jsonb_typeof(line->'condition') IS DISTINCT FROM 'string' OR line->>'condition' NOT IN('Light','Moderate','Heavy','Extreme')) THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['description','inclusions','exclusions'] LOOP s:=line->>k;IF jsonb_typeof(line->k) IS DISTINCT FROM 'string' OR char_length(s)>(CASE WHEN k='description' THEN 200 ELSE 8000 END) OR (k='description' AND btrim(s,blanks)='') OR (CASE WHEN k='description' THEN s ELSE translate(s,E'\t\n\r','') END)~'[[:cntrl:]]' THEN RETURN false;END IF;END LOOP;
  inputs:=inputs||jsonb_build_array(jsonb_build_object('id',source->'stableLineKey','grossCents',line->'grossCents','lineDiscount',line->'lineDiscount','documentDiscountEligible',line->'documentDiscountEligible','complimentaryReason',line->'complimentaryReason'));
 END LOOP;
 calculated:=crest_private.calculate_quote_pricing(inputs,c->'documentDiscount');
 IF NOT(c @> (calculated-'lines')) OR i->'extremeReviewRequired' IS DISTINCT FROM to_jsonb(EXISTS(SELECT 1 FROM jsonb_array_elements(c->'lines') entry WHERE entry->>'condition'='Extreme')) THEN RETURN false;END IF;
 FOR line_index IN 0..n-1 LOOP IF NOT(c->'lines'->line_index @> ((calculated->'lines'->line_index)-'id')) THEN RETURN false;END IF;END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN RETURN false;
END $valid$;

CREATE FUNCTION crest_commands.authorize_quote_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;
BEGIN
 context:=crest_commands.read_authorized_business_context($1,$2,$3,$4,$5,$6,$7,$8);
 IF NOT EXISTS(SELECT 1 FROM crest_private.role_capabilities WHERE role='owner' AND capability='crm.manage') OR NOT EXISTS(SELECT 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=expected_actor AND active AND role='owner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_READ_DENIED';END IF;RETURN context;
END $read$;
CREATE FUNCTION crest_commands.finish_quote_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $finish$
BEGIN
 PERFORM crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);
 PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);
 UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_SAVE_DENIED';END IF;
END $finish$;

CREATE FUNCTION crest_private.quote_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations; receipt jsonb; family_audit crest_private.audit_events; revision_audit crest_private.audit_events; item_audit crest_private.audit_events; f jsonb; r jsonb; expected_family text; expected_revision text; body jsonb; digest text; count_items integer; seen uuid[]:='{}'; event jsonb; k text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type='quote.draft.save';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 receipt:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt ?& ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']) OR receipt-ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR receipt->>'businessId' IS DISTINCT FROM requested_business::text OR jsonb_typeof(receipt->'itemAuditEventIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH k IN ARRAY ARRAY['businessId','familyId','revisionId','familyAuditEventId','revisionAuditEventId'] LOOP IF jsonb_typeof(receipt->k) IS DISTINCT FROM 'string' OR (receipt->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['familyVersion','revisionVersion','contentVersion'] LOOP IF jsonb_typeof(receipt->k) IS DISTINCT FROM 'string' OR (receipt->>k)!~'^[1-9][0-9]{0,18}$' OR (receipt->>k)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 IF jsonb_typeof(receipt->'contentHash') IS DISTINCT FROM 'string' OR (receipt->>'contentHash')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO family_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'familyAuditEventId')::uuid AND entity_kind='quote_families' AND entity_id=(receipt->>'familyId')::uuid AND entity_version=(receipt->>'familyVersion')::bigint;
 SELECT * INTO revision_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(receipt->>'revisionAuditEventId')::uuid AND entity_kind='quote_revisions' AND entity_id=(receipt->>'revisionId')::uuid AND entity_version=(receipt->>'revisionVersion')::bigint;
 IF family_audit.id IS NULL OR revision_audit.id IS NULL OR family_audit.delta->'before' IS NULL OR revision_audit.delta->'before' IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 f:=family_audit.delta->'after';r:=revision_audit.delta->'after';expected_family:=CASE WHEN family_audit.delta->'before'='null'::jsonb THEN '0' ELSE family_audit.delta->'before'->>'version' END;expected_revision:=CASE WHEN revision_audit.delta->'before'='null'::jsonb THEN '0' ELSE revision_audit.delta->'before'->>'version' END;
 IF f->>'id' IS DISTINCT FROM receipt->>'familyId' OR f->>'business_id' IS DISTINCT FROM requested_business::text OR f->>'updated_by' IS DISTINCT FROM requested_actor::text OR f->>'operation_id' IS DISTINCT FROM requested_operation::text OR f->>'version' IS DISTINCT FROM receipt->>'familyVersion' OR f->>'current_revision_id' IS DISTINCT FROM receipt->>'revisionId'
  OR r->>'id' IS DISTINCT FROM receipt->>'revisionId' OR r->>'business_id' IS DISTINCT FROM requested_business::text OR r->>'updated_by' IS DISTINCT FROM requested_actor::text OR r->>'operation_id' IS DISTINCT FROM requested_operation::text OR r->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR r->>'version' IS DISTINCT FROM receipt->>'revisionVersion' OR r->>'content_version' IS DISTINCT FROM receipt->>'contentVersion' OR r->>'content_hash' IS DISTINCT FROM receipt->>'contentHash'
  OR expected_family::numeric+1 IS DISTINCT FROM (receipt->>'familyVersion')::numeric OR expected_revision::numeric+1 IS DISTINCT FROM (receipt->>'revisionVersion')::numeric
  OR family_audit.action<>(CASE WHEN expected_family='0' THEN 'create' ELSE 'edit' END) OR revision_audit.action<>(CASE WHEN expected_revision='0' THEN 'create' ELSE 'edit' END)
  OR NOT EXISTS(SELECT 1 FROM crest.quote_families WHERE business_id=requested_business AND id=(receipt->>'familyId')::uuid AND version>=(receipt->>'familyVersion')::bigint)
  OR NOT EXISTS(SELECT 1 FROM crest.quote_revisions WHERE business_id=requested_business AND id=(receipt->>'revisionId')::uuid AND family_id=(receipt->>'familyId')::uuid AND version>=(receipt->>'revisionVersion')::bigint)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 body:=jsonb_build_object('customer',r->'customer_safe_snapshot','internal',r->'internal_snapshot','canonical',r->'canonical_content');
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','quote.draft.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'familyId',receipt->'familyId','revisionId',receipt->'revisionId','expectedFamilyVersion',expected_family,'expectedRevisionVersion',expected_revision,'payload',body)::text,'UTF8')),'hex');
 IF NOT crest_private.valid_quote_draft_payload(body) OR digest<>o.payload_hash OR encode(sha256(convert_to(r->>'canonical_content','UTF8')),'hex') IS DISTINCT FROM receipt->>'contentHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 FOR event IN SELECT value FROM jsonb_array_elements(receipt->'itemAuditEventIds') LOOP
  IF jsonb_typeof(event)<>'string' OR (event#>>'{}')::uuid=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO item_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(event#>>'{}')::uuid AND entity_kind='quote_items';
  IF NOT FOUND OR item_audit.delta->'before' IS NULL OR item_audit.delta->'after'->>'revision_id' IS DISTINCT FROM receipt->>'revisionId' OR item_audit.delta->'after'->>'version' IS DISTINCT FROM item_audit.entity_version::text OR item_audit.action<>(CASE WHEN item_audit.delta->'before'='null'::jsonb THEN 'create' ELSE 'edit' END)
   OR NOT EXISTS(SELECT 1 FROM crest.quote_items WHERE business_id=requested_business AND revision_id=(receipt->>'revisionId')::uuid AND id=item_audit.entity_id AND version>=item_audit.entity_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  seen:=array_append(seen,item_audit.id);
 END LOOP;
 count_items:=jsonb_array_length(receipt->'itemAuditEventIds');IF (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>count_items+2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';
END $result$;
CREATE FUNCTION crest_commands.save_quote_draft(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_family uuid,requested_revision uuid,expected_family_version bigint,expected_revision_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; content_digest text; claimed uuid; existing crest_private.operations; old_family crest.quote_families; family crest.quote_families; old_revision crest.quote_revisions; revision crest.quote_revisions; old_item crest.quote_items; item crest.quote_items;
 customer jsonb; internal jsonb; line jsonb; source jsonb; keys uuid[]:='{}'; event_id uuid; family_event uuid; revision_event uuid; item_events jsonb:='[]'::jsonb; command_result jsonb; changed boolean; violated text; line_index integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_family IS NULL OR requested_revision IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_family_version IS NULL OR expected_revision_version IS NULL OR expected_family_version<0 OR expected_revision_version<0 OR (expected_family_version=0)<>(expected_revision_version=0) OR NOT crest_private.valid_quote_draft_payload(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_INPUT_REQUIRED';END IF;
 BEGIN
  context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_QUOTE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','quote.draft.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'familyId',requested_family,'revisionId',requested_revision,'expectedFamilyVersion',expected_family_version::text,'expectedRevisionVersion',expected_revision_version::text,'payload',body)::text,'UTF8')),'hex');
 customer:=body->'customer';internal:=body->'internal';content_digest:=encode(sha256(convert_to(body->>'canonical','UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'quote.draft.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.quote_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   SELECT * INTO old_family FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family FOR UPDATE;
   SELECT * INTO old_revision FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision FOR UPDATE;
   IF coalesce(old_family.version,0)<>expected_family_version OR coalesce(old_revision.version,0)<>expected_revision_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
   IF expected_family_version>0 THEN
    IF old_family.current_revision_id<>requested_revision OR old_revision.state<>'Draft' OR old_revision.kind<>'initial' OR old_revision.tax_readiness<>'not_configured' THEN RAISE EXCEPTION USING ERRCODE='P1004',MESSAGE='CREST_QUOTE_STATE_CONFLICT';END IF;
    IF old_family.customer_id::text IS DISTINCT FROM internal->>'customerId' OR old_family.lead_id::text IS DISTINCT FROM internal->>'leadId' THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_QUOTE_FAMILY_RETAINED';END IF;
    IF old_revision.canonical_content=body->>'canonical' THEN RAISE EXCEPTION USING ERRCODE='P1003',MESSAGE='CREST_QUOTE_UNCHANGED';END IF;
   ELSE
    INSERT INTO crest.quote_families(id,business_id,lead_id,customer_id,current_revision_id,created_by,updated_by,origin,operation_id) VALUES(requested_family,requested_business,(internal->>'leadId')::uuid,(internal->>'customerId')::uuid,requested_revision,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO family;
    INSERT INTO crest.quote_revisions(id,business_id,family_id,sequence,customer_safe_snapshot,internal_snapshot,canonical_content,content_hash,total_cents,expiry_at,timezone,created_by,updated_by,origin,operation_id) VALUES(requested_revision,requested_business,requested_family,1,customer,internal,body->>'canonical',content_digest,(customer->>'totalCents')::bigint,(customer->>'expiryAt')::timestamptz,customer->>'timezone',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO revision;
   END IF;
   IF expected_family_version>0 THEN
    UPDATE crest.quote_revisions SET version=version+1,content_version=content_version+1,customer_safe_snapshot=customer,internal_snapshot=internal,canonical_content=body->>'canonical',content_hash=content_digest,total_cents=(customer->>'totalCents')::bigint,expiry_at=(customer->>'expiryAt')::timestamptz,timezone=customer->>'timezone',updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_revision RETURNING * INTO revision;
    UPDATE crest.quote_families SET version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_family RETURNING * INTO family;
   END IF;
   FOR line_index IN 0..jsonb_array_length(internal->'sources')-1 LOOP
    source:=internal->'sources'->line_index;line:=customer->'lines'->line_index;keys:=array_append(keys,(source->>'stableLineKey')::uuid);
   END LOOP;
   -- Retain removed line values and audit them. Positions are deferred so a
   -- reorder can be atomic without temporary or silently duplicated scope.
   FOR old_item IN SELECT * FROM crest.quote_items WHERE business_id=requested_business AND revision_id=requested_revision AND active AND NOT(stable_line_key=ANY(keys)) ORDER BY id FOR UPDATE LOOP
    UPDATE crest.quote_items SET active=false,position=NULL,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=old_item.id RETURNING * INTO item;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_items',item.id,item.version,'edit',jsonb_build_object('schemaVersion',1,'before',crest_private.quote_item_projection(old_item),'after',crest_private.quote_item_projection(item)),'manual') RETURNING id INTO event_id;item_events:=item_events||jsonb_build_array(event_id);
   END LOOP;
   FOR line_index IN 0..jsonb_array_length(internal->'sources')-1 LOOP
    source:=internal->'sources'->line_index;line:=customer->'lines'->line_index;
    SELECT * INTO old_item FROM crest.quote_items WHERE business_id=requested_business AND revision_id=requested_revision AND stable_line_key=(source->>'stableLineKey')::uuid FOR UPDATE;
    changed:=old_item.id IS NULL OR NOT old_item.active OR old_item.position IS DISTINCT FROM line_index+1 OR old_item.vehicle_id::text IS DISTINCT FROM source->>'vehicleId' OR old_item.job_wide IS DISTINCT FROM (source->>'jobWide')::boolean OR old_item.service_version_id::text IS DISTINCT FROM source->>'serviceVersionId' OR old_item.customer_snapshot IS DISTINCT FROM line;
    IF NOT changed THEN CONTINUE;END IF;
    IF old_item.id IS NULL THEN
     INSERT INTO crest.quote_items(id,business_id,revision_id,stable_line_key,active,position,vehicle_id,job_wide,service_version_id,gross_cents,line_discount,document_discount_eligible,line_discount_cents,allocated_discount_cents,final_cents,complimentary_reason,customer_snapshot,created_by,updated_by,origin,operation_id) VALUES(gen_random_uuid(),requested_business,requested_revision,(source->>'stableLineKey')::uuid,true,line_index+1,(source->>'vehicleId')::uuid,(source->>'jobWide')::boolean,(source->>'serviceVersionId')::uuid,(line->>'grossCents')::bigint,line->'lineDiscount',(line->>'documentDiscountEligible')::boolean,(line->>'lineDiscountCents')::bigint,(line->>'allocatedDiscountCents')::bigint,(line->>'finalCents')::bigint,line->>'complimentaryReason',line,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO item;
    ELSE
     UPDATE crest.quote_items SET active=true,position=line_index+1,vehicle_id=(source->>'vehicleId')::uuid,job_wide=(source->>'jobWide')::boolean,service_version_id=(source->>'serviceVersionId')::uuid,gross_cents=(line->>'grossCents')::bigint,line_discount=line->'lineDiscount',document_discount_eligible=(line->>'documentDiscountEligible')::boolean,line_discount_cents=(line->>'lineDiscountCents')::bigint,allocated_discount_cents=(line->>'allocatedDiscountCents')::bigint,final_cents=(line->>'finalCents')::bigint,complimentary_reason=line->>'complimentaryReason',customer_snapshot=line,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=old_item.id RETURNING * INTO item;
    END IF;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_items',item.id,item.version,CASE WHEN old_item.id IS NULL THEN 'create' ELSE 'edit' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN old_item.id IS NULL THEN 'null'::jsonb ELSE crest_private.quote_item_projection(old_item) END,'after',crest_private.quote_item_projection(item)),'manual') RETURNING id INTO event_id;item_events:=item_events||jsonb_build_array(event_id);
   END LOOP;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_families',family.id,family.version,CASE WHEN expected_family_version=0 THEN 'create' ELSE 'edit' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_family_version=0 THEN 'null'::jsonb ELSE crest_private.quote_family_projection(old_family) END,'after',crest_private.quote_family_projection(family)),'manual') RETURNING id INTO family_event;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_revisions',revision.id,revision.version,CASE WHEN expected_revision_version=0 THEN 'create' ELSE 'edit' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_revision_version=0 THEN 'null'::jsonb ELSE crest_private.quote_revision_projection(old_revision) END,'after',crest_private.quote_revision_projection(revision)),'manual') RETURNING id INTO revision_event;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'familyId',family.id,'familyVersion',family.version::text,'revisionId',revision.id,'revisionVersion',revision.version::text,'contentVersion',revision.content_version::text,'contentHash',revision.content_hash,'familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'itemAuditEventIds',item_events));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_quote_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentFamilyVersion',coalesce(old_family.version,0)::text,'currentRevisionVersion',coalesce(old_revision.version,0)::text);
  WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','family');
  WHEN SQLSTATE 'P1003' THEN RETURN jsonb_build_object('state','unchanged','familyId',requested_family,'familyVersion',old_family.version::text,'revisionId',requested_revision,'revisionVersion',old_revision.version::text,'contentHash',old_revision.content_hash);
  WHEN SQLSTATE 'P1004' THEN RETURN jsonb_build_object('state','conflict','reason','state');
  WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated='quote_families_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','family');ELSIF violated='quote_revisions_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','revision');END IF;RAISE;
  WHEN foreign_key_violation THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REFERENCE_REQUIRED';
 END;
END $save$;

CREATE FUNCTION crest_commands.lookup_quote_draft_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.quote_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_commands.read_quote_draft_directory(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,search_text text,after_family uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF search_text IS NULL OR char_length(search_text)>200 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH matches AS MATERIALIZED(SELECT f.id,crest_private.quote_family_projection(f) AS family,crest_private.quote_revision_projection(r) AS revision FROM crest.quote_families f JOIN crest.quote_revisions r ON r.business_id=f.business_id AND r.family_id=f.id AND r.id=f.current_revision_id WHERE f.business_id=requested_business AND (after_family IS NULL OR f.id>after_family) AND (search_text='' OR strpos(lower(r.customer_safe_snapshot->>'title'),lower(search_text))>0 OR strpos(lower(r.customer_safe_snapshot->'recipient'->>'displayName'),lower(search_text))>0) ORDER BY f.id LIMIT page_limit+1),page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'quotes',coalesce((SELECT jsonb_agg(jsonb_build_object('family',family,'revision',revision) ORDER BY id) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_PAGE_LIMIT';END IF;RETURN result;
END $directory$;
CREATE FUNCTION crest_commands.read_quote_draft_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_family uuid,requested_revision uuid,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb; family crest.quote_families; revision crest.quote_revisions; result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_family IS NULL OR requested_revision IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO family FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family;SELECT * INTO revision FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision;
 IF family.id IS NULL OR revision.id IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 WITH events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='quote_revisions' AND entity_id=requested_revision AND entity_version>after_version AND entity_version<=revision.version ORDER BY entity_version LIMIT page_limit+1),page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'family',crest_private.quote_family_projection(family),'revision',crest_private.quote_revision_projection(revision),'items',coalesce((SELECT jsonb_agg(crest_private.quote_item_projection(v) ORDER BY active DESC,position NULLS LAST,id) FROM crest.quote_items v WHERE business_id=requested_business AND revision_id=requested_revision),'[]'::jsonb),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('eventId',id,'revision',entity_version::text,'action',action,'at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actorId',actor_id,'operationId',operation_id,'before',delta->'before','after',delta->'after') ORDER BY entity_version) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM events)) INTO result;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_PAGE_LIMIT';END IF;RETURN result;
END $history$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_quote_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_owner;
ALTER FUNCTION crest_commands.authorize_quote_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_quote_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_private.valid_quote_draft_payload(jsonb) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_private.quote_operation_result(uuid,uuid,uuid) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.lookup_quote_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.read_quote_draft_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.read_quote_draft_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) OWNER TO crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_owner;
REVOKE ALL ON FUNCTION crest_private.valid_quote_draft_payload(jsonb),crest_private.quote_operation_result(uuid,uuid,uuid),crest_commands.authorize_quote_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_quote_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb),crest_commands.lookup_quote_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_quote_draft_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,integer),crest_commands.read_quote_draft_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_quote_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_quote_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_quote_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb),crest_commands.lookup_quote_draft_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_quote_draft_directory(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid,integer),crest_commands.read_quote_draft_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) TO crest_web;

-- END REVIEWED QUOTE 3

-- BEGIN REVIEWED QUOTE 4 quote-draft-source
-- Unregistered construction over registered44 plus the pinned quote proposals.
-- Export credential only. No runtime route, registry adoption or real-data gate.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_quote_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_quote_owner')
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_quote_owner',oid,'CREATE'))
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.quote_families'::regclass,'crest.quote_revisions'::regclass,'crest.quote_items'::regclass,'crest.businesses'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_SOURCE_REVIEW_REQUIRED'; END IF;
 IF  (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.quote_families'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','lead_id','customer_id','current_revision_id','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']
 OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.quote_revisions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','family_id','sequence','kind','state','version','content_version','customer_safe_snapshot','internal_snapshot','canonical_content','content_hash','total_cents','expiry_at','timezone','tax_readiness','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']
 OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.quote_items'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','revision_id','stable_line_key','active','position','vehicle_id','job_wide','service_version_id','gross_cents','line_discount','document_discount_eligible','line_discount_cents','allocated_discount_cents','final_cents','complimentary_reason','customer_snapshot','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_SOURCE_REVIEW_REQUIRED'; END IF;
 IF (SELECT count(*) FROM (VALUES
  ('crest_private.quote_family_projection(crest.quote_families)','e52360a7f1d1f2db24ddd11122876563d436cf1ad722d038aa9be0eeb0bc7e01'),
  ('crest_private.quote_revision_projection(crest.quote_revisions)','403998e14bcb7f79eaf6e4869bf0787711ce84855a89af58f465036866166895'),
  ('crest_private.quote_item_projection(crest.quote_items)','b04d429fde9e8d08381c5705ccea735649181731fa50cba51f7331043718aa1d')
 ) expected(signature,hash) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.proowner='crest_schema_owner'::regrole AND NOT p.prosecdef AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.hash)<>3
  OR NOT has_table_privilege('crest_quote_owner','crest.quote_families','SELECT')
  OR NOT has_table_privilege('crest_quote_owner','crest.quote_revisions','SELECT')
  OR NOT has_table_privilege('crest_quote_owner','crest.quote_items','SELECT')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_SOURCE_REVIEW_REQUIRED'; END IF;
END $review$;
SET ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_quote_owner;
CREATE POLICY quote_export_business ON crest.businesses FOR SELECT TO crest_quote_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.quote_draft_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE families bigint; revisions bigint; items bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_QUOTE_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_SCOPE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_SCOPE_REQUIRED'; END IF;
 SELECT count(*) INTO families FROM crest.quote_families WHERE business_id=requested_business;
 SELECT count(*) INTO revisions FROM crest.quote_revisions WHERE business_id=requested_business;
 SELECT count(*) INTO items FROM crest.quote_items WHERE business_id=requested_business;
 IF families+revisions+items>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_SNAPSHOT_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','quote_draft','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.quote-draft.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'expectedFamilyCount',families::text,'expectedRevisionCount',revisions::text,'expectedItemCount',items::text);
END $context$;
CREATE FUNCTION crest_commands.quote_draft_snapshot_families(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_draft_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_families WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'families',coalesce(jsonb_agg(crest_private.quote_family_projection(p::crest.quote_families) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_families later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
CREATE FUNCTION crest_commands.quote_draft_snapshot_revisions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_draft_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_revisions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'revisions',coalesce(jsonb_agg(crest_private.quote_revision_projection(p::crest.quote_revisions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_revisions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
CREATE FUNCTION crest_commands.quote_draft_snapshot_items(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_draft_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_items WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'items',coalesce(jsonb_agg(crest_private.quote_item_projection(p::crest.quote_items) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_items later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_draft_snapshot_context(uuid) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_draft_snapshot_families(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_draft_snapshot_revisions(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_draft_snapshot_items(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner;
REVOKE ALL ON FUNCTION crest_commands.quote_draft_snapshot_context(uuid),crest_commands.quote_draft_snapshot_families(uuid,text,uuid,integer),crest_commands.quote_draft_snapshot_revisions(uuid,text,uuid,integer),crest_commands.quote_draft_snapshot_items(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.quote_draft_snapshot_context(uuid),crest_commands.quote_draft_snapshot_families(uuid,text,uuid,integer),crest_commands.quote_draft_snapshot_revisions(uuid,text,uuid,integer),crest_commands.quote_draft_snapshot_items(uuid,text,uuid,integer) TO crest_export;

-- END REVIEWED QUOTE 4

-- BEGIN REVIEWED QUOTE 5 quote-draft-resolution
-- Unregistered quote Draft original-save review over registered44.
-- Extend only the closed IDs/versions validator. Generic retirement, claim
-- serialization, classification, authorization and grants remain unchanged.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner','crest_quote_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>5
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner','crest_quote_owner'))
  OR EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND a.grantee NOT IN('crest_schema_owner'::regrole,'crest_command_owner'::regrole))
  OR to_regprocedure('crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)') IS NULL
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_uuid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ec8d31108ca4387c2217d4d29e5d016938825802365afbda2e2667ea2a7557ee') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_version(jsonb,boolean)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='efe0ebe382ffed396dab47c3935c5389b15bc025c7d7b647bee8ee85213df741') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e45d3e0aa06e3bc83c513b409567ae579970113311abba752058f4f2acf3bdd4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.operation_retirement_digest(uuid,uuid,jsonb,text)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5359d819c2d454b3378d67fb3ff84d009b2d88f8a68675836666fd29ef66fbf5') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='bfde61feafbca626187eb4a50f52cecc8a902a0550bdaff3cf1050ebeaf7aea4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a2201e2c378a47d11053dfef8297f70652eddf060fc8728c173730157fe19a1d') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='3b796c52c8e7ae4261e75ede6c06c41b36e997a53d5a1199829b8aa7c77fb0ab') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 -- Registered42 creates this invoker helper as schema owner; registered43
 -- explicitly pins that ownership. Command ownership does not transfer it.
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='da9672544c00bc815b105aae6e37b051dd5ab29594fb18ce31650de5c8f580fc') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text)') AND p.proowner='crest_command_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='7cebfed84d50d2f4fb5a61fbc83062e04bee58ea39528171abd5425287a88d60') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lookup_original_operation_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb)') AND p.proowner='crest_command_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='52995ea9ef5188a6340f6ac90456dde6cac25a93662fbbddbe8d73e6e18959db') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_RESOLUTION_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 keys:=CASE kind
  WHEN 'business.rename' THEN ARRAY['expectedVersion']
  WHEN 'crm.customer.save' THEN ARRAY['customerId','expectedVersion']
  WHEN 'crm.address.save' THEN ARRAY['customerId','addressId','expectedVersion']
  WHEN 'crm.vehicle.save' THEN ARRAY['vehicleId','expectedVersion']
  WHEN 'crm.vehicle.association' THEN ARRAY['action','associationId','vehicleId','expectedVersion','nextAssociationId']
  WHEN 'crm.lead.source.save' THEN ARRAY['leadSourceId','expectedVersion']
  WHEN 'crm.lead.save' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.state' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.vehicle.save' THEN ARRAY['leadId','leadVehicleId','expectedVersion']
  WHEN 'crm.lead.address.save' THEN ARRAY['leadId','leadAddressId','expectedVersion']
  WHEN 'crm.lead.convert' THEN ARRAY['conversionId','leadId','expectedLeadVersion','customerId']
  WHEN 'catalog.service.save' THEN ARRAY['serviceId','expectedRevision']
  WHEN 'quote.draft.save' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key IN ('expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state')) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 RETURN true;
END $$;
RESET ROLE;

-- END REVIEWED QUOTE 5
