-- Unregistered forward construction over exact registered45. Review/approval only.
-- No send, acceptance, replacement, amendment, finance or real-data activation.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner','crest_session_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner','crest_session_owner')) OR to_regclass('crest.condition_assessments') IS NOT NULL OR to_regclass('crest.quote_approvals') IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN('crest.quote_families'::regclass,'crest.quote_revisions'::regclass,'crest.quote_items'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>5 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_family_projection(crest.quote_families)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e52360a7f1d1f2db24ddd11122876563d436cf1ad722d038aa9be0eeb0bc7e01') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_revision_projection(crest.quote_revisions)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='403998e14bcb7f79eaf6e4869bf0787711ce84855a89af58f465036866166895') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_item_projection(crest.quote_items)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='b04d429fde9e8d08381c5705ccea735649181731fa50cba51f7331043718aa1d') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.reject_quote_history_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='561eb0e11c186a935c72df0016ad0030db2a86962958b390866d8d9642728a0a') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_quote_family_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e71e1344d974341d24e615566bde20920dbc075246f9b3ea398cba30730f5825') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_quote_revision_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='8a85fa2ec4309efffcfb6d96c7caaa5085393c49da0a808902caeaffa10ed444') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.validate_quote_item_change()') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='d40743aacdfe4f1bbbd06659d7e26cbd48a92f7a65ffb0e192e277700a9c73be') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_quote_audit()') AND p.proowner='crest_quote_integrity_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='e93aa14954d249192fa52a2da0b6a66d6f7d1dd566eac5cc9e04e029682caba3') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.check_quote_aggregate()') AND p.proowner='crest_quote_integrity_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='90572fe90e63d466d0aec4d9529e9d63df974c97a091f78fa351e39a45ceed97') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_discount_cents(jsonb,numeric)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='ff13fa6fd1b102045953e137ef7af34ddfa5f9a8763757e8cd18f7b3618b67d0') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.calculate_quote_pricing(jsonb,jsonb)') AND p.proowner='crest_schema_owner'::regrole AND p.prosecdef=false AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2915d99f70eeb1f948567a7ea1c37d8741eb337a21b1d60fa0f19a3fc628868f') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.read_authorized_business_context(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='614b87966124be9297a7658a86bc3ee84a29f19f381a80ca23ecf702ffa0e952') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='9b2d19abde943ad1353250275d1b3bf66b34b9ff5fbe1a6d16b73a0ef42cae35') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.valid_quote_draft_payload(jsonb)') AND p.proowner='crest_quote_owner'::regrole AND p.prosecdef=false AND p.provolatile='s' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c91cc7b2106bedc972a4ed1f50530a75b4cbcd85290369a26a49cbf9e26c8b0b') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.quote_operation_result(uuid,uuid,uuid)') AND p.proowner='crest_quote_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='25aea41ca2536f61a36e9f155f9d03a2a58bed89356a3ef2a7c2cde3c6a949a3') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)') AND p.proowner='crest_quote_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='a241dec27c988108bde4693474dc1b6a29be324ef32a6f017e83df2214b63823') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.authorize_quote_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='fd2d20fa2b547e6237a13458365630838a7f98dc427644532eb800ad43121b5c') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_commands.finish_quote_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)') AND p.proowner='crest_session_owner'::regrole AND p.prosecdef=true AND p.provolatile='v' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='17e62a3fa5b3db44af09ee5ae2ee7fb7fea827db354dce63fd97668c73fb24f0') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN('crest.quote_families'::regclass,'crest.quote_revisions'::regclass,'crest.quote_items'::regclass) AND NOT tgisinternal AND tgenabled<>'O') OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.quote_families'::regclass AND conname='quote_current_revision' AND contype='f' AND condeferrable AND condeferred) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND p.proowner='crest_schema_owner'::regrole AND NOT p.prosecdef AND p.provolatile='i' AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='c8caf7868d3b96aee4d0b07c41d82dd08801ee658e685354084ddcc806a82b47') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_QUOTE_LIFECYCLE_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.quote_review_note_valid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT v IS NULL OR coalesce(v='null'::jsonb OR jsonb_typeof(v)='string' AND char_length(v#>>'{}') BETWEEN 1 AND 8000 AND btrim(v#>>'{}',E' \t\n\r\u000b\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')<>'' AND translate(v#>>'{}',E'\t\n\r','')!~'[[:cntrl:]]',false)
$$;
CREATE TABLE crest.condition_assessments(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,vehicle_id uuid NOT NULL,condition_class text NOT NULL CHECK(condition_class IN('Light','Moderate','Heavy','Extreme')),source text NOT NULL CHECK(source IN('reported','photo','on_site')),assessed_at timestamptz NOT NULL CHECK(isfinite(assessed_at)),notes text CHECK(crest_private.quote_review_note_valid(to_jsonb(notes))),
 version bigint NOT NULL DEFAULT 1 CHECK(version=1),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,updated_by uuid NOT NULL,origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),UNIQUE(business_id,id,vehicle_id),CHECK(created_at=updated_at AND created_by=updated_by),FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
CREATE TABLE crest.quote_approvals(
 id uuid PRIMARY KEY,business_id uuid NOT NULL,family_id uuid NOT NULL,revision_id uuid NOT NULL,approved_content_version bigint NOT NULL CHECK(approved_content_version>0),approved_content_hash text NOT NULL CHECK(approved_content_hash~'^[a-f0-9]{64}$'),actor_id uuid NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),extreme_acknowledged boolean NOT NULL,
 template_version text NOT NULL CHECK(template_version='crest.quote.review.v2'),customer_representation jsonb NOT NULL,presentation_text text NOT NULL,presentation_hash text NOT NULL CHECK(presentation_hash=encode(sha256(convert_to(presentation_text,'UTF8')),'hex')),
 version bigint NOT NULL DEFAULT 1 CHECK(version=1),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid NOT NULL,updated_by uuid NOT NULL,origin text NOT NULL CHECK(origin='manual'),operation_id uuid NOT NULL,import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),CONSTRAINT quote_approval_content_once UNIQUE(business_id,revision_id,approved_content_version,approved_content_hash),CHECK(actor_id=created_by AND created_by=updated_by AND created_at=updated_at AND reviewed_at=created_at),FOREIGN KEY(business_id,family_id,revision_id) REFERENCES crest.quote_revisions(business_id,family_id,id),FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id),FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id)
);
ALTER TABLE crest.condition_assessments ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.condition_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.quote_approvals ENABLE ROW LEVEL SECURITY;ALTER TABLE crest.quote_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE crest.quote_items ADD COLUMN assessment_id uuid,ADD COLUMN category_override_note text CHECK(crest_private.quote_review_note_valid(to_jsonb(category_override_note))),ADD CONSTRAINT quote_item_assessment FOREIGN KEY(business_id,assessment_id,vehicle_id) REFERENCES crest.condition_assessments(business_id,id,vehicle_id),ADD CHECK(assessment_id IS NULL OR vehicle_id IS NOT NULL AND NOT job_wide),ADD CHECK(customer_snapshot?'category' OR assessment_id IS NULL AND category_override_note IS NULL);
ALTER TABLE crest.quote_revisions DROP CONSTRAINT quote_revisions_state_check;ALTER TABLE crest.quote_revisions ADD CONSTRAINT quote_revisions_state_check CHECK(state IN('Draft','Ready for Review'));
DO $constraint$ DECLARE name text;BEGIN SELECT conname INTO STRICT name FROM pg_constraint WHERE conrelid='crest.quote_revisions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%canonical_content%jsonb%' AND conname<>'quote_revision_content_hash';EXECUTE format('ALTER TABLE crest.quote_revisions DROP CONSTRAINT %I',name);END $constraint$;
ALTER TABLE crest.quote_revisions ADD CONSTRAINT quote_versioned_canonical CHECK(octet_length(canonical_content)<=16777216 AND canonical_content::jsonb=jsonb_build_object('schemaVersion',customer_safe_snapshot->'schemaVersion','customer',customer_safe_snapshot,'internal',internal_snapshot) AND customer_safe_snapshot->'schemaVersion' IN('1'::jsonb,'2'::jsonb));
CREATE FUNCTION crest_private.quote_assessment_packet(v crest.condition_assessments) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT jsonb_build_object('id',(v).id,'class',(v).condition_class,'source',(v).source,'assessedAt',to_char((v).assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'notes',(v).notes) $$;
CREATE FUNCTION crest_private.quote_assessment_projection(v crest.condition_assessments) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT to_jsonb(v)||jsonb_build_object('version',(v).version::text,'assessed_at',to_char((v).assessed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;
CREATE FUNCTION crest_private.quote_approval_projection(v crest.quote_approvals) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT to_jsonb(v)||jsonb_build_object('version',(v).version::text,'approved_content_version',(v).approved_content_version::text,'reviewed_at',to_char((v).reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) $$;
CREATE OR REPLACE FUNCTION crest_private.quote_item_projection(v crest.quote_items) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN (v).customer_snapshot?'category' THEN to_jsonb(v) ELSE to_jsonb(v)-ARRAY['assessment_id','category_override_note'] END)||jsonb_build_object('version',(v).version::text,'gross_cents',(v).gross_cents::text,'line_discount_cents',(v).line_discount_cents::text,'allocated_discount_cents',(v).allocated_discount_cents::text,'final_cents',(v).final_cents::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE OR REPLACE FUNCTION crest_private.validate_quote_revision_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE parent crest.quote_families; preceding bigint; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO parent FROM crest.quote_families WHERE business_id=NEW.business_id AND id=NEW.family_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_QUOTE_PARENT_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  SELECT coalesce(max(sequence),0) INTO preceding FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id;
  IF NEW.sequence::numeric<>preceding::numeric+1 OR NEW.version<>1 OR NEW.content_version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;NEW.created_at:=stamp;
 ELSE
  IF ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.sequence,NEW.kind,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.sequence,OLD.kind,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_PROVENANCE_RETAINED';END IF;
  IF NEW.version::numeric<>OLD.version::numeric+1 OR NEW.customer_safe_snapshot->>'schemaVersion'='1' AND OLD.customer_safe_snapshot->>'schemaVersion'='2' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
  IF NEW.canonical_content<>OLD.canonical_content THEN
   IF NEW.content_version::numeric<>OLD.content_version::numeric+1 OR NEW.state<>'Draft' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
  ELSIF NEW.content_version<>OLD.content_version OR ROW(NEW.customer_safe_snapshot,NEW.internal_snapshot,NEW.content_hash,NEW.total_cents,NEW.expiry_at,NEW.timezone,NEW.tax_readiness) IS DISTINCT FROM ROW(OLD.customer_safe_snapshot,OLD.internal_snapshot,OLD.content_hash,OLD.total_cents,OLD.expiry_at,OLD.timezone,OLD.tax_readiness) OR NOT(OLD.state='Draft' AND NEW.state='Ready for Review' OR OLD.state='Ready for Review' AND NEW.state='Ready for Review') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
 END IF;
 IF NEW.internal_snapshot->>'customerId' IS DISTINCT FROM parent.customer_id::text OR NEW.internal_snapshot->>'leadId' IS DISTINCT FROM parent.lead_id::text
  OR NEW.customer_safe_snapshot->>'currency' IS DISTINCT FROM 'USD' OR NEW.customer_safe_snapshot->'schemaVersion' NOT IN('1'::jsonb,'2'::jsonb)
  OR NEW.customer_safe_snapshot->>'totalCents' IS DISTINCT FROM NEW.total_cents::text OR NEW.customer_safe_snapshot->>'timezone' IS DISTINCT FROM NEW.timezone
  OR NEW.customer_safe_snapshot->>'expiryAt' IS DISTINCT FROM (CASE WHEN NEW.expiry_at IS NULL THEN NULL ELSE to_char(NEW.expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SNAPSHOT_CONFLICT';END IF;
 IF TG_OP='UPDATE' AND NEW.canonical_content=OLD.canonical_content THEN
  IF NOT crest_private.quote_review_ready(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content)) OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.updated_by AND o.command_type=(CASE WHEN OLD.state='Draft' THEN 'quote.review.submit' ELSE 'quote.review.approve' END) AND o.schema_version=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_REQUIRED';END IF;
 END IF;NEW.updated_at:=stamp;RETURN NEW;
END $change$;
CREATE OR REPLACE FUNCTION crest_private.validate_quote_item_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
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
  OR (CASE WHEN parent.customer_safe_snapshot->'schemaVersion'='2'::jsonb THEN NEW.customer_snapshot-'category' ELSE NEW.customer_snapshot END)-ARRAY['description','inclusions','exclusions','vehicle','condition','grossCents','lineDiscount','lineDiscountCents','documentDiscountEligible','allocatedDiscountCents','finalCents','complimentaryReason']<>'{}'::jsonb
  OR NOT(NEW.customer_snapshot @> jsonb_build_object('grossCents',NEW.gross_cents::text,'lineDiscount',NEW.line_discount,'lineDiscountCents',NEW.line_discount_cents::text,'documentDiscountEligible',NEW.document_discount_eligible,'allocatedDiscountCents',NEW.allocated_discount_cents::text,'finalCents',NEW.final_cents::text,'complimentaryReason',NEW.complimentary_reason))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_ITEM_SNAPSHOT_CONFLICT';END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END $change$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_quote_owner;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_private.valid_quote_draft_payload_v1(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
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

CREATE FUNCTION crest_private.valid_quote_review_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid2$
DECLARE c jsonb;i jsonb;public_v1 jsonb;internal_v1 jsonb;line jsonb;source jsonb;a jsonb;idx integer;stamp text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body)<>'object' OR body-ARRAY['customer','internal','canonical']<>'{}'::jsonb OR NOT(body?&ARRAY['customer','internal','canonical']) OR jsonb_typeof(body->'canonical')<>'string' OR octet_length(body->>'canonical')>16777216 THEN RETURN false;END IF;
 c:=body->'customer';i:=body->'internal';
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(i) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 IF c->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR (body->>'canonical')::jsonb IS DISTINCT FROM jsonb_build_object('schemaVersion',2,'customer',c,'internal',i) OR jsonb_typeof(c->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'lines') NOT BETWEEN 1 AND 1000 OR jsonb_typeof(i->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(i->'sources')<>jsonb_array_length(c->'lines') THEN RETURN false;END IF;
 FOR idx IN 0..jsonb_array_length(c->'lines')-1 LOOP
  line:=c->'lines'->idx;source:=i->'sources'->idx;a:=source->'assessment';
  IF jsonb_typeof(line)<>'object' OR NOT(line?'category') OR jsonb_typeof(source)<>'object' OR NOT(source?&ARRAY['assessment','categoryOverrideNote']) OR source-ARRAY['stableLineKey','vehicleId','jobWide','serviceVersionId','assessment','categoryOverrideNote']<>'{}'::jsonb OR line->'category'<>'null'::jsonb AND (jsonb_typeof(line->'category')<>'string' OR line->>'category' NOT IN('Two-door/small coupe','Sedan','SUV','Truck','Large SUV/minivan')) OR NOT crest_private.quote_review_note_valid(source->'categoryOverrideNote') THEN RETURN false;END IF;
  IF source->'jobWide'='true'::jsonb AND (line->'category'<>'null'::jsonb OR a<>'null'::jsonb OR source->'categoryOverrideNote'<>'null'::jsonb) THEN RETURN false;END IF;
  IF a<>'null'::jsonb THEN
   IF jsonb_typeof(a)<>'object' OR NOT(a?&ARRAY['id','class','source','assessedAt','notes']) OR a-ARRAY['id','class','source','assessedAt','notes']<>'{}'::jsonb OR jsonb_typeof(a->'id')<>'string' OR a->>'id'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' OR jsonb_typeof(a->'class')<>'string' OR a->>'class' NOT IN('Light','Moderate','Heavy','Extreme') OR a->'class' IS DISTINCT FROM line->'condition' OR jsonb_typeof(a->'source')<>'string' OR a->>'source' NOT IN('reported','photo','on_site') OR jsonb_typeof(a->'assessedAt')<>'string' OR NOT crest_private.quote_review_note_valid(a->'notes') THEN RETURN false;END IF;
   stamp:=a->>'assessedAt';IF stamp!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR to_char(stamp::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>stamp THEN RETURN false;END IF;
  END IF;
 END LOOP;
 public_v1:=jsonb_set(c,'{schemaVersion}','1');public_v1:=jsonb_set(public_v1,'{lines}',(SELECT jsonb_agg(value-'category' ORDER BY ordinal) FROM jsonb_array_elements(c->'lines') WITH ORDINALITY x(value,ordinal)));
 internal_v1:=jsonb_set(i,'{sources}',(SELECT jsonb_agg(value-ARRAY['assessment','categoryOverrideNote'] ORDER BY ordinal) FROM jsonb_array_elements(i->'sources') WITH ORDINALITY x(value,ordinal)));
 RETURN crest_private.valid_quote_draft_payload_v1(jsonb_build_object('customer',public_v1,'internal',internal_v1,'canonical',jsonb_build_object('schemaVersion',1,'customer',public_v1,'internal',internal_v1)::text));
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN RETURN false;
END $valid2$;
CREATE OR REPLACE FUNCTION crest_private.valid_quote_draft_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $versioned$
BEGIN
 IF body->'customer'->'schemaVersion'='1'::jsonb THEN RETURN crest_private.valid_quote_draft_payload_v1(body);ELSIF body->'customer'->'schemaVersion'='2'::jsonb THEN RETURN crest_private.valid_quote_review_payload(body);END IF;RETURN false;
END $versioned$;
CREATE FUNCTION crest_private.quote_review_ready(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $ready$
DECLARE n integer;l jsonb;s jsonb;
BEGIN
 IF body->'customer'->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR NOT crest_private.valid_quote_review_payload(body) THEN RETURN false;END IF;
 FOR n IN 0..jsonb_array_length(body->'customer'->'lines')-1 LOOP
  l:=body->'customer'->'lines'->n;s:=body->'internal'->'sources'->n;
  IF s->'jobWide'='true'::jsonb THEN IF l->'condition'<>'null'::jsonb THEN RETURN false;END IF;
  ELSIF l->'category'='null'::jsonb OR l->'condition'='null'::jsonb OR s->'assessment'='null'::jsonb THEN RETURN false;END IF;
 END LOOP;RETURN true;
END $ready$;
CREATE FUNCTION crest_private.persist_quote_assessments(requested_business uuid,requested_actor uuid,requested_operation uuid,sources jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $assess$
DECLARE s jsonb;a jsonb;assessment_row crest.condition_assessments;created uuid;event uuid;events jsonb:='[]';
BEGIN
 FOR s IN SELECT value FROM jsonb_array_elements(sources) LOOP
  a:=s->'assessment';IF a IS NULL OR a='null'::jsonb THEN CONTINUE;END IF;created:=NULL;
  INSERT INTO crest.condition_assessments(id,business_id,vehicle_id,condition_class,source,assessed_at,notes,created_by,updated_by,origin,operation_id) VALUES((a->>'id')::uuid,requested_business,(s->>'vehicleId')::uuid,a->>'class',a->>'source',(a->>'assessedAt')::timestamptz,a->>'notes',requested_actor,requested_actor,'manual',requested_operation) ON CONFLICT DO NOTHING RETURNING id INTO created;
  SELECT * INTO assessment_row FROM crest.condition_assessments WHERE business_id=requested_business AND id=(a->>'id')::uuid;
  IF assessment_row.id IS NULL OR assessment_row.vehicle_id::text IS DISTINCT FROM s->>'vehicleId' OR crest_private.quote_assessment_packet(assessment_row) IS DISTINCT FROM a THEN RAISE EXCEPTION USING ERRCODE='P1005',MESSAGE='CREST_QUOTE_ASSESSMENT_CONFLICT';END IF;
  IF created IS NOT NULL THEN INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,requested_actor,requested_actor,'condition_assessments',assessment_row.id,1,'create',jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.quote_assessment_projection(assessment_row)),'manual') RETURNING id INTO event;events:=events||jsonb_build_array(event);END IF;
 END LOOP;RETURN events;
END $assess$;

CREATE OR REPLACE FUNCTION crest_private.quote_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations; receipt jsonb; family_audit crest_private.audit_events; revision_audit crest_private.audit_events; item_audit crest_private.audit_events; f jsonb; r jsonb; expected_family text; expected_revision text; body jsonb; digest text; count_items integer; seen uuid[]:='{}'; event jsonb; k text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type='quote.draft.save';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 receipt:=o.result;
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt ?& ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']) OR receipt-ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']-(CASE WHEN o.schema_version=2 THEN ARRAY['assessmentAuditEventIds'] ELSE ARRAY[]::text[] END)<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR receipt->>'businessId' IS DISTINCT FROM requested_business::text OR jsonb_typeof(receipt->'itemAuditEventIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
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
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','quote.draft.save','schemaVersion',o.schema_version,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'familyId',receipt->'familyId','revisionId',receipt->'revisionId','expectedFamilyVersion',expected_family,'expectedRevisionVersion',expected_revision,'payload',body)::text,'UTF8')),'hex');
 IF NOT crest_private.valid_quote_draft_payload(body) OR digest<>o.payload_hash OR encode(sha256(convert_to(r->>'canonical_content','UTF8')),'hex') IS DISTINCT FROM receipt->>'contentHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 FOR event IN SELECT value FROM jsonb_array_elements(receipt->'itemAuditEventIds') LOOP
  IF jsonb_typeof(event)<>'string' OR (event#>>'{}')::uuid=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO item_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(event#>>'{}')::uuid AND entity_kind='quote_items';
  IF NOT FOUND OR item_audit.delta->'before' IS NULL OR item_audit.delta->'after'->>'revision_id' IS DISTINCT FROM receipt->>'revisionId' OR item_audit.delta->'after'->>'version' IS DISTINCT FROM item_audit.entity_version::text OR item_audit.action<>(CASE WHEN item_audit.delta->'before'='null'::jsonb THEN 'create' ELSE 'edit' END)
   OR NOT EXISTS(SELECT 1 FROM crest.quote_items WHERE business_id=requested_business AND revision_id=(receipt->>'revisionId')::uuid AND id=item_audit.entity_id AND version>=item_audit.entity_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  seen:=array_append(seen,item_audit.id);
 END LOOP;
 count_items:=jsonb_array_length(receipt->'itemAuditEventIds');
 IF o.schema_version=2 THEN
  IF jsonb_typeof(receipt->'assessmentAuditEventIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(receipt->'assessmentAuditEventIds') LOOP
   IF jsonb_typeof(event)<>'string' OR (event#>>'{}')::uuid=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
   SELECT * INTO item_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(event#>>'{}')::uuid AND entity_kind='condition_assessments' AND entity_version=1 AND action='create';
   IF NOT FOUND OR item_audit.delta->'before' IS DISTINCT FROM 'null'::jsonb OR NOT EXISTS(SELECT 1 FROM crest.condition_assessments a WHERE a.business_id=requested_business AND a.id=item_audit.entity_id AND crest_private.quote_assessment_projection(a)=item_audit.delta->'after' AND EXISTS(SELECT 1 FROM jsonb_array_elements(body->'internal'->'sources') s WHERE s->>'vehicleId'=a.vehicle_id::text AND s->'assessment'=crest_private.quote_assessment_packet(a))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
   seen:=array_append(seen,item_audit.id);count_items:=count_items+1;
  END LOOP;
 END IF;IF (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>count_items+2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';
END $result$;

CREATE OR REPLACE FUNCTION crest_commands.save_quote_draft(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_family uuid,requested_revision uuid,expected_family_version bigint,expected_revision_version bigint,body jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb; digest text; content_digest text; claimed uuid; existing crest_private.operations; old_family crest.quote_families; family crest.quote_families; old_revision crest.quote_revisions; revision crest.quote_revisions; old_item crest.quote_items; item crest.quote_items;
 customer jsonb; internal jsonb; line jsonb; source jsonb; keys uuid[]:='{}'; event_id uuid; family_event uuid; revision_event uuid; item_events jsonb:='[]'::jsonb; assessment_events jsonb:='[]'::jsonb; command_result jsonb; changed boolean; violated text; line_index integer;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_family IS NULL OR requested_revision IS NULL OR (request_schema IS NULL OR request_schema NOT IN(1,2) OR body->'customer'->'schemaVersion' IS DISTINCT FROM to_jsonb(request_schema)) OR expected_family_version IS NULL OR expected_revision_version IS NULL OR expected_family_version<0 OR expected_revision_version<0 OR (expected_family_version=0)<>(expected_revision_version=0) OR NOT crest_private.valid_quote_draft_payload(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_INPUT_REQUIRED';END IF;
 BEGIN
  context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_QUOTE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','quote.draft.save','schemaVersion',request_schema,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'familyId',requested_family,'revisionId',requested_revision,'expectedFamilyVersion',expected_family_version::text,'expectedRevisionVersion',expected_revision_version::text,'payload',body)::text,'UTF8')),'hex');
 customer:=body->'customer';internal:=body->'internal';content_digest:=encode(sha256(convert_to(body->>'canonical','UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'quote.draft.save',request_schema,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.quote_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   SELECT * INTO old_family FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family FOR UPDATE;
   SELECT * INTO old_revision FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision FOR UPDATE;
   IF coalesce(old_family.version,0)<>expected_family_version OR coalesce(old_revision.version,0)<>expected_revision_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_QUOTE_VERSION_CONFLICT';END IF;
   IF expected_family_version>0 THEN
    IF old_family.current_revision_id<>requested_revision OR (old_revision.state NOT IN('Draft','Ready for Review') OR old_revision.customer_safe_snapshot->'schemaVersion'='2'::jsonb AND request_schema=1) OR old_revision.kind<>'initial' OR old_revision.tax_readiness<>'not_configured' THEN RAISE EXCEPTION USING ERRCODE='P1004',MESSAGE='CREST_QUOTE_STATE_CONFLICT';END IF;
    IF old_family.customer_id::text IS DISTINCT FROM internal->>'customerId' OR old_family.lead_id::text IS DISTINCT FROM internal->>'leadId' THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_QUOTE_FAMILY_RETAINED';END IF;
    IF old_revision.canonical_content=body->>'canonical' THEN RAISE EXCEPTION USING ERRCODE='P1003',MESSAGE='CREST_QUOTE_UNCHANGED';END IF;
   ELSE
    INSERT INTO crest.quote_families(id,business_id,lead_id,customer_id,current_revision_id,created_by,updated_by,origin,operation_id) VALUES(requested_family,requested_business,(internal->>'leadId')::uuid,(internal->>'customerId')::uuid,requested_revision,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO family;
    INSERT INTO crest.quote_revisions(id,business_id,family_id,sequence,customer_safe_snapshot,internal_snapshot,canonical_content,content_hash,total_cents,expiry_at,timezone,created_by,updated_by,origin,operation_id) VALUES(requested_revision,requested_business,requested_family,1,customer,internal,body->>'canonical',content_digest,(customer->>'totalCents')::bigint,(customer->>'expiryAt')::timestamptz,customer->>'timezone',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO revision;
   END IF;
   IF expected_family_version>0 THEN
    UPDATE crest.quote_revisions SET version=version+1,content_version=content_version+1,state='Draft',customer_safe_snapshot=customer,internal_snapshot=internal,canonical_content=body->>'canonical',content_hash=content_digest,total_cents=(customer->>'totalCents')::bigint,expiry_at=(customer->>'expiryAt')::timestamptz,timezone=customer->>'timezone',updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_revision RETURNING * INTO revision;
    UPDATE crest.quote_families SET version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_family RETURNING * INTO family;
   END IF;
   IF request_schema=2 THEN assessment_events:=crest_private.persist_quote_assessments(requested_business,expected_actor,requested_operation,internal->'sources');END IF;
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
    changed:=old_item.id IS NULL OR NOT old_item.active OR old_item.position IS DISTINCT FROM line_index+1 OR old_item.vehicle_id::text IS DISTINCT FROM source->>'vehicleId' OR old_item.job_wide IS DISTINCT FROM (source->>'jobWide')::boolean OR old_item.service_version_id::text IS DISTINCT FROM source->>'serviceVersionId' OR old_item.customer_snapshot IS DISTINCT FROM line OR old_item.assessment_id::text IS DISTINCT FROM source->'assessment'->>'id' OR old_item.category_override_note IS DISTINCT FROM source->>'categoryOverrideNote';
    IF NOT changed THEN CONTINUE;END IF;
    IF old_item.id IS NULL THEN
     INSERT INTO crest.quote_items(id,business_id,revision_id,stable_line_key,active,position,vehicle_id,job_wide,service_version_id,gross_cents,line_discount,document_discount_eligible,line_discount_cents,allocated_discount_cents,final_cents,complimentary_reason,customer_snapshot,assessment_id,category_override_note,created_by,updated_by,origin,operation_id) VALUES(gen_random_uuid(),requested_business,requested_revision,(source->>'stableLineKey')::uuid,true,line_index+1,(source->>'vehicleId')::uuid,(source->>'jobWide')::boolean,(source->>'serviceVersionId')::uuid,(line->>'grossCents')::bigint,line->'lineDiscount',(line->>'documentDiscountEligible')::boolean,(line->>'lineDiscountCents')::bigint,(line->>'allocatedDiscountCents')::bigint,(line->>'finalCents')::bigint,line->>'complimentaryReason',line,(source->'assessment'->>'id')::uuid,source->>'categoryOverrideNote',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO item;
    ELSE
     UPDATE crest.quote_items SET active=true,position=line_index+1,vehicle_id=(source->>'vehicleId')::uuid,job_wide=(source->>'jobWide')::boolean,service_version_id=(source->>'serviceVersionId')::uuid,gross_cents=(line->>'grossCents')::bigint,line_discount=line->'lineDiscount',document_discount_eligible=(line->>'documentDiscountEligible')::boolean,line_discount_cents=(line->>'lineDiscountCents')::bigint,allocated_discount_cents=(line->>'allocatedDiscountCents')::bigint,final_cents=(line->>'finalCents')::bigint,complimentary_reason=line->>'complimentaryReason',customer_snapshot=line,assessment_id=(source->'assessment'->>'id')::uuid,category_override_note=source->>'categoryOverrideNote',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=old_item.id RETURNING * INTO item;
    END IF;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_items',item.id,item.version,CASE WHEN old_item.id IS NULL THEN 'create' ELSE 'edit' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN old_item.id IS NULL THEN 'null'::jsonb ELSE crest_private.quote_item_projection(old_item) END,'after',crest_private.quote_item_projection(item)),'manual') RETURNING id INTO event_id;item_events:=item_events||jsonb_build_array(event_id);
   END LOOP;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_families',family.id,family.version,CASE WHEN expected_family_version=0 THEN 'create' ELSE 'edit' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_family_version=0 THEN 'null'::jsonb ELSE crest_private.quote_family_projection(old_family) END,'after',crest_private.quote_family_projection(family)),'manual') RETURNING id INTO family_event;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_revisions',revision.id,revision.version,CASE WHEN expected_revision_version=0 THEN 'create' ELSE 'edit' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_revision_version=0 THEN 'null'::jsonb ELSE crest_private.quote_revision_projection(old_revision) END,'after',crest_private.quote_revision_projection(revision)),'manual') RETURNING id INTO revision_event;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'familyId',family.id,'familyVersion',family.version::text,'revisionId',revision.id,'revisionVersion',revision.version::text,'contentVersion',revision.content_version::text,'contentHash',revision.content_hash,'familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'itemAuditEventIds',item_events)||(CASE WHEN request_schema=2 THEN jsonb_build_object('assessmentAuditEventIds',assessment_events) ELSE '{}'::jsonb END));
   UPDATE crest_private.operations SET state='committed',result_schema_version=request_schema,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_quote_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentFamilyVersion',coalesce(old_family.version,0)::text,'currentRevisionVersion',coalesce(old_revision.version,0)::text);
  WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','family');
  WHEN SQLSTATE 'P1003' THEN RETURN jsonb_build_object('state','unchanged','familyId',requested_family,'familyVersion',old_family.version::text,'revisionId',requested_revision,'revisionVersion',old_revision.version::text,'contentHash',old_revision.content_hash);
  WHEN SQLSTATE 'P1005' THEN RETURN jsonb_build_object('state','conflict','reason','assessment');
  WHEN SQLSTATE 'P1004' THEN RETURN jsonb_build_object('state','conflict','reason','state');
  WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated='quote_families_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','family');ELSIF violated='quote_revisions_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','revision');END IF;RAISE;
  WHEN foreign_key_violation THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REFERENCE_REQUIRED';
 END;
END $save$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
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
  source:=jsonb_build_object('stableLineKey',NEW.stable_line_key,'vehicleId',NEW.vehicle_id,'jobWide',NEW.job_wide,'serviceVersionId',NEW.service_version_id)||(CASE WHEN NEW.customer_snapshot?'category' THEN jsonb_build_object('assessment',CASE WHEN NEW.assessment_id IS NULL THEN 'null'::jsonb ELSE (SELECT crest_private.quote_assessment_packet(a) FROM crest.condition_assessments a WHERE a.business_id=NEW.business_id AND a.id=NEW.assessment_id AND a.vehicle_id=NEW.vehicle_id) END,'categoryOverrideNote',NEW.category_override_note) ELSE '{}'::jsonb END);
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.entity_id
   WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='quote_revisions' AND a.entity_id=NEW.revision_id
    AND a.entity_version<=r.version AND a.delta->'after'->>'version'=a.entity_version::text AND a.delta->'after'->>'operation_id'=NEW.operation_id::text
    AND (NEW.active AND a.delta->'after'->'internal_snapshot'->'sources'->(NEW.position-1)=source AND a.delta->'after'->'customer_safe_snapshot'->'lines'->(NEW.position-1)=NEW.customer_snapshot
     OR NOT NEW.active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.delta->'after'->'internal_snapshot'->'sources') s WHERE s->>'stableLineKey'=NEW.stable_line_key::text))) INTO published;
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=kind AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action=(CASE o.command_type WHEN 'quote.review.submit' THEN 'submit' WHEN 'quote.review.approve' THEN 'approve' ELSE CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END END) AND a.delta->'before'=prior AND a.delta->'after'=following
   AND (o.command_type='quote.draft.save' AND o.schema_version IN(1,2) OR o.command_type IN('quote.review.submit','quote.review.approve') AND o.schema_version=1 AND kind IN('quote_families','quote_revisions') AND TG_OP='UPDATE') AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $audit$;
CREATE OR REPLACE FUNCTION crest_private.check_quote_aggregate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $aggregate$
DECLARE current_version bigint; inputs jsonb; actual jsonb; snapshots jsonb; sources jsonb; calculated jsonb; line_count integer; last_position integer;
BEGIN
 SELECT version INTO current_version FROM crest.quote_revisions WHERE business_id=NEW.business_id AND id=NEW.id;
 -- Earlier changes in the same transaction retain their exact audit images;
 -- the final version alone is compared with the final normalized line set.
 IF current_version IS DISTINCT FROM NEW.version THEN RETURN NULL;END IF;
 SELECT count(*)::integer,max(position),
  jsonb_agg(jsonb_build_object('id',stable_line_key,'grossCents',gross_cents::text,'lineDiscount',line_discount,'documentDiscountEligible',document_discount_eligible,'complimentaryReason',complimentary_reason) ORDER BY position),
  jsonb_agg(jsonb_build_object('id',stable_line_key,'grossCents',gross_cents::text,'lineDiscountCents',line_discount_cents::text,'documentDiscountEligible',document_discount_eligible,'allocatedDiscountCents',allocated_discount_cents::text,'finalCents',final_cents::text,'complimentaryReason',complimentary_reason) ORDER BY position),
  jsonb_agg(customer_snapshot ORDER BY position),jsonb_agg(jsonb_build_object('stableLineKey',stable_line_key,'vehicleId',vehicle_id,'jobWide',job_wide,'serviceVersionId',service_version_id)||(CASE WHEN NEW.customer_safe_snapshot->'schemaVersion'='2'::jsonb THEN jsonb_build_object('assessment',CASE WHEN assessment_id IS NULL THEN 'null'::jsonb ELSE (SELECT crest_private.quote_assessment_packet(a) FROM crest.condition_assessments a WHERE a.business_id=NEW.business_id AND a.id=q.assessment_id AND a.vehicle_id=q.vehicle_id) END,'categoryOverrideNote',category_override_note) ELSE '{}'::jsonb END) ORDER BY position)
 INTO line_count,last_position,inputs,actual,snapshots,sources FROM crest.quote_items q WHERE business_id=NEW.business_id AND revision_id=NEW.id AND active;
 IF NOT crest_private.valid_quote_draft_payload(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AGGREGATE_CONFLICT';END IF;
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
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT ON crest.condition_assessments,crest.quote_approvals TO crest_quote_owner,crest_quote_integrity_owner;
GRANT INSERT(id,business_id,vehicle_id,condition_class,source,assessed_at,notes,created_by,updated_by,origin,operation_id) ON crest.condition_assessments TO crest_quote_owner;
GRANT INSERT(id,business_id,family_id,revision_id,approved_content_version,approved_content_hash,actor_id,extreme_acknowledged,template_version,customer_representation,presentation_text,presentation_hash,created_by,updated_by,origin,operation_id) ON crest.quote_approvals TO crest_quote_owner;
GRANT INSERT(assessment_id,category_override_note),UPDATE(assessment_id,category_override_note) ON crest.quote_items TO crest_quote_owner;
GRANT UPDATE(state) ON crest.quote_revisions TO crest_quote_owner;
CREATE POLICY quote_assessment_read ON crest.condition_assessments FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_assessment_create ON crest.condition_assessments FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY quote_approval_read ON crest.quote_approvals FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_approval_create ON crest.quote_approvals FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND updated_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY quote_assessment_integrity ON crest.condition_assessments FOR SELECT TO crest_quote_integrity_owner USING(true);
CREATE POLICY quote_approval_integrity ON crest.quote_approvals FOR SELECT TO crest_quote_integrity_owner USING(true);
ALTER POLICY quote_command_operations_read ON crest_private.operations USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('quote.draft.save','quote.review.submit','quote.review.approve'));
ALTER POLICY quote_command_operations_create ON crest_private.operations WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND (command_type='quote.draft.save' AND schema_version IN(1,2) OR command_type IN('quote.review.submit','quote.review.approve') AND schema_version=1) AND origin='manual' AND import_row_id IS NULL);
ALTER POLICY quote_command_operations_finish ON crest_private.operations USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('quote.draft.save','quote.review.submit','quote.review.approve')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('quote.draft.save','quote.review.submit','quote.review.approve'));
ALTER POLICY quote_command_audits_read ON crest_private.audit_events USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('quote_families','quote_revisions','quote_items','condition_assessments','quote_approvals'));
ALTER POLICY quote_command_audits_create ON crest_private.audit_events WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('quote_families','quote_revisions','quote_items','condition_assessments','quote_approvals') AND origin='manual' AND import_row_id IS NULL);
ALTER POLICY quote_integrity_operations ON crest_private.operations USING(command_type IN('quote.draft.save','quote.review.submit','quote.review.approve'));
ALTER POLICY quote_integrity_audits ON crest_private.audit_events USING(entity_kind IN('quote_families','quote_revisions','quote_items','condition_assessments','quote_approvals'));
GRANT EXECUTE ON FUNCTION crest_private.quote_review_note_valid(jsonb),crest_private.quote_assessment_packet(crest.condition_assessments),crest_private.quote_assessment_projection(crest.condition_assessments),crest_private.quote_approval_projection(crest.quote_approvals) TO crest_quote_owner,crest_quote_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;

CREATE FUNCTION crest_private.quote_review_digest(business uuid,actor uuid,epoch uuid,action text,request_schema integer,family uuid,revision uuid,family_version bigint,revision_version bigint,content_version bigint,content_hash text,approval uuid,extreme boolean) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('commandType','quote.review.'||action,'schemaVersion',request_schema,'businessId',business,'actorId',actor,'recoveryEpoch',epoch,'familyId',family,'revisionId',revision,'expectedFamilyVersion',family_version::text,'expectedRevisionVersion',revision_version::text,'expectedContentVersion',content_version::text,'expectedHash',content_hash,'approvalId',approval,'extremeAcknowledged',extreme)::text,'UTF8')),'hex')
$$;
CREATE FUNCTION crest_private.quote_review_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;r jsonb;f crest_private.audit_events;v crest_private.audit_events;a crest.quote_approvals;aa crest_private.audit_events;result_action text;before jsonb;after jsonb;digest text;key text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('quote.review.submit','quote.review.approve');IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 r:=o.result;result_action:=replace(o.command_type,'quote.review.','');
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&ARRAY['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','approvalId','approvalAuditEventId','presentationHash']) OR r-ARRAY['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','approvalId','approvalAuditEventId','presentationHash']<>'{}'::jsonb OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'action' IS DISTINCT FROM result_action OR r->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['businessId','familyId','revisionId','familyAuditEventId','revisionAuditEventId'] LOOP IF jsonb_typeof(r->key) IS DISTINCT FROM 'string' OR r->>key!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['familyVersion','revisionVersion','contentVersion'] LOOP IF jsonb_typeof(r->key) IS DISTINCT FROM 'string' OR r->>key!~'^[1-9][0-9]{0,18}$' OR (r->>key)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 IF jsonb_typeof(r->'contentHash') IS DISTINCT FROM 'string' OR r->>'contentHash'!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO f FROM crest_private.audit_events e WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id=(r->>'familyAuditEventId')::uuid AND entity_kind='quote_families' AND entity_id=(r->>'familyId')::uuid AND entity_version=(r->>'familyVersion')::bigint AND e.action=result_action;
 SELECT * INTO v FROM crest_private.audit_events e WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id=(r->>'revisionAuditEventId')::uuid AND entity_kind='quote_revisions' AND entity_id=(r->>'revisionId')::uuid AND entity_version=(r->>'revisionVersion')::bigint AND action=result_action;
 before:=v.delta->'before';after:=v.delta->'after';
 IF f.id IS NULL OR v.id IS NULL OR f.id=v.id OR before IS NULL OR before='null'::jsonb OR after->>'id' IS DISTINCT FROM r->>'revisionId' OR after->>'family_id' IS DISTINCT FROM r->>'familyId' OR after->>'business_id' IS DISTINCT FROM business::text OR after->>'updated_by' IS DISTINCT FROM actor::text OR after->>'operation_id' IS DISTINCT FROM operation::text OR after->>'version' IS DISTINCT FROM r->>'revisionVersion' OR after->>'content_version' IS DISTINCT FROM r->>'contentVersion' OR after->>'content_hash' IS DISTINCT FROM r->>'contentHash' OR before->>'canonical_content' IS DISTINCT FROM after->>'canonical_content' OR before->>'content_version' IS DISTINCT FROM after->>'content_version' OR after->>'state' IS DISTINCT FROM 'Ready for Review' OR before->>'state' IS DISTINCT FROM (CASE WHEN result_action='submit' THEN 'Draft' ELSE 'Ready for Review' END) OR (before->>'version')::numeric+1 IS DISTINCT FROM (after->>'version')::numeric OR f.delta->'after'->>'id' IS DISTINCT FROM r->>'familyId' OR f.delta->'after'->>'current_revision_id' IS DISTINCT FROM r->>'revisionId' OR (f.delta->'before'->>'version')::numeric+1 IS DISTINCT FROM (r->>'familyVersion')::numeric OR NOT crest_private.quote_review_ready(jsonb_build_object('customer',after->'customer_safe_snapshot','internal',after->'internal_snapshot','canonical',after->'canonical_content')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 IF encode(sha256(convert_to(after->>'canonical_content','UTF8')),'hex') IS DISTINCT FROM r->>'contentHash' OR before->>'content_hash' IS DISTINCT FROM after->>'content_hash' OR f.delta->'after'->>'business_id' IS DISTINCT FROM business::text OR f.delta->'after'->>'updated_by' IS DISTINCT FROM actor::text OR f.delta->'after'->>'operation_id' IS DISTINCT FROM operation::text OR f.delta->'after'->>'version' IS DISTINCT FROM r->>'familyVersion' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 IF result_action='approve' THEN
  SELECT * INTO a FROM crest.quote_approvals WHERE business_id=business AND id=(r->>'approvalId')::uuid AND family_id=(r->>'familyId')::uuid AND revision_id=(r->>'revisionId')::uuid AND actor_id=actor AND operation_id=operation;
  SELECT * INTO aa FROM crest_private.audit_events e WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id=(r->>'approvalAuditEventId')::uuid AND entity_kind='quote_approvals' AND entity_id=a.id AND entity_version=1 AND e.action='approve';
  IF a.id IS NULL OR aa.id IS NULL OR aa.delta->'before' IS DISTINCT FROM 'null'::jsonb OR aa.delta->'after' IS DISTINCT FROM crest_private.quote_approval_projection(a) OR a.approved_content_version::text IS DISTINCT FROM r->>'contentVersion' OR a.approved_content_hash IS DISTINCT FROM r->>'contentHash' OR a.customer_representation IS DISTINCT FROM after->'customer_safe_snapshot' OR a.presentation_hash IS DISTINCT FROM r->>'presentationHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 ELSIF r->'approvalId' IS DISTINCT FROM 'null'::jsonb OR r->'approvalAuditEventId' IS DISTINCT FROM 'null'::jsonb OR r->'presentationHash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 digest:=crest_private.quote_review_digest(business,actor,o.recovery_epoch,result_action,1,(r->>'familyId')::uuid,(r->>'revisionId')::uuid,(f.delta->'before'->>'version')::bigint,(before->>'version')::bigint,(before->>'content_version')::bigint,before->>'content_hash',a.id,coalesce(a.extreme_acknowledged,false));
 IF digest<>o.payload_hash OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation)<>(CASE WHEN result_action='approve' THEN 3 ELSE 2 END) OR NOT EXISTS(SELECT 1 FROM crest.quote_families WHERE business_id=business AND id=(r->>'familyId')::uuid AND version>=(r->>'familyVersion')::bigint) OR NOT EXISTS(SELECT 1 FROM crest.quote_revisions WHERE business_id=business AND family_id=(r->>'familyId')::uuid AND id=(r->>'revisionId')::uuid AND version>=(r->>'revisionVersion')::bigint) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';
END $result$;

CREATE FUNCTION crest_private.apply_quote_review(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_family uuid,requested_revision uuid,expected_family_version bigint,expected_revision_version bigint,expected_content_version bigint,expected_hash text,requested_approval uuid,extreme_acknowledged boolean,action text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $apply$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;old_f crest.quote_families;f crest.quote_families;old_r crest.quote_revisions;r crest.quote_revisions;a crest.quote_approvals;family_event uuid;revision_event uuid;approval_event uuid;outcome jsonb;approval_text text;violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_family IS NULL OR requested_revision IS NULL OR expected_family_version IS NULL OR expected_family_version<1 OR expected_revision_version IS NULL OR expected_revision_version<1 OR expected_content_version IS NULL OR expected_content_version<1 OR expected_hash IS NULL OR expected_hash!~'^[a-f0-9]{64}$' OR action NOT IN('submit','approve') OR extreme_acknowledged IS NULL OR (action='submit' AND (requested_approval IS NOT NULL OR extreme_acknowledged) OR action='approve' AND requested_approval IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_INPUT_REQUIRED';END IF;
 BEGIN context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_QUOTE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=crest_private.quote_review_digest(requested_business,expected_actor,expected_epoch,action,request_schema,requested_family,requested_revision,expected_family_version,expected_revision_version,expected_content_version,expected_hash,requested_approval,extreme_acknowledged);
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'quote.review.'||action,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   IF NOT FOUND OR existing.command_type<>'quote.review.'||action OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;outcome:=crest_private.quote_review_result(requested_business,expected_actor,requested_operation);
  ELSE
   SELECT * INTO old_f FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family FOR UPDATE;IF old_f.id IS NULL OR old_f.current_revision_id<>requested_revision THEN RAISE EXCEPTION USING ERRCODE='P1102',MESSAGE='family';END IF;
   SELECT * INTO old_r FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision FOR UPDATE;IF old_r.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P1103',MESSAGE='revision';END IF;
   IF old_f.version<>expected_family_version OR old_r.version<>expected_revision_version OR old_r.content_version<>expected_content_version OR old_r.content_hash<>expected_hash THEN RAISE EXCEPTION USING ERRCODE='P1101',MESSAGE='version';END IF;
   IF old_r.state<>(CASE WHEN action='submit' THEN 'Draft' ELSE 'Ready for Review' END) THEN RAISE EXCEPTION USING ERRCODE='P1104',MESSAGE='state';END IF;
   IF NOT crest_private.quote_review_ready(jsonb_build_object('customer',old_r.customer_safe_snapshot,'internal',old_r.internal_snapshot,'canonical',old_r.canonical_content)) THEN RAISE EXCEPTION USING ERRCODE='P1105',MESSAGE='readiness';END IF;
   IF action='approve' THEN
    IF old_r.internal_snapshot->'extremeReviewRequired'='true'::jsonb AND NOT extreme_acknowledged THEN RAISE EXCEPTION USING ERRCODE='P1106',MESSAGE='extreme';END IF;
    IF EXISTS(SELECT 1 FROM crest.quote_approvals WHERE business_id=requested_business AND revision_id=requested_revision AND approved_content_version=old_r.content_version AND approved_content_hash=old_r.content_hash) THEN RAISE EXCEPTION USING ERRCODE='P1107',MESSAGE='approval';END IF;
   END IF;
   UPDATE crest.quote_revisions SET state='Ready for Review',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_revision RETURNING * INTO r;
   UPDATE crest.quote_families SET version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_family RETURNING * INTO f;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_families',f.id,f.version,apply_quote_review.action,jsonb_build_object('schemaVersion',1,'before',crest_private.quote_family_projection(old_f),'after',crest_private.quote_family_projection(f)),'manual') RETURNING id INTO family_event;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_revisions',r.id,r.version,apply_quote_review.action,jsonb_build_object('schemaVersion',1,'before',crest_private.quote_revision_projection(old_r),'after',crest_private.quote_revision_projection(r)),'manual') RETURNING id INTO revision_event;
   IF action='approve' THEN
    approval_text:='crest.quote.review.v2'||E'\n'||r.content_hash||E'\n'||r.customer_safe_snapshot::text;
    INSERT INTO crest.quote_approvals(id,business_id,family_id,revision_id,approved_content_version,approved_content_hash,actor_id,extreme_acknowledged,template_version,customer_representation,presentation_text,presentation_hash,created_by,updated_by,origin,operation_id) VALUES(requested_approval,requested_business,f.id,r.id,r.content_version,r.content_hash,expected_actor,apply_quote_review.extreme_acknowledged,'crest.quote.review.v2',r.customer_safe_snapshot,approval_text,encode(sha256(convert_to(approval_text,'UTF8')),'hex'),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO a;
    INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'quote_approvals',a.id,1,'approve',jsonb_build_object('schemaVersion',1,'before',NULL,'after',crest_private.quote_approval_projection(a)),'manual') RETURNING id INTO approval_event;
   END IF;
   outcome:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'action',action,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'revisionId',r.id,'revisionVersion',r.version::text,'contentVersion',r.content_version::text,'contentHash',r.content_hash,'familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'approvalId',a.id,'approvalAuditEventId',approval_event,'presentationHash',a.presentation_hash));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=outcome->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_quote_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN outcome;
 EXCEPTION WHEN SQLSTATE 'P1101' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentFamilyVersion',old_f.version::text,'currentRevisionVersion',old_r.version::text);
  WHEN SQLSTATE 'P1102' THEN RETURN jsonb_build_object('state','conflict','reason','family');WHEN SQLSTATE 'P1103' THEN RETURN jsonb_build_object('state','conflict','reason','revision');WHEN SQLSTATE 'P1104' THEN RETURN jsonb_build_object('state','conflict','reason','state');WHEN SQLSTATE 'P1105' THEN RETURN jsonb_build_object('state','conflict','reason','readiness');WHEN SQLSTATE 'P1106' THEN RETURN jsonb_build_object('state','conflict','reason','extreme');WHEN SQLSTATE 'P1107' THEN RETURN jsonb_build_object('state','conflict','reason','approval');
  WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated IN('quote_approvals_pkey','quote_approval_content_once') THEN RETURN jsonb_build_object('state','conflict','reason','approval');END IF;RAISE;
 END;
END $apply$;

CREATE FUNCTION crest_commands.submit_quote_review(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_family uuid,requested_revision uuid,expected_family_version bigint,expected_revision_version bigint,expected_content_version bigint,expected_hash text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_private.apply_quote_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NULL,false,'submit') $$;
CREATE FUNCTION crest_commands.approve_quote_revision(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_family uuid,requested_revision uuid,expected_family_version bigint,expected_revision_version bigint,expected_content_version bigint,expected_hash text,requested_approval uuid,extreme_acknowledged boolean) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_private.apply_quote_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'approve') $$;
CREATE FUNCTION crest_commands.lookup_quote_review_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.quote_review_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_private.quote_approval_packet(a crest.quote_approvals) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $packet$
DECLARE event uuid;
BEGIN
 SELECT id INTO event FROM crest_private.audit_events WHERE business_id=a.business_id AND operation_id=a.operation_id AND actor_id=a.actor_id AND entity_kind='quote_approvals' AND entity_id=a.id AND entity_version=1 AND action='approve' AND delta->'before'='null'::jsonb AND delta->'after'=crest_private.quote_approval_projection(a);
 IF event IS NULL OR a.presentation_text IS DISTINCT FROM 'crest.quote.review.v2'||E'\n'||a.approved_content_hash||E'\n'||a.customer_representation::text OR a.presentation_hash IS DISTINCT FROM encode(sha256(convert_to(a.presentation_text,'UTF8')),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('id',a.id,'contentVersion',a.approved_content_version::text,'contentHash',a.approved_content_hash,'actorId',a.actor_id,'reviewedAt',to_char(a.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'extremeAcknowledged',a.extreme_acknowledged,'templateVersion',a.template_version,'customerRepresentation',a.customer_representation,'presentationText',a.presentation_text,'presentationHash',a.presentation_hash,'operationId',a.operation_id,'auditEventId',event);
END $packet$;
CREATE FUNCTION crest_commands.read_quote_review_state(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_family uuid,requested_revision uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $read$
DECLARE context jsonb;f crest.quote_families;r crest.quote_revisions;a crest.quote_approvals;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_family IS NULL OR requested_revision IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO f FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family;SELECT * INTO r FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision;
 IF f.id IS NULL OR r.id IS NULL OR f.current_revision_id<>r.id THEN RETURN jsonb_build_object('state','absent');END IF;
 IF r.state='Ready for Review' THEN SELECT * INTO a FROM crest.quote_approvals WHERE business_id=requested_business AND family_id=f.id AND revision_id=r.id AND approved_content_version=r.content_version AND approved_content_hash=r.content_hash;END IF;
 result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'familyId',f.id,'revisionId',r.id,'familyVersion',f.version::text,'revisionVersion',r.version::text,'contentVersion',r.content_version::text,'contentHash',r.content_hash,'state',r.state,'approval',CASE WHEN a.id IS NULL THEN 'null'::jsonb ELSE crest_private.quote_approval_packet(a) END);
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_PAGE_LIMIT';END IF;RETURN result;
END $read$;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.stamp_quote_review_history() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $stamp$
DECLARE stamp timestamptz:=clock_timestamp();r crest.quote_revisions;
BEGIN
 NEW.created_at:=stamp;NEW.updated_at:=stamp;
 IF TG_TABLE_NAME='quote_approvals' THEN
  NEW.reviewed_at:=stamp;SELECT * INTO r FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id AND id=NEW.revision_id;
  IF r.id IS NULL OR r.state<>'Ready for Review' OR r.customer_safe_snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR NEW.approved_content_version<>r.content_version OR NEW.approved_content_hash<>r.content_hash OR NEW.customer_representation IS DISTINCT FROM r.customer_safe_snapshot OR r.internal_snapshot->'extremeReviewRequired'='true'::jsonb AND NOT NEW.extreme_acknowledged OR NEW.presentation_text IS DISTINCT FROM 'crest.quote.review.v2'||E'\n'||r.content_hash||E'\n'||r.customer_safe_snapshot::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_HISTORY_REQUIRED';END IF;
 END IF;RETURN NEW;
END $stamp$;
CREATE FUNCTION crest_private.reject_quote_review_history_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_REVIEW_HISTORY_RETAINED';END $$;
CREATE TRIGGER quote_assessment_stamp BEFORE INSERT ON crest.condition_assessments FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_quote_review_history();
CREATE TRIGGER quote_approval_stamp BEFORE INSERT ON crest.quote_approvals FOR EACH ROW EXECUTE FUNCTION crest_private.stamp_quote_review_history();
CREATE TRIGGER quote_assessment_retain BEFORE UPDATE OR DELETE ON crest.condition_assessments FOR EACH ROW EXECUTE FUNCTION crest_private.reject_quote_review_history_change();
CREATE TRIGGER quote_assessment_truncate BEFORE TRUNCATE ON crest.condition_assessments FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_quote_review_history_change();
CREATE TRIGGER quote_approval_retain BEFORE UPDATE OR DELETE ON crest.quote_approvals FOR EACH ROW EXECUTE FUNCTION crest_private.reject_quote_review_history_change();
CREATE TRIGGER quote_approval_truncate BEFORE TRUNCATE ON crest.quote_approvals FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_quote_review_history_change();
CREATE UNIQUE INDEX quote_review_audit_version ON crest_private.audit_events(business_id,entity_kind,entity_id,entity_version) WHERE entity_kind IN('condition_assessments','quote_approvals');
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE FUNCTION crest_private.check_quote_review_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE image jsonb;command text;schema integer;verb text;published boolean;
BEGIN
 IF TG_TABLE_NAME='condition_assessments' THEN
  image:=crest_private.quote_assessment_projection(NEW::crest.condition_assessments);command:='quote.draft.save';schema:=2;verb:='create';
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='quote_revisions' AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.delta->'after'->'internal_snapshot'->'sources') s WHERE s->>'vehicleId'=NEW.vehicle_id::text AND s->'assessment'=crest_private.quote_assessment_packet(NEW::crest.condition_assessments))) INTO published;
 ELSE
  image:=crest_private.quote_approval_projection(NEW::crest.quote_approvals);command:='quote.review.approve';schema:=1;verb:='approve';
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='quote_revisions' AND a.entity_id=NEW.revision_id AND a.action='approve' AND a.delta->'after'->>'family_id'=NEW.family_id::text AND a.delta->'after'->>'content_version'=NEW.approved_content_version::text AND a.delta->'after'->>'content_hash'=NEW.approved_content_hash AND a.delta->'after'->'customer_safe_snapshot'=NEW.customer_representation AND a.delta->'after'->>'state'='Ready for Review') INTO published;
 END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=NEW.id AND a.entity_version=1 AND a.action=verb AND a.delta->'before'='null'::jsonb AND a.delta->'after'=image AND o.command_type=command AND o.schema_version=schema AND o.origin='manual' AND o.import_row_id IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_HISTORY_REQUIRED';END IF;RETURN NULL;
END $audit$;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_review_history() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_assessment_audit AFTER INSERT ON crest.condition_assessments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_review_history();
CREATE CONSTRAINT TRIGGER quote_approval_audit AFTER INSERT ON crest.quote_approvals DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_review_history();
RESET ROLE;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_quote_owner;

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
  WHEN 'quote.draft.save' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion']
  WHEN 'quote.review.submit' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion']
  WHEN 'quote.review.approve' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key IN ('expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state','quote.review.submit','quote.review.approve')) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 RETURN true;
END $$;
RESET ROLE;
REVOKE ALL ON FUNCTION crest_private.quote_review_note_valid(jsonb),crest_private.quote_assessment_packet(crest.condition_assessments),crest_private.quote_assessment_projection(crest.condition_assessments),crest_private.quote_approval_projection(crest.quote_approvals),crest_private.stamp_quote_review_history(),crest_private.reject_quote_review_history_change(),crest_private.check_quote_review_history(),crest_private.valid_quote_draft_payload_v1(jsonb),crest_private.valid_quote_review_payload(jsonb),crest_private.quote_review_ready(jsonb),crest_private.persist_quote_assessments(uuid,uuid,uuid,jsonb),crest_private.quote_review_digest(uuid,uuid,uuid,text,integer,uuid,uuid,bigint,bigint,bigint,text,uuid,boolean),crest_private.quote_review_result(uuid,uuid,uuid),crest_private.apply_quote_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text,uuid,boolean,text),crest_private.quote_approval_packet(crest.quote_approvals),crest_commands.submit_quote_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text),crest_commands.approve_quote_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text,uuid,boolean),crest_commands.lookup_quote_review_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_quote_review_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_quote_draft_payload_v1(jsonb),crest_private.valid_quote_review_payload(jsonb),crest_private.valid_quote_draft_payload(jsonb),crest_private.quote_review_ready(jsonb) TO crest_quote_integrity_owner;
GRANT EXECUTE ON FUNCTION crest_commands.submit_quote_review(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text),crest_commands.approve_quote_revision(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text,uuid,boolean),crest_commands.lookup_quote_review_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_quote_review_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_web;

-- Quote review source profile2. Old profile1 and registered45 identities remain unchanged.
SET ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.quote_review_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE families bigint; revisions bigint; items bigint; assessments bigint; approvals bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SCOPE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SCOPE_REQUIRED'; END IF;
 SELECT count(*) INTO families FROM crest.quote_families WHERE business_id=requested_business;
 SELECT count(*) INTO revisions FROM crest.quote_revisions WHERE business_id=requested_business;
 SELECT count(*) INTO items FROM crest.quote_items WHERE business_id=requested_business;
 SELECT count(*) INTO assessments FROM crest.condition_assessments WHERE business_id=requested_business;
 SELECT count(*) INTO approvals FROM crest.quote_approvals WHERE business_id=requested_business;
 IF families+revisions+items+assessments+approvals>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',2,'scope','quote_review','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.quote-review.snapshot/2','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'expectedFamilyCount',families::text,'expectedRevisionCount',revisions::text,'expectedItemCount',items::text,'expectedAssessmentCount',assessments::text,'expectedApprovalCount',approvals::text);
END $context$;
CREATE FUNCTION crest_commands.quote_review_snapshot_families(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_review_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_families WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'families',coalesce(jsonb_agg(crest_private.quote_family_projection(p::crest.quote_families) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_families later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_REVIEW_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
CREATE FUNCTION crest_commands.quote_review_snapshot_revisions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_review_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_revisions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'revisions',coalesce(jsonb_agg(crest_private.quote_revision_projection(p::crest.quote_revisions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_revisions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_REVIEW_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
CREATE FUNCTION crest_commands.quote_review_snapshot_items(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_review_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_items WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'items',coalesce(jsonb_agg((crest_private.quote_item_projection(p::crest.quote_items)||jsonb_build_object('assessment_id',p.assessment_id,'category_override_note',p.category_override_note)) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_items later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_REVIEW_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
CREATE FUNCTION crest_commands.quote_review_snapshot_assessments(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_review_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.condition_assessments WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'assessments',coalesce(jsonb_agg(crest_private.quote_assessment_projection(p::crest.condition_assessments) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.condition_assessments later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_REVIEW_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
CREATE FUNCTION crest_commands.quote_review_snapshot_approvals(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.quote_review_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REVIEW_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_approvals WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'approvals',coalesce(jsonb_agg(crest_private.quote_approval_projection(p::crest.quote_approvals) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_approvals later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_QUOTE_REVIEW_PAGE_LIMIT'; END IF;
 RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_review_snapshot_context(uuid) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_review_snapshot_families(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_review_snapshot_revisions(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_review_snapshot_items(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_review_snapshot_assessments(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
ALTER FUNCTION crest_commands.quote_review_snapshot_approvals(uuid,text,uuid,integer) OWNER TO crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner;
REVOKE ALL ON FUNCTION crest_commands.quote_review_snapshot_context(uuid),crest_commands.quote_review_snapshot_families(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_revisions(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_items(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_assessments(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_approvals(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.quote_review_snapshot_context(uuid),crest_commands.quote_review_snapshot_families(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_revisions(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_items(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_assessments(uuid,text,uuid,integer),crest_commands.quote_review_snapshot_approvals(uuid,text,uuid,integer) TO crest_export;
