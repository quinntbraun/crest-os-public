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
