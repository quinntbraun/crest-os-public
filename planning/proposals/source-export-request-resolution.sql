-- UNREGISTERED forward43 supplement. Apply after the five journal proposals.
-- Existing42 definitions, grants, validator and browser allowlist stay unchanged.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest_private.export_jobs'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3
 OR has_schema_privilege('crest_command_owner','crest_commands','CREATE')
 OR to_regprocedure('crest_commands.request_source_export(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,uuid,text)') IS NULL
 OR EXISTS(SELECT 1 FROM (VALUES
('crest_private.original_operation_uuid(jsonb)','ec8d31108ca4387c2217d4d29e5d016938825802365afbda2e2667ea2a7557ee','crest_schema_owner',false,'i','sql'),
('crest_private.operation_retirement_digest(uuid,uuid,jsonb,text)','5359d819c2d454b3378d67fb3ff84d009b2d88f8a68675836666fd29ef66fbf5','crest_schema_owner',false,'i','sql'),
('crest_private.operation_retirement_result(uuid,uuid,jsonb)','da9672544c00bc815b105aae6e37b051dd5ab29594fb18ce31650de5c8f580fc','crest_schema_owner',false,'v','plpgsql'),
('crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid)','bfde61feafbca626187eb4a50f52cecc8a902a0550bdaff3cf1050ebeaf7aea4','crest_session_owner',true,'v','plpgsql'),
('crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid)','a2201e2c378a47d11053dfef8297f70652eddf060fc8728c173730157fe19a1d','crest_session_owner',true,'v','plpgsql'),
('crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid)','3b796c52c8e7ae4261e75ede6c06c41b36e997a53d5a1199829b8aa7c77fb0ab','crest_session_owner',true,'v','plpgsql')
 ) expected(signature,digest,owner,definer,volatility,language)
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
 LEFT JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid IS NULL OR p.proowner<>expected.owner::regrole OR p.prosecdef<>expected.definer OR p.provolatile::text<>expected.volatility OR l.lanname<>expected.language
 OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>expected.digest
 OR cardinality(p.proconfig)<>(CASE WHEN expected.definer THEN 2 ELSE 1 END)
 OR NOT EXISTS(SELECT 1 FROM unnest(p.proconfig) setting WHERE setting~'^search_path=pg_catalog, *pg_temp$')
 OR expected.definer AND NOT('row_security=on'=ANY(p.proconfig))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_EXPORT_REQUEST_RESOLUTION_SOURCE_REVIEW_REQUIRED';
 END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.source_export_request_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'reference') IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 RETURN coalesce(v?&ARRAY['schemaVersion','businessId','commandType','reference'] AND v-ARRAY['schemaVersion','businessId','commandType','reference']='{}'::jsonb
 AND v->'schemaVersion'='1'::jsonb AND crest_private.original_operation_uuid(v->'businessId') AND v->>'commandType'='export.request'
 AND jsonb_typeof(v->'reference')='object'
 AND v->'reference'?&ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']
 AND (v->'reference')-ARRAY['operationId','recoveryEpoch','exportJobId','appReleaseId','profile','sourceSchemaVersion']='{}'::jsonb
 AND crest_private.original_operation_uuid(v->'reference'->'operationId') AND crest_private.original_operation_uuid(v->'reference'->'recoveryEpoch') AND crest_private.original_operation_uuid(v->'reference'->'exportJobId')
 AND jsonb_typeof(v->'reference'->'appReleaseId')='string' AND v->'reference'->>'appReleaseId'~'^[a-f0-9]{40}$'
 AND v->'reference'->>'profile'='crest.business-source-journal-bundle.v1'
 AND (v->'reference'->'sourceSchemaVersion')::text='43',false);
END $$;
CREATE FUNCTION crest_commands.retire_source_export_request(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original jsonb,requested_reason text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;operation uuid;digest text;claimed uuid;existing record;event uuid;stamp timestamptz;decision jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.source_export_request_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 2000 OR btrim(requested_reason,E' \t\n\r\u000b\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' OR translate(requested_reason,E'\t\n\r','')~('['||chr(1)||'-'||chr(31)||chr(127)||']') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
 -- JSONB numeric equality admits schemaVersion1.0 as version1. Normalize its
 -- representation before hashing/retaining so an equivalent later lookup is
 -- not rejected merely because the original caller used another spelling.
 original:=original||jsonb_build_object('schemaVersion',1);
 context:=crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 operation:=(original->'reference'->>'operationId')::uuid;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',operation::text,true);
 digest:=crest_private.operation_retirement_digest(expected_actor,expected_epoch,original,requested_reason);
 -- The SAME unique key used by every original writer serializes both choices.
 -- A conflicting uncommitted original must finish before this can decide.
 INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,operation,expected_actor,'operation.retire',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
 IF claimed IS NULL THEN
  SELECT command_type,payload_hash INTO existing FROM crest_private.operations WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=operation;
  IF NOT FOUND THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  PERFORM crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
  IF existing.command_type='operation.retire' AND existing.payload_hash IS DISTINCT FROM digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  decision:=crest_private.operation_retirement_result(requested_business,expected_actor,original);
  IF decision->>'state'='retired' THEN PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);END IF;
  RETURN decision;
 END IF;
 INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,delta,origin) VALUES(requested_business,operation,expected_actor,expected_actor,'operations',claimed,1,'retire',requested_reason,jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',claimed,'original',original,'recoveryEpoch',expected_epoch,'reason',requested_reason)),'manual') RETURNING id,recorded_at INTO event,stamp;
 decision:=jsonb_build_object('schemaVersion',1,'state','retired','original',original,'retirement',jsonb_build_object('operationRowId',claimed,'auditEventId',event,'recoveryEpoch',expected_epoch,'reason',requested_reason,'recordedAt',to_char(stamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
 UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=decision WHERE business_id=requested_business AND actor_id=expected_actor AND operation_id=operation;
 PERFORM crest_commands.finish_operation_retirement_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,operation);
 RETURN crest_private.operation_retirement_result(requested_business,expected_actor,original);
END $$;
CREATE FUNCTION crest_commands.lookup_source_export_request_resolution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.source_export_request_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
 original:=original||jsonb_build_object('schemaVersion',1);
 context:=crest_commands.authorize_operation_resolution_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.operation_retirement_result(requested_business,expected_actor,original);
END $$;

RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_command_owner;
ALTER FUNCTION crest_commands.retire_source_export_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.lookup_source_export_request_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.source_export_request_reference_valid(jsonb),crest_commands.retire_source_export_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text),crest_commands.lookup_source_export_request_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.source_export_request_reference_valid(jsonb) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.retire_source_export_request(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text),crest_commands.lookup_source_export_request_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;
