-- UNREGISTERED additive read/export body for proposal41 revision2.
-- The synthetic helper concatenates exact core bytes, one LF, then these bytes.
-- No published core or registered40 checksum is changed. Fresh proof required.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_lead_conversion(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;c crest.lead_conversions;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO c FROM crest.lead_conversions WHERE business_id=requested_business AND lead_id=requested_lead;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 PERFORM crest_private.assert_lead_conversion(c);
 result:=jsonb_build_object('schemaVersion',1,'businessId',requested_business,'conversion',crest_private.lead_conversion_projection(c));
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
CREATE FUNCTION crest_commands.read_lead_conversion_links(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,requested_conversion uuid,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;c crest.lead_conversions;l crest.conversion_links;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR requested_conversion IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO c FROM crest.lead_conversions WHERE business_id=requested_business AND lead_id=requested_lead AND id=requested_conversion;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;PERFORM crest_private.assert_lead_conversion(c);
 FOR l IN SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND conversion_id=c.id AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit LOOP PERFORM crest_private.assert_conversion_link(l);END LOOP;
 WITH matches AS MATERIALIZED(SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND conversion_id=c.id AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit+1),page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'conversion',crest_private.lead_conversion_projection(c),'links',coalesce((SELECT jsonb_agg(crest_private.conversion_link_projection(p::crest.conversion_links) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
CREATE FUNCTION crest_commands.lead_conversion_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE parents bigint;children bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_INPUT_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO parents FROM crest.lead_conversions WHERE business_id=requested_business;SELECT count(*) INTO children FROM crest.conversion_links WHERE business_id=requested_business;
 IF parents>1000 OR children>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','lead_conversion','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead.conversion.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'conversionCount',parents::text,'linkCount',children::text);
END $$;
CREATE FUNCTION crest_commands.lead_conversion_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;c crest.lead_conversions;result jsonb;
BEGIN
 context:=crest_commands.lead_conversion_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_REQUIRED';END IF;
 FOR c IN SELECT * FROM crest.lead_conversions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit LOOP PERFORM crest_private.assert_lead_conversion(c);END LOOP;
 WITH page AS(SELECT * FROM crest.lead_conversions WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'conversions',coalesce(jsonb_agg(crest_private.lead_conversion_projection(p::crest.lead_conversions) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
CREATE FUNCTION crest_commands.conversion_link_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;l crest.conversion_links;result jsonb;
BEGIN
 context:=crest_commands.lead_conversion_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_CONVERSION_SNAPSHOT_REQUIRED';END IF;
 FOR l IN SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit LOOP PERFORM crest_private.assert_conversion_link(l);END LOOP;
 WITH page AS(SELECT * FROM crest.conversion_links WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'links',coalesce(jsonb_agg(crest_private.conversion_link_projection(p::crest.conversion_links) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_CONVERSION_PAGE_LIMIT';END IF;RETURN result;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_conversion(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_conversion_links(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_conversion_snapshot_context(uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_conversion_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.conversion_link_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.read_lead_conversion(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_conversion_links(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,integer),crest_commands.lead_conversion_snapshot_context(uuid),crest_commands.lead_conversion_snapshot_page(uuid,text,uuid,integer),crest_commands.conversion_link_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_conversion(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_lead_conversion_links(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_conversion_snapshot_context(uuid),crest_commands.lead_conversion_snapshot_page(uuid,text,uuid,integer),crest_commands.conversion_link_snapshot_page(uuid,text,uuid,integer) TO crest_export;
