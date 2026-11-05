-- Unregistered construction over registered43 + the pinned catalog proposals.
-- Owner export tooling only; no HTTP route, ordinary web grant or adoption.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_catalog_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_catalog_owner')
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_catalog_owner',oid,'CREATE'))
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.services'::regclass,'crest.service_versions'::regclass,'crest.businesses'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED'; END IF;
 IF (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.services'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','code','current_version_id','active','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.service_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','service_id','sequence','name','inclusions','exclusions','internal_guidance','range_low_cents','range_high_cents','estimated_seconds','created_at','created_by','origin','operation_id','import_row_id']
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED'; END IF;
 IF (SELECT count(*) FROM (VALUES
  ('crest_private.service_projection(crest.services)','7682059c83fe884e2a3e9cd9149a9563633a54181fa6d2e465c2c4f392b991bf'),
  ('crest_private.service_version_projection(crest.service_versions)','896397db79799cbc5983cd807cc7ddf0a66b2302586b044d324336be410689a4')
 ) expected(signature,hash) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) WHERE p.proowner='crest_schema_owner'::regrole AND NOT p.prosecdef AND p.provolatile='i' AND NOT p.proleakproof AND lower(array_to_string(p.proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.hash)<>2
  OR NOT has_table_privilege('crest_catalog_owner','crest.services','SELECT')
  OR NOT has_table_privilege('crest_catalog_owner','crest.service_versions','SELECT')
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_CATALOG_SOURCE_REVIEW_REQUIRED'; END IF;
END $review$;
SET ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_catalog_owner;
CREATE POLICY catalog_export_business ON crest.businesses FOR SELECT TO crest_catalog_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.service_catalog_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE roots bigint; content bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_CATALOG_SNAPSHOT_REQUIRED'; END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SCOPE_REQUIRED'; END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SCOPE_REQUIRED'; END IF;
 SELECT count(*) INTO roots FROM crest.services WHERE business_id=requested_business;
 SELECT count(*) INTO content FROM crest.service_versions WHERE business_id=requested_business;
 IF roots>1000 OR content>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_SNAPSHOT_LIMIT'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','service_catalog','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.service-catalog.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'serviceCount',roots::text,'versionCount',content::text);
END $context$;
CREATE FUNCTION crest_commands.service_catalog_snapshot_services(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.service_catalog_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS(SELECT * FROM crest.services WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'services',coalesce(jsonb_agg(crest_private.service_projection(p::crest.services) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_PAGE_LIMIT'; END IF; RETURN result;
END $page$;
CREATE FUNCTION crest_commands.service_catalog_snapshot_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb; result jsonb;
BEGIN
 context:=crest_commands.service_catalog_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_CATALOG_SNAPSHOT_REQUIRED'; END IF;
 WITH page AS(SELECT * FROM crest.service_versions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'versions',coalesce(jsonb_agg(crest_private.service_version_projection(p::crest.service_versions) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_CATALOG_PAGE_LIMIT'; END IF; RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_catalog_owner;
ALTER FUNCTION crest_commands.service_catalog_snapshot_context(uuid) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer) OWNER TO crest_catalog_owner;
ALTER FUNCTION crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer) OWNER TO crest_catalog_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_catalog_owner;
REVOKE ALL ON FUNCTION crest_commands.service_catalog_snapshot_context(uuid),crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer),crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.service_catalog_snapshot_context(uuid),crest_commands.service_catalog_snapshot_services(uuid,text,uuid,integer),crest_commands.service_catalog_snapshot_versions(uuid,text,uuid,integer) TO crest_export;
