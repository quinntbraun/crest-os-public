-- UNREGISTERED explicit cancellation Draft creation/review/approval only.
-- Does not activate editing reason3, actual sharing, acceptance, export or UI.
-- Normal1/2 source definitions stay semantically unchanged; no new operation
-- kind/schema, table grant or financial/visit side effect is introduced.
DO $review$ BEGIN
 IF(SELECT count(*) FROM supabase_migrations.schema_migrations)<>52 OR to_regprocedure('crest_private.valid_quote_cancellation_payload(jsonb)') IS NOT NULL
 OR(SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner') AND a.grantee<>r.oid)
 OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.valid_quote_draft_payload(jsonb)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4e610f0e5612dc0fead5ab5fbef6b140faa9f42c2f72792aa0605545ef95a906')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_review_ready(jsonb)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='a607247252d6cf7adee73c19f001b352c260883b43efe96b25409f1d81642ce5')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.validate_quote_revision_change()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='b741e8ced6fe4d4ddb6d406a9d31b18ec0697f24e736af80b3a66d5c14138536')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_aggregate()') AND proowner='crest_quote_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='63ee2a6894d1de07b7ad1f652349cd2274398deb484559459fdf0e41f0068dd8')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.create_quote_amendment_draft(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,bigint,uuid,bigint,text,jsonb)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4cbe7341409c6562d04e6e02da4598cc654128e3d887f90c482375c6ef9d1c63')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_operation_result(uuid,uuid,uuid)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='1288380399e52d02d6de4f7c474997c3595037ef8099d2ecc2fa4c52f711b117')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='c936d5573144e3c89c59c1358c6b359ea680caf9c498168ef232a3a8047f6627')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.apply_quote_review(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,bigint,text,uuid,boolean,text)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='5215771184806960101859c5f4cf2a7705486e65c89d3642aa3bffe620adb832')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_quote_review_history()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='f7cd6e0b7d0527219b169822af2feecc1e268906d1dec4c5eaca3d52e640d2d8')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_approval_packet(crest.quote_approvals)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='881d54437b496129067038d5659e05076bcf1a23963361c7dc19e31eecc750bd')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_review_result(uuid,uuid,uuid)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='3e1b5e4f2aa6a819abf95824f8829ae2e0515cb7967ce1bf0211f9a2954dca28')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.quote_revisions'::regclass AND conname='quote_versioned_canonical' AND convalidated AND pg_get_constraintdef(oid)='CHECK (((octet_length(canonical_content) <= 16777216) AND ((canonical_content)::jsonb = jsonb_build_object(''schemaVersion'', (customer_safe_snapshot -> ''schemaVersion''::text), ''customer'', customer_safe_snapshot, ''internal'', internal_snapshot)) AND ((customer_safe_snapshot -> ''schemaVersion''::text) = ANY (ARRAY[''1''::jsonb, ''2''::jsonb]))))')
 OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='crest.quote_approvals'::regclass AND conname='quote_approvals_template_version_check' AND convalidated AND pg_get_constraintdef(oid)='CHECK ((template_version = ''crest.quote.review.v2''::text))')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CANCELLATION_LIFECYCLE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_quote_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
ALTER TABLE crest.quote_revisions DROP CONSTRAINT quote_versioned_canonical;
ALTER TABLE crest.quote_revisions ADD CONSTRAINT quote_versioned_canonical CHECK(octet_length(canonical_content)<=16777216 AND canonical_content::jsonb=jsonb_build_object('schemaVersion',customer_safe_snapshot->'schemaVersion','customer',customer_safe_snapshot,'internal',internal_snapshot) AND(customer_safe_snapshot->'schemaVersion' IN('1'::jsonb,'2'::jsonb) OR customer_safe_snapshot->'schemaVersion'='3'::jsonb AND kind='amendment'));
ALTER TABLE crest.quote_approvals DROP CONSTRAINT quote_approvals_template_version_check;
ALTER TABLE crest.quote_approvals ADD CONSTRAINT quote_approvals_template_version_check CHECK(template_version='crest.quote.review.v2' AND customer_representation->'schemaVersion'='2'::jsonb OR template_version='crest.quote.cancellation.v3' AND customer_representation->'schemaVersion'='3'::jsonb);
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_private.valid_quote_cancellation_payload(body jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE c jsonb; i jsonb; line jsonb; source jsonb; k text; s text; n integer; ids text[]:='{}'; inputs jsonb:='[]'; calculated jsonb; blanks text:=E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR NOT(body ?& ARRAY['customer','internal','canonical']) OR body-ARRAY['customer','internal','canonical']<>'{}'::jsonb OR jsonb_typeof(body->'canonical') IS DISTINCT FROM 'string' OR octet_length(body->>'canonical')>16777216 THEN RETURN false;END IF;
 c:=body->'customer';i:=body->'internal';
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(i) IS DISTINCT FROM 'object' OR (body->>'canonical')::jsonb IS DISTINCT FROM jsonb_build_object('schemaVersion',3,'customer',c,'internal',i)
  OR NOT(c ?& ARRAY['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents','purpose','cancellationReason']) OR c-ARRAY['schemaVersion','currency','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','lines','documentDiscount','grossCents','lineDiscountCents','documentDiscountCents','totalCents','purpose','cancellationReason']<>'{}'::jsonb
  OR c->'schemaVersion' IS DISTINCT FROM '3'::jsonb OR c->>'currency' IS DISTINCT FROM 'USD'
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
 IF i->'customerId'='null'::jsonb OR c->'purpose' IS DISTINCT FROM '"cancel_all_remaining_scope"'::jsonb OR jsonb_typeof(c->'cancellationReason') IS DISTINCT FROM 'string' OR char_length(c->>'cancellationReason')>2000 OR btrim(c->>'cancellationReason',blanks)='' OR translate(c->>'cancellationReason',E'\t\n\r','')~'[[:cntrl:]]' OR c->'lines' IS DISTINCT FROM '[]'::jsonb OR i->'sources' IS DISTINCT FROM '[]'::jsonb OR c->'documentDiscount' IS DISTINCT FROM 'null'::jsonb OR c->'proposedSchedule' IS DISTINCT FROM 'null'::jsonb OR i->'extremeReviewRequired' IS DISTINCT FROM 'false'::jsonb THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['grossCents','lineDiscountCents','documentDiscountCents','totalCents'] LOOP IF c->k IS DISTINCT FROM '"0"'::jsonb THEN RETURN false;END IF;END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN RETURN false;
END $function$;
REVOKE ALL ON FUNCTION crest_private.valid_quote_cancellation_payload(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.valid_quote_cancellation_payload(jsonb) TO crest_quote_integrity_owner;

RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.valid_quote_draft_payload(body jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
 IF body->'customer'->'schemaVersion'='1'::jsonb THEN RETURN crest_private.valid_quote_draft_payload_v1(body);ELSIF body->'customer'->'schemaVersion'='2'::jsonb THEN RETURN crest_private.valid_quote_review_payload(body);ELSIF body->'customer'->'schemaVersion'='3'::jsonb THEN RETURN crest_private.valid_quote_cancellation_payload(body);END IF;RETURN false;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.quote_review_ready(body jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE n integer;l jsonb;s jsonb;
BEGIN
 IF body->'customer'->'schemaVersion'='3'::jsonb THEN RETURN crest_private.valid_quote_cancellation_payload(body);END IF;
 IF body->'customer'->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR NOT crest_private.valid_quote_review_payload(body) THEN RETURN false;END IF;
 FOR n IN 0..jsonb_array_length(body->'customer'->'lines')-1 LOOP
  l:=body->'customer'->'lines'->n;s:=body->'internal'->'sources'->n;
  IF s->'jobWide'='true'::jsonb THEN IF l->'condition'<>'null'::jsonb THEN RETURN false;END IF;
  ELSIF l->'category'='null'::jsonb OR l->'condition'='null'::jsonb OR s->'assessment'='null'::jsonb THEN RETURN false;END IF;
 END LOOP;RETURN true;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.validate_quote_revision_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE parent crest.quote_families; preceding bigint; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO parent FROM crest.quote_families WHERE business_id=NEW.business_id AND id=NEW.family_id FOR UPDATE;
 IF parent.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_QUOTE_PARENT_REQUIRED';END IF;
 IF TG_OP='UPDATE' AND (OLD.state IN('Sent','Accepted','Superseded','Declined','Cancelled') OR NEW.state IN('Sent','Accepted','Superseded','Declined','Cancelled')) THEN
  IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['version','state','updated_at','updated_by','operation_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','updated_at','updated_by','operation_id']) OR OLD.state='Accepted' OR NOT(OLD.state='Ready for Review' AND NEW.state='Sent' OR OLD.state='Sent' AND NEW.state IN('Sent','Accepted','Superseded','Declined','Cancelled') OR OLD.state IN('Draft','Ready for Review') AND NEW.state='Cancelled') OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND schema_version=1 AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SENT_CONTENT_FROZEN';END IF;NEW.updated_at:=stamp;RETURN NEW;
 END IF;
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
 IF NEW.internal_snapshot->>'customerId' IS DISTINCT FROM (CASE WHEN NEW.kind='amendment' THEN (SELECT g.customer_id::text FROM crest.agreements g WHERE g.business_id=NEW.business_id AND g.family_id=NEW.family_id AND g.id=NEW.parent_agreement_id) ELSE parent.customer_id::text END) OR NEW.internal_snapshot->>'leadId' IS DISTINCT FROM parent.lead_id::text
  OR NEW.customer_safe_snapshot->>'currency' IS DISTINCT FROM 'USD' OR NEW.customer_safe_snapshot->'schemaVersion' NOT IN('1'::jsonb,'2'::jsonb,'3'::jsonb)
  OR NEW.customer_safe_snapshot->>'totalCents' IS DISTINCT FROM NEW.total_cents::text OR NEW.customer_safe_snapshot->>'timezone' IS DISTINCT FROM NEW.timezone
  OR NEW.customer_safe_snapshot->>'expiryAt' IS DISTINCT FROM (CASE WHEN NEW.expiry_at IS NULL THEN NULL ELSE to_char(NEW.expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SNAPSHOT_CONFLICT';END IF;
 IF NEW.customer_safe_snapshot->'schemaVersion'='3'::jsonb AND(NEW.kind<>'amendment' OR NOT crest_private.valid_quote_cancellation_payload(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_CANCELLATION_REQUIRES_AMENDMENT';END IF;
 IF NEW.kind='amendment' AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.internal_snapshot->'sources') s JOIN crest.scope_entitlements e ON e.business_id=NEW.business_id AND e.agreement_family_id=NEW.family_id AND e.stable_line_key=(s->>'stableLineKey')::uuid WHERE e.vehicle_id IS DISTINCT FROM (s->>'vehicleId')::uuid OR e.job_wide IS DISTINCT FROM (s->>'jobWide')::boolean) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_SCOPE_IDENTITY_RETAINED';END IF;
 IF TG_OP='UPDATE' AND NEW.canonical_content=OLD.canonical_content THEN
  IF NOT crest_private.quote_review_ready(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content)) OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.updated_by AND o.command_type=(CASE WHEN OLD.state='Draft' THEN 'quote.review.submit' ELSE 'quote.review.approve' END) AND o.schema_version=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_REQUIRED';END IF;
 END IF;NEW.updated_at:=stamp;RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
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
 IF NEW.customer_safe_snapshot->'schemaVersion'='3'::jsonb THEN
  IF NEW.kind<>'amendment' OR line_count<>0 OR last_position IS NOT NULL OR inputs IS NOT NULL OR actual IS NOT NULL OR snapshots IS NOT NULL OR sources IS NOT NULL OR NEW.total_cents<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AGGREGATE_CONFLICT';END IF;RETURN NULL;
 END IF;
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
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_commands.create_quote_amendment_draft(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_family uuid, requested_revision uuid, expected_family_version bigint, requested_parent uuid, expected_parent_version bigint, expected_parent_hash text, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;digest text;claimed uuid;existing crest_private.operations;old_family crest.quote_families;family crest.quote_families;offer crest.quote_revisions;revision crest.quote_revisions;control crest.quote_family_commercial_state;parent crest.agreements;parent_revision crest.quote_revisions;item crest.quote_items;customer jsonb;internal jsonb;content_digest text;sequence bigint;line_index integer;source jsonb;line jsonb;assessment_events jsonb;item_events jsonb:='[]';event uuid;family_event uuid;revision_event uuid;receipt jsonb;outcome jsonb;violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 3 OR requested_parent IS NULL OR expected_parent_version IS NULL OR expected_parent_version<1 OR expected_parent_version>=9223372036854775807 OR expected_parent_hash IS NULL OR expected_parent_hash!~'^[a-f0-9]{64}$' OR requested_operation IS NULL OR requested_family IS NULL OR requested_revision IS NULL OR expected_family_version IS NULL OR expected_family_version<1 OR expected_family_version>=9223372036854775807 OR NOT(crest_private.valid_quote_review_payload(body) OR crest_private.valid_quote_cancellation_payload(body)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_AMENDMENT_INPUT_REQUIRED';END IF;
 BEGIN context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_QUOTE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 customer:=body->'customer';internal:=body->'internal';content_digest:=encode(sha256(convert_to(body->>'canonical','UTF8')),'hex');
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','quote.amendment.create','schemaVersion',3,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'familyId',requested_family,'revisionId',requested_revision,'expectedFamilyVersion',expected_family_version::text,'expectedRevisionVersion','0','payload',body,'parentAgreementId',requested_parent,'expectedParentAgreementVersion',expected_parent_version::text,'expectedParentAcceptedHash',expected_parent_hash)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'quote.amendment.create',3,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   IF NOT FOUND OR existing.command_type<>'quote.amendment.create' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;outcome:=crest_private.quote_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   SELECT * INTO old_family FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1212',MESSAGE='family';END IF;
   IF old_family.version<>expected_family_version THEN RAISE EXCEPTION USING ERRCODE='P1211',MESSAGE='version';END IF;
   SELECT * INTO control FROM crest.quote_family_commercial_state WHERE business_id=requested_business AND family_id=requested_family;
   IF control.id IS NULL OR control.initial_acceptance_id IS NULL OR control.current_agreement_id IS DISTINCT FROM requested_parent THEN RAISE EXCEPTION USING ERRCODE='P1214',MESSAGE='parent';END IF;
   SELECT * INTO parent FROM crest.agreements WHERE business_id=requested_business AND family_id=requested_family AND id=requested_parent;
   SELECT q.* INTO parent_revision FROM crest.quote_acceptances a JOIN crest.quote_revisions q ON q.business_id=a.business_id AND q.family_id=a.family_id AND q.id=a.revision_id WHERE a.business_id=requested_business AND a.id=parent.acceptance_id AND a.family_id=parent.family_id AND a.customer_id=parent.customer_id;
   IF parent.id IS NULL OR parent.version_no<>expected_parent_version OR parent_revision.id IS NULL OR parent_revision.state<>'Accepted' OR parent_revision.content_hash<>expected_parent_hash THEN RAISE EXCEPTION USING ERRCODE='P1214',MESSAGE='parent';END IF;
   IF EXISTS(SELECT 1 FROM crest.quote_revisions r WHERE r.business_id=requested_business AND r.family_id=requested_family AND r.kind='amendment' AND r.state IN('Draft','Ready for Review')) THEN RAISE EXCEPTION USING ERRCODE='P1213',MESSAGE='state';END IF;
   IF internal->>'customerId' IS DISTINCT FROM parent.customer_id::text OR internal->>'leadId' IS DISTINCT FROM old_family.lead_id::text THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_REFERENCE_REQUIRED';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(internal->'sources') s JOIN crest.scope_entitlements e ON e.business_id=requested_business AND e.agreement_family_id=requested_family AND e.stable_line_key=(s->>'stableLineKey')::uuid WHERE e.vehicle_id IS DISTINCT FROM (s->>'vehicleId')::uuid OR e.job_wide IS DISTINCT FROM (s->>'jobWide')::boolean) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_SCOPE_IDENTITY_RETAINED';END IF;
   SELECT max(r.sequence)+1 INTO sequence FROM crest.quote_revisions r WHERE business_id=requested_business AND family_id=requested_family;
   INSERT INTO crest.quote_revisions(id,business_id,family_id,sequence,kind,parent_agreement_id,customer_safe_snapshot,internal_snapshot,canonical_content,content_hash,total_cents,expiry_at,timezone,created_by,updated_by,origin,operation_id) VALUES(requested_revision,requested_business,requested_family,sequence,'amendment',requested_parent,customer,internal,body->>'canonical',content_digest,(customer->>'totalCents')::bigint,(customer->>'expiryAt')::timestamptz,customer->>'timezone',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO revision;
   UPDATE crest.quote_families SET current_revision_id=revision.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_family RETURNING * INTO family;
   assessment_events:=crest_private.persist_quote_assessments(requested_business,expected_actor,requested_operation,internal->'sources');
   FOR line_index IN 0..jsonb_array_length(internal->'sources')-1 LOOP
    source:=internal->'sources'->line_index;line:=customer->'lines'->line_index;
    INSERT INTO crest.quote_items(id,business_id,revision_id,stable_line_key,active,position,vehicle_id,job_wide,service_version_id,gross_cents,line_discount,document_discount_eligible,line_discount_cents,allocated_discount_cents,final_cents,complimentary_reason,customer_snapshot,assessment_id,category_override_note,created_by,updated_by,origin,operation_id) VALUES(gen_random_uuid(),requested_business,requested_revision,(source->>'stableLineKey')::uuid,true,line_index+1,(source->>'vehicleId')::uuid,(source->>'jobWide')::boolean,(source->>'serviceVersionId')::uuid,(line->>'grossCents')::bigint,line->'lineDiscount',(line->>'documentDiscountEligible')::boolean,(line->>'lineDiscountCents')::bigint,(line->>'allocatedDiscountCents')::bigint,(line->>'finalCents')::bigint,line->>'complimentaryReason',line,(source->'assessment'->>'id')::uuid,source->>'categoryOverrideNote',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO item;
    event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_items',item.id,1,'create',NULL,crest_private.quote_item_projection(item));item_events:=item_events||to_jsonb(event);
   END LOOP;
   family_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_families',family.id,family.version,'edit',crest_private.quote_family_projection(old_family),crest_private.quote_family_projection(family));
   revision_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_revisions',revision.id,1,'create',NULL,crest_private.quote_revision_projection(revision));
   receipt:=jsonb_build_object('schemaVersion',3,'parentAgreementId',parent.id,'parentAgreementVersion',parent.version_no::text,'parentAcceptedHash',parent_revision.content_hash,'businessId',requested_business,'familyId',family.id,'familyVersion',family.version::text,'revisionId',revision.id,'revisionVersion','1','contentVersion','1','contentHash',revision.content_hash,'familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'itemAuditEventIds',item_events,'assessmentAuditEventIds',assessment_events);
   UPDATE crest_private.operations SET state='committed',result_schema_version=3,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   outcome:=crest_private.quote_operation_result(requested_business,expected_actor,requested_operation);
  END IF;PERFORM crest_commands.finish_quote_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN outcome;
 EXCEPTION WHEN SQLSTATE 'P1211' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentFamilyVersion',old_family.version::text,'currentRevisionVersion','0');WHEN SQLSTATE 'P1214' THEN RETURN jsonb_build_object('state','conflict','reason','parent');WHEN SQLSTATE 'P1212' THEN RETURN jsonb_build_object('state','conflict','reason','family');WHEN SQLSTATE 'P1213' THEN RETURN jsonb_build_object('state','conflict','reason','state');WHEN SQLSTATE 'P1005' THEN RETURN jsonb_build_object('state','conflict','reason','assessment');
 WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated='quote_revisions_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','revision');END IF;RAISE;
 END;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.quote_operation_result(requested_business uuid, requested_actor uuid, requested_operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations; receipt jsonb; family_audit crest_private.audit_events; revision_audit crest_private.audit_events; item_audit crest_private.audit_events; f jsonb; r jsonb; expected_family text; expected_revision text; body jsonb; digest text; count_items integer; seen uuid[]:='{}'; event jsonb; k text; parent crest.agreements; parent_revision crest.quote_revisions;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type IN('quote.draft.save','quote.replacement.create','quote.amendment.create');IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 receipt:=o.result;
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2,3) OR (o.command_type='quote.amendment.create') IS DISTINCT FROM (o.schema_version=3) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt ?& ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']) OR receipt-ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']-(CASE WHEN o.schema_version IN(2,3) THEN ARRAY['assessmentAuditEventIds'] ELSE ARRAY[]::text[] END)-(CASE WHEN o.schema_version=3 THEN ARRAY['parentAgreementId','parentAgreementVersion','parentAcceptedHash'] ELSE ARRAY[]::text[] END)<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR receipt->>'businessId' IS DISTINCT FROM requested_business::text OR jsonb_typeof(receipt->'itemAuditEventIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH k IN ARRAY ARRAY['businessId','familyId','revisionId','familyAuditEventId','revisionAuditEventId']||(CASE WHEN o.schema_version=3 THEN ARRAY['parentAgreementId'] ELSE ARRAY[]::text[] END) LOOP IF jsonb_typeof(receipt->k) IS DISTINCT FROM 'string' OR (receipt->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['familyVersion','revisionVersion','contentVersion']||(CASE WHEN o.schema_version=3 THEN ARRAY['parentAgreementVersion'] ELSE ARRAY[]::text[] END) LOOP IF jsonb_typeof(receipt->k) IS DISTINCT FROM 'string' OR (receipt->>k)!~'^[1-9][0-9]{0,18}$' OR (receipt->>k)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
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
 IF o.command_type='quote.replacement.create' AND (o.schema_version<>2 OR expected_family::bigint<1 OR expected_revision<>'0' OR NOT EXISTS(SELECT 1 FROM crest.quote_sends send JOIN crest_private.audit_events fa ON fa.business_id=send.business_id AND fa.operation_id=send.operation_id AND fa.actor_id=send.created_by AND fa.entity_kind='quote_families' AND fa.entity_id=send.family_id AND fa.delta->'after'=family_audit.delta->'before' JOIN crest_private.audit_events ca ON ca.business_id=send.business_id AND ca.operation_id=send.operation_id AND ca.actor_id=send.created_by AND ca.entity_kind='quote_family_commercial_state' AND ca.entity_id=send.family_id AND ca.delta->'after'->>'active_offer_id'=send.revision_id::text AND ca.delta->'after'->'initial_acceptance_id'='null'::jsonb JOIN crest_private.audit_events ra ON ra.business_id=send.business_id AND ra.operation_id=send.operation_id AND ra.actor_id=send.created_by AND ra.entity_kind='quote_revisions' AND ra.entity_id=send.revision_id AND ra.delta->'after'->>'state'='Sent' WHERE send.business_id=requested_business AND send.family_id=(receipt->>'familyId')::uuid AND send.revision_id=(family_audit.delta->'before'->>'current_revision_id')::uuid AND send.operation_id=(family_audit.delta->'before'->>'operation_id')::uuid AND send.created_by=(family_audit.delta->'before'->>'updated_by')::uuid)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REPLACEMENT_RESULT_REVIEW_REQUIRED';END IF;
 IF o.command_type='quote.amendment.create' THEN
  SELECT g.* INTO parent FROM crest.agreements g WHERE g.business_id=requested_business AND g.family_id=(receipt->>'familyId')::uuid AND g.id=(receipt->>'parentAgreementId')::uuid;
  SELECT q.* INTO parent_revision FROM crest.quote_acceptances a JOIN crest.quote_revisions q ON q.business_id=a.business_id AND q.family_id=a.family_id AND q.id=a.revision_id WHERE a.business_id=requested_business AND a.id=parent.acceptance_id AND a.family_id=parent.family_id AND a.customer_id=parent.customer_id;
  IF parent.id IS NULL OR parent_revision.id IS NULL OR expected_family::bigint<1 OR expected_revision<>'0' OR r->>'kind' IS DISTINCT FROM 'amendment' OR r->>'parent_agreement_id' IS DISTINCT FROM parent.id::text OR r->'internal_snapshot'->>'customerId' IS DISTINCT FROM parent.customer_id::text OR parent.version_no::text IS DISTINCT FROM receipt->>'parentAgreementVersion' OR parent_revision.content_hash IS DISTINCT FROM receipt->>'parentAcceptedHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AMENDMENT_RESULT_REVIEW_REQUIRED';END IF;
 END IF;
 body:=jsonb_build_object('customer',r->'customer_safe_snapshot','internal',r->'internal_snapshot','canonical',r->'canonical_content');
 IF body->'customer'->'schemaVersion'='3'::jsonb AND(o.command_type<>'quote.amendment.create' OR r->>'kind' IS DISTINCT FROM 'amendment') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_CANCELLATION_REQUIRES_AMENDMENT';END IF;
 digest:=encode(sha256(convert_to((jsonb_build_object('commandType',o.command_type,'schemaVersion',o.schema_version,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'familyId',receipt->'familyId','revisionId',receipt->'revisionId','expectedFamilyVersion',expected_family,'expectedRevisionVersion',expected_revision,'payload',body)||(CASE WHEN o.schema_version=3 THEN jsonb_build_object('parentAgreementId',receipt->'parentAgreementId','expectedParentAgreementVersion',receipt->'parentAgreementVersion','expectedParentAcceptedHash',receipt->'parentAcceptedHash') ELSE '{}'::jsonb END))::text,'UTF8')),'hex');
 IF NOT crest_private.valid_quote_draft_payload(body) OR digest<>o.payload_hash OR encode(sha256(convert_to(r->>'canonical_content','UTF8')),'hex') IS DISTINCT FROM receipt->>'contentHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
 FOR event IN SELECT value FROM jsonb_array_elements(receipt->'itemAuditEventIds') LOOP
  IF jsonb_typeof(event)<>'string' OR (event#>>'{}')::uuid=ANY(seen) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO item_audit FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=requested_actor AND id=(event#>>'{}')::uuid AND entity_kind='quote_items';
  IF NOT FOUND OR item_audit.delta->'before' IS NULL OR item_audit.delta->'after'->>'revision_id' IS DISTINCT FROM receipt->>'revisionId' OR item_audit.delta->'after'->>'version' IS DISTINCT FROM item_audit.entity_version::text OR item_audit.action<>(CASE WHEN item_audit.delta->'before'='null'::jsonb THEN 'create' ELSE 'edit' END)
   OR NOT EXISTS(SELECT 1 FROM crest.quote_items WHERE business_id=requested_business AND revision_id=(receipt->>'revisionId')::uuid AND id=item_audit.entity_id AND version>=item_audit.entity_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
  seen:=array_append(seen,item_audit.id);
 END LOOP;
 count_items:=jsonb_array_length(receipt->'itemAuditEventIds');
 IF o.schema_version IN(2,3) THEN
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
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_commands.save_quote_draft(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_family uuid, requested_revision uuid, expected_family_version bigint, expected_revision_version bigint, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
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
    IF old_family.current_revision_id<>requested_revision OR (old_revision.state NOT IN('Draft','Ready for Review') OR old_revision.customer_safe_snapshot->'schemaVersion' IN('2'::jsonb,'3'::jsonb) AND request_schema=1) OR old_revision.kind NOT IN('initial','amendment') OR old_revision.kind='amendment' AND NOT crest_private.amendment_parent_current(requested_business,requested_family,old_revision.parent_agreement_id) OR old_revision.tax_readiness<>'not_configured' THEN RAISE EXCEPTION USING ERRCODE='P1004',MESSAGE='CREST_QUOTE_STATE_CONFLICT';END IF;
    IF (CASE WHEN old_revision.kind='amendment' THEN old_revision.internal_snapshot->>'customerId' ELSE old_family.customer_id::text END) IS DISTINCT FROM internal->>'customerId' OR old_family.lead_id::text IS DISTINCT FROM internal->>'leadId' THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_QUOTE_FAMILY_RETAINED';END IF;
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
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.apply_quote_review(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_family uuid, requested_revision uuid, expected_family_version bigint, expected_revision_version bigint, expected_content_version bigint, expected_hash text, requested_approval uuid, extreme_acknowledged boolean, action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
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
   IF old_r.kind='amendment' AND NOT crest_private.amendment_parent_current(requested_business,requested_family,old_r.parent_agreement_id) THEN RAISE EXCEPTION USING ERRCODE='P1104',MESSAGE='state';END IF;
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
    approval_text:=(CASE WHEN r.customer_safe_snapshot->'schemaVersion'='3'::jsonb THEN 'crest.quote.cancellation.v3' ELSE 'crest.quote.review.v2' END)||E'\n'||r.content_hash||E'\n'||r.customer_safe_snapshot::text;
    INSERT INTO crest.quote_approvals(id,business_id,family_id,revision_id,approved_content_version,approved_content_hash,actor_id,extreme_acknowledged,template_version,customer_representation,presentation_text,presentation_hash,created_by,updated_by,origin,operation_id) VALUES(requested_approval,requested_business,f.id,r.id,r.content_version,r.content_hash,expected_actor,apply_quote_review.extreme_acknowledged,(CASE WHEN r.customer_safe_snapshot->'schemaVersion'='3'::jsonb THEN 'crest.quote.cancellation.v3' ELSE 'crest.quote.review.v2' END),r.customer_safe_snapshot,approval_text,encode(sha256(convert_to(approval_text,'UTF8')),'hex'),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO a;
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
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_quote_review_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE stamp timestamptz:=clock_timestamp();r crest.quote_revisions;
BEGIN
 NEW.created_at:=stamp;NEW.updated_at:=stamp;
 IF TG_TABLE_NAME='quote_approvals' THEN
  NEW.reviewed_at:=stamp;SELECT * INTO r FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id AND id=NEW.revision_id;
  IF r.id IS NULL OR r.state<>'Ready for Review' OR (r.customer_safe_snapshot->'schemaVersion' IS DISTINCT FROM '2'::jsonb AND r.customer_safe_snapshot->'schemaVersion' IS DISTINCT FROM '3'::jsonb) OR NEW.template_version IS DISTINCT FROM (CASE WHEN r.customer_safe_snapshot->'schemaVersion'='3'::jsonb THEN 'crest.quote.cancellation.v3' ELSE 'crest.quote.review.v2' END) OR NEW.approved_content_version<>r.content_version OR NEW.approved_content_hash<>r.content_hash OR NEW.customer_representation IS DISTINCT FROM r.customer_safe_snapshot OR r.internal_snapshot->'extremeReviewRequired'='true'::jsonb AND NOT NEW.extreme_acknowledged OR NEW.presentation_text IS DISTINCT FROM (CASE WHEN r.customer_safe_snapshot->'schemaVersion'='3'::jsonb THEN 'crest.quote.cancellation.v3' ELSE 'crest.quote.review.v2' END)||E'\n'||r.content_hash||E'\n'||r.customer_safe_snapshot::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_HISTORY_REQUIRED';END IF;
 END IF;RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.quote_approval_packet(a crest.quote_approvals)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE event uuid;
BEGIN
 SELECT id INTO event FROM crest_private.audit_events WHERE business_id=a.business_id AND operation_id=a.operation_id AND actor_id=a.actor_id AND entity_kind='quote_approvals' AND entity_id=a.id AND entity_version=1 AND action='approve' AND delta->'before'='null'::jsonb AND delta->'after'=crest_private.quote_approval_projection(a);
 IF event IS NULL OR a.template_version IS DISTINCT FROM (CASE WHEN a.customer_representation->'schemaVersion'='3'::jsonb THEN 'crest.quote.cancellation.v3' ELSE 'crest.quote.review.v2' END) OR a.presentation_text IS DISTINCT FROM (CASE WHEN a.customer_representation->'schemaVersion'='3'::jsonb THEN 'crest.quote.cancellation.v3' ELSE 'crest.quote.review.v2' END)||E'\n'||a.approved_content_hash||E'\n'||a.customer_representation::text OR a.presentation_hash IS DISTINCT FROM encode(sha256(convert_to(a.presentation_text,'UTF8')),'hex') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('id',a.id,'contentVersion',a.approved_content_version::text,'contentHash',a.approved_content_hash,'actorId',a.actor_id,'reviewedAt',to_char(a.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'extremeAcknowledged',a.extreme_acknowledged,'templateVersion',a.template_version,'customerRepresentation',a.customer_representation,'presentationText',a.presentation_text,'presentationHash',a.presentation_hash,'operationId',a.operation_id,'auditEventId',event);
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.quote_review_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
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
  IF a.id IS NOT NULL THEN PERFORM crest_private.quote_approval_packet(a);END IF;
  IF a.id IS NULL OR aa.id IS NULL OR aa.delta->'before' IS DISTINCT FROM 'null'::jsonb OR aa.delta->'after' IS DISTINCT FROM crest_private.quote_approval_projection(a) OR a.approved_content_version::text IS DISTINCT FROM r->>'contentVersion' OR a.approved_content_hash IS DISTINCT FROM r->>'contentHash' OR a.customer_representation IS DISTINCT FROM after->'customer_safe_snapshot' OR a.presentation_hash IS DISTINCT FROM r->>'presentationHash' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 ELSIF r->'approvalId' IS DISTINCT FROM 'null'::jsonb OR r->'approvalAuditEventId' IS DISTINCT FROM 'null'::jsonb OR r->'presentationHash' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 digest:=crest_private.quote_review_digest(business,actor,o.recovery_epoch,result_action,1,(r->>'familyId')::uuid,(r->>'revisionId')::uuid,(f.delta->'before'->>'version')::bigint,(before->>'version')::bigint,(before->>'content_version')::bigint,before->>'content_hash',a.id,coalesce(a.extreme_acknowledged,false));
 IF digest<>o.payload_hash OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation)<>(CASE WHEN result_action='approve' THEN 3 ELSE 2 END) OR NOT EXISTS(SELECT 1 FROM crest.quote_families WHERE business_id=business AND id=(r->>'familyId')::uuid AND version>=(r->>'familyVersion')::bigint) OR NOT EXISTS(SELECT 1 FROM crest.quote_revisions WHERE business_id=business AND family_id=(r->>'familyId')::uuid AND id=(r->>'revisionId')::uuid AND version>=(r->>'revisionVersion')::bigint) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_RESULT_REVIEW_REQUIRED';
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
RESET ROLE;
