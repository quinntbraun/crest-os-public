-- UNREGISTERED construction proposal after registered41. No runtime activation.
-- A retirement is a distinct immutable audited decision, never an original
-- domain receipt, an undo, or permission to fabricate a lost draft.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>4
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner'))
 OR EXISTS(SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole,LATERAL aclexplode(d.defaclacl) a WHERE r.rolname IN ('crest_schema_owner','crest_command_owner','crest_session_owner','crest_integrity_owner') AND a.grantee<>d.defaclrole)
 OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest_private.operations'::regclass,'crest_private.audit_events'::regclass,'crest.memberships'::regclass,'crest_private.app_sessions'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4
 OR to_regprocedure('crest_commands.convert_lead(bytea,uuid,uuid,text,uuid,uuid,timestamp with time zone,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb)') IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_RESOLUTION_REVIEW_REQUIRED';
 END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;

CREATE FUNCTION crest_private.original_operation_uuid(v jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce(jsonb_typeof(v)='string' AND v#>>'{}'~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$',false)
$$;
CREATE FUNCTION crest_private.original_operation_version(v jsonb,allow_zero boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN RETURN coalesce(jsonb_typeof(v)='string' AND v#>>'{}'~CASE WHEN allow_zero THEN '^(0|[1-9][0-9]{0,18})$' ELSE '^[1-9][0-9]{0,18}$' END AND (v#>>'{}')::numeric<=9223372036854775807,false);EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN false;END $$;
CREATE FUNCTION crest_private.original_operation_reference_valid(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE kind text;r jsonb;keys text[];key text;
BEGIN
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR NOT(v?&ARRAY['schemaVersion','businessId','commandType','reference']) OR v-ARRAY['schemaVersion','businessId','commandType','reference']<>'{}'::jsonb OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT crest_private.original_operation_uuid(v->'businessId') OR jsonb_typeof(v->'commandType') IS DISTINCT FROM 'string' THEN RETURN false;END IF;
 kind:=v->>'commandType';r:=v->'reference';
 keys:=CASE kind
  WHEN 'business.rename' THEN ARRAY['expectedVersion']
  WHEN 'crm.customer.save' THEN ARRAY['customerId','expectedVersion']
  WHEN 'crm.address.save' THEN ARRAY['customerId','addressId','expectedVersion']
  WHEN 'crm.vehicle.save' THEN ARRAY['vehicleId','expectedVersion']
  WHEN 'crm.vehicle.association' THEN ARRAY['action','associationId','vehicleId','expectedVersion','nextAssociationId']
  WHEN 'crm.lead.source.save' THEN ARRAY['leadSourceId','expectedVersion']
  WHEN 'crm.lead.save' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.state' THEN ARRAY['leadId','expectedVersion']
  WHEN 'crm.lead.vehicle.save' THEN ARRAY['leadId','leadVehicleId','expectedVersion']
  WHEN 'crm.lead.address.save' THEN ARRAY['leadId','leadAddressId','expectedVersion']
  WHEN 'crm.lead.convert' THEN ARRAY['conversionId','leadId','expectedLeadVersion','customerId'] ELSE NULL END;
 IF keys IS NULL OR jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 keys:=ARRAY['operationId','recoveryEpoch']||keys;
 IF NOT(r?&keys) OR r-keys<>'{}'::jsonb THEN RETURN false;END IF;
 FOREACH key IN ARRAY keys LOOP
  IF key='expectedVersion' THEN IF NOT crest_private.original_operation_version(r->key,kind NOT IN ('business.rename','crm.lead.state')) THEN RETURN false;END IF;
  ELSIF key='expectedLeadVersion' THEN IF NOT crest_private.original_operation_version(r->key,false) THEN RETURN false;END IF;
  ELSIF key NOT IN ('action','nextAssociationId') THEN IF NOT crest_private.original_operation_uuid(r->key) THEN RETURN false;END IF;END IF;
 END LOOP;
 IF kind='crm.vehicle.association' THEN RETURN coalesce(jsonb_typeof(r->'action')='string' AND r->>'action' IN ('open','close','transfer') AND r->>'expectedVersion'=CASE WHEN r->>'action'='open' THEN '0' ELSE '1' END AND CASE WHEN r->>'action'='transfer' THEN crest_private.original_operation_uuid(r->'nextAssociationId') AND r->>'nextAssociationId'<>r->>'associationId' ELSE r->'nextAssociationId'='null'::jsonb END,false);END IF;
 RETURN true;
END $$;
CREATE FUNCTION crest_private.operation_retirement_digest(actor uuid,epoch uuid,original jsonb,reason text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('commandType','operation.retire','schemaVersion',1,'actorId',actor,'recoveryEpoch',epoch,'original',original,'reason',reason)::text,'UTF8')),'hex')
$$;

-- Reuse the existing closed nonlogin operation principal and existing tables.
-- No caller receives direct table access or a new SET ROLE path.
GRANT INSERT(reason) ON crest_private.audit_events TO crest_command_owner;
GRANT SELECT(reason,delta,recorded_at,payload,hash_input,event_hash) ON crest_private.audit_events TO crest_command_owner;
CREATE POLICY operation_retirement_claim ON crest_private.operations FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operation.retire' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY operation_retirement_finish ON crest_private.operations FOR UPDATE TO crest_command_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operation.retire') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operation.retire' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY operation_retirement_audit ON crest_private.audit_events FOR INSERT TO crest_command_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='operations' AND entity_version=1 AND action='retire' AND reason IS NOT NULL AND origin='manual' AND import_row_id IS NULL AND EXISTS(SELECT 1 FROM crest_private.operations o WHERE o.business_id=audit_events.business_id AND o.operation_id=audit_events.operation_id AND o.actor_id=audit_events.actor_id AND o.id=audit_events.entity_id AND o.command_type='operation.retire' AND o.state='pending'));

CREATE FUNCTION crest_commands.authorize_operation_resolution_read(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;stamp timestamptz;
BEGIN
 context:=crest_commands.authorize_business_operation_lookup(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);stamp:=clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=expected_actor AND active AND role='owner') OR NOT EXISTS(SELECT 1 FROM crest_private.app_sessions WHERE id=expected_session AND actor_id=expected_actor AND authenticated_at<=stamp AND (reauth_at IS NULL OR reauth_at<=stamp) AND coalesce(reauth_at,authenticated_at)>stamp-interval '15 minutes' AND expires_at>stamp) OR provider_valid_until<=stamp THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_RESOLUTION_DENIED';END IF;
 RETURN context;
END $$;
CREATE FUNCTION crest_commands.lock_operation_retirement_authority(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN
 context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'identity.manage',true);
 IF NOT EXISTS(SELECT 1 FROM crest.memberships WHERE business_id=requested_business AND actor_id=expected_actor AND active AND role='owner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_RESOLUTION_DENIED';END IF;
 RETURN context;
END $$;
CREATE FUNCTION crest_commands.finish_operation_retirement_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
BEGIN
 PERFORM crest_commands.lock_operation_retirement_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch);
 UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_OPERATION_RESOLUTION_DENIED';END IF;
END $$;

CREATE FUNCTION crest_private.operation_retirement_result(business uuid,actor uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog,pg_temp AS $$
DECLARE o crest_private.operations;a record;decision jsonb;r jsonb;expected_delta jsonb;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=(original->'reference'->>'operationId')::uuid;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;
 IF o.command_type<>'operation.retire' THEN
  IF o.command_type IS DISTINCT FROM original->>'commandType' OR o.schema_version<>1 OR o.state<>'committed' OR o.recovery_epoch::text IS DISTINCT FROM original->'reference'->>'recoveryEpoch' THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
  -- Observation only. The caller must use the existing typed original lookup
  -- to validate receipt/source identity before clearing any pending reference.
  RETURN jsonb_build_object('schemaVersion',1,'state','original_recorded','original',original);
 END IF;
 decision:=o.result;r:=decision->'retirement';
 IF o.schema_version<>1 OR o.state<>'committed' OR o.result_schema_version<>1 OR jsonb_typeof(decision) IS DISTINCT FROM 'object' OR NOT(decision?&ARRAY['schemaVersion','state','original','retirement']) OR decision-ARRAY['schemaVersion','state','original','retirement']<>'{}'::jsonb OR decision->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR decision->>'state' IS DISTINCT FROM 'retired' OR decision->'original' IS DISTINCT FROM original OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r?&ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']) OR r-ARRAY['operationRowId','auditEventId','recoveryEpoch','reason','recordedAt']<>'{}'::jsonb OR r->>'operationRowId' IS DISTINCT FROM o.id::text OR r->>'recoveryEpoch' IS DISTINCT FROM o.recovery_epoch::text OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string' OR NOT crest_private.original_operation_uuid(r->'auditEventId') OR o.payload_hash IS DISTINCT FROM crest_private.operation_retirement_digest(actor,o.recovery_epoch,original,r->>'reason') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 expected_delta:=jsonb_build_object('schemaVersion',1,'before',NULL,'after',jsonb_build_object('schemaVersion',1,'operationRowId',o.id,'original',original,'recoveryEpoch',o.recovery_epoch,'reason',r->>'reason'));
 SELECT id,reason,recorded_at,delta,payload,hash_input,event_hash INTO a FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id AND entity_kind='operations' AND entity_id=o.id AND entity_version=1 AND action='retire';
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=business AND actor_id=actor AND operation_id=o.operation_id)<>1 OR a.id::text IS DISTINCT FROM r->>'auditEventId' OR a.reason IS DISTINCT FROM r->>'reason' OR a.delta IS DISTINCT FROM expected_delta OR r->>'recordedAt' IS DISTINCT FROM to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') OR a.hash_input IS DISTINCT FROM a.payload::text OR a.event_hash IS DISTINCT FROM encode(sha256(convert_to(a.hash_input,'UTF8')),'hex') OR a.recorded_at<o.created_at OR a.recorded_at>o.committed_at THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RETIREMENT_RESULT_REVIEW_REQUIRED';END IF;
 RETURN decision;
END $$;

CREATE FUNCTION crest_commands.retire_original_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,original jsonb,requested_reason text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;operation uuid;digest text;claimed uuid;existing record;event uuid;stamp timestamptz;decision jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.original_operation_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text OR requested_reason IS NULL OR char_length(requested_reason) NOT BETWEEN 1 AND 2000 OR btrim(requested_reason,E' \t\n\r\u000b\f'||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' OR translate(requested_reason,E'\t\n\r','')~('['||chr(1)||'-'||chr(31)||chr(127)||']') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
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
CREATE FUNCTION crest_commands.lookup_original_operation_resolution(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,original jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT crest_private.original_operation_reference_valid(original) OR original->>'businessId' IS DISTINCT FROM requested_business::text THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_OPERATION_RETIREMENT_INPUT_REQUIRED';END IF;
 original:=original||jsonb_build_object('schemaVersion',1);
 context:=crest_commands.authorize_operation_resolution_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.operation_retirement_result(requested_business,expected_actor,original);
END $$;
RESET ROLE;

GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_command_owner;
ALTER FUNCTION crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text) OWNER TO crest_command_owner;
ALTER FUNCTION crest_commands.lookup_original_operation_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_command_owner;
REVOKE ALL ON FUNCTION crest_private.original_operation_uuid(jsonb),crest_private.original_operation_version(jsonb,boolean),crest_private.original_operation_reference_valid(jsonb),crest_private.operation_retirement_digest(uuid,uuid,jsonb,text),crest_private.operation_retirement_result(uuid,uuid,jsonb),crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text),crest_commands.lookup_original_operation_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.original_operation_uuid(jsonb),crest_private.original_operation_version(jsonb,boolean),crest_private.original_operation_reference_valid(jsonb),crest_private.operation_retirement_digest(uuid,uuid,jsonb,text),crest_private.operation_retirement_result(uuid,uuid,jsonb),crest_commands.authorize_operation_resolution_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.lock_operation_retirement_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.finish_operation_retirement_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.retire_original_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,jsonb,text),crest_commands.lookup_original_operation_resolution(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,jsonb) TO crest_web;
