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
