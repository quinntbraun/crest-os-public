-- Unregistered forward39 proposal. Disposable synthetic PostgreSQL only.
-- All38 published migrations remain unchanged. Not a production grant/apply.
DO $review$
BEGIN
 IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_lead_owner','crest_lead_integrity_owner','crest_schema_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
 OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('crest_lead_owner','crest_lead_integrity_owner','crest_schema_owner'))
 OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest.leads'::regclass,'crest.vehicles'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>4 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_VEHICLE_SOURCE_REVIEW_REQUIRED';
 END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.lead_resource_text(value jsonb,maximum integer,nullable boolean,meaningful boolean,multiline boolean) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $text$
 SELECT coalesce(CASE WHEN value='null'::jsonb THEN nullable WHEN jsonb_typeof(value)='string' THEN
 char_length(value#>>'{}')<=maximum
 AND (NOT meaningful OR btrim(value#>>'{}',E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'')
 AND CASE WHEN multiline THEN translate(value#>>'{}',E'\t\n\r','') ELSE value#>>'{}' END!~'[[:cntrl:]]' ELSE false END,false)
$text$;
CREATE FUNCTION crest_private.lead_vehicle_draft_valid(body jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
DECLARE r jsonb;s jsonb;y numeric;
BEGIN
 IF body IS NULL OR jsonb_typeof(body)<>'object' OR body-ARRAY['vehicleId','reportedVehicle','requestedServices','conditionNotes','archived','archiveReason']<>'{}'::jsonb OR NOT body ?& ARRAY['vehicleId','reportedVehicle','requestedServices','conditionNotes','archived','archiveReason'] OR octet_length(body::text)>131072 THEN RETURN false;END IF;
 IF body->'vehicleId'<>'null'::jsonb AND (jsonb_typeof(body->'vehicleId')<>'string' OR body->>'vehicleId'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') THEN RETURN false;END IF;
 IF NOT crest_private.lead_resource_text(body->'conditionNotes',4000,true,false,true) OR jsonb_typeof(body->'archived')<>'boolean' OR NOT (CASE WHEN body->'archived'='true'::jsonb THEN crest_private.lead_resource_text(body->'archiveReason',1000,false,true,true) ELSE body->'archiveReason'='null'::jsonb END) THEN RETURN false;END IF;
 r:=body->'reportedVehicle';s:=body->'requestedServices';
 IF jsonb_typeof(r)<>'object' OR r-ARRAY['schemaVersion','label','year','make','model','color','vin','plate','notes']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','label','year','make','model','color','vin','plate','notes'] OR r->'schemaVersion'<>'1'::jsonb THEN RETURN false;END IF;
 IF NOT crest_private.lead_resource_text(r->'label',200,false,true,false) OR NOT crest_private.lead_resource_text(r->'make',200,true,true,false) OR NOT crest_private.lead_resource_text(r->'model',200,true,true,false) OR NOT crest_private.lead_resource_text(r->'color',128,true,true,false) OR NOT crest_private.lead_resource_text(r->'vin',128,true,true,false) OR NOT crest_private.lead_resource_text(r->'plate',128,true,true,false) OR NOT crest_private.lead_resource_text(r->'notes',2000,true,false,true) THEN RETURN false;END IF;
 IF r->'year'<>'null'::jsonb THEN
  IF jsonb_typeof(r->'year')<>'number' THEN RETURN false;END IF;y:=(r->>'year')::numeric;
  IF y<>trunc(y) OR y NOT BETWEEN -2147483648 AND 2147483647 THEN RETURN false;END IF;
 END IF;
 IF jsonb_typeof(s)<>'object' OR s-ARRAY['schemaVersion','text']<>'{}'::jsonb OR NOT s ?& ARRAY['schemaVersion','text'] OR s->'schemaVersion'<>'1'::jsonb OR NOT crest_private.lead_resource_text(s->'text',4000,true,false,true) THEN RETURN false;END IF;
 RETURN true;
END
$valid$;
REVOKE ALL ON FUNCTION crest_private.lead_resource_text(jsonb,integer,boolean,boolean,boolean),crest_private.lead_vehicle_draft_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_resource_text(jsonb,integer,boolean,boolean,boolean),crest_private.lead_vehicle_draft_valid(jsonb) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE TABLE crest.lead_vehicles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 lead_id uuid NOT NULL,vehicle_id uuid,reported_vehicle jsonb NOT NULL,requested_services jsonb NOT NULL,condition_notes text,
 archived_at timestamptz,archived_reason text,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,updated_by uuid NOT NULL,origin text NOT NULL CHECK(origin IN ('manual','import','system')),operation_id uuid NOT NULL,import_row_id uuid,
 UNIQUE(business_id,id),UNIQUE(business_id,lead_id,vehicle_id),
 FOREIGN KEY(business_id,lead_id) REFERENCES crest.leads(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,vehicle_id) REFERENCES crest.vehicles(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,updated_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,updated_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(isfinite(created_at) AND isfinite(updated_at) AND updated_at>=created_at AND (archived_at IS NULL OR isfinite(archived_at) AND archived_at>=created_at)),
 CHECK(crest_private.lead_vehicle_draft_valid(jsonb_build_object('vehicleId',vehicle_id,'reportedVehicle',reported_vehicle,'requestedServices',requested_services,'conditionNotes',condition_notes,'archived',archived_at IS NOT NULL,'archiveReason',archived_reason)))
);
ALTER TABLE crest.lead_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.lead_vehicles FORCE ROW LEVEL SECURITY;
CREATE INDEX lead_vehicles_parent ON crest.lead_vehicles(business_id,lead_id,id);
CREATE INDEX lead_vehicles_creator ON crest.lead_vehicles(business_id,created_by);
CREATE INDEX lead_vehicles_updater ON crest.lead_vehicles(business_id,updated_by);
CREATE INDEX lead_vehicles_operation ON crest.lead_vehicles(business_id,operation_id,updated_by);
CREATE INDEX lead_vehicles_directory ON crest.lead_vehicles(business_id,vehicle_id) WHERE vehicle_id IS NOT NULL;
GRANT USAGE ON TYPE crest.lead_vehicles TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.lead_vehicle_projection(c crest.lead_vehicles) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $project$
 SELECT jsonb_build_object('id',(c).id,'business_id',(c).business_id,'lead_id',(c).lead_id,'vehicle_id',(c).vehicle_id,'reported_vehicle',(c).reported_vehicle,'requested_services',(c).requested_services,'condition_notes',(c).condition_notes,'archived_at',to_char((c).archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'archived_reason',(c).archived_reason,'version',(c).version::text,'created_at',to_char((c).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(c).created_by,'updated_by',(c).updated_by,'origin',(c).origin,'operation_id',(c).operation_id,'import_row_id',(c).import_row_id)
$project$;
REVOKE ALL ON FUNCTION crest_private.lead_vehicle_projection(crest.lead_vehicles) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_vehicle_projection(crest.lead_vehicles) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.validate_lead_vehicle_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
 -- Serialize intake with future conversion on the genuine parent, even when
 -- two separate reported vehicles are being edited at once.
 PERFORM 1 FROM crest.leads WHERE business_id=NEW.business_id AND id=NEW.lead_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='CREST_LEAD_VEHICLE_PARENT_REQUIRED';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.business_id,NEW.lead_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id) IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.lead_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_VEHICLE_PROVENANCE';END IF;
  IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_VERSION_CONFLICT';END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NOT NULL THEN NEW.archived_at:=OLD.archived_at;ELSIF NEW.archived_at IS NOT NULL THEN NEW.archived_at:=stamp;END IF;
 ELSE
  IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_VERSION_CONFLICT';END IF;
  NEW.created_at:=stamp;IF NEW.archived_at IS NOT NULL THEN NEW.archived_at:=stamp;END IF;
 END IF;
 NEW.updated_at:=stamp;RETURN NEW;
END
$change$;
CREATE FUNCTION crest_private.check_lead_vehicle_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $audit$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM crest_private.audit_events a WHERE a.business_id=NEW.business_id AND a.operation_id=NEW.operation_id AND a.actor_id=NEW.updated_by AND a.entity_kind='lead_vehicles' AND a.entity_id=NEW.id AND a.entity_version=NEW.version AND a.delta->'after'=crest_private.lead_vehicle_projection(NEW::crest.lead_vehicles) AND a.delta->'before'=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE crest_private.lead_vehicle_projection(OLD::crest.lead_vehicles) END) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_AUDIT_REQUIRED';END IF;RETURN NULL;
END
$audit$;
CREATE TRIGGER lead_vehicle_change BEFORE INSERT OR UPDATE ON crest.lead_vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.validate_lead_vehicle_change();
CREATE CONSTRAINT TRIGGER lead_vehicle_audit AFTER INSERT OR UPDATE ON crest.lead_vehicles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_lead_vehicle_audit();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.lead_vehicles FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.lead_vehicles FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.lead_vehicles TO crest_lead_owner;
GRANT INSERT(id,business_id,lead_id,vehicle_id,reported_vehicle,requested_services,condition_notes,archived_at,archived_reason,created_by,updated_by,origin,operation_id) ON crest.lead_vehicles TO crest_lead_owner;
GRANT UPDATE(vehicle_id,reported_vehicle,requested_services,condition_notes,archived_at,archived_reason,version,updated_by,operation_id) ON crest.lead_vehicles TO crest_lead_owner;
CREATE POLICY lead_vehicle_read ON crest.lead_vehicles FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY lead_vehicle_create ON crest.lead_vehicles FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND updated_by=created_by AND origin='manual' AND import_row_id IS NULL AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
CREATE POLICY lead_vehicle_edit ON crest.lead_vehicles FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid) WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND updated_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT SELECT(id,business_id) ON crest.vehicles TO crest_lead_owner;
CREATE POLICY lead_vehicle_directory_parent ON crest.vehicles FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY lead_vehicle_audits_read ON crest_private.audit_events FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='lead_vehicles');
CREATE POLICY lead_vehicle_audits_create ON crest_private.audit_events FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='lead_vehicles' AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_vehicle_operations_read ON crest_private.operations FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.vehicle.save');
CREATE POLICY lead_vehicle_operations_create ON crest_private.operations FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.lead.vehicle.save' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_vehicle_operations_finish ON crest_private.operations FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.vehicle.save') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.vehicle.save');
CREATE POLICY lead_vehicle_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_lead_integrity_owner USING(entity_kind='lead_vehicles');
CREATE UNIQUE INDEX lead_vehicle_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='lead_vehicles';
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.check_lead_vehicle_audit() OWNER TO crest_lead_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_lead_integrity_owner;
REVOKE ALL ON FUNCTION crest_private.check_lead_vehicle_audit(),crest_private.validate_lead_vehicle_change() FROM PUBLIC;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.lead_vehicle_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;a record;r jsonb;b jsonb;n jsonb;body jsonb;expected_version text;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type='crm.lead.vehicle.save';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','leadId','leadVehicleId','leadVehicleVersion','auditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','leadId','leadVehicleId','leadVehicleVersion','auditEventId'] OR r->'schemaVersion'<>'1'::jsonb OR r->>'businessId'<>requested_business::text OR jsonb_typeof(r->'leadVehicleVersion')<>'string' OR r->>'leadVehicleVersion'!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND id=(r->>'auditEventId')::uuid AND operation_id=requested_operation AND actor_id=requested_actor AND entity_kind='lead_vehicles' AND entity_id=(r->>'leadVehicleId')::uuid AND entity_version=(r->>'leadVehicleVersion')::bigint;
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_RESULT_REVIEW_REQUIRED';END IF;
 b:=a.delta->'before';n:=a.delta->'after';expected_version:=CASE WHEN b='null'::jsonb THEN '0' ELSE b->>'version' END;
 IF jsonb_typeof(n) IS DISTINCT FROM 'object' OR n-ARRAY['id','business_id','lead_id','vehicle_id','reported_vehicle','requested_services','condition_notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id']<>'{}'::jsonb OR NOT n ?& ARRAY['id','business_id','lead_id','vehicle_id','reported_vehicle','requested_services','condition_notes','archived_at','archived_reason','version','created_at','updated_at','created_by','updated_by','origin','operation_id','import_row_id'] OR b IS NULL OR (b<>'null'::jsonb AND (jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'id' IS DISTINCT FROM r->>'leadVehicleId' OR b->>'lead_id' IS DISTINCT FROM r->>'leadId')) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_RESULT_REVIEW_REQUIRED';END IF;
 body:=jsonb_build_object('vehicleId',n->'vehicle_id','reportedVehicle',n->'reported_vehicle','requestedServices',n->'requested_services','conditionNotes',n->'condition_notes','archived',n->'archived_at'<>'null'::jsonb,'archiveReason',n->'archived_reason');
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.vehicle.save','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'leadId',r->'leadId','leadVehicleId',r->'leadVehicleId','expectedVersion',expected_version,'payload',body)::text,'UTF8')),'hex');
 IF expected_version IS NULL OR NOT crest_private.lead_vehicle_draft_valid(body) OR (r->>'leadVehicleVersion')::bigint<>expected_version::bigint+1 OR n->>'id'<>r->>'leadVehicleId' OR n->>'lead_id'<>r->>'leadId' OR n->>'business_id'<>requested_business::text OR n->>'operation_id'<>requested_operation::text OR n->>'updated_by'<>requested_actor::text OR n->>'version'<>r->>'leadVehicleVersion' OR digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VEHICLE_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END
$result$;
CREATE FUNCTION crest_commands.save_lead_vehicle(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_lead uuid,requested_lead_vehicle uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $save$
DECLARE context jsonb;digest text;claimed uuid;existing record;old_row crest.lead_vehicles;new_row crest.lead_vehicles;event_id uuid;command_result jsonb;action text;violated text;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_lead IS NULL OR requested_lead_vehicle IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<0 OR NOT crest_private.lead_vehicle_draft_valid(body) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_INPUT_REQUIRED';END IF;
 BEGIN
  context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
  PERFORM crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_LEAD_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.vehicle.save','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'leadId',requested_lead,'leadVehicleId',requested_lead_vehicle,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
  INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.lead.vehicle.save',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
  IF claimed IS NULL THEN
   SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
   IF NOT FOUND OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
   command_result:=crest_private.lead_vehicle_operation_result(requested_business,expected_actor,requested_operation);
  ELSE
   PERFORM 1 FROM crest.leads WHERE business_id=requested_business AND id=requested_lead FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_VEHICLE_PARENT_CONFLICT';END IF;
   IF body->>'vehicleId' IS NOT NULL THEN PERFORM 1 FROM crest.vehicles WHERE business_id=requested_business AND id=(body->>'vehicleId')::uuid;IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_VEHICLE_PARENT_CONFLICT';END IF;END IF;
   SELECT * INTO old_row FROM crest.lead_vehicles WHERE business_id=requested_business AND id=requested_lead_vehicle FOR UPDATE;
   IF old_row.id IS NOT NULL AND old_row.lead_id<>requested_lead THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_VEHICLE_PARENT_CONFLICT';END IF;
   IF coalesce(old_row.version,0)<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_LEAD_VEHICLE_VERSION_CONFLICT';END IF;
   IF expected_version=0 THEN
    INSERT INTO crest.lead_vehicles(id,business_id,lead_id,vehicle_id,reported_vehicle,requested_services,condition_notes,archived_at,archived_reason,created_by,updated_by,origin,operation_id) VALUES(requested_lead_vehicle,requested_business,requested_lead,(body->>'vehicleId')::uuid,body->'reportedVehicle',body->'requestedServices',body->>'conditionNotes',CASE WHEN body->'archived'='true'::jsonb THEN clock_timestamp() ELSE NULL END,body->>'archiveReason',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO new_row;
   ELSE
    UPDATE crest.lead_vehicles SET vehicle_id=(body->>'vehicleId')::uuid,reported_vehicle=body->'reportedVehicle',requested_services=body->'requestedServices',condition_notes=body->>'conditionNotes',archived_at=CASE WHEN body->'archived'='true'::jsonb THEN coalesce(archived_at,clock_timestamp()) ELSE NULL END,archived_reason=body->>'archiveReason',version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_lead_vehicle RETURNING * INTO new_row;
   END IF;
   action:=CASE WHEN expected_version=0 THEN 'create' WHEN old_row.archived_at IS NULL AND new_row.archived_at IS NOT NULL THEN 'archive' WHEN old_row.archived_at IS NOT NULL AND new_row.archived_at IS NULL THEN 'reopen' ELSE 'edit' END;
   INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'lead_vehicles',requested_lead_vehicle,new_row.version,action,jsonb_build_object('schemaVersion',1,'before',CASE WHEN expected_version=0 THEN 'null'::jsonb ELSE crest_private.lead_vehicle_projection(old_row) END,'after',crest_private.lead_vehicle_projection(new_row)),'manual') RETURNING id INTO event_id;
   command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadVehicleId',requested_lead_vehicle,'leadVehicleVersion',new_row.version::text,'auditEventId',event_id));
   UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
  END IF;
  PERFORM crest_commands.finish_lead_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','parent');
 WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',coalesce(old_row.version,0)::text);
 WHEN unique_violation THEN GET STACKED DIAGNOSTICS violated=CONSTRAINT_NAME;IF violated='lead_vehicles_pkey' THEN RETURN jsonb_build_object('state','conflict','reason','lead_vehicle');ELSIF violated='lead_vehicles_business_id_lead_id_vehicle_id_key' THEN RETURN jsonb_build_object('state','conflict','reason','vehicle');END IF;RAISE;
 END;
END
$save$;
CREATE FUNCTION crest_commands.lookup_lead_vehicle_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.lead_vehicle_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private,crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_private.lead_vehicle_operation_result(uuid,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.save_lead_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lookup_lead_vehicle_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_private,crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_private.lead_vehicle_operation_result(uuid,uuid,uuid),crest_commands.save_lead_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_lead_vehicle_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.save_lead_vehicle(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,uuid,bigint,jsonb),crest_commands.lookup_lead_vehicle_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_commands.read_lead_vehicles(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,after_id uuid,include_archived boolean,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $directory$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR include_archived IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH target AS MATERIALIZED(SELECT version FROM crest.leads WHERE business_id=requested_business AND id=requested_lead),
 matches AS MATERIALIZED(SELECT v.* FROM crest.lead_vehicles v WHERE v.business_id=requested_business AND v.lead_id=requested_lead AND (include_archived OR v.archived_at IS NULL) AND (after_id IS NULL OR v.id>after_id) ORDER BY v.id LIMIT page_limit+1),
 page AS(SELECT * FROM matches ORDER BY id LIMIT page_limit)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadVersion',(SELECT version::text FROM target),'leadVehicles',coalesce((SELECT jsonb_agg(crest_private.lead_vehicle_projection(p::crest.lead_vehicles) ORDER BY p.id) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) ELSE jsonb_build_object('state','absent') END INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_VEHICLE_PAGE_LIMIT';END IF;RETURN result;
END
$directory$;
CREATE FUNCTION crest_commands.read_lead_vehicle_history(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,requested_lead_vehicle uuid,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $history$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR requested_lead_vehicle IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH target AS MATERIALIZED(SELECT * FROM crest.lead_vehicles WHERE business_id=requested_business AND lead_id=requested_lead AND id=requested_lead_vehicle),
 events AS MATERIALIZED(SELECT * FROM crest_private.audit_events WHERE business_id=requested_business AND entity_kind='lead_vehicles' AND entity_id=requested_lead_vehicle AND entity_version>after_version ORDER BY entity_version LIMIT page_limit+1),
 page AS(SELECT * FROM events ORDER BY entity_version LIMIT page_limit)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadVehicle',(SELECT crest_private.lead_vehicle_projection(t::crest.lead_vehicles) FROM target t),'history',coalesce((SELECT jsonb_agg(jsonb_build_object('version',p.entity_version::text,'eventId',p.id,'actorId',p.actor_id,'operationId',p.operation_id,'at',to_char(p.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'action',p.action,'before',p.delta->'before','after',p.delta->'after') ORDER BY p.entity_version) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM events)) ELSE jsonb_build_object('state','absent') END INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_VEHICLE_PAGE_LIMIT';END IF;RETURN result;
END
$history$;
-- Separate privileged export caller, never raw table access or web execute.
-- Whole-export authorization and private custody remain separately required.
CREATE FUNCTION crest_commands.lead_vehicle_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $context$
DECLARE n bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_VEHICLE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_INPUT_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO n FROM crest.lead_vehicles WHERE business_id=requested_business;IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_VEHICLE_SNAPSHOT_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','lead_vehicle_intake','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead.vehicle.intake.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$context$;
CREATE FUNCTION crest_commands.lead_vehicle_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.lead_vehicle_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_VEHICLE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS(SELECT * FROM crest.lead_vehicles WHERE business_id=requested_business AND (after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'leadVehicles',coalesce(jsonb_agg(crest_private.lead_vehicle_projection(p::crest.lead_vehicles) ORDER BY p.id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_VEHICLE_PAGE_LIMIT';END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_vehicles(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,boolean,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_vehicle_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_vehicle_snapshot_context(uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_vehicle_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_commands.read_lead_vehicles(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,boolean,integer),crest_commands.read_lead_vehicle_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer),crest_commands.lead_vehicle_snapshot_context(uuid),crest_commands.lead_vehicle_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_vehicles(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,boolean,integer),crest_commands.read_lead_vehicle_history(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_vehicle_snapshot_context(uuid),crest_commands.lead_vehicle_snapshot_page(uuid,text,uuid,integer) TO crest_export;
