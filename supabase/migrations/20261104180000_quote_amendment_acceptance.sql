-- Synthetic amendment acceptance schema53 candidate; not repository registration.
-- Coordinator owns the atomic transaction. Initial accepted history stays intact.
RESET ROLE;

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-storage.sql
-- UNREGISTERED P05/BR05/BR06 construction over exact registered52.
-- No acceptance command/API, financial posting or owner migration is enabled.
-- Package reviewed construction in an append-only migration before delivery.
DO $review$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.allocation_plan_versions'::regclass AND attname IN('entitlement_version_id','authorization_state') AND NOT attisdropped)
  OR to_regprocedure('crest_private.amendment_allocation_binding_valid(crest.allocation_plan_versions,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='a563af066b71fb4f002738a91ee8fe975dd5721a7a816860e038277dcc3e211c')
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN('crest.allocation_plan_versions'::regclass,'crest.scope_allocations'::regclass,'crest.scope_entitlements'::regclass,'crest.entitlement_versions'::regclass) AND (relowner<>'crest_schema_owner'::regrole OR NOT relrowsecurity OR NOT relforcerowsecurity))
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_booking_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ALLOCATION_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.allocation_plan_versions ADD COLUMN entitlement_version_id uuid;
ALTER TABLE crest.allocation_plan_versions ADD COLUMN authorization_state text;
ALTER TABLE crest.allocation_plan_versions ADD CONSTRAINT amendment_allocation_authorization_shape CHECK((entitlement_version_id IS NULL)=(authorization_state IS NULL) AND (authorization_state IS NULL OR authorization_state IN('active','withdrawn')));
ALTER TABLE crest.allocation_plan_versions ADD CONSTRAINT allocation_plan_entitlement_version FOREIGN KEY(business_id,entitlement_version_id) REFERENCES crest.entitlement_versions(business_id,id) ON DELETE RESTRICT;
CREATE OR REPLACE FUNCTION crest_private.allocation_plan_versions_projection(v crest.allocation_plan_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN (v).entitlement_version_id IS NULL THEN to_jsonb(v)-'entitlement_version_id'-'authorization_state' ELSE to_jsonb(v) END)||jsonb_build_object('sequence',(v).sequence::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.amendment_allocation_binding_valid(p crest.allocation_plan_versions,s crest.scope_allocations,e crest.scope_entitlements,v crest.entitlement_versions) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce((p).id IS NOT NULL AND (p).business_id IS NOT NULL AND (p).sequence>0 AND (s).id IS NOT NULL AND (e).id IS NOT NULL
  AND (p).source_allocation_id=(s).id AND (p).business_id=(s).business_id AND (p).business_id=(e).business_id AND (s).entitlement_id=(e).id
  AND CASE WHEN (p).entitlement_version_id IS NULL THEN (v).id IS NULL AND (p).authorization_state IS NULL
   ELSE (v).id=(p).entitlement_version_id AND (v).business_id=(p).business_id AND (v).entitlement_id=(e).id AND (v).family_id=(e).agreement_family_id AND (v).agreement_id IS NOT NULL AND (v).authorized_cents>=0 AND ((p).authorization_state='active' OR (p).authorization_state='withdrawn' AND (v).authorized_cents=0) END,false)
$valid$;
REVOKE ALL ON FUNCTION crest_private.amendment_allocation_binding_valid(crest.allocation_plan_versions,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.amendment_allocation_binding_valid(crest.allocation_plan_versions,crest.scope_allocations,crest.scope_entitlements,crest.entitlement_versions) TO crest_booking_integrity_owner;
CREATE OR REPLACE VIEW crest.current_scope_allocation_parts WITH(security_barrier=true,security_invoker=true) AS
 WITH latest AS(SELECT DISTINCT ON(business_id,source_allocation_id) business_id,source_allocation_id,id,sequence,entitlement_version_id,authorization_state FROM crest.allocation_plan_versions ORDER BY business_id,source_allocation_id,sequence DESC)
 SELECT s.business_id,s.id AS source_allocation_id,s.entitlement_id,coalesce(l.entitlement_version_id,s.entitlement_version_id) AS entitlement_version_id,coalesce(v.agreement_id,s.agreement_id) AS agreement_id,
 l.id AS plan_id,coalesce(l.sequence,0::bigint) AS plan_sequence,
 CASE WHEN l.id IS NULL THEN s.stable_partition_id ELSE p.stable_partition_id END AS stable_partition_id,
 p.job_id,CASE WHEN l.id IS NULL THEN 'unassigned'::text ELSE p.allocation_state END AS allocation_state,
 CASE WHEN l.id IS NULL THEN s.gross_inclusive_cents ELSE p.gross_inclusive_cents END AS gross_inclusive_cents,
 CASE WHEN l.id IS NULL THEN s.discount_inclusive_cents ELSE p.discount_inclusive_cents END AS discount_inclusive_cents,
 CASE WHEN l.id IS NULL THEN s.amount_cents ELSE p.amount_cents END AS amount_cents,
 CASE WHEN l.id IS NULL THEN s.scope_description ELSE p.scope_description END AS scope_description
 FROM crest.scope_allocations s LEFT JOIN latest l ON l.business_id=s.business_id AND l.source_allocation_id=s.id
 LEFT JOIN crest.allocation_plan_parts p ON p.business_id=l.business_id AND p.plan_id=l.id
 LEFT JOIN crest.entitlement_versions v ON v.business_id=s.business_id AND v.id=l.entitlement_version_id
 WHERE l.id IS NULL OR p.id IS NOT NULL AND l.authorization_state IS DISTINCT FROM 'withdrawn';
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE FUNCTION crest_private.check_amendment_allocation_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE s crest.scope_allocations;e crest.scope_entitlements;v crest.entitlement_versions;current_agreement uuid;o crest_private.operations;has_parts boolean;
BEGIN
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=NEW.business_id AND id=NEW.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=NEW.business_id AND id=s.entitlement_id;
 IF NEW.entitlement_version_id IS NOT NULL THEN SELECT * INTO v FROM crest.entitlement_versions WHERE business_id=NEW.business_id AND id=NEW.entitlement_version_id;END IF;
 IF NOT crest_private.amendment_allocation_binding_valid(NEW,s,e,v) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_BINDING_REQUIRED';END IF;
 SELECT current_agreement_id INTO current_agreement FROM crest.quote_family_commercial_state WHERE business_id=NEW.business_id AND family_id=e.agreement_family_id;
 IF current_agreement IS NULL OR current_agreement IS DISTINCT FROM coalesce(v.agreement_id,s.agreement_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_CURRENT_REQUIRED';END IF;
 IF NEW.entitlement_version_id IS NOT NULL THEN
  SELECT EXISTS(SELECT 1 FROM crest.allocation_plan_parts WHERE business_id=NEW.business_id AND plan_id=NEW.id) INTO has_parts;
  IF NEW.authorization_state='withdrawn' AND has_parts OR NEW.authorization_state='active' AND NOT has_parts
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_PARTS_REQUIRED';END IF;
  SELECT state,command_type,schema_version INTO o.state,o.command_type,o.schema_version FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by;
  IF o.state IS DISTINCT FROM 'committed' OR NOT coalesce(o.command_type='quote.amendment.accept' AND o.schema_version=1 OR NEW.authorization_state='active' AND o.command_type IN('operations.job.book','operations.job.cancel') AND o.schema_version=2,false)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_COMMAND_REQUIRED';END IF;
 END IF;
 RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_amendment_allocation_binding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_amendment_allocation_binding() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER amendment_allocation_binding AFTER INSERT ON crest.allocation_plan_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_amendment_allocation_binding();
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-storage.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-input.sql
-- UNREGISTERED BR05/BR06 input/fingerprint construction over registered52.
-- Pure private functions only. No command, mutation, role membership or app grant.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR to_regprocedure('crest_private.amendment_scope_plans_valid(jsonb)') IS NOT NULL
  OR to_regprocedure('crest_private.amendment_accept_digest(uuid,uuid,uuid,jsonb)') IS NOT NULL
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.amendment_scope_plans_valid(input jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE r jsonb;p jsonb;k text;n numeric;total numeric:=0;gross numeric;discount numeric;amount numeric;part_count integer:=0;description text;
 ids text[];old_ids text[];parts_ids text[];uuid_pattern text:='^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$';
BEGIN
 -- JSONB adds separator whitespace. This internal representation bound is not
 -- an increase to the incoming complete-command128KiB transport limit.
 IF jsonb_typeof(input) IS DISTINCT FROM 'array' OR octet_length(input::text)>262144 THEN RETURN false;END IF;
 IF jsonb_array_length(input)>1000 THEN RETURN false;END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(input) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(r))<>13 OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) AS field(name) WHERE field.name<>ALL(ARRAY['stableLineKey','entitlementId','expectedEntitlementVersionId','entitlementVersionId','sourceAllocationId','sourcePartitionId','expectedPlanId','expectedPlanSequence','authorizationState','grossInclusiveCents','discountInclusiveCents','amountCents','parts'])) THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['stableLineKey','entitlementId','entitlementVersionId','sourceAllocationId','sourcePartitionId'] LOOP
   IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR (r->>k)!~uuid_pattern THEN RETURN false;END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['expectedEntitlementVersionId','expectedPlanId'] LOOP
   IF r->k IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR (r->>k)!~uuid_pattern) THEN RETURN false;END IF;
  END LOOP;
  IF r->>'expectedEntitlementVersionId'=r->>'entitlementVersionId' THEN RETURN false;END IF;
  FOREACH k IN ARRAY ARRAY['expectedPlanSequence','grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP
   IF jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR (r->>k)!~'^(0|[1-9][0-9]{0,18})$' THEN RETURN false;END IF;
   n:=(r->>k)::numeric;IF n>9223372036854775807 OR k='expectedPlanSequence' AND n=9223372036854775807 THEN RETURN false;END IF;
  END LOOP;
  IF (r->>'expectedPlanSequence'='0') IS DISTINCT FROM (r->'expectedPlanId'='null'::jsonb) OR r->'expectedEntitlementVersionId'='null'::jsonb AND r->>'expectedPlanSequence'<>'0' THEN RETURN false;END IF;
  IF (r->>'grossInclusiveCents')::numeric-(r->>'discountInclusiveCents')::numeric<>(r->>'amountCents')::numeric THEN RETURN false;END IF;
  total:=total+(r->>'amountCents')::numeric;IF total>9223372036854775807 THEN RETURN false;END IF;
  IF jsonb_typeof(r->'parts') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  part_count:=part_count+jsonb_array_length(r->'parts');IF part_count>10000 THEN RETURN false;END IF;
  IF r->>'authorizationState'='withdrawn' THEN
   IF r->'expectedEntitlementVersionId'='null'::jsonb OR r->>'grossInclusiveCents'<>'0' OR r->>'discountInclusiveCents'<>'0' OR r->>'amountCents'<>'0' OR jsonb_array_length(r->'parts')<>0 THEN RETURN false;END IF;
  ELSIF r->>'authorizationState'='active' THEN
   IF jsonb_array_length(r->'parts')=0 THEN RETURN false;END IF;
   gross:=0;discount:=0;amount:=0;parts_ids:=ARRAY[]::text[];
   FOR p IN SELECT value FROM jsonb_array_elements(r->'parts') LOOP
    IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(p))<>7 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) AS field(name) WHERE field.name<>ALL(ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'])) THEN RETURN false;END IF;
    IF jsonb_typeof(p->'partitionId') IS DISTINCT FROM 'string' OR (p->>'partitionId')!~uuid_pattern OR p->>'partitionId'=ANY(parts_ids) THEN RETURN false;END IF;
    parts_ids:=array_append(parts_ids,p->>'partitionId');
    IF p->'jobId' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(p->'jobId') IS DISTINCT FROM 'string' OR (p->>'jobId')!~uuid_pattern) THEN RETURN false;END IF;
    IF jsonb_typeof(p->'state') IS DISTINCT FROM 'string' OR (p->>'state')<>ALL(ARRAY['unassigned','assigned','completed','cancelled']) OR (p->'jobId'='null'::jsonb) IS DISTINCT FROM (p->>'state'='unassigned') THEN RETURN false;END IF;
    FOREACH k IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP
     IF jsonb_typeof(p->k) IS DISTINCT FROM 'string' OR (p->>k)!~'^(0|[1-9][0-9]{0,18})$' THEN RETURN false;END IF;
     IF (p->>k)::numeric>9223372036854775807 THEN RETURN false;END IF;
    END LOOP;
    IF (p->>'grossInclusiveCents')::numeric-(p->>'discountInclusiveCents')::numeric<>(p->>'amountCents')::numeric THEN RETURN false;END IF;
    gross:=gross+(p->>'grossInclusiveCents')::numeric;discount:=discount+(p->>'discountInclusiveCents')::numeric;amount:=amount+(p->>'amountCents')::numeric;
    IF jsonb_typeof(p->'scopeDescription') IS DISTINCT FROM 'string' THEN RETURN false;END IF;description:=p->>'scopeDescription';
    IF char_length(description)>2000 OR description~U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]*$' OR description~U&'[\0001-\0008\000B-\000C\000E-\001F\007F]' THEN RETURN false;END IF;
   END LOOP;
   IF gross<>(r->>'grossInclusiveCents')::numeric OR discount<>(r->>'discountInclusiveCents')::numeric OR amount<>(r->>'amountCents')::numeric THEN RETURN false;END IF;
   IF r->>'amountCents'='0' AND (jsonb_array_length(r->'parts')<>1 OR r->'parts'->0->>'partitionId' IS DISTINCT FROM r->>'sourcePartitionId') THEN RETURN false;END IF;
  ELSE RETURN false;END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['stableLineKey','entitlementId','entitlementVersionId','sourceAllocationId','sourcePartitionId','expectedEntitlementVersionId','expectedPlanId'] LOOP
  SELECT coalesce(array_agg(value->>k) FILTER(WHERE value->k<>'null'::jsonb),ARRAY[]::text[]) INTO ids FROM jsonb_array_elements(input);
  IF cardinality(ids)<>(SELECT count(DISTINCT id) FROM unnest(ids) id) THEN RETURN false;END IF;
 END LOOP;
 SELECT coalesce(array_agg(value->>'expectedEntitlementVersionId') FILTER(WHERE value->'expectedEntitlementVersionId'<>'null'::jsonb),ARRAY[]::text[]) INTO old_ids FROM jsonb_array_elements(input);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(input) AS entry(value) WHERE entry.value->>'entitlementVersionId'=ANY(old_ids)) THEN RETURN false;END IF;
 RETURN true;
END $valid$;
CREATE FUNCTION crest_private.amendment_accept_digest(business uuid,actor uuid,epoch uuid,request jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $digest$
 SELECT encode(sha256(convert_to(jsonb_build_object('commandType','quote.amendment.accept','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',epoch,'request',request)::text,'UTF8')),'hex')
$digest$;
REVOKE ALL ON FUNCTION crest_private.amendment_scope_plans_valid(jsonb),crest_private.amendment_accept_digest(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.amendment_scope_plans_valid(jsonb),crest_private.amendment_accept_digest(uuid,uuid,uuid,jsonb) TO crest_quote_owner,crest_quote_integrity_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-input.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-ledger.sql
-- UNREGISTERED BR05 acceptance-ledger construction over registered52.
-- One initial acceptance per family; later amendment acceptances remain distinct.
-- No new command, browser grant, owner migration or finance activation.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.quote_acceptances'::regclass AND attname='kind' AND NOT attisdropped)
  OR to_regprocedure('crest_private.quote_acceptance_kind_valid(crest.quote_acceptances,crest.quote_revisions,crest_private.operations)') IS NOT NULL
  OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='crest.quote_acceptances'::regclass AND conname='quote_acceptances_business_id_family_id_key') IS DISTINCT FROM 'UNIQUE (business_id, family_id)'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_acceptances_projection(crest.quote_acceptances)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='0a4422a3f8846b366fc836d32d04eeb82104b1e9bae62857e358fda5007dc63d')
  OR EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.quote_acceptances'::regclass AND (relowner<>'crest_schema_owner'::regrole OR NOT relrowsecurity OR NOT relforcerowsecurity))
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_integrity_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPTANCE_LEDGER_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
ALTER TABLE crest.quote_acceptances ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK(kind IN('initial','amendment'));
ALTER TABLE crest.quote_acceptances DROP CONSTRAINT quote_acceptances_business_id_family_id_key;
CREATE UNIQUE INDEX quote_one_initial_acceptance ON crest.quote_acceptances(business_id,family_id) WHERE kind='initial';
-- Prior receipts and audit images must retain their original exact shape.
CREATE OR REPLACE FUNCTION crest_private.quote_acceptances_projection(v crest.quote_acceptances) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $projection$
 SELECT (CASE WHEN (v).kind='initial' THEN to_jsonb(v)-'kind' ELSE to_jsonb(v) END)||jsonb_build_object('version',(v).version::text,'created_at',to_char((v).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((v).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'confirmation_effective_at',to_char((v).confirmation_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'recorded_at',to_char((v).recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
$projection$;
CREATE FUNCTION crest_private.quote_acceptance_kind_valid(a crest.quote_acceptances,r crest.quote_revisions,o crest_private.operations) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce((a).id IS NOT NULL AND (r).id IS NOT NULL AND (o).operation_id IS NOT NULL
  AND (a).business_id=(r).business_id AND (a).business_id=(o).business_id
  AND (a).family_id=(r).family_id AND (a).revision_id=(r).id
  AND (a).operation_id=(o).operation_id AND (a).created_by=(o).actor_id
  AND (a).content_hash=(r).content_hash AND (r).state='Accepted'
  AND (o).state='committed' AND (o).schema_version=1 AND (o).result->'schemaVersion'='1'::jsonb
  AND CASE WHEN (a).kind='initial' THEN (r).kind='initial' AND (r).parent_agreement_id IS NULL AND (o).command_type='quote.confirmation.accept'
   WHEN (a).kind='amendment' THEN (r).kind='amendment' AND (r).parent_agreement_id IS NOT NULL AND (a).conversion_id IS NULL AND (o).command_type='quote.amendment.accept'
   ELSE false END,false)
$valid$;
REVOKE ALL ON FUNCTION crest_private.quote_acceptance_kind_valid(crest.quote_acceptances,crest.quote_revisions,crest_private.operations) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.quote_acceptance_kind_valid(crest.quote_acceptances,crest.quote_revisions,crest_private.operations) TO crest_quote_integrity_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE FUNCTION crest_private.check_quote_acceptance_kind() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE r crest.quote_revisions;o crest_private.operations;
BEGIN
 SELECT * INTO r FROM crest.quote_revisions WHERE business_id=NEW.business_id AND family_id=NEW.family_id AND id=NEW.revision_id;
 SELECT business_id,operation_id,actor_id,command_type,schema_version,state,result INTO o.business_id,o.operation_id,o.actor_id,o.command_type,o.schema_version,o.state,o.result FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.created_by;
 IF NOT crest_private.quote_acceptance_kind_valid(NEW,r,o) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_ACCEPTANCE_KIND_REQUIRED';END IF;
 RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_quote_acceptance_kind() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_acceptance_kind() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_acceptance_kind AFTER INSERT ON crest.quote_acceptances DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_acceptance_kind();
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-ledger.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-core.sql
-- UNREGISTERED atomic acceptance construction over registered52 plus reviewed
-- ledger/input/allocation proposals. Private implementation only: no facade,
-- web/worker grant or policy widening. The accompanying original-result and
-- deferred integrity closure must be completed before this can commit or ship.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR to_regprocedure('crest_private.amendment_accept_digest(uuid,uuid,uuid,jsonb)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.quote_acceptances'::regclass AND attname='kind' AND NOT attisdropped)
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.allocation_plan_versions'::regclass AND attname='entitlement_version_id' AND NOT attisdropped)
  OR to_regprocedure('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_quote_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_quote_owner'::regrole OR member='crest_quote_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname='crest_quote_owner' AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole='crest_quote_owner'::regrole AND a.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CORE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_private.apply_quote_amendment_acceptance(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $accept$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;old_f crest.quote_families;f crest.quote_families;old_r crest.quote_revisions;r crest.quote_revisions;old_control crest.quote_family_commercial_state;control crest.quote_family_commercial_state;parent crest.agreements;parent_revision crest.quote_revisions;sent crest.quote_sends;approval crest.quote_approvals;a crest.quote_acceptances;g crest.agreements;e crest.scope_entitlements;v crest.entitlement_versions;prior_v crest.entitlement_versions;s crest.scope_allocations;prior_plan crest.allocation_plan_versions;plan crest.allocation_plan_versions;part crest.allocation_plan_parts;item crest.quote_items;entry jsonb;piece jsonb;body jsonb;confirmation timestamptz;reason text;violated text;outcome jsonb;receipt jsonb;keys text[]:=ARRAY['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash','acceptanceId','agreementId','body','scopePlans','expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash'];key text;new_entitlements uuid[]:=ARRAY[]::uuid[];versions uuid[]:=ARRAY[]::uuid[];new_sources uuid[]:=ARRAY[]::uuid[];plans uuid[]:=ARRAY[]::uuid[];parts uuid[]:=ARRAY[]::uuid[];audits uuid[]:=ARRAY[]::uuid[];family_event uuid;revision_event uuid;control_event uuid;acceptance_event uuid;agreement_event uuid;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_AMENDMENT_ACCEPT_FRESH_READ_REQUIRED';END IF;
 -- Future field/finance adoption must extend live consumption/result guards
 -- before accepting writes on its new schema. No missing ledger is treated as
 -- zero financial consumption by this fixed construction profile.
 IF (SELECT encode(sha256(convert_to(string_agg(catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname,E'\n' ORDER BY (catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace catalog_n JOIN pg_class catalog_c ON catalog_c.relnamespace=catalog_n.oid JOIN pg_attribute catalog_a ON catalog_a.attrelid=catalog_c.oid WHERE catalog_n.nspname='crest' AND catalog_c.relkind IN('r','p') AND catalog_a.attnum>0 AND NOT catalog_a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_SCHEMA_REVIEW_REQUIRED';END IF;
 IF jsonb_typeof(request) IS DISTINCT FROM 'object' OR NOT(request?&keys) OR request-keys<>'{}'::jsonb OR octet_length(request::text)>262144 OR request->'schemaVersion' IS DISTINCT FROM '1'::jsonb
  OR request->>'businessId' IS DISTINCT FROM requested_business::text OR request->>'operationId' IS DISTINCT FROM requested_operation::text OR request->>'recoveryEpoch' IS DISTINCT FROM expected_epoch::text OR expected_actor IS NULL OR requested_operation IS NULL OR expected_epoch IS NULL OR requested_business IS NULL
  OR crest_private.amendment_scope_plans_valid(request->'scopePlans') IS DISTINCT FROM true OR crest_private.quote_commercial_body_valid('accept',request->'body') IS DISTINCT FROM true OR request->'body'->'conversionId' IS DISTINCT FROM 'null'::jsonb
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['familyId','revisionId','acceptanceId','agreementId','expectedParentAgreementId'] LOOP IF NOT crest_private.original_operation_uuid(request->key) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedParentAgreementVersion'] LOOP IF NOT crest_private.original_operation_version(request->key,false) OR (request->>key)::numeric>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;END LOOP;
 IF (request->>'expectedContentVersion')::numeric>(request->>'expectedRevisionVersion')::numeric OR request->>'agreementId'=request->>'expectedParentAgreementId' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['expectedHash','expectedParentAcceptedHash'] LOOP IF jsonb_typeof(request->key) IS DISTINCT FROM 'string' OR (request->>key)!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;END LOOP;
 BEGIN context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_QUOTE_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=crest_private.amendment_accept_digest(requested_business,expected_actor,expected_epoch,request);body:=request->'body';
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'quote.amendment.accept',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation AND actor_id=expected_actor;
   IF NOT FOUND OR existing.command_type<>'quote.amendment.accept' OR existing.schema_version<>1 OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   outcome:=crest_private.amendment_accept_result(requested_business,expected_actor,requested_operation);
  ELSE
   -- Match booking/cancellation lock order before taking the family row lock.
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO old_f FROM crest.quote_families WHERE business_id=requested_business AND id=(request->>'familyId')::uuid FOR UPDATE;IF NOT FOUND THEN reason:='family';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   SELECT * INTO old_r FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=old_f.id AND id=(request->>'revisionId')::uuid FOR UPDATE;IF NOT FOUND THEN reason:='revision';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   IF old_f.version::text<>request->>'expectedFamilyVersion' OR old_r.version::text<>request->>'expectedRevisionVersion' OR old_r.content_version::text<>request->>'expectedContentVersion' OR old_r.content_hash<>request->>'expectedHash' THEN reason:='version';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   SELECT * INTO old_control FROM crest.quote_family_commercial_state WHERE business_id=requested_business AND family_id=old_f.id FOR UPDATE;
   IF old_r.kind<>'amendment' OR old_r.state<>'Sent' OR old_r.parent_agreement_id::text IS DISTINCT FROM request->>'expectedParentAgreementId' OR old_control.initial_acceptance_id IS NULL OR old_control.current_agreement_id IS DISTINCT FROM old_r.parent_agreement_id THEN reason:='parent';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   IF old_control.active_offer_id IS DISTINCT FROM old_r.id THEN reason:='offer';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   SELECT * INTO parent FROM crest.agreements WHERE business_id=requested_business AND family_id=old_f.id AND id=old_r.parent_agreement_id AND version_no::text=request->>'expectedParentAgreementVersion';
   SELECT q.* INTO parent_revision FROM crest.quote_acceptances accepted JOIN crest.quote_revisions q ON q.business_id=accepted.business_id AND q.family_id=accepted.family_id AND q.id=accepted.revision_id WHERE accepted.business_id=requested_business AND accepted.id=parent.acceptance_id AND accepted.customer_id=parent.customer_id;
   IF parent.id IS NULL OR parent_revision.id IS NULL OR parent_revision.state<>'Accepted' OR parent_revision.content_hash IS DISTINCT FROM request->>'expectedParentAcceptedHash' OR parent.customer_id::text IS DISTINCT FROM body->>'customerId' THEN reason:='parent';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   SELECT * INTO sent FROM crest.quote_sends WHERE business_id=requested_business AND family_id=old_f.id AND revision_id=old_r.id AND id=(body->>'sendId')::uuid;IF NOT FOUND THEN reason:='send';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   SELECT * INTO approval FROM crest.quote_approvals WHERE business_id=requested_business AND family_id=old_f.id AND revision_id=old_r.id AND id=sent.approval_id AND approved_content_version=old_r.content_version AND approved_content_hash=old_r.content_hash AND customer_representation=old_r.customer_safe_snapshot AND presentation_hash=sent.presentation_hash;IF NOT FOUND THEN reason:='approval';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   IF old_r.expiry_at IS NOT NULL AND old_r.expiry_at<=clock_timestamp() THEN reason:='expired';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   confirmation:=(body->>'confirmationEffectiveAt')::timestamptz;
   IF NOT isfinite(confirmation) OR to_char(confirmation AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') IS DISTINCT FROM body->>'confirmationEffectiveAt' OR confirmation<approval.reviewed_at OR confirmation>clock_timestamp() THEN reason:='confirmation';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   -- Complete scope set, including identities withdrawn by an earlier amendment.
   IF EXISTS(SELECT 1 FROM crest.scope_entitlements existing_scope WHERE business_id=requested_business AND agreement_family_id=old_f.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request->'scopePlans') p WHERE p->>'entitlementId'=existing_scope.id::text AND p->>'stableLineKey'=existing_scope.stable_line_key::text))
    OR EXISTS(SELECT 1 FROM crest.quote_items active_item WHERE business_id=requested_business AND revision_id=old_r.id AND active AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(request->'scopePlans') p WHERE p->>'stableLineKey'=active_item.stable_line_key::text AND p->>'authorizationState'='active')) THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   -- Validate every observed binding and retained job partition before writes.
   FOR entry IN SELECT value FROM jsonb_array_elements(request->'scopePlans') LOOP
    SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=requested_business AND agreement_family_id=old_f.id AND stable_line_key=(entry->>'stableLineKey')::uuid;
    SELECT * INTO item FROM crest.quote_items WHERE business_id=requested_business AND revision_id=old_r.id AND stable_line_key=(entry->>'stableLineKey')::uuid AND active;
    IF entry->>'authorizationState'='active' THEN
     IF item.id IS NULL OR item.final_cents::text<>entry->>'amountCents' OR item.gross_cents::text<>entry->>'grossInclusiveCents' OR (item.line_discount_cents+item.allocated_discount_cents)::text<>entry->>'discountInclusiveCents' THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
    ELSIF item.id IS NOT NULL OR e.id IS NULL THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
    IF e.id IS NULL THEN
     IF entry->'expectedEntitlementVersionId'<>'null'::jsonb OR entry->'expectedPlanId'<>'null'::jsonb OR entry->>'expectedPlanSequence'<>'0' OR EXISTS(SELECT 1 FROM crest.scope_entitlements WHERE business_id=requested_business AND id=(entry->>'entitlementId')::uuid) OR EXISTS(SELECT 1 FROM crest.scope_allocations WHERE business_id=requested_business AND id=(entry->>'sourceAllocationId')::uuid) OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry->'parts') p WHERE p->>'state'<>'unassigned') THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
    ELSE
     SELECT * INTO prior_v FROM crest.entitlement_versions WHERE business_id=requested_business AND entitlement_id=e.id AND agreement_id=parent.id;
     SELECT * INTO s FROM crest.scope_allocations WHERE business_id=requested_business AND id=(entry->>'sourceAllocationId')::uuid AND entitlement_id=e.id;
     SELECT * INTO prior_plan FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=s.id ORDER BY sequence DESC LIMIT 1;
     IF e.id::text<>entry->>'entitlementId' OR prior_v.id::text IS DISTINCT FROM entry->>'expectedEntitlementVersionId' OR s.id IS NULL OR s.stable_partition_id::text<>entry->>'sourcePartitionId' OR prior_plan.id::text IS DISTINCT FROM entry->>'expectedPlanId' OR coalesce(prior_plan.sequence,0)::text<>entry->>'expectedPlanSequence' OR item.id IS NOT NULL AND ROW(item.vehicle_id,item.job_wide) IS DISTINCT FROM ROW(e.vehicle_id,e.job_wide) THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
     -- Retain all assigned/completed work exactly. Acceptance cannot fabricate
     -- completion, assign a job, or silently re-confirm changed booked scope.
     IF EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current_part WHERE business_id=requested_business AND source_allocation_id=s.id AND allocation_state IN('assigned','completed') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(entry->'parts') p WHERE p->>'partitionId'=current_part.stable_partition_id::text AND p->>'jobId'=current_part.job_id::text AND p->>'state'=current_part.allocation_state AND p->>'grossInclusiveCents'=current_part.gross_inclusive_cents::text AND p->>'discountInclusiveCents'=current_part.discount_inclusive_cents::text AND p->>'amountCents'=current_part.amount_cents::text AND p->>'scopeDescription'=current_part.scope_description))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(entry->'parts') p WHERE p->>'state'<>'unassigned' AND NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current_part WHERE business_id=requested_business AND source_allocation_id=s.id AND p->>'partitionId'=current_part.stable_partition_id::text AND p->>'jobId'=current_part.job_id::text AND p->>'state'=current_part.allocation_state AND p->>'grossInclusiveCents'=current_part.gross_inclusive_cents::text AND p->>'discountInclusiveCents'=current_part.discount_inclusive_cents::text AND p->>'amountCents'=current_part.amount_cents::text AND p->>'scopeDescription'=current_part.scope_description)) THEN reason:='assigned_scope';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM crest.entitlement_versions WHERE business_id=requested_business AND id=(entry->>'entitlementVersionId')::uuid) THEN reason:='identity';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   END LOOP;
   IF (SELECT coalesce(sum((p->>'amountCents')::numeric),0) FROM jsonb_array_elements(request->'scopePlans') p)<>old_r.total_cents::numeric THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1231';END IF;
   INSERT INTO crest.quote_acceptances(id,business_id,family_id,revision_id,send_id,customer_id,lead_id,conversion_id,counterparty_snapshot,content_hash,channel,confirmation_effective_at,evidence_note,request,created_by,updated_by,origin,operation_id,kind) VALUES((request->>'acceptanceId')::uuid,requested_business,old_f.id,old_r.id,sent.id,parent.customer_id,old_f.lead_id,NULL,body->'counterpartySnapshot',old_r.content_hash,body->>'channel',confirmation,body->>'evidenceNote',request,expected_actor,expected_actor,'manual',requested_operation,'amendment') RETURNING * INTO a;
   INSERT INTO crest.agreements(id,business_id,family_id,acceptance_id,customer_id,version_no,parent_agreement_id,total_cents,signed_delta_cents,customer_snapshot,effective_at,created_by,updated_by,origin,operation_id) VALUES((request->>'agreementId')::uuid,requested_business,old_f.id,a.id,parent.customer_id,parent.version_no+1,parent.id,old_r.total_cents,old_r.total_cents-parent.total_cents,old_r.customer_safe_snapshot,confirmation,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO g;
   acceptance_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_acceptances',a.id,1,'accept',NULL,crest_private.quote_acceptances_projection(a));agreement_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'agreements',g.id,1,'accept',NULL,crest_private.agreements_projection(g));audits:=audits||ARRAY[acceptance_event,agreement_event];
   FOR entry IN SELECT value FROM jsonb_array_elements(request->'scopePlans') LOOP
    SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=requested_business AND agreement_family_id=old_f.id AND stable_line_key=(entry->>'stableLineKey')::uuid;
    SELECT * INTO item FROM crest.quote_items WHERE business_id=requested_business AND revision_id=old_r.id AND stable_line_key=(entry->>'stableLineKey')::uuid AND active;
    IF e.id IS NULL THEN
     INSERT INTO crest.scope_entitlements(id,business_id,agreement_family_id,stable_line_key,initial_quote_item_id,vehicle_id,job_wide,created_by,updated_by,origin,operation_id) VALUES((entry->>'entitlementId')::uuid,requested_business,old_f.id,item.stable_line_key,item.id,item.vehicle_id,item.job_wide,expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO e;new_entitlements:=array_append(new_entitlements,e.id);audits:=array_append(audits,crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'scope_entitlements',e.id,1,'accept',NULL,crest_private.scope_entitlements_projection(e)));
    END IF;
    SELECT * INTO prior_v FROM crest.entitlement_versions WHERE business_id=requested_business AND entitlement_id=e.id AND agreement_id=parent.id;
    INSERT INTO crest.entitlement_versions(id,business_id,family_id,entitlement_id,agreement_id,authorized_cents,scope_snapshot,source_quote_item_id,created_by,updated_by,origin,operation_id) VALUES((entry->>'entitlementVersionId')::uuid,requested_business,old_f.id,e.id,g.id,(entry->>'amountCents')::bigint,CASE WHEN item.id IS NULL THEN prior_v.scope_snapshot ELSE item.customer_snapshot END,coalesce(item.id,prior_v.source_quote_item_id),expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO v;versions:=array_append(versions,v.id);audits:=array_append(audits,crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'entitlement_versions',v.id,1,'accept',NULL,crest_private.entitlement_versions_projection(v)));
    SELECT * INTO s FROM crest.scope_allocations WHERE business_id=requested_business AND id=(entry->>'sourceAllocationId')::uuid AND entitlement_id=e.id;
    IF s.id IS NULL THEN
     INSERT INTO crest.scope_allocations(id,business_id,entitlement_id,agreement_id,entitlement_version_id,amount_cents,gross_inclusive_cents,discount_inclusive_cents,stable_partition_id,scope_description,scope_snapshot,allocation_state,created_by,updated_by,origin,operation_id) VALUES((entry->>'sourceAllocationId')::uuid,requested_business,e.id,g.id,v.id,item.final_cents,item.gross_cents,item.line_discount_cents+item.allocated_discount_cents,(entry->>'sourcePartitionId')::uuid,item.customer_snapshot->>'description',item.customer_snapshot,'unassigned',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO s;new_sources:=array_append(new_sources,s.id);audits:=array_append(audits,crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'scope_allocations',s.id,1,'accept',NULL,crest_private.scope_allocations_projection(s)));
    END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,s.id,(entry->>'expectedPlanSequence')::bigint+1,(entry->>'expectedPlanId')::uuid,NULL,expected_actor,requested_operation,v.id,entry->>'authorizationState') RETURNING * INTO plan;plans:=array_append(plans,plan.id);audits:=array_append(audits,crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'allocation_plan_versions',plan.id,1,'accept',NULL,crest_private.allocation_plan_versions_projection(plan)));
    FOR piece IN SELECT value FROM jsonb_array_elements(entry->'parts') LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,plan.id,(piece->>'partitionId')::uuid,(piece->>'jobId')::uuid,piece->>'state',(piece->>'grossInclusiveCents')::bigint,(piece->>'discountInclusiveCents')::bigint,(piece->>'amountCents')::bigint,piece->>'scopeDescription',expected_actor,requested_operation) RETURNING * INTO part;parts:=array_append(parts,part.id);audits:=array_append(audits,crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'allocation_plan_parts',part.id,1,'accept',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   UPDATE crest.quote_revisions SET state='Accepted',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=old_r.id RETURNING * INTO r;
   UPDATE crest.quote_family_commercial_state SET active_offer_id=NULL,current_agreement_id=g.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND family_id=old_f.id RETURNING * INTO control;
   UPDATE crest.quote_families SET version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=old_f.id RETURNING * INTO f;
   family_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_families',f.id,f.version,'accept',crest_private.quote_family_projection(old_f),crest_private.quote_family_projection(f));revision_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_revisions',r.id,r.version,'accept',crest_private.quote_revision_projection(old_r),crest_private.quote_revision_projection(r));control_event:=crest_private.insert_quote_commercial_audit(requested_business,expected_actor,requested_operation,'quote_family_commercial_state',control.id,control.version,'accept',crest_private.quote_family_commercial_state_projection(old_control),crest_private.quote_family_commercial_state_projection(control));audits:=audits||ARRAY[family_event,revision_event,control_event];
   receipt:=jsonb_build_object('schemaVersion',1,'action','amendment_accept','businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'revisionId',r.id,'revisionVersion',r.version::text,'contentVersion',r.content_version::text,'contentHash',r.content_hash,'parentAgreementId',parent.id,'parentAgreementVersion',parent.version_no::text,'parentAcceptedHash',parent_revision.content_hash,'acceptanceId',a.id,'agreementId',g.id,'agreementVersion',g.version_no::text,'customerId',g.customer_id,'approvalId',approval.id,'sendId',sent.id,'commercialStateVersion',control.version::text,'familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'commercialStateAuditEventId',control_event,'acceptanceAuditEventId',acceptance_event,'agreementAuditEventId',agreement_event,'newEntitlementIds',to_jsonb(new_entitlements),'entitlementVersionIds',to_jsonb(versions),'newAllocationIds',to_jsonb(new_sources),'allocationPlanIds',to_jsonb(plans),'allocationPartIds',to_jsonb(parts),'auditEventIds',to_jsonb(audits));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=receipt WHERE business_id=requested_business AND operation_id=requested_operation;
   -- No raw or generic recorded result can substitute for independent original
   -- reconstruction. This dependency deliberately has no placeholder fallback.
   outcome:=crest_private.amendment_accept_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_quote_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN outcome;
 EXCEPTION WHEN SQLSTATE 'P1231' THEN RETURN jsonb_build_object('state','conflict','reason',reason);
 WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated IN('quote_acceptances_pkey','agreements_pkey','scope_entitlements_pkey','entitlement_versions_pkey','scope_allocations_pkey','scope_allocations_business_id_stable_partition_id_key') THEN RETURN jsonb_build_object('state','conflict','reason','identity');END IF;RAISE;
 WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';
 END;
END $accept$;
REVOKE ALL ON FUNCTION crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb) FROM PUBLIC;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-core.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-result.sql
-- UNREGISTERED independent original-result reconstruction. Read-only internal
-- grants only; no new operation claim/write policy, facade or app execution.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR to_regprocedure('crest_private.apply_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)') IS NULL
  OR to_regprocedure('crest_private.amendment_accept_result(uuid,uuid,uuid)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='crest_quote_owner' AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='crest_quote_owner'::regrole OR member='crest_quote_owner'::regrole)
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) acl WHERE r.rolname='crest_quote_owner' AND acl.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) acl WHERE d.defaclrole='crest_quote_owner'::regrole AND acl.grantee<>d.defaclrole)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_owner;
GRANT SELECT ON crest.allocation_plan_versions,crest.allocation_plan_parts TO crest_quote_owner;
GRANT SELECT ON crest.current_scope_allocation_parts TO crest_quote_owner;
CREATE POLICY quote_amendment_plan_read ON crest.allocation_plan_versions FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_amendment_plan_read ON crest.allocation_plan_parts FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY quote_amendment_plan_audits_read ON crest_private.audit_events FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind IN('allocation_plan_versions','allocation_plan_parts'));
GRANT EXECUTE ON FUNCTION crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions),crest_private.allocation_plan_parts_projection(crest.allocation_plan_parts) TO crest_quote_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_private.amendment_accept_child_audit(business uuid,actor uuid,operation uuid,entity text,entity_id uuid,image jsonb) RETURNS uuid LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
DECLARE event uuid;counted bigint;
BEGIN
 IF entity<>ALL(ARRAY['quote_acceptances','agreements','scope_entitlements','entitlement_versions','scope_allocations','allocation_plan_versions','allocation_plan_parts']) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 SELECT (array_agg(audit.id))[1],count(*) INTO event,counted FROM crest_private.audit_events audit WHERE audit.business_id=business AND audit.actor_id=actor AND audit.operation_id=operation AND audit.entity_kind=entity AND audit.entity_id=amendment_accept_child_audit.entity_id AND audit.entity_version=1 AND audit.action='accept' AND audit.delta=jsonb_build_object('schemaVersion',1,'before',NULL,'after',image) AND audit.origin='manual' AND audit.import_row_id IS NULL;
 IF counted<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN event;
END $audit$;
REVOKE ALL ON FUNCTION crest_private.amendment_accept_child_audit(uuid,uuid,uuid,text,uuid,jsonb) FROM PUBLIC;
CREATE FUNCTION crest_private.amendment_accept_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;receipt jsonb;q jsonb;body jsonb;key text;entry jsonb;piece jsonb;parent crest.agreements;parent_r crest.quote_revisions;sent crest.quote_sends;approval crest.quote_approvals;accepted crest.quote_acceptances;agreement crest.agreements;revision crest.quote_revisions;entitlement crest.scope_entitlements;version_row crest.entitlement_versions;prior_version crest.entitlement_versions;source crest.scope_allocations;plan_row crest.allocation_plan_versions;part_row crest.allocation_plan_parts;item crest.quote_items;family_before jsonb;family_after jsonb;revision_before jsonb;revision_after jsonb;control_before jsonb;control_after jsonb;expected jsonb;new_entitlements uuid[]:=ARRAY[]::uuid[];versions uuid[]:=ARRAY[]::uuid[];new_sources uuid[]:=ARRAY[]::uuid[];plans uuid[]:=ARRAY[]::uuid[];parts uuid[]:=ARRAY[]::uuid[];audits uuid[]:=ARRAY[]::uuid[];family_event uuid;revision_event uuid;control_event uuid;acceptance_event uuid;agreement_event uuid;keys text[]:=ARRAY['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','parentAgreementId','parentAgreementVersion','parentAcceptedHash','acceptanceId','agreementId','agreementVersion','customerId','approvalId','sendId','commercialStateVersion','familyAuditEventId','revisionAuditEventId','commercialStateAuditEventId','acceptanceAuditEventId','agreementAuditEventId','newEntitlementIds','entitlementVersionIds','newAllocationIds','allocationPlanIds','allocationPartIds','auditEventIds'];
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='quote.amendment.accept';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;receipt:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt?&keys) OR receipt-keys<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR receipt->>'action' IS DISTINCT FROM 'amendment_accept' OR receipt->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['businessId','familyId','revisionId','parentAgreementId','acceptanceId','agreementId','customerId','approvalId','sendId','familyAuditEventId','revisionAuditEventId','commercialStateAuditEventId','acceptanceAuditEventId','agreementAuditEventId'] LOOP IF NOT crest_private.original_operation_uuid(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['familyVersion','revisionVersion','contentVersion','parentAgreementVersion','agreementVersion','commercialStateVersion'] LOOP IF NOT crest_private.original_operation_version(receipt->key,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;END LOOP;
 SELECT * INTO accepted FROM crest.quote_acceptances WHERE business_id=business AND id=(receipt->>'acceptanceId')::uuid AND family_id=(receipt->>'familyId')::uuid AND revision_id=(receipt->>'revisionId')::uuid AND created_by=actor AND operation_id=operation AND kind='amendment';IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;q:=accepted.request;body:=q->'body';
 IF jsonb_typeof(q) IS DISTINCT FROM 'object' OR NOT(q?&ARRAY['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash','acceptanceId','agreementId','body','scopePlans','expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash']) OR q-ARRAY['schemaVersion','businessId','operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedHash','acceptanceId','agreementId','body','scopePlans','expectedParentAgreementId','expectedParentAgreementVersion','expectedParentAcceptedHash']<>'{}'::jsonb OR octet_length(q::text)>262144 OR q->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR q->>'businessId' IS DISTINCT FROM business::text OR q->>'operationId' IS DISTINCT FROM operation::text OR q->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR q->>'acceptanceId' IS DISTINCT FROM accepted.id::text OR q->>'revisionId' IS DISTINCT FROM accepted.revision_id::text OR q->>'familyId' IS DISTINCT FROM accepted.family_id::text OR crest_private.amendment_scope_plans_valid(q->'scopePlans') IS DISTINCT FROM true OR crest_private.quote_commercial_body_valid('accept',body) IS DISTINCT FROM true OR crest_private.amendment_accept_digest(business,actor,o.recovery_epoch,q) IS DISTINCT FROM o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 SELECT * INTO revision FROM crest.quote_revisions WHERE business_id=business AND family_id=accepted.family_id AND id=accepted.revision_id;
 SELECT * INTO parent FROM crest.agreements WHERE business_id=business AND family_id=accepted.family_id AND id=(q->>'expectedParentAgreementId')::uuid AND customer_id=accepted.customer_id;
 SELECT r.* INTO parent_r FROM crest.quote_acceptances parent_a JOIN crest.quote_revisions r ON r.business_id=parent_a.business_id AND r.family_id=parent_a.family_id AND r.id=parent_a.revision_id WHERE parent_a.business_id=business AND parent_a.id=parent.acceptance_id AND parent_a.customer_id=parent.customer_id;
 SELECT * INTO sent FROM crest.quote_sends WHERE business_id=business AND family_id=accepted.family_id AND revision_id=accepted.revision_id AND id=accepted.send_id;
 SELECT * INTO approval FROM crest.quote_approvals WHERE business_id=business AND family_id=accepted.family_id AND revision_id=accepted.revision_id AND id=sent.approval_id;
 SELECT * INTO agreement FROM crest.agreements WHERE business_id=business AND family_id=accepted.family_id AND acceptance_id=accepted.id AND id=(q->>'agreementId')::uuid AND created_by=actor AND operation_id=operation;
 IF revision.id IS NULL OR parent.id IS NULL OR parent_r.id IS NULL OR sent.id IS NULL OR approval.id IS NULL OR agreement.id IS NULL OR revision.kind<>'amendment' OR revision.state<>'Accepted' OR revision.parent_agreement_id<>parent.id OR revision.content_hash IS DISTINCT FROM q->>'expectedHash' OR revision.content_hash<>accepted.content_hash OR encode(sha256(convert_to(revision.canonical_content,'UTF8')),'hex')<>revision.content_hash OR revision.content_version::text IS DISTINCT FROM q->>'expectedContentVersion' OR parent.version_no::text IS DISTINCT FROM q->>'expectedParentAgreementVersion' OR parent_r.content_hash IS DISTINCT FROM q->>'expectedParentAcceptedHash' OR parent_r.state<>'Accepted'
  OR accepted.customer_id::text IS DISTINCT FROM body->>'customerId' OR accepted.send_id::text IS DISTINCT FROM body->>'sendId' OR accepted.conversion_id IS NOT NULL OR body->'conversionId' IS DISTINCT FROM 'null'::jsonb OR accepted.counterparty_snapshot IS DISTINCT FROM body->'counterpartySnapshot' OR accepted.channel IS DISTINCT FROM body->>'channel' OR accepted.evidence_note IS DISTINCT FROM body->>'evidenceNote' OR to_char(accepted.confirmation_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') IS DISTINCT FROM body->>'confirmationEffectiveAt' OR accepted.confirmation_effective_at<approval.reviewed_at OR accepted.confirmation_effective_at>accepted.recorded_at OR revision.expiry_at IS NOT NULL AND accepted.recorded_at>=revision.expiry_at
  OR approval.approved_content_version<>revision.content_version OR approval.approved_content_hash<>revision.content_hash OR approval.customer_representation IS DISTINCT FROM revision.customer_safe_snapshot OR approval.presentation_hash<>sent.presentation_hash OR agreement.customer_id<>accepted.customer_id OR agreement.parent_agreement_id<>parent.id OR agreement.version_no::numeric<>parent.version_no::numeric+1 OR agreement.total_cents<>revision.total_cents OR agreement.signed_delta_cents<>agreement.total_cents-parent.total_cents OR agreement.customer_snapshot IS DISTINCT FROM revision.customer_safe_snapshot OR agreement.effective_at<>accepted.confirmation_effective_at
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 family_event:=(receipt->>'familyAuditEventId')::uuid;revision_event:=(receipt->>'revisionAuditEventId')::uuid;control_event:=(receipt->>'commercialStateAuditEventId')::uuid;
 SELECT delta->'before',delta->'after' INTO family_before,family_after FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=operation AND id=family_event AND entity_kind='quote_families' AND entity_id=accepted.family_id AND entity_version=(receipt->>'familyVersion')::bigint AND action='accept';
 SELECT delta->'before',delta->'after' INTO revision_before,revision_after FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=operation AND id=revision_event AND entity_kind='quote_revisions' AND entity_id=accepted.revision_id AND entity_version=(receipt->>'revisionVersion')::bigint AND action='accept';
 SELECT delta->'before',delta->'after' INTO control_before,control_after FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=operation AND id=control_event AND entity_kind='quote_family_commercial_state' AND entity_id=accepted.family_id AND entity_version=(receipt->>'commercialStateVersion')::bigint AND action='accept';
 IF jsonb_typeof(family_before) IS DISTINCT FROM 'object' OR jsonb_typeof(revision_before) IS DISTINCT FROM 'object' OR jsonb_typeof(control_before) IS DISTINCT FROM 'object' OR family_before->>'id' IS DISTINCT FROM accepted.family_id::text OR family_after->>'id' IS DISTINCT FROM accepted.family_id::text OR control_before->>'id' IS DISTINCT FROM accepted.family_id::text OR control_after->>'id' IS DISTINCT FROM accepted.family_id::text OR family_before->>'version' IS DISTINCT FROM q->>'expectedFamilyVersion' OR revision_before->>'version' IS DISTINCT FROM q->>'expectedRevisionVersion' OR revision_before->>'state' IS DISTINCT FROM 'Sent' OR revision_after IS DISTINCT FROM crest_private.quote_revision_projection(revision) OR revision_after->>'version' IS DISTINCT FROM receipt->>'revisionVersion'
  OR family_after-ARRAY['version','updated_at','updated_by','operation_id'] IS DISTINCT FROM family_before-ARRAY['version','updated_at','updated_by','operation_id'] OR (family_after->>'version')::numeric<>(family_before->>'version')::numeric+1 OR revision_after-ARRAY['version','state','updated_at','updated_by','operation_id'] IS DISTINCT FROM revision_before-ARRAY['version','state','updated_at','updated_by','operation_id'] OR (revision_after->>'version')::numeric<>(revision_before->>'version')::numeric+1
  OR control_before->>'active_offer_id' IS DISTINCT FROM revision.id::text OR control_before->>'current_agreement_id' IS DISTINCT FROM parent.id::text OR control_before->'initial_acceptance_id' IS NULL OR control_before->'initial_acceptance_id'='null'::jsonb OR control_after->'active_offer_id' IS DISTINCT FROM 'null'::jsonb OR control_after->>'current_agreement_id' IS DISTINCT FROM agreement.id::text OR (control_after->>'version')::numeric<>(control_before->>'version')::numeric+1 OR control_after-ARRAY['active_offer_id','current_agreement_id','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM control_before-ARRAY['active_offer_id','current_agreement_id','version','updated_at','updated_by','operation_id']
  OR accepted.lead_id::text IS DISTINCT FROM family_after->>'lead_id' OR NOT EXISTS(SELECT 1 FROM crest.quote_families WHERE business_id=business AND id=accepted.family_id AND version>=(receipt->>'familyVersion')::bigint) OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state WHERE business_id=business AND family_id=accepted.family_id AND version>=(receipt->>'commercialStateVersion')::bigint)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['business_id','updated_by','operation_id'] LOOP IF family_after->>key IS DISTINCT FROM(CASE key WHEN 'business_id' THEN business WHEN 'updated_by' THEN actor ELSE operation END)::text OR revision_after->>key IS DISTINCT FROM family_after->>key OR control_after->>key IS DISTINCT FROM family_after->>key THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;END LOOP;
 acceptance_event:=crest_private.amendment_accept_child_audit(business,actor,operation,'quote_acceptances',accepted.id,crest_private.quote_acceptances_projection(accepted));agreement_event:=crest_private.amendment_accept_child_audit(business,actor,operation,'agreements',agreement.id,crest_private.agreements_projection(agreement));audits:=ARRAY[acceptance_event,agreement_event];
 FOR entry IN SELECT value FROM jsonb_array_elements(q->'scopePlans') LOOP
  SELECT * INTO entitlement FROM crest.scope_entitlements WHERE business_id=business AND agreement_family_id=accepted.family_id AND id=(entry->>'entitlementId')::uuid AND stable_line_key=(entry->>'stableLineKey')::uuid;
  SELECT * INTO item FROM crest.quote_items WHERE business_id=business AND revision_id=revision.id AND stable_line_key=(entry->>'stableLineKey')::uuid AND active;
  SELECT * INTO version_row FROM crest.entitlement_versions WHERE business_id=business AND family_id=accepted.family_id AND entitlement_id=entitlement.id AND id=(entry->>'entitlementVersionId')::uuid AND agreement_id=agreement.id AND operation_id=operation AND created_by=actor;
  SELECT * INTO prior_version FROM crest.entitlement_versions WHERE business_id=business AND entitlement_id=entitlement.id AND agreement_id=parent.id;
  SELECT * INTO source FROM crest.scope_allocations WHERE business_id=business AND id=(entry->>'sourceAllocationId')::uuid AND entitlement_id=entitlement.id AND stable_partition_id=(entry->>'sourcePartitionId')::uuid;
  SELECT * INTO plan_row FROM crest.allocation_plan_versions WHERE business_id=business AND source_allocation_id=source.id AND operation_id=operation AND created_by=actor;
  IF entitlement.id IS NULL OR version_row.id IS NULL OR source.id IS NULL OR plan_row.id IS NULL OR version_row.authorized_cents::text IS DISTINCT FROM entry->>'amountCents' OR plan_row.entitlement_version_id<>version_row.id OR plan_row.authorization_state IS DISTINCT FROM entry->>'authorizationState' OR plan_row.sequence::numeric<>(entry->>'expectedPlanSequence')::numeric+1 OR plan_row.replaces_id::text IS DISTINCT FROM entry->>'expectedPlanId' OR prior_version.id::text IS DISTINCT FROM entry->>'expectedEntitlementVersionId' OR plan_row.reason IS NOT NULL
   OR entry->>'authorizationState'='active' AND(item.id IS NULL OR version_row.authorized_cents<>item.final_cents OR item.gross_cents::text IS DISTINCT FROM entry->>'grossInclusiveCents' OR (item.line_discount_cents+item.allocated_discount_cents)::text IS DISTINCT FROM entry->>'discountInclusiveCents' OR version_row.scope_snapshot IS DISTINCT FROM item.customer_snapshot OR version_row.source_quote_item_id<>item.id OR entitlement.vehicle_id IS DISTINCT FROM item.vehicle_id OR entitlement.job_wide<>item.job_wide)
   OR entry->>'authorizationState'='withdrawn' AND(item.id IS NOT NULL OR prior_version.id IS NULL OR version_row.authorized_cents<>0 OR version_row.source_quote_item_id<>prior_version.source_quote_item_id OR version_row.scope_snapshot IS DISTINCT FROM prior_version.scope_snapshot)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
  IF entitlement.operation_id=operation THEN
   IF prior_version.id IS NOT NULL OR entitlement.created_by<>actor OR entitlement.initial_quote_item_id<>item.id OR source.operation_id<>operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;new_entitlements:=array_append(new_entitlements,entitlement.id);audits:=array_append(audits,crest_private.amendment_accept_child_audit(business,actor,operation,'scope_entitlements',entitlement.id,crest_private.scope_entitlements_projection(entitlement)));
  ELSIF prior_version.id IS NULL OR source.operation_id=operation THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
  versions:=array_append(versions,version_row.id);audits:=array_append(audits,crest_private.amendment_accept_child_audit(business,actor,operation,'entitlement_versions',version_row.id,crest_private.entitlement_versions_projection(version_row)));
  IF source.operation_id=operation THEN
   IF source.created_by<>actor OR source.agreement_id<>agreement.id OR source.entitlement_version_id<>version_row.id OR source.amount_cents<>item.final_cents OR source.gross_inclusive_cents<>item.gross_cents OR source.discount_inclusive_cents<>item.line_discount_cents+item.allocated_discount_cents OR source.scope_snapshot IS DISTINCT FROM item.customer_snapshot OR source.scope_description IS DISTINCT FROM item.customer_snapshot->>'description' OR source.job_id IS NOT NULL OR source.allocation_state<>'unassigned' OR source.replaces_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;new_sources:=array_append(new_sources,source.id);audits:=array_append(audits,crest_private.amendment_accept_child_audit(business,actor,operation,'scope_allocations',source.id,crest_private.scope_allocations_projection(source)));
  END IF;
  plans:=array_append(plans,plan_row.id);audits:=array_append(audits,crest_private.amendment_accept_child_audit(business,actor,operation,'allocation_plan_versions',plan_row.id,crest_private.allocation_plan_versions_projection(plan_row)));
  FOR piece IN SELECT value FROM jsonb_array_elements(entry->'parts') LOOP
   SELECT * INTO part_row FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=plan_row.id AND stable_partition_id=(piece->>'partitionId')::uuid AND operation_id=operation AND created_by=actor;
   IF part_row.id IS NULL OR part_row.job_id::text IS DISTINCT FROM piece->>'jobId' OR part_row.allocation_state IS DISTINCT FROM piece->>'state' OR part_row.gross_inclusive_cents::text IS DISTINCT FROM piece->>'grossInclusiveCents' OR part_row.discount_inclusive_cents::text IS DISTINCT FROM piece->>'discountInclusiveCents' OR part_row.amount_cents::text IS DISTINCT FROM piece->>'amountCents' OR part_row.scope_description IS DISTINCT FROM piece->>'scopeDescription' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
   IF part_row.allocation_state<>'unassigned' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=business AND prior_part.plan_id=plan_row.replaces_id AND prior_part.stable_partition_id=part_row.stable_partition_id AND ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description) IS NOT DISTINCT FROM ROW(part_row.job_id,part_row.allocation_state,part_row.gross_inclusive_cents,part_row.discount_inclusive_cents,part_row.amount_cents,part_row.scope_description)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
   parts:=array_append(parts,part_row.id);audits:=array_append(audits,crest_private.amendment_accept_child_audit(business,actor,operation,'allocation_plan_parts',part_row.id,crest_private.allocation_plan_parts_projection(part_row)));
  END LOOP;
  IF (SELECT count(*) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=plan_row.id)<>jsonb_array_length(entry->'parts')
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts current_part JOIN crest.allocation_plan_parts other_part ON other_part.business_id=current_part.business_id AND other_part.stable_partition_id=current_part.stable_partition_id JOIN crest.allocation_plan_versions other_plan ON other_plan.business_id=other_part.business_id AND other_plan.id=other_part.plan_id WHERE current_part.business_id=business AND current_part.plan_id=plan_row.id AND other_plan.source_allocation_id<>source.id)
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts current_part JOIN crest.scope_allocations other_source ON other_source.business_id=current_part.business_id AND other_source.stable_partition_id=current_part.stable_partition_id WHERE current_part.business_id=business AND current_part.plan_id=plan_row.id AND other_source.id<>source.id)
   OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=business AND prior_part.plan_id=plan_row.replaces_id AND prior_part.allocation_state IN('assigned','completed') AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts next_part WHERE next_part.business_id=business AND next_part.plan_id=plan_row.id AND next_part.stable_partition_id=prior_part.stable_partition_id AND ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description) IS NOT DISTINCT FROM ROW(next_part.job_id,next_part.allocation_state,next_part.gross_inclusive_cents,next_part.discount_inclusive_cents,next_part.amount_cents,next_part.scope_description))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 END LOOP;
 IF cardinality(new_entitlements)<>(SELECT count(*) FROM crest.scope_entitlements WHERE business_id=business AND operation_id=operation) OR cardinality(versions)<>(SELECT count(*) FROM crest.entitlement_versions WHERE business_id=business AND operation_id=operation) OR cardinality(new_sources)<>(SELECT count(*) FROM crest.scope_allocations WHERE business_id=business AND operation_id=operation) OR cardinality(plans)<>(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation) OR cardinality(parts)<>(SELECT count(*) FROM crest.allocation_plan_parts WHERE business_id=business AND operation_id=operation)
  OR (SELECT count(*) FROM crest.quote_acceptances WHERE business_id=business AND operation_id=operation)<>1 OR (SELECT count(*) FROM crest.agreements WHERE business_id=business AND operation_id=operation)<>1 OR EXISTS(SELECT 1 FROM crest.entitlement_versions prior_scope WHERE prior_scope.business_id=business AND prior_scope.agreement_id=parent.id AND NOT EXISTS(SELECT 1 FROM crest.entitlement_versions ev WHERE ev.business_id=business AND ev.entitlement_id=prior_scope.entitlement_id AND ev.agreement_id=agreement.id))
  OR (SELECT coalesce(sum(authorized_cents::numeric),0) FROM crest.entitlement_versions WHERE business_id=business AND agreement_id=agreement.id)<>agreement.total_cents::numeric OR (SELECT count(*) FROM crest.quote_items WHERE business_id=business AND revision_id=revision.id AND active)<>(SELECT count(*) FROM jsonb_array_elements(q->'scopePlans') p WHERE p->>'authorizationState'='active')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 audits:=audits||ARRAY[family_event,revision_event,control_event];IF cardinality(audits)<>(SELECT count(DISTINCT id) FROM unnest(audits) id) OR cardinality(audits)<>(SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 expected:=jsonb_build_object('schemaVersion',1,'action','amendment_accept','businessId',business,'familyId',accepted.family_id,'familyVersion',family_after->>'version','revisionId',revision.id,'revisionVersion',revision_after->>'version','contentVersion',revision.content_version::text,'contentHash',revision.content_hash,'parentAgreementId',parent.id,'parentAgreementVersion',parent.version_no::text,'parentAcceptedHash',parent_r.content_hash,'acceptanceId',accepted.id,'agreementId',agreement.id,'agreementVersion',agreement.version_no::text,'customerId',agreement.customer_id,'approvalId',approval.id,'sendId',sent.id,'commercialStateVersion',control_after->>'version','familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'commercialStateAuditEventId',control_event,'acceptanceAuditEventId',acceptance_event,'agreementAuditEventId',agreement_event,'newEntitlementIds',to_jsonb(new_entitlements),'entitlementVersionIds',to_jsonb(versions),'newAllocationIds',to_jsonb(new_sources),'allocationPlanIds',to_jsonb(plans),'allocationPartIds',to_jsonb(parts),'auditEventIds',to_jsonb(audits));
 IF expected IS DISTINCT FROM receipt THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';
END $result$;
REVOKE ALL ON FUNCTION crest_private.amendment_accept_result(uuid,uuid,uuid) FROM PUBLIC;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-result.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-closure.sql
-- UNREGISTERED complete acceptance command/integrity construction.
-- Exact registered52 predecessor bodies are pinned below. No owner migration,
-- production/finance activation or application HTTP route is introduced.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52 OR to_regprocedure('crest_private.amendment_accept_result(uuid,uuid,uuid)') IS NULL OR to_regprocedure('crest_commands.accept_quote_amendment_confirmation(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,jsonb)') IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner','crest_booking_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4 OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole,'crest_booking_integrity_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole,'crest_booking_integrity_owner'::regrole)) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner','crest_booking_integrity_owner') AND a.grantee<>r.oid) OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole,'crest_booking_integrity_owner'::regrole) AND a.grantee<>d.defaclrole) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.authorize_booking_statement()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='bdc564576bec43654ab70b462af58221465c8b3dabcfd4385773304850ef0152') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_booking_row()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='1c532f712523e82d9210bd4e2e3d12a6fafebaabd7c2e24ca1bb6c74bdbfe4d3') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_row_audit()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='2ef479c8f6f183d9e287071515e5416f56e5e314cf9973f0141cdaab8c324cfe') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_plan()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='7878215d65c79004d51044a16b977e37320cab0514a99419cd1e4fa63ff01b8a') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_quote_commercial()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='3d76d9b2e40fba6248d73a83e10498e8fd9bf978464d7528601553d1779cc28e') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.validate_quote_revision_change()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='351637586c8ea8445e6d4d6e8bf7b91c74fce6a0b219296c5581ef8029d2eda4') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_audit()') AND proowner='crest_quote_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='a240b109f88748f73abeae3493b51e8271ee6e16d58d6b8db20a80b22970dcb9') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_commercial_row()') AND proowner='crest_quote_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='7d71eb2a059269890c0a0fae3b2d11c18ae8c56556cf9a9991e945db6e347512') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_commercial_operation_result(uuid,uuid,uuid)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='d253e4d7e962cd6d97c3e6162559772d66bdd6a6ed96a1b19acd04d4e0b61ce7') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_CLOSURE_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_quote_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner,crest_booking_integrity_owner;
CREATE POLICY amendment_accept_operation_read ON crest_private.operations FOR SELECT TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.amendment.accept');
CREATE POLICY amendment_accept_operation_create ON crest_private.operations FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='quote.amendment.accept' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY amendment_accept_operation_finish ON crest_private.operations FOR UPDATE TO crest_quote_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.amendment.accept') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='quote.amendment.accept' AND schema_version=1);
CREATE POLICY amendment_accept_operation_integrity ON crest_private.operations FOR SELECT TO crest_quote_integrity_owner,crest_booking_integrity_owner USING(command_type='quote.amendment.accept' AND schema_version=1);
GRANT INSERT ON crest.allocation_plan_versions,crest.allocation_plan_parts TO crest_quote_owner;
CREATE POLICY amendment_accept_plan_create ON crest.allocation_plan_versions FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
CREATE POLICY amendment_accept_plan_create ON crest.allocation_plan_parts FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
CREATE POLICY amendment_accept_plan_audit_create ON crest_private.audit_events FOR INSERT TO crest_quote_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind IN('allocation_plan_versions','allocation_plan_parts') AND origin='manual' AND import_row_id IS NULL);
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
GRANT EXECUTE ON FUNCTION crest_private.amendment_accept_result(uuid,uuid,uuid) TO crest_quote_integrity_owner,crest_booking_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE kind text;
BEGIN
 IF current_user='crest_quote_owner' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') THEN
  SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
  IF kind IS DISTINCT FROM 'quote.amendment.accept' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND schema_version=1 AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations') OR kind='operations.job.reschedule' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_booking_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE stamp timestamptz:=clock_timestamp();actor uuid;operation uuid;kind text;
BEGIN
 actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 IF actor IS NULL OR operation IS NULL OR NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM operation OR NEW.origin<>'manual' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL;
 IF kind='quote.amendment.accept' AND NOT(TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF kind IS NULL OR kind NOT IN('operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ACTOR_REQUIRED';END IF;NEW.created_at:=stamp;
  IF TG_TABLE_NAME='jobs' THEN IF kind<>'operations.job.book' OR NEW.version<>1 OR NEW.updated_by<>actor OR NEW.state<>'scheduled' OR NEW.first_work_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.completion_outcome IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;NEW.updated_at:=stamp;END IF;
 ELSE
  IF TG_TABLE_NAME<>'jobs' OR ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.operator_actor_id,NEW.created_at,NEW.created_by,NEW.origin) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.operator_actor_id,OLD.created_at,OLD.created_by,OLD.origin) OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR OLD.state<>'scheduled' OR OLD.first_work_at IS NOT NULL OR ROW(NEW.first_work_at,NEW.completed_at,NEW.completion_outcome) IS DISTINCT FROM ROW(OLD.first_work_at,OLD.completed_at,OLD.completion_outcome) OR NOT(kind='operations.job.reschedule' AND NEW.state='scheduled' OR kind='operations.job.cancel' AND NEW.state='cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;
  NEW.updated_at:=stamp;
  IF kind='operations.job.cancel' AND ROW(NEW.fulfillment_mode,NEW.mode_version_id,NEW.work_address_id,NEW.work_location_snapshot) IS DISTINCT FROM ROW(OLD.fulfillment_mode,OLD.mode_version_id,OLD.work_address_id,OLD.work_location_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SOURCE_RETAINED';END IF;
 END IF;
 RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_row_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE b uuid;entity uuid;actor uuid;operation uuid;revision bigint;verb text;before_row jsonb:='null'::jsonb;after_row jsonb:='null'::jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME<>'schedule_reservations' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_HISTORY_RETAINED';END IF;
  b:=OLD.business_id;entity:=OLD.id;actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;revision:=2;verb:='release';
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;
 ELSE
  b:=NEW.business_id;entity:=NEW.id;operation:=NEW.operation_id;verb:=CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'revise' END;
  IF TG_TABLE_NAME='jobs' THEN actor:=NEW.updated_by;revision:=NEW.version;ELSE actor:=NEW.created_by;revision:=1;END IF;
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO after_row USING NEW;
  IF TG_OP='UPDATE' THEN EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=b AND operation_id=operation AND actor_id=actor AND command_type='quote.amendment.accept' AND schema_version=1) THEN verb:='accept';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=b AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=entity AND a.entity_version=revision AND a.action=verb AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row) AND a.origin='manual' AND a.import_row_id IS NULL AND o.state='committed' AND o.schema_version=1 AND o.result_schema_version=1 AND o.origin='manual' AND o.import_row_id IS NULL AND (o.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') OR o.command_type='quote.amendment.accept' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) AND(TG_OP<>'DELETE' OR o.command_type IN('operations.job.reschedule','operations.job.cancel')))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_AUDIT_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE p crest.allocation_plan_versions;s crest.scope_allocations;e crest.scope_entitlements;kind text;part_count bigint;gross numeric;discount numeric;amount numeric;
BEGIN
 IF TG_TABLE_NAME='allocation_plan_versions' THEN SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.id;
 ELSE SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.plan_id;END IF;
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=p.business_id AND id=s.entitlement_id;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=p.business_id AND operation_id=p.operation_id AND actor_id=p.created_by;
 SELECT count(*),coalesce(sum(gross_inclusive_cents::numeric),0),coalesce(sum(discount_inclusive_cents::numeric),0),coalesce(sum(amount_cents::numeric),0) INTO part_count,gross,discount,amount FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id;
 IF kind='quote.amendment.accept' THEN
  IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR p.entitlement_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM crest.entitlement_versions v JOIN crest.quote_family_commercial_state active ON active.business_id=v.business_id AND active.family_id=v.family_id AND active.current_agreement_id=v.agreement_id WHERE v.business_id=p.business_id AND v.id=p.entitlement_version_id AND v.entitlement_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_BINDING_REQUIRED';END IF;
  IF crest_private.amendment_accept_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR kind IS NULL OR kind NOT IN('operations.job.book','operations.job.cancel') OR part_count=0 OR gross<>s.gross_inclusive_cents OR discount<>s.discount_inclusive_cents OR amount<>s.amount_cents
  OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state c WHERE c.business_id=p.business_id AND c.family_id=e.agreement_family_id AND c.current_agreement_id=s.agreement_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(a.operation_id<>p.operation_id OR a.created_by<>p.created_by))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_TOTAL_REQUIRED';END IF;
 IF kind='operations.job.book' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.allocation_state='assigned' AND j.operation_id=p.operation_id AND j.state='scheduled')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_NEW_SCOPE_REQUIRED';END IF;
 -- Cancellation changes state, not the previously explicit money or scope.
 IF kind='operations.job.cancel' AND(p.replaces_id IS NULL
  OR EXISTS(SELECT 1 FROM(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.replaces_id) prior_part FULL JOIN(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id) next ON next.stable_partition_id=prior_part.stable_partition_id
    WHERE prior_part.id IS NULL OR next.id IS NULL OR ROW(next.job_id,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
       OR next.allocation_state IS DISTINCT FROM prior_part.allocation_state AND NOT(prior_part.allocation_state='assigned' AND next.allocation_state='cancelled' AND EXISTS(SELECT 1 FROM crest.jobs j WHERE j.business_id=prior_part.business_id AND j.id=prior_part.job_id AND j.state='cancelled' AND j.operation_id=p.operation_id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SCOPE_RETAINED';END IF;
 -- Stable partition identity cannot migrate into another entitlement's source.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.allocation_plan_parts other ON other.business_id=a.business_id AND other.stable_partition_id=a.stable_partition_id JOIN crest.allocation_plan_versions previous ON previous.business_id=other.business_id AND previous.id=other.plan_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND previous.source_allocation_id<>p.source_allocation_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.scope_allocations original ON original.business_id=a.business_id AND original.stable_partition_id=a.stable_partition_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND original.id<>p.source_allocation_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PARTITION_IDENTITY_REQUIRED';END IF;
 -- A zero-dollar source/partition cannot disappear merely because the total
 -- remains zero. Preserve its original identity through explicit allocations.
 IF p.replaces_id IS NULL AND s.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=s.stable_partition_id)
  OR p.replaces_id IS NOT NULL AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=prior_part.stable_partition_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ZERO_IDENTITY_REQUIRED';END IF;
 -- Every assigned partition has the accepted customer's actual job and vehicle.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.agreements agreement ON agreement.business_id=s.business_id AND agreement.id=s.agreement_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(j.customer_id<>agreement.customer_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id AND v.vehicle_id=e.vehicle_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_BINDING_REQUIRED';END IF;
 -- Existing assigned work stays intact when booking another visit; completed
 -- scope and active physical work cannot be moved by any booking command.
 IF p.replaces_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts prior_part JOIN crest.jobs j ON j.business_id=prior_part.business_id AND j.id=prior_part.job_id
  LEFT JOIN crest.allocation_plan_parts next ON next.business_id=prior_part.business_id AND next.plan_id=p.id AND next.stable_partition_id=prior_part.stable_partition_id
  WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND(
   prior_part.allocation_state='completed' OR j.state IN('en_route','in_progress','paused') OR prior_part.allocation_state='assigned' AND j.state='scheduled' AND kind='operations.job.book'
  ) AND ROW(next.job_id,next.allocation_state,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ASSIGNED_SCOPE_RETAINED';END IF;
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a LEFT JOIN crest.allocation_plan_parts prior_part ON prior_part.business_id=a.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.stable_partition_id=a.stable_partition_id LEFT JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(
  a.allocation_state='completed' AND(prior_part.id IS NULL OR prior_part.allocation_state<>'completed' OR ROW(a.job_id,a.gross_inclusive_cents,a.discount_inclusive_cents,a.amount_cents,a.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description))
  OR a.allocation_state='assigned' AND(prior_part.id IS NULL OR prior_part.job_id IS DISTINCT FROM a.job_id OR prior_part.allocation_state IS DISTINCT FROM 'assigned') AND(kind<>'operations.job.book' OR j.operation_id<>p.operation_id OR j.state<>'scheduled')
  OR a.allocation_state='cancelled' AND(prior_part.id IS NULL OR prior_part.allocation_state IS DISTINCT FROM 'cancelled') AND(kind<>'operations.job.cancel' OR j.operation_id<>p.operation_id OR j.state<>'cancelled')
 )) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_STATE_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_quote_commercial()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$ DECLARE stamp timestamptz:=clock_timestamp();BEGIN IF TG_OP='INSERT' THEN NEW.created_at:=stamp;IF NEW.version<>1 OR NEW.created_by<>NEW.updated_by THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_HISTORY_REQUIRED';END IF;ELSE IF TG_TABLE_NAME<>'quote_family_commercial_state' OR ROW(NEW.id,NEW.business_id,NEW.family_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.family_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) OR NEW.version<>OLD.version+1 OR (OLD.initial_acceptance_id IS NOT NULL AND (NEW.initial_acceptance_id IS DISTINCT FROM OLD.initial_acceptance_id OR NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND schema_version=1 AND (command_type='quote.amendment.send' AND NEW.current_agreement_id IS NOT DISTINCT FROM OLD.current_agreement_id OR command_type='quote.amendment.accept' AND NEW.current_agreement_id IS DISTINCT FROM OLD.current_agreement_id)))) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_QUOTE_COMMERCIAL_HISTORY_RETAINED';END IF;END IF;NEW.updated_at:=stamp;IF TG_TABLE_NAME='quote_sends' THEN NEW.confirmed_at:=stamp;ELSIF TG_TABLE_NAME='quote_acceptances' THEN NEW.recorded_at:=stamp;END IF;RETURN NEW;END $function$
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
  OR NEW.customer_safe_snapshot->>'currency' IS DISTINCT FROM 'USD' OR NEW.customer_safe_snapshot->'schemaVersion' NOT IN('1'::jsonb,'2'::jsonb)
  OR NEW.customer_safe_snapshot->>'totalCents' IS DISTINCT FROM NEW.total_cents::text OR NEW.customer_safe_snapshot->>'timezone' IS DISTINCT FROM NEW.timezone
  OR NEW.customer_safe_snapshot->>'expiryAt' IS DISTINCT FROM (CASE WHEN NEW.expiry_at IS NULL THEN NULL ELSE to_char(NEW.expiry_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_SNAPSHOT_CONFLICT';END IF;
 IF NEW.kind='amendment' AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.internal_snapshot->'sources') s JOIN crest.scope_entitlements e ON e.business_id=NEW.business_id AND e.agreement_family_id=NEW.family_id AND e.stable_line_key=(s->>'stableLineKey')::uuid WHERE e.vehicle_id IS DISTINCT FROM (s->>'vehicleId')::uuid OR e.job_wide IS DISTINCT FROM (s->>'jobWide')::boolean) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_SCOPE_IDENTITY_RETAINED';END IF;
 IF TG_OP='UPDATE' AND NEW.canonical_content=OLD.canonical_content THEN
  IF NOT crest_private.quote_review_ready(jsonb_build_object('customer',NEW.customer_safe_snapshot,'internal',NEW.internal_snapshot,'canonical',NEW.canonical_content)) OR NOT EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=NEW.business_id AND o.operation_id=NEW.operation_id AND o.actor_id=NEW.updated_by AND o.command_type=(CASE WHEN OLD.state='Draft' THEN 'quote.review.submit' ELSE 'quote.review.approve' END) AND o.schema_version=1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_REVIEW_REQUIRED';END IF;
 END IF;NEW.updated_at:=stamp;RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
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
 IF kind IN('quote_families','quote_revisions') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept')) THEN
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=CASE WHEN kind='quote_families' THEN 'quote_revisions' ELSE 'quote_families' END AND (kind='quote_families' AND a.delta->'after'->>'family_id'=NEW.id::text OR kind='quote_revisions' AND a.entity_id::text=(to_jsonb(NEW)->>'family_id'))) INTO published;
 END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=kind AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action=(CASE o.command_type WHEN 'quote.review.submit' THEN 'submit' WHEN 'quote.review.approve' THEN 'approve' WHEN 'quote.manual.send' THEN 'send' WHEN 'quote.amendment.send' THEN 'send' WHEN 'quote.amendment.accept' THEN 'accept' WHEN 'quote.confirmation.accept' THEN 'accept' ELSE CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END END) AND a.delta->'before'=prior AND a.delta->'after'=following
   AND (o.command_type IN('quote.draft.save','quote.replacement.create') AND o.schema_version IN(1,2) OR o.command_type='quote.amendment.create' AND o.schema_version=3 OR o.command_type IN('quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept') AND o.schema_version=1 AND kind IN('quote_families','quote_revisions') AND TG_OP='UPDATE') AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_commercial_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$ DECLARE image jsonb;prior jsonb:='null'::jsonb;o crest_private.operations;receipt jsonb;member boolean;BEGIN
 CASE TG_TABLE_NAME
 WHEN 'quote_family_commercial_state' THEN image:=crest_private.quote_family_commercial_state_projection(NEW::crest.quote_family_commercial_state);IF TG_OP='UPDATE' THEN prior:=crest_private.quote_family_commercial_state_projection(OLD::crest.quote_family_commercial_state);END IF;
 WHEN 'quote_sends' THEN image:=crest_private.quote_sends_projection(NEW::crest.quote_sends);
 WHEN 'quote_acceptances' THEN image:=crest_private.quote_acceptances_projection(NEW::crest.quote_acceptances);
 WHEN 'agreements' THEN image:=crest_private.agreements_projection(NEW::crest.agreements);
 WHEN 'scope_entitlements' THEN image:=crest_private.scope_entitlements_projection(NEW::crest.scope_entitlements);
 WHEN 'entitlement_versions' THEN image:=crest_private.entitlement_versions_projection(NEW::crest.entitlement_versions);
 WHEN 'scope_allocations' THEN image:=crest_private.scope_allocations_projection(NEW::crest.scope_allocations);
 ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END CASE;
 IF EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type='quote.amendment.accept' AND schema_version=1) THEN
  receipt:=crest_private.amendment_accept_result(NEW.business_id,NEW.updated_by,NEW.operation_id)->'receipt';
  member:=CASE TG_TABLE_NAME WHEN 'quote_family_commercial_state' THEN TG_OP='UPDATE' AND receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text WHEN 'quote_acceptances' THEN TG_OP='INSERT' AND receipt->>'acceptanceId'=NEW.id::text WHEN 'agreements' THEN TG_OP='INSERT' AND receipt->>'agreementId'=NEW.id::text WHEN 'scope_entitlements' THEN TG_OP='INSERT' AND receipt->'newEntitlementIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'entitlement_versions' THEN TG_OP='INSERT' AND receipt->'entitlementVersionIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'scope_allocations' THEN TG_OP='INSERT' AND receipt->'newAllocationIds' @> to_jsonb(ARRAY[NEW.id]) ELSE false END;
  IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action='accept' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type='quote.amendment.send' AND schema_version=1) THEN
  receipt:=crest_private.amendment_send_result(NEW.business_id,NEW.updated_by,NEW.operation_id)->'receipt';
  member:=CASE WHEN TG_TABLE_NAME='quote_sends' AND TG_OP='INSERT' THEN receipt->>'sendId'=NEW.id::text WHEN TG_TABLE_NAME='quote_family_commercial_state' AND TG_OP='UPDATE' THEN receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text ELSE false END;
  IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action='send' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_SEND_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;
 END IF;
 SELECT command_type,result,schema_version,state INTO o.command_type,o.result,o.schema_version,o.state FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept') AND schema_version=1 AND state='committed';IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;receipt:=o.result;
 member:=CASE TG_TABLE_NAME WHEN 'quote_family_commercial_state' THEN receipt->>'familyId'=NEW.id::text AND receipt->>'commercialStateVersion'=NEW.version::text WHEN 'quote_sends' THEN receipt->>'action'='send' AND receipt->>'sendId'=NEW.id::text WHEN 'quote_acceptances' THEN receipt->>'acceptanceId'=NEW.id::text WHEN 'agreements' THEN receipt->>'agreementId'=NEW.id::text WHEN 'scope_entitlements' THEN receipt->'entitlementIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'entitlement_versions' THEN receipt->'entitlementVersionIds' @> to_jsonb(ARRAY[NEW.id]) WHEN 'scope_allocations' THEN receipt->'allocationIds' @> to_jsonb(ARRAY[NEW.id]) ELSE false END;
 IF member IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=NEW.business_id AND actor_id=NEW.updated_by AND operation_id=NEW.operation_id AND entity_kind=TG_TABLE_NAME AND entity_id=NEW.id AND entity_version=NEW.version AND action=receipt->>'action' AND delta->'before'=prior AND delta->'after'=image) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_private.quote_commercial_operation_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations;receipt jsonb;verb text;keys text[]:=ARRAY['schemaVersion','action','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','commercialStateVersion','commercialStateAuditEventId','approvalId','sendId','sendAuditEventId','acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId','entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds','leadId','leadVersion','leadEventId','leadAuditEventId','leadEventAuditEventId','supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'];key text;family_before jsonb;family_after jsonb;revision_before jsonb;revision_after jsonb;state_before jsonb;state_after jsonb;source_body jsonb;digest text;source_one uuid;source_two uuid;sent crest.quote_sends;accepted crest.quote_acceptances;agreement crest.agreements;approval crest.quote_approvals;entitlement crest.scope_entitlements;ent_version crest.entitlement_versions;allocation crest.scope_allocations;item crest.quote_items;lead_event crest.lead_events;lead_before jsonb;lead_after jsonb;event_image jsonb;expected_state text;expected_effective timestamptz;current_audits uuid[];n integer:=0;i integer;source_count bigint;sup_before jsonb;sup_after jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('quote.manual.send','quote.confirmation.accept');IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 receipt:=o.result;verb:=CASE o.command_type WHEN 'quote.manual.send' THEN 'send' ELSE 'accept' END;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt?&keys) OR receipt-keys<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR receipt->>'action' IS DISTINCT FROM verb OR receipt->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['businessId','familyId','revisionId','familyAuditEventId','revisionAuditEventId','commercialStateAuditEventId','approvalId','sendId','sendAuditEventId'] LOOP IF NOT crest_private.original_operation_uuid(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 FOREACH key IN ARRAY ARRAY['familyVersion','revisionVersion','contentVersion','commercialStateVersion'] LOOP IF NOT crest_private.original_operation_version(receipt->key,false) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 IF jsonb_typeof(receipt->'contentHash') IS DISTINCT FROM 'string' OR (receipt->>'contentHash')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 FOREACH key IN ARRAY ARRAY['entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] LOOP IF jsonb_typeof(receipt->key) IS DISTINCT FROM 'array' OR jsonb_array_length(receipt->key)>1000 OR EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->key) v WHERE NOT crest_private.original_operation_uuid(v)) OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(receipt->key) v)<>jsonb_array_length(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 family_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'familyAuditEventId')::uuid,'quote_families',(receipt->>'familyId')::uuid,(receipt->>'familyVersion')::bigint,verb);
 revision_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'revisionAuditEventId')::uuid,'quote_revisions',(receipt->>'revisionId')::uuid,(receipt->>'revisionVersion')::bigint,verb);
 state_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'commercialStateAuditEventId')::uuid,'quote_family_commercial_state',(receipt->>'familyId')::uuid,(receipt->>'commercialStateVersion')::bigint,verb);
 SELECT delta->'before' INTO family_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'familyAuditEventId')::uuid;SELECT delta->'before' INTO revision_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'revisionAuditEventId')::uuid;SELECT delta->'before' INTO state_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'commercialStateAuditEventId')::uuid;
 IF jsonb_typeof(family_before) IS DISTINCT FROM 'object' OR jsonb_typeof(revision_before) IS DISTINCT FROM 'object' OR family_after->>'id' IS DISTINCT FROM receipt->>'familyId' OR family_after->>'business_id' IS DISTINCT FROM business::text OR family_after->>'version' IS DISTINCT FROM receipt->>'familyVersion' OR family_after->>'updated_by' IS DISTINCT FROM actor::text OR family_after->>'operation_id' IS DISTINCT FROM operation::text OR (family_after->>'version')::numeric<>(family_before->>'version')::numeric+1 OR family_after-ARRAY['version','updated_at','updated_by','operation_id'] IS DISTINCT FROM family_before-ARRAY['version','updated_at','updated_by','operation_id']
 OR revision_after->>'id' IS DISTINCT FROM receipt->>'revisionId' OR revision_after->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR revision_after->>'business_id' IS DISTINCT FROM business::text OR revision_after->>'version' IS DISTINCT FROM receipt->>'revisionVersion' OR revision_after->>'updated_by' IS DISTINCT FROM actor::text OR revision_after->>'operation_id' IS DISTINCT FROM operation::text OR (revision_after->>'version')::numeric<>(revision_before->>'version')::numeric+1 OR revision_after-ARRAY['state','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM revision_before-ARRAY['state','version','updated_at','updated_by','operation_id'] OR revision_after->>'content_version' IS DISTINCT FROM receipt->>'contentVersion' OR revision_after->>'content_hash' IS DISTINCT FROM receipt->>'contentHash' OR encode(sha256(convert_to(revision_after->>'canonical_content','UTF8')),'hex') IS DISTINCT FROM receipt->>'contentHash'
 OR state_after->>'business_id' IS DISTINCT FROM business::text OR state_after->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR state_after->>'id' IS DISTINCT FROM receipt->>'familyId' OR state_after->>'version' IS DISTINCT FROM receipt->>'commercialStateVersion' OR state_after->>'updated_by' IS DISTINCT FROM actor::text OR state_after->>'operation_id' IS DISTINCT FROM operation::text OR (state_after->>'version')::numeric<>(CASE WHEN state_before='null'::jsonb THEN 1 ELSE (state_before->>'version')::numeric+1 END)
 OR NOT EXISTS(SELECT 1 FROM crest.quote_families WHERE business_id=business AND id=(receipt->>'familyId')::uuid AND version>=(receipt->>'familyVersion')::bigint) OR NOT EXISTS(SELECT 1 FROM crest.quote_revisions WHERE business_id=business AND family_id=(receipt->>'familyId')::uuid AND id=(receipt->>'revisionId')::uuid AND version>=(receipt->>'revisionVersion')::bigint)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO sent FROM crest.quote_sends WHERE business_id=business AND id=(receipt->>'sendId')::uuid AND family_id=(receipt->>'familyId')::uuid AND revision_id=(receipt->>'revisionId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO approval FROM crest.quote_approvals WHERE business_id=business AND id=sent.approval_id AND id=(receipt->>'approvalId')::uuid AND family_id=sent.family_id AND revision_id=sent.revision_id AND approved_content_version=(receipt->>'contentVersion')::bigint AND approved_content_hash=receipt->>'contentHash' AND customer_representation=revision_after->'customer_safe_snapshot' AND presentation_hash=sent.presentation_hash;
 IF NOT FOUND OR NOT crest_private.quote_commercial_body_valid('send',sent.request) OR sent.request IS DISTINCT FROM jsonb_build_object('channel',sent.channel,'recipientSnapshot',sent.recipient_snapshot,'evidenceNote',sent.evidence_note,'confirmedActualSharing',true,'presentationHash',sent.presentation_hash,'replacesRevisionId',sent.replaces_revision_id) OR sent.lead_id::text IS DISTINCT FROM family_after->>'lead_id' OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'sendAuditEventId')::uuid AND entity_kind='quote_sends' AND entity_id=sent.id AND entity_version=1 AND action='send' AND operation_id=sent.operation_id AND actor_id=sent.created_by AND delta->'before'='null'::jsonb AND delta->'after'=crest_private.quote_sends_projection(sent)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 current_audits:=ARRAY[(receipt->>'familyAuditEventId')::uuid,(receipt->>'revisionAuditEventId')::uuid,(receipt->>'commercialStateAuditEventId')::uuid];
 IF verb='send' THEN
  IF sent.operation_id<>operation OR sent.created_by<>actor OR revision_before->>'state' NOT IN('Ready for Review','Sent') OR revision_after->>'state'<>'Sent' OR family_after->>'current_revision_id' IS DISTINCT FROM receipt->>'revisionId' OR state_after->>'active_offer_id' IS DISTINCT FROM receipt->>'revisionId' OR state_after->'initial_acceptance_id'<>'null'::jsonb OR state_after->'current_agreement_id'<>'null'::jsonb OR state_before<>'null'::jsonb AND state_before->'initial_acceptance_id'<>'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  FOREACH key IN ARRAY ARRAY['acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  FOREACH key IN ARRAY ARRAY['entitlementIds','entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] LOOP IF receipt->key IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  source_body:=sent.request;source_one:=sent.id;source_two:=approval.id;current_audits:=current_audits||(receipt->>'sendAuditEventId')::uuid;
  IF sent.replaces_revision_id IS NOT NULL THEN
   IF state_before->>'active_offer_id' IS DISTINCT FROM sent.replaces_revision_id::text OR receipt->>'supersededRevisionId' IS DISTINCT FROM sent.replaces_revision_id::text OR NOT crest_private.original_operation_version(receipt->'supersededRevisionVersion',false) OR NOT crest_private.original_operation_uuid(receipt->'supersededRevisionAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   sup_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'supersededRevisionAuditEventId')::uuid,'quote_revisions',sent.replaces_revision_id,(receipt->>'supersededRevisionVersion')::bigint,'send');SELECT delta->'before' INTO sup_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'supersededRevisionAuditEventId')::uuid;
   IF sup_before->>'state'<>'Sent' OR sup_after->>'state'<>'Superseded' OR sup_after->>'family_id' IS DISTINCT FROM receipt->>'familyId' OR (sup_after->>'version')::numeric<>(sup_before->>'version')::numeric+1 OR sup_after-ARRAY['state','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM sup_before-ARRAY['state','version','updated_at','updated_by','operation_id'] THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;current_audits:=current_audits||(receipt->>'supersededRevisionAuditEventId')::uuid;
  ELSE
   IF state_before<>'null'::jsonb AND state_before->>'active_offer_id' IS NOT NULL AND state_before->>'active_offer_id' IS DISTINCT FROM receipt->>'revisionId' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   FOREACH key IN ARRAY ARRAY['supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  END IF;
  expected_state:='quote_sent';expected_effective:=sent.confirmed_at;
 ELSE
  FOREACH key IN ARRAY ARRAY['acceptanceId','acceptanceAuditEventId','agreementId','agreementAuditEventId','customerId'] LOOP IF NOT crest_private.original_operation_uuid(receipt->key) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  SELECT * INTO accepted FROM crest.quote_acceptances WHERE business_id=business AND id=(receipt->>'acceptanceId')::uuid AND send_id=sent.id AND family_id=sent.family_id AND revision_id=sent.revision_id AND customer_id=(receipt->>'customerId')::uuid AND created_by=actor AND operation_id=operation;
  IF NOT FOUND OR accepted.content_hash IS DISTINCT FROM receipt->>'contentHash' OR accepted.lead_id::text IS DISTINCT FROM family_after->>'lead_id' OR accepted.confirmation_effective_at<approval.reviewed_at OR accepted.confirmation_effective_at>accepted.recorded_at OR revision_after->>'expiry_at' IS NOT NULL AND (revision_after->>'expiry_at')::timestamptz<=accepted.recorded_at OR NOT crest_private.quote_commercial_body_valid('accept',accepted.request) OR accepted.request IS DISTINCT FROM jsonb_build_object('sendId',sent.id,'customerId',accepted.customer_id,'conversionId',accepted.conversion_id,'channel',accepted.channel,'counterpartySnapshot',accepted.counterparty_snapshot,'confirmationEffectiveAt',to_char(accepted.confirmation_effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'evidenceNote',accepted.evidence_note,'confirmedExactTerms',true)
   OR family_after->>'customer_id' IS NOT NULL AND family_after->>'customer_id' IS DISTINCT FROM accepted.customer_id::text OR family_after->>'customer_id' IS NULL AND (accepted.conversion_id IS NULL OR accepted.lead_id IS NULL) OR accepted.conversion_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.lead_conversions WHERE business_id=business AND id=accepted.conversion_id AND lead_id=accepted.lead_id AND customer_id=accepted.customer_id)
   OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'acceptanceAuditEventId')::uuid,'quote_acceptances',accepted.id,1,'accept') IS DISTINCT FROM crest_private.quote_acceptances_projection(accepted)
  THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO agreement FROM crest.agreements WHERE business_id=business AND id=(receipt->>'agreementId')::uuid AND acceptance_id=accepted.id AND family_id=sent.family_id AND customer_id=accepted.customer_id AND operation_id=operation AND created_by=actor;
  IF NOT FOUND OR agreement.version_no<>1 OR agreement.parent_agreement_id IS NOT NULL OR agreement.total_cents::text IS DISTINCT FROM revision_after->>'total_cents' OR agreement.signed_delta_cents<>agreement.total_cents OR agreement.customer_snapshot IS DISTINCT FROM revision_after->'customer_safe_snapshot' OR agreement.effective_at<>accepted.confirmation_effective_at OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'agreementAuditEventId')::uuid,'agreements',agreement.id,1,'accept') IS DISTINCT FROM crest_private.agreements_projection(agreement)
   OR revision_before->>'state'<>'Sent' OR revision_after->>'state'<>'Accepted' OR state_before->>'active_offer_id' IS DISTINCT FROM receipt->>'revisionId' OR state_before->'initial_acceptance_id' IS DISTINCT FROM 'null'::jsonb OR state_after->'active_offer_id' IS DISTINCT FROM 'null'::jsonb OR state_after->>'initial_acceptance_id' IS DISTINCT FROM accepted.id::text OR state_after->>'current_agreement_id' IS DISTINCT FROM agreement.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  FOREACH key IN ARRAY ARRAY['supersededRevisionId','supersededRevisionVersion','supersededRevisionAuditEventId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  n:=jsonb_array_length(receipt->'entitlementIds');FOREACH key IN ARRAY ARRAY['entitlementVersionIds','allocationIds','entitlementAuditEventIds','entitlementVersionAuditEventIds','allocationAuditEventIds'] LOOP IF jsonb_array_length(receipt->key)<>n THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
  IF n=0 OR n<>jsonb_array_length(revision_after->'customer_safe_snapshot'->'lines') OR n<>(SELECT count(*) FROM crest.scope_entitlements WHERE business_id=business AND agreement_family_id=sent.family_id AND operation_id=operation AND created_by=actor) OR n<>(SELECT count(*) FROM crest.entitlement_versions WHERE business_id=business AND agreement_id=agreement.id) OR n<>(SELECT count(*) FROM crest.scope_allocations WHERE business_id=business AND agreement_id=agreement.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  i:=0;FOR item IN SELECT * FROM crest.quote_items WHERE business_id=business AND revision_id=sent.revision_id AND active ORDER BY position LOOP
   SELECT * INTO entitlement FROM crest.scope_entitlements WHERE business_id=business AND id=(receipt->'entitlementIds'->>i)::uuid AND agreement_family_id=sent.family_id AND operation_id=operation AND created_by=actor;
   IF NOT FOUND OR entitlement.stable_line_key<>item.stable_line_key OR entitlement.initial_quote_item_id<>item.id OR entitlement.vehicle_id IS DISTINCT FROM item.vehicle_id OR entitlement.job_wide<>item.job_wide OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->'entitlementAuditEventIds'->>i)::uuid,'scope_entitlements',entitlement.id,1,'accept') IS DISTINCT FROM crest_private.scope_entitlements_projection(entitlement) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   SELECT * INTO ent_version FROM crest.entitlement_versions WHERE business_id=business AND id=(receipt->'entitlementVersionIds'->>i)::uuid AND entitlement_id=entitlement.id AND agreement_id=agreement.id AND family_id=sent.family_id AND operation_id=operation AND created_by=actor;
   IF NOT FOUND OR ent_version.source_quote_item_id<>item.id OR ent_version.authorized_cents<>item.final_cents OR ent_version.scope_snapshot IS DISTINCT FROM item.customer_snapshot OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->'entitlementVersionAuditEventIds'->>i)::uuid,'entitlement_versions',ent_version.id,1,'accept') IS DISTINCT FROM crest_private.entitlement_versions_projection(ent_version) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   SELECT * INTO allocation FROM crest.scope_allocations WHERE business_id=business AND id=(receipt->'allocationIds'->>i)::uuid AND entitlement_version_id=ent_version.id AND entitlement_id=entitlement.id AND agreement_id=agreement.id AND operation_id=operation AND created_by=actor;
   IF NOT FOUND OR allocation.amount_cents<>item.final_cents OR allocation.gross_inclusive_cents<>item.gross_cents OR allocation.discount_inclusive_cents::numeric<>item.line_discount_cents::numeric+item.allocated_discount_cents::numeric OR allocation.scope_snapshot IS DISTINCT FROM item.customer_snapshot OR allocation.scope_description IS DISTINCT FROM item.customer_snapshot->>'description' OR allocation.allocation_state<>'unassigned' OR allocation.job_id IS NOT NULL OR allocation.replaces_id IS NOT NULL OR crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->'allocationAuditEventIds'->>i)::uuid,'scope_allocations',allocation.id,1,'accept') IS DISTINCT FROM crest_private.scope_allocations_projection(allocation) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
   current_audits:=current_audits||ARRAY[(receipt->'entitlementAuditEventIds'->>i)::uuid,(receipt->'entitlementVersionAuditEventIds'->>i)::uuid,(receipt->'allocationAuditEventIds'->>i)::uuid];i:=i+1;
  END LOOP;
  IF i<>n OR (SELECT sum(authorized_cents::numeric) FROM crest.entitlement_versions WHERE business_id=business AND agreement_id=agreement.id)<>agreement.total_cents::numeric OR (SELECT sum(amount_cents::numeric) FROM crest.scope_allocations WHERE business_id=business AND agreement_id=agreement.id)<>agreement.total_cents::numeric THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  current_audits:=current_audits||ARRAY[(receipt->>'acceptanceAuditEventId')::uuid,(receipt->>'agreementAuditEventId')::uuid];source_body:=accepted.request;source_one:=accepted.id;source_two:=agreement.id;expected_state:='won';expected_effective:=accepted.confirmation_effective_at;
 END IF;
 IF family_after->>'lead_id' IS NULL THEN
  FOREACH key IN ARRAY ARRAY['leadId','leadVersion','leadEventId','leadAuditEventId','leadEventAuditEventId'] LOOP IF receipt->key IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;END LOOP;
 ELSE
  IF receipt->>'leadId' IS DISTINCT FROM family_after->>'lead_id' OR NOT crest_private.original_operation_version(receipt->'leadVersion',false) OR NOT crest_private.original_operation_uuid(receipt->'leadEventId') OR NOT crest_private.original_operation_uuid(receipt->'leadAuditEventId') OR NOT crest_private.original_operation_uuid(receipt->'leadEventAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  SELECT * INTO lead_event FROM crest.lead_events WHERE business_id=business AND id=(receipt->>'leadEventId')::uuid AND lead_id=(receipt->>'leadId')::uuid AND lead_version=(receipt->>'leadVersion')::bigint AND operation_id=operation AND created_by=actor;
  IF NOT FOUND OR lead_event.to_state<>expected_state OR lead_event.effective_at<>expected_effective OR lead_event.quote_send_id IS DISTINCT FROM (CASE WHEN verb='send' THEN sent.id ELSE NULL END) OR lead_event.acceptance_id IS DISTINCT FROM accepted.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  lead_after:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'leadAuditEventId')::uuid,'leads',lead_event.lead_id,lead_event.lead_version,'state_change');SELECT delta->'before' INTO lead_before FROM crest_private.audit_events WHERE business_id=business AND id=(receipt->>'leadAuditEventId')::uuid;
  event_image:=crest_private.quote_commercial_audit_image(business,actor,operation,(receipt->>'leadEventAuditEventId')::uuid,'lead_events',lead_event.id,1,'create');
  IF event_image IS DISTINCT FROM crest_private.lead_event_projection(lead_event) OR lead_after->>'state' IS DISTINCT FROM lead_event.to_state OR lead_before->>'state' IS DISTINCT FROM lead_event.from_state OR lead_after->>'version' IS DISTINCT FROM lead_event.lead_version::text OR (lead_before->>'version')::numeric+1<>lead_event.lead_version OR lead_after-ARRAY['state','lost_reason','version','updated_at','updated_by','operation_id'] IS DISTINCT FROM lead_before-ARRAY['state','lost_reason','version','updated_at','updated_by','operation_id'] OR lead_after->'lost_reason' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
  current_audits:=current_audits||ARRAY[(receipt->>'leadAuditEventId')::uuid,(receipt->>'leadEventAuditEventId')::uuid];
 END IF;
 digest:=crest_private.quote_commercial_digest(business,actor,o.recovery_epoch,verb,(receipt->>'familyId')::uuid,(receipt->>'revisionId')::uuid,(family_before->>'version')::bigint,(revision_before->>'version')::bigint,(receipt->>'contentVersion')::bigint,receipt->>'contentHash',source_one,source_two,source_body);
 IF digest IS DISTINCT FROM o.payload_hash OR cardinality(current_audits)<>(SELECT count(DISTINCT x) FROM unnest(current_audits) x) OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation)<>cardinality(current_audits) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',receipt);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_COMMERCIAL_RESULT_REVIEW_REQUIRED';
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE FUNCTION crest_private.check_quote_amendment_accept_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE original jsonb;retained_job crest.jobs;retained_appointment crest.appointments;
BEGIN
 IF NEW.command_type<>'quote.amendment.accept' THEN RETURN NULL;END IF;
 PERFORM set_config('crest.business_id',NEW.business_id::text,true),set_config('crest.actor_id',NEW.actor_id::text,true),set_config('crest.operation_id',NEW.operation_id::text,true);
 original:=crest_private.amendment_accept_result(NEW.business_id,NEW.actor_id,NEW.operation_id);
 IF NEW.schema_version<>1 OR original->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;
 -- The command does not book or reschedule. Preserve the already confirmed
 -- slot and its source history; do not re-evaluate historical CRM snapshots or
 -- old conflict acknowledgements against unrelated later bookings.
 FOR retained_job IN SELECT DISTINCT j.* FROM crest.allocation_plan_parts p JOIN crest.jobs j ON j.business_id=p.business_id AND j.id=p.job_id WHERE p.business_id=NEW.business_id AND p.operation_id=NEW.operation_id LOOP
  IF retained_job.customer_id IS DISTINCT FROM(original->'receipt'->>'customerId')::uuid OR retained_job.operation_id=NEW.operation_id OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations old_operation ON old_operation.business_id=a.business_id AND old_operation.operation_id=a.operation_id AND old_operation.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.entity_kind='jobs' AND a.entity_id=retained_job.id AND a.entity_version=retained_job.version AND a.operation_id=retained_job.operation_id AND a.actor_id=retained_job.updated_by AND a.delta->'after'=crest_private.jobs_projection(retained_job) AND old_operation.state='committed' AND old_operation.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_JOB_REQUIRED';END IF;
  SELECT * INTO retained_appointment FROM crest.appointments WHERE business_id=NEW.business_id AND id=retained_job.current_appointment_id AND job_id=retained_job.id;
  IF retained_appointment.id IS NULL OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts part JOIN crest.scope_entitlements e ON e.business_id=part.business_id AND e.id=part.entitlement_id JOIN crest.quote_family_commercial_state control ON control.business_id=e.business_id AND control.family_id=e.agreement_family_id WHERE part.business_id=NEW.business_id AND part.job_id=retained_job.id AND (part.agreement_id IS DISTINCT FROM control.current_agreement_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=NEW.business_id AND encounter.job_id=retained_job.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles vehicle WHERE vehicle.business_id=NEW.business_id AND vehicle.job_id=retained_job.id AND vehicle.vehicle_id=e.vehicle_id))) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CONFIRMED_SCOPE_REQUIRED';END IF;
  IF retained_job.state='scheduled' THEN
   IF retained_appointment.confirmation_state<>'confirmed' OR retained_job.first_work_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state='assigned') OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state<>'assigned') OR NOT EXISTS(SELECT 1 FROM crest.schedule_reservations reservation WHERE reservation.business_id=NEW.business_id AND reservation.job_id=retained_job.id AND reservation.appointment_id=retained_appointment.id AND reservation.operator_actor_id=retained_job.operator_actor_id AND reservation.blocked_interval=tstzrange(retained_appointment.start_at-coalesce(retained_appointment.travel_before_seconds,0)*interval '1 second',retained_appointment.end_at+coalesce(retained_appointment.travel_after_seconds,0)*interval '1 second','[)')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_RETAINED_SLOT_REQUIRED';END IF;
  ELSIF retained_job.state='cancelled' THEN
   IF retained_appointment.confirmation_state<>'cancelled' OR EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts WHERE business_id=NEW.business_id AND job_id=retained_job.id AND allocation_state<>'cancelled') OR EXISTS(SELECT 1 FROM crest.schedule_reservations WHERE business_id=NEW.business_id AND job_id=retained_job.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLATION_REQUIRED';END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_FIELD_IMPLEMENTATION_REQUIRED';END IF;
 END LOOP;
 RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_quote_amendment_accept_operation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_amendment_accept_operation() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_amendment_accept_result AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_quote_amendment_accept_operation();
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_commands.accept_quote_amendment_confirmation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ SELECT crest_private.apply_quote_amendment_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) $$;
CREATE FUNCTION crest_commands.lookup_quote_amendment_acceptance(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$ BEGIN IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_ACCEPT_INPUT_REQUIRED';END IF;PERFORM crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id',expected_actor::text,true),set_config('crest.operation_id','',true);RETURN crest_private.amendment_accept_result(requested_business,expected_actor,requested_operation);END $$;
REVOKE ALL ON FUNCTION crest_commands.accept_quote_amendment_confirmation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),crest_commands.lookup_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.accept_quote_amendment_confirmation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,jsonb),crest_commands.lookup_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_quote_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner,crest_booking_integrity_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-closure.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-acceptance-originals.sql
-- UNREGISTERED acceptance original-reference composition after the full closure.
-- Reuses the exact unique operation claim, fresh authority and immutable audited
-- retirement. No route, new grant, retry or release of an absent lookup.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52 OR to_regprocedure('crest_commands.lookup_quote_amendment_acceptance(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.original_operation_reference_valid(jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='c764d24c6092b365402c14f474bf67f5c32a3ab946abe43e7d3232412cdb0fc3')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4ad7fd691b4657eb2d554633a4c71758a5dbda76195897b1e13fe508c8237866')
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_ACCEPT_ORIGINAL_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.original_operation_reference_valid(v jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 IF kind='quote.amendment.accept' THEN
  keys:=ARRAY['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId','sendId','customerId','expectedParentAgreementId','expectedParentAgreementVersion'];
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
  FOREACH key IN ARRAY keys LOOP
   IF key IN('expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedParentAgreementVersion') THEN
    IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
   ELSIF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;
  END LOOP;
  RETURN coalesce((r->>'expectedFamilyVersion')::numeric<9223372036854775807 AND (r->>'expectedRevisionVersion')::numeric<9223372036854775807 AND (r->>'expectedParentAgreementVersion')::numeric<9223372036854775807 AND (r->>'expectedContentVersion')::numeric<=(r->>'expectedRevisionVersion')::numeric AND r->>'agreementId'<>r->>'expectedParentAgreementId',false);
 END IF;
 IF kind IN('quote.amendment.create','quote.amendment.send') THEN
  keys:=ARRAY['operationId','recoveryEpoch','familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedParentAgreementId','expectedParentAgreementVersion']||(CASE WHEN kind='quote.amendment.send' THEN ARRAY['expectedContentVersion','sendId','approvalId','replacesRevisionId'] ELSE ARRAY[]::text[] END);
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
  FOREACH key IN ARRAY keys LOOP
   IF key IN('expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','expectedParentAgreementVersion') THEN
    IF NOT crest_private.original_operation_version(r->key,kind='quote.amendment.create' AND key='expectedRevisionVersion') THEN RETURN false;END IF;
   ELSIF key<>'replacesRevisionId' AND NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;
  END LOOP;
  IF (r->>'expectedFamilyVersion')::numeric>=9223372036854775807 THEN RETURN false;END IF;
  IF kind='quote.amendment.create' THEN RETURN r->>'expectedRevisionVersion'='0' AND (r->>'expectedParentAgreementVersion')::numeric<9223372036854775807;END IF;
  RETURN coalesce((r->>'expectedRevisionVersion')::numeric<9223372036854775807 AND (r->>'expectedContentVersion')::numeric<=(r->>'expectedRevisionVersion')::numeric AND (r->'replacesRevisionId'='null'::jsonb OR crest_private.original_operation_uuid(r->'replacesRevisionId') AND r->>'replacesRevisionId'<>r->>'revisionId'),false);
 END IF;
 keys:=CASE kind
  WHEN 'bookkeeping.expense.save' THEN ARRAY['expenseId','expectedRevision']
  WHEN 'bookkeeping.receipt.reserve' THEN ARRAY['receiptId','expenseId','expenseRevision','expectedRevision']
  WHEN 'bookkeeping.receipt.publish' THEN ARRAY['receiptId','expenseId','expenseRevision','expectedRevision']
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
  WHEN 'operations.appointment_hold.save' THEN ARRAY['holdId','expectedSequence']
  WHEN 'quote.draft.save' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion']
  WHEN 'quote.review.submit' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion']
  WHEN 'quote.review.approve' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','approvalId']
 WHEN 'quote.manual.send' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','sendId','approvalId']
 WHEN 'quote.confirmation.accept' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion','acceptanceId','agreementId']
 WHEN 'operations.fulfillment_modes.initialize' THEN ARRAY['expectedSequence']
 WHEN 'operations.fulfillment_modes.save' THEN ARRAY['expectedSequence']
 WHEN 'operations.job.book' THEN ARRAY['jobId','expectedModeSequence']
 WHEN 'operations.job.cancel' THEN ARRAY['jobId','expectedJobVersion']
 WHEN 'operations.job.reschedule' THEN ARRAY['jobId','expectedJobVersion','action','latestAppointmentId']
 WHEN 'quote.replacement.create' THEN ARRAY['familyId','revisionId','expectedFamilyVersion','expectedRevisionVersion'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key='expectedJobVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key IN ('expectedSequence','expectedModeSequence','expectedVersion','expectedRevision','expectedFamilyVersion','expectedRevisionVersion','expectedContentVersion') THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state','quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept')) THEN RETURN false;END IF;
  ELSIF key='expenseRevision' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 IF kind='quote.replacement.create' AND (r->>'expectedFamilyVersion'='0' OR r->>'expectedRevisionVersion'<>'0') THEN RETURN false;END IF;
 IF kind='quote.draft.save' AND ((r->>'expectedFamilyVersion'='0')<>(r->>'expectedRevisionVersion'='0')) THEN RETURN false;END IF;
 IF kind='bookkeeping.receipt.reserve' AND r->>'expectedRevision'<>'0' OR kind='bookkeeping.receipt.publish' AND r->>'expectedRevision'<>'1' THEN RETURN false;END IF;
 IF kind='operations.job.reschedule' AND NOT coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN('propose','confirm','withdraw'),false) THEN RETURN false;END IF;
 IF kind='operations.fulfillment_modes.save' AND r->>'expectedSequence'='0' THEN RETURN false;END IF;
 IF kind='operations.fulfillment_modes.initialize' AND r->>'expectedSequence'<>'0' THEN RETURN false;END IF;
 RETURN true;
END $function$
;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-acceptance-originals.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-booking-commands.sql
-- UNREGISTERED bound-version booking/cancellation after acceptance closure.
-- Version1 remains supported; version2 records explicit current entitlement
-- observations. No fee/refund/posting, route or owner upgrade is enabled.
DO $review$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.validate_booking_reservation()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='d45d9d3a640240d01da9f3beb749bed7c86a1e664376e36379af82764d6b38d5')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_fulfillment_mode_audit()') AND proowner='crest_mode_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='9b274eafa3f1550b11bd725a110a345b11c38d7ab4ea6dc33fbc6aba53667ba3')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.book_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='3e0dfb68312aa691b1b56a32233c9c0ae6ae83860af169a89c6e07aba50d8ef5')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.cancel_scheduled_job(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,bigint,jsonb)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='f5adbe387750c19c45731027f626be05c0e1e7dbb82ac273183e24ca25e5c707')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.authorize_booking_statement()') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4bc28b0224d3ecf7671e9f34a0e2ecc894deafa03a49bbaf7ce6f63d6bf26028')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.stamp_booking_row()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='e6a901bb89cd46d0b2ce832288c34ebdf0c5ef76abdf9e29f6ea6c30748f07cb')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_row_audit()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='73165396c5497008eab3d3ba8237dcb3665bf6988f391a5faf47c24c742d4307')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_booking_plan()') AND proowner='crest_booking_integrity_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='ba15dc5cccba69d9ce701fe02f3c35484ad5fb386e2a2c60144c818a0b5a4216')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.booked_job_operation_result(uuid,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='9837f614ac8d0c0ec49a5d2a54d4823749af1ff98b6d469ea5ed6a7f3461dd28')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.cancelled_job_operation_result(uuid,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='5c14d9ce8713f25aaf35055ec8264c87cc79f4adf93790cac8346d48f3581aa6')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.operation_retirement_result(uuid,uuid,jsonb)') AND proowner='crest_schema_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='4ad7fd691b4657eb2d554633a4c71758a5dbda76195897b1e13fe508c8237866')
  OR(SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_mode_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_booking_owner','crest_booking_integrity_owner','crest_mode_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDED_BOOKING_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT INSERT(entitlement_version_id,authorization_state) ON crest.allocation_plan_versions TO crest_booking_owner;
CREATE POLICY amended_booking_operation_create ON crest_private.operations FOR INSERT TO crest_booking_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.job.book','operations.job.cancel') AND schema_version=2 AND origin='manual' AND import_row_id IS NULL);
GRANT CREATE ON SCHEMA crest_commands TO crest_booking_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.book_job(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_job uuid, expected_mode_sequence bigint, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;mode crest.fulfillment_mode_versions;customer crest.customers;vehicle crest.vehicles;association crest.customer_vehicles;control crest.operator_controls;j crest.jobs;a crest.appointments;jv crest.job_vehicles;encounter crest.job_encounters;p crest.allocation_plan_versions;part crest.allocation_plan_parts;override_row crest.schedule_overrides;conflict_row crest.schedule_override_conflicts;reservation crest.schedule_reservations;event crest.job_events;source_row crest.scope_allocations;source_entitlement crest.scope_entitlements;bound_version crest.entitlement_versions;prior_plan crest.allocation_plan_versions;input_vehicle jsonb;input_plan jsonb;input_part jsonb;slot jsonb;review jsonb;family uuid;conflicting uuid;actual_conflicts uuid[];expected_conflicts uuid[];unknown_travel boolean;blocked tstzrange;current_sequence bigint;reason text;job_audit uuid;audit_ids jsonb:='[]'::jsonb;plan_ids jsonb:='[]'::jsonb;original jsonb;command_result jsonb;review_snapshot jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema=2 AND (SELECT encode(sha256(convert_to(string_agg(catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname,E'\n' ORDER BY (catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace catalog_n JOIN pg_class catalog_c ON catalog_c.relnamespace=catalog_n.oid JOIN pg_attribute catalog_a ON catalog_a.attrelid=catalog_c.oid WHERE catalog_n.nspname='crest' AND catalog_c.relkind IN('r','p') AND catalog_a.attnum>0 AND NOT catalog_a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDED_BOOKING_SCHEMA_REVIEW_REQUIRED';END IF;
 IF (request_schema IS NULL OR request_schema NOT IN(1,2)) OR requested_operation IS NULL OR requested_job IS NULL OR expected_mode_sequence IS NULL OR expected_mode_sequence<0 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>1048576 OR body-ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview']<>'{}'::jsonb OR NOT body ?& ARRAY['customerId','expectedCustomerVersion','operatorId','fulfillmentMode','workLocation','vehicles','appointment','allocationPlans','conflictReview'] OR NOT crest_private.booking_uuid(body->'customerId') OR NOT crest_private.booking_uuid(body->'operatorId') OR jsonb_typeof(body->'expectedCustomerVersion') IS DISTINCT FROM 'string' OR(body->>'expectedCustomerVersion')!~'^[1-9][0-9]{0,18}$' OR body->>'fulfillmentMode' NOT IN('mobile','dropoff','pickup_return') OR jsonb_typeof(body->'fulfillmentMode') IS DISTINCT FROM 'string' OR jsonb_typeof(body->'vehicles') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'vehicles')=0 OR jsonb_typeof(body->'allocationPlans') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocationPlans')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 slot:=body->'appointment';review:=body->'conflictReview';
 IF jsonb_typeof(slot) IS DISTINCT FROM 'object' OR slot-ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed']<>'{}'::jsonb OR NOT slot ?& ARRAY['start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','travel_before_seconds','travel_after_seconds','customer_confirmation','contact_snapshot','unknown_travel_reviewed'] OR jsonb_typeof(slot->'unknown_travel_reviewed') IS DISTINCT FROM 'boolean' OR crest_private.valid_booking_contact(slot->'contact_snapshot') IS NOT TRUE OR crest_private.valid_booking_confirmation(slot->'customer_confirmation',clock_timestamp()) IS NOT TRUE
  OR jsonb_typeof(review) IS DISTINCT FROM 'object' OR review-ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason']<>'{}'::jsonb OR NOT review ?& ARRAY['expectedAppointmentIds','expectedUnknownTravel','overrideReason'] OR jsonb_typeof(review->'expectedAppointmentIds') IS DISTINCT FROM 'array' OR jsonb_typeof(review->'expectedUnknownTravel') IS DISTINCT FROM 'boolean' OR(review->'overrideReason'<>'null'::jsonb AND crest_private.booking_text_required(review->'overrideReason',1000) IS NOT TRUE)
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(review->'expectedAppointmentIds') item WHERE NOT crest_private.booking_uuid(item)) OR(SELECT count(DISTINCT value) FROM jsonb_array_elements(review->'expectedAppointmentIds'))<>jsonb_array_length(review->'expectedAppointmentIds') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 FOREACH reason IN ARRAY ARRAY['travel_before_seconds','travel_after_seconds'] LOOP IF slot->reason<>'null'::jsonb AND(jsonb_typeof(slot->reason) IS DISTINCT FROM 'number' OR(slot->>reason)!~'^(0|[1-9][0-9]{0,9})$' OR(slot->>reason)::numeric>2147483647) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
 FOR input_vehicle IN SELECT value FROM jsonb_array_elements(body->'vehicles') LOOP
  IF jsonb_typeof(input_vehicle) IS DISTINCT FROM 'object' OR input_vehicle-ARRAY['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation']<>'{}'::jsonb OR NOT input_vehicle ?& ARRAY['vehicleId','expectedVersion','customerVehicleId','pickupLocation','returnLocation'] OR NOT crest_private.booking_uuid(input_vehicle->'vehicleId') OR jsonb_typeof(input_vehicle->'expectedVersion') IS DISTINCT FROM 'string' OR(input_vehicle->>'expectedVersion')!~'^[1-9][0-9]{0,18}$' OR(input_vehicle->'customerVehicleId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_vehicle->'customerVehicleId')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'vehicleId') FROM jsonb_array_elements(body->'vehicles'))<>jsonb_array_length(body->'vehicles') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
  IF jsonb_typeof(input_plan) IS DISTINCT FROM 'object' OR input_plan-(ARRAY['sourceAllocationId','expectedSequence','reason','parts']||(CASE WHEN request_schema=2 THEN ARRAY['entitlementVersionId'] ELSE ARRAY[]::text[] END))<>'{}'::jsonb OR NOT input_plan ?& (ARRAY['sourceAllocationId','expectedSequence','reason','parts']||(CASE WHEN request_schema=2 THEN ARRAY['entitlementVersionId'] ELSE ARRAY[]::text[] END)) OR request_schema=2 AND NOT crest_private.booking_uuid(input_plan->'entitlementVersionId') OR NOT crest_private.booking_uuid(input_plan->'sourceAllocationId') OR jsonb_typeof(input_plan->'expectedSequence') IS DISTINCT FROM 'string' OR(input_plan->>'expectedSequence')!~'^(0|[1-9][0-9]{0,18})$' OR(input_plan->>'expectedSequence')::numeric>=9223372036854775807 OR jsonb_typeof(input_plan->'parts') IS DISTINCT FROM 'array' OR jsonb_array_length(input_plan->'parts')=0 OR(input_plan->'reason'<>'null'::jsonb AND crest_private.booking_text_required(input_plan->'reason',1000) IS NOT TRUE) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
  FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
   IF jsonb_typeof(input_part) IS DISTINCT FROM 'object' OR input_part-ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription']<>'{}'::jsonb OR NOT input_part ?& ARRAY['partitionId','jobId','state','grossInclusiveCents','discountInclusiveCents','amountCents','scopeDescription'] OR NOT crest_private.booking_uuid(input_part->'partitionId') OR(input_part->'jobId'<>'null'::jsonb AND NOT crest_private.booking_uuid(input_part->'jobId')) OR jsonb_typeof(input_part->'state') IS DISTINCT FROM 'string' OR input_part->>'state' NOT IN('unassigned','assigned','completed','cancelled') OR crest_private.booking_text_required(input_part->'scopeDescription',2000) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
   FOREACH reason IN ARRAY ARRAY['grossInclusiveCents','discountInclusiveCents','amountCents'] LOOP IF jsonb_typeof(input_part->reason) IS DISTINCT FROM 'string' OR(input_part->>reason)!~'^(0|[1-9][0-9]{0,18})$' OR(input_part->>reason)::numeric>9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;END LOOP;
  END LOOP;
 END LOOP;
 IF(SELECT count(DISTINCT value->>'sourceAllocationId') FROM jsonb_array_elements(body->'allocationPlans'))<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',request_schema,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.book',request_schema,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.book' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF mode.id IS NULL THEN
    IF expected_mode_sequence<>0 THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.fulfillment_mode_versions(business_id,sequence,replaces_sequence,mobile_enabled,dropoff_enabled,pickup_return_enabled,reason,created_by,operation_id) VALUES(requested_business,1,NULL,true,true,false,NULL,expected_actor,requested_operation) RETURNING * INTO mode;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('fulfillment_modes',requested_business,1,'initialize',NULL,crest_private.fulfillment_mode_projection(mode)));
   ELSIF mode.sequence<>expected_mode_sequence THEN reason:='mode';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF NOT(CASE body->>'fulfillmentMode' WHEN 'mobile' THEN mode.mobile_enabled WHEN 'dropoff' THEN mode.dropoff_enabled WHEN 'pickup_return' THEN mode.pickup_return_enabled ELSE false END) THEN reason:='mode_disabled';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=requested_business AND id=requested_job) THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   SELECT * INTO customer FROM crest.customers WHERE business_id=requested_business AND id=(body->>'customerId')::uuid FOR SHARE;
   IF customer.id IS NULL OR customer.archived_at IS NOT NULL OR customer.version::text<>body->>'expectedCustomerVersion' THEN reason:='customer';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF crest_private.valid_booking_location(body->'workLocation',requested_business,customer.id,true) IS NOT TRUE THEN reason:='location';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   PERFORM 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=(body->>'operatorId')::uuid AND active FOR SHARE;
   IF NOT FOUND THEN reason:='operator';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   FOR family IN SELECT DISTINCT e.agreement_family_id FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.id IN(SELECT(value->>'sourceAllocationId')::uuid FROM jsonb_array_elements(body->'allocationPlans')) ORDER BY e.agreement_family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   INSERT INTO crest.operator_controls(business_id,operator_actor_id,created_by,operation_id) VALUES(requested_business,(body->>'operatorId')::uuid,expected_actor,requested_operation) ON CONFLICT(business_id,operator_actor_id) DO NOTHING RETURNING * INTO control;
   IF control.id IS NOT NULL THEN audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('operator_controls',control.id,1,'create',NULL,crest_private.operator_controls_projection(control)));END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,(body->>'operatorId')::uuid);
   INSERT INTO crest.jobs(id,business_id,customer_id,operator_actor_id,fulfillment_mode,mode_version_id,work_address_id,work_location_snapshot,state,current_appointment_id,created_by,updated_by,operation_id)
   VALUES(requested_job,requested_business,customer.id,(body->>'operatorId')::uuid,body->>'fulfillmentMode',mode.id,CASE WHEN body->'workLocation'->>'kind'='customer_address' THEN(body->'workLocation'->>'addressId')::uuid ELSE NULL END,body->'workLocation','scheduled',gen_random_uuid(),expected_actor,expected_actor,requested_operation) RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'create',NULL,crest_private.jobs_projection(j));audit_ids:=audit_ids||jsonb_build_array(job_audit);
   FOR input_vehicle IN SELECT value FROM jsonb_array_elements(body->'vehicles') ORDER BY value->>'vehicleId' LOOP
    SELECT * INTO vehicle FROM crest.vehicles WHERE business_id=requested_business AND id=(input_vehicle->>'vehicleId')::uuid FOR SHARE;
    IF vehicle.id IS NULL OR vehicle.archived_at IS NOT NULL OR vehicle.version::text<>input_vehicle->>'expectedVersion' THEN reason:='vehicle';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF input_vehicle->'customerVehicleId'<>'null'::jsonb THEN SELECT * INTO association FROM crest.customer_vehicles WHERE business_id=requested_business AND id=(input_vehicle->>'customerVehicleId')::uuid AND customer_id=customer.id AND vehicle_id=vehicle.id AND valid_to IS NULL FOR SHARE;IF association.id IS NULL THEN reason:='vehicle';RAISE EXCEPTION USING ERRCODE='P1601';END IF;END IF;
    INSERT INTO crest.job_vehicles(business_id,job_id,vehicle_id,customer_vehicle_id,vehicle_snapshot,customer_snapshot,pickup_address_id,return_address_id,pickup_location_snapshot,return_location_snapshot,created_by,operation_id)
    VALUES(requested_business,j.id,vehicle.id,(input_vehicle->>'customerVehicleId')::uuid,crest_private.vehicle_projection(vehicle),crest_private.customer_projection(customer),CASE WHEN input_vehicle->'pickupLocation'->>'kind'='customer_address' THEN(input_vehicle->'pickupLocation'->>'addressId')::uuid ELSE NULL END,CASE WHEN input_vehicle->'returnLocation'->>'kind'='customer_address' THEN(input_vehicle->'returnLocation'->>'addressId')::uuid ELSE NULL END,nullif(input_vehicle->'pickupLocation','null'::jsonb),nullif(input_vehicle->'returnLocation','null'::jsonb),expected_actor,requested_operation) RETURNING * INTO jv;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_vehicles',jv.id,1,'create',NULL,crest_private.job_vehicles_projection(jv)));
   END LOOP;
   FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
    SELECT * INTO source_row FROM crest.scope_allocations WHERE business_id=requested_business AND id=(input_plan->>'sourceAllocationId')::uuid;
    SELECT * INTO source_entitlement FROM crest.scope_entitlements WHERE business_id=requested_business AND id=source_row.entitlement_id;
    SELECT * INTO bound_version FROM crest.entitlement_versions WHERE business_id=requested_business AND id=(CASE WHEN request_schema=2 THEN(input_plan->>'entitlementVersionId')::uuid ELSE source_row.entitlement_version_id END);
    SELECT * INTO prior_plan FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id ORDER BY sequence DESC LIMIT 1;
    IF source_row.id IS NULL OR bound_version.id IS NULL OR bound_version.entitlement_id IS DISTINCT FROM source_entitlement.id OR bound_version.family_id IS DISTINCT FROM source_entitlement.agreement_family_id
     OR request_schema=1 AND prior_plan.entitlement_version_id IS NOT NULL
     OR request_schema=2 AND(prior_plan.authorization_state='withdrawn' OR bound_version.id IS DISTINCT FROM coalesce(prior_plan.entitlement_version_id,source_row.entitlement_version_id))
     OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state active JOIN crest.agreements agreement ON agreement.business_id=active.business_id AND agreement.id=active.current_agreement_id WHERE active.business_id=requested_business AND active.family_id=source_entitlement.agreement_family_id AND active.current_agreement_id=bound_version.agreement_id AND agreement.customer_id=customer.id) THEN reason:='scope';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    IF NOT EXISTS(SELECT 1 FROM crest.job_encounters WHERE business_id=requested_business AND job_id=j.id AND family_id=source_entitlement.agreement_family_id) THEN
     INSERT INTO crest.job_encounters(business_id,job_id,customer_id,family_id,agreement_id,encounter_id,created_by,operation_id) VALUES(requested_business,j.id,customer.id,source_entitlement.agreement_family_id,bound_version.agreement_id,source_entitlement.agreement_family_id,expected_actor,requested_operation) RETURNING * INTO encounter;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_encounters',encounter.id,1,'create',NULL,crest_private.job_encounters_projection(encounter)));
    END IF;
    SELECT coalesce(max(sequence),0) INTO current_sequence FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id;
    IF current_sequence::text<>input_plan->>'expectedSequence' THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,source_row.id,current_sequence+1,(SELECT id FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source_row.id AND sequence=current_sequence),input_plan->>'reason',expected_actor,requested_operation,CASE WHEN request_schema=2 THEN bound_version.id ELSE NULL END,CASE WHEN request_schema=2 THEN 'active' ELSE NULL END) RETURNING * INTO p;
    plan_ids:=plan_ids||jsonb_build_array(p.id);audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR input_part IN SELECT value FROM jsonb_array_elements(input_plan->'parts') LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id) VALUES(requested_business,p.id,(input_part->>'partitionId')::uuid,(input_part->>'jobId')::uuid,input_part->>'state',(input_part->>'grossInclusiveCents')::bigint,(input_part->>'discountInclusiveCents')::bigint,(input_part->>'amountCents')::bigint,input_part->>'scopeDescription',expected_actor,requested_operation) RETURNING * INTO part;
     audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   INSERT INTO crest.appointments(id,business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(j.current_appointment_id,requested_business,j.id,1,NULL,(slot->>'start_at')::timestamptz,(slot->>'end_at')::timestamptz,slot->>'timezone',(slot->>'local_start')::timestamp,(slot->>'local_end')::timestamp,(slot->>'start_offset_minutes')::integer,(slot->>'end_offset_minutes')::integer,(slot->>'travel_before_seconds')::integer,(slot->>'travel_after_seconds')::integer,'confirmed',slot->'customer_confirmation',slot->'contact_snapshot',(slot->>'unknown_travel_reviewed')::boolean,NULL,expected_actor,requested_operation) RETURNING * INTO a;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   blocked:=tstzrange(a.start_at-coalesce(a.travel_before_seconds,0)*interval '1 second',a.end_at+coalesce(a.travel_after_seconds,0)*interval '1 second','[)');
   review_snapshot:=crest_private.booking_slot_review(requested_business,j.operator_actor_id,j.id,blocked,a.travel_before_seconds,a.travel_after_seconds);
   SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO actual_conflicts FROM jsonb_array_elements(review_snapshot->'conflictingAppointmentIds');
   SELECT coalesce(array_agg((value#>>'{}')::uuid ORDER BY(value#>>'{}')::uuid),ARRAY[]::uuid[]) INTO expected_conflicts FROM jsonb_array_elements(review->'expectedAppointmentIds');
   unknown_travel:=(review_snapshot->>'unknownTravel')::boolean;
   IF actual_conflicts IS DISTINCT FROM expected_conflicts OR unknown_travel IS DISTINCT FROM(review->>'expectedUnknownTravel')::boolean OR unknown_travel AND NOT a.unknown_travel_reviewed THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
   IF cardinality(actual_conflicts)>0 THEN
    IF review->'overrideReason'='null'::jsonb THEN reason:='review';RAISE EXCEPTION USING ERRCODE='P1601';END IF;
    INSERT INTO crest.schedule_overrides(business_id,job_id,appointment_id,reason,created_by,operation_id) VALUES(requested_business,j.id,a.id,review->>'overrideReason',expected_actor,requested_operation) RETURNING * INTO override_row;
    audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_overrides',override_row.id,1,'create',NULL,crest_private.schedule_overrides_projection(override_row)));
    FOREACH conflicting IN ARRAY actual_conflicts LOOP INSERT INTO crest.schedule_override_conflicts(business_id,override_id,conflicting_appointment_id,created_by,operation_id) VALUES(requested_business,override_row.id,conflicting,expected_actor,requested_operation) RETURNING * INTO conflict_row;audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_override_conflicts',conflict_row.id,1,'create',NULL,crest_private.schedule_override_conflicts_projection(conflict_row)));END LOOP;
   END IF;
   INSERT INTO crest.schedule_reservations(business_id,job_id,appointment_id,operator_actor_id,blocked_interval,unknown_travel,override_id,created_by,operation_id) VALUES(requested_business,j.id,a.id,j.operator_actor_id,blocked,unknown_travel,override_row.id,expected_actor,requested_operation) RETURNING * INTO reservation;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,1,'create',NULL,crest_private.schedule_reservations_projection(reservation)));
   original:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedModeSequence',expected_mode_sequence::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,1,NULL,'scheduled',j.created_at,NULL,jsonb_build_object('request',original,'planIds',plan_ids,'confirmationDraft',crest_private.schedule_confirmation_draft(requested_business,j.id,a.id)),expected_actor,requested_operation) RETURNING * INTO event;
   audit_ids:=audit_ids||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',audit_ids);
   UPDATE crest_private.operations SET state='committed',result_schema_version=request_schema,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.booked_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1601' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.cancel_scheduled_job(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, expected_epoch uuid, requested_operation uuid, request_schema integer, requested_job uuid, expected_job_version bigint, body jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;before_job crest.jobs;j crest.jobs;old_appointment crest.appointments;latest crest.appointments;a crest.appointments;reservation crest.schedule_reservations;p crest.allocation_plan_versions;previous crest.allocation_plan_versions;part crest.allocation_plan_parts;prior_part crest.allocation_plan_parts;event crest.job_events;family uuid;source uuid;reason text;observed jsonb;source_row crest.scope_allocations;bound_version crest.entitlement_versions;source_audits jsonb:='[]'::jsonb;job_audit uuid;original jsonb;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema=2 AND (SELECT encode(sha256(convert_to(string_agg(catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname,E'\n' ORDER BY (catalog_n.nspname||'.'||catalog_c.relname||'.'||catalog_a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace catalog_n JOIN pg_class catalog_c ON catalog_c.relnamespace=catalog_n.oid JOIN pg_attribute catalog_a ON catalog_a.attrelid=catalog_c.oid WHERE catalog_n.nspname='crest' AND catalog_c.relkind IN('r','p') AND catalog_a.attnum>0 AND NOT catalog_a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDED_BOOKING_SCHEMA_REVIEW_REQUIRED';END IF;
 IF (request_schema IS NULL OR request_schema NOT IN(1,2)) OR requested_operation IS NULL OR requested_job IS NULL OR expected_job_version IS NULL OR expected_job_version<1 OR expected_job_version>=9223372036854775807 OR body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR body-(ARRAY['reason','customerCommunication']||(CASE WHEN request_schema=2 THEN ARRAY['allocationPlans'] ELSE ARRAY[]::text[] END))<>'{}'::jsonb OR NOT body ?& (ARRAY['reason','customerCommunication']||(CASE WHEN request_schema=2 THEN ARRAY['allocationPlans'] ELSE ARRAY[]::text[] END)) OR crest_private.booking_text_required(body->'reason',1000) IS NOT TRUE OR crest_private.valid_booking_communication(body->'customerCommunication',clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 IF request_schema=2 THEN
  IF octet_length(body::text)>1048576 OR jsonb_typeof(body->'allocationPlans') IS DISTINCT FROM 'array' OR jsonb_array_length(body->'allocationPlans')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
  FOR observed IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
   IF jsonb_typeof(observed) IS DISTINCT FROM 'object' OR NOT(observed?&ARRAY['sourceAllocationId','entitlementVersionId','expectedPlanId','expectedSequence']) OR observed-ARRAY['sourceAllocationId','entitlementVersionId','expectedPlanId','expectedSequence']<>'{}'::jsonb
    OR NOT crest_private.booking_uuid(observed->'sourceAllocationId') OR NOT crest_private.booking_uuid(observed->'entitlementVersionId') OR NOT crest_private.booking_uuid(observed->'expectedPlanId') OR jsonb_typeof(observed->'expectedSequence') IS DISTINCT FROM 'string' OR(observed->>'expectedSequence')!~'^[1-9][0-9]{0,18}$' OR(observed->>'expectedSequence')::numeric>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
  END LOOP;
  IF(SELECT count(DISTINCT value->>'sourceAllocationId') FROM jsonb_array_elements(body->'allocationPlans'))<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CANCELLATION_INPUT_REQUIRED';END IF;
 END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',request_schema,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.job.cancel',request_schema,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'operations.job.cancel' OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   FOR family IN SELECT family_id FROM crest.job_encounters WHERE business_id=requested_business AND job_id=requested_job ORDER BY family_id LOOP PERFORM crest_private.lock_booking_family(requested_business,family);END LOOP;
   SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job;
   IF before_job.id IS NULL THEN reason:='job';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   PERFORM crest_private.lock_booking_operator(requested_business,before_job.operator_actor_id);SELECT * INTO before_job FROM crest.jobs WHERE business_id=requested_business AND id=requested_job FOR UPDATE;
   IF before_job.version<>expected_job_version THEN reason:='version';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   IF before_job.state<>'scheduled' OR before_job.first_work_at IS NOT NULL THEN reason:='state';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   IF request_schema=1 AND EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current JOIN crest.allocation_plan_versions observed_plan ON observed_plan.business_id=current.business_id AND observed_plan.id=current.plan_id WHERE current.business_id=requested_business AND current.job_id=before_job.id AND observed_plan.entitlement_version_id IS NOT NULL) THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   IF request_schema=2 AND((SELECT count(DISTINCT source_allocation_id) FROM crest.current_scope_allocation_parts WHERE business_id=requested_business AND job_id=before_job.id)<>jsonb_array_length(body->'allocationPlans')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(body->'allocationPlans') v WHERE NOT EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current WHERE current.business_id=requested_business AND current.job_id=before_job.id AND current.source_allocation_id=(v->>'sourceAllocationId')::uuid AND current.entitlement_version_id=(v->>'entitlementVersionId')::uuid AND current.plan_id=(v->>'expectedPlanId')::uuid AND current.plan_sequence::text=v->>'expectedSequence')))
   THEN reason:='allocation';RAISE EXCEPTION USING ERRCODE='P1602';END IF;
   SELECT * INTO old_appointment FROM crest.appointments WHERE business_id=requested_business AND id=before_job.current_appointment_id AND job_id=before_job.id;
   SELECT * INTO latest FROM crest.appointments WHERE business_id=requested_business AND job_id=before_job.id ORDER BY sequence DESC LIMIT 1;
   IF old_appointment.id IS NULL OR latest.id IS NULL OR latest.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
   INSERT INTO crest.appointments(business_id,job_id,sequence,replaces_id,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,travel_before_seconds,travel_after_seconds,confirmation_state,customer_confirmation,contact_snapshot,unknown_travel_reviewed,reason,created_by,operation_id)
   VALUES(requested_business,before_job.id,latest.sequence+1,latest.id,old_appointment.start_at,old_appointment.end_at,old_appointment.timezone,old_appointment.local_start,old_appointment.local_end,old_appointment.start_offset_minutes,old_appointment.end_offset_minutes,old_appointment.travel_before_seconds,old_appointment.travel_after_seconds,'cancelled',NULL,old_appointment.contact_snapshot,false,body->>'reason',expected_actor,requested_operation) RETURNING * INTO a;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('appointments',a.id,1,'create',NULL,crest_private.appointments_projection(a)));
   DELETE FROM crest.schedule_reservations WHERE business_id=requested_business AND job_id=before_job.id RETURNING * INTO reservation;
   IF reservation.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('schedule_reservations',reservation.id,2,'release',crest_private.schedule_reservations_projection(reservation),NULL));
   UPDATE crest.jobs SET state='cancelled',current_appointment_id=a.id,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=before_job.id RETURNING * INTO j;
   job_audit:=crest_private.append_booking_audit('jobs',j.id,j.version,'revise',crest_private.jobs_projection(before_job),crest_private.jobs_projection(j));source_audits:=source_audits||jsonb_build_array(job_audit);
   FOR source IN SELECT DISTINCT source_allocation_id FROM crest.current_scope_allocation_parts WHERE business_id=requested_business AND job_id=j.id ORDER BY source_allocation_id LOOP
    SELECT * INTO previous FROM crest.allocation_plan_versions WHERE business_id=requested_business AND source_allocation_id=source ORDER BY sequence DESC LIMIT 1;
    IF previous.id IS NULL OR previous.sequence>=9223372036854775807 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_SOURCE_REQUIRED';END IF;
    SELECT * INTO source_row FROM crest.scope_allocations WHERE business_id=requested_business AND id=source;
    SELECT * INTO bound_version FROM crest.entitlement_versions WHERE business_id=requested_business AND id=coalesce(previous.entitlement_version_id,source_row.entitlement_version_id);
    INSERT INTO crest.allocation_plan_versions(business_id,source_allocation_id,sequence,replaces_id,reason,created_by,operation_id,entitlement_version_id,authorization_state) VALUES(requested_business,source,previous.sequence+1,previous.id,body->>'reason',expected_actor,requested_operation,CASE WHEN request_schema=2 THEN bound_version.id ELSE NULL END,CASE WHEN request_schema=2 THEN 'active' ELSE NULL END) RETURNING * INTO p;
    source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_versions',p.id,1,'create',NULL,crest_private.allocation_plan_versions_projection(p)));
    FOR prior_part IN SELECT * FROM crest.allocation_plan_parts WHERE business_id=requested_business AND plan_id=previous.id ORDER BY stable_partition_id LOOP
     INSERT INTO crest.allocation_plan_parts(business_id,plan_id,stable_partition_id,job_id,allocation_state,gross_inclusive_cents,discount_inclusive_cents,amount_cents,scope_description,created_by,operation_id)
     VALUES(requested_business,p.id,prior_part.stable_partition_id,prior_part.job_id,CASE WHEN prior_part.job_id=j.id THEN 'cancelled' ELSE prior_part.allocation_state END,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description,expected_actor,requested_operation) RETURNING * INTO part;
     source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('allocation_plan_parts',part.id,1,'create',NULL,crest_private.allocation_plan_parts_projection(part)));
    END LOOP;
   END LOOP;
   original:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'operationId',requested_operation,'recoveryEpoch',expected_epoch,'jobId',requested_job,'expectedJobVersion',expected_job_version::text,'payload',body);
   INSERT INTO crest.job_events(business_id,job_id,sequence,from_state,to_state,effective_at,reason,evidence,created_by,operation_id) VALUES(requested_business,j.id,j.version,'scheduled','cancelled',j.updated_at,body->>'reason',jsonb_build_object('request',original,'historyPredecessorId',latest.id),expected_actor,requested_operation) RETURNING * INTO event;
   source_audits:=source_audits||jsonb_build_array(crest_private.append_booking_audit('job_events',event.id,1,'create',NULL,crest_private.job_events_projection(event)));
   command_result:=jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'jobId',j.id,'version',j.version::text,'appointmentId',a.id,'appointmentSequence',a.sequence::text,'jobAuditEventId',job_audit,'sourceAuditIds',source_audits);
   UPDATE crest_private.operations SET state='committed',result_schema_version=request_schema,result=command_result WHERE business_id=requested_business AND operation_id=requested_operation;
   command_result:=crest_private.cancelled_job_operation_result(requested_business,expected_actor,requested_operation);
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1602' THEN RETURN jsonb_build_object('state','conflict','reason',reason);END;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.authorize_booking_statement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE kind text;
BEGIN
 IF current_user='crest_quote_owner' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') THEN
  SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND (schema_version=1 OR schema_version=2 AND command_type IN('operations.job.book','operations.job.cancel')) AND state='pending' AND origin='manual' AND import_row_id IS NULL;
  IF kind IS DISTINCT FROM 'quote.amendment.accept' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF current_user<>'crest_booking_owner' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND (schema_version=1 OR schema_version=2 AND command_type IN('operations.job.book','operations.job.cancel')) AND state='pending' AND origin='manual' AND import_row_id IS NULL;
 IF NOT coalesce(kind='operations.job.book' AND TG_OP='INSERT' OR kind='operations.job.cancel' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations') OR kind='operations.job.reschedule' AND(TG_OP='INSERT' AND TG_TABLE_NAME IN('appointments','job_events','schedule_reservations','schedule_overrides','schedule_override_conflicts') OR TG_OP='UPDATE' AND TG_TABLE_NAME='jobs' OR TG_OP='DELETE' AND TG_TABLE_NAME='schedule_reservations'),false) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_COMMAND_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.stamp_booking_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE stamp timestamptz:=clock_timestamp();actor uuid;operation uuid;kind text;
BEGIN
 actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
 IF actor IS NULL OR operation IS NULL OR NEW.business_id IS DISTINCT FROM nullif(current_setting('crest.business_id',true),'')::uuid OR NEW.operation_id IS DISTINCT FROM operation OR NEW.origin<>'manual' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BOOKING_CONTEXT_REQUIRED';END IF;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND (schema_version=1 OR schema_version=2 AND command_type IN('operations.job.book','operations.job.cancel')) AND origin='manual' AND import_row_id IS NULL;
 IF kind='quote.amendment.accept' AND NOT(TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF kind IS NULL OR kind NOT IN('operations.job.book','operations.job.reschedule','operations.job.cancel','quote.amendment.accept') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_OPERATION_REQUIRED';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ACTOR_REQUIRED';END IF;NEW.created_at:=stamp;
  IF TG_TABLE_NAME='jobs' THEN IF kind<>'operations.job.book' OR NEW.version<>1 OR NEW.updated_by<>actor OR NEW.state<>'scheduled' OR NEW.first_work_at IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.completion_outcome IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;NEW.updated_at:=stamp;END IF;
 ELSE
  IF TG_TABLE_NAME<>'jobs' OR ROW(NEW.id,NEW.business_id,NEW.customer_id,NEW.operator_actor_id,NEW.created_at,NEW.created_by,NEW.origin) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.customer_id,OLD.operator_actor_id,OLD.created_at,OLD.created_by,OLD.origin) OR NEW.version<>OLD.version+1 OR NEW.updated_by<>actor OR OLD.state<>'scheduled' OR OLD.first_work_at IS NOT NULL OR ROW(NEW.first_work_at,NEW.completed_at,NEW.completion_outcome) IS DISTINCT FROM ROW(OLD.first_work_at,OLD.completed_at,OLD.completion_outcome) OR NOT(kind='operations.job.reschedule' AND NEW.state='scheduled' OR kind='operations.job.cancel' AND NEW.state='cancelled') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_JOB_STATE_REVIEW_REQUIRED';END IF;
  NEW.updated_at:=stamp;
  IF kind='operations.job.cancel' AND ROW(NEW.fulfillment_mode,NEW.mode_version_id,NEW.work_address_id,NEW.work_location_snapshot) IS DISTINCT FROM ROW(OLD.fulfillment_mode,OLD.mode_version_id,OLD.work_address_id,OLD.work_location_snapshot) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SOURCE_RETAINED';END IF;
 END IF;
 RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_row_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE b uuid;entity uuid;actor uuid;operation uuid;revision bigint;verb text;before_row jsonb:='null'::jsonb;after_row jsonb:='null'::jsonb;
BEGIN
 IF TG_OP='DELETE' THEN
  IF TG_TABLE_NAME<>'schedule_reservations' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_BOOKING_HISTORY_RETAINED';END IF;
  b:=OLD.business_id;entity:=OLD.id;actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;revision:=2;verb:='release';
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;
 ELSE
  b:=NEW.business_id;entity:=NEW.id;operation:=NEW.operation_id;verb:=CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'revise' END;
  IF TG_TABLE_NAME='jobs' THEN actor:=NEW.updated_by;revision:=NEW.version;ELSE actor:=NEW.created_by;revision:=1;END IF;
  EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO after_row USING NEW;
  IF TG_OP='UPDATE' THEN EXECUTE format('SELECT crest_private.%I_projection($1::crest.%I)',TG_TABLE_NAME,TG_TABLE_NAME) INTO before_row USING OLD;END IF;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=b AND operation_id=operation AND actor_id=actor AND command_type='quote.amendment.accept' AND schema_version=1) THEN verb:='accept';END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=b AND a.operation_id=operation AND a.actor_id=actor AND a.created_by=actor AND a.entity_kind=TG_TABLE_NAME AND a.entity_id=entity AND a.entity_version=revision AND a.action=verb AND a.delta=jsonb_build_object('schemaVersion',1,'before',before_row,'after',after_row) AND a.origin='manual' AND a.import_row_id IS NULL AND o.state='committed' AND (o.schema_version=1 OR o.schema_version=2 AND o.command_type IN('operations.job.book','operations.job.cancel')) AND o.result_schema_version=o.schema_version AND o.origin='manual' AND o.import_row_id IS NULL AND (o.command_type IN('operations.job.book','operations.job.reschedule','operations.job.cancel') OR o.command_type='quote.amendment.accept' AND TG_OP='INSERT' AND TG_TABLE_NAME IN('allocation_plan_versions','allocation_plan_parts')) AND(TG_OP<>'DELETE' OR o.command_type IN('operations.job.reschedule','operations.job.cancel')))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_AUDIT_REQUIRED';END IF;RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_booking_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE p crest.allocation_plan_versions;s crest.scope_allocations;e crest.scope_entitlements;kind text;bound_version crest.entitlement_versions;bound_gross numeric;bound_discount numeric;part_count bigint;gross numeric;discount numeric;amount numeric;
BEGIN
 IF TG_TABLE_NAME='allocation_plan_versions' THEN SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.id;
 ELSE SELECT * INTO p FROM crest.allocation_plan_versions WHERE business_id=NEW.business_id AND id=NEW.plan_id;END IF;
 SELECT * INTO s FROM crest.scope_allocations WHERE business_id=p.business_id AND id=p.source_allocation_id;
 SELECT * INTO e FROM crest.scope_entitlements WHERE business_id=p.business_id AND id=s.entitlement_id;
 SELECT command_type INTO kind FROM crest_private.operations WHERE business_id=p.business_id AND operation_id=p.operation_id AND actor_id=p.created_by;
 SELECT count(*),coalesce(sum(gross_inclusive_cents::numeric),0),coalesce(sum(discount_inclusive_cents::numeric),0),coalesce(sum(amount_cents::numeric),0) INTO part_count,gross,discount,amount FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id;
 bound_gross:=s.gross_inclusive_cents;bound_discount:=s.discount_inclusive_cents;
 IF p.entitlement_version_id IS NOT NULL THEN SELECT * INTO bound_version FROM crest.entitlement_versions WHERE business_id=p.business_id AND id=p.entitlement_version_id;bound_gross:=(bound_version.scope_snapshot->>'grossCents')::numeric;bound_discount:=(bound_version.scope_snapshot->>'lineDiscountCents')::numeric+(bound_version.scope_snapshot->>'allocatedDiscountCents')::numeric;END IF;
 IF kind='quote.amendment.accept' THEN
  IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR p.entitlement_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM crest.entitlement_versions v JOIN crest.quote_family_commercial_state active ON active.business_id=v.business_id AND active.family_id=v.family_id AND active.current_agreement_id=v.agreement_id WHERE v.business_id=p.business_id AND v.id=p.entitlement_version_id AND v.entitlement_id=e.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ALLOCATION_BINDING_REQUIRED';END IF;
  IF crest_private.amendment_accept_result(p.business_id,p.created_by,p.operation_id)->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_ACCEPT_RESULT_REQUIRED';END IF;RETURN NULL;
 END IF;
 IF p.id IS NULL OR s.id IS NULL OR e.id IS NULL OR kind IS NULL OR kind NOT IN('operations.job.book','operations.job.cancel') OR part_count=0 OR bound_gross IS NULL OR bound_discount IS NULL OR gross<>bound_gross OR discount<>bound_discount OR amount<>coalesce(bound_version.authorized_cents,s.amount_cents)
  OR NOT EXISTS(SELECT 1 FROM crest.quote_family_commercial_state c WHERE c.business_id=p.business_id AND c.family_id=e.agreement_family_id AND c.current_agreement_id=coalesce(bound_version.agreement_id,s.agreement_id))
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(a.operation_id<>p.operation_id OR a.created_by<>p.created_by))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_TOTAL_REQUIRED';END IF;
 IF kind='operations.job.book' AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.allocation_state='assigned' AND j.operation_id=p.operation_id AND j.state='scheduled')
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_NEW_SCOPE_REQUIRED';END IF;
 -- Cancellation changes state, not the previously explicit money or scope.
 IF kind='operations.job.cancel' AND(p.replaces_id IS NULL
  OR EXISTS(SELECT 1 FROM(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.replaces_id) prior_part FULL JOIN(SELECT * FROM crest.allocation_plan_parts WHERE business_id=p.business_id AND plan_id=p.id) next ON next.stable_partition_id=prior_part.stable_partition_id
    WHERE prior_part.id IS NULL OR next.id IS NULL OR ROW(next.job_id,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
       OR next.allocation_state IS DISTINCT FROM prior_part.allocation_state AND NOT(prior_part.allocation_state='assigned' AND next.allocation_state='cancelled' AND EXISTS(SELECT 1 FROM crest.jobs j WHERE j.business_id=prior_part.business_id AND j.id=prior_part.job_id AND j.state='cancelled' AND j.operation_id=p.operation_id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_CANCELLED_SCOPE_RETAINED';END IF;
 -- Stable partition identity cannot migrate into another entitlement's source.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.allocation_plan_parts other ON other.business_id=a.business_id AND other.stable_partition_id=a.stable_partition_id JOIN crest.allocation_plan_versions previous ON previous.business_id=other.business_id AND previous.id=other.plan_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND previous.source_allocation_id<>p.source_allocation_id)
  OR EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.scope_allocations original ON original.business_id=a.business_id AND original.stable_partition_id=a.stable_partition_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND original.id<>p.source_allocation_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_PARTITION_IDENTITY_REQUIRED';END IF;
 -- A zero-dollar source/partition cannot disappear merely because the total
 -- remains zero. Preserve its original identity through explicit allocations.
 IF p.replaces_id IS NULL AND s.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=s.stable_partition_id)
  OR p.replaces_id IS NOT NULL AND EXISTS(SELECT 1 FROM crest.allocation_plan_parts prior_part WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.amount_cents=0 AND NOT EXISTS(SELECT 1 FROM crest.allocation_plan_parts a WHERE a.business_id=p.business_id AND a.plan_id=p.id AND a.stable_partition_id=prior_part.stable_partition_id))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ZERO_IDENTITY_REQUIRED';END IF;
 -- Every assigned partition has the accepted customer's actual job and vehicle.
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id JOIN crest.agreements agreement ON agreement.business_id=s.business_id AND agreement.id=s.agreement_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(j.customer_id<>agreement.customer_id OR NOT EXISTS(SELECT 1 FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=e.agreement_family_id) OR NOT e.job_wide AND NOT EXISTS(SELECT 1 FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id AND v.vehicle_id=e.vehicle_id)))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_BINDING_REQUIRED';END IF;
 -- Existing assigned work stays intact when booking another visit; completed
 -- scope and active physical work cannot be moved by any booking command.
 IF p.replaces_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM crest.allocation_plan_parts prior_part JOIN crest.jobs j ON j.business_id=prior_part.business_id AND j.id=prior_part.job_id
  LEFT JOIN crest.allocation_plan_parts next ON next.business_id=prior_part.business_id AND next.plan_id=p.id AND next.stable_partition_id=prior_part.stable_partition_id
  WHERE prior_part.business_id=p.business_id AND prior_part.plan_id=p.replaces_id AND(
   prior_part.allocation_state='completed' OR j.state IN('en_route','in_progress','paused') OR prior_part.allocation_state='assigned' AND j.state='scheduled' AND kind='operations.job.book'
  ) AND ROW(next.job_id,next.allocation_state,next.gross_inclusive_cents,next.discount_inclusive_cents,next.amount_cents,next.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.allocation_state,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_ASSIGNED_SCOPE_RETAINED';END IF;
 IF EXISTS(SELECT 1 FROM crest.allocation_plan_parts a LEFT JOIN crest.allocation_plan_parts prior_part ON prior_part.business_id=a.business_id AND prior_part.plan_id=p.replaces_id AND prior_part.stable_partition_id=a.stable_partition_id LEFT JOIN crest.jobs j ON j.business_id=a.business_id AND j.id=a.job_id WHERE a.business_id=p.business_id AND a.plan_id=p.id AND(
  a.allocation_state='completed' AND(prior_part.id IS NULL OR prior_part.allocation_state<>'completed' OR ROW(a.job_id,a.gross_inclusive_cents,a.discount_inclusive_cents,a.amount_cents,a.scope_description) IS DISTINCT FROM ROW(prior_part.job_id,prior_part.gross_inclusive_cents,prior_part.discount_inclusive_cents,prior_part.amount_cents,prior_part.scope_description))
  OR a.allocation_state='assigned' AND(prior_part.id IS NULL OR prior_part.job_id IS DISTINCT FROM a.job_id OR prior_part.allocation_state IS DISTINCT FROM 'assigned') AND(kind<>'operations.job.book' OR j.operation_id<>p.operation_id OR j.state<>'scheduled')
  OR a.allocation_state='cancelled' AND(prior_part.id IS NULL OR prior_part.allocation_state IS DISTINCT FROM 'cancelled') AND(kind<>'operations.job.cancel' OR j.operation_id<>p.operation_id OR j.state<>'cancelled')
 )) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_SCOPE_STATE_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_private.booked_job_operation_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;original jsonb;body jsonb;mode crest.fulfillment_mode_versions;source_audit crest_private.audit_events;stored jsonb;table_name text;digest text;counted bigint;expected_count bigint;input_plan jsonb;written_plan crest.allocation_plan_versions;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.book';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR r->>'businessId' IS DISTINCT FROM business::text OR r->>'version' IS DISTINCT FROM '1' OR r->>'appointmentSequence' IS DISTINCT FROM '1' OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=1 AND action='create';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=1 AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';body:=original->'payload';
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR original->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR journal.delta->'before' IS DISTINCT FROM 'null'::jsonb OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR journal.delta->'after'->>'customer_id' IS DISTINCT FROM body->>'customerId' OR journal.delta->'after'->>'operator_actor_id' IS DISTINCT FROM body->>'operatorId' OR journal.delta->'after'->>'fulfillment_mode' IS DISTINCT FROM body->>'fulfillmentMode' OR journal.delta->'after'->'work_location_snapshot' IS DISTINCT FROM body->'workLocation' OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.book','schemaVersion',o.schema_version,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedModeSequence',original->>'expectedModeSequence','payload',body)::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');
 SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count<1 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds'));
 IF counted<>expected_count OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   -- Reservations are mutable projections; their immutable original is audited.
   stored:=source_audit.delta->'after';
   IF stored->>'job_id' IS DISTINCT FROM r->>'jobId' OR stored->>'appointment_id' IS DISTINCT FROM a.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  ELSIF table_name='fulfillment_modes' THEN
   SELECT * INTO mode FROM crest.fulfillment_mode_versions WHERE business_id=business AND id=(source_audit.delta->'after'->>'id')::uuid;
   stored:=crest_private.fulfillment_mode_projection(mode);
  ELSIF table_name IN('job_vehicles','job_encounters','appointments','operator_controls','schedule_overrides','schedule_override_conflicts','allocation_plan_versions','allocation_plan_parts','job_events') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.action NOT IN('create','initialize') OR source_audit.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',stored) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 IF o.schema_version=2 THEN
  IF(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor)<>jsonb_array_length(body->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  FOR input_plan IN SELECT value FROM jsonb_array_elements(body->'allocationPlans') LOOP
   SELECT * INTO written_plan FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor AND source_allocation_id=(input_plan->>'sourceAllocationId')::uuid;
   IF written_plan.id IS NULL OR written_plan.entitlement_version_id::text IS DISTINCT FROM input_plan->>'entitlementVersionId' OR written_plan.authorization_state IS DISTINCT FROM 'active' OR written_plan.sequence::numeric IS DISTINCT FROM(input_plan->>'expectedSequence')::numeric+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
   IF(SELECT jsonb_agg(jsonb_build_object('partitionId',stable_partition_id,'jobId',job_id,'state',allocation_state,'grossInclusiveCents',gross_inclusive_cents::text,'discountInclusiveCents',discount_inclusive_cents::text,'amountCents',amount_cents::text,'scopeDescription',scope_description) ORDER BY stable_partition_id) FROM crest.allocation_plan_parts WHERE business_id=business AND plan_id=written_plan.id) IS DISTINCT FROM(SELECT jsonb_agg(value ORDER BY(value->>'partitionId')::uuid) FROM jsonb_array_elements(input_plan->'parts')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RESULT_REVIEW_REQUIRED';END IF;
  END LOOP;
 END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_private.cancelled_job_operation_result(business uuid, actor uuid, operation uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE o crest_private.operations;r jsonb;journal crest_private.audit_events;event crest.job_events;a crest.appointments;predecessor crest.appointments;original jsonb;source_audit crest_private.audit_events;stored jsonb;table_name text;expected_count bigint;input_plan jsonb;written_plan crest.allocation_plan_versions;counted bigint;prior_appointment uuid;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.job.cancel';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','jobId','version','appointmentId','appointmentSequence','jobAuditEventId','sourceAuditIds'] OR r->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR r->>'businessId' IS DISTINCT FROM business::text OR jsonb_typeof(r->'version') IS DISTINCT FROM 'string' OR(r->>'version')!~'^[1-9][0-9]{0,18}$' OR(r->>'version')::numeric>9223372036854775807 OR jsonb_typeof(r->'appointmentSequence') IS DISTINCT FROM 'string' OR(r->>'appointmentSequence')!~'^[1-9][0-9]{0,18}$' OR(r->>'appointmentSequence')::numeric>9223372036854775807 OR jsonb_typeof(r->'sourceAuditIds') IS DISTINCT FROM 'array' OR NOT crest_private.booking_uuid(r->'jobId') OR NOT crest_private.booking_uuid(r->'appointmentId') OR NOT crest_private.booking_uuid(r->'jobAuditEventId') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO journal FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'jobAuditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='jobs' AND entity_id=(r->>'jobId')::uuid AND entity_version=(r->>'version')::bigint AND action='revise';
 SELECT * INTO event FROM crest.job_events WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'version')::bigint AND operation_id=operation AND created_by=actor;
 SELECT * INTO a FROM crest.appointments WHERE business_id=business AND id=(r->>'appointmentId')::uuid AND job_id=(r->>'jobId')::uuid AND sequence=(r->>'appointmentSequence')::bigint AND operation_id=operation AND created_by=actor;
 original:=event.evidence->'request';prior_appointment:=(journal.delta->'before'->>'current_appointment_id')::uuid;
 SELECT * INTO predecessor FROM crest.appointments WHERE business_id=business AND job_id=(r->>'jobId')::uuid AND id=(event.evidence->>'historyPredecessorId')::uuid;
 IF journal.id IS NULL OR event.id IS NULL OR a.id IS NULL OR original->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR original->>'businessId' IS DISTINCT FROM business::text OR original->>'operationId' IS DISTINCT FROM operation::text OR original->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR original->>'jobId' IS DISTINCT FROM r->>'jobId' OR(original->>'expectedJobVersion')::numeric+1 IS DISTINCT FROM(r->>'version')::numeric
  OR journal.delta->'before'->>'state' IS DISTINCT FROM 'scheduled' OR journal.delta->'after'->>'state' IS DISTINCT FROM 'cancelled' OR journal.delta->'before'->>'version' IS DISTINCT FROM original->>'expectedJobVersion' OR journal.delta->'after'->>'version' IS DISTINCT FROM r->>'version' OR journal.delta->'after'->>'current_appointment_id' IS DISTINCT FROM a.id::text OR predecessor.id IS NULL OR a.replaces_id IS DISTINCT FROM predecessor.id OR a.sequence<>predecessor.sequence+1 OR a.confirmation_state<>'cancelled' OR a.customer_confirmation IS NOT NULL OR a.reason IS DISTINCT FROM original->'payload'->>'reason' OR event.reason IS DISTINCT FROM a.reason OR event.from_state<>'scheduled' OR event.to_state<>'cancelled'
  OR crest_private.valid_booking_communication(original->'payload'->'customerCommunication',event.created_at) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM crest.jobs WHERE business_id=business AND id=(r->>'jobId')::uuid AND state='cancelled' AND version=(r->>'version')::bigint AND current_appointment_id=a.id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.job.cancel','schemaVersion',o.schema_version,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'jobId',original->>'jobId','expectedJobVersion',original->>'expectedJobVersion','payload',original->'payload')::text,'UTF8')),'hex');IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 expected_count:=jsonb_array_length(r->'sourceAuditIds');SELECT count(DISTINCT value) INTO counted FROM jsonb_array_elements(r->'sourceAuditIds');
 IF counted<>expected_count OR expected_count=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'sourceAuditIds') item WHERE NOT crest_private.booking_uuid(item)) OR NOT r->'sourceAuditIds' @> jsonb_build_array(journal.id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 SELECT count(*) INTO counted FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor;IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 counted:=0; FOR source_audit IN SELECT * FROM crest_private.audit_events WHERE business_id=business AND operation_id=operation AND actor_id=actor AND id IN(SELECT(value#>>'{}')::uuid FROM jsonb_array_elements(r->'sourceAuditIds')) LOOP
  counted:=counted+1;table_name:=source_audit.entity_kind;
  IF table_name='jobs' THEN IF source_audit.id<>journal.id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;stored:=journal.delta->'after';
  ELSIF table_name='schedule_reservations' THEN
   IF source_audit.entity_version<>2 OR source_audit.action<>'release' OR source_audit.delta->'after' IS DISTINCT FROM 'null'::jsonb OR source_audit.delta->'before'->>'job_id' IS DISTINCT FROM r->>'jobId' OR source_audit.delta->'before'->>'appointment_id' IS DISTINCT FROM prior_appointment::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;CONTINUE;
  ELSIF table_name IN('appointments','allocation_plan_versions','allocation_plan_parts','job_events') THEN
   EXECUTE format('SELECT crest_private.%I_projection(v) FROM crest.%I v WHERE business_id=$1 AND id=$2 AND operation_id=$3 AND created_by=$4',table_name,table_name) INTO stored USING business,source_audit.entity_id,operation,actor;
   IF source_audit.action<>'create' OR source_audit.entity_version<>1 OR source_audit.delta->'before' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  IF stored IS NULL OR source_audit.delta->>'schemaVersion'<>'1' OR source_audit.delta->'after' IS DISTINCT FROM stored THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 END LOOP;
 IF counted<>expected_count THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
 IF o.schema_version=2 THEN
  IF(SELECT count(*) FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor)<>jsonb_array_length(original->'payload'->'allocationPlans') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;
  FOR input_plan IN SELECT value FROM jsonb_array_elements(original->'payload'->'allocationPlans') LOOP
   SELECT * INTO written_plan FROM crest.allocation_plan_versions WHERE business_id=business AND operation_id=operation AND created_by=actor AND source_allocation_id=(input_plan->>'sourceAllocationId')::uuid;
   IF written_plan.id IS NULL OR written_plan.entitlement_version_id::text IS DISTINCT FROM input_plan->>'entitlementVersionId' OR written_plan.authorization_state IS DISTINCT FROM 'active' OR written_plan.sequence::numeric IS DISTINCT FROM(input_plan->>'expectedSequence')::numeric+1 OR written_plan.replaces_id::text IS DISTINCT FROM input_plan->>'expectedPlanId' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_RESULT_REVIEW_REQUIRED';END IF;

  END LOOP;
 END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE OR REPLACE FUNCTION crest_private.operation_retirement_result(business uuid, actor uuid, original jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE o crest_private.operations;a record;decision jsonb;r jsonb;expected_delta jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=(original->'reference'->>'operationId')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF o.command_type<>'operation.retire' THEN
  IF o.command_type IS DISTINCT FROM original->>'commandType' OR NOT(o.schema_version=(CASE WHEN o.command_type='quote.amendment.create' THEN 3 ELSE 1 END) OR o.command_type IN('operations.job.book','operations.job.cancel') AND o.schema_version=2) OR o.state<>'committed' OR o.recovery_epoch::text IS DISTINCT FROM original->'reference'->>'recoveryEpoch' THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  -- Observation only. The caller must use the existing typed original lookup
  -- to validate receipt/source identity before clearing any pending reference.
  RETURN jsonb_build_object('schemaVersion',1,'state','original_recorded','original',original);
 END IF;
 decision:=o.result;r:=decision->'retirement';
 IF o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR jsonb_typeof(decision) IS DISTINCT FROM 'object' OR NOT(decision?&ARRAY['schemaVersion','state','original','retirement']) OR decision-ARRAY['schemaVersion','state','original','retirement']<>'{}'::jsonb OR decision->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR decision->>'state' IS DISTINCT FROM 'retired' OR decision->'original' IS DISTINCT FROM original OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']) OR r-ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']<>'{}'::jsonb OR r->>'operationRowId' IS DISTINCT FROM o.id::text OR r->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string' OR NOT crest_private.original_operation_uuid(r->'auditEventId') OR o.payload_hash IS DISTINCT FROM crest_private.operation_retirement_digest(actor,o.recovery_epoch,original,r->>'reason') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 expected_delta:=jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',o.id,'original',original,'recoveryEpoch',o.recovery_epoch,'reason',r->>'reason'));
 SELECT id,reason,recorded_at,delta,payload,hash_input,event_hash INTO a FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id AND entity_kind='operations' AND entity_id=o.id AND entity_version=1 AND action='retire';
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id)<>1 OR a.id::text IS DISTINCT FROM r->>'auditEventId' OR a.reason IS DISTINCT FROM r->>'reason' OR a.delta IS DISTINCT FROM expected_delta OR r->>'recordedAt' IS DISTINCT FROM to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') OR a.hash_input IS DISTINCT FROM a.payload::text OR a.event_hash IS DISTINCT FROM encode(sha256(convert_to(a.hash_input,'UTF8')),'hex') OR a.recorded_at<o.created_at OR a.recorded_at>o.committed_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 RETURN decision;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_booking_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_mode_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_mode_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_fulfillment_mode_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE prior jsonb:='null'::jsonb;
BEGIN
 IF NEW.sequence>1 THEN SELECT crest_private.fulfillment_mode_projection(v) INTO prior FROM crest.fulfillment_mode_versions v WHERE business_id=NEW.business_id AND sequence=NEW.replaces_sequence;END IF;
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.created_by AND a.entity_kind='fulfillment_modes' AND a.entity_id=NEW.business_id AND a.entity_version=NEW.sequence AND a.action=CASE WHEN NEW.sequence=1 THEN 'initialize' ELSE 'revise' END AND a.delta=jsonb_build_object('schemaVersion',1,'before',prior,'after',crest_private.fulfillment_mode_projection(NEW::crest.fulfillment_mode_versions)) AND o.state='committed' AND(o.schema_version=1 OR o.schema_version=2 AND o.command_type='operations.job.book') AND o.origin=NEW.origin AND o.import_row_id IS NULL AND(NEW.sequence=1 AND o.command_type IN('operations.fulfillment_modes.initialize','operations.job.book') OR NEW.sequence>1 AND o.command_type='operations.fulfillment_modes.save'))
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_mode_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_booking_integrity_owner;
RESET ROLE;
SET LOCAL ROLE crest_booking_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.validate_booking_reservation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE actor uuid;operation uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_BOOKING_FRESH_READ_REQUIRED';END IF;
 IF TG_OP='DELETE' THEN
  actor:=nullif(current_setting('crest.actor_id',true),'')::uuid;operation:=nullif(current_setting('crest.operation_id',true),'')::uuid;
  IF NOT EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=OLD.business_id AND operation_id=operation AND actor_id=actor AND state='pending' AND(schema_version=1 OR schema_version=2 AND command_type='operations.job.cancel') AND command_type IN('operations.job.reschedule','operations.job.cancel') AND origin='manual' AND import_row_id IS NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_BOOKING_RELEASE_CONTEXT_REQUIRED';END IF;
  PERFORM crest_private.lock_booking_operator(OLD.business_id,OLD.operator_actor_id);RETURN OLD;
 END IF;
 PERFORM crest_private.lock_booking_operator(NEW.business_id,NEW.operator_actor_id);RETURN NEW;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_booking_integrity_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-booking-commands.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-current-reads.sql
-- UNREGISTERED current and historical saved reads after accepted amendments.
-- Legacy1 packets remain unchanged for unbound initial work. Version2 carries
-- explicit current authorization and immutable original/encounter provenance.
DO $review$ BEGIN
 IF(SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,bigint,integer)') AND proowner='crest_quote_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='2aa729d15c9f195980effe0a42f8fe6730de10ab9e6aa93f813695b0d6df6a36')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_booking_agreement(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='f3bf5baa07146e53bd39407c6f28a3d106273138c023d2121177b237f0889aff')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.read_confirmed_job_resources(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid)') AND proowner='crest_booking_owner'::regrole AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='bde4a0bc4d089af1b902127fecaef8825f98332ec797cd6805bd3a69da300e65')
 OR(SELECT count(*) FROM pg_roles WHERE rolname IN('crest_quote_owner','crest_booking_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_quote_owner','crest_booking_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_CURRENT_READ_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner,crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_quote_amendment_workspace(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, requested_family uuid, requested_revision uuid, after_version bigint, page_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;f crest.quote_families;r crest.quote_revisions;g crest.agreements;parent_revision crest.quote_revisions;c crest.quote_family_commercial_state;p crest.quote_approvals;s crest.quote_sends;send_event uuid;accepted_row crest.quote_acceptances;accepted_original jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_family IS NULL OR requested_revision IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_READ_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_quote_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 -- Every mutation takes this family lock first. The shared lock keeps the
 -- multi-query packet coherent; it changes no business/operation/audit source.
 SELECT * INTO f FROM crest.quote_families WHERE business_id=requested_business AND id=requested_family FOR SHARE;
 SELECT * INTO r FROM crest.quote_revisions WHERE business_id=requested_business AND family_id=requested_family AND id=requested_revision AND kind='amendment';
 IF f.id IS NULL OR r.id IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 SELECT * INTO g FROM crest.agreements WHERE business_id=requested_business AND family_id=requested_family AND id=r.parent_agreement_id;
 SELECT q.* INTO parent_revision FROM crest.quote_acceptances a JOIN crest.quote_revisions q ON q.business_id=a.business_id AND q.family_id=a.family_id AND q.id=a.revision_id WHERE a.business_id=requested_business AND a.family_id=requested_family AND a.id=g.acceptance_id AND a.customer_id=g.customer_id;
 SELECT * INTO c FROM crest.quote_family_commercial_state WHERE business_id=requested_business AND family_id=requested_family;
 IF g.id IS NULL OR parent_revision.id IS NULL OR parent_revision.state<>'Accepted' OR c.id IS NULL OR c.initial_acceptance_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO p FROM crest.quote_approvals WHERE business_id=requested_business AND family_id=requested_family AND revision_id=requested_revision AND approved_content_version=r.content_version AND approved_content_hash=r.content_hash;
 -- Revision version orders actual send events, including a backwards wall
 -- clock. A later supersession is not mistaken for a delivery of this revision.
 SELECT sent.* INTO s FROM crest.quote_sends sent JOIN crest_private.audit_events a ON a.business_id=sent.business_id AND a.operation_id=sent.operation_id AND a.entity_kind='quote_revisions' AND a.entity_id=sent.revision_id AND a.action='send' AND a.delta->'after'->>'state'='Sent' WHERE sent.business_id=requested_business AND sent.family_id=requested_family AND sent.revision_id=requested_revision ORDER BY a.entity_version DESC LIMIT 1;
 SELECT id INTO send_event FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='quote_sends' AND entity_id=s.id AND entity_version=1 AND delta->'after'=crest_private.quote_sends_projection(s);
 IF s.id IS NOT NULL AND send_event IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
 WITH events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='quote_revisions' AND entity_id=requested_revision AND entity_version>after_version AND entity_version<=r.version ORDER BY entity_version LIMIT page_limit+1),page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'family',crest_private.quote_family_projection(f),'revision',crest_private.quote_revision_projection(r),'parent',jsonb_build_object('agreementId',g.id,'acceptanceId',g.acceptance_id,'versionNo',g.version_no::text,'customerId',g.customer_id,'sourceLeadId',f.lead_id,'revision',crest_private.quote_revision_projection(parent_revision)),
  'control',jsonb_build_object('version',c.version::text,'activeOfferId',c.active_offer_id,'initialAcceptanceId',c.initial_acceptance_id,'currentAgreementId',c.current_agreement_id),
  'items',coalesce((SELECT jsonb_agg(crest_private.quote_item_projection(i) ORDER BY position) FROM crest.quote_items i WHERE i.business_id=requested_business AND i.revision_id=requested_revision AND i.active),'[]'::jsonb),
  'approval',CASE WHEN p.id IS NULL THEN NULL ELSE crest_private.quote_approval_packet(p) END,
  'latestSend',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id',s.id,'approvalId',s.approval_id,'channel',s.channel,'recipientSnapshot',s.recipient_snapshot,'confirmedAt',to_char(s.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'evidenceNote',s.evidence_note,'presentationHash',s.presentation_hash,'operationId',s.operation_id,'auditEventId',send_event,'replacesRevisionId',s.replaces_revision_id) END,
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('eventId',id,'revision',entity_version::text,'action',action,'at',to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'actorId',actor_id,'operationId',operation_id,'before',delta->'before','after',delta->'after') ORDER BY entity_version) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM events)) INTO result;
 IF r.state='Accepted' THEN
  SELECT * INTO accepted_row FROM crest.quote_acceptances WHERE business_id=requested_business AND family_id=requested_family AND revision_id=requested_revision AND kind='amendment';
  IF accepted_row.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
  accepted_original:=crest_private.amendment_accept_result(requested_business,accepted_row.created_by,accepted_row.operation_id);
  IF accepted_original->>'state' IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_AMENDMENT_READ_RESULT_REVIEW_REQUIRED';END IF;
  result:=result||jsonb_build_object('schemaVersion',2,'acceptance',jsonb_build_object('request',accepted_row.request,'original',accepted_original,'recordedAt',to_char(accepted_row.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 END IF;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_AMENDMENT_READ_PAGE_LIMIT';END IF;RETURN result;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_booking_agreement(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, requested_family uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_family IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT CASE WHEN g.version_no>1 OR EXISTS(SELECT 1 FROM crest.allocation_plan_versions bound JOIN crest.scope_allocations root ON root.business_id=bound.business_id AND root.id=bound.source_allocation_id JOIN crest.scope_entitlements ent ON ent.business_id=root.business_id AND ent.id=root.entitlement_id WHERE bound.business_id=f.business_id AND ent.agreement_family_id=f.id AND bound.entitlement_version_id IS NOT NULL) THEN jsonb_build_object('schemaVersion',2,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'agreementId',g.id,'agreementVersion',g.version_no::text,'totalCents',g.total_cents::text,'sourceCount',(SELECT count(*) FROM crest.scope_entitlements counted WHERE counted.business_id=f.business_id AND counted.agreement_family_id=f.id),'customer',crest_private.customer_projection(c),
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',vehicle.id,'label',vehicle.label,'version',vehicle.version::text,'archivedAt',to_char(vehicle.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY vehicle.id) FROM crest.vehicles vehicle WHERE vehicle.business_id=requested_business AND EXISTS(SELECT 1 FROM crest.scope_entitlements ent WHERE ent.business_id=f.business_id AND ent.agreement_family_id=f.id AND ent.vehicle_id=vehicle.id)),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',s.id,'entitlementId',ent.id,'entitlementVersionId',CASE WHEN coalesce(plan.entitlement_version_id,s.entitlement_version_id)=ev.id THEN ev.id ELSE NULL END,'agreementId',ev.agreement_id,'sourcePartitionId',s.stable_partition_id,'vehicleId',ent.vehicle_id,'jobWide',ent.job_wide,
  'grossInclusiveCents',CASE WHEN plan.authorization_state='withdrawn' THEN '0' ELSE ev.scope_snapshot->>'grossCents' END,'discountInclusiveCents',CASE WHEN plan.authorization_state='withdrawn' THEN '0' ELSE((ev.scope_snapshot->>'lineDiscountCents')::bigint+(ev.scope_snapshot->>'allocatedDiscountCents')::bigint)::text END,'amountCents',ev.authorized_cents::text,'scopeDescription',ev.scope_snapshot->>'description',
  'authorizationState',CASE WHEN plan.entitlement_version_id IS NULL THEN 'active' ELSE plan.authorization_state END,'original',jsonb_build_object('agreementId',s.agreement_id,'entitlementVersionId',s.entitlement_version_id,'grossInclusiveCents',s.gross_inclusive_cents::text,'discountInclusiveCents',s.discount_inclusive_cents::text,'amountCents',s.amount_cents::text,'scopeDescription',s.scope_description),
  'planId',plan.id,'planSequence',coalesce(plan.sequence,0)::text,'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('partitionId',current_part.stable_partition_id,'jobId',current_part.job_id,'state',current_part.allocation_state,'grossInclusiveCents',current_part.gross_inclusive_cents::text,'discountInclusiveCents',current_part.discount_inclusive_cents::text,'amountCents',current_part.amount_cents::text,'scopeDescription',current_part.scope_description) ORDER BY current_part.stable_partition_id) FROM crest.current_scope_allocation_parts current_part WHERE current_part.business_id=s.business_id AND current_part.source_allocation_id=s.id),'[]'::jsonb)) ORDER BY s.id)
 FROM crest.scope_entitlements ent LEFT JOIN crest.scope_allocations s ON s.business_id=ent.business_id AND s.entitlement_id=ent.id
 LEFT JOIN crest.entitlement_versions ev ON ev.business_id=ent.business_id AND ev.family_id=ent.agreement_family_id AND ev.entitlement_id=ent.id AND ev.agreement_id=g.id
 LEFT JOIN LATERAL(SELECT selected.* FROM crest.allocation_plan_versions selected WHERE selected.business_id=s.business_id AND selected.source_allocation_id=s.id ORDER BY selected.sequence DESC LIMIT 1) plan ON true
 WHERE ent.business_id=f.business_id AND ent.agreement_family_id=f.id),'[]'::jsonb)) ELSE jsonb_build_object('schemaVersion',1,'businessId',requested_business,'familyId',f.id,'familyVersion',f.version::text,'agreementId',g.id,'agreementVersion',g.version_no::text,'customer',crest_private.customer_projection(c),
 'vehicles',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'label',v.label,'version',v.version::text,'archivedAt',to_char(v.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) ORDER BY v.id) FROM crest.vehicles v WHERE v.business_id=requested_business AND EXISTS(SELECT 1 FROM crest.scope_entitlements e JOIN crest.scope_allocations s ON s.business_id=e.business_id AND s.entitlement_id=e.id WHERE e.business_id=requested_business AND s.agreement_id=g.id AND e.vehicle_id=v.id)),'[]'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',s.id,'entitlementId',s.entitlement_id,'entitlementVersionId',s.entitlement_version_id,'agreementId',s.agreement_id,'sourcePartitionId',s.stable_partition_id,'vehicleId',e.vehicle_id,'jobWide',e.job_wide,'grossInclusiveCents',s.gross_inclusive_cents::text,'discountInclusiveCents',s.discount_inclusive_cents::text,'amountCents',s.amount_cents::text,'scopeDescription',s.scope_description,
 'planId',(SELECT p.id FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),
 'planSequence',coalesce((SELECT p.sequence::text FROM crest.allocation_plan_versions p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id ORDER BY p.sequence DESC LIMIT 1),'0'),
 'parts',(SELECT jsonb_agg(jsonb_build_object('partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=s.business_id AND p.source_allocation_id=s.id)) ORDER BY s.id)
 FROM crest.scope_allocations s JOIN crest.scope_entitlements e ON e.business_id=s.business_id AND e.id=s.entitlement_id WHERE s.business_id=requested_business AND s.agreement_id=g.id),'[]'::jsonb)) END INTO result
 FROM crest.quote_families f JOIN crest.quote_family_commercial_state control ON control.business_id=f.business_id AND control.family_id=f.id
 JOIN crest.agreements g ON g.business_id=f.business_id AND g.id=control.current_agreement_id AND g.family_id=f.id JOIN crest.customers c ON c.business_id=g.business_id AND c.id=g.customer_id
 WHERE f.business_id=requested_business AND f.id=requested_family;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE OR REPLACE FUNCTION crest_commands.read_confirmed_job_resources(credential_hash bytea, expected_session uuid, expected_actor uuid, expected_issuer text, expected_subject uuid, expected_provider_session uuid, provider_valid_until timestamp with time zone, requested_business uuid, requested_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BOOKING_CONTEXT_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT CASE WHEN EXISTS(SELECT 1 FROM crest.current_scope_allocation_parts current_part JOIN crest.allocation_plan_versions bound ON bound.business_id=current_part.business_id AND bound.id=current_part.plan_id WHERE current_part.business_id=j.business_id AND current_part.job_id=j.id AND bound.entitlement_version_id IS NOT NULL) OR EXISTS(SELECT 1 FROM crest.job_encounters encounter JOIN crest.quote_family_commercial_state current_family ON current_family.business_id=encounter.business_id AND current_family.family_id=encounter.family_id WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND current_family.current_agreement_id IS DISTINCT FROM encounter.agreement_id) THEN jsonb_build_object('schemaVersion',2,'businessId',requested_business,'jobId',j.id,'head',crest_private.booking_job_display_snapshot(j),
 'vehicles',(SELECT jsonb_agg(crest_private.job_vehicles_projection(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
 'encounters',(SELECT jsonb_agg(crest_private.job_encounters_projection(e) ORDER BY e.id) FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
 'scopeParts',coalesce((SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',p.source_allocation_id,'entitlementId',p.entitlement_id,'entitlementVersionId',p.entitlement_version_id,'agreementId',CASE WHEN p.agreement_id=control.current_agreement_id THEN p.agreement_id ELSE NULL END,'familyId',ent.agreement_family_id,
 'encounterAgreementId',(SELECT encounter.agreement_id FROM crest.job_encounters encounter WHERE encounter.business_id=j.business_id AND encounter.job_id=j.id AND encounter.family_id=ent.agreement_family_id),
 'planId',p.plan_id,'planSequence',p.plan_sequence::text,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.source_allocation_id,p.stable_partition_id)
 FROM crest.current_scope_allocation_parts p LEFT JOIN crest.scope_entitlements ent ON ent.business_id=p.business_id AND ent.id=p.entitlement_id LEFT JOIN crest.quote_family_commercial_state control ON control.business_id=ent.business_id AND control.family_id=ent.agreement_family_id WHERE p.business_id=j.business_id AND p.job_id=j.id),'[]'::jsonb)) ELSE jsonb_build_object('schemaVersion',1,'businessId',requested_business,'jobId',j.id,'head',crest_private.booking_job_display_snapshot(j),
 'vehicles',(SELECT jsonb_agg(crest_private.job_vehicles_projection(v) ORDER BY v.id) FROM crest.job_vehicles v WHERE v.business_id=j.business_id AND v.job_id=j.id),
 'encounters',(SELECT jsonb_agg(crest_private.job_encounters_projection(e) ORDER BY e.id) FROM crest.job_encounters e WHERE e.business_id=j.business_id AND e.job_id=j.id),
 'scopeParts',(SELECT jsonb_agg(jsonb_build_object('sourceAllocationId',p.source_allocation_id,'entitlementId',p.entitlement_id,'entitlementVersionId',p.entitlement_version_id,'agreementId',p.agreement_id,'planId',p.plan_id,'planSequence',p.plan_sequence::text,'partitionId',p.stable_partition_id,'jobId',p.job_id,'state',p.allocation_state,'grossInclusiveCents',p.gross_inclusive_cents::text,'discountInclusiveCents',p.discount_inclusive_cents::text,'amountCents',p.amount_cents::text,'scopeDescription',p.scope_description) ORDER BY p.source_allocation_id,p.stable_partition_id) FROM crest.current_scope_allocation_parts p WHERE p.business_id=j.business_id AND p.job_id=j.id)) END INTO result FROM crest.jobs j WHERE j.business_id=requested_business AND j.id=requested_job;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_BOOKING_CONTEXT_LIMIT';END IF;
 PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);RETURN coalesce(result,jsonb_build_object('state','absent'));
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner,crest_booking_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-current-reads.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-cancellation-lifecycle.sql
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

RESET ROLE;
-- END REVIEWED planning/proposals/quote-cancellation-lifecycle.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-cancellation-edit.sql
-- UNREGISTERED cancellation editing, over exact registered52 plus reviewed proposals.
-- Wire2 / quote.draft.save request+receipt4 is exclusively an existing content3
-- amendment edit. Initial/ordinary save1/2 and creation3 stay separate.
-- No new operation kind, browser persistence, financial or visit mutation.
DO $review$ BEGIN
 IF(SELECT count(*) FROM supabase_migrations.schema_migrations)<>52 OR to_regprocedure('crest_private.check_quote_cancellation_edit_operation()') IS NOT NULL
 OR(SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_quote_integrity_owner') AND a.grantee<>r.oid)
 OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_quote_integrity_owner'::regrole) AND a.grantee<>d.defaclrole)
 OR EXISTS(SELECT 1 FROM pg_class WHERE oid IN('crest_private.operations'::regclass,'crest.quote_revisions'::regclass,'crest.quote_families'::regclass) AND(relowner<>'crest_schema_owner'::regrole OR NOT relrowsecurity OR NOT relforcerowsecurity))
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.save_quote_draft(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,bigint,bigint,jsonb)') AND proowner='crest_quote_owner'::regrole AND coalesce(proacl::text,'')='{crest_quote_owner=X/crest_quote_owner,crest_web=X/crest_quote_owner}' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='12954b3677bbbac5741361b579c14e9668895302c4da9bf336c752f18557c970')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_operation_result(uuid,uuid,uuid)') AND proowner='crest_quote_owner'::regrole AND coalesce(proacl::text,'')='{crest_quote_owner=X/crest_quote_owner,crest_quote_integrity_owner=X/crest_quote_owner}' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='aa85ec724a63de6d33ec284fe6ca1fcc92c1aa8da1e67b9ea3fb0fb4fa7274a7')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_audit()') AND proowner='crest_quote_integrity_owner'::regrole AND coalesce(proacl::text,'')='{crest_quote_integrity_owner=X/crest_quote_integrity_owner}' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='adf3c16782d884b7ffc17b832e1b7ff742d9e47c6c55a4bd9bc9cb14f3eaa55d')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.valid_quote_cancellation_payload(jsonb)') AND proowner='crest_quote_owner'::regrole AND coalesce(proacl::text,'')='{crest_quote_owner=X/crest_quote_owner,crest_quote_integrity_owner=X/crest_quote_owner}' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='94ba655f2ae720fdc2472d48e0e622c1de3302fa08e8422ecc541d29511159a6')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.validate_quote_revision_change()') AND proowner='crest_schema_owner'::regrole AND coalesce(proacl::text,'')='{crest_schema_owner=X/crest_schema_owner}' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='0b8af9ef98b1aa8445dc41f7dbd5479e44ca458b25c120309df1389efe9f1380')
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.check_quote_aggregate()') AND proowner='crest_quote_integrity_owner'::regrole AND coalesce(proacl::text,'')='{crest_quote_integrity_owner=X/crest_quote_integrity_owner}' AND encode(sha256(convert_to(pg_get_functiondef(oid),'UTF8')),'hex')='e41043dc20fb46edfcd31fe330ef482024cd0ecb5ed01c9efa73adf04edcf7a4')
 OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='crest_private.operations'::regclass AND polname='quote_command_operations_create' AND polcmd='a' AND polpermissive AND polroles=ARRAY['crest_quote_owner'::regrole::oid] AND polqual IS NULL AND pg_get_expr(polwithcheck,polrelid)='((business_id = (NULLIF(current_setting(''crest.business_id''::text, true), ''''::text))::uuid) AND (actor_id = (NULLIF(current_setting(''crest.actor_id''::text, true), ''''::text))::uuid) AND (created_by = actor_id) AND (operation_id = (NULLIF(current_setting(''crest.operation_id''::text, true), ''''::text))::uuid) AND (((command_type = ''quote.draft.save''::text) AND (schema_version = ANY (ARRAY[1, 2]))) OR ((command_type = ''quote.replacement.create''::text) AND (schema_version = 2)) OR ((command_type = ''quote.amendment.create''::text) AND (schema_version = 3)) OR ((command_type = ANY (ARRAY[''quote.review.submit''::text, ''quote.review.approve''::text, ''quote.manual.send''::text, ''quote.confirmation.accept''::text, ''quote.amendment.send''::text])) AND (schema_version = 1))) AND (origin = ''manual''::text) AND (import_row_id IS NULL))')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CANCELLATION_EDIT_SOURCE_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_private TO crest_quote_integrity_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_quote_owner;
ALTER POLICY quote_command_operations_create ON crest_private.operations WITH CHECK ((business_id = (NULLIF(current_setting('crest.business_id'::text, true), ''::text))::uuid) AND (actor_id = (NULLIF(current_setting('crest.actor_id'::text, true), ''::text))::uuid) AND (created_by = actor_id) AND (operation_id = (NULLIF(current_setting('crest.operation_id'::text, true), ''::text))::uuid) AND (((command_type = 'quote.draft.save'::text) AND (schema_version = ANY (ARRAY[1, 2, 4]))) OR ((command_type = 'quote.replacement.create'::text) AND (schema_version = 2)) OR ((command_type = 'quote.amendment.create'::text) AND (schema_version = 3)) OR ((command_type = ANY (ARRAY['quote.review.submit'::text, 'quote.review.approve'::text, 'quote.manual.send'::text, 'quote.confirmation.accept'::text, 'quote.amendment.send'::text])) AND (schema_version = 1))) AND (origin = 'manual'::text) AND (import_row_id IS NULL));
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
 IF requested_operation IS NULL OR requested_family IS NULL OR requested_revision IS NULL OR (request_schema IS NULL OR request_schema NOT IN(1,2,4) OR body->'customer'->'schemaVersion' IS DISTINCT FROM to_jsonb(CASE WHEN request_schema=4 THEN 3 ELSE request_schema END)) OR expected_family_version IS NULL OR expected_revision_version IS NULL OR expected_family_version<0 OR expected_revision_version<0 OR (expected_family_version=0)<>(expected_revision_version=0) OR NOT crest_private.valid_quote_draft_payload(body) OR request_schema=4 AND(expected_family_version<1 OR expected_revision_version<1 OR NOT crest_private.valid_quote_cancellation_payload(body)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_QUOTE_INPUT_REQUIRED';END IF;
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
   IF request_schema=4 AND(old_revision.kind IS DISTINCT FROM 'amendment' OR old_revision.customer_safe_snapshot->'schemaVersion' IS DISTINCT FROM '3'::jsonb) THEN RAISE EXCEPTION USING ERRCODE='P1004',MESSAGE='CREST_QUOTE_STATE_CONFLICT';END IF;
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
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',request_schema,'businessId',requested_business,'familyId',family.id,'familyVersion',family.version::text,'revisionId',revision.id,'revisionVersion',revision.version::text,'contentVersion',revision.content_version::text,'contentHash',revision.content_hash,'familyAuditEventId',family_event,'revisionAuditEventId',revision_event,'itemAuditEventIds',item_events)||(CASE WHEN request_schema IN(2,4) THEN jsonb_build_object('assessmentAuditEventIds',assessment_events) ELSE '{}'::jsonb END));
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
 IF o.state<>'committed' OR o.schema_version NOT IN(1,2,3,4) OR (o.command_type='quote.amendment.create') IS DISTINCT FROM (o.schema_version=3) OR o.result_schema_version<>o.schema_version OR jsonb_typeof(receipt) IS DISTINCT FROM 'object' OR NOT(receipt ?& ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']) OR receipt-ARRAY['schemaVersion','businessId','familyId','familyVersion','revisionId','revisionVersion','contentVersion','contentHash','familyAuditEventId','revisionAuditEventId','itemAuditEventIds']-(CASE WHEN o.schema_version IN(2,3,4) THEN ARRAY['assessmentAuditEventIds'] ELSE ARRAY[]::text[] END)-(CASE WHEN o.schema_version=3 THEN ARRAY['parentAgreementId','parentAgreementVersion','parentAcceptedHash'] ELSE ARRAY[]::text[] END)<>'{}'::jsonb OR receipt->'schemaVersion' IS DISTINCT FROM to_jsonb(o.schema_version) OR receipt->>'businessId' IS DISTINCT FROM requested_business::text OR jsonb_typeof(receipt->'itemAuditEventIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_RESULT_REVIEW_REQUIRED';END IF;
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
 IF body->'customer'->'schemaVersion'='3'::jsonb AND(NOT(o.command_type='quote.amendment.create' AND o.schema_version=3 OR o.command_type='quote.draft.save' AND o.schema_version=4) OR r->>'kind' IS DISTINCT FROM 'amendment') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_CANCELLATION_REQUIRES_AMENDMENT';END IF;
 IF o.schema_version=4 AND(o.command_type<>'quote.draft.save' OR expected_family::numeric<1 OR expected_revision::numeric<1 OR r->>'kind' IS DISTINCT FROM 'amendment' OR body->'customer'->'schemaVersion' IS DISTINCT FROM '3'::jsonb OR revision_audit.delta->'before'->>'kind' IS DISTINCT FROM 'amendment' OR revision_audit.delta->'before'->'customer_safe_snapshot'->'schemaVersion' IS DISTINCT FROM '3'::jsonb OR r->>'parent_agreement_id' IS DISTINCT FROM revision_audit.delta->'before'->>'parent_agreement_id' OR (r->>'content_version')::numeric IS DISTINCT FROM (revision_audit.delta->'before'->>'content_version')::numeric+1 OR r->>'state' IS DISTINCT FROM 'Draft' OR revision_audit.delta->'before'->>'state' NOT IN('Draft','Ready for Review') OR r->>'canonical_content' IS NOT DISTINCT FROM revision_audit.delta->'before'->>'canonical_content' OR receipt->'itemAuditEventIds' IS DISTINCT FROM '[]'::jsonb OR receipt->'assessmentAuditEventIds' IS DISTINCT FROM '[]'::jsonb) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_EDIT_RESULT_REVIEW_REQUIRED';END IF;
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
 IF o.schema_version IN(2,3,4) THEN
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
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE OR REPLACE FUNCTION crest_private.check_quote_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
 SET row_security TO 'on'
AS $function$
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
 IF kind IN('quote_families','quote_revisions') AND EXISTS(SELECT 1 FROM crest_private.operations WHERE business_id=NEW.business_id AND operation_id=NEW.operation_id AND actor_id=NEW.updated_by AND command_type IN('quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept')) THEN
  SELECT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=CASE WHEN kind='quote_families' THEN 'quote_revisions' ELSE 'quote_families' END AND (kind='quote_families' AND a.delta->'after'->>'family_id'=NEW.id::text OR kind='quote_revisions' AND a.entity_id::text=(to_jsonb(NEW)->>'family_id'))) INTO published;
 END IF;
 IF NOT published OR NOT EXISTS(SELECT 1 FROM crest_private.audit_events a JOIN crest_private.operations o ON o.business_id=a.business_id AND o.operation_id=a.operation_id AND o.actor_id=a.actor_id
  WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind=kind AND a.entity_id=NEW.id AND a.entity_version=NEW.version
   AND a.action=(CASE o.command_type WHEN 'quote.review.submit' THEN 'submit' WHEN 'quote.review.approve' THEN 'approve' WHEN 'quote.manual.send' THEN 'send' WHEN 'quote.amendment.send' THEN 'send' WHEN 'quote.amendment.accept' THEN 'accept' WHEN 'quote.confirmation.accept' THEN 'accept' ELSE CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'edit' END END) AND a.delta->'before'=prior AND a.delta->'after'=following
   AND (o.command_type IN('quote.draft.save','quote.replacement.create') AND o.schema_version IN(1,2) OR o.command_type='quote.draft.save' AND o.schema_version=4 AND kind IN('quote_families','quote_revisions') AND TG_OP='UPDATE' OR o.command_type='quote.amendment.create' AND o.schema_version=3 OR o.command_type IN('quote.review.submit','quote.review.approve','quote.manual.send','quote.confirmation.accept','quote.amendment.send','quote.amendment.accept') AND o.schema_version=1 AND kind IN('quote_families','quote_revisions') AND TG_OP='UPDATE') AND o.origin=NEW.origin AND o.import_row_id IS NOT DISTINCT FROM NEW.import_row_id)
 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_QUOTE_AUDIT_REQUIRED';END IF;
 RETURN NULL;
END $function$
;
RESET ROLE;
SET LOCAL ROLE crest_quote_integrity_owner;
CREATE FUNCTION crest_private.check_quote_cancellation_edit_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE outcome jsonb;BEGIN
 PERFORM set_config('crest.business_id',NEW.business_id::text,true),set_config('crest.actor_id',NEW.actor_id::text,true);
 outcome:=crest_private.quote_operation_result(NEW.business_id,NEW.actor_id,NEW.operation_id);
 IF NEW.command_type<>'quote.draft.save' OR NEW.schema_version<>4 OR outcome->>'state' IS DISTINCT FROM 'committed' OR outcome->>'operationId' IS DISTINCT FROM NEW.operation_id::text OR outcome->'receipt'->'schemaVersion' IS DISTINCT FROM '4'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_CANCELLATION_EDIT_RESULT_REVIEW_REQUIRED';END IF;RETURN NULL;
END $check$;
REVOKE ALL ON FUNCTION crest_private.check_quote_cancellation_edit_operation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.check_quote_cancellation_edit_operation() TO crest_schema_owner;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
CREATE CONSTRAINT TRIGGER quote_cancellation_edit_operation_integrity AFTER INSERT OR UPDATE ON crest_private.operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.command_type='quote.draft.save' AND NEW.schema_version=4) EXECUTE FUNCTION crest_private.check_quote_cancellation_edit_operation();
REVOKE CREATE ON SCHEMA crest_private FROM crest_quote_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_quote_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-cancellation-edit.sql

RESET ROLE;
-- BEGIN REVIEWED planning/proposals/quote-amendment-accepted-source.sql
-- UNREGISTERED accepted-amendment included source profile over exact52 plus
-- reviewed acceptance/booking/cancellation construction. No owner upgrade.
-- Separate export principal, fixed readers, held RR READ ONLY, no table grant.
DO $review$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>52
  OR (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY (n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7'
  OR to_regprocedure('crest_commands.quote_amendment_accepted_source_context(uuid)') IS NOT NULL
  OR to_regprocedure('crest_commands.quote_amendment_accepted_source_acceptances(uuid,text,uuid,integer)') IS NOT NULL
  OR to_regprocedure('crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer)') IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_acceptances_projection(crest.quote_acceptances)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND NOT proleakproof AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='29393dcb23cb40312fb7ebfe3c39ac862122a7f5f768b905db7d29006ab0d6ea')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.allocation_plan_versions_projection(crest.allocation_plan_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND NOT proleakproof AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='0b7911ff4f2a4a4fade8f6fe21d165e56ced9d634a227108416b31be4caf6b87')
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_booking_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner','crest_booking_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole,'crest_booking_owner'::regrole) AND d.defaclobjtype='f' AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND (has_schema_privilege('crest_export',oid,'CREATE') OR has_schema_privilege('crest_quote_owner',oid,'CREATE') OR has_schema_privilege('crest_booking_owner',oid,'CREATE')))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner,crest_booking_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_commands.quote_amendment_accepted_source_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE prior jsonb;
BEGIN
 IF (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY (n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_REVIEW_REQUIRED';END IF;
 prior:=crest_commands.quote_amendment_snapshot_context(requested_business);
 RETURN jsonb_build_object('schemaVersion',2,'scope','accepted_amendment_sources','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.quote-amendment.snapshot/2','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'legacyAmendmentSnapshotToken',prior->>'snapshotToken','commercialSnapshotToken',prior->>'commercialSnapshotToken','quoteReviewSnapshotToken',prior->>'quoteReviewSnapshotToken','expectedCounts',prior->'expectedCounts','quoteCounts',prior->'quoteCounts');
END $context$;
CREATE FUNCTION crest_commands.quote_amendment_accepted_source_acceptances(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.quote_amendment_accepted_source_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_acceptances WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'acceptances',coalesce(jsonb_agg(crest_private.quote_acceptances_projection(p::crest.quote_acceptances)||jsonb_build_object('kind',p.kind) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.quote_acceptances later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
REVOKE ALL ON FUNCTION crest_commands.quote_amendment_accepted_source_context(uuid),crest_commands.quote_amendment_accepted_source_acceptances(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.quote_amendment_accepted_source_context(uuid),crest_commands.quote_amendment_accepted_source_acceptances(uuid,text,uuid,integer) TO crest_export;
RESET ROLE;
SET LOCAL ROLE crest_booking_owner;
CREATE FUNCTION crest_commands.quote_amendment_accepted_source_plans(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 IF (SELECT encode(sha256(convert_to(string_agg(n.nspname||'.'||c.relname||'.'||a.attname,E'\n' ORDER BY (n.nspname||'.'||c.relname||'.'||a.attname) COLLATE "C"),'UTF8')),'hex') FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='crest' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped) IS DISTINCT FROM '88dd35a53293695875c7d00714c2eb9263f0c93299f706c620c5db46bda195f7' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_REVIEW_REQUIRED';END IF;
 context:=crest_commands.booking_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.allocation_plan_versions WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',2,'businessId',requested_business,'snapshotToken',expected_snapshot,'rows',coalesce(jsonb_agg(crest_private.allocation_plan_versions_projection(p::crest.allocation_plan_versions)||jsonb_build_object('entitlement_version_id',p.entitlement_version_id,'authorization_state',p.authorization_state) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.allocation_plan_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_ACCEPTED_AMENDMENT_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
REVOKE ALL ON FUNCTION crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.quote_amendment_accepted_source_plans(uuid,text,uuid,integer) TO crest_export;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner,crest_booking_owner;
RESET ROLE;

RESET ROLE;
-- END REVIEWED planning/proposals/quote-amendment-accepted-source.sql
