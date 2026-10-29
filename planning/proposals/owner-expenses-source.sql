-- Unregistered financial source retrieval over registered48 plus expense overlays.
-- Privileged export credential only; not the ordinary web role or full backup proof.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_expense_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_expense_owner') OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_expense_owner',oid,'CREATE')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_commands.quote_commercial_snapshot_context(uuid)') AND proowner='crest_quote_owner'::regrole AND prosecdef AND provolatile='v' AND NOT proleakproof AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp,row_security=on' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='695968b644450c9789c86ba205962e17c6708f1e709fe1aa297f742cc28b5300') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
 IF (SELECT count(*) FROM pg_class WHERE oid IN('crest.expense_revisions'::regclass,'crest.expense_receipt_revisions'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>2 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPENSE_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.expense_source_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE commercial jsonb;expenses bigint;receipts bigint;BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPENSE_SOURCE_SCOPE_REQUIRED';END IF;
 commercial:=crest_commands.quote_commercial_snapshot_context(requested_business);
 SELECT count(*) INTO expenses FROM crest.expense_revisions WHERE business_id=requested_business;
 SELECT count(*) INTO receipts FROM crest.expense_receipt_revisions WHERE business_id=requested_business;
 IF expenses+receipts>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_EXPENSE_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','owner_expense_sources','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.expense-source.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'commercialSnapshotToken',commercial->>'snapshotToken','expectedCounts',jsonb_build_object('expenses',expenses::text,'receipts',receipts::text));
END $context$;
CREATE FUNCTION crest_commands.expense_source_snapshot_expenses(requested_business uuid,expected_snapshot text,after_id uuid,after_revision bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;BEGIN
 context:=crest_commands.expense_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 OR (after_id IS NULL)<>(after_revision IS NULL) OR after_revision<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.expense_revisions WHERE business_id=requested_business AND (after_id IS NULL OR (expense_id,revision)>(after_id,after_revision)) ORDER BY expense_id,revision LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'expenses',coalesce(jsonb_agg(jsonb_build_object('business_id',p.business_id,'expense_id',p.expense_id,'revision',p.revision::text,'operation_id',p.operation_id,'actor_id',p.actor_id,'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'payload',p.payload) ORDER BY p.expense_id,p.revision),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.expense_revisions later WHERE later.business_id=requested_business AND (later.expense_id,later.revision)>(SELECT last.expense_id,last.revision FROM page last ORDER BY last.expense_id DESC,last.revision DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_EXPENSE_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
CREATE FUNCTION crest_commands.expense_source_snapshot_receipts(requested_business uuid,expected_snapshot text,after_id uuid,after_revision bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;BEGIN
 context:=crest_commands.expense_source_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 OR (after_id IS NULL)<>(after_revision IS NULL) OR after_revision<1 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPENSE_SOURCE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.expense_receipt_revisions WHERE business_id=requested_business AND (after_id IS NULL OR (receipt_id,revision)>(after_id,after_revision)) ORDER BY receipt_id,revision LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'receipts',coalesce(jsonb_agg(jsonb_build_object('business_id',p.business_id,'receipt_id',p.receipt_id,'revision',p.revision::text,'expense_id',p.expense_id,'expense_revision',p.expense_revision::text,'operation_id',p.operation_id,'actor_id',p.actor_id,'recorded_at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'reservation',p.reservation,'candidate',p.candidate) ORDER BY p.receipt_id,p.revision),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.expense_receipt_revisions later WHERE later.business_id=requested_business AND (later.receipt_id,later.revision)>(SELECT last.receipt_id,last.revision FROM page last ORDER BY last.receipt_id DESC,last.revision DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_EXPENSE_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_expense_owner;
ALTER FUNCTION crest_commands.expense_source_snapshot_context(uuid) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.expense_source_snapshot_expenses(uuid,text,uuid,bigint,integer) OWNER TO crest_expense_owner;
ALTER FUNCTION crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) OWNER TO crest_expense_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_expense_owner;
REVOKE ALL ON FUNCTION crest_commands.expense_source_snapshot_context(uuid),crest_commands.expense_source_snapshot_expenses(uuid,text,uuid,bigint,integer),crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.expense_source_snapshot_context(uuid),crest_commands.expense_source_snapshot_expenses(uuid,text,uuid,bigint,integer),crest_commands.expense_source_snapshot_receipts(uuid,text,uuid,bigint,integer) TO crest_export;
GRANT EXECUTE ON FUNCTION crest_commands.quote_commercial_snapshot_context(uuid) TO crest_expense_owner;
