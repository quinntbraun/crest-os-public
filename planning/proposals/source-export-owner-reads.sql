-- UNREGISTERED forward43 supplement, after the six journal proposals.
-- Bounded live owner metadata only; no dispatch, raw source or download grant.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest_private.export_jobs'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
 OR has_schema_privilege('crest_command_owner','crest_commands','CREATE')
 OR EXISTS(SELECT 1 FROM (VALUES
 ('crest_commands.authorize_source_export_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','3ec3c8f8338dec214fa63f9ca81d086badbdd44817e18222262275ead503f4d6','crest_session_owner',true,'v','plpgsql'),
 ('crest_private.source_export_job_projection(crest_private.export_jobs)','0219e951c2ccb4259c49e7f422606c57d84a8ceb1469440ad6101c0c2dad8bb1','crest_schema_owner',false,'i','sql')
 ) expected(signature,digest,owner,definer,volatility,language)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature) LEFT JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid IS NULL OR p.proowner<>expected.owner::regrole OR p.prosecdef<>expected.definer OR p.provolatile::text<>expected.volatility OR l.lanname<>expected.language
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>expected.digest OR cardinality(p.proconfig)<>(CASE WHEN expected.definer THEN 2 ELSE 1 END)
 OR NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) setting WHERE setting~'^search_path=pg_catalog, *pg_temp$')
 OR expected.definer AND NOT('row_security=on'=ANY(p.proconfig))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_OWNER_READ_SOURCE_REVIEW_REQUIRED';
 END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.list_source_exports(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,before_created_at text,before_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;before_stamp timestamptz;page jsonb;next_cursor jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF (before_created_at IS NULL)<>(before_id IS NULL) OR before_created_at IS NOT NULL AND (length(before_created_at)<>27 OR before_created_at!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_OWNER_CURSOR_REQUIRED';END IF;
 IF before_created_at IS NOT NULL THEN
  before_stamp:=before_created_at::timestamptz;
  IF NOT isfinite(before_stamp) OR to_char(before_stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>before_created_at THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_OWNER_CURSOR_REQUIRED';END IF;
 END IF;
 context:=crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 IF before_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest_private.export_jobs WHERE business_id=requested_business AND id=before_id AND created_at=before_stamp) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_OWNER_CURSOR_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(crest_private.source_export_job_projection(j::crest_private.export_jobs) ORDER BY j.created_at DESC,j.id DESC),'[]'::jsonb) INTO page
 FROM (SELECT * FROM crest_private.export_jobs WHERE business_id=requested_business AND (before_id IS NULL OR (created_at,id)<(before_stamp,before_id)) ORDER BY created_at DESC,id DESC LIMIT 6) j;
 IF jsonb_array_length(page)=6 THEN next_cursor:=jsonb_build_object('createdAt',page->4->>'created_at','id',page->4->>'id');page:=page-5;ELSE next_cursor:=NULL;END IF;
 -- Recheck recent/current authority after any possible source wait. A cursor
 -- and prior page never serve as reusable authority for this live read.
 PERFORM crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 RETURN jsonb_build_object('schemaVersion',1,'jobs',page,'next',next_cursor);
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.list_source_exports(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.list_source_exports(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.list_source_exports(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,text,uuid) TO crest_web;
