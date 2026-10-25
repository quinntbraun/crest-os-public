-- Forward38 proposal. NOT registered/applied by normal migrations.
-- BR02.2: manual state events; no quote-send/acceptance creation authority.
DO $review$
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('crest_lead_owner','crest_lead_integrity_owner','crest_schema_owner') AND NOT(rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND rolconfig IS NULL)<>3
    OR EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles p ON p.oid=m.roleid OR p.oid=m.member WHERE p.rolname IN ('crest_lead_owner','crest_lead_integrity_owner','crest_schema_owner'))
    OR (SELECT count(*) FROM pg_class WHERE oid IN ('crest.leads'::regclass,'crest_private.operations'::regclass,'crest_private.audit_events'::regclass) AND relowner='crest_schema_owner'::regrole AND relrowsecurity AND relforcerowsecurity)<>3 THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='CREST_LEAD_STATE_SOURCE_REVIEW_REQUIRED';
  END IF;
END
$review$;
SET LOCAL ROLE crest_schema_owner;
CREATE FUNCTION crest_private.manual_lead_state_valid(from_value text,to_value text,reason_value text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $valid$
 SELECT coalesce(from_value IN ('new','contacted','awaiting_information','quote_needed','quote_sent','follow_up','won','lost')
   AND to_value IN ('new','contacted','awaiting_information','quote_needed','follow_up','lost') AND from_value<>to_value
   AND NOT(from_value IN ('won','lost') AND to_value='lost')
   AND (reason_value IS NULL OR char_length(reason_value)<=1000 AND btrim(reason_value,E'\t\n\r\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')<>'' AND translate(reason_value,E'\t\n\r','')!~'[[:cntrl:]]')
   AND (NOT(from_value IN ('won','lost') OR to_value='lost') OR reason_value IS NOT NULL),false)
$valid$;
REVOKE ALL ON FUNCTION crest_private.manual_lead_state_valid(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.manual_lead_state_valid(text,text,text) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE TABLE crest.lead_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES crest.businesses(id) ON DELETE RESTRICT,
 lead_id uuid NOT NULL,
 lead_version bigint NOT NULL CHECK(lead_version>1),
 from_state text NOT NULL,
 to_state text NOT NULL,
 reason text,
 effective_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 -- No commercial source exists yet. A later migration must add genuine FKs
 -- and reviewed commercial commands before these may become non-null.
 quote_send_id uuid CHECK(quote_send_id IS NULL),
 acceptance_id uuid CHECK(acceptance_id IS NULL),
 version bigint NOT NULL DEFAULT 1 CHECK(version=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_by uuid NOT NULL,
 updated_by uuid NOT NULL CHECK(updated_by=created_by),
 origin text NOT NULL CHECK(origin='manual'),
 operation_id uuid NOT NULL,
 import_row_id uuid CHECK(import_row_id IS NULL),
 UNIQUE(business_id,id),UNIQUE(business_id,lead_id,lead_version),UNIQUE(business_id,operation_id),
 FOREIGN KEY(business_id,lead_id) REFERENCES crest.leads(business_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,created_by) REFERENCES crest.memberships(business_id,actor_id) ON DELETE RESTRICT,
 FOREIGN KEY(business_id,operation_id,created_by) REFERENCES crest_private.operations(business_id,operation_id,actor_id) ON DELETE RESTRICT,
 CHECK(crest_private.manual_lead_state_valid(from_state,to_state,reason)),
 CHECK(isfinite(effective_at) AND effective_at=created_at AND created_at=updated_at)
);
ALTER TABLE crest.lead_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crest.lead_events FORCE ROW LEVEL SECURITY;
CREATE INDEX lead_events_actor ON crest.lead_events(business_id,created_by);
GRANT USAGE ON TYPE crest.lead_events TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.lead_event_projection(e crest.lead_events) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $project$
 SELECT jsonb_build_object('id',(e).id,'business_id',(e).business_id,'lead_id',(e).lead_id,'lead_version',(e).lead_version::text,'from_state',(e).from_state,'to_state',(e).to_state,'reason',(e).reason,'effective_at',to_char((e).effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'quote_send_id',(e).quote_send_id,'acceptance_id',(e).acceptance_id,'version',(e).version::text,'created_at',to_char((e).created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((e).updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'created_by',(e).created_by,'updated_by',(e).updated_by,'origin',(e).origin,'operation_id',(e).operation_id,'import_row_id',(e).import_row_id)
$project$;
REVOKE ALL ON FUNCTION crest_private.lead_event_projection(crest.lead_events) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_event_projection(crest.lead_events) TO crest_lead_owner,crest_lead_integrity_owner;
CREATE FUNCTION crest_private.prepare_lead_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $prepare$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN NEW.effective_at:=stamp;NEW.created_at:=stamp;NEW.updated_at:=stamp;RETURN NEW;END
$prepare$;
CREATE TRIGGER lead_event_prepare BEFORE INSERT ON crest.lead_events FOR EACH ROW EXECUTE FUNCTION crest_private.prepare_lead_event();
CREATE TRIGGER retained_update BEFORE UPDATE ON crest.lead_events FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_delete BEFORE DELETE ON crest.lead_events FOR EACH ROW EXECUTE FUNCTION crest_private.reject_command_history_removal();
CREATE TRIGGER retained_truncate BEFORE TRUNCATE ON crest.lead_events FOR EACH STATEMENT EXECUTE FUNCTION crest_private.reject_command_history_removal();
GRANT SELECT ON crest.lead_events TO crest_lead_owner,crest_lead_integrity_owner;
GRANT INSERT(id,business_id,lead_id,lead_version,from_state,to_state,reason,created_by,updated_by,origin,operation_id) ON crest.lead_events TO crest_lead_owner;
CREATE POLICY lead_event_read ON crest.lead_events FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid);
CREATE POLICY lead_event_integrity ON crest.lead_events FOR SELECT TO crest_lead_integrity_owner USING(true);
CREATE POLICY lead_event_create ON crest.lead_events FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND created_by=nullif(current_setting('crest.actor_id',true),'')::uuid AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid);
GRANT UPDATE(state,lost_reason) ON crest.leads TO crest_lead_owner;
GRANT INSERT(reason,effective_at) ON crest_private.audit_events TO crest_lead_owner;
CREATE POLICY lead_state_operations_read ON crest_private.operations FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.state');
CREATE POLICY lead_state_operations_create ON crest_private.operations FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND command_type='crm.lead.state' AND schema_version=1 AND origin='manual' AND import_row_id IS NULL);
CREATE POLICY lead_state_operations_finish ON crest_private.operations FOR UPDATE TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.state') WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND command_type='crm.lead.state');
CREATE POLICY lead_event_audits_read ON crest_private.audit_events FOR SELECT TO crest_lead_owner USING(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND entity_kind='lead_events');
CREATE POLICY lead_event_audits_create ON crest_private.audit_events FOR INSERT TO crest_lead_owner WITH CHECK(business_id=nullif(current_setting('crest.business_id',true),'')::uuid AND actor_id=nullif(current_setting('crest.actor_id',true),'')::uuid AND created_by=actor_id AND operation_id=nullif(current_setting('crest.operation_id',true),'')::uuid AND entity_kind='lead_events' AND origin='manual' AND import_row_id IS NULL);
GRANT SELECT(id,action,reason,effective_at) ON crest_private.audit_events TO crest_lead_integrity_owner;
CREATE POLICY lead_event_integrity_audits ON crest_private.audit_events FOR SELECT TO crest_lead_integrity_owner USING(entity_kind='lead_events');
GRANT SELECT ON crest_private.operations TO crest_lead_integrity_owner;
CREATE POLICY lead_state_integrity_operations ON crest_private.operations FOR SELECT TO crest_lead_integrity_owner USING(command_type='crm.lead.state');
CREATE UNIQUE INDEX lead_event_audit_version ON crest_private.audit_events(business_id,entity_id,entity_version) WHERE entity_kind='lead_events';

-- The existing complete lead provenance/source/version guard is replaced below.
CREATE OR REPLACE FUNCTION crest_private.validate_lead_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $change$
DECLARE stamp timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.state,NEW.lost_reason) IS DISTINCT FROM ROW(OLD.state,OLD.lost_reason) AND NOT EXISTS(SELECT 1 FROM crest.lead_events e WHERE e.business_id=NEW.business_id AND e.lead_id=NEW.id AND e.lead_version=NEW.version AND e.from_state=OLD.state AND e.to_state=NEW.state AND e.operation_id=NEW.operation_id AND e.created_by=NEW.updated_by AND NEW.lost_reason IS NOT DISTINCT FROM CASE WHEN e.to_state='lost' THEN e.reason ELSE NULL END) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_STATE_EVENT_REQUIRED';
    END IF;
    -- Generated hints are filled after BEFORE triggers; compare source provenance explicitly.
    IF ROW(NEW.id,NEW.business_id,NEW.created_at,NEW.created_by,NEW.origin,NEW.import_row_id)
      IS DISTINCT FROM ROW(OLD.id,OLD.business_id,OLD.created_at,OLD.created_by,OLD.origin,OLD.import_row_id) THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_PROVENANCE';
    END IF;
    IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VERSION_CONFLICT'; END IF;
  ELSE
    IF NEW.version<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_VERSION_CONFLICT'; END IF;
    NEW.created_at:=stamp;
  END IF;
  IF TG_OP='INSERT' AND (NEW.state<>'new' OR NEW.lost_reason IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_EVENT_REQUIRED'; END IF;
  IF TG_OP='UPDATE' AND NEW.source_id IS NOT DISTINCT FROM OLD.source_id THEN
    IF NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='CREST_IMMUTABLE_LEAD_SOURCE_SNAPSHOT'; END IF;
  ELSIF NEW.source_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM crest.lead_sources c WHERE c.business_id=NEW.business_id AND c.id=NEW.source_id AND NEW.source_snapshot=crest_private.lead_source_projection(c)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_SOURCE_SNAPSHOT_REQUIRED';
  END IF;
  NEW.updated_at:=stamp;RETURN NEW;
END
$change$;


CREATE FUNCTION crest_private.lead_state_operation_result(requested_business uuid,requested_actor uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $result$
DECLARE o record;e crest.lead_events;l record;a record;r jsonb;b jsonb;n jsonb;body jsonb;digest text;
BEGIN
 SELECT * INTO o FROM crest_private.operations WHERE business_id=requested_business AND actor_id=requested_actor AND operation_id=requested_operation AND command_type='crm.lead.state';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','absent');END IF;r:=o.result;
 IF o.state<>'committed' OR o.schema_version<>1 OR o.result_schema_version<>1 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r-ARRAY['schemaVersion','businessId','leadId','leadVersion','leadEventId','leadAuditEventId','eventAuditEventId']<>'{}'::jsonb OR NOT r ?& ARRAY['schemaVersion','businessId','leadId','leadVersion','leadEventId','leadAuditEventId','eventAuditEventId'] OR r->'schemaVersion'<>'1'::jsonb OR r->>'businessId'<>requested_business::text OR jsonb_typeof(r->'leadVersion')<>'string' OR (r->>'leadVersion')!~'^[1-9][0-9]{0,18}$' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT * INTO e FROM crest.lead_events WHERE business_id=requested_business AND id=(r->>'leadEventId')::uuid AND lead_id=(r->>'leadId')::uuid AND lead_version=(r->>'leadVersion')::bigint AND created_by=requested_actor AND operation_id=requested_operation;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT delta,action,reason,effective_at INTO l FROM crest_private.audit_events WHERE business_id=requested_business AND id=(r->>'leadAuditEventId')::uuid AND operation_id=requested_operation AND actor_id=requested_actor AND entity_kind='leads' AND entity_id=e.lead_id AND entity_version=e.lead_version;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_RESULT_REVIEW_REQUIRED';END IF;
 SELECT delta,action,reason,effective_at INTO a FROM crest_private.audit_events WHERE business_id=requested_business AND id=(r->>'eventAuditEventId')::uuid AND operation_id=requested_operation AND actor_id=requested_actor AND entity_kind='lead_events' AND entity_id=e.id AND entity_version=1;
 IF NOT FOUND OR (SELECT count(*) FROM crest_private.audit_events WHERE business_id=requested_business AND operation_id=requested_operation)<>2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_RESULT_REVIEW_REQUIRED';END IF;
 b:=l.delta->'before';n:=l.delta->'after';
 IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR jsonb_typeof(n) IS DISTINCT FROM 'object' OR l.action<>'state_change' OR a.action<>'create' OR l.reason IS DISTINCT FROM e.reason OR a.reason IS DISTINCT FROM e.reason OR l.effective_at IS DISTINCT FROM e.effective_at OR a.effective_at IS DISTINCT FROM e.effective_at OR a.delta->'before'<>'null'::jsonb OR a.delta->'after' IS DISTINCT FROM crest_private.lead_event_projection(e)
   OR b->>'id' IS DISTINCT FROM e.lead_id::text OR b->>'business_id' IS DISTINCT FROM requested_business::text OR b->>'state' IS DISTINCT FROM e.from_state OR n->>'state' IS DISTINCT FROM e.to_state OR n->>'version' IS DISTINCT FROM e.lead_version::text OR n->>'updated_by' IS DISTINCT FROM requested_actor::text OR n->>'operation_id' IS DISTINCT FROM requested_operation::text
   OR n->'lost_reason' IS DISTINCT FROM (CASE WHEN e.to_state='lost' THEN to_jsonb(e.reason) ELSE 'null'::jsonb END)
   OR (b-ARRAY['state','lost_reason','version','updated_at','updated_by','operation_id']) IS DISTINCT FROM (n-ARRAY['state','lost_reason','version','updated_at','updated_by','operation_id'])
   OR (b->>'version')::bigint+1<>e.lead_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_RESULT_REVIEW_REQUIRED';END IF;
 body:=jsonb_build_object('fromState',e.from_state,'toState',e.to_state,'reason',e.reason);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.state','schemaVersion',1,'businessId',requested_business,'actorId',requested_actor,'recoveryEpoch',o.recovery_epoch,'leadId',e.lead_id,'expectedVersion',b->>'version','payload',body)::text,'UTF8')),'hex');
 IF digest<>o.payload_hash THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_RESULT_REVIEW_REQUIRED';END IF;
 RETURN jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',o.recovery_epoch,'receipt',r);
END
$result$;
CREATE FUNCTION crest_private.check_lead_state_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $check$
DECLARE outcome jsonb;
BEGIN
 IF TG_TABLE_NAME='leads' THEN
   IF NEW.state IS NOT DISTINCT FROM OLD.state AND NEW.lost_reason IS NOT DISTINCT FROM OLD.lost_reason THEN RETURN NULL;END IF;
   outcome:=crest_private.lead_state_operation_result(NEW.business_id,NEW.updated_by,NEW.operation_id);
   IF outcome->'receipt'->>'leadId' IS DISTINCT FROM NEW.id::text OR outcome->'receipt'->>'leadVersion' IS DISTINCT FROM NEW.version::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_EVENT_REQUIRED';END IF;
 ELSE
   outcome:=crest_private.lead_state_operation_result(NEW.business_id,NEW.created_by,NEW.operation_id);
   IF outcome->'receipt'->>'leadEventId' IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CREST_LEAD_STATE_EVENT_REQUIRED';END IF;
 END IF;RETURN NULL;
END
$check$;
CREATE CONSTRAINT TRIGGER lead_state_event AFTER UPDATE ON crest.leads DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_lead_state_event();
CREATE CONSTRAINT TRIGGER lead_event_audit AFTER INSERT ON crest.lead_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION crest_private.check_lead_state_event();

CREATE FUNCTION crest_commands.change_lead_state(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,expected_epoch uuid,requested_operation uuid,request_schema integer,requested_lead uuid,expected_version bigint,body jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $change$
DECLARE context jsonb;digest text;claimed uuid;existing record;old_row crest.leads;new_row crest.leads;event_row crest.lead_events;lead_audit uuid;event_audit uuid;command_result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL OR requested_lead IS NULL OR request_schema IS DISTINCT FROM 1 OR expected_version IS NULL OR expected_version<1 OR expected_version=9223372036854775807 OR body IS NULL OR jsonb_typeof(body)<>'object' OR octet_length(body::text)>8192 OR body-ARRAY['fromState','toState','reason']<>'{}'::jsonb OR NOT body ?& ARRAY['fromState','toState','reason']
   OR jsonb_typeof(body->'fromState')<>'string' OR jsonb_typeof(body->'toState')<>'string' OR jsonb_typeof(body->'reason') NOT IN ('string','null') OR NOT crest_private.manual_lead_state_valid(body->>'fromState',body->>'toState',body->>'reason') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_STATE_INPUT_REQUIRED';END IF;
 BEGIN
   context:=crest_commands.lock_mutation_authority(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,'crm.manage',false);
   PERFORM crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM IN ('CREST_MUTATION_AUTHORIZATION_DENIED','CREST_TENANT_READ_DENIED','CREST_LEAD_READ_DENIED') THEN RETURN jsonb_build_object('state','denied');END IF;RAISE;END;
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true),set_config('crest.operation_id',requested_operation::text,true);
 digest:=encode(sha256(convert_to(jsonb_build_object('commandType','crm.lead.state','schemaVersion',1,'businessId',requested_business,'actorId',expected_actor,'recoveryEpoch',expected_epoch,'leadId',requested_lead,'expectedVersion',expected_version::text,'payload',body)::text,'UTF8')),'hex');
 BEGIN
   INSERT INTO crest_private.operations(business_id,operation_id,actor_id,command_type,schema_version,recovery_epoch,payload_hash,created_by,origin) VALUES(requested_business,requested_operation,expected_actor,'crm.lead.state',1,expected_epoch,digest,expected_actor,'manual') ON CONFLICT(business_id,operation_id) DO NOTHING RETURNING id INTO claimed;
   IF claimed IS NULL THEN
     SELECT * INTO existing FROM crest_private.operations WHERE business_id=requested_business AND operation_id=requested_operation;
     IF NOT FOUND OR existing.command_type<>'crm.lead.state' OR existing.actor_id<>expected_actor OR existing.recovery_epoch<>expected_epoch OR existing.payload_hash<>digest THEN RETURN jsonb_build_object('state','conflict','reason','operation');END IF;
     command_result:=crest_private.lead_state_operation_result(requested_business,expected_actor,requested_operation);
   ELSE
     SELECT * INTO old_row FROM crest.leads WHERE business_id=requested_business AND id=requested_lead FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P1002',MESSAGE='CREST_LEAD_STATE_LEAD_CONFLICT';END IF;
     IF old_row.version<>expected_version THEN RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='CREST_LEAD_STATE_VERSION_CONFLICT';END IF;
     IF old_row.state<>body->>'fromState' THEN RAISE EXCEPTION USING ERRCODE='P1003',MESSAGE='CREST_LEAD_STATE_STATE_CONFLICT';END IF;
     INSERT INTO crest.lead_events(business_id,lead_id,lead_version,from_state,to_state,reason,created_by,updated_by,origin,operation_id) VALUES(requested_business,requested_lead,expected_version+1,body->>'fromState',body->>'toState',body->>'reason',expected_actor,expected_actor,'manual',requested_operation) RETURNING * INTO event_row;
     UPDATE crest.leads SET state=body->>'toState',lost_reason=CASE WHEN body->>'toState'='lost' THEN body->>'reason' ELSE NULL END,version=version+1,updated_by=expected_actor,operation_id=requested_operation WHERE business_id=requested_business AND id=requested_lead RETURNING * INTO new_row;
     INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,effective_at,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'leads',requested_lead,new_row.version,'state_change',event_row.reason,event_row.effective_at,jsonb_build_object('schemaVersion',1,'before',crest_private.lead_projection(old_row),'after',crest_private.lead_projection(new_row)),'manual') RETURNING id INTO lead_audit;
     INSERT INTO crest_private.audit_events(business_id,operation_id,actor_id,created_by,entity_kind,entity_id,entity_version,action,reason,effective_at,delta,origin) VALUES(requested_business,requested_operation,expected_actor,expected_actor,'lead_events',event_row.id,1,'create',event_row.reason,event_row.effective_at,jsonb_build_object('schemaVersion',1,'before','null'::jsonb,'after',crest_private.lead_event_projection(event_row)),'manual') RETURNING id INTO event_audit;
     command_result:=jsonb_build_object('state','committed','operationId',requested_operation,'recoveryEpoch',expected_epoch,'receipt',jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadVersion',new_row.version::text,'leadEventId',event_row.id,'leadAuditEventId',lead_audit,'eventAuditEventId',event_audit));
     UPDATE crest_private.operations SET state='committed',result_schema_version=1,result=command_result->'receipt' WHERE business_id=requested_business AND operation_id=requested_operation;
   END IF;
   PERFORM crest_commands.finish_lead_activity(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business,expected_epoch,requested_operation);RETURN command_result;
 EXCEPTION WHEN SQLSTATE 'P1001' THEN RETURN jsonb_build_object('state','conflict','reason','version','currentVersion',old_row.version::text);
   WHEN SQLSTATE 'P1002' THEN RETURN jsonb_build_object('state','conflict','reason','lead');
   WHEN SQLSTATE 'P1003' THEN RETURN jsonb_build_object('state','conflict','reason','state');END;
END
$change$;
CREATE FUNCTION crest_commands.lookup_lead_state_operation(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_operation uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $lookup$
DECLARE context jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_operation IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_STATE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 RETURN crest_private.lead_state_operation_result(requested_business,expected_actor,requested_operation);
END
$lookup$;
CREATE FUNCTION crest_commands.read_lead_state_events(credential_hash bytea,expected_session uuid,expected_actor uuid,expected_issuer text,expected_subject uuid,expected_provider_session uuid,provider_valid_until timestamptz,requested_business uuid,requested_lead uuid,after_version bigint,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $events$
DECLARE context jsonb;result jsonb;
BEGIN
 PERFORM set_config('crest.business_id','',true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF requested_lead IS NULL OR after_version IS NULL OR after_version<0 OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_STATE_INPUT_REQUIRED';END IF;
 context:=crest_commands.authorize_lead_read(credential_hash,expected_session,expected_actor,expected_issuer,expected_subject,expected_provider_session,provider_valid_until,requested_business);
 PERFORM set_config('crest.business_id',context->>'businessId',true),set_config('crest.actor_id',context->>'actorId',true);
 WITH target AS MATERIALIZED(SELECT * FROM crest.leads WHERE business_id=requested_business AND id=requested_lead),
 matches AS MATERIALIZED(SELECT * FROM crest.lead_events WHERE business_id=requested_business AND lead_id=requested_lead AND lead_version>after_version ORDER BY lead_version LIMIT page_limit+1),
 page AS(SELECT * FROM matches ORDER BY lead_version LIMIT page_limit)
 SELECT CASE WHEN EXISTS(SELECT 1 FROM target) THEN jsonb_build_object('schemaVersion',1,'businessId',requested_business,'leadId',requested_lead,'leadVersion',(SELECT version::text FROM target),'events',coalesce((SELECT jsonb_agg(crest_private.lead_event_projection(p::crest.lead_events) ORDER BY lead_version) FROM page p),'[]'::jsonb),'hasMore',(SELECT count(*)>page_limit FROM matches)) ELSE jsonb_build_object('state','absent') END INTO result;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_STATE_PAGE_LIMIT';END IF;RETURN result;
END
$events$;
-- Privileged partial source extraction. Caller must eventually own an actual
-- authorized whole-export job; these functions confer no download authority.
CREATE FUNCTION crest_commands.lead_event_snapshot_context(requested_business uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $snapshot$
DECLARE n bigint;
BEGIN
 IF current_setting('transaction_isolation')<>'repeatable read' OR current_setting('transaction_read_only')<>'on' THEN RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='CREST_LEAD_STATE_SNAPSHOT_REQUIRED';END IF;
 IF requested_business IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_STATE_INPUT_REQUIRED';END IF;
 PERFORM set_config('crest.business_id',requested_business::text,true),set_config('crest.actor_id','',true),set_config('crest.operation_id','',true);
 IF NOT EXISTS(SELECT 1 FROM crest.businesses WHERE id=requested_business) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_STATE_SCOPE_REQUIRED';END IF;
 SELECT count(*) INTO n FROM crest.lead_events WHERE business_id=requested_business;
 IF n>1000 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_STATE_SNAPSHOT_LIMIT';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'scope','lead_state_events','businessId',requested_business,'snapshotToken',encode(sha256(convert_to(jsonb_build_object('domain','crest.lead.state.snapshot/1','businessId',requested_business,'snapshot',pg_current_snapshot()::text)::text,'UTF8')),'hex'),'rowCount',n::text);
END
$snapshot$;
CREATE FUNCTION crest_commands.lead_event_snapshot_page(requested_business uuid,expected_snapshot text,after_id uuid,page_limit integer) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $page$
DECLARE context jsonb;result jsonb;
BEGIN
 context:=crest_commands.lead_event_snapshot_context(requested_business);
 IF expected_snapshot IS DISTINCT FROM context->>'snapshotToken' OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CREST_LEAD_STATE_SNAPSHOT_REQUIRED';END IF;
 WITH page AS(SELECT * FROM crest.lead_events WHERE business_id=requested_business AND(after_id IS NULL OR id>after_id) ORDER BY id LIMIT page_limit)
 SELECT jsonb_build_object('schemaVersion',1,'businessId',requested_business,'snapshotToken',expected_snapshot,'events',coalesce(jsonb_agg(crest_private.lead_event_projection(p::crest.lead_events) ORDER BY id),'[]'::jsonb)) INTO result FROM page p;
 IF octet_length(result::text)>1048576 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='CREST_LEAD_STATE_PAGE_LIMIT';END IF;RETURN result;
END
$page$;
RESET ROLE;
GRANT CREATE ON SCHEMA crest_private TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.lead_state_operation_result(uuid,uuid,uuid) OWNER TO crest_lead_integrity_owner;
ALTER FUNCTION crest_private.check_lead_state_event() OWNER TO crest_lead_integrity_owner;
REVOKE CREATE ON SCHEMA crest_private FROM crest_lead_integrity_owner;
GRANT CREATE ON SCHEMA crest_commands TO crest_lead_owner;
ALTER FUNCTION crest_commands.change_lead_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lookup_lead_state_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.read_lead_state_events(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_event_snapshot_context(uuid) OWNER TO crest_lead_owner;
ALTER FUNCTION crest_commands.lead_event_snapshot_page(uuid,text,uuid,integer) OWNER TO crest_lead_owner;
REVOKE CREATE ON SCHEMA crest_commands FROM crest_lead_owner;
REVOKE ALL ON FUNCTION crest_private.lead_state_operation_result(uuid,uuid,uuid),crest_private.check_lead_state_event(),crest_commands.change_lead_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_lead_state_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_private.lead_state_operation_result(uuid,uuid,uuid) TO crest_lead_owner;
GRANT EXECUTE ON FUNCTION crest_commands.change_lead_state(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,uuid,integer,uuid,bigint,jsonb),crest_commands.lookup_lead_state_operation(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid) TO crest_web;
REVOKE ALL ON FUNCTION crest_commands.read_lead_state_events(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer),crest_commands.lead_event_snapshot_context(uuid),crest_commands.lead_event_snapshot_page(uuid,text,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crest_commands.read_lead_state_events(bytea,uuid,uuid,text,uuid,uuid,timestamptz,uuid,uuid,bigint,integer) TO crest_web;
GRANT EXECUTE ON FUNCTION crest_commands.lead_event_snapshot_context(uuid),crest_commands.lead_event_snapshot_page(uuid,text,uuid,integer) TO crest_export;
