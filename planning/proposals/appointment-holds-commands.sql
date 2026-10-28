-- Isolated, unregistered prospective-note commands over registered44 + hold storage.
-- crm.manage is the existing owner-only nonfinancial capability. No job confirmation.
DO $review$
DECLARE r oid;
BEGIN
 SELECT oid INTO r FROM pg_roles WHERE rolname='crest_hold_owner';
 IF r IS NULL THEN CREATE ROLE crest_hold_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;ALTER DEFAULT PRIVILEGES FOR ROLE crest_hold_owner REVOKE ALL ON ROUTINES FROM PUBLIC;SELECT oid INTO r FROM pg_roles WHERE rolname='crest_hold_owner';END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=r AND (rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolconfig IS NOT NULL))
  OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=r OR member=r)
  OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (c.relowner=r OR CASE WHEN c.relkind IN('r','p','v','m','f') THEN has_any_column_privilege(r,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END))
  OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('crest','crest_private','crest_commands') AND (p.proowner=r OR has_function_privilege(r,p.oid,'EXECUTE')))
  OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN('crest','crest_private','crest_commands') AND has_schema_privilege(r,oid,'CREATE'))
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce((SELECT defaclacl FROM pg_default_acl WHERE defaclrole=r AND defaclnamespace=0 AND defaclobjtype='f'),acldefault('f',r))) a WHERE a.grantee<>r)
  OR EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=r AND a.grantee<>r)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_COMMAND_ROLE_REVIEW_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='crest.appointment_hold_versions'::regclass AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)
  OR (SELECT count(*) FROM pg_attribute WHERE attrelid='crest.appointment_hold_versions'::regclass AND attnum>0 AND NOT attisdropped)<>22
  OR (SELECT count(*) FROM pg_roles WHERE rolname IN('crest_schema_owner','crest_session_owner','crest_hold_integrity_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
  OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN('crest_schema_owner','crest_session_owner','crest_hold_integrity_owner'))
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_HOLD_COMMAND_SOURCE_REVIEW_REQUIRED';END IF;
END $review$;
SET LOCAL ROLE crest_schema_owner;
GRANT USAGE ON SCHEMA crest,crest_private,crest_commands TO crest_hold_owner;
GRANT USAGE ON TYPE crest.appointment_hold_versions TO crest_hold_owner;
GRANT SELECT,INSERT ON crest.appointment_hold_versions TO crest_hold_owner;
CREATE POLICY holds_read ON crest.appointment_hold_versions FOR SELECT TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY holds_create ON crest.appointment_hold_versions FOR INSERT TO crest_hold_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND origin='manual');
GRANT SELECT ON crest_private.operations,crest_private.audit_events TO crest_hold_owner;
GRANT INSERT(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) ON crest_private.operations TO crest_hold_owner;
GRANT UPDATE(state,result_schema_version,result) ON crest_private.operations TO crest_hold_owner;
GRANT INSERT(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) ON crest_private.audit_events TO crest_hold_owner;
CREATE POLICY hold_operations_read ON crest_private.operations FOR SELECT TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.appointment_hold.save');
CREATE POLICY hold_operations_create ON crest_private.operations FOR INSERT TO crest_hold_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='operations.appointment_hold.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY hold_operations_finish ON crest_private.operations FOR UPDATE TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.appointment_hold.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='operations.appointment_hold.save');
CREATE POLICY hold_audits_read ON crest_private.audit_events FOR SELECT TO crest_hold_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='appointment_holds');
CREATE POLICY hold_audits_create ON crest_private.audit_events FOR INSERT TO crest_hold_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='appointment_holds' AND origin='manual' AND import_row_id IS NULL);
CREATE FUNCTION crest_private.appointment_hold_payload(h crest.appointment_hold_versions) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $payload$
 SELECT crest_private.appointment_hold_projection(h)-ARRAY['id','business_id','hold_id','sequence','replaces_sequence','created_at','created_by','operation_id','origin']
$payload$;
CREATE FUNCTION crest_private.valid_appointment_hold_payload(body jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE k text;s text;
BEGIN
 IF body IS NULL OR jsonb_typeof(body) IS DISTINCT FROM 'object' OR octet_length(body::text)>32768 OR body-ARRAY['customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason']<>'{}'::jsonb OR NOT body ?& ARRAY['customer_id','lead_id','label','state','start_at','end_at','timezone','local_start','local_end','start_offset_minutes','end_offset_minutes','notes','reason'] THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['customer_id','lead_id'] LOOP IF body->k<>'null'::jsonb AND (jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR (body->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RETURN false;END IF;END LOOP;
 IF (body->'customer_id'='null'::jsonb)=(body->'lead_id'='null'::jsonb) OR jsonb_typeof(body->'state') IS DISTINCT FROM 'string' OR body->>'state' NOT IN('proposed','withdrawn') THEN RETURN false;END IF;
 FOREACH k IN ARRAY ARRAY['label','notes','reason'] LOOP
  IF k='label' OR body->k<>'null'::jsonb THEN s:=body->>k;IF jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR char_length(s)>CASE WHEN k='label' THEN 200 WHEN k='notes' THEN 2000 ELSE 1000 END OR (k<>'notes' AND btrim(s)='') OR (CASE WHEN k='label' THEN s ELSE translate(s,E'\t\n\r','') END)~'[[:cntrl:]]' THEN RETURN false;END IF;END IF;
 END LOOP;
 FOREACH k IN ARRAY ARRAY['start_at','end_at'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR (body->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' OR (body->>k)<'0001-' THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['local_start','local_end'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'string' OR (body->>k)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}$' OR (body->>k)<'0001-' THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['start_offset_minutes','end_offset_minutes'] LOOP IF jsonb_typeof(body->k) IS DISTINCT FROM 'number' OR (body->>k)!~'^-?[0-9]{1,3}$' OR abs((body->>k)::integer)>840 THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['start_at','end_at'] LOOP IF to_char((body->>k)::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')<>body->>k THEN RETURN false;END IF;END LOOP;
 FOREACH k IN ARRAY ARRAY['local_start','local_end'] LOOP IF to_char((body->>k)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS.US')<>body->>k THEN RETURN false;END IF;END LOOP;
 IF jsonb_typeof(body->'timezone') IS DISTINCT FROM 'string' OR char_length(body->>'timezone')>100 OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=body->>'timezone') THEN RETURN false;END IF;
 IF (body->>'end_at')::timestamptz<=(body->>'start_at')::timestamptz OR (body->>'start_at')::timestamptz AT TIME ZONE (body->>'timezone')<>(body->>'local_start')::timestamp OR (body->>'end_at')::timestamptz AT TIME ZONE (body->>'timezone')<>(body->>'local_end')::timestamp
  OR extract(epoch FROM ((body->>'local_start')::timestamp-((body->>'start_at')::timestamptz AT TIME ZONE 'UTC')))<>(body->>'start_offset_minutes')::numeric*60 OR extract(epoch FROM ((body->>'local_end')::timestamp-((body->>'end_at')::timestamptz AT TIME ZONE 'UTC')))<>(body->>'end_offset_minutes')::numeric*60
 THEN RETURN false;END IF;RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_parameter_value THEN RETURN false;
END $valid$;
CREATE FUNCTION crest_private.appointment_hold_operation_result(business uuid,actor uuid,operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o crest_private.operations;h crest.appointment_hold_versions;p crest.appointment_hold_versions;a crest_private.audit_events;r jsonb;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=business AND actor_id=actor AND operation_id=operation AND command_type='operations.appointment_hold.save';IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','holdId','sequence','versionId','auditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','holdId','sequence','versionId','auditEventId'] OR r->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR r->>'businessId' IS DISTINCT FROM business::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO h FROM crest.appointment_hold_versions WHERE business_id=business AND id=(r->>'versionId')::uuid AND hold_id=(r->>'holdId')::uuid AND sequence::text=r->>'sequence' AND created_by=actor AND operation_id=operation;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=business AND id=(r->>'auditEventId')::uuid AND operation_id=operation AND actor_id=actor AND entity_kind='appointment_holds' AND entity_id=h.hold_id AND entity_version=h.sequence;
 IF h.id IS NULL OR a.id IS NULL OR a.delta->'after' IS DISTINCT FROM crest_private.appointment_hold_projection(h) OR a.action IS DISTINCT FROM CASE WHEN h.sequence=1 THEN 'create' WHEN h.state='withdrawn' THEN 'withdraw' ELSE 'revise' END THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 IF h.sequence>1 THEN SELECT * INTO p FROM crest.appointment_hold_versions WHERE business_id=business AND hold_id=h.hold_id AND sequence=h.replaces_sequence;END IF;
 IF a.delta->'before' IS DISTINCT FROM CASE WHEN h.sequence=1 THEN 'null'::jsonb ELSE crest_private.appointment_hold_projection(p) END THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.appointment_hold.save','schemaVersion',1,'businessId',business,'actorId',actor,'recoveryEpoch',o.recovery_epoch,'holdId',h.hold_id,'expectedSequence',(h.sequence-1)::text,'payload',crest_private.appointment_hold_payload(h))::text,'UTF8')),'hex');
 IF o.payload_hash<>digest THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_HOLD_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END $result$;
CREATE FUNCTION crest_commands.save_appointment_hold(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_hold uuid,expected_sequence bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb;digest text;claim uuid;existing crest_private.operations;prior crest.appointment_hold_versions;h crest.appointment_hold_versions;event uuid;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF request_schema IS DISTINCT FROM 1 OR requested_operation IS NULL OR requested_hold IS NULL OR expected_sequence IS NULL OR expected_sequence<0 OR expected_sequence=9223372036854775807 OR NOT crest_private.valid_appointment_hold_payload(body) OR expected_sequence=0 AND body->>'state'<>'proposed' OR expected_sequence>0 AND body->'reason'='null'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.lock_mutation_authority($1,$2,$3,$4,$5,$6,$7,$8,$9,'crm.manage',false);PERFORM crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','operations.appointment_hold.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'holdId',requested_hold,'expectedSequence',expected_sequence::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'operations.appointment_hold.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claim;
  IF claim IS NULL THEN SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;command_result:=crest_private.appointment_hold_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM pg_advisory_xact_lock(hashtextextended('appointment-hold:'||requested_business::text||':'||requested_hold::text,0));
   SELECT * INTO prior FROM crest.appointment_hold_versions WHERE business_id=requested_business AND hold_id=requested_hold ORDER BY sequence DESC LIMIT 1;
   IF coalesce(prior.sequence,0)<>expected_sequence THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_HOLD_SEQUENCE_CONFLICT';END IF;
   IF prior.state='withdrawn' OR expected_sequence>0 AND ((body->>'customer_id')::uuid IS DISTINCT FROM prior.customer_id OR (body->>'lead_id')::uuid IS DISTINCT FROM prior.lead_id) THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_HOLD_REVIEW_REQUIRED';END IF;
   INSERT INTO crest.appointment_hold_versions(business_id,hold_id,sequence,replaces_sequence,customer_id,lead_id,label,state,start_at,end_at,timezone,local_start,local_end,start_offset_minutes,end_offset_minutes,notes,reason,created_by,operation_id) VALUES(requested_business,requested_hold,expected_sequence+1,CASE WHEN expected_sequence=0 THEN NULL ELSE expected_sequence END,(body->>'customer_id')::uuid,(body->>'lead_id')::uuid,body->>'label',body->>'state',(body->>'start_at')::timestamptz,(body->>'end_at')::timestamptz,body->>'timezone',(body->>'local_start')::timestamp,(body->>'local_end')::timestamp,(body->>'start_offset_minutes')::integer,(body->>'end_offset_minutes')::integer,body->>'notes',body->>'reason',expected_actor,requested_operation) RETURNING * INTO h;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'appointment_holds',requested_hold,h.sequence,CASE WHEN h.sequence=1 THEN 'create' WHEN h.state='withdrawn' THEN 'withdraw' ELSE 'revise' END,jsonb_build_object('schemaVersion',1,'before',CASE WHEN h.sequence=1 THEN 'null'::jsonb ELSE crest_private.appointment_hold_projection(prior) END,'after',crest_private.appointment_hold_projection(h)),'manual') RETURNING id INTO event;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'holdId',requested_hold,'sequence',h.sequence::text,'versionId',h.id,'auditEventId',event));UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_catalog_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentSequence',coalesce(prior.sequence,0)::text);WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','review');END;
END $save$;
CREATE FUNCTION crest_commands.lookup_appointment_hold_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);RETURN crest_private.appointment_hold_operation_result(requested_business,expected_actor,requested_operation);
END $lookup$;
CREATE FUNCTION crest_commands.read_appointment_holds(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,after_hold uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $list$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);IF page_limit IS NULL OR page_limit<1 OR page_limit>50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_HOLD_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_catalog_read($1,$2,$3,$4,$5,$6,$7,$8);PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH latest AS(SELECT DISTINCT ON(hold_id) hold_id,crest_private.appointment_hold_projection(h) AS row FROM crest.appointment_hold_versions h WHERE business_id=requested_business AND (after_hold IS NULL OR hold_id>after_hold) ORDER BY hold_id,sequence DESC),bounded AS(SELECT * FROM latest ORDER BY hold_id LIMIT page_limit+1),page AS(SELECT * FROM bounded ORDER BY hold_id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'holds',coalesce((SELECT jsonb_agg(row ORDER BY hold_id) FROM page),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM bounded)) INTO result;RETURN result;
END $list$;
RESET ROLE;
GRANT EXECUTE ON FUNCTION crest_private.appointment_hold_projection(crest.appointment_hold_versions) TO crest_hold_owner;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_hold_owner;
ALTER FUNCTION crest_private.appointment_hold_payload(crest.appointment_hold_versions) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_private.valid_appointment_hold_payload(jsonb) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_private.appointment_hold_operation_result(uuid,uuid,uuid) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.lookup_appointment_hold_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_hold_owner;
ALTER FUNCTION crest_commands.read_appointment_holds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) OWNER TO crest_hold_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_hold_owner;
REVOKE ALL ON FUNCTION crest_private.appointment_hold_payload(crest.appointment_hold_versions),crest_private.valid_appointment_hold_payload(jsonb),crest_private.appointment_hold_operation_result(uuid,uuid,uuid),crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_appointment_hold_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_appointment_holds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.lock_mutation_authority(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,text,boolean),crest_commands.authorize_catalog_read(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid),crest_commands.finish_catalog_activity(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid) TO crest_hold_owner;
GRANT EXECUTE ON FUNCTION crest_commands.save_appointment_hold(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_appointment_hold_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid),crest_commands.read_appointment_holds(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,integer) TO crest_web;
