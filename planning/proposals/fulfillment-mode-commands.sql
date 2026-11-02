-- Unregistered owner mode settings over49 plus reviewed mode storage.
-- Existing crm.manage is owner-only nonfinancial authority; no booking/finance grant.
DO $review$
DECLARE r oid;
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='crest_mode_owner';
 IF r IS NULL THEN CREATE ROLE crest_mode_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;ALTER DEFAULT PRIVILEGES FOR ROLE crest_mode_owner REVOKE ALL ON ROUTINES FROM PUBLIC;SELECT oid INTO r FROM pg_roles WHERE rolname='crest_mode_owner';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=r OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=r AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',r))) a WHERE a.grantee<>r)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MODE_COMMAND_ROLE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.fulfillment_mode_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT count(*) FROM pg_attribute WHERE attrelid='crest.fulfillment_mode_versions'::regclass AND attnum>0 AND NOT attisdropped)<>12
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_mode_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN('crest_schema_owner','crest_session_owner','crest_mode_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_MODE_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_mode_owner;
GRANT USAGE ON TYPE crest.fulfillment_mode_versions TO crest_mode_owner;
GRANT SELECT,INSERT ON crest.fulfillment_mode_versions TO crest_mode_owner;
CREATE POLICY modes_read ON crest.fulfillment_mode_versions FOR SELECT TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY modes_create ON crest.fulfillment_mode_versions FOR INSERT TO crest_mode_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_mode_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_mode_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_mode_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_mode_owner;
CREATE POLICY mode_operations_read ON crest_private.operations FOR SELECT TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save'));
CREATE POLICY mode_operations_create ON crest_private.operations FOR INSERT TO crest_mode_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save') AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY mode_operations_finish ON crest_private.operations FOR UPDATE TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save')) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save'));
CREATE POLICY mode_audits_read ON crest_private.audit_events FOR SELECT TO crest_mode_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='fulfillment_modes');
CREATE POLICY mode_audits_create ON crest_private.audit_events FOR INSERT TO crest_mode_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='fulfillment_modes' AND origin='manual' AND import_row_id IS NULL);
CREATE FUNCTION crest_private.fulfillment_mode_payload(v crest.fulfillment_mode_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $payload$
 SELECT jsonb_build_object('mobileEnabled',(v).mobile_enabled,'dropoffEnabled',(v).dropoff_enabled,'pickupReturnEnabled',(v).pickup_return_enabled,'reason',(v).reason)
$payload$;
CREATE FUNCTION crest_private.valid_fulfillment_mode_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text;s text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>8192 OR body-ARRAY['mobileEnabled','dropoffEnabled','pickupReturnEnabled','reason']<>'{}'::jsonb OR NOT body ?& ARRAY['mobileEnabled','dropoffEnabled','pickupReturnEnabled','reason'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['mobileEnabled','dropoffEnabled','pickupReturnEnabled'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'boolean' THEN RETURN false;END IF;END LOOP;
 IF body->'reason'<>'null'::jsonb THEN s:=body->>'reason';IF jsonb_typeof(body->'reason') IS DISTINCT FROM 'string' OR char_length(s)<1 OR char_length(s)>1000 OR btrim(s,E' \t\n\r')='' OR translate(s,E'\t\n\r','')~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;RETURN true;
END $valid$;
CREATE FUNCTION crest_private.fulfillment_mode_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;v crest.fulfillment_mode_versions;p crest.fulfillment_mode_versions;a crest_private.audit_events;r jsonb;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type IN('operations.fulfillment_modes.initialize','operations.fulfillment_modes.save');IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','sequence','versionId','auditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','sequence','versionId','auditEventId'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO v FROM crest.fulfillment_mode_versions WHERE business_id=business AND id=(r->>'versionId')::uuid AND sequence::text=r->>'sequence' AND created_by=actor AND operation_id=operation;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'auditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='fulfillment_modes' AND entity_id=business AND entity_version=v.sequence;
 IF v.sequence>1 THEN SELECT * INTO p FROM crest.fulfillment_mode_versions WHERE business_id=business AND sequence=v.replaces_sequence;END IF;
 IF v.id IS NULL OR a.id IS NULL OR a.action IS DISTINCT FROM (CASE WHEN v.sequence=1 THEN 'initialize' ELSE 'revise' END) OR a.delta IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'before',CASE WHEN v.sequence=1 THEN 'null'::jsonb ELSE crest_private.fulfillment_mode_projection(p) END,'after',crest_private.fulfillment_mode_projection(v)) OR o.command_type IS DISTINCT FROM (CASE WHEN v.sequence=1 THEN 'operations.fulfillment_modes.initialize' ELSE 'operations.fulfillment_modes.save' END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType',o.command_type,'schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'expectedSequence',(v.sequence-1)::text,'payload',crest_private.fulfillment_mode_payload(v))::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_MODE_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
CREATE FUNCTION crest_commands.save_fulfillment_modes(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,expected_sequence bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb;kind text;digest text;claim uuid;existing crest_private.operations;prior crest.fulfillment_mode_versions;v crest.fulfillment_mode_versions;event uuid;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR expected_sequence IS NULL OR expected_sequence<0 OR expected_sequence=9223372036854775807 OR NOT crest_private.valid_fulfillment_mode_payload(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 IF expected_sequence=0 AND body IS DISTINCT FROM jsonb_build_object('mobileEnabled',true,'dropoffEnabled',true,'pickupReturnEnabled',false,'reason',NULL) OR expected_sequence>0 AND body->'reason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 kind:=CASE WHEN expected_sequence=0 THEN 'operations.fulfillment_modes.initialize' ELSE 'operations.fulfillment_modes.save' END;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType',kind,'schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'expectedSequence',expected_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,kind,1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.fulfillment_mode_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('crest.fulfillment.modes/1:'||requested_business::text,0));
   SELECT * INTO prior FROM crest.fulfillment_mode_versions WHERE business_id=requested_business ORDER BY sequence DESC LIMIT 1;
   IF coalesce(prior.sequence,0)<>expected_sequence THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_MODE_SEQUENCE_CONFLICT';END IF;
   IF expected_sequence>0 AND ROW((body->>'mobileEnabled')::boolean,(body->>'dropoffEnabled')::boolean,(body->>'pickupReturnEnabled')::boolean) IS NOT DISTINCT FROM ROW(prior.mobile_enabled,prior.dropoff_enabled,prior.pickup_return_enabled) THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_MODE_REVIEW_REQUIRED';END IF;
   INSERT INTO crest.fulfillment_mode_versions(business_id,sequence,replaces_sequence,mobile_enabled,dropoff_enabled,pickup_return_enabled,reason,created_by,operation_id) VALUES(requested_business,expected_sequence+1,CASE WHEN expected_sequence=0 THEN NULL ELSE expected_sequence END,(body->>'mobileEnabled')::boolean,(body->>'dropoffEnabled')::boolean,(body->>'pickupReturnEnabled')::boolean,body->>'reason',expected_actor,requested_operation) RETURNING * INTO v;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'fulfillment_modes',requested_business,v.sequence,CASE WHEN v.sequence=1 THEN 'initialize' ELSE 'revise' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN v.sequence=1 THEN 'null'::jsonb ELSE crest_private.fulfillment_mode_projection(prior) END,'after',crest_private.fulfillment_mode_projection(v)),'manual') RETURNING id INTO event;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'sequence',v.sequence::text,'versionId',v.id,'auditEventId',event));UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentSequence',coalesce(prior.sequence,0)::text);WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','review');END;
END $save$;
CREATE FUNCTION crest_commands.lookup_fulfillment_mode_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.fulfillment_mode_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_commands.read_fulfillment_mode_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_sequence bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;latest bigint;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF after_sequence IS NULL OR after_sequence<0 OR page_limit IS NULL OR page_limit<1 OR page_limit>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_MODE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 SELECT max(sequence) INTO latest FROM crest.fulfillment_mode_versions WHERE business_id=requested_business;IF latest IS NULL THEN RETURN jsonb_build_object('state','absent');END IF;
 WITH page AS(SELECT sequence,crest_private.fulfillment_mode_projection(v) AS row FROM crest.fulfillment_mode_versions v WHERE business_id=requested_business AND sequence>after_sequence AND sequence<=latest ORDER BY sequence LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'currentSequence',latest::text,'versions',coalesce((SELECT jsonb_agg(row ORDER BY sequence) FROM page),'[]'::jsonb),'hasMore',latest::numeric-after_sequence>page_limit) INTO result;RETURN result;
END $history$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.fulfillment_mode_projection(crest.fulfillment_mode_versions) TO crest_mode_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_mode_owner;
ALTER FUNCTION crest_private.fulfillment_mode_payload(crest.fulfillment_mode_versions) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_private.valid_fulfillment_mode_payload(jsonb) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_private.fulfillment_mode_operation_result(uuid,uuid,uuid) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_mode_owner;
ALTER FUNCTION crest_commands.read_fulfillment_mode_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint,integer) OWNER TO crest_mode_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_mode_owner;
REVOKE ALL ON FUNCTION crest_private.fulfillment_mode_payload(crest.fulfillment_mode_versions),crest_private.valid_fulfillment_mode_payload(jsonb),crest_private.fulfillment_mode_operation_result(uuid,uuid,uuid),crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb),crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_fulfillment_mode_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_mode_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_fulfillment_modes(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,bigint,jsonb),crest_commands.lookup_fulfillment_mode_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_fulfillment_mode_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,bigint,integer) TO crest_web;
