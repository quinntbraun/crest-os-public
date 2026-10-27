-- UNREGISTERED forward43 supplement, after the six journal proposals.
-- Bounded owner metadata/current download evidence; no object or byte delivery.
DO $review$ BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.export_jobs'::regclass,'crest_private.export_job_snapshots'::regclass,'crest_private.export_part_intents'::regclass,'crest_private.export_part_verifications'::regclass,'crest_private.export_job_completions'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>5
 OR has_schema_privilege('crest_command_owner','crest_commands','CREATE')
 OR EXISTS(SELECT 1 FROM (VALUES
 ('crest_commands.authorize_source_export_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','3ec3c8f8338dec214fa63f9ca81d086badbdd44817e18222262275ead503f4d6','crest_session_owner',true,'v','plpgsql'),
 ('crest_private.source_export_job_projection(crest_private.export_jobs)','0219e951c2ccb4259c49e7f422606c57d84a8ceb1469440ad6101c0c2dad8bb1','crest_schema_owner',false,'i','sql'),
 ('crest_commands.lock_source_export_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','c3b1c29f4662a3443b85a9f404b44ac31196ea723154273ea773188b5ec97e85','crest_session_owner',true,'v','plpgsql')
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

-- Internal read gate. Root locks are released by the completed metadata query,
-- before any later object-store/network I/O. Reacquire on every actual use.
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.current_source_export_download(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;j crest_private.export_jobs;c record;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_job IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_source_export_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=requested_job;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 -- The shared current recovery fence precedes the job lock, matching command
 -- ordering. Paused/recovered old generations never gain file authority.
 PERFORM crest_commands.lock_source_export_authority($1,$2,$3,$4,$5,$6,$7,$8,j.recovery_epoch);
 SELECT * INTO j FROM crest_private.export_jobs WHERE business_id=requested_business AND id=requested_job FOR SHARE;
 IF NOT FOUND OR j.state<>'Ready' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 -- The caller is the current owner; encrypted AAD and immutable journal RLS
 -- retain the original recording actor. No policy or raw grant is widened.
 PERFORM set_config('crest.actor_id',j.actor_id::text,true),set_config('crest.operation_id',j.operation_id::text,true);
 SELECT generation_id,actor_id,recovery_epoch,plan_sha256,expected_version,operation_id,completed_at,expires_at,file_count,total_bytes,manifest_sha256 INTO c
 FROM crest_private.export_job_completions WHERE business_id=requested_business AND export_job_id=requested_job AND (requested_generation IS NULL OR generation_id=requested_generation);
 IF NOT FOUND OR c.actor_id<>j.actor_id OR c.recovery_epoch<>j.recovery_epoch OR c.expected_version+1<>j.version OR c.operation_id<>j.operation_id OR c.completed_at>clock_timestamp() OR c.expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 IF (crest_private.source_export_receipt(requested_business,j.actor_id,j.operation_id)->>'state') IS DISTINCT FROM 'committed' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 RETURN jsonb_build_object('header',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'exportJobId',j.id,'generationId',c.generation_id,'profile',j.profile,'appReleaseId',j.app_release_id,'sourceSchemaVersion',j.source_schema_version,'completedAt',to_char(c.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expiresAt',to_char(c.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'fileCount',c.file_count,'totalBytes',c.total_bytes,'manifestSha256',c.manifest_sha256),
 'authority',jsonb_build_object('currentActorId',expected_actor,'originalActorId',j.actor_id,'recoveryEpoch',j.recovery_epoch,'planSha256',c.plan_sha256));
END $$;
CREATE FUNCTION crest_commands.read_source_export_download_page(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,after_ordinal integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;files jsonb;total integer;last_ordinal integer;
BEGIN
 IF after_ordinal IS NULL OR after_ordinal NOT BETWEEN 0 AND 1023 OR requested_generation IS NULL AND after_ordinal<>0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);total:=(context->'header'->>'fileCount')::integer;
 IF after_ordinal>=total THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('ordinal',p.ordinal,'partId',p.part_id,'fileName',p.file_name,'contentType',p.content_type,'bytes',p.plaintext_bytes,'sha256',p.plaintext_sha256) ORDER BY p.ordinal),'[]'::jsonb) INTO files FROM
 (SELECT i.ordinal,i.part_id,i.file_name,i.content_type,i.plaintext_bytes,i.plaintext_sha256 FROM crest_private.export_part_intents i JOIN crest_private.export_part_verifications v USING(business_id,generation_id,part_id,request_sha256)
 WHERE i.business_id=requested_business AND i.export_job_id=requested_job AND i.generation_id=(context->'header'->>'generationId')::uuid AND i.plan_sha256=context->'authority'->>'planSha256' AND i.recovery_epoch=(context->'authority'->>'recoveryEpoch')::uuid AND i.ordinal>after_ordinal ORDER BY i.ordinal LIMIT 5) p;
 IF jsonb_array_length(files)<>least(5,total-after_ordinal) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 last_ordinal:=after_ordinal+jsonb_array_length(files);
 IF crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,(context->'header'->>'generationId')::uuid) IS DISTINCT FROM context THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 RETURN context->'header'||jsonb_build_object('files',files,'nextOrdinal',CASE WHEN last_ordinal<total THEN last_ordinal ELSE NULL END);
END $$;
CREATE FUNCTION crest_commands.read_source_export_download_part(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_job uuid,requested_generation uuid,requested_part uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;part jsonb;
BEGIN
 IF requested_generation IS NULL OR requested_part IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_EXPORT_DOWNLOAD_INPUT_REQUIRED';END IF;
 context:=crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);
 SELECT jsonb_build_object('file',jsonb_build_object('ordinal',i.ordinal,'partId',i.part_id,'fileName',i.file_name,'contentType',i.content_type,'bytes',i.plaintext_bytes,'sha256',i.plaintext_sha256),
 'intent',jsonb_build_object('formatVersion',1,'objectKey',i.object_key,'keyId',i.key_id,'plaintextBytes',i.plaintext_bytes,'plaintextSha256',i.plaintext_sha256,'ciphertextBytes',i.ciphertext_bytes,'ciphertextSha256',i.ciphertext_sha256)) INTO part
 FROM crest_private.export_part_intents i JOIN crest_private.export_part_verifications v USING(business_id,generation_id,part_id,request_sha256)
 WHERE i.business_id=requested_business AND i.export_job_id=requested_job AND i.generation_id=requested_generation AND i.part_id=requested_part AND i.plan_sha256=context->'authority'->>'planSha256' AND i.recovery_epoch=(context->'authority'->>'recoveryEpoch')::uuid;
 IF NOT FOUND OR crest_commands.current_source_export_download($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) IS DISTINCT FROM context THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_DOWNLOAD_UNAVAILABLE';END IF;
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 RETURN context||part;
END $$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.current_source_export_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export_download_page(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.read_source_export_download_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.current_source_export_download(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.read_source_export_download_page(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer),crest_commands.read_source_export_download_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_source_export_download_page(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer),crest_commands.read_source_export_download_part(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid) TO crest_web;
