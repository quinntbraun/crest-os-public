-- Unregistered source snapshot RPCs. Reuse the existing export credential and
-- one owned read-only repeatable-read transaction. No new archive framework.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_hold_owner','crest_export') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>2
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname='crest_hold_owner')
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege('crest_hold_owner',oid,'CREATE'))
  OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.appointment_hold_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid='crest.appointment_hold_versions'::regclass AND attnum>0 AND NOT attisdropped) IS DISTINCT FROM ARRAY['id','business_id','hold_id','sequence','replaces_sequence','customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason','created_at','created_by','operation_id','origin']

  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('crest_private.appointment_hold_projection(crest.appointment_hold_versions)') AND proowner='crest_schema_owner'::regrole AND NOT prosecdef AND provolatile='i' AND NOT proleakproof AND lower(array_to_string(proconfig,','))='search_path=pg_catalog, pg_temp' AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='4d8d261441e757bd25a5e23644fa8e4b9ccffd0eeef68de37206b2d886e7823c') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id) ON crest.businesses TO crest_hold_owner;
CREATE POLICY hold_export_business ON crest.businesses FOR SELECT TO crest_hold_owner USING(id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE FUNCTION crest_commands.appointment_hold_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE versions bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_HOLD_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_SCOPE_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO versions FROM crest.appointment_hold_versions WHERE business_id=requested_business;
 IF versions>10000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_HOLD_SOURCE_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','appointment_holds','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.appointment-hold.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'expectedVersionCount',versions::text);
END $context$;
CREATE FUNCTION crest_commands.appointment_hold_snapshot_versions(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.appointment_hold_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit<1 OR page_limit>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_SNAPSHOT_REQUIRED';END IF;
 WITH page AS MATERIALIZED(SELECT * FROM crest.appointment_hold_versions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'versions',coalesce(jsonb_agg(crest_private.appointment_hold_projection(p::crest.appointment_hold_versions) ORDER BY p.id),'[]'::jsonb),'hasMore',EXISTS(SELECT 1 FROM crest.appointment_hold_versions later WHERE later.business_id=requested_business AND later.id>(SELECT last.id FROM page last ORDER BY last.id DESC LIMIT 1))) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_HOLD_SOURCE_LIMIT';END IF;RETURN result;
END $page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_hold_owner;
ALTER FUNCTION crest_commands.appointment_hold_snapshot_context(uuid) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.appointment_hold_snapshot_versions(uuid,text,uuid,integer) OWNER TO crest_hold_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_hold_owner;
REVOKE ALL ON FUNCTION crest_commands.appointment_hold_snapshot_context(uuid),crest_commands.appointment_hold_snapshot_versions(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.appointment_hold_snapshot_context(uuid),crest_commands.appointment_hold_snapshot_versions(uuid,text,uuid,integer) TO crest_export;
