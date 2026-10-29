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
