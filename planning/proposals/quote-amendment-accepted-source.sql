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
