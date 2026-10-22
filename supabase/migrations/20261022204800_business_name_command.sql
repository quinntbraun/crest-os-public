-- One typed P01 metadata command. No generic CRUD or write activation.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('crest_command_owner','crest_session_owner','crest_integrity_owner')
      AND NOT (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid OR r.oid=m.member
      WHERE r.rolname IN ('crest_command_owner','crest_session_owner','crest_integrity_owner'))
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest.businesses','INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest_private.operations','INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_any_column_privilege('crest_command_owner','crest_private.audit_events','INSERT,UPDATE,REFERENCES')
    OR pg_catalog.has_column_privilege('crest_session_owner','crest_private.app_sessions','last_active_at','UPDATE')
    OR (SELECT count(*) FROM pg_catalog.pg_proc WHERE oid IN ('crest_private.check_identity_roots()'::regprocedure,
      'crest_private.check_operation_completion()'::regprocedure) AND proowner='crest_integrity_owner'::regrole AND prosecdef)<>2
    OR (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('crest.businesses'::regclass,'crest_private.operations'::regclass,
      'crest_private.audit_events'::regclass,'crest_private.identity_events'::regclass,'crest_private.app_sessions'::regclass)
      AND relrowsecurity AND relforcerowsecurity AND relowner='crest_schema_owner'::regrole)<>5 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BUSINESS_COMMAND_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
GRANT SELECT(id,legal_name,version) ON crest.businesses TO crest_command_owner;
GRANT UPDATE(legal_name,version,updated_by,operation_id) ON crest.businesses TO crest_command_owner;
-- The existing audit invoker trigger reads the complete operation metadata.
-- These are scoped retained command rows, never credentials or source bodies.
GRANT SELECT(id,business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,state,
  result_schema_version,result,committed_at,created_at,created_by,origin,import_row_id) ON crest_private.operations TO crest_command_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
  ON crest_private.operations TO crest_command_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_command_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
  ON crest_private.audit_events TO crest_command_owner;
GRANT INSERT(id,business_id,created_at,created_by,operation_id,entity_kind,entity_id,entity_version,action,database_principal,payload,event_hash)
  ON crest_private.identity_events TO crest_command_owner;
GRANT UPDATE(last_active_at) ON crest_private.app_sessions TO crest_session_owner;
CREATE POLICY command_business_read ON crest.businesses FOR SELECT TO crest_command_owner USING
  (id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY command_business_rename ON crest.businesses FOR UPDATE TO crest_command_owner USING
  (id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK
  (id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY command_operation_claim ON crest_private.operations FOR INSERT TO crest_command_owner WITH CHECK
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='business.rename' AND schema_version=1 AND origin='manual');
CREATE POLICY command_operation_finish ON crest_private.operations FOR UPDATE TO crest_command_owner USING
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid) WITH CHECK
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='business.rename' AND schema_version=1 AND origin='manual');
CREATE POLICY command_business_audit ON crest_private.audit_events FOR INSERT TO crest_command_owner WITH CHECK
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='businesses' AND entity_id=business_id AND action='rename' AND origin='manual');
CREATE POLICY command_identity_history ON crest_private.identity_events FOR INSERT TO crest_command_owner WITH CHECK
  (business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid
    AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='businesses' AND entity_id=business_id AND action='UPDATE');

CREATE FUNCTION crest_commands.lock_business_rename_authority(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lock$
BEGIN
  -- Only this tenant-root metadata command needs an exclusive business lock.
  -- Take it in the authorization phase, before session/recovery/operation locks;
  -- never upgrade two devices' SHARE locks after the generic fence.
  PERFORM a.id FROM crest_private.actors a WHERE a.id=expected_actor FOR SHARE;
  PERFORM b.id FROM crest.businesses b WHERE b.id=requested_business FOR UPDATE;
  RETURN crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
    expected_provider_session,provider_valid_until,requested_business,expected_epoch,'identity.manage',false);
END
$lock$;
CREATE FUNCTION crest_commands.finish_business_rename_activity(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
  requested_business uuid,expected_epoch uuid,requested_operation uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $activity$
BEGIN
  -- Recheck current validity after any source/audit waits, in the same commit.
  PERFORM crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
    expected_provider_session,provider_valid_until,requested_business,expected_epoch,'identity.manage',false);
  UPDATE crest_private.app_sessions SET last_active_at=clock_timestamp(),version=version+1,updated_by=expected_actor,operation_id=requested_operation
    WHERE id=expected_session AND actor_id=expected_actor AND token_hash=credential_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BUSINESS_RENAME_DENIED'; END IF;
END
$activity$;
CREATE FUNCTION crest_commands.rename_business(credential_hash bytea,expected_session uuid,expected_actor uuid,
  expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,
  requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,expected_version bigint,requested_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $rename$
DECLARE context jsonb; digest text; claimed uuid; existing record; old_name text; current_version bigint; event_id uuid; command_result jsonb;
BEGIN
  PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
  IF requested_operation IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<1
    OR requested_name IS NULL OR char_length(requested_name) NOT BETWEEN 1 AND 200 OR btrim(requested_name)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_BUSINESS_RENAME_INPUT_REQUIRED';
  END IF;
  BEGIN
    context:=crest_commands.lock_business_rename_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
      expected_provider_session,provider_valid_until,requested_business,expected_epoch);
    -- A name setting is ordinary metadata, not an auth/recovery change. Both
    -- identity.read and identity.manage must be current; no recent-auth update.
    PERFORM crest_commands.authorize_business_operation_lookup(credential_hash,expected_session,expected_actor,expected_issuer,
      expected_subject,expected_provider_session,provider_valid_until,requested_business);
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_OPERATION_LOOKUP_DENIED','CREST_TENANT_READ_DENIED') THEN
      RETURN jsonb_build_object('state','denied');
    END IF;
    RAISE;
  END;
  PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),
    set_config('crest.operation_id',requested_operation::text,true);
  -- PG17 JSONB text/UTF8 v1: fixed typed keys, exact name, decimal versions,
  -- server-derived actor/business; no recorded times or caller hash accepted.
  digest:=encode(sha256(convert_to(jsonb_build_object('commandType','business.rename','schemaVersion',1,'businessId',requested_business,
    'actorId',expected_actor,'expectedVersion',expected_version::text,'recoveryEpoch',expected_epoch,'payload',jsonb_build_object('legalName',requested_name))::text,'UTF8')),'hex');
  BEGIN
    INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin)
      VALUES(requested_business,requested_operation,expected_actor,'business.rename',1,expected_epoch,digest,expected_actor,'manual')
      ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
    IF claimed IS NULL THEN
      SELECT actor_id,command_type,schema_version,recovery_epoch,payload_hash,state INTO existing FROM crest_private.operations
        WHERE business_id=requested_business AND operation_id=requested_operation;
      IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.command_type<>'business.rename' OR existing.schema_version<>1
        OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN
        RETURN jsonb_build_object('state','conflict','reason','operation');
      END IF;
      -- Full strict receipt/audit validation, after current authorization/fence.
      command_result:=crest_commands.lookup_business_name_operation(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
        expected_provider_session,provider_valid_until,requested_business,requested_operation);
      IF command_result->>'state'<>'committed' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_OPERATION_RESULT_REVIEW_REQUIRED'; END IF;
    ELSE
      SELECT legal_name,version INTO old_name,current_version FROM crest.businesses WHERE id=requested_business;
      IF current_version IS DISTINCT FROM expected_version THEN
        RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_BUSINESS_VERSION_CONFLICT';
      END IF;
      UPDATE crest.businesses SET legal_name=requested_name,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE id=requested_business;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_BUSINESS_RENAME_DENIED'; END IF;
      INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin)
        VALUES(requested_business,requested_operation,expected_actor,expected_actor,'businesses',requested_business,current_version+1,'rename',
          jsonb_build_object('schemaVersion',1,'before',jsonb_build_object('legalName',old_name,'version',current_version::text),
            'after',jsonb_build_object('legalName',requested_name,'version',(current_version+1)::text)),'manual') RETURNING id INTO event_id;
      command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',
        jsonb_build_object('schemaVersion',1,'businessId',requested_business,'businessVersion',(current_version+1)::text,'auditEventId',event_id));
      UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt'
        WHERE business_id=requested_business AND operation_id=requested_operation;
    END IF;
    PERFORM crest_commands.finish_business_rename_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,
      expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);
    RETURN command_result;
  EXCEPTION WHEN SQLSTATE 'P1001' THEN
    -- Roll back the pending claim; a version rejection is not a tombstone.
    RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',current_version::text);
  END;
END
$rename$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_session_owner,crest_command_owner;
ALTER FUNCTION crest_commands.lock_business_rename_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.finish_business_rename_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) OWNER TO crest_session_owner;
ALTER FUNCTION crest_commands.rename_business(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,text) OWNER TO crest_command_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_session_owner,crest_command_owner;
REVOKE ALL ON FUNCTION crest_commands.lock_business_rename_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
  crest_commands.finish_business_rename_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid),
  crest_commands.rename_business(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_business_rename_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),
  crest_commands.finish_business_rename_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_command_owner;
GRANT EXECUTE ON FUNCTION crest_commands.rename_business(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,text) TO crest_web;
