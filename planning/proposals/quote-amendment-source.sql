-- UNREGISTERED source retrieval over51 plus the amendment construction.
-- New profile only. Frozen initial-only readers, migrations and backups stay
-- unchanged. Separate export credential; no browser/production activation.
DO $review$
BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>51
  OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='crest.quote_revisions'::regclass AND attname='parent_agreement_id' AND atttypid='uuid'::regtype AND NOT attnotnull AND NOT attisdropped)
  OR to_regprocedure('crest_commands.read_quote_amendment_workspace(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,bigint,integer)') IS NULL
  OR to_regprocedure('crest_commands.quote_amendment_snapshot_context(uuid)') IS NOT NULL
  OR to_regprocedure('crest_commands.quote_amendment_snapshot_revisions(uuid,text,uuid,integer)') IS NOT NULL
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_quote_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole) OR member IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole))
  OR EXISTS(SELECT 1 FROM pg_roles r,LATERAL aclexplode(coalesce((SELECT d.defaclacl FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace=0 AND d.defaclobjtype='f'),acldefault('f',r.oid))) a WHERE r.rolname IN('crest_schema_owner','crest_quote_owner') AND a.grantee<>r.oid)
  OR EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole IN('crest_schema_owner'::regrole,'crest_quote_owner'::regrole) AND d.defaclobjtype='f' AND a.grantee<>d.defaclrole)
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND (has_schema_privilege('crest_export',oid,'CREATE') OR has_schema_privilege('crest_quote_owner',oid,'CREATE')))
  OR (SELECT count(*) FROM pg_class WHERE oid IN('crest.quote_families'::regclass,'crest.quote_revisions'::regclass,'crest.quote_items'::regclass,'crest.condition_assessments'::regclass,'crest.quote_approvals'::regclass,'crest.quote_sends'::regclass,'crest.quote_family_commercial_state'::regclass,'crest.quote_acceptances'::regclass,'crest.agreements'::regclass,'crest.scope_entitlements'::regclass,'crest.entitlement_versions'::regclass,'crest.scope_allocations'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>12
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_SOURCE_REVIEW_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.quote_commercial_snapshot_context(uuid)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='695968b644450c9789c86ba205962e17c6708f1e709fe1aa297f742cc28b5300' AND proowner='crest_quote_owner'::regrole AND prosecdef AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.quote_review_snapshot_context(uuid)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='b0ead7fc3a7c40a383939c1059166f6f41ff6db880579fce5ef205ce72c70790' AND proowner='crest_quote_owner'::regrole AND prosecdef AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, pg_temp','row_security=on'])
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.quote_revision_projection(crest.quote_revisions)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='79e69634d947e3517e872a3c032a9b0f9044b1828a50a4541e5385ce05c8c718' AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND NOT proleakproof AND provolatile='i' AND proconfig=ARRAY['search_path=pg_catalog, pg_temp'])
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_AMENDMENT_SOURCE_REVIEW_REQUIRED'; END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_quote_owner;
RESET ROLE;
SET LOCAL ROLE crest_quote_owner;
CREATE FUNCTION crest_commands.quote_amendment_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE commercial jsonb;review jsonb;
BEGIN
 -- Delegates the existing scope/capacity/RR READ ONLY checks. The shared held
 -- transaction, not a caller timestamp or updated_at watermark, is authority.
 commercial:=crest_commands.quote_commercial_snapshot_context(requested_business);
 review:=crest_commands.quote_review_snapshot_context(requested_business);
 IF commercial->>'quoteReviewSnapshotToken' IS DISTINCT FROM review->>'snapshotToken' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_AMENDMENT_SOURCE_SNAPSHOT_REQUIRED';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','quote_amendment_sources','businessId',requested_business,
  'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.quote-amendment.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),
  'commercialSnapshotToken',commercial->>'snapshotToken','quoteReviewSnapshotToken',review->>'snapshotToken',
  'expectedCounts',commercial->'expectedCounts','quoteCounts',review-'schemaVersion'-'scope'-'businessId'-'snapshotToken');
END $context$;
CREATE FUNCTION crest_commands.quote_amendment_snapshot_revisions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.quote_amendment_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_AMENDMENT_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.quote_revisions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,
  'revisions',coalesce(jsonb_agg(crest_private.quote_revision_projection(p::crest.quote_revisions)||jsonb_build_object('parent_agreement_id',p.parent_agreement_id) ORDER BY p.id),'[]'::jsonb),
  'hasMore',EXISTS(SELECT 1 FROM crest.quote_revisions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_AMENDMENT_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
REVOKE ALL ON FUNCTION crest_commands.quote_amendment_snapshot_context(uuid),crest_commands.quote_amendment_snapshot_revisions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.quote_amendment_snapshot_context(uuid),crest_commands.quote_amendment_snapshot_revisions(uuid,text,uuid,integer) TO crest_export;
RESET ROLE;
SET LOCAL ROLE crest_schema_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_quote_owner;
RESET ROLE;
